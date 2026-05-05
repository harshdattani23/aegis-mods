/**
 * Persistence layer for triage verdicts. Lets the menu/dashboard generate a
 * verdict, and the form submit handler read it back to execute the action.
 *
 * Day 1: minimum viable. Day 4+ extends with the queue sorted-set
 * (`triage:queue:{sub}`) and audit log writes.
 */

import { redis } from '@devvit/web/server';
import type { TriageResult } from './types';

const TTL_SECONDS = 60 * 60 * 24 * 14; // 14 days per PRD

const verdictKey = (targetId: string) => `triage:verdict:${targetId}`;

export type StoredVerdict = TriageResult & {
  target_id: string;
  target_kind: 'post' | 'comment';
  subreddit: string;
  ts: number;
};

export async function saveVerdict(v: StoredVerdict): Promise<void> {
  await redis.set(verdictKey(v.target_id), JSON.stringify(v), {
    expiration: new Date(Date.now() + TTL_SECONDS * 1000),
  });
}

export async function getVerdict(targetId: string): Promise<StoredVerdict | null> {
  const raw = await redis.get(verdictKey(targetId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredVerdict;
  } catch {
    return null;
  }
}
