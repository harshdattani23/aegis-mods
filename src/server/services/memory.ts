/**
 * Memory service — vector index of every post/comment/mod-action in the
 * subreddit. The "moat" of Aegis: every other layer queries Memory for
 * precedent.
 *
 * Day 1: interface skeleton only. No real embedding or storage.
 * Day 2: implement embed() via text-embedding-004, store() in Redis.
 * Day 3: backfill job for AppInstall trigger.
 */

import type { Verdict } from './types';

export type MemoryItemKind = 'post' | 'comment' | 'mod_action' | 'rule_version';

export type MemoryItem = {
  key: string;
  kind: MemoryItemKind;
  body: string;
  authorUsername?: string;
  createdUtc: number;
  // Set when the item has been moderated. Drives "similar removed/approved" lookups.
  outcome?: Verdict;
  modReason?: string;
  ruleId?: string;
  // Embedding stored as base64-packed Float32Array. 768-dim from text-embedding-004.
  embeddingB64?: string;
};

export type SearchOptions = {
  k?: number;
  filterKind?: MemoryItemKind;
  filterOutcome?: Verdict;
  // Limit search to recent N items (sliding window) for performance.
  recentLimit?: number;
};

export type SearchHit = {
  item: MemoryItem;
  similarity: number;
};

export type MemoryService = {
  embed(text: string): Promise<Float32Array>;
  storeItem(item: MemoryItem): Promise<void>;
  getItem(key: string): Promise<MemoryItem | null>;
  searchSimilar(text: string, opts?: SearchOptions): Promise<SearchHit[]>;
  getRecent(n: number, kind?: MemoryItemKind): Promise<MemoryItem[]>;
  // Marks an existing item with an outcome — called when a mod acts.
  recordOutcome(
    key: string,
    outcome: Verdict,
    modReason: string,
    ruleId?: string
  ): Promise<void>;
};

/**
 * Day 1 stub. All methods throw "not implemented" so callers fail loudly until
 * Day 2 wires up the real implementation backed by Devvit Redis.
 */
export const memory: MemoryService = {
  async embed(_text: string): Promise<Float32Array> {
    throw new Error('memory.embed not implemented (Day 2)');
  },
  async storeItem(_item: MemoryItem): Promise<void> {
    throw new Error('memory.storeItem not implemented (Day 2)');
  },
  async getItem(_key: string): Promise<MemoryItem | null> {
    throw new Error('memory.getItem not implemented (Day 2)');
  },
  async searchSimilar(_text: string, _opts?: SearchOptions): Promise<SearchHit[]> {
    throw new Error('memory.searchSimilar not implemented (Day 2)');
  },
  async getRecent(_n: number, _kind?: MemoryItemKind): Promise<MemoryItem[]> {
    throw new Error('memory.getRecent not implemented (Day 2)');
  },
  async recordOutcome(
    _key: string,
    _outcome: Verdict,
    _modReason: string,
    _ruleId?: string
  ): Promise<void> {
    throw new Error('memory.recordOutcome not implemented (Day 2)');
  },
};
