/**
 * Forge Embedding Adapter
 * Generates vector embeddings for memory storage and similarity search.
 * Uses OpenAI text-embedding-3-small (1536 dimensions).
 */

import { loadConfig } from '../config.js';

const ZERO_VECTOR = new Array(1536).fill(0);

/** Per-attempt timeout for the OpenAI embedding API call. */
const EMBED_FETCH_TIMEOUT_MS = 5_000;
/** Max attempts before falling back to zero vector. */
const EMBED_MAX_ATTEMPTS = 2;
/** Delay between retry attempts (ms). */
const EMBED_RETRY_DELAY_MS = 500;

function getApiKey(): string | null {
  const cfg = loadConfig();
  const apiKey = cfg.openaiApiKey;
  if (!apiKey) {
    console.warn('[Memory] No OPENAI_API_KEY — embeddings will use zero vectors (no similarity search)');
    return null;
  }
  return apiKey;
}

async function fetchEmbedding(text: string, apiKey: string): Promise<number[]> {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input: text,
      model: 'text-embedding-3-small',
      dimensions: 1536,
    }),
    signal: AbortSignal.timeout(EMBED_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI embedding error ${res.status}: ${body.substring(0, 200)}`);
  }
  const json = await res.json() as { data: Array<{ embedding: number[] }> };
  return json.data[0]?.embedding ?? ZERO_VECTOR;
}

/**
 * Generate a 1536-dimension embedding for the given text.
 * Falls back to a zero vector if OpenAI is unavailable or times out.
 * Each attempt is bounded to EMBED_FETCH_TIMEOUT_MS; retries up to EMBED_MAX_ATTEMPTS times.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const apiKey = getApiKey();
  if (!apiKey) return ZERO_VECTOR;

  const truncated = text.substring(0, 8000);

  for (let attempt = 1; attempt <= EMBED_MAX_ATTEMPTS; attempt++) {
    try {
      return await fetchEmbedding(truncated, apiKey);
    } catch (err) {
      const isLast = attempt === EMBED_MAX_ATTEMPTS;
      const msg = err instanceof Error ? err.message : String(err);
      if (isLast) {
        console.warn(`[Memory] Embedding generation failed after ${EMBED_MAX_ATTEMPTS} attempts: ${msg}`);
        return ZERO_VECTOR;
      }
      console.warn(`[Memory] Embedding attempt ${attempt} failed (retrying in ${EMBED_RETRY_DELAY_MS}ms): ${msg}`);
      await new Promise((r) => setTimeout(r, EMBED_RETRY_DELAY_MS));
    }
  }

  return ZERO_VECTOR;
}
