/**
 * Shard Classifier (Layer 3)
 *
 * Uses a nano-tier LLM to determine whether a shard can accurately answer a query.
 * Replaces the brittle regex/embedding matching with semantic understanding.
 *
 * Shadow Mode: Runs alongside existing matching, logs agreement/disagreement,
 * but does NOT override the existing decision. Flip `shadowMode: false` to activate.
 */

import { complete } from './index.js';
import { createLogger } from '@substrate/observability';

const logger = createLogger({ component: 'shard-classifier' });

export interface ShardCandidate {
  id: string;
  name: string;
  description?: string | undefined;
  patterns: string[];
  intentTemplate?: string | undefined;
  knowledgeType?: string | undefined;
  confidence: number;
  similarity?: number | undefined;
}

export interface ClassificationResult {
  bestMatch: ShardCandidate | null;
  confidence: number;
  reason: string;
  allScores: Array<{ shardId: string; score: number; reasoning: string }>;
  latencyMs: number;
}

export interface ClassifierConfig {
  model: string;
  maxTokens: number;
  shadowMode: boolean;
  maxCandidates: number;
  minConfidence: number;
}

const DEFAULT_CLASSIFIER_CONFIG: ClassifierConfig = {
  model: 'claude-haiku-4-5',
  maxTokens: 256,
  shadowMode: true,       // Start in shadow mode — log only, don't override
  maxCandidates: 5,
  minConfidence: 0.7,
};

/**
 * Classify whether any shard candidate can accurately answer the query.
 *
 * Returns the best matching shard with confidence score, or null if no shard
 * can answer the query.
 */
export async function classifyShardMatch(
  query: string,
  candidates: ShardCandidate[],
  config: Partial<ClassifierConfig> = {}
): Promise<ClassificationResult> {
  const cfg = { ...DEFAULT_CLASSIFIER_CONFIG, ...config };
  const start = Date.now();

  if (candidates.length === 0) {
    return {
      bestMatch: null,
      confidence: 0,
      reason: 'no_candidates',
      allScores: [],
      latencyMs: Date.now() - start,
    };
  }

  // Limit candidates to prevent token bloat
  const topCandidates = candidates.slice(0, cfg.maxCandidates);

  // Build the classification prompt
  const prompt = buildClassificationPrompt(query, topCandidates);

  try {
    const response = await complete(prompt, {
      model: cfg.model,
      maxTokens: cfg.maxTokens,
      temperature: 0,
      systemPrompt: CLASSIFIER_SYSTEM_PROMPT,
    });

    const result = parseClassifierResponse(response, topCandidates);
    result.latencyMs = Date.now() - start;

    logger.info({
      query: query.substring(0, 100),
      candidateCount: topCandidates.length,
      bestMatch: result.bestMatch?.name || 'none',
      confidence: result.confidence,
      latencyMs: result.latencyMs,
      shadowMode: cfg.shadowMode,
    }, 'Shard classification complete');

    return result;

  } catch (err) {
    logger.error({
      error: err instanceof Error ? err.message : String(err),
      query: query.substring(0, 100),
    }, 'Shard classification failed');

    return {
      bestMatch: null,
      confidence: 0,
      reason: 'classification_error',
      allScores: [],
      latencyMs: Date.now() - start,
    };
  }
}

/**
 * Shadow mode comparison: Compare classifier result with existing match decision.
 * Logs agreement/disagreement for analysis.
 */
export function logShadowComparison(
  query: string,
  existingMatch: { shardId: string; shardName: string; method: string } | null,
  classifierResult: ClassificationResult
): void {
  const existingId = existingMatch?.shardId || 'none';
  const classifierId = classifierResult.bestMatch?.id || 'none';
  const agreed = existingId === classifierId;

  logger.info({
    query: query.substring(0, 100),
    existingMatch: existingMatch ? { id: existingId, name: existingMatch.shardName, method: existingMatch.method } : null,
    classifierMatch: classifierResult.bestMatch ? { id: classifierId, name: classifierResult.bestMatch.name, confidence: classifierResult.confidence } : null,
    agreed,
    classifierReason: classifierResult.reason,
    classifierLatencyMs: classifierResult.latencyMs,
  }, agreed ? 'Shadow classifier AGREES with existing match' : 'Shadow classifier DISAGREES with existing match');
}

const CLASSIFIER_SYSTEM_PROMPT = `You are a knowledge shard router. Given a user query and a list of available knowledge shards, determine which shard (if any) can accurately and completely answer the query.

Rules:
- Only match if the shard DIRECTLY answers the query. Do not match tangentially related shards.
- A shard that answers "what is 2+2" should NOT match "what is the meaning of life" just because both are questions.
- Consider the shard's name, patterns, and description to determine relevance.
- If no shard can answer the query, respond with NONE.
- Be strict: it's better to say NONE than to match an incorrect shard.

Response format (strict):
MATCH: <shard_index> | CONFIDENCE: <0.0-1.0> | REASON: <brief explanation>

Or if no shard matches:
NONE | REASON: <brief explanation>`;

function buildClassificationPrompt(query: string, candidates: ShardCandidate[]): string {
  let prompt = `User query: "${query}"\n\nAvailable shards:\n`;

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]!;
    prompt += `\n[${i}] ${c.name}`;
    if (c.intentTemplate) {
      prompt += `\n    Intent: ${c.intentTemplate}`;
    }
    if (c.patterns.length > 0) {
      prompt += `\n    Patterns: ${c.patterns.slice(0, 5).join(', ')}`;
    }
    if (c.knowledgeType) {
      prompt += `\n    Type: ${c.knowledgeType}`;
    }
  }

  prompt += `\n\nWhich shard (if any) can accurately answer this query?`;
  return prompt;
}

function parseClassifierResponse(
  response: string,
  candidates: ShardCandidate[]
): ClassificationResult {
  const normalized = response.trim();

  // Check for NONE response
  if (normalized.startsWith('NONE')) {
    const reasonMatch = normalized.match(/REASON:\s*(.+)/i);
    return {
      bestMatch: null,
      confidence: 0,
      reason: reasonMatch?.[1]?.trim() || 'no_match',
      allScores: [],
      latencyMs: 0,
    };
  }

  // Parse MATCH response
  const matchPattern = /MATCH:\s*(\d+)\s*\|\s*CONFIDENCE:\s*([\d.]+)\s*\|\s*REASON:\s*(.+)/i;
  const match = normalized.match(matchPattern);

  if (match) {
    const index = parseInt(match[1]!, 10);
    const confidence = parseFloat(match[2]!);
    const reason = match[3]!.trim();

    if (index >= 0 && index < candidates.length) {
      return {
        bestMatch: candidates[index]!,
        confidence: Math.min(1, Math.max(0, confidence)),
        reason,
        allScores: [{ shardId: candidates[index]!.id, score: confidence, reasoning: reason }],
        latencyMs: 0,
      };
    }
  }

  // Failed to parse — treat as no match
  logger.warn({ response: normalized.substring(0, 200) }, 'Failed to parse classifier response');
  return {
    bestMatch: null,
    confidence: 0,
    reason: 'parse_error',
    allScores: [],
    latencyMs: 0,
  };
}
