import { Hono } from 'hono';
import { context, reddit, redis } from '@devvit/web/server';
import {
  addToQueue,
  removeFromQueue,
  getQueueItems,
  getWatchlistItems,
  getAuditCountLast24h,
  getDemoQueueItems,
  getDemoWatchlistItems,
  getDemoPrecedent,
  recordAuditEvent,
} from '../services/queue';
import { saveVerdict } from '../services/verdictStore';
import { triage, getAegisSettings } from '../services/triage';
import { memory, type MemoryItem } from '../services/memory';
import type {
  ActionRequest,
  ActionResponse,
  DashboardInitResponse,
  ErrorResponse,
  PrecedentItem,
  PrecedentResponse,
  QueueItem,
} from '../../shared/api';

export const api = new Hono();

api.get('/dashboard/init', async (c) => {
  const sub = context.subredditName ?? 'unknown';
  try {
    const [username, settings, realQueue, realWatch, auditCount, costSpent] =
      await Promise.all([
        reddit.getCurrentUsername().catch(() => null),
        getAegisSettings(),
        getQueueItems(sub).catch(() => [] as QueueItem[]),
        getWatchlistItems(sub).catch(() => [] as QueueItem[]),
        getAuditCountLast24h(sub).catch(() => 0),
        getDailyCostSpent(sub).catch(() => 0),
      ]);

    const queue = padWithDemo(realQueue, getDemoQueueItems(sub), 4);
    const watchlist = padWithDemo(realWatch, getDemoWatchlistItems(sub), 1);

    const response: DashboardInitResponse = {
      type: 'dashboard_init',
      summary: {
        subreddit: sub,
        username: username ?? null,
        is_moderator: true, // TODO: real check via reddit.getModerators
        queue_count: queue.length,
        watchlist_count: watchlist.length,
        audit_count_24h: auditCount,
        crisis: { state: 'normal', since: null, trigger_reason: null },
        daily_cost_usd: costSpent,
        daily_cost_cap_usd: settings.daily_cost_cap_usd,
        feature_arbiter: settings.feature_arbiter,
        feature_sentinel: settings.feature_sentinel,
        feature_crisis: settings.feature_crisis,
        feature_vision: settings.feature_vision,
        feature_coach: settings.feature_coach,
      },
      queue,
      watchlist,
    };
    return c.json<DashboardInitResponse>(response);
  } catch (err) {
    console.error(`dashboard/init error: ${err}`);
    return c.json<ErrorResponse>(
      { status: 'error', message: `Init failed: ${String(err).slice(0, 200)}` },
      500
    );
  }
});

api.get('/precedent/:targetId', async (c) => {
  const sub = context.subredditName ?? '';
  const targetId = c.req.param('targetId');

  // Demo IDs always render demo precedent — keeps the dashboard storyboard
  // intact while a real sub builds up Memory.
  if (!sub || targetId.includes('demo')) {
    return c.json<PrecedentResponse>({
      type: 'precedent',
      target_id: targetId,
      items: getDemoPrecedent(targetId),
    });
  }

  try {
    const kind: MemoryItem['kind'] = targetId.startsWith('t1_') ? 'comment' : 'post';
    const stored = await memory.getItem(sub, kind, targetId);
    if (!stored?.embedding) {
      return c.json<PrecedentResponse>({
        type: 'precedent',
        target_id: targetId,
        items: getDemoPrecedent(targetId),
      });
    }

    const hits = await memory.searchSimilar(sub, stored.embedding, {
      k: 5,
      minSimilarity: 0.6,
    });

    const items: PrecedentItem[] = hits
      .filter(
        (h) =>
          h.item.id !== targetId &&
          (h.item.outcome === 'approve' ||
            h.item.outcome === 'remove' ||
            h.item.outcome === 'ban')
      )
      .map((h) => {
        const outcome: PrecedentItem['outcome'] =
          h.item.outcome === 'approve'
            ? 'approved'
            : h.item.outcome === 'ban'
              ? 'banned'
              : 'removed';
        return {
          key: `mem:item:${sub}:${h.item.kind}:${h.item.id}`,
          outcome,
          excerpt: h.item.body.slice(0, 240),
          rule: h.item.ruleId ?? null,
          mod_username: null,
          mod_reason: h.item.modReason ?? null,
          decided_at: h.item.createdUtc,
          similarity: h.similarity,
          is_demo: false,
        };
      });

    if (items.length === 0) {
      return c.json<PrecedentResponse>({
        type: 'precedent',
        target_id: targetId,
        items: getDemoPrecedent(targetId),
      });
    }

    return c.json<PrecedentResponse>({ type: 'precedent', target_id: targetId, items });
  } catch (err) {
    console.error(`/api/precedent error: ${err}`);
    return c.json<PrecedentResponse>({
      type: 'precedent',
      target_id: targetId,
      items: getDemoPrecedent(targetId),
    });
  }
});

api.post('/action', async (c) => {
  const sub = context.subredditName ?? '';
  const body = await c.req.json<ActionRequest>();

  if (!body.target_id) {
    return c.json<ErrorResponse>({ status: 'error', message: 'target_id required' }, 400);
  }

  // Demo items can be "actioned" without hitting Reddit — just clean up the queue.
  if (body.target_id.includes('demo')) {
    await removeFromQueue(sub, body.target_id);
    await recordAuditEvent(sub, `demo_${body.action}`);
    return c.json<ActionResponse>({
      type: 'action',
      target_id: body.target_id,
      action: body.action,
      ok: true,
      message: `Demo: ${body.action} (no Reddit API call)`,
    });
  }

  if (body.action === 'skip') {
    return c.json<ActionResponse>({
      type: 'action',
      target_id: body.target_id,
      action: 'skip',
      ok: true,
      message: 'Skipped',
    });
  }

  try {
    const username = await executeAction(body);

    if (
      (body.action === 'remove' || body.action === 'ban') &&
      body.send_dm &&
      body.dm_message &&
      username &&
      sub
    ) {
      await reddit
        .sendPrivateMessage({
          to: username,
          subject: `Your ${body.target_kind} in r/${sub}`,
          text: body.dm_message,
        })
        .catch((err) => console.warn(`DM failed: ${err}`));
    }

    await removeFromQueue(sub, body.target_id);
    await recordAuditEvent(sub, body.action);

    return c.json<ActionResponse>({
      type: 'action',
      target_id: body.target_id,
      action: body.action,
      ok: true,
      message: `${describe(body.action)} ${body.target_id}`,
    });
  } catch (err) {
    console.error(`/api/action error: ${err}`);
    return c.json<ErrorResponse>(
      { status: 'error', message: `Action failed: ${String(err).slice(0, 200)}` },
      500
    );
  }
});

/**
 * Manual triage from the dashboard — used when a mod wants to triage an
 * arbitrary post/comment ID (e.g. demo seeding). Real items mostly arrive
 * via report/automod-filter triggers (Day 4).
 */
api.post('/triage', async (c) => {
  const sub = context.subredditName ?? '';
  const body = await c.req.json<{ target_id: string; target_kind: 'post' | 'comment' }>();
  if (!body.target_id) {
    return c.json<ErrorResponse>({ status: 'error', message: 'target_id required' }, 400);
  }

  try {
    let title: string | undefined;
    let bodyText = '';
    let authorName = 'unknown';

    if (body.target_kind === 'post' && body.target_id.startsWith('t3_')) {
      const post = await reddit.getPostById(body.target_id as `t3_${string}`);
      title = post.title;
      bodyText = post.body ?? '';
      authorName = post.authorName ?? 'unknown';
    } else if (body.target_kind === 'comment' && body.target_id.startsWith('t1_')) {
      const comment = await reddit.getCommentById(body.target_id as `t1_${string}`);
      bodyText = comment.body ?? '';
      authorName = comment.authorName ?? 'unknown';
    } else {
      return c.json<ErrorResponse>({ status: 'error', message: 'invalid target id' }, 400);
    }

    const result = await triage({
      kind: body.target_kind,
      id: body.target_id,
      title,
      body: bodyText,
      authorUsername: authorName,
    });
    await saveVerdict({
      ...result,
      target_id: body.target_id,
      target_kind: body.target_kind,
      subreddit: sub,
      ts: Date.now(),
    });
    await addToQueue(sub, body.target_id, result.severity * result.confidence);

    return c.json({ ok: true, verdict: result });
  } catch (err) {
    console.error(`/api/triage error: ${err}`);
    return c.json<ErrorResponse>(
      { status: 'error', message: `Triage failed: ${String(err).slice(0, 200)}` },
      500
    );
  }
});

async function executeAction(req: ActionRequest): Promise<string | undefined> {
  if (req.target_kind === 'post') {
    if (!req.target_id.startsWith('t3_')) {
      throw new Error(`Invalid post id: ${req.target_id}`);
    }
    const post = await reddit.getPostById(req.target_id as `t3_${string}`);
    if (req.action === 'approve') {
      await post.approve();
    } else {
      await post.remove();
      if (req.action === 'ban' && post.authorName && context.subredditName) {
        await reddit.banUser({
          subredditName: context.subredditName,
          username: post.authorName,
          reason: 'Aegis triage',
          context: post.id,
        });
      }
    }
    return post.authorName;
  }

  if (!req.target_id.startsWith('t1_')) {
    throw new Error(`Invalid comment id: ${req.target_id}`);
  }
  const comment = await reddit.getCommentById(req.target_id as `t1_${string}`);
  if (req.action === 'approve') {
    await comment.approve();
  } else {
    await comment.remove();
    if (req.action === 'ban' && comment.authorName && context.subredditName) {
      await reddit.banUser({
        subredditName: context.subredditName,
        username: comment.authorName,
        reason: 'Aegis triage',
        context: comment.id,
      });
    }
  }
  return comment.authorName;
}

async function getDailyCostSpent(sub: string): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const raw = await redis.get(`budget:daily:${sub}:${today}`);
  if (!raw) return 0;
  const tokens = parseInt(raw, 10);
  if (Number.isNaN(tokens)) return 0;
  // ~$0.10 per million tokens for Flash Lite (rough)
  return (tokens / 1_000_000) * 0.1;
}

function padWithDemo(real: QueueItem[], demo: QueueItem[], floor: number): QueueItem[] {
  if (real.length >= floor) return real;
  const need = floor - real.length;
  return [...real, ...demo.slice(0, need)];
}

function describe(a: ActionRequest['action']): string {
  if (a === 'approve') return 'Approved';
  if (a === 'remove') return 'Removed';
  if (a === 'ban') return 'Removed + banned';
  return 'Skipped';
}
