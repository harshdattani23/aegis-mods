import { Hono } from 'hono';
import type {
  OnAppInstallRequest,
  OnPostSubmitRequest,
  OnCommentSubmitRequest,
  OnPostReportRequest,
  OnCommentReportRequest,
  OnModActionRequest,
  OnAutomoderatorFilterPostRequest,
  OnAutomoderatorFilterCommentRequest,
  TriggerResponse,
} from '@devvit/web/shared';
import { context } from '@devvit/web/server';
import { memory, type MemoryItem } from '../services/memory';

export const triggers = new Hono();

/**
 * Memory ingestion runs inside trigger handlers. Failures (Gemini timeout,
 * Redis quota, missing API key) must NEVER throw back to Devvit — the trigger
 * has to ack 200 or Reddit retries indefinitely. We log and swallow.
 */
async function ingestToMemory(
  sub: string,
  item: Omit<MemoryItem, 'embedding'>
): Promise<void> {
  if (!item.body || item.body.trim().length < 3) return;
  try {
    const embedding = await memory.embed(item.body);
    await memory.storeItem(sub, { ...item, embedding });
  } catch (err) {
    console.warn(`[aegis] memory ingest failed for ${item.kind} ${item.id}: ${err}`);
  }
}

triggers.post('/app-install', async (c) => {
  try {
    const input = await c.req.json<OnAppInstallRequest>();
    console.log(
      `[aegis] app-install in r/${context.subredditName} (trigger: ${input.type})`
    );
    // Day 3: kick off historical backfill into Memory here.
    return c.json<TriggerResponse>({}, 200);
  } catch (error) {
    console.error(`app-install error: ${error}`);
    return c.json<TriggerResponse>({}, 200);
  }
});

triggers.post('/post-submit', async (c) => {
  try {
    const input = await c.req.json<OnPostSubmitRequest>();
    const sub = context.subredditName;
    const post = input.post;
    console.log(`[aegis] post-submit ${post?.id} by ${input.author?.name}`);
    if (sub && post?.id) {
      const body = [post.title, post.selftext ?? ''].filter(Boolean).join('\n\n');
      await ingestToMemory(sub, {
        kind: 'post',
        id: post.id,
        body,
        authorUsername: input.author?.name,
        createdUtc: post.createdAt ? Number(post.createdAt) : Date.now(),
      });
    }
    // Day 9: Sentinel risk score.
    return c.json<TriggerResponse>({}, 200);
  } catch (error) {
    console.error(`post-submit error: ${error}`);
    return c.json<TriggerResponse>({}, 200);
  }
});

triggers.post('/comment-submit', async (c) => {
  try {
    const input = await c.req.json<OnCommentSubmitRequest>();
    const sub = context.subredditName;
    const comment = input.comment;
    console.log(`[aegis] comment-submit ${comment?.id} by ${input.author?.name}`);
    if (sub && comment?.id && comment.body) {
      await ingestToMemory(sub, {
        kind: 'comment',
        id: comment.id,
        body: comment.body,
        authorUsername: input.author?.name,
        createdUtc: comment.createdAt ? Number(comment.createdAt) : Date.now(),
      });
    }
    // Day 10: Crisis detector window update.
    return c.json<TriggerResponse>({}, 200);
  } catch (error) {
    console.error(`comment-submit error: ${error}`);
    return c.json<TriggerResponse>({}, 200);
  }
});

triggers.post('/post-report', async (c) => {
  try {
    const input = await c.req.json<OnPostReportRequest>();
    console.log(`[aegis] post-report ${input.post?.id} reason="${input.reason}"`);
    // Day 4: auto-triage on report.
    return c.json<TriggerResponse>({}, 200);
  } catch (error) {
    console.error(`post-report error: ${error}`);
    return c.json<TriggerResponse>({}, 200);
  }
});

triggers.post('/comment-report', async (c) => {
  try {
    const input = await c.req.json<OnCommentReportRequest>();
    console.log(`[aegis] comment-report ${input.comment?.id} reason="${input.reason}"`);
    // Day 4: auto-triage on report.
    return c.json<TriggerResponse>({}, 200);
  } catch (error) {
    console.error(`comment-report error: ${error}`);
    return c.json<TriggerResponse>({}, 200);
  }
});

triggers.post('/mod-action', async (c) => {
  try {
    const input = await c.req.json<OnModActionRequest>();
    console.log(`[aegis] mod-action action=${input.action} target=${input.targetUser?.name}`);
    // Day 6: capture overrides for calibration.
    return c.json<TriggerResponse>({}, 200);
  } catch (error) {
    console.error(`mod-action error: ${error}`);
    return c.json<TriggerResponse>({}, 200);
  }
});

triggers.post('/automod-filter-post', async (c) => {
  try {
    const input = await c.req.json<OnAutomoderatorFilterPostRequest>();
    console.log(`[aegis] automod-filter-post ${input.post?.id}`);
    // Day 4: route into queue for triage.
    return c.json<TriggerResponse>({}, 200);
  } catch (error) {
    console.error(`automod-filter-post error: ${error}`);
    return c.json<TriggerResponse>({}, 200);
  }
});

triggers.post('/automod-filter-comment', async (c) => {
  try {
    const input = await c.req.json<OnAutomoderatorFilterCommentRequest>();
    console.log(`[aegis] automod-filter-comment ${input.comment?.id}`);
    // Day 4: route into queue for triage.
    return c.json<TriggerResponse>({}, 200);
  } catch (error) {
    console.error(`automod-filter-comment error: ${error}`);
    return c.json<TriggerResponse>({}, 200);
  }
});
