/**
 * Triage orchestrator. Takes a piece of content + sub context, returns a verdict.
 *
 * Day 1: rules + content → verdict. No memory, no calibration.
 * Day 4+: layers in precedent retrieval (Memory) and override-based few-shot.
 */

import { settings } from '@devvit/web/server';
import { generateJsonWithRetry, GEMINI_MODELS } from './gemini';
import type { TriageInput, TriageResult, AegisSettings } from './types';

const TRIAGE_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['approve', 'remove', 'ban', 'escalate'] },
    confidence: { type: 'number' },
    rule_violated: { type: 'string' },
    severity: { type: 'integer' },
    reasoning: { type: 'string' },
    removal_message_draft: { type: 'string' },
  },
  required: ['verdict', 'confidence', 'severity', 'reasoning'],
};

const SYSTEM_INSTRUCTION = `You are Aegis, a Reddit moderation assistant. Decide an action for a piece of content based strictly on the subreddit rules provided. Be conservative: when uncertain, prefer "escalate" over "remove" or "ban". Output strict JSON matching the response schema. Reasoning must be <60 words and reference the specific rule clause when applicable.`;

function buildPrompt(input: TriageInput, rules: string): string {
  const lines: string[] = [];
  lines.push('SUBREDDIT RULES:');
  lines.push(rules || '(no rules configured — use general Reddit content policy)');
  lines.push('');
  lines.push(`CONTENT TYPE: ${input.kind}`);
  if (input.title) lines.push(`TITLE: ${input.title}`);
  lines.push(`AUTHOR: u/${input.authorUsername}`);
  if (typeof input.authorAccountAgeDays === 'number') {
    lines.push(`AUTHOR ACCOUNT AGE (days): ${input.authorAccountAgeDays}`);
  }
  if (typeof input.authorKarma === 'number') {
    lines.push(`AUTHOR KARMA: ${input.authorKarma}`);
  }
  if (input.reports && input.reports.length > 0) {
    lines.push('REPORTS:');
    for (const r of input.reports) lines.push(`- ${r}`);
  }
  lines.push('');
  lines.push('CONTENT:');
  lines.push(input.body || '(empty)');
  lines.push('');
  lines.push('Return JSON with: verdict (approve|remove|ban|escalate), confidence (0-1), rule_violated (rule id or null), severity (1-5), reasoning (<60 words), removal_message_draft (string or null — written to the user, only if verdict is remove or ban).');
  return lines.join('\n');
}

export async function getAegisSettings(): Promise<AegisSettings> {
  const all = await settings.getAll<Partial<AegisSettings>>();
  return {
    rules: typeof all.rules === 'string' ? all.rules : '',
    autonomy: (all.autonomy as AegisSettings['autonomy']) ?? 'advisory',
    confidence_threshold: typeof all.confidence_threshold === 'number' ? all.confidence_threshold : 0.85,
    severity_threshold: typeof all.severity_threshold === 'number' ? all.severity_threshold : 4,
    daily_cost_cap_usd: typeof all.daily_cost_cap_usd === 'number' ? all.daily_cost_cap_usd : 5,
    feature_arbiter: all.feature_arbiter !== false,
    feature_sentinel: all.feature_sentinel !== false,
    feature_crisis: all.feature_crisis !== false,
    feature_vision: all.feature_vision !== false,
    feature_coach: all.feature_coach === true,
  };
}

export async function getGeminiApiKey(): Promise<string> {
  const key = await settings.get<string>('gemini_api_key');
  if (!key) {
    throw new Error('Gemini API key not configured. Set it in app settings.');
  }
  return key;
}

export async function triage(input: TriageInput): Promise<TriageResult> {
  const cfg = await getAegisSettings();
  const apiKey = await getGeminiApiKey();
  const prompt = buildPrompt(input, cfg.rules);

  const result = await generateJsonWithRetry<{
    verdict: TriageResult['verdict'];
    confidence: number;
    rule_violated?: string | null;
    severity: number;
    reasoning: string;
    removal_message_draft?: string | null;
  }>({
    model: GEMINI_MODELS.flashLite,
    apiKey,
    systemInstruction: SYSTEM_INSTRUCTION,
    prompt,
    responseSchema: TRIAGE_RESPONSE_SCHEMA,
    temperature: 0.2,
    maxOutputTokens: 512,
  });

  const data = result.data;
  return {
    verdict: data.verdict,
    confidence: clamp01(data.confidence),
    rule_violated: data.rule_violated ?? null,
    severity: clampInt(data.severity, 1, 5),
    reasoning: data.reasoning,
    removal_message_draft: data.removal_message_draft ?? null,
    precedent_cited: null,
    model: result.model,
    latency_ms: result.latencyMs,
  };
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function clampInt(n: number, min: number, max: number): number {
  const v = Math.round(n);
  if (Number.isNaN(v)) return min;
  return Math.max(min, Math.min(max, v));
}
