/**
 * Metacognition - The thinking about thinking layer
 *
 * Orchestrates all cognitive features:
 * - Pre-flight checks via audit gates
 * - Strategy selection via mental replays
 * - Post-execution reflection
 * - Learning extraction
 */

import { createLogger } from '@substrate/observability';
import { ProceduralShard } from '@substrate/core';
import { runPreExecutionGates, runPostExecutionGates, AuditResult } from './audit-gates.js';
import { runMentalReplay, SimulatedApproach, analyzeCounterfactual } from './mental-replay.js';
import { liquidateHeuristic, ExtractedFact } from './context-liquidation.js';

const logger = createLogger({ component: 'metacognition' });

export interface CognitionPlan {
  strategy: SimulatedApproach;
  preFlightResults: AuditResult[];
  passed: boolean;
  reasoning: string;
  fallbackStrategy?: SimulatedApproach | undefined;
}

export interface ExecutionReflection {
  success: boolean;
  postFlightResults: AuditResult[];
  extractedFacts: ExtractedFact[];
  lessonLearned: string;
  shouldRecordTrace: boolean;
  confidenceAdjustment: number;
}

export interface CognitiveState {
  currentInput?: string | undefined;
  currentStrategy?: SimulatedApproach | undefined;
  executionHistory: Array<{
    input: string;
    output: string;
    strategy: string;
    success: boolean;
    timestamp: Date;
  }>;
  accumulatedLessons: string[];
  workingFacts: ExtractedFact[];
}

/**
 * Create a new cognitive state
 */
export function createCognitiveState(): CognitiveState {
  return {
    executionHistory: [],
    accumulatedLessons: [],
    workingFacts: [],
  };
}

/**
 * Plan execution strategy with metacognitive analysis
 */
export async function planExecution(
  input: string,
  shard?: ProceduralShard,
  options?: {
    prioritizeSpeed?: boolean;
    prioritizeAccuracy?: boolean;
    maxTokenBudget?: number;
  }
): Promise<CognitionPlan> {
  logger.debug({ input: input.substring(0, 50) }, 'Planning execution');

  // Step 1: Run mental replay to evaluate approaches
  const replay = await runMentalReplay(input, options);
  const strategy = replay.bestApproach;

  // Step 2: Run pre-flight audit gates
  const auditContext = {
    input,
    shard: strategy.shard,
  };

  const { passed, results: preFlightResults } = await runPreExecutionGates(auditContext);

  // Step 3: Determine fallback if primary strategy has risk
  let fallbackStrategy: SimulatedApproach | undefined;
  if (!passed || strategy.confidenceScore < 0.7) {
    fallbackStrategy = replay.alternatives.find(alt =>
      alt.method === 'llm' || alt.confidenceScore > strategy.confidenceScore
    );
  }

  const plan: CognitionPlan = {
    strategy,
    preFlightResults,
    passed,
    reasoning: replay.reasoning,
    fallbackStrategy,
  };

  logger.info({
    strategy: strategy.id,
    passed,
    hasFallback: !!fallbackStrategy,
    confidence: strategy.confidenceScore,
  }, 'Execution plan created');

  return plan;
}

/**
 * Reflect on execution results
 */
export async function reflectOnExecution(
  input: string,
  output: string,
  executionMs: number,
  strategy: SimulatedApproach,
  success: boolean
): Promise<ExecutionReflection> {
  logger.debug({ success, strategy: strategy.id }, 'Reflecting on execution');

  // Step 1: Run post-execution audit gates
  const auditContext = {
    input,
    output,
    executionMs,
    shard: strategy.shard,
  };

  const { passed: postPassed, results: postFlightResults } = await runPostExecutionGates(auditContext);

  // Step 2: Extract facts from the interaction
  const interactionText = `Input: ${input}\nOutput: ${output}`;
  const liquidation = liquidateHeuristic(interactionText);

  // Step 3: Analyze counterfactual (what if we did it differently?)
  const counterfactual = await analyzeCounterfactual(input, strategy, output, success);

  // Step 4: Determine if this should become a trace
  const shouldRecordTrace =
    success &&
    postPassed &&
    strategy.method !== 'shard' && // Don't re-record shard executions
    input.length > 20 && // Meaningful input
    output.length > 10; // Meaningful output

  // Step 5: Calculate confidence adjustment
  let confidenceAdjustment = 0;
  if (strategy.shard) {
    if (success && postPassed) {
      confidenceAdjustment = 0.008; // Successful execution boosts confidence
    } else if (!success) {
      confidenceAdjustment = -0.015; // Failure decreases confidence
    }
  }

  const reflection: ExecutionReflection = {
    success: success && postPassed,
    postFlightResults,
    extractedFacts: liquidation.facts,
    lessonLearned: counterfactual.lessonLearned,
    shouldRecordTrace,
    confidenceAdjustment,
  };

  logger.info({
    finalSuccess: reflection.success,
    factsExtracted: liquidation.facts.length,
    shouldRecord: shouldRecordTrace,
    lesson: counterfactual.lessonLearned.substring(0, 50),
  }, 'Reflection complete');

  return reflection;
}

/**
 * Update cognitive state after execution
 */
export function updateCognitiveState(
  state: CognitiveState,
  input: string,
  output: string,
  strategy: SimulatedApproach,
  reflection: ExecutionReflection
): CognitiveState {
  return {
    ...state,
    currentInput: undefined,
    currentStrategy: undefined,
    executionHistory: [
      ...state.executionHistory.slice(-99), // Keep last 100
      {
        input,
        output,
        strategy: strategy.id,
        success: reflection.success,
        timestamp: new Date(),
      },
    ],
    accumulatedLessons: [
      ...state.accumulatedLessons.slice(-49), // Keep last 50
      reflection.lessonLearned,
    ],
    workingFacts: [
      ...state.workingFacts.slice(-99), // Keep last 100
      ...reflection.extractedFacts,
    ],
  };
}

/**
 * Calculate overall system health metrics
 */
export function calculateSystemHealth(state: CognitiveState): {
  successRate: number;
  averageConfidence: number;
  factDensity: number;
  learningVelocity: number;
} {
  const recentHistory = state.executionHistory.slice(-20);

  const successRate = recentHistory.length > 0
    ? recentHistory.filter(h => h.success).length / recentHistory.length
    : 0;

  // Estimate confidence from success rate
  const averageConfidence = successRate * 0.9 + 0.1;

  // Fact density: facts per execution
  const factDensity = state.executionHistory.length > 0
    ? state.workingFacts.length / state.executionHistory.length
    : 0;

  // Learning velocity: new lessons per recent executions
  const recentLessons = state.accumulatedLessons.slice(-10);
  const uniqueLessons = new Set(recentLessons).size;
  const learningVelocity = recentLessons.length > 0
    ? uniqueLessons / recentLessons.length
    : 0;

  return {
    successRate,
    averageConfidence,
    factDensity,
    learningVelocity,
  };
}

/**
 * Self-diagnostic: identify areas needing improvement
 */
export function runSelfDiagnostic(state: CognitiveState): {
  issues: string[];
  recommendations: string[];
} {
  const health = calculateSystemHealth(state);
  const issues: string[] = [];
  const recommendations: string[] = [];

  if (health.successRate < 0.7) {
    issues.push(`Low success rate: ${(health.successRate * 100).toFixed(0)}%`);
    recommendations.push('Consider adjusting shard selection thresholds');
    recommendations.push('Increase LLM fallback usage');
  }

  if (health.factDensity < 0.5) {
    issues.push(`Low fact extraction rate: ${health.factDensity.toFixed(2)} facts/execution`);
    recommendations.push('Enable more thorough context liquidation');
  }

  if (health.learningVelocity < 0.3) {
    issues.push(`Low learning velocity: ${(health.learningVelocity * 100).toFixed(0)}%`);
    recommendations.push('Increase trace recording threshold');
    recommendations.push('Diversify input patterns');
  }

  // Check for repeated failures
  const recentHistory = state.executionHistory.slice(-10);
  const consecutiveFailures = recentHistory.reduce((count, h, i) => {
    const prev = recentHistory[i - 1];
    if (!h.success && (i === 0 || (prev && !prev.success))) {
      return count + 1;
    }
    return count;
  }, 0);

  if (consecutiveFailures >= 3) {
    issues.push(`${consecutiveFailures} consecutive failures detected`);
    recommendations.push('Review recent inputs for unsupported patterns');
    recommendations.push('Consider creating new shards for these patterns');
  }

  return { issues, recommendations };
}

/**
 * Introspection: explain current cognitive state
 */
export function introspect(state: CognitiveState): string {
  const health = calculateSystemHealth(state);
  const diagnostic = runSelfDiagnostic(state);

  const lines: string[] = [
    '=== Cognitive Introspection ===',
    '',
    `Execution History: ${state.executionHistory.length} total`,
    `Success Rate: ${(health.successRate * 100).toFixed(1)}%`,
    `Working Facts: ${state.workingFacts.length}`,
    `Accumulated Lessons: ${state.accumulatedLessons.length}`,
    '',
    `Fact Density: ${health.factDensity.toFixed(2)} facts/execution`,
    `Learning Velocity: ${(health.learningVelocity * 100).toFixed(1)}%`,
    '',
  ];

  if (diagnostic.issues.length > 0) {
    lines.push('Issues:');
    diagnostic.issues.forEach(issue => lines.push(`  - ${issue}`));
    lines.push('');
  }

  if (diagnostic.recommendations.length > 0) {
    lines.push('Recommendations:');
    diagnostic.recommendations.forEach(rec => lines.push(`  - ${rec}`));
  }

  if (state.accumulatedLessons.length > 0) {
    lines.push('');
    lines.push('Recent Lessons:');
    state.accumulatedLessons.slice(-5).forEach(lesson => lines.push(`  - ${lesson}`));
  }

  return lines.join('\n');
}
