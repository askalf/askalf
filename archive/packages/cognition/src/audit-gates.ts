/**
 * Audit Gates - Metacognitive quality checks
 *
 * Pre-execution gates: Should this shard execute?
 * Post-execution gates: Was the output valid?
 *
 * Gates implement the "thinking about thinking" layer that
 * prevents hallucinations and catches edge cases.
 */

import { createLogger } from '@substrate/observability';
import { ProceduralShard } from '@substrate/core';

const logger = createLogger({ component: 'audit-gates' });

export interface AuditResult {
  passed: boolean;
  gate: string;
  confidence: number;
  reason: string;
  suggestions?: string[] | undefined;
}

export interface AuditContext {
  input: string;
  shard?: ProceduralShard | undefined;
  output?: string | undefined;
  executionMs?: number | undefined;
}

/**
 * Pre-execution gates - validate before running shard
 */
export const preExecutionGates = {
  /**
   * Check if input matches shard's expected patterns
   */
  async patternMatch(ctx: AuditContext): Promise<AuditResult> {
    if (!ctx.shard) {
      return { passed: false, gate: 'patternMatch', confidence: 0, reason: 'No shard provided' };
    }

    const patterns = ctx.shard.patterns || [];
    if (patterns.length === 0) {
      return { passed: true, gate: 'patternMatch', confidence: 0.5, reason: 'No patterns defined, allowing execution' };
    }

    // Check if input matches any pattern
    for (const pattern of patterns) {
      try {
        const regex = new RegExp(pattern, 'i');
        if (regex.test(ctx.input)) {
          return { passed: true, gate: 'patternMatch', confidence: 0.9, reason: `Matched pattern: ${pattern}` };
        }
      } catch {
        // Pattern might not be valid regex, try substring match
        if (ctx.input.toLowerCase().includes(pattern.toLowerCase())) {
          return { passed: true, gate: 'patternMatch', confidence: 0.7, reason: `Substring match: ${pattern}` };
        }
      }
    }

    return {
      passed: false,
      gate: 'patternMatch',
      confidence: 0.3,
      reason: 'Input does not match any shard patterns',
      suggestions: ['Consider using LLM fallback', 'May need new shard for this pattern'],
    };
  },

  /**
   * Check shard confidence threshold
   */
  async confidenceThreshold(ctx: AuditContext, minConfidence = 0.7): Promise<AuditResult> {
    if (!ctx.shard) {
      return { passed: false, gate: 'confidenceThreshold', confidence: 0, reason: 'No shard provided' };
    }

    const shardConfidence = ctx.shard.confidence;

    if (shardConfidence >= minConfidence) {
      return {
        passed: true,
        gate: 'confidenceThreshold',
        confidence: shardConfidence,
        reason: `Shard confidence ${shardConfidence.toFixed(3)} >= threshold ${minConfidence}`,
      };
    }

    return {
      passed: false,
      gate: 'confidenceThreshold',
      confidence: shardConfidence,
      reason: `Shard confidence ${shardConfidence.toFixed(3)} < threshold ${minConfidence}`,
      suggestions: ['Execute with shadow verification', 'Fall back to LLM for validation'],
    };
  },

  /**
   * Check shard success rate
   */
  async successRate(ctx: AuditContext, minRate = 0.85): Promise<AuditResult> {
    if (!ctx.shard) {
      return { passed: false, gate: 'successRate', confidence: 0, reason: 'No shard provided' };
    }

    const { executionCount, successCount } = ctx.shard;

    // Not enough executions to judge
    if (executionCount < 5) {
      return {
        passed: true,
        gate: 'successRate',
        confidence: 0.5,
        reason: `Insufficient executions (${executionCount}) to calculate rate`,
        suggestions: ['Shard is still being validated'],
      };
    }

    const rate = successCount / executionCount;

    if (rate >= minRate) {
      return {
        passed: true,
        gate: 'successRate',
        confidence: rate,
        reason: `Success rate ${(rate * 100).toFixed(1)}% >= threshold ${minRate * 100}%`,
      };
    }

    return {
      passed: false,
      gate: 'successRate',
      confidence: rate,
      reason: `Success rate ${(rate * 100).toFixed(1)}% < threshold ${minRate * 100}%`,
      suggestions: ['Shard may need retraining', 'Consider shadow execution with LLM'],
    };
  },

  /**
   * Check for dangerous/sensitive operations
   */
  async safetyCheck(ctx: AuditContext): Promise<AuditResult> {
    const dangerousPatterns = [
      /rm\s+-rf/i,
      /drop\s+table/i,
      /delete\s+from/i,
      /exec\s*\(/i,
      /eval\s*\(/i,
      /process\.exit/i,
      /require\s*\(/i,
      /import\s*\(/i,
    ];

    // Check input for dangerous content
    for (const pattern of dangerousPatterns) {
      if (pattern.test(ctx.input)) {
        return {
          passed: false,
          gate: 'safetyCheck',
          confidence: 0.95,
          reason: `Dangerous pattern detected in input: ${pattern.source}`,
          suggestions: ['Reject execution', 'Log for security review'],
        };
      }
    }

    // Check shard logic for dangerous code (if available)
    if (ctx.shard?.logic) {
      for (const pattern of dangerousPatterns) {
        if (pattern.test(ctx.shard.logic)) {
          return {
            passed: false,
            gate: 'safetyCheck',
            confidence: 0.9,
            reason: `Dangerous pattern in shard logic: ${pattern.source}`,
            suggestions: ['Shard needs security review', 'Reject execution'],
          };
        }
      }
    }

    return {
      passed: true,
      gate: 'safetyCheck',
      confidence: 0.9,
      reason: 'No dangerous patterns detected',
    };
  },
};

/**
 * Post-execution gates - validate output after execution
 */
export const postExecutionGates = {
  /**
   * Check output is not empty or error-like
   */
  async outputValidity(ctx: AuditContext): Promise<AuditResult> {
    if (!ctx.output) {
      return {
        passed: false,
        gate: 'outputValidity',
        confidence: 0,
        reason: 'No output produced',
      };
    }

    const output = ctx.output.toString().trim();

    if (output.length === 0) {
      return {
        passed: false,
        gate: 'outputValidity',
        confidence: 0.1,
        reason: 'Empty output',
      };
    }

    // Check for common error indicators
    const errorPatterns = [
      /^error:/i,
      /^undefined$/,
      /^null$/,
      /^NaN$/,
      /exception/i,
      /stack trace/i,
    ];

    for (const pattern of errorPatterns) {
      if (pattern.test(output)) {
        return {
          passed: false,
          gate: 'outputValidity',
          confidence: 0.3,
          reason: `Output appears to be an error: ${output.substring(0, 100)}`,
        };
      }
    }

    return {
      passed: true,
      gate: 'outputValidity',
      confidence: 0.9,
      reason: 'Output appears valid',
    };
  },

  /**
   * Check execution time is reasonable
   */
  async performanceCheck(ctx: AuditContext, maxMs = 1000): Promise<AuditResult> {
    if (ctx.executionMs === undefined) {
      return {
        passed: true,
        gate: 'performanceCheck',
        confidence: 0.5,
        reason: 'No execution time recorded',
      };
    }

    if (ctx.executionMs <= maxMs) {
      return {
        passed: true,
        gate: 'performanceCheck',
        confidence: 0.95,
        reason: `Execution time ${ctx.executionMs}ms <= max ${maxMs}ms`,
      };
    }

    return {
      passed: false,
      gate: 'performanceCheck',
      confidence: 0.6,
      reason: `Execution time ${ctx.executionMs}ms > max ${maxMs}ms`,
      suggestions: ['Shard may be too complex', 'Consider optimization or timeout'],
    };
  },

  /**
   * Semantic coherence check - does output make sense for input?
   * Uses lightweight heuristics, not LLM call
   */
  async semanticCoherence(ctx: AuditContext): Promise<AuditResult> {
    if (!ctx.output || !ctx.input) {
      return {
        passed: true,
        gate: 'semanticCoherence',
        confidence: 0.5,
        reason: 'Insufficient context for coherence check',
      };
    }

    // Extract numbers from input and output
    const inputNumbers = ctx.input.match(/\d+\.?\d*/g) || [];
    const outputNumbers = ctx.output.match(/\d+\.?\d*/g) || [];

    // If input has numbers, output should likely have numbers too
    if (inputNumbers.length > 0 && outputNumbers.length === 0) {
      return {
        passed: false,
        gate: 'semanticCoherence',
        confidence: 0.4,
        reason: 'Input contains numbers but output does not',
        suggestions: ['May indicate calculation failure'],
      };
    }

    // Check for keyword preservation (simple heuristic)
    const inputWords = new Set(ctx.input.toLowerCase().split(/\W+/).filter(w => w.length > 3));
    const outputWords = new Set(ctx.output.toLowerCase().split(/\W+/).filter(w => w.length > 3));

    // Some overlap expected for related content
    const overlap = [...inputWords].filter(w => outputWords.has(w)).length;
    const overlapRatio = inputWords.size > 0 ? overlap / inputWords.size : 0;

    if (overlapRatio < 0.1 && inputWords.size > 3) {
      return {
        passed: true, // Still pass, but low confidence
        gate: 'semanticCoherence',
        confidence: 0.5,
        reason: `Low keyword overlap (${(overlapRatio * 100).toFixed(0)}%) between input and output`,
        suggestions: ['Output may be a transformation rather than direct answer'],
      };
    }

    return {
      passed: true,
      gate: 'semanticCoherence',
      confidence: 0.8,
      reason: 'Output appears coherent with input',
    };
  },
};

/**
 * Run all pre-execution gates
 */
export async function runPreExecutionGates(
  ctx: AuditContext,
  options?: { minConfidence?: number; minSuccessRate?: number }
): Promise<{ passed: boolean; results: AuditResult[] }> {
  const results: AuditResult[] = [];

  // Run all gates in parallel
  const [pattern, confidence, success, safety] = await Promise.all([
    preExecutionGates.patternMatch(ctx),
    preExecutionGates.confidenceThreshold(ctx, options?.minConfidence ?? 0.7),
    preExecutionGates.successRate(ctx, options?.minSuccessRate ?? 0.85),
    preExecutionGates.safetyCheck(ctx),
  ]);

  results.push(pattern, confidence, success, safety);

  // Safety is a hard gate - if it fails, everything fails
  if (!safety.passed) {
    logger.warn({ gate: 'safety', input: ctx.input }, 'Safety gate failed');
    return { passed: false, results };
  }

  // Other gates are soft - majority vote
  const softGates = [pattern, confidence, success];
  const passedCount = softGates.filter(g => g.passed).length;
  const passed = passedCount >= 2; // Majority

  if (!passed) {
    logger.info({ gates: results.filter(r => !r.passed).map(r => r.gate) }, 'Pre-execution gates failed');
  }

  return { passed, results };
}

/**
 * Run all post-execution gates
 */
export async function runPostExecutionGates(ctx: AuditContext): Promise<{ passed: boolean; results: AuditResult[] }> {
  const results: AuditResult[] = [];

  const [validity, performance, coherence] = await Promise.all([
    postExecutionGates.outputValidity(ctx),
    postExecutionGates.performanceCheck(ctx),
    postExecutionGates.semanticCoherence(ctx),
  ]);

  results.push(validity, performance, coherence);

  // Output validity is a hard gate
  if (!validity.passed) {
    logger.warn({ output: ctx.output?.substring(0, 100) }, 'Output validity failed');
    return { passed: false, results };
  }

  // Performance and coherence are soft gates
  const passed = performance.passed || coherence.passed;

  return { passed, results };
}
