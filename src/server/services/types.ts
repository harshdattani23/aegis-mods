export type Verdict = 'approve' | 'remove' | 'ban' | 'escalate';

export type Severity = 1 | 2 | 3 | 4 | 5;

export type Autonomy = 'advisory' | 'assisted' | 'autonomous';

export type TriageInput = {
  kind: 'post' | 'comment';
  id: string;
  body: string;
  title?: string;
  authorUsername: string;
  authorKarma?: number;
  authorAccountAgeDays?: number;
  reports?: string[];
};

export type TriageResult = {
  verdict: Verdict;
  confidence: number;
  rule_violated: string | null;
  severity: number;
  reasoning: string;
  removal_message_draft: string | null;
  precedent_cited?: string | null;
  model: string;
  latency_ms: number;
};

export type AegisSettings = {
  rules: string;
  autonomy: Autonomy;
  confidence_threshold: number;
  severity_threshold: number;
  daily_cost_cap_usd: number;
  feature_arbiter: boolean;
  feature_sentinel: boolean;
  feature_crisis: boolean;
  feature_vision: boolean;
  feature_coach: boolean;
};

export type GlobalSettings = {
  gemini_api_key: string;
};
