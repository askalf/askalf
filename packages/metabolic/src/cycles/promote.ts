/**
 * Promotion Cycle
 *
 * Full lifecycle: candidate → testing → shadow → promoted
 *
 * Step 0 - Activation:  candidate → testing (>= 1 successful execution)
 * Step 1 - Shadow entry: testing → shadow (confidence >= 0.75, executions >= 10, success >= 90%)
 * Step 2 - Promotion:   shadow → promoted (confidence >= 0.85, executions >= 25, success >= 90%)
 * Step 3 - Shadow fail:  shadow → testing (confidence < 0.60)
 * Step 4 - Demotion:    promoted → testing (confidence < 0.50)
 */

import { query } from '@substrate/database';
import { procedural } from '@substrate/memory';
import { createLogger } from '@substrate/observability';

const logger = createLogger({ component: 'promote' });

export interface PromotionConfig {
  // Shadow entry thresholds
  shadowConfidenceThreshold: number;
  shadowMinExecutions: number;
  shadowMinSuccessRate: number;

  // Full promotion thresholds (from shadow → promoted)
  confidenceThreshold: number;
  minExecutions: number;
  minSuccessRate: number;
  shadowMinRuntime: number; // Minimum executions while in shadow

  // Multi-confirmation (Layer 4): require diverse phrasings
  requirePhrasingDiversity: boolean;

  // Feedback signals (Layer 5): block promotion if too many corrections
  maxCorrectionRate: number; // e.g. 0.1 = max 10% corrections

  // Demotion thresholds
  demoteConfidenceThreshold: number;
  shadowFailThreshold: number;
}

const DEFAULT_PROMOTION_CONFIG: PromotionConfig = {
  // Shadow entry: testing/candidate → shadow
  shadowConfidenceThreshold: 0.75,
  shadowMinExecutions: 10,
  shadowMinSuccessRate: 0.9,

  // Full promotion: shadow → promoted
  confidenceThreshold: 0.85,
  minExecutions: 25,
  minSuccessRate: 0.9,
  shadowMinRuntime: 10,

  // Multi-confirmation (Layer 4)
  requirePhrasingDiversity: true,

  // Feedback signals (Layer 5)
  maxCorrectionRate: 0.1,

  // Demotion
  demoteConfidenceThreshold: 0.5,
  shadowFailThreshold: 0.6,
};

export interface PromotionResult {
  activated: number;   // candidate → testing
  promoted: number;
  shadowed: number;
  demoted: number;
  shadowFailed: number;
  candidates: string[];
}

/**
 * Run the promotion cycle
 */
export async function runPromoteCycle(
  config: Partial<PromotionConfig> = {}
): Promise<PromotionResult> {
  const cfg = { ...DEFAULT_PROMOTION_CONFIG, ...config };

  logger.info('Starting promotion cycle');

  const result: PromotionResult = {
    activated: 0,
    promoted: 0,
    shadowed: 0,
    demoted: 0,
    shadowFailed: 0,
    candidates: [],
  };

  // ─────────────────────────────────────────────────
  // STEP 0: candidate → testing
  // New shards that have at least 1 successful execution
  // prove they can run without crashing → enter testing
  // ─────────────────────────────────────────────────
  const activationCandidates = await query<{
    id: string;
    name: string;
    execution_count: number;
    success_count: number;
  }>(
    `SELECT id, name, execution_count, success_count
     FROM procedural_shards
     WHERE lifecycle = 'candidate'
       AND success_count >= 1`,
    []
  );

  for (const candidate of activationCandidates) {
    await procedural.updateLifecycle(candidate.id, 'testing');
    result.activated++;

    logger.info({
      shardId: candidate.id,
      name: candidate.name,
      executions: candidate.execution_count,
      successes: candidate.success_count,
    }, 'Candidate activated to testing');
  }

  // ─────────────────────────────────────────────────
  // STEP 1: testing → shadow
  // Shards that meet base criteria enter shadow mode
  // ─────────────────────────────────────────────────
  const shadowCandidates = await query<{
    id: string;
    name: string;
    confidence: number;
    execution_count: number;
    success_count: number;
  }>(
    `SELECT id, name, confidence, execution_count, success_count
     FROM procedural_shards
     WHERE lifecycle = 'testing'
       AND confidence >= $1
       AND execution_count >= $2
       AND (success_count::float / NULLIF(execution_count, 0)) >= $3`,
    [cfg.shadowConfidenceThreshold, cfg.shadowMinExecutions, cfg.shadowMinSuccessRate]
  );

  for (const candidate of shadowCandidates) {
    await procedural.updateLifecycle(candidate.id, 'shadow');
    result.shadowed++;
    result.candidates.push(candidate.name);

    logger.info({
      shardId: candidate.id,
      name: candidate.name,
      confidence: candidate.confidence,
      executions: candidate.execution_count,
    }, 'Shard entered shadow mode');
  }

  // ─────────────────────────────────────────────────
  // STEP 2: shadow → promoted
  // Shadow shards that prove themselves get promoted
  // Layer 4: Also requires diverse phrasings
  // Layer 5: Blocks promotion if too many corrections
  // ─────────────────────────────────────────────────
  const promotionCandidates = await query<{
    id: string;
    name: string;
    confidence: number;
    execution_count: number;
    success_count: number;
    unique_phrasings: number;
    min_phrasings_for_promotion: number;
    acceptance_count: number;
    correction_count: number;
    knowledge_type: string;
  }>(
    `SELECT id, name, confidence, execution_count, success_count,
            unique_phrasings, min_phrasings_for_promotion,
            acceptance_count, correction_count, knowledge_type
     FROM procedural_shards
     WHERE lifecycle = 'shadow'
       AND confidence >= $1
       AND execution_count >= $2
       AND (success_count::float / NULLIF(execution_count, 0)) >= $3`,
    [cfg.confidenceThreshold, cfg.minExecutions, cfg.minSuccessRate]
  );

  for (const candidate of promotionCandidates) {
    // Layer 4: Check phrasing diversity
    if (cfg.requirePhrasingDiversity) {
      const minPhrasings = candidate.min_phrasings_for_promotion || 5;
      if (candidate.unique_phrasings < minPhrasings) {
        logger.info({
          shardId: candidate.id,
          name: candidate.name,
          uniquePhrasings: candidate.unique_phrasings,
          required: minPhrasings,
        }, 'Promotion blocked: insufficient phrasing diversity');
        continue;
      }
    }

    // Layer 5: Check correction rate
    const totalFeedback = candidate.acceptance_count + candidate.correction_count;
    if (totalFeedback > 0) {
      const correctionRate = candidate.correction_count / totalFeedback;
      if (correctionRate > cfg.maxCorrectionRate) {
        logger.info({
          shardId: candidate.id,
          name: candidate.name,
          correctionRate: (correctionRate * 100).toFixed(1) + '%',
          corrections: candidate.correction_count,
          acceptances: candidate.acceptance_count,
        }, 'Promotion blocked: correction rate too high');
        continue;
      }
    }

    // Layer 5: Contextual knowledge never auto-promotes
    if (candidate.knowledge_type === 'contextual') {
      logger.info({
        shardId: candidate.id,
        name: candidate.name,
      }, 'Promotion blocked: contextual knowledge cannot auto-promote');
      continue;
    }

    await procedural.updateLifecycle(candidate.id, 'promoted');
    result.promoted++;

    logger.info({
      shardId: candidate.id,
      name: candidate.name,
      confidence: candidate.confidence,
      executions: candidate.execution_count,
      uniquePhrasings: candidate.unique_phrasings,
      acceptances: candidate.acceptance_count,
      corrections: candidate.correction_count,
    }, 'Shard promoted from shadow');
  }

  // ─────────────────────────────────────────────────
  // STEP 3: shadow → testing (shadow failures)
  // Shadow shards that fail go back to testing
  // ─────────────────────────────────────────────────
  const shadowFailures = await query<{
    id: string;
    name: string;
    confidence: number;
  }>(
    `SELECT id, name, confidence
     FROM procedural_shards
     WHERE lifecycle = 'shadow'
       AND confidence < $1`,
    [cfg.shadowFailThreshold]
  );

  for (const failed of shadowFailures) {
    await procedural.updateLifecycle(failed.id, 'testing');
    result.shadowFailed++;

    logger.warn({
      shardId: failed.id,
      name: failed.name,
      confidence: failed.confidence,
    }, 'Shard failed shadow mode');
  }

  // ─────────────────────────────────────────────────
  // STEP 4: promoted → testing (demotions)
  // Promoted shards that drop below threshold
  // ─────────────────────────────────────────────────
  const demotionCandidates = await query<{
    id: string;
    name: string;
    confidence: number;
  }>(
    `SELECT id, name, confidence
     FROM procedural_shards
     WHERE lifecycle = 'promoted'
       AND confidence < $1`,
    [cfg.demoteConfidenceThreshold]
  );

  for (const candidate of demotionCandidates) {
    await procedural.updateLifecycle(candidate.id, 'testing');
    result.demoted++;

    logger.warn({
      shardId: candidate.id,
      name: candidate.name,
      confidence: candidate.confidence,
    }, 'Shard demoted');
  }

  logger.info({
    activated: result.activated,
    promoted: result.promoted,
    shadowed: result.shadowed,
    demoted: result.demoted,
    shadowFailed: result.shadowFailed,
  }, 'Promotion cycle complete');

  return result;
}

/**
 * Get shards close to promotion threshold
 */
export async function getShardsNearPromotion(
  threshold = 0.85
): Promise<Array<{
  id: string;
  name: string;
  confidence: number;
  executionsNeeded: number;
  confidenceGap: number;
}>> {
  const nearPromotionShards = await query<{
    id: string;
    name: string;
    confidence: number;
    execution_count: number;
    success_count: number;
  }>(
    `SELECT id, name, confidence, execution_count, success_count
     FROM procedural_shards
     WHERE lifecycle IN ('testing', 'candidate')
       AND confidence >= $1
     ORDER BY confidence DESC
     LIMIT 20`,
    [threshold - 0.15] // Within 0.15 of threshold
  );

  return nearPromotionShards.map(s => {
    const confidenceGap = threshold - s.confidence;
    const executionsNeeded = Math.max(0, 10 - s.execution_count);

    return {
      id: s.id,
      name: s.name,
      confidence: s.confidence,
      executionsNeeded,
      confidenceGap,
    };
  });
}
