/**
 * User Feedback Signal Detection (Layer 5)
 *
 * After a shard hit, analyzes the user's next message to detect implicit signals:
 * - acceptance: User moves on to new topic (positive)
 * - rephrase: User asks the same thing differently (doubt)
 * - correction: User says "no", "wrong", "actually" (negative)
 * - followup: User asks related question (neutral/positive)
 *
 * Signals feed back into shard confidence and the promotion pipeline.
 */

import { query, queryOne } from '@substrate/database';
import { procedural } from '@substrate/memory';
import { generateEmbedding } from '@substrate/ai';
import { ids } from '@substrate/core';
import { createLogger } from '@substrate/observability';

const logger = createLogger({ component: 'feedback' });

export type FeedbackSignal = 'acceptance' | 'rephrase' | 'correction' | 'followup';

export interface FeedbackConfig {
  lookbackMinutes: number;
  rephraseSimilarityThreshold: number;
  maxMessagesPerRun: number;
}

const DEFAULT_FEEDBACK_CONFIG: FeedbackConfig = {
  lookbackMinutes: 1440, // 24 hours — NOT EXISTS dedup prevents reprocessing
  rephraseSimilarityThreshold: 0.75,
  maxMessagesPerRun: 100,
};

// Confidence deltas for each signal type
const SIGNAL_WEIGHTS: Record<FeedbackSignal, number> = {
  acceptance: 0.005,   // Small positive boost
  rephrase: -0.015,    // Moderate negative (doubt)
  correction: -0.03,   // Strong negative
  followup: 0.002,     // Tiny positive (engagement)
};

// Patterns that indicate correction
const CORRECTION_PATTERNS = [
  /^no[,.\s!]/i,
  /^wrong/i,
  /^that'?s?\s+(not|wrong|incorrect)/i,
  /^actually[,\s]/i,
  /^incorrect/i,
  /not what i (asked|meant|wanted)/i,
  /try again/i,
  /that doesn'?t (answer|help|make sense)/i,
];

export interface FeedbackResult {
  processed: number;
  acceptances: number;
  rephrases: number;
  corrections: number;
  followups: number;
  skipped: number;
  errors: number;
}

/**
 * Run the feedback detection cycle.
 * Scans recent shard hits and analyzes the user's next message.
 */
export async function runFeedbackCycle(
  config: Partial<FeedbackConfig> = {}
): Promise<FeedbackResult> {
  const cfg = { ...DEFAULT_FEEDBACK_CONFIG, ...config };

  logger.info({ lookbackMinutes: cfg.lookbackMinutes }, 'Starting feedback detection cycle');

  const result: FeedbackResult = {
    processed: 0,
    acceptances: 0,
    rephrases: 0,
    corrections: 0,
    followups: 0,
    skipped: 0,
    errors: 0,
  };

  // Find recent shard hit messages that haven't been analyzed yet
  const shardHits = await query<{
    hit_id: string;
    session_id: string;
    shard_id: string;
    shard_name: string;
    shard_output: string;
    hit_at: string;
    user_query: string;
    next_user_msg: string | null;
    next_user_msg_at: string | null;
    tenant_id: string | null;
  }>(`
    WITH shard_hits AS (
      SELECT
        m.id as hit_id,
        m.session_id,
        m.shard_id,
        m.shard_name,
        m.content as shard_output,
        m.created_at as hit_at
      FROM chat_messages m
      WHERE m.role = 'assistant'
        AND m.shard_id IS NOT NULL
        AND m.created_at > NOW() - INTERVAL '1 minute' * $1
        AND NOT EXISTS (
          SELECT 1 FROM shard_feedback sf WHERE sf.execution_id = m.id
        )
      ORDER BY m.created_at DESC
      LIMIT $2
    )
    SELECT
      sh.hit_id,
      sh.session_id,
      sh.shard_id,
      sh.shard_name,
      sh.shard_output,
      sh.hit_at,
      -- Get the user message that triggered the shard hit
      prev.content as user_query,
      -- Get the user's NEXT message after the shard hit
      next_msg.content as next_user_msg,
      next_msg.created_at as next_user_msg_at,
      cs.tenant_id
    FROM shard_hits sh
    LEFT JOIN LATERAL (
      SELECT content FROM chat_messages
      WHERE session_id = sh.session_id
        AND role = 'user'
        AND created_at < sh.hit_at
      ORDER BY created_at DESC LIMIT 1
    ) prev ON true
    LEFT JOIN LATERAL (
      SELECT content, created_at FROM chat_messages
      WHERE session_id = sh.session_id
        AND role = 'user'
        AND created_at > sh.hit_at
      ORDER BY created_at ASC LIMIT 1
    ) next_msg ON true
    LEFT JOIN chat_sessions cs ON cs.id = sh.session_id
  `, [cfg.lookbackMinutes, cfg.maxMessagesPerRun]);

  logger.info({ hitsFound: shardHits.length }, 'Found shard hits to analyze');

  for (const hit of shardHits) {
    try {
      // No next message yet — user may still be reading. Skip for now.
      if (!hit.next_user_msg) {
        result.skipped++;
        continue;
      }

      const signal = await detectSignal(
        hit.user_query,
        hit.shard_output,
        hit.next_user_msg,
        cfg
      );

      // Record the feedback
      const delta = SIGNAL_WEIGHTS[signal.type];
      await query(
        `INSERT INTO shard_feedback (id, shard_id, session_id, tenant_id, execution_id, shard_output, signal_type, user_message, confidence, confidence_delta, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
        [
          ids.event(),
          hit.shard_id,
          hit.session_id,
          hit.tenant_id,
          hit.hit_id,
          hit.shard_output?.substring(0, 500),
          signal.type,
          hit.next_user_msg?.substring(0, 500),
          signal.confidence,
          delta,
        ]
      );

      // Apply confidence adjustment and increment counter
      const scaledDelta = delta * signal.confidence;
      const counterColumn =
        signal.type === 'acceptance' ? 'acceptance_count' :
        signal.type === 'rephrase' ? 'rephrase_count' :
        signal.type === 'correction' ? 'correction_count' : null;

      if (counterColumn) {
        await query(
          `UPDATE procedural_shards
           SET confidence = GREATEST(0.01, LEAST(1.0, confidence + $2)),
               ${counterColumn} = ${counterColumn} + 1
           WHERE id = $1`,
          [hit.shard_id, scaledDelta]
        );
      } else {
        await query(
          `UPDATE procedural_shards
           SET confidence = GREATEST(0.01, LEAST(1.0, confidence + $2))
           WHERE id = $1`,
          [hit.shard_id, scaledDelta]
        );
      }

      // Track result
      result.processed++;
      if (signal.type === 'acceptance') result.acceptances++;
      else if (signal.type === 'rephrase') result.rephrases++;
      else if (signal.type === 'correction') result.corrections++;
      else if (signal.type === 'followup') result.followups++;

      logger.debug({
        shardId: hit.shard_id,
        shardName: hit.shard_name,
        signal: signal.type,
        signalConfidence: signal.confidence,
        delta: delta * signal.confidence,
        nextMsg: hit.next_user_msg?.substring(0, 80),
      }, 'Feedback signal recorded');

    } catch (err) {
      result.errors++;
      logger.error({
        hitId: hit.hit_id,
        error: err instanceof Error ? err.message : String(err),
      }, 'Failed to process feedback for shard hit');
    }
  }

  logger.info(result, 'Feedback detection cycle complete');
  return result;
}

interface DetectedSignal {
  type: FeedbackSignal;
  confidence: number;
}

/**
 * Detect the type of implicit feedback signal from the user's next message.
 */
async function detectSignal(
  originalQuery: string,
  shardOutput: string,
  nextMessage: string,
  cfg: FeedbackConfig
): Promise<DetectedSignal> {
  const nextLower = nextMessage.toLowerCase().trim();

  // Check for explicit correction patterns first (highest priority)
  for (const pattern of CORRECTION_PATTERNS) {
    if (pattern.test(nextLower)) {
      return { type: 'correction', confidence: 0.9 };
    }
  }

  // Check for rephrase — user asks the same thing in different words
  // This indicates the shard's answer wasn't satisfactory
  try {
    const [origEmbedding, nextEmbedding] = await Promise.all([
      generateEmbedding(originalQuery),
      generateEmbedding(nextMessage),
    ]);

    const similarity = cosineSimilarity(origEmbedding, nextEmbedding);

    if (similarity >= cfg.rephraseSimilarityThreshold) {
      // High similarity = likely a rephrase
      return { type: 'rephrase', confidence: Math.min(1.0, similarity) };
    }

    // Moderate similarity = likely a followup on the same topic
    if (similarity >= 0.5) {
      return { type: 'followup', confidence: 0.6 };
    }
  } catch {
    // Embedding failed, fall through to default
  }

  // Default: user moved on to a different topic = acceptance
  return { type: 'acceptance', confidence: 0.7 };
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += (a[i] ?? 0) * (b[i] ?? 0);
    normA += (a[i] ?? 0) * (a[i] ?? 0);
    normB += (b[i] ?? 0) * (b[i] ?? 0);
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dotProduct / denom;
}
