/**
 * Feedback Processor (Phase 4)
 * Closes the learning loop: human feedback → memory updates → agent behavior changes.
 *
 * Pipeline:
 * 1. Store feedback event
 * 2. Update episodic memory quality scores
 * 3. Apply autonomy adjustments
 * 4. Extract correction patterns into semantic memory
 * 5. Update capability proficiency based on feedback
 */

import { query } from '../database.js';
import { ulid } from 'ulid';
import { getMemoryManager } from '../memory/singleton.js';
import { generateEmbedding } from '../memory/embeddings.js';

export interface FeedbackEvent {
  executionId?: string;
  interventionId?: string;
  agentId: string;
  ownerId: string;
  feedbackType: 'correction' | 'clarification' | 'praise' | 'warning' | 'rejection';
  humanResponse?: string;
  agentOutput?: string;
  correctedOutput?: string;
  autonomyDelta?: number;
}

interface FeedbackResult {
  feedbackId: string;
  memoryUpdated: boolean;
  autonomyAdjusted: boolean;
  correctionStored: boolean;
}

/**
 * Process a single feedback event through the full learning pipeline.
 */
export async function processFeedback(event: FeedbackEvent): Promise<FeedbackResult> {
  const feedbackId = ulid();
  const qualityDelta = computeQualityDelta(event.feedbackType);

  // 1. Store feedback event
  await query(
    `INSERT INTO forge_execution_feedback
     (id, execution_id, intervention_id, agent_id, owner_id, feedback_type,
      human_response, agent_output, corrected_output, quality_delta, autonomy_delta)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      feedbackId,
      event.executionId ?? null,
      event.interventionId ?? null,
      event.agentId,
      event.ownerId,
      event.feedbackType,
      event.humanResponse ?? null,
      event.agentOutput ?? null,
      event.correctedOutput ?? null,
      qualityDelta,
      event.autonomyDelta ?? 0,
    ],
  );

  const result: FeedbackResult = {
    feedbackId,
    memoryUpdated: false,
    autonomyAdjusted: false,
    correctionStored: false,
  };

  // 2. Update episodic memory quality for this execution
  if (event.executionId) {
    const updated = await query(
      `UPDATE forge_episodic_memories
       SET outcome_quality = GREATEST(0, LEAST(1, outcome_quality + $1)),
           feedback_count = feedback_count + 1,
           last_feedback_at = NOW()
       WHERE execution_id = $2
         AND quality_locked = false
       RETURNING id`,
      [qualityDelta, event.executionId],
    );
    result.memoryUpdated = updated.length > 0;
  }

  // 3. Apply autonomy adjustment
  if (event.autonomyDelta && event.autonomyDelta !== 0) {
    await query(
      `UPDATE forge_agents
       SET autonomy_level = GREATEST(0, LEAST(5, autonomy_level + $1)),
           updated_at = NOW()
       WHERE id = $2`,
      [event.autonomyDelta, event.agentId],
    );
    result.autonomyAdjusted = true;
  }

  // 4. Store correction as episodic memory for learning
  if (event.feedbackType === 'correction' && event.humanResponse) {
    await storeCorrection(event);
    result.correctionStored = true;
  }

  // 5. Store praise as positive reinforcement
  if (event.feedbackType === 'praise' && event.humanResponse) {
    await storePraise(event);
  }

  console.log(
    `[Feedback] Processed ${event.feedbackType} for agent ${event.agentId}: ` +
    `memory=${result.memoryUpdated}, autonomy=${result.autonomyAdjusted}, correction=${result.correctionStored}`,
  );

  // Mark as processed
  await query(
    `UPDATE forge_execution_feedback SET processed = true, processed_at = NOW() WHERE id = $1`,
    [feedbackId],
  );

  return result;
}

/**
 * Store a correction as an episodic memory so the agent learns from it.
 */
async function storeCorrection(event: FeedbackEvent): Promise<void> {
  const manager = getMemoryManager();
  if (!manager) return;

  // Create episodic memory: situation=task, action=wrong output, outcome=correction
  const situation = event.agentOutput
    ? `Agent produced output that was corrected by human`
    : 'Agent action required human correction';
  const action = event.agentOutput?.substring(0, 500) ?? 'Unknown agent output';
  const outcome = `CORRECTION: ${event.humanResponse?.substring(0, 1000) ?? 'No details'}`;

  await manager.store(event.agentId, {
    type: 'episodic',
    ownerId: event.ownerId,
    situation,
    action,
    outcome,
    quality: 0.2, // Low quality — this was corrected
    executionId: event.executionId,
    metadata: {
      source: 'feedback',
      feedbackType: 'correction',
      correctedOutput: event.correctedOutput?.substring(0, 500),
    },
  });

  // Also store the correction as semantic knowledge
  const correctionFact = event.correctedOutput
    ? `When asked to do similar tasks, prefer this approach: ${event.correctedOutput.substring(0, 500)}`
    : `Human correction: ${event.humanResponse?.substring(0, 500) ?? ''}`;

  await manager.store(event.agentId, {
    type: 'semantic',
    ownerId: event.ownerId,
    content: correctionFact,
    options: {
      importance: 0.85,
      source: 'correction',
      metadata: {
        feedbackType: 'correction',
        executionId: event.executionId,
      },
    },
  });

  // Update or create correction pattern
  await upsertCorrectionPattern(event);
}

/**
 * Store praise as positive reinforcement in episodic memory.
 */
async function storePraise(event: FeedbackEvent): Promise<void> {
  const manager = getMemoryManager();
  if (!manager) return;

  await manager.store(event.agentId, {
    type: 'episodic',
    ownerId: event.ownerId,
    situation: 'Agent output received positive feedback',
    action: event.agentOutput?.substring(0, 500) ?? 'Agent task execution',
    outcome: `POSITIVE: ${event.humanResponse?.substring(0, 500) ?? 'Good work'}`,
    quality: 0.95,
    executionId: event.executionId,
    metadata: {
      source: 'feedback',
      feedbackType: 'praise',
    },
  });
}

/**
 * Track correction patterns across multiple feedback events.
 */
async function upsertCorrectionPattern(event: FeedbackEvent): Promise<void> {
  const description = event.humanResponse?.substring(0, 500) ?? 'Unspecified correction';

  // Try to find an existing similar pattern
  const embedding = await generateEmbedding(description).catch(() => null);
  if (!embedding) return;

  const vecLiteral = `[${embedding.join(',')}]`;
  const similar = await query<{ id: string; frequency: number; examples: unknown[] }>(
    `SELECT id, frequency, examples
     FROM forge_correction_patterns
     WHERE agent_id = $1
       AND embedding IS NOT NULL
       AND 1 - (embedding <=> $2::vector) > 0.80
     ORDER BY 1 - (embedding <=> $2::vector) DESC
     LIMIT 1`,
    [event.agentId, vecLiteral],
  );

  const example = {
    input: event.agentOutput?.substring(0, 200),
    correction: event.humanResponse?.substring(0, 200),
    correctedOutput: event.correctedOutput?.substring(0, 200),
  };

  if (similar.length > 0) {
    // Update existing pattern
    const existing = similar[0]!;
    const examples = Array.isArray(existing.examples) ? existing.examples : [];
    examples.push(example);
    // Keep last 10 examples
    const trimmed = examples.slice(-10);

    await query(
      `UPDATE forge_correction_patterns
       SET frequency = frequency + 1,
           examples = $1,
           confidence = LEAST(1.0, confidence + 0.1),
           last_seen = NOW()
       WHERE id = $2`,
      [JSON.stringify(trimmed), existing.id],
    );
  } else {
    // Create new pattern
    await query(
      `INSERT INTO forge_correction_patterns
       (id, agent_id, pattern_type, description, examples, embedding, confidence)
       VALUES ($1, $2, $3, $4, $5, $6, 0.5)`,
      [
        ulid(),
        event.agentId,
        classifyCorrectionType(description),
        description,
        JSON.stringify([example]),
        vecLiteral,
      ],
    );
  }
}

/**
 * Classify the type of correction based on content.
 */
function classifyCorrectionType(text: string): string {
  const lower = text.toLowerCase();
  if (/format|layout|structure|indent|spacing|markdown/i.test(lower)) return 'format';
  if (/wrong|incorrect|inaccurate|error|mistake/i.test(lower)) return 'accuracy';
  if (/style|tone|voice|language|wording/i.test(lower)) return 'style';
  if (/approach|method|strategy|way|how/i.test(lower)) return 'approach';
  if (/scope|too much|too little|focus|narrow|broad/i.test(lower)) return 'scope';
  return 'approach';
}

/**
 * Compute quality delta from feedback type.
 */
function computeQualityDelta(type: string): number {
  switch (type) {
    case 'praise': return 0.15;
    case 'clarification': return -0.05;
    case 'correction': return -0.25;
    case 'warning': return -0.15;
    case 'rejection': return -0.40;
    default: return 0;
  }
}

/**
 * Process all unprocessed feedback events (called by metabolic cycle).
 */
export async function processUnprocessedFeedback(): Promise<number> {
  const unprocessed = await query<{
    id: string;
    execution_id: string | null;
    intervention_id: string | null;
    agent_id: string;
    owner_id: string;
    feedback_type: string;
    human_response: string | null;
    agent_output: string | null;
    corrected_output: string | null;
    autonomy_delta: number;
  }>(
    `SELECT id, execution_id, intervention_id, agent_id, owner_id,
            feedback_type, human_response, agent_output, corrected_output, autonomy_delta
     FROM forge_execution_feedback
     WHERE processed = false
     ORDER BY created_at
     LIMIT 50`,
  );

  if (unprocessed.length === 0) return 0;

  let processed = 0;
  for (const fb of unprocessed) {
    try {
      await processFeedback({
        executionId: fb.execution_id ?? undefined,
        interventionId: fb.intervention_id ?? undefined,
        agentId: fb.agent_id,
        ownerId: fb.owner_id,
        feedbackType: fb.feedback_type as FeedbackEvent['feedbackType'],
        humanResponse: fb.human_response ?? undefined,
        agentOutput: fb.agent_output ?? undefined,
        correctedOutput: fb.corrected_output ?? undefined,
        autonomyDelta: fb.autonomy_delta,
      });
      processed++;
    } catch (err) {
      console.warn(`[Feedback] Failed to process feedback ${fb.id}:`, err instanceof Error ? err.message : err);
    }
  }

  if (processed > 0) {
    console.log(`[Feedback] Processed ${processed} pending feedback events`);
  }
  return processed;
}

/**
 * Get feedback stats for an agent.
 */
export async function getAgentFeedbackStats(agentId: string): Promise<{
  total: number;
  corrections: number;
  praises: number;
  rejections: number;
  avgQualityDelta: number;
  correctionPatterns: number;
}> {
  const stats = await query<{ feedback_type: string; count: string; avg_delta: string }>(
    `SELECT feedback_type, COUNT(*)::text AS count, AVG(quality_delta)::text AS avg_delta
     FROM forge_execution_feedback
     WHERE agent_id = $1
     GROUP BY feedback_type`,
    [agentId],
  );

  const patterns = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM forge_correction_patterns WHERE agent_id = $1`,
    [agentId],
  );

  const byType = Object.fromEntries(stats.map((s) => [s.feedback_type, parseInt(s.count)]));
  const totalDelta = stats.reduce((sum, s) => sum + parseFloat(s.avg_delta) * parseInt(s.count), 0);
  const totalCount = stats.reduce((sum, s) => sum + parseInt(s.count), 0);

  return {
    total: totalCount,
    corrections: byType['correction'] ?? 0,
    praises: byType['praise'] ?? 0,
    rejections: byType['rejection'] ?? 0,
    avgQualityDelta: totalCount > 0 ? totalDelta / totalCount : 0,
    correctionPatterns: parseInt(patterns[0]?.count ?? '0'),
  };
}
