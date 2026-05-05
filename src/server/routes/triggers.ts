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

export const triggers = new Hono();

/**
 * Day 1 wiring: handlers are registered and log incoming events. Real logic
 * (auto-triage, Memory ingestion, calibration capture, crisis detection) is
 * layered in over Days 2–11 per the PRD schedule.
 */

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
    console.log(`[aegis] post-submit ${input.post?.id} by ${input.author?.name}`);
    // Day 2: embed + store in Memory.
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
    console.log(`[aegis] comment-submit ${input.comment?.id} by ${input.author?.name}`);
    // Day 2: embed + store in Memory.
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
