/**
 * Forge-Native Metabolic Cycles
 * Simplified memory maintenance running as setInterval() inside Forge.
 * Three cycles: decay (prune stale), lessons (learn from failures), promote (boost winners).
 */

import { query } from '../database.js';
import { processUnprocessedFeedback } from '../learning/feedback-processor.js';
import { proposeAllRevisions } from '../learning/prompt-rewriter.js';
import { proposeAllGoals } from '../orchestration/goal-proposer.js';

// ============================================
// Cycle Status Tracking
// ============================================

export interface CycleResult {
  cycle: string;
  intervalHours: number;
  lastRun: string | null;
  lastDurationMs: number;
  lastResult: Record<string, number>;
  runCount: number;
  lastError: string | null;
}

const cycleStatus = new Map<string, CycleResult>();

function initCycleStatus(name: string, intervalHours: number): void {
  cycleStatus.set(name, {
    cycle: name,
    intervalHours,
    lastRun: null,
    lastDurationMs: 0,
    lastResult: {},
    runCount: 0,
    lastError: null,
  });
}

function recordCycleRun(name: string, durationMs: number, result: Record<string, number>): void {
  const status = cycleStatus.get(name);
  if (status) {
    status.lastRun = new Date().toISOString();
    status.lastDurationMs = durationMs;
    status.lastResult = result;
    status.runCount++;
    status.lastError = null;
  }
}

function recordCycleError(name: string, error: string): void {
  const status = cycleStatus.get(name);
  if (status) {
    status.lastError = error;
  }
}

export function getMetabolicStatus(): CycleResult[] {
  return Array.from(cycleStatus.values());
}

// ============================================
// Timers
// ============================================

let decayTimer: ReturnType<typeof setInterval> | null = null;
let lessonsTimer: ReturnType<typeof setInterval> | null = null;
let promoteTimer: ReturnType<typeof setInterval> | null = null;
let feedbackTimer: ReturnType<typeof setInterval> | null = null;
let promptRewriteTimer: ReturnType<typeof setInterval> | null = null;
let goalProposalTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start all metabolic cycles on intervals.
 * Call once during server startup after database is initialized.
 */
export function startMetabolicCycles(): void {
  // Initialize status tracking
  initCycleStatus('decay', 12);
  initCycleStatus('lessons', 4);
  initCycleStatus('promote', 2);
  initCycleStatus('feedback', 0.5);
  initCycleStatus('prompt-rewrite', 6);
  initCycleStatus('goal-proposal', 8);

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

  // Feedback processing: every 30 minutes
  feedbackTimer = setInterval(() => {
    void processUnprocessedFeedback().catch(logErr('feedback'));
  }, 30 * 60 * 1000);

  // Prompt rewrite proposals: every 6 hours (Phase 6)
  promptRewriteTimer = setInterval(() => {
    void proposeAllRevisions().catch(logErr('prompt-rewrite'));
  }, 6 * 60 * 60 * 1000);

  // Goal proposals: every 8 hours (Phase 9)
  goalProposalTimer = setInterval(() => {
    void proposeAllGoals().catch(logErr('goal-proposal'));
  }, 8 * 60 * 60 * 1000);

  console.log('[Metabolic] Cycles started — decay(12h), lessons(4h), promote(2h), feedback(30m), prompt-rewrite(6h), goals(8h)');
}

/**
 * Stop all metabolic cycles.
 */
export function stopMetabolicCycles(): void {
  if (decayTimer) clearInterval(decayTimer);
  if (lessonsTimer) clearInterval(lessonsTimer);
  if (promoteTimer) clearInterval(promoteTimer);
  if (feedbackTimer) clearInterval(feedbackTimer);
  if (promptRewriteTimer) clearInterval(promptRewriteTimer);
  if (goalProposalTimer) clearInterval(goalProposalTimer);
  decayTimer = null;
  lessonsTimer = null;
  promoteTimer = null;
  feedbackTimer = null;
  promptRewriteTimer = null;
  goalProposalTimer = null;
}

// --------------------------------------------------------------------------
// Decay Cycle
// --------------------------------------------------------------------------

async function runDecayCycle(): Promise<void> {
  const start = Date.now();

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
  const result = {
    semanticDecayed: parseInt(decayedSemantic[0]?.count ?? '0', 10),
    proceduralDecayed: parseInt(decayedProcedural[0]?.count ?? '0', 10),
    purged: parseInt(purgedSemantic[0]?.count ?? '0', 10),
  };
  recordCycleRun('decay', elapsed, result);

  console.log(
    `[Metabolic] Decay cycle: ${result.semanticDecayed} semantic decayed, ` +
    `${result.proceduralDecayed} procedural decayed, ` +
    `${result.purged} purged — ${elapsed}ms`,
  );
}

// --------------------------------------------------------------------------
// Lessons Cycle
// --------------------------------------------------------------------------

async function runLessonsCycle(): Promise<void> {
  const start = Date.now();

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
    const elapsed = Date.now() - start;
    recordCycleRun('lessons', elapsed, { processed: 0 });
    console.log(`[Metabolic] Lessons cycle: no unprocessed failures — ${elapsed}ms`);
    return;
  }

  for (const f of failures) {
    await query(
      `UPDATE forge_episodic_memories
       SET metadata = COALESCE(metadata, '{}'::jsonb) || '{"lesson_processed": true}'::jsonb
       WHERE id = $1`,
      [f.id],
    );
  }

  const elapsed = Date.now() - start;
  recordCycleRun('lessons', elapsed, { processed: failures.length });
  console.log(`[Metabolic] Lessons cycle: ${failures.length} failures processed — ${elapsed}ms`);
}

// --------------------------------------------------------------------------
// Promote Cycle
// --------------------------------------------------------------------------

async function runPromoteCycle(): Promise<void> {
  const start = Date.now();

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
  const result = {
    proceduralBoosted: parseInt(promotedProcedural[0]?.count ?? '0', 10),
    semanticBoosted: parseInt(promotedSemantic[0]?.count ?? '0', 10),
  };
  recordCycleRun('promote', elapsed, result);

  console.log(
    `[Metabolic] Promote cycle: ${result.proceduralBoosted} procedural boosted, ` +
    `${result.semanticBoosted} semantic boosted — ${elapsed}ms`,
  );
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function logErr(cycle: string) {
  return (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    recordCycleError(cycle, msg);
    console.error(`[Metabolic] ${cycle} cycle error:`, msg);
  };
}
