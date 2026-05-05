/**
 * Minimal Gemini client for Aegis. Calls the v1beta REST endpoint directly so
 * we don't pull in @google/generative-ai (avoids bundle bloat in the Devvit
 * server runtime).
 */

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

export const GEMINI_MODELS = {
  flashLite: 'gemini-3.1-flash-lite-preview',
  pro: 'gemini-3.1-pro-preview',
  embed: 'gemini-embedding-001',
} as const;

// gemini-embedding-001 supports 768/1536/3072 (Matryoshka). 768 keeps each
// stored vector at ~4KB base64, matching the PRD's Redis budget assumptions.
export const EMBEDDING_DIM = 768;

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

type EmbedOptions = {
  apiKey: string;
  text: string;
  taskType?:
    | 'SEMANTIC_SIMILARITY'
    | 'RETRIEVAL_DOCUMENT'
    | 'RETRIEVAL_QUERY'
    | 'CLASSIFICATION'
    | 'CLUSTERING';
};

export type EmbedResult = {
  embedding: Float32Array;
  latencyMs: number;
  model: string;
};

/**
 * Calls text-embedding-004 :embedContent for a single text. 768-dim float
 * output. Long inputs get clipped to ~8K chars to stay under the model's
 * 2048-token cap; longer items are exceptional in mod content.
 */
export async function generateEmbedding(opts: EmbedOptions): Promise<EmbedResult> {
  if (!opts.apiKey) {
    throw new GeminiError('Missing Gemini API key — set it in app settings', 401, false);
  }
  const text = opts.text.slice(0, 8000);
  if (!text.trim()) {
    throw new GeminiError('generateEmbedding called with empty text', undefined, false);
  }

  const url = `${GEMINI_BASE_URL}/${GEMINI_MODELS.embed}:embedContent?key=${encodeURIComponent(opts.apiKey)}`;
  const body = {
    model: `models/${GEMINI_MODELS.embed}`,
    content: { parts: [{ text }] },
    taskType: opts.taskType ?? 'SEMANTIC_SIMILARITY',
    outputDimensionality: EMBEDDING_DIM,
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
      `Embedding fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      undefined,
      true
    );
  }

  const latencyMs = Date.now() - startedAt;

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    const retryable = res.status === 429 || res.status >= 500;
    throw new GeminiError(
      `Embedding ${res.status}: ${errText.slice(0, 500)}`,
      res.status,
      retryable
    );
  }

  const json = (await res.json()) as { embedding?: { values?: number[] } };
  const values = json.embedding?.values;
  if (!values || values.length === 0) {
    throw new GeminiError('Embedding response missing values', res.status, true);
  }
  if (values.length !== EMBEDDING_DIM) {
    throw new GeminiError(
      `Embedding dim mismatch: got ${values.length} expected ${EMBEDDING_DIM}`,
      res.status,
      false
    );
  }

  return {
    embedding: Float32Array.from(values),
    latencyMs,
    model: GEMINI_MODELS.embed,
  };
}

/**
 * Wrapper that retries once on retryable errors with a stricter prompt.
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
