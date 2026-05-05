import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { context, reddit } from '@devvit/web/server';
import { getVerdict } from '../services/verdictStore';

type TriageFormValues = {
  target_id?: string;
  target_kind?: 'post' | 'comment';
  action?: 'approve' | 'remove' | 'ban' | 'skip' | string[];
  removal_message?: string;
  send_dm?: boolean;
};

export const forms = new Hono();

forms.post('/aegis-triage-submit', async (c) => {
  const values = await c.req.json<TriageFormValues>();
  const targetId = typeof values.target_id === 'string' ? values.target_id : '';
  const kind = values.target_kind === 'comment' ? 'comment' : 'post';
  const action = normalizeAction(values.action);

  if (!targetId) {
    return c.json<UiResponse>({ showToast: 'Aegis: missing target id' }, 400);
  }

  const verdict = await getVerdict(targetId);
  const sub = context.subredditName ?? verdict?.subreddit ?? '';

  if (action === 'skip') {
    return c.json<UiResponse>(
      { showToast: { text: 'Aegis: dismissed without action', appearance: 'neutral' } },
      200
    );
  }

  try {
    const username = await executeModAction({
      action,
      kind,
      targetId,
    });

    if ((action === 'remove' || action === 'ban') && values.send_dm && values.removal_message) {
      const recipient = username;
      if (recipient && sub) {
        await safeSendDm({
          to: recipient,
          subject: `Your ${kind} in r/${sub}`,
          text: values.removal_message,
        });
      }
    }

    return c.json<UiResponse>(
      {
        showToast: {
          text: `Aegis: ${describeAction(action)} ${kind} ${targetId}`,
          appearance: 'success',
        },
      },
      200
    );
  } catch (err) {
    console.error(`Aegis form submit error: ${err}`);
    return c.json<UiResponse>(
      {
        showToast: {
          text: `Aegis action failed: ${truncate(String(err), 140)}`,
          appearance: 'neutral',
        },
      },
      400
    );
  }
});

type ActionInput = {
  action: 'approve' | 'remove' | 'ban';
  kind: 'post' | 'comment';
  targetId: string;
};

async function executeModAction(input: ActionInput): Promise<string | undefined> {
  if (input.kind === 'post') {
    if (!isPostId(input.targetId)) {
      throw new Error(`Invalid post id: ${input.targetId}`);
    }
    const post = await reddit.getPostById(input.targetId);
    if (input.action === 'approve') {
      await post.approve();
    } else {
      await post.remove();
      if (input.action === 'ban' && post.authorName && context.subredditName) {
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

  if (!isCommentId(input.targetId)) {
    throw new Error(`Invalid comment id: ${input.targetId}`);
  }
  const comment = await reddit.getCommentById(input.targetId);
  if (input.action === 'approve') {
    await comment.approve();
  } else {
    await comment.remove();
    if (input.action === 'ban' && comment.authorName && context.subredditName) {
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

function isPostId(id: string): id is `t3_${string}` {
  return id.startsWith('t3_');
}

function isCommentId(id: string): id is `t1_${string}` {
  return id.startsWith('t1_');
}

async function safeSendDm(opts: { to: string; subject: string; text: string }): Promise<void> {
  try {
    await reddit.sendPrivateMessage({
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
    });
  } catch (err) {
    console.warn(`Aegis sendPrivateMessage failed: ${err}`);
  }
}

function normalizeAction(
  raw: TriageFormValues['action']
): 'approve' | 'remove' | 'ban' | 'skip' {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v === 'approve' || v === 'remove' || v === 'ban' || v === 'skip') return v;
  return 'skip';
}

function describeAction(a: 'approve' | 'remove' | 'ban'): string {
  if (a === 'approve') return 'approved';
  if (a === 'remove') return 'removed';
  return 'removed + banned';
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}
