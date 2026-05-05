/**
 * Queue & precedent service. Day 1: mostly mock data so the dashboard has
 * something to render. Real items appear here as soon as a mod runs the
 * triage menu (which writes to verdictStore + addToQueue).
 *
 * Day 4 wires reports/automod-filter triggers to push items into the queue
 * automatically. Day 9 adds the watchlist (Sentinel risk-scored items).
 */

import { redis } from '@devvit/web/server';
import { getVerdict, type StoredVerdict } from './verdictStore';
import type { QueueItem, PrecedentItem } from '../../shared/api';

const queueKey = (sub: string) => `triage:queue:${sub}`;
const watchlistKey = (sub: string) => `sentinel:watchlist:${sub}`;
const auditKey = (sub: string) => `audit:by_sub:${sub}`;

export async function addToQueue(sub: string, targetId: string, score: number): Promise<void> {
  await redis.zAdd(queueKey(sub), { member: targetId, score });
}

export async function removeFromQueue(sub: string, targetId: string): Promise<void> {
  await redis.zRem(queueKey(sub), [targetId]);
}

export async function recordAuditEvent(sub: string, action: string): Promise<void> {
  // Lightweight: tracks count of audit events. Day 6 expands to full action log.
  await redis.zAdd(auditKey(sub), { member: `${action}:${Date.now()}`, score: Date.now() });
}

export async function getQueueItems(sub: string, limit = 50): Promise<QueueItem[]> {
  const ids = await redis.zRange(queueKey(sub), 0, limit - 1, { reverse: true, by: 'rank' });
  const verdicts: (StoredVerdict | null)[] = await Promise.all(
    ids.map((entry) => getVerdict(entry.member))
  );
  return verdicts
    .filter((v): v is StoredVerdict => v !== null)
    .map(verdictToQueueItem);
}

export async function getWatchlistItems(sub: string, limit = 25): Promise<QueueItem[]> {
  const ids = await redis.zRange(watchlistKey(sub), 0, limit - 1, { reverse: true, by: 'rank' });
  const verdicts: (StoredVerdict | null)[] = await Promise.all(
    ids.map((entry) => getVerdict(entry.member))
  );
  return verdicts
    .filter((v): v is StoredVerdict => v !== null)
    .map(verdictToQueueItem);
}

export async function getAuditCountLast24h(sub: string): Promise<number> {
  const since = Date.now() - 24 * 60 * 60 * 1000;
  const total = await redis.zCard(auditKey(sub)).catch(() => 0);
  if (total === 0) return 0;
  const recent = await redis
    .zRange(auditKey(sub), since, Date.now(), { by: 'score' })
    .catch(() => []);
  return recent.length;
}

function verdictToQueueItem(v: StoredVerdict): QueueItem {
  return {
    target_id: v.target_id,
    target_kind: v.target_kind,
    subreddit: v.subreddit,
    body: '',
    author_username: 'unknown',
    created_utc: v.ts,
    verdict: v.verdict,
    confidence: v.confidence,
    severity: v.severity,
    rule_violated: v.rule_violated,
    reasoning: v.reasoning,
    removal_message_draft: v.removal_message_draft,
    precedent_cited: v.precedent_cited ?? null,
    model: v.model,
    is_demo: false,
  };
}

/**
 * Demo data fillers. The dashboard prefers real items from Redis but pads with
 * these so the UX is never an empty void. All demo items are marked is_demo:
 * true so the UI can label them honestly.
 */
export function getDemoQueueItems(sub: string): QueueItem[] {
  const now = Date.now();
  return [
    {
      target_id: 't3_demo1',
      target_kind: 'post',
      subreddit: sub,
      title: 'you all are idiots and this sub sucks',
      body: 'spam spam spam',
      author_username: 'demo_troll_42',
      author_account_age_days: 3,
      author_karma: -12,
      created_utc: now - 2 * 60 * 1000,
      reports: ['Rule 1 — incivility', 'harassment'],
      verdict: 'remove',
      confidence: 0.94,
      severity: 5,
      rule_violated: 'Rule 1: Civility',
      reasoning:
        'Direct ad-hominem attack on subreddit members combined with low-effort "spam" body. Account is 3 days old with negative karma — consistent pattern with prior removed accounts.',
      removal_message_draft:
        'Hi u/demo_troll_42, your post in r/' +
        sub +
        ' was removed under Rule 1 (Civility). Personal attacks on community members are not allowed. Please review the rules before posting again.',
      precedent_cited: 'mem:item:demo:post:p_2024_03_15',
      model: 'gemini-3.1-flash-lite-preview',
      is_demo: true,
    },
    {
      target_id: 't3_demo2',
      target_kind: 'post',
      subreddit: sub,
      title: 'check out my new course at example.com/buy-now',
      body: 'Use code DEMO50 for 50% off! Limited time! Affiliate links welcome. Make money fast!',
      author_username: 'demo_marketer',
      author_account_age_days: 1,
      author_karma: 1,
      created_utc: now - 5 * 60 * 1000,
      reports: ['spam', 'self-promotion'],
      verdict: 'ban',
      confidence: 0.99,
      severity: 5,
      rule_violated: 'Rule 2: No spam / self-promotion',
      reasoning:
        'Brand-new account whose only post is a paid-course promotion with affiliate code. Matches 12 prior banned spam accounts in this sub by language pattern (cosine 0.89).',
      removal_message_draft:
        'Hi u/demo_marketer, your post was removed and your account banned for violating Rule 2 (No spam / self-promotion).',
      precedent_cited: 'mem:item:demo:post:p_2024_02_28',
      model: 'gemini-3.1-flash-lite-preview',
      is_demo: true,
    },
    {
      target_id: 't1_demo3',
      target_kind: 'comment',
      subreddit: sub,
      body:
        "I disagree with the OP — though I see why they posted this. The framing seems off but the underlying point about moderation queues is valid.",
      author_username: 'demo_regular',
      author_account_age_days: 1240,
      author_karma: 18420,
      created_utc: now - 12 * 60 * 1000,
      verdict: 'approve',
      confidence: 0.88,
      severity: 1,
      rule_violated: null,
      reasoning:
        'Civil disagreement with substantive content. Long-tenured account with strong sub karma. No precedent for removing similar content; in fact, similar comments have been approved historically.',
      removal_message_draft: null,
      precedent_cited: 'mem:item:demo:comment:c_2024_01_22',
      model: 'gemini-3.1-flash-lite-preview',
      is_demo: true,
    },
    {
      target_id: 't3_demo4',
      target_kind: 'post',
      subreddit: sub,
      title: 'what the heck is going on with the new policy',
      body:
        'Frustrated with the recent changes. Why does it feel like every update breaks something? Anyone else running into issues?',
      author_username: 'demo_user_7',
      author_account_age_days: 412,
      author_karma: 2100,
      created_utc: now - 23 * 60 * 1000,
      verdict: 'escalate',
      confidence: 0.62,
      severity: 3,
      rule_violated: null,
      reasoning:
        'Borderline: complaint tone but substantive. Could escalate into a meta-thread requiring mod attention, but no rule explicitly violated. Recommend human review and possible engagement-focused response.',
      removal_message_draft: null,
      precedent_cited: 'mem:item:demo:post:p_2024_05_03',
      model: 'gemini-3.1-flash-lite-preview',
      is_demo: true,
    },
  ];
}

export function getDemoWatchlistItems(sub: string): QueueItem[] {
  const now = Date.now();
  return [
    {
      target_id: 't3_demo_watch1',
      target_kind: 'post',
      subreddit: sub,
      title: 'why do mods always censor everything',
      body: 'this whole sub is biased toward one side and the mods clearly favor certain users',
      author_username: 'demo_lurker',
      author_account_age_days: 45,
      author_karma: 230,
      created_utc: now - 8 * 60 * 1000,
      verdict: 'escalate',
      confidence: 0.71,
      severity: 3,
      rule_violated: null,
      reasoning:
        'Sentinel: not reported but matches the pattern of 7 prior posts that escalated into rule-1 removals within 4 hours. Risk score 0.78.',
      removal_message_draft: null,
      precedent_cited: null,
      model: 'gemini-3.1-flash-lite-preview',
      is_demo: true,
    },
  ];
}

export function getDemoPrecedent(targetId: string): PrecedentItem[] {
  if (targetId === 't3_demo1' || targetId.endsWith('demo1')) {
    return [
      {
        key: 'mem:item:demo:post:p_2024_03_15',
        outcome: 'removed',
        excerpt: 'this whole community is full of morons who cant read',
        rule: 'Rule 1: Civility',
        mod_username: 'mod_alex',
        mod_reason:
          'Direct insult of community members. User had pattern of incivility going back 6 months.',
        decided_at: Date.parse('2024-03-15T14:22:00Z'),
        similarity: 0.91,
        is_demo: true,
      },
      {
        key: 'mem:item:demo:post:p_2024_02_10',
        outcome: 'removed',
        excerpt: 'go back to your other subreddit you idiots',
        rule: 'Rule 1: Civility',
        mod_username: 'mod_jordan',
        mod_reason: 'Ad-hominem. New account, no prior contributions.',
        decided_at: Date.parse('2024-02-10T09:11:00Z'),
        similarity: 0.84,
        is_demo: true,
      },
      {
        key: 'mem:item:demo:post:p_2024_01_22',
        outcome: 'approved',
        excerpt: 'I think most posts here are kind of low quality lately',
        rule: null,
        mod_username: 'mod_alex',
        mod_reason:
          'Critical but civil — does not target individuals. Approved with note about engagement.',
        decided_at: Date.parse('2024-01-22T18:44:00Z'),
        similarity: 0.62,
        is_demo: true,
      },
    ];
  }

  if (targetId === 't3_demo2' || targetId.endsWith('demo2')) {
    return [
      {
        key: 'mem:item:demo:post:p_2024_02_28',
        outcome: 'banned',
        excerpt: 'my course teaches you to make 10k a month with this exact template',
        rule: 'Rule 2: No spam / self-promotion',
        mod_username: 'mod_jordan',
        mod_reason: 'New account, single promo post, affiliate code. Banned + removed.',
        decided_at: Date.parse('2024-02-28T11:03:00Z'),
        similarity: 0.89,
        is_demo: true,
      },
    ];
  }

  if (targetId === 't1_demo3' || targetId.endsWith('demo3')) {
    return [
      {
        key: 'mem:item:demo:comment:c_2024_01_22',
        outcome: 'approved',
        excerpt:
          'I disagree with this take but I see where the OP is coming from. The framing is a bit off though.',
        rule: null,
        mod_username: 'mod_alex',
        mod_reason: 'Substantive disagreement, civil tone. Standard approval.',
        decided_at: Date.parse('2024-01-22T11:12:00Z'),
        similarity: 0.87,
        is_demo: true,
      },
    ];
  }

  return [];
}
