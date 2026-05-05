/**
 * Memory service — vector index of every post, comment, and (eventually) mod
 * action in a subreddit. The "moat" of Aegis: every other layer queries
 * Memory for precedent.
 *
 * Schemas (see PRD §7):
 *   mem:item:{sub}:{kind}:{id}      Hash {body, author, created_utc, embedding_b64, kind, outcome?, mod_reason?, rule_id?}
 *   mem:index:{sub}:recent          Sorted set, score=created_utc, member=item_key
 *   mem:index:{sub}:removed         Sorted set, score=created_utc, member=item_key
 *   mem:index:{sub}:approved        Sorted set, score=created_utc, member=item_key
 *
 * Embeddings: 768-dim Float32 from text-embedding-004, packed as base64
 * little-endian (~4KB per item). Search is brute-force cosine over the most
 * recent N items (configurable, default 5K) — fits in <50ms in JS for typical
 * sub volumes and avoids managing a vector index inside Devvit's Redis.
 */

import { redis, settings } from '@devvit/web/server';
import { generateEmbedding, EMBEDDING_DIM } from './gemini';
import type { Verdict } from './types';

async function getGeminiApiKey(): Promise<string> {
  const key = await settings.get<string>('gemini_api_key');
  if (!key) {
    throw new Error('Gemini API key not configured. Set it in app settings.');
  }
  return key;
}

export type MemoryItemKind = 'post' | 'comment' | 'mod_action' | 'rule_version';

export type MemoryItem = {
  kind: MemoryItemKind;
  id: string;
  body: string;
  authorUsername?: string;
  createdUtc: number;
  outcome?: Verdict;
  modReason?: string;
  ruleId?: string;
  embedding?: Float32Array;
};

export type SearchOptions = {
  k?: number;
  filterKind?: MemoryItemKind;
  filterOutcome?: Verdict;
  recentLimit?: number;
  minSimilarity?: number;
};

export type SearchHit = {
  item: MemoryItem;
  similarity: number;
};

const DEFAULT_RECENT_SCAN = 5000;
const DEFAULT_K = 5;

const itemKey = (sub: string, kind: MemoryItemKind, id: string): string =>
  `mem:item:${sub}:${kind}:${id}`;
const recentIndexKey = (sub: string): string => `mem:index:${sub}:recent`;
const outcomeIndexKey = (sub: string, outcome: Verdict): string =>
  `mem:index:${sub}:${outcome === 'approve' ? 'approved' : 'removed'}`;

function encodeEmbedding(vec: Float32Array): string {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength).toString('base64');
}

function decodeEmbedding(b64: string): Float32Array | null {
  if (!b64) return null;
  const buf = Buffer.from(b64, 'base64');
  if (buf.byteLength !== EMBEDDING_DIM * 4) return null;
  // Copy into a fresh ArrayBuffer so the Float32Array isn't tied to a Node Buffer pool.
  const ab = new ArrayBuffer(buf.byteLength);
  new Uint8Array(ab).set(buf);
  return new Float32Array(ab);
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (denom === 0) return 0;
  return dot / denom;
}

function deserializeItem(
  kind: MemoryItemKind,
  id: string,
  hash: Record<string, string>
): MemoryItem {
  const item: MemoryItem = {
    kind,
    id,
    body: hash.body ?? '',
    authorUsername: hash.author || undefined,
    createdUtc: Number.parseInt(hash.created_utc ?? '0', 10) || 0,
    modReason: hash.mod_reason || undefined,
    ruleId: hash.rule_id || undefined,
  };
  if (hash.outcome === 'approve' || hash.outcome === 'remove' || hash.outcome === 'ban' || hash.outcome === 'escalate') {
    item.outcome = hash.outcome;
  }
  if (hash.embedding_b64) {
    const vec = decodeEmbedding(hash.embedding_b64);
    if (vec) item.embedding = vec;
  }
  return item;
}

function parseItemKey(key: string): { sub: string; kind: MemoryItemKind; id: string } | null {
  // mem:item:{sub}:{kind}:{id}
  const parts = key.split(':');
  if (parts.length < 5 || parts[0] !== 'mem' || parts[1] !== 'item') return null;
  const sub = parts[2] ?? '';
  const kind = parts[3] as MemoryItemKind;
  const id = parts.slice(4).join(':');
  if (!sub || !id) return null;
  if (kind !== 'post' && kind !== 'comment' && kind !== 'mod_action' && kind !== 'rule_version') {
    return null;
  }
  return { sub, kind, id };
}

export async function embed(text: string): Promise<Float32Array> {
  const apiKey = await getGeminiApiKey();
  const result = await generateEmbedding({ apiKey, text, taskType: 'SEMANTIC_SIMILARITY' });
  return result.embedding;
}

export async function storeItem(sub: string, item: MemoryItem): Promise<void> {
  if (!sub || !item.id) throw new Error('storeItem: sub and item.id required');
  const key = itemKey(sub, item.kind, item.id);

  const fields: Record<string, string> = {
    kind: item.kind,
    body: item.body ?? '',
    created_utc: String(item.createdUtc || Date.now()),
  };
  if (item.authorUsername) fields.author = item.authorUsername;
  if (item.outcome) fields.outcome = item.outcome;
  if (item.modReason) fields.mod_reason = item.modReason;
  if (item.ruleId) fields.rule_id = item.ruleId;
  if (item.embedding) fields.embedding_b64 = encodeEmbedding(item.embedding);

  await redis.hSet(key, fields);
  await redis.zAdd(recentIndexKey(sub), { member: key, score: fields.created_utc ? Number(fields.created_utc) : Date.now() });
  if (item.outcome === 'approve' || item.outcome === 'remove' || item.outcome === 'ban') {
    await redis.zAdd(outcomeIndexKey(sub, item.outcome), {
      member: key,
      score: Number(fields.created_utc),
    });
  }
}

export async function getItem(
  sub: string,
  kind: MemoryItemKind,
  id: string
): Promise<MemoryItem | null> {
  const key = itemKey(sub, kind, id);
  const hash = await redis.hGetAll(key);
  if (!hash || Object.keys(hash).length === 0) return null;
  return deserializeItem(kind, id, hash);
}

export async function recordOutcome(
  sub: string,
  kind: MemoryItemKind,
  id: string,
  outcome: Verdict,
  modReason: string,
  ruleId?: string
): Promise<void> {
  const key = itemKey(sub, kind, id);
  const fields: Record<string, string> = { outcome, mod_reason: modReason };
  if (ruleId) fields.rule_id = ruleId;
  await redis.hSet(key, fields);
  if (outcome === 'approve' || outcome === 'remove' || outcome === 'ban') {
    const ts = Number((await redis.hGet(key, 'created_utc')) ?? Date.now());
    await redis.zAdd(outcomeIndexKey(sub, outcome), { member: key, score: ts });
  }
}

/**
 * Brute-force cosine search across the most recent N items in `sub`. Loads
 * each item's hash in parallel; for typical N=5000 and Devvit Redis latency
 * this lands well under the 5s triage budget. Results filtered + sorted by
 * similarity desc.
 */
export async function searchSimilar(
  sub: string,
  query: Float32Array | string,
  opts: SearchOptions = {}
): Promise<SearchHit[]> {
  const queryVec =
    typeof query === 'string' ? await embed(query) : query;

  const recentLimit = opts.recentLimit ?? DEFAULT_RECENT_SCAN;
  const k = opts.k ?? DEFAULT_K;
  const minSim = opts.minSimilarity ?? 0;

  const indexKey = opts.filterOutcome
    ? outcomeIndexKey(sub, opts.filterOutcome)
    : recentIndexKey(sub);

  const entries = await redis.zRange(indexKey, 0, recentLimit - 1, {
    reverse: true,
    by: 'rank',
  });
  if (entries.length === 0) return [];

  const hashes = await Promise.all(
    entries.map((e) =>
      redis.hGetAll(e.member).catch(() => ({} as Record<string, string>))
    )
  );

  const hits: SearchHit[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const hash = hashes[i];
    if (!entry || !hash || Object.keys(hash).length === 0) continue;

    const parsed = parseItemKey(entry.member);
    if (!parsed) continue;
    if (opts.filterKind && parsed.kind !== opts.filterKind) continue;

    const item = deserializeItem(parsed.kind, parsed.id, hash);
    if (!item.embedding) continue;

    const sim = cosineSimilarity(queryVec, item.embedding);
    if (sim < minSim) continue;
    hits.push({ item, similarity: sim });
  }

  hits.sort((a, b) => b.similarity - a.similarity);
  return hits.slice(0, k);
}

export const memory = {
  embed,
  storeItem,
  getItem,
  searchSimilar,
  recordOutcome,
};
