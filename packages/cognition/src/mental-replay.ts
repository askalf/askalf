/**
 * Mental Replays - Simulate alternate approaches
 *
 * Before committing to an action, the system can "imagine"
 * different approaches and evaluate their likely outcomes.
 *
 * This implements a form of planning by simulating futures.
 */

import { createLogger } from '@substrate/observability';
import { ProceduralShard } from '@substrate/core';
import { complete } from '@substrate/ai';
import { procedural } from '@substrate/memory';

const logger = createLogger({ component: 'mental-replay' });

export interface SimulatedApproach {
  id: string;
  description: string;
  method: 'shard' | 'llm' | 'hybrid' | 'decompose';
  shard?: ProceduralShard | undefined;
  estimatedTokens: number;
  estimatedLatencyMs: number;
  confidenceScore: number;
  riskFactors: string[];
  benefits: string[];
}

export interface ReplayResult {
  bestApproach: SimulatedApproach;
  alternatives: SimulatedApproach[];
  reasoning: string;
  totalSimulationMs: number;
}

/**
 * Simulate possible approaches for a given input
 */
export async function simulateApproaches(
  input: string,
  availableShards: ProceduralShard[],
  options?: {
    maxApproaches?: number;
    includeDecomposition?: boolean;
  }
): Promise<SimulatedApproach[]> {
  const approaches: SimulatedApproach[] = [];
  const maxApproaches = options?.maxApproaches ?? 5;

  // Approach 1: Direct shard execution (if matching shards exist)
  for (const shard of availableShards.slice(0, 3)) {
    approaches.push({
      id: `shard-${shard.id}`,
      description: `Execute shard: ${shard.name}`,
      method: 'shard',
      shard,
      estimatedTokens: 0, // Shards don't use tokens
      estimatedLatencyMs: shard.avgLatencyMs || 10,
      confidenceScore: shard.confidence,
      riskFactors: shard.confidence < 0.7 ? ['Low confidence shard'] : [],
      benefits: ['No token cost', 'Fast execution', 'Deterministic'],
    });
  }

  // Approach 2: Direct LLM call
  approaches.push({
    id: 'llm-direct',
    description: 'Generate response with LLM',
    method: 'llm',
    estimatedTokens: estimateTokens(input) + 200, // Input + expected output
    estimatedLatencyMs: 2000,
    confidenceScore: 0.9, // LLMs are generally capable
    riskFactors: ['Token cost', 'Variable latency', 'No learning'],
    benefits: ['Handles novel inputs', 'High quality'],
  });

  // Approach 3: Hybrid - shard with LLM fallback
  const bestShard = availableShards[0];
  if (bestShard) {
    approaches.push({
      id: 'hybrid-fallback',
      description: `Try shard ${bestShard.name}, fallback to LLM`,
      method: 'hybrid',
      shard: bestShard,
      estimatedTokens: bestShard.confidence < 0.7 ? estimateTokens(input) + 200 : 0,
      estimatedLatencyMs: bestShard.avgLatencyMs + (bestShard.confidence < 0.7 ? 2000 : 0),
      confidenceScore: Math.max(bestShard.confidence, 0.9),
      riskFactors: ['Additional latency on fallback'],
      benefits: ['Best of both worlds', 'Learning opportunity'],
    });
  }

  // Approach 4: Decomposition (if enabled)
  if (options?.includeDecomposition) {
    const complexity = estimateComplexity(input);
    if (complexity > 0.5) {
      approaches.push({
        id: 'decompose',
        description: 'Break into subtasks and solve individually',
        method: 'decompose',
        estimatedTokens: estimateTokens(input) * 2, // More tokens for planning
        estimatedLatencyMs: 3000,
        confidenceScore: 0.85,
        riskFactors: ['Higher latency', 'More complex orchestration'],
        benefits: ['Better for complex tasks', 'Modular execution'],
      });
    }
  }

  return approaches.slice(0, maxApproaches);
}

/**
 * Run mental replay to choose best approach
 */
export async function runMentalReplay(
  input: string,
  options?: {
    prioritizeSpeed?: boolean;
    prioritizeAccuracy?: boolean;
    maxTokenBudget?: number;
  }
): Promise<ReplayResult> {
  const startTime = Date.now();

  // Find available shards
  const matchingShards = await procedural.findSimilarShards(input, 5);

  // Generate possible approaches
  const approaches = await simulateApproaches(input, matchingShards, {
    maxApproaches: 5,
    includeDecomposition: true,
  });

  // Score each approach based on priorities
  const scoredApproaches = approaches.map(approach => {
    let score = approach.confidenceScore;

    // Adjust for speed priority
    if (options?.prioritizeSpeed) {
      score -= approach.estimatedLatencyMs / 10000; // Penalty for slow
    }

    // Adjust for accuracy priority
    if (options?.prioritizeAccuracy) {
      score += approach.method === 'llm' ? 0.1 : 0;
    }

    // Adjust for token budget
    if (options?.maxTokenBudget && approach.estimatedTokens > options.maxTokenBudget) {
      score -= 0.5; // Heavy penalty for over budget
    }

    // Bonus for zero-token approaches
    if (approach.estimatedTokens === 0) {
      score += 0.15;
    }

    return { ...approach, score };
  });

  // Sort by score
  scoredApproaches.sort((a, b) => (b as SimulatedApproach & { score: number }).score - (a as SimulatedApproach & { score: number }).score);

  const bestApproach = scoredApproaches[0] ?? {
    id: 'fallback',
    description: 'No approaches available',
    method: 'llm' as const,
    estimatedTokens: 0,
    estimatedLatencyMs: 0,
    confidenceScore: 0,
    riskFactors: [],
    benefits: [],
  };
  const alternatives = scoredApproaches.slice(1);

  const totalSimulationMs = Date.now() - startTime;

  logger.debug({
    input: input.substring(0, 50),
    bestApproach: bestApproach.id,
    approachCount: approaches.length,
    simulationMs: totalSimulationMs,
  }, 'Mental replay complete');

  return {
    bestApproach,
    alternatives,
    reasoning: generateReasoning(bestApproach, alternatives, options),
    totalSimulationMs,
  };
}

/**
 * Counterfactual analysis - what if we had done it differently?
 */
export async function analyzeCounterfactual(
  input: string,
  chosenApproach: SimulatedApproach,
  actualOutput: string,
  actualSuccess: boolean
): Promise<{
  alternativeOutcomes: Array<{
    approach: SimulatedApproach;
    likelyBetter: boolean;
    reasoning: string;
  }>;
  lessonLearned: string;
}> {
  const alternatives = await simulateApproaches(input, [], { maxApproaches: 3 });
  const filteredAlternatives = alternatives.filter(a => a.id !== chosenApproach.id);

  const alternativeOutcomes = filteredAlternatives.map(alt => {
    const likelyBetter = !actualSuccess && alt.confidenceScore > chosenApproach.confidenceScore;

    return {
      approach: alt,
      likelyBetter,
      reasoning: likelyBetter
        ? `Alternative ${alt.id} might have succeeded with confidence ${alt.confidenceScore.toFixed(2)}`
        : `Chosen approach was appropriate`,
    };
  });

  const lessonLearned = actualSuccess
    ? `Approach ${chosenApproach.id} worked well for input pattern`
    : `Consider ${alternativeOutcomes.find(a => a.likelyBetter)?.approach.id || 'different approach'} next time`;

  return { alternativeOutcomes, lessonLearned };
}

/**
 * Estimate token count for input
 */
function estimateTokens(text: string): number {
  // Rough estimation: ~4 chars per token
  return Math.ceil(text.length / 4);
}

/**
 * Estimate task complexity (0-1)
 */
function estimateComplexity(input: string): number {
  let complexity = 0;

  // Length factor
  if (input.length > 500) complexity += 0.2;
  if (input.length > 1000) complexity += 0.2;

  // Multiple sentences/steps
  const sentences = input.split(/[.!?]+/).length;
  if (sentences > 3) complexity += 0.2;

  // Contains code
  if (/```|function|const|let|var|class/.test(input)) complexity += 0.2;

  // Contains multiple questions
  const questions = input.split('?').length - 1;
  if (questions > 1) complexity += 0.1;

  // Contains conditional language
  if (/if|when|unless|otherwise/.test(input)) complexity += 0.1;

  return Math.min(complexity, 1);
}

/**
 * Generate human-readable reasoning for approach selection
 */
function generateReasoning(
  best: SimulatedApproach,
  alternatives: SimulatedApproach[],
  options?: { prioritizeSpeed?: boolean; prioritizeAccuracy?: boolean }
): string {
  const parts: string[] = [];

  parts.push(`Selected ${best.method} approach: ${best.description}`);

  if (best.method === 'shard') {
    parts.push(`Using crystallized knowledge (confidence: ${best.confidenceScore.toFixed(2)}, no token cost)`);
  } else if (best.method === 'llm') {
    parts.push(`Using LLM for flexibility (estimated ${best.estimatedTokens} tokens)`);
  } else if (best.method === 'hybrid') {
    parts.push(`Combining shard speed with LLM fallback safety`);
  }

  if (options?.prioritizeSpeed) {
    parts.push(`Prioritized low latency (est. ${best.estimatedLatencyMs}ms)`);
  }

  if (alternatives.length > 0) {
    parts.push(`Considered ${alternatives.length} alternatives`);
  }

  return parts.join('. ');
}
