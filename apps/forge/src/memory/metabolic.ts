/**
 * Forge-Native Metabolic Cycles
 * Simplified memory maintenance running as setInterval() inside Forge.
 * Three cycles: decay (prune stale), lessons (learn from failures), promote (boost winners).
 */

import { query } from '../database.js';

let decayTimer: ReturnType<typeof setInterval> | null = null;
let lessonsTimer: ReturnType<typeof setInterval> | null = null;
let promoteTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start all metabolic cycles on intervals.
 * Call once during server startup after database is initialized.
 */
export function startMetabolicCycles(): void {
  // Run initial cycles 5 minutes after startup
  setTimeout(() => {
    void runDecayCycle().catch(logErr('decay'));
    void runLessonsCycle().catch(logErr('lessons'));
  }, 5 * 60 * 1000);

  // Decay: every 12 hours
  decayTimer = setInterval(() => {
    void runDecayCycle().catch(logErr('decay'));
  }, 12 * 60 * 60 * 1000);

  // Lessons: every 4 hours
  lessonsTimer = setInterval(() => {
    void runLessonsCycle().catch(logErr('lessons'));
  }, 4 * 60 * 60 * 1000);

  // Promote: every 2 hours
  promoteTimer = setInterval(() => {
    void runPromoteCycle().catch(logErr('promote'));
  }, 2 * 60 * 60 * 1000);

  console.log('[Metabolic] Cycles started — decay(12h), lessons(4h), promote(2h)');
}

/**
 * Stop all metabolic cycles.
 */
export function stopMetabolicCycles(): void {
  if (decayTimer) clearInterval(decayTimer);
  if (lessonsTimer) clearInterval(lessonsTimer);
  if (promoteTimer) clearInterval(promoteTimer);
  decayTimer = null;
  lessonsTimer = null;
  promoteTimer = null;
}

// --------------------------------------------------------------------------
// Decay Cycle
// --------------------------------------------------------------------------

/**
 * Reduce importance of stale memories and purge very low-value ones.
 * - Semantic: reduce importance by 0.05 for memories not accessed in 30+ days
 * - Procedural: reduce confidence by 0.05 for procedures not updated in 30+ days
 * - Delete: remove very low-importance (<0.15) memories older than 90 days with <2 accesses
 */
async function runDecayCycle(): Promise<void> {
  const start = Date.now();

  // Decay stale semantic memories
  const decayedSemantic = await query<{ count: string }>(
    `WITH decayed AS (
       UPDATE forge_semantic_memories
       SET importance = GREATEST(importance - 0.05, 0.0)
       WHERE last_accessed < NOW() - INTERVAL '30 days'
         AND importance > 0.1
       RETURNING id
     )
     SELECT COUNT(*)::text AS count FROM decayed`,
  );

  // Decay stale procedural memories
  const decayedProcedural = await query<{ count: string }>(
    `WITH decayed AS (
       UPDATE forge_procedural_memories
       SET confidence = GREATEST(confidence - 0.05, 0.0)
       WHERE created_at < NOW() - INTERVAL '30 days'
         AND confidence > 0.1
       RETURNING id
     )
     SELECT COUNT(*)::text AS count FROM decayed`,
  );

  // Purge very low-value old memories
  const purgedSemantic = await query<{ count: string }>(
    `WITH purged AS (
       DELETE FROM forge_semantic_memories
       WHERE importance < 0.15
         AND access_count < 2
         AND created_at < NOW() - INTERVAL '90 days'
       RETURNING id
     )
     SELECT COUNT(*)::text AS count FROM purged`,
  );

  const elapsed = Date.now() - start;
  console.log(
    `[Metabolic] Decay cycle: ${decayedSemantic[0]?.count ?? 0} semantic decayed, ` +
    `${decayedProcedural[0]?.count ?? 0} procedural decayed, ` +
    `${purgedSemantic[0]?.count ?? 0} purged — ${elapsed}ms`,
  );
}

// --------------------------------------------------------------------------
// Lessons Cycle
// --------------------------------------------------------------------------

/**
 * Find failed executions and mark them as processed for lesson extraction.
 * Note: Full LLM-based lesson extraction requires runCliQuery which may be
 * expensive. For now, we create lightweight episodic markers.
 */
async function runLessonsCycle(): Promise<void> {
  const start = Date.now();

  // Find failed episodic memories not yet processed for lessons
  const failures = await query<{
    id: string;
    agent_id: string;
    owner_id: string;
    situation: string;
    action: string;
    outcome: string;
  }>(
    `SELECT id, agent_id, owner_id, situation, action, outcome
     FROM forge_episodic_memories
     WHERE outcome_quality < 0.3
       AND (metadata IS NULL OR NOT (metadata ? 'lesson_processed'))
     ORDER BY created_at DESC
     LIMIT 10`,
  );

  if (failures.length === 0) {
    console.log(`[Metabolic] Lessons cycle: no unprocessed failures — ${Date.now() - start}ms`);
    return;
  }

  // Mark each as processed (lesson extraction without LLM for now)
  for (const f of failures) {
    await query(
      `UPDATE forge_episodic_memories
       SET metadata = COALESCE(metadata, '{}'::jsonb) || '{"lesson_processed": true}'::jsonb
       WHERE id = $1`,
      [f.id],
    );
  }

  const elapsed = Date.now() - start;
  console.log(`[Metabolic] Lessons cycle: ${failures.length} failures processed — ${elapsed}ms`);
}

// --------------------------------------------------------------------------
// Promote Cycle
// --------------------------------------------------------------------------

/**
 * Boost high-performing memories:
 * - Procedural: boost confidence for procedures with >80% success rate and 3+ uses
 * - Semantic: boost importance for frequently accessed memories (10+ accesses)
 */
async function runPromoteCycle(): Promise<void> {
  const start = Date.now();

  // Boost high-success-rate procedures
  const promotedProcedural = await query<{ count: string }>(
    `WITH promoted AS (
       UPDATE forge_procedural_memories
       SET confidence = LEAST(confidence + 0.05, 1.0)
       WHERE (success_count + failure_count) >= 3
         AND success_count::float / GREATEST(success_count + failure_count, 1)::float > 0.8
         AND confidence < 0.95
       RETURNING id
     )
     SELECT COUNT(*)::text AS count FROM promoted`,
  );

  // Boost frequently accessed semantic memories
  const promotedSemantic = await query<{ count: string }>(
    `WITH promoted AS (
       UPDATE forge_semantic_memories
       SET importance = LEAST(importance + 0.05, 1.0)
       WHERE access_count >= 10
         AND importance < 0.95
       RETURNING id
     )
     SELECT COUNT(*)::text AS count FROM promoted`,
  );

  const elapsed = Date.now() - start;
  console.log(
    `[Metabolic] Promote cycle: ${promotedProcedural[0]?.count ?? 0} procedural boosted, ` +
    `${promotedSemantic[0]?.count ?? 0} semantic boosted — ${elapsed}ms`,
  );
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function logErr(cycle: string) {
  return (err: unknown) => {
    console.error(`[Metabolic] ${cycle} cycle error:`, err instanceof Error ? err.message : err);
  };
}
