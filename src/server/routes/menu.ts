import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import type { Form } from '@devvit/shared-types/shared/form.js';
import { context, reddit } from '@devvit/web/server';
import { createPost } from '../core/post';
import { triage } from '../services/triage';
import { saveVerdict, type StoredVerdict } from '../services/verdictStore';
import { addToQueue } from '../services/queue';
import { memory, type SearchHit } from '../services/memory';
import type { TriageInput, TriageResult } from '../services/types';

export const menu = new Hono();

/**
 * Subreddit-level menu: open the dashboard custom post.
 */
menu.post('/open-dashboard', async (c) => {
  try {
    const post = await createPost();
    return c.json<UiResponse>(
      {
        navigateTo: `https://reddit.com/r/${context.subredditName}/comments/${post.id}`,
      },
      200
    );
  } catch (error) {
    console.error(`Error opening dashboard: ${error}`);
    return c.json<UiResponse>({ showToast: 'Failed to open Aegis dashboard' }, 400);
  }
});

menu.post('/triage-post', async (c) => {
  const postId = context.postId;
  if (!postId) {
    return c.json<UiResponse>({ showToast: 'No post in context' }, 400);
  }
  try {
    const post = await reddit.getPostById(postId);
    const author = await safeGetAuthor(post.authorName);

    const input: TriageInput = {
      kind: 'post',
      id: post.id,
      title: post.title,
      body: post.body ?? '',
      authorUsername: post.authorName ?? 'unknown',
      authorKarma: author?.karma,
      authorAccountAgeDays: author?.accountAgeDays,
    };

    const result = await triage(input);
    const precedent = await fetchPrecedentForForm('post', input.id, input.body, input.title);
    await persistVerdict(input, result);
    return c.json<UiResponse>(buildTriageFormResponse(input, result, precedent), 200);
  } catch (error) {
    console.error(`Triage post error: ${error}`);
    return c.json<UiResponse>(
      { showToast: `Triage failed: ${truncate(String(error), 120)}` },
      400
    );
  }
});

menu.post('/triage-comment', async (c) => {
  const commentId = context.commentId;
  if (!commentId) {
    return c.json<UiResponse>({ showToast: 'No comment in context' }, 400);
  }
  try {
    const comment = await reddit.getCommentById(commentId);
    const author = await safeGetAuthor(comment.authorName);

    const input: TriageInput = {
      kind: 'comment',
      id: comment.id,
      body: comment.body ?? '',
      authorUsername: comment.authorName ?? 'unknown',
      authorKarma: author?.karma,
      authorAccountAgeDays: author?.accountAgeDays,
    };

    const result = await triage(input);
    const precedent = await fetchPrecedentForForm('comment', input.id, input.body);
    await persistVerdict(input, result);
    return c.json<UiResponse>(buildTriageFormResponse(input, result, precedent), 200);
  } catch (error) {
    console.error(`Triage comment error: ${error}`);
    return c.json<UiResponse>(
      { showToast: `Triage failed: ${truncate(String(error), 120)}` },
      400
    );
  }
});

/**
 * Look up similar past mod-decided items for the triage form. Best-effort:
 * if Memory hasn't seen this item yet (or has no precedent), returns [] and
 * the form omits the precedent block. Never throws.
 */
async function fetchPrecedentForForm(
  kind: 'post' | 'comment',
  id: string,
  body: string,
  title?: string
): Promise<SearchHit[]> {
  const sub = context.subredditName;
  if (!sub) return [];
  try {
    const stored = await memory.getItem(sub, kind, id);
    const queryText = stored?.embedding
      ? null
      : [title, body].filter(Boolean).join('\n\n');
    if (!stored?.embedding && !queryText?.trim()) return [];

    const hits = await memory.searchSimilar(
      sub,
      stored?.embedding ?? queryText ?? '',
      { k: 3, minSimilarity: 0.65 }
    );
    return hits.filter(
      (h) =>
        h.item.id !== id &&
        (h.item.outcome === 'approve' ||
          h.item.outcome === 'remove' ||
          h.item.outcome === 'ban')
    );
  } catch (err) {
    console.warn(`fetchPrecedentForForm failed: ${err}`);
    return [];
  }
}

async function persistVerdict(input: TriageInput, result: TriageResult): Promise<void> {
  const sub = context.subredditName ?? 'unknown';
  const stored: StoredVerdict = {
    ...result,
    target_id: input.id,
    target_kind: input.kind,
    subreddit: sub,
    ts: Date.now(),
  };
  await saveVerdict(stored);
  // Push into the queue sorted-set so the dashboard surfaces it.
  await addToQueue(sub, input.id, result.severity * Math.max(0.01, result.confidence));
}

function buildTriageFormResponse(
  input: TriageInput,
  result: TriageResult,
  precedent: SearchHit[]
): UiResponse {
  const conf = Math.round(result.confidence * 100);
  const sevBar = '█'.repeat(result.severity) + '░'.repeat(5 - result.severity);
  const precedentLines =
    precedent.length === 0
      ? ['  • (no similar prior decisions yet — Memory still indexing this sub)']
      : precedent.map((h) => {
          const outcome =
            h.item.outcome === 'approve'
              ? 'APPROVED'
              : h.item.outcome === 'ban'
                ? 'BANNED'
                : 'REMOVED';
          const sim = Math.round(h.similarity * 100);
          const excerpt = h.item.body.slice(0, 90).replace(/\s+/g, ' ').trim();
          return `  • [${outcome} · ${sim}%] "${excerpt}${h.item.body.length > 90 ? '…' : ''}"`;
        });
  const description = [
    `VERDICT: ${result.verdict.toUpperCase()}    confidence ${conf}%    severity ${sevBar} ${result.severity}/5`,
    result.rule_violated ? `Rule cited: ${result.rule_violated}` : 'Rule cited: (none)',
    '',
    `Reasoning: ${result.reasoning}`,
    '',
    'Precedent (similar prior decisions in this sub):',
    ...precedentLines,
    '',
    `Target: ${input.kind} ${input.id} by u/${input.authorUsername}`,
    `Model: ${result.model}    latency ${result.latency_ms}ms`,
  ].join('\n');

  const form: Form = {
    title: `Aegis Triage — ${result.verdict.toUpperCase()} (${conf}%)`,
    description,
    acceptLabel: 'Apply action',
    cancelLabel: 'Dismiss',
    fields: [
      {
        type: 'string',
        name: 'target_id',
        label: 'Target ID',
        defaultValue: input.id,
        disabled: true,
      },
      {
        type: 'string',
        name: 'target_kind',
        label: 'Kind',
        defaultValue: input.kind,
        disabled: true,
      },
      {
        type: 'select',
        name: 'action',
        label: 'Action',
        helpText: 'What should Aegis do with this item?',
        options: [
          { label: 'Approve (mark reviewed, leave up)', value: 'approve' },
          { label: 'Remove (mark spam=false)', value: 'remove' },
          { label: 'Remove + Ban author', value: 'ban' },
          { label: 'Skip — do nothing', value: 'skip' },
        ],
        defaultValue: [defaultActionFor(result.verdict)],
        multiSelect: false,
      },
      {
        type: 'paragraph',
        name: 'removal_message',
        label: 'Message to user (DM, sent on remove or ban)',
        helpText: 'Edit before sending. Aegis pre-fills based on the rule cited.',
        defaultValue: result.removal_message_draft ?? '',
      },
      {
        type: 'boolean',
        name: 'send_dm',
        label: 'Send the message above as a private DM',
        defaultValue: !!result.removal_message_draft,
      },
    ],
  };

  return {
    showForm: {
      name: 'aegisTriage',
      form,
    },
  };
}

function defaultActionFor(verdict: TriageResult['verdict']): string {
  switch (verdict) {
    case 'approve':
      return 'approve';
    case 'remove':
      return 'remove';
    case 'ban':
      return 'ban';
    default:
      return 'skip';
  }
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}

type AuthorInfo = {
  karma?: number;
  accountAgeDays?: number;
};

async function safeGetAuthor(username: string | undefined): Promise<AuthorInfo | undefined> {
  if (!username) return undefined;
  try {
    const user = await reddit.getUserByUsername(username);
    if (!user) return undefined;
    const ageMs = Date.now() - user.createdAt.getTime();
    return {
      karma: user.linkKarma + user.commentKarma,
      accountAgeDays: Math.max(0, Math.floor(ageMs / (1000 * 60 * 60 * 24))),
    };
  } catch (err) {
    console.warn(`safeGetAuthor failed for ${username}: ${err}`);
    return undefined;
  }
}
