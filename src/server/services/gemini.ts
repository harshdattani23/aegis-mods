/**
 * Minimal Gemini client for Aegis. Calls the v1beta REST endpoint directly so
 * we don't pull in @google/generative-ai (avoids bundle bloat in the Devvit
 * server runtime).
 *
 * Day 1: triage-only. Vision and embeddings get added in later phases.
 */

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

export const GEMINI_MODELS = {
  flashLite: 'gemini-3.1-flash-lite-preview',
  pro: 'gemini-2.5-pro',
  embed: 'text-embedding-004',
} as const;

type ResponseSchema = {
  type: string;
  properties?: Record<string, unknown>;
  required?: string[];
  enum?: string[];
  items?: unknown;
};

type GenerateOptions = {
  model: string;
  apiKey: string;
  prompt: string;
  responseSchema?: ResponseSchema;
  temperature?: number;
  maxOutputTokens?: number;
  systemInstruction?: string;
};

type GenerateResult<T> = {
  data: T;
  rawText: string;
  latencyMs: number;
  model: string;
};

export class GeminiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly retryable: boolean = false
  ) {
    super(message);
    this.name = 'GeminiError';
  }
}

export async function generateJson<T>(opts: GenerateOptions): Promise<GenerateResult<T>> {
  if (!opts.apiKey) {
    throw new GeminiError('Missing Gemini API key — set it in app settings', 401, false);
  }

  const url = `${GEMINI_BASE_URL}/${opts.model}:generateContent?key=${encodeURIComponent(opts.apiKey)}`;

  const body = {
    ...(opts.systemInstruction
      ? { systemInstruction: { parts: [{ text: opts.systemInstruction }] } }
      : {}),
    contents: [{ role: 'user', parts: [{ text: opts.prompt }] }],
    generationConfig: {
      temperature: opts.temperature ?? 0.2,
      maxOutputTokens: opts.maxOutputTokens ?? 1024,
      responseMimeType: 'application/json',
      ...(opts.responseSchema ? { responseSchema: opts.responseSchema } : {}),
    },
  };

  const startedAt = Date.now();
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new GeminiError(
      `Gemini fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      undefined,
      true
    );
  }

  const latencyMs = Date.now() - startedAt;

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const retryable = res.status === 429 || res.status >= 500;
    throw new GeminiError(`Gemini ${res.status}: ${text.slice(0, 500)}`, res.status, retryable);
  }

  const json = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    promptFeedback?: unknown;
  };

  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new GeminiError('Gemini returned no text', res.status, true);
  }

  let parsed: T;
  try {
    parsed = JSON.parse(text) as T;
  } catch {
    throw new GeminiError(
      `Gemini returned non-JSON despite responseMimeType=application/json: ${text.slice(0, 300)}`,
      undefined,
      true
    );
  }

  return { data: parsed, rawText: text, latencyMs, model: opts.model };
}

/**
 * Wrapper that retries once on retryable errors with a stricter prompt.
 * Day 1: simple. Day 2+ may add exponential backoff per spike findings.
 */
export async function generateJsonWithRetry<T>(opts: GenerateOptions): Promise<GenerateResult<T>> {
  try {
    return await generateJson<T>(opts);
  } catch (err) {
    if (err instanceof GeminiError && err.retryable) {
      const stricter: GenerateOptions = {
        ...opts,
        prompt:
          opts.prompt +
          '\n\nIMPORTANT: Output ONLY the JSON object matching the schema. No prose, no markdown fences, no explanation outside the JSON.',
        temperature: 0.1,
      };
      return await generateJson<T>(stricter);
    }
    throw err;
  }
}
