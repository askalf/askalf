/**
 * Built-in Tool: Feedback Ops (Level 12 — Vibe Reflection)
 * Self-assessment and learning from corrections: submit feedback on executions,
 * view feedback stats, and inspect correction patterns for self-improvement.
 */

import { query } from '../../database.js';
import { processFeedback, getAgentFeedbackStats } from '../../learning/feedback-processor.js';
import { getExecutionContext } from '../../runtime/execution-context.js';
import type { ToolResult } from '../registry.js';

// ============================================
// Types
// ============================================

export interface FeedbackOpsInput {
  action: 'submit' | 'stats' | 'patterns';
  // For submit:
  execution_id?: string;
  feedback_type?: 'correction' | 'clarification' | 'praise' | 'warning' | 'rejection';
  human_response?: string;
  agent_output?: string;
  corrected_output?: string;
  autonomy_delta?: number;
  // Context:
  agent_id?: string;
}

// ============================================
// Implementation
// ============================================

export async function feedbackOps(input: FeedbackOpsInput): Promise<ToolResult> {
  const startTime = performance.now();

  try {
    switch (input.action) {
      case 'submit':
        return await handleSubmit(input, startTime);
      case 'stats':
        return await handleStats(input, startTime);
      case 'patterns':
        return await handlePatterns(input, startTime);
      default:
        return {
          output: null,
          error: `Unknown action: ${input.action}. Supported: submit, stats, patterns`,
          durationMs: Math.round(performance.now() - startTime),
        };
    }
  } catch (err) {
    return {
      output: null,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Math.round(performance.now() - startTime),
    };
  }
}

// ============================================
// Submit Action
// ============================================

async function handleSubmit(input: FeedbackOpsInput, startTime: number): Promise<ToolResult> {
  const ctx = getExecutionContext();
  const agentId = input.agent_id ?? ctx?.agentId ?? 'unknown';
  const ownerId = ctx?.ownerId ?? 'system';

  if (agentId === 'unknown') {
    return { output: null, error: 'Could not determine agent ID', durationMs: Math.round(performance.now() - startTime) };
  }
  if (!input.feedback_type) {
    return { output: null, error: 'feedback_type is required for submit', durationMs: 0 };
  }

  // Check autonomy level — must be >= 2 to self-assess
  const agents = await query<{ autonomy_level: number }>(
    `SELECT autonomy_level FROM forge_agents WHERE id = $1`,
    [agentId],
  );
  if (agents.length > 0 && agents[0]!.autonomy_level < 2) {
    return {
      output: null,
      error: `Autonomy level ${agents[0]!.autonomy_level} insufficient. Need >= 2 for feedback submission.`,
      durationMs: Math.round(performance.now() - startTime),
    };
  }

  const result = await processFeedback({
    executionId: input.execution_id,
    agentId,
    ownerId,
    feedbackType: input.feedback_type,
    humanResponse: input.human_response,
    agentOutput: input.agent_output,
    correctedOutput: input.corrected_output,
    autonomyDelta: input.autonomy_delta,
  });

  return {
    output: {
      feedback_id: result.feedbackId,
      memory_updated: result.memoryUpdated,
      autonomy_adjusted: result.autonomyAdjusted,
      correction_stored: result.correctionStored,
      feedback_type: input.feedback_type,
      message: `Feedback processed: memory=${result.memoryUpdated}, autonomy=${result.autonomyAdjusted}, correction=${result.correctionStored}`,
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}

// ============================================
// Stats Action
// ============================================

async function handleStats(input: FeedbackOpsInput, startTime: number): Promise<ToolResult> {
  const ctx = getExecutionContext();
  const agentId = input.agent_id ?? ctx?.agentId ?? 'unknown';

  const stats = await getAgentFeedbackStats(agentId);

  return {
    output: {
      agent_id: agentId,
      total_feedback: stats.total,
      corrections: stats.corrections,
      praises: stats.praises,
      rejections: stats.rejections,
      avg_quality_delta: Math.round(stats.avgQualityDelta * 1000) / 1000,
      correction_patterns: stats.correctionPatterns,
      correction_rate: stats.total > 0 ? Math.round((stats.corrections / stats.total) * 100) : 0,
      praise_rate: stats.total > 0 ? Math.round((stats.praises / stats.total) * 100) : 0,
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}

// ============================================
// Patterns Action
// ============================================

async function handlePatterns(input: FeedbackOpsInput, startTime: number): Promise<ToolResult> {
  const ctx = getExecutionContext();
  const agentId = input.agent_id ?? ctx?.agentId ?? 'unknown';

  const patterns = await query<{
    id: string;
    pattern_type: string;
    description: string;
    frequency: number;
    confidence: number;
    examples: unknown[];
    last_seen: string;
  }>(
    `SELECT id, pattern_type, description, frequency, confidence::float AS confidence,
            examples, last_seen::text
     FROM forge_correction_patterns
     WHERE agent_id = $1
     ORDER BY frequency DESC
     LIMIT 20`,
    [agentId],
  );

  return {
    output: {
      agent_id: agentId,
      patterns: patterns.map((p) => ({
        id: p.id,
        type: p.pattern_type,
        description: p.description,
        frequency: p.frequency,
        confidence: Math.round(p.confidence * 100) / 100,
        example_count: Array.isArray(p.examples) ? p.examples.length : 0,
        last_seen: p.last_seen,
      })),
      total: patterns.length,
      high_frequency: patterns.filter((p) => p.frequency >= 3).length,
      message: patterns.length > 0
        ? `${patterns.length} correction patterns found. ${patterns.filter((p) => p.frequency >= 3).length} are high-frequency (≥3 occurrences).`
        : 'No correction patterns found. This may mean excellent performance or insufficient feedback history.',
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}
