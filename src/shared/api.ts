export type Verdict = 'approve' | 'remove' | 'ban' | 'escalate';

export type QueueItem = {
  target_id: string;
  target_kind: 'post' | 'comment';
  subreddit: string;
  title?: string;
  body: string;
  author_username: string;
  author_account_age_days?: number;
  author_karma?: number;
  created_utc: number;
  reports?: string[];
  verdict: Verdict;
  confidence: number;
  severity: number;
  rule_violated: string | null;
  reasoning: string;
  removal_message_draft: string | null;
  precedent_cited: string | null;
  model: string;
  is_demo?: boolean;
};

export type PrecedentItem = {
  key: string;
  outcome: 'approved' | 'removed' | 'banned';
  excerpt: string;
  rule: string | null;
  mod_username: string | null;
  mod_reason: string | null;
  decided_at: number;
  similarity: number;
  is_demo?: boolean;
};

export type CrisisState = 'normal' | 'suspect' | 'active';

export type CrisisStatus = {
  state: CrisisState;
  since: number | null;
  trigger_reason: string | null;
};

export type DashboardSummary = {
  subreddit: string;
  username: string | null;
  is_moderator: boolean;
  queue_count: number;
  watchlist_count: number;
  audit_count_24h: number;
  crisis: CrisisStatus;
  daily_cost_usd: number;
  daily_cost_cap_usd: number;
  feature_arbiter: boolean;
  feature_sentinel: boolean;
  feature_crisis: boolean;
  feature_vision: boolean;
  feature_coach: boolean;
};

export type DashboardInitResponse = {
  type: 'dashboard_init';
  summary: DashboardSummary;
  queue: QueueItem[];
  watchlist: QueueItem[];
};

export type PrecedentResponse = {
  type: 'precedent';
  target_id: string;
  items: PrecedentItem[];
};

export type ActionRequest = {
  target_id: string;
  target_kind: 'post' | 'comment';
  action: 'approve' | 'remove' | 'ban' | 'skip';
  send_dm: boolean;
  dm_message: string | null;
};

export type ActionResponse = {
  type: 'action';
  target_id: string;
  action: ActionRequest['action'];
  ok: boolean;
  message: string;
};

export type ErrorResponse = {
  status: 'error';
  message: string;
};
