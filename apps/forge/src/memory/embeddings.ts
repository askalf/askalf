/**
 * Forge Embedding Adapter
 * Generates vector embeddings for memory storage and similarity search.
 * Uses OpenAI text-embedding-3-small (1536 dimensions).
 */

import { loadConfig } from '../config.js';

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
        const res = await fetch('https://api.openai.com/v1/embeddings', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            input: p.input,
            model: p.model,
            dimensions: p.dimensions,
          }),
        });
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
}
