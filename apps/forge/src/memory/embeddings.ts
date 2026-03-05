/**
 * Forge Embedding Adapter
 * Generates vector embeddings for memory storage and similarity search.
 * Uses OpenAI text-embedding-3-small (1536 dimensions).
 */

import { loadConfig } from '../config.js';

// ---------------------------------------------------------------------------
// Concurrency limiter — prevents saturating the embedding API when multiple
// agents are dispatched simultaneously (e.g. during batch dispatch cycles).
// ---------------------------------------------------------------------------
const MAX_CONCURRENT_EMBEDS = 3;
let inflight = 0;
const waitQueue: Array<() => void> = [];

async function withConcurrencyLimit<T>(fn: () => Promise<T>): Promise<T> {
  if (inflight >= MAX_CONCURRENT_EMBEDS) {
    await new Promise<void>((resolve) => waitQueue.push(resolve));
  }
  inflight++;
  try {
    return await fn();
  } finally {
    inflight--;
    waitQueue.shift()?.();
  }
}

let openaiClient: { embeddings: { create: (params: unknown) => Promise<{ data: Array<{ embedding: number[] }> }> } } | null = null;

function getOpenAIClient() {
  if (openaiClient) return openaiClient;

  const cfg = loadConfig();
  const apiKey = cfg.openaiApiKey;
  if (!apiKey) {
    console.warn('[Memory] No OPENAI_API_KEY — embeddings will use zero vectors (no similarity search)');
    return null;
  }

  // Dynamic import avoided — use fetch-based approach for minimal footprint
  openaiClient = {
    embeddings: {
      create: async (params: unknown) => {
        const p = params as { input: string | string[]; model: string; dimensions: number };
        const body = JSON.stringify({ input: p.input, model: p.model, dimensions: p.dimensions });
        const headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };

        // Per-fetch timeout: 10s. Retry once with 500ms backoff on transient errors.
        const doFetch = async (attempt: number): Promise<Response> => {
          try {
            return await fetch('https://api.openai.com/v1/embeddings', {
              method: 'POST',
              headers,
              body,
              signal: AbortSignal.timeout(10_000),
            });
          } catch (err) {
            if (attempt === 0 && (err instanceof Error) && (err.name === 'TimeoutError' || err.name === 'AbortError' || err.message.includes('fetch failed'))) {
              await new Promise((r) => setTimeout(r, 500));
              return doFetch(1);
            }
            throw err;
          }
        };

        const res = await doFetch(0);
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`OpenAI embedding error ${res.status}: ${text.substring(0, 200)}`);
        }
        return res.json() as Promise<{ data: Array<{ embedding: number[] }> }>;
      },
    },
  };

  return openaiClient;
}

const ZERO_VECTOR = new Array(1536).fill(0);

/**
 * Generate a 1536-dimension embedding for the given text.
 * Falls back to a zero vector if OpenAI is unavailable.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const client = getOpenAIClient();
  if (!client) return ZERO_VECTOR;

  return withConcurrencyLimit(async () => {
    try {
      const truncated = text.substring(0, 8000);
      const response = await client.embeddings.create({
        input: truncated,
        model: 'text-embedding-3-small',
        dimensions: 1536,
      });
      return response.data[0]?.embedding ?? ZERO_VECTOR;
    } catch (err) {
      console.warn('[Memory] Embedding generation failed:', err instanceof Error ? err.message : err);
      return ZERO_VECTOR;
    }
  });
}
