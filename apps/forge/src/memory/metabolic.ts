/**
 * Forge-Native Metabolic Cycles
 * Simplified memory maintenance running as setInterval() inside Forge.
 * Three cycles: decay (prune stale), lessons (learn from failures), promote (boost winners).
 */

import { query } from '../database.js';
import { substrateQuery } from '../database.js';
import { processUnprocessedFeedback, getAgentFeedbackStats } from '../learning/feedback-processor.js';
import { proposeAllRevisions, applyPromptRevision, proposePromptRevision } from '../learning/prompt-rewriter.js';
import { proposeAllGoals, proposeGoals, approveGoal } from '../orchestration/goal-proposer.js';
import { selectOptimalModel } from '../orchestration/cost-router.js';
import { getMemoryManager } from './singleton.js';
import { healStuckExecutions } from '../orchestration/monitoring-agent.js';
import { detectCapabilities } from '../orchestration/capability-registry.js';
import { promoteVariant } from '../orchestration/evolution.js';
import { orchestrateFromNL, getOrchestrationStatus } from '../orchestration/nl-orchestrator.js';
import { shouldDecompose } from '../orchestration/task-decomposer.js';
import { initConsciousness, startIntegrationCycle, stopIntegrationCycle } from '../consciousness/index.js';
import { getMemoryRedis } from './singleton.js';

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
let autonomyLoopTimer: ReturnType<typeof setInterval> | null = null;

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
  initCycleStatus('autonomy-loop', 0.25);
  initCycleStatus('integration', 0.083); // 5 minutes

  // Initialize consciousness layer
  const redis = getMemoryRedis();
  if (redis) {
    void initConsciousness(redis).then(() => {
      startIntegrationCycle();
    }).catch((err) => {
      console.error('[Metabolic] Failed to initialize consciousness:', err);
    });
  }

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

  // Autonomy loop: every 15 minutes (Level 4)
  // Auto-approves goals, converts to tickets, applies prompt revisions, optimizes models
  autonomyLoopTimer = setInterval(() => {
    void runAutonomyLoop().catch(logErr('autonomy-loop'));
  }, 15 * 60 * 1000);

  // Run autonomy loop 2 min after startup
  setTimeout(() => {
    void runAutonomyLoop().catch(logErr('autonomy-loop'));
  }, 2 * 60 * 1000);

  console.log('[Metabolic] Cycles started — decay(12h), lessons(4h), promote(2h), feedback(30m), prompt-rewrite(6h), goals(8h), autonomy(15m), integration(5m)');
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
  if (autonomyLoopTimer) clearInterval(autonomyLoopTimer);
  stopIntegrationCycle();
  decayTimer = null;
  lessonsTimer = null;
  promoteTimer = null;
  feedbackTimer = null;
  promptRewriteTimer = null;
  goalProposalTimer = null;
  autonomyLoopTimer = null;
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
// Autonomy Loop (Level 4) — self-governance for high-autonomy agents
// --------------------------------------------------------------------------

async function runAutonomyLoop(): Promise<void> {
  const start = Date.now();
  let goalsApproved = 0;
  let goalsTicketed = 0;
  let promptsApplied = 0;
  let modelsOptimized = 0;

  // Step 1: Auto-approve goals for high-autonomy agents (autonomy >= 4)
  try {
    const proposedGoals = await query<{ id: string; agent_id: string; title: string; agent_name: string }>(
      `SELECT g.id, g.agent_id, g.title, a.name AS agent_name
       FROM forge_agent_goals g
       JOIN forge_agents a ON g.agent_id = a.id
       WHERE g.status = 'proposed' AND a.autonomy_level >= 4
       LIMIT 10`,
    );

    for (const goal of proposedGoals) {
      const approved = await approveGoal(goal.id, 'system:autonomy');
      if (approved) {
        goalsApproved++;
        console.log(`[Autonomy] Auto-approved goal "${goal.title}" for ${goal.agent_name}`);
      }
    }
  } catch (err) {
    console.warn('[Autonomy] Goal auto-approval error:', err instanceof Error ? err.message : err);
  }

  // Step 2: Convert approved goals to tickets (all agents, not just high-autonomy)
  try {
    const approvedGoals = await query<{
      id: string; agent_id: string; title: string; description: string;
      priority: string; agent_name: string;
    }>(
      `SELECT g.id, g.agent_id, g.title, g.description, g.priority, a.name AS agent_name
       FROM forge_agent_goals g
       JOIN forge_agents a ON g.agent_id = a.id
       WHERE g.status = 'approved'
       LIMIT 10`,
    );

    for (const goal of approvedGoals) {
      // Check if ticket already exists for this goal
      const existing = await substrateQuery<{ id: string }>(
        `SELECT id FROM agent_tickets
         WHERE metadata->>'goal_id' = $1 AND status IN ('open', 'in_progress')
         LIMIT 1`,
        [goal.id],
      );
      if (existing.length > 0) continue;

      const ticketId = `GOAL-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;
      const priority = goal.priority === 'critical' ? 'urgent' : goal.priority === 'high' ? 'high' : 'medium';

      await substrateQuery(
        `INSERT INTO agent_tickets
         (id, title, description, status, priority, category, created_by, assigned_to,
          agent_id, agent_name, is_agent_ticket, source, metadata)
         VALUES ($1, $2, $3, 'open', $4, 'goal', 'system:autonomy', $5,
          $6, $7, true, 'agent', $8)`,
        [
          ticketId,
          `[GOAL] ${goal.title}`,
          goal.description,
          priority,
          goal.agent_name,
          goal.agent_id,
          goal.agent_name,
          JSON.stringify({ goal_id: goal.id, auto_created: true }),
        ],
      );

      // Mark goal as in_progress
      await query(
        `UPDATE forge_agent_goals SET status = 'in_progress' WHERE id = $1`,
        [goal.id],
      );

      goalsTicketed++;
      console.log(`[Autonomy] Created ticket for goal "${goal.title}" → assigned to ${goal.agent_name}`);
    }
  } catch (err) {
    console.warn('[Autonomy] Goal→ticket conversion error:', err instanceof Error ? err.message : err);
  }

  // Step 3: Auto-apply prompt revisions for high-autonomy agents (autonomy >= 4)
  try {
    const pendingRevisions = await query<{ id: string; agent_id: string; agent_name: string }>(
      `SELECT r.id, r.agent_id, a.name AS agent_name
       FROM forge_prompt_revisions r
       JOIN forge_agents a ON r.agent_id = a.id
       WHERE r.status = 'pending' AND a.autonomy_level >= 4
       LIMIT 5`,
    );

    for (const rev of pendingRevisions) {
      const applied = await applyPromptRevision(rev.id, 'system:autonomy');
      if (applied) {
        promptsApplied++;
        console.log(`[Autonomy] Auto-applied prompt revision for ${rev.agent_name}`);
      }
    }
  } catch (err) {
    console.warn('[Autonomy] Prompt auto-apply error:', err instanceof Error ? err.message : err);
  }

  // Step 4: Auto-optimize model selection for agents with autonomy >= 3
  try {
    const agents = await query<{
      id: string; name: string; model_id: string; autonomy_level: number;
    }>(
      `SELECT id, name, model_id, autonomy_level FROM forge_agents
       WHERE status = 'active' AND autonomy_level >= 3
         AND (is_decommissioned IS NULL OR is_decommissioned = false)`,
    );

    for (const agent of agents) {
      // Get agent's primary capability (highest proficiency)
      const cap = await query<{ capability: string }>(
        `SELECT capability FROM forge_agent_capabilities
         WHERE agent_id = $1 ORDER BY proficiency DESC LIMIT 1`,
        [agent.id],
      );
      if (cap.length === 0) continue;

      const recommendation = await selectOptimalModel(cap[0]!.capability, 0.7);
      if (recommendation.modelId !== agent.model_id && !recommendation.reason.includes('default')) {
        // Verify the recommendation has enough samples
        const profile = await query<{ sample_count: string }>(
          `SELECT sample_count::text FROM forge_cost_profiles
           WHERE capability = $1 AND model_id = $2`,
          [cap[0]!.capability, recommendation.modelId],
        );
        if (parseInt(profile[0]?.sample_count ?? '0') < 5) continue;

        await query(
          `UPDATE forge_agents SET model_id = $1, updated_at = NOW() WHERE id = $2`,
          [recommendation.modelId, agent.id],
        );
        modelsOptimized++;
        console.log(`[Autonomy] Switched ${agent.name} from ${agent.model_id} to ${recommendation.modelId} (${recommendation.reason})`);
      }
    }
  } catch (err) {
    console.warn('[Autonomy] Cost optimization error:', err instanceof Error ? err.message : err);
  }

  // Step 5: Decommission failing agents (Level 5 — Vibe Reproduction)
  let agentsDecommissioned = 0;
  let agentsFlagged = 0;
  try {
    const failingAgents = await query<{
      id: string; name: string; autonomy_level: number;
      tasks_completed: string; tasks_failed: string;
    }>(
      `SELECT id, name, autonomy_level,
              COALESCE(tasks_completed, 0)::text AS tasks_completed,
              COALESCE(tasks_failed, 0)::text AS tasks_failed
       FROM forge_agents
       WHERE status = 'active'
         AND (is_decommissioned IS NULL OR is_decommissioned = false)
         AND (COALESCE(metadata->>'system_agent', 'false') != 'true')
         AND (COALESCE(tasks_completed, 0) + COALESCE(tasks_failed, 0)) > 10
         AND COALESCE(tasks_failed, 0)::float / GREATEST(COALESCE(tasks_completed, 0) + COALESCE(tasks_failed, 0), 1)::float > 0.6`,
    );

    for (const agent of failingAgents) {
      const completed = parseInt(agent.tasks_completed);
      const failed = parseInt(agent.tasks_failed);
      const failRate = (failed / (completed + failed) * 100).toFixed(0);

      if (agent.autonomy_level >= 3) {
        // Auto-decommission high-autonomy failing agents
        await query(
          `UPDATE forge_agents SET is_decommissioned = true, status = 'paused', updated_at = NOW() WHERE id = $1`,
          [agent.id],
        );
        agentsDecommissioned++;
        console.log(`[Autonomy] Decommissioned ${agent.name} (${failRate}% failure rate, ${completed + failed} tasks)`);

        // Audit trail
        try {
          await substrateQuery(
            `INSERT INTO agent_audit_log (entity_type, entity_id, action, actor, old_value, new_value)
             VALUES ('agent', $1, 'decommissioned', 'system:autonomy', $2, $3)`,
            [
              agent.id,
              JSON.stringify({ status: 'active', is_decommissioned: false }),
              JSON.stringify({ status: 'paused', is_decommissioned: true, reason: `${failRate}% failure rate`, tasks_completed: completed, tasks_failed: failed }),
            ],
          );
        } catch { /* non-fatal */ }
      } else {
        // Flag lower-autonomy agents for human review via finding
        try {
          const findingId = `DECOMM-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;
          await substrateQuery(
            `INSERT INTO agent_findings (id, agent_id, agent_name, finding, severity, category, metadata)
             VALUES ($1, $2, $3, $4, 'warning', 'performance', $5)
             ON CONFLICT DO NOTHING`,
            [
              findingId,
              agent.id,
              agent.name,
              `Agent "${agent.name}" has a ${failRate}% failure rate (${failed}/${completed + failed} tasks). Consider decommissioning.`,
              JSON.stringify({ fail_rate: parseFloat(failRate), tasks_completed: completed, tasks_failed: failed }),
            ],
          );
          agentsFlagged++;
        } catch { /* non-fatal */ }
      }
    }
  } catch (err) {
    console.warn('[Autonomy] Decommission check error:', err instanceof Error ? err.message : err);
  }

  // Step 6: Promote high-frequency correction patterns to fleet-wide semantic memories (Level 7 — Vibe Memory)
  let correctionsPromoted = 0;
  try {
    const MAX_PROMOTIONS = 5;

    // Find correction patterns seen 3+ times that haven't been promoted yet
    const patterns = await query<{
      id: string; agent_id: string; description: string; pattern_type: string;
      frequency: number; confidence: string; embedding: string | null;
    }>(
      `SELECT id, agent_id, description, pattern_type, frequency,
              confidence::text, embedding::text
       FROM forge_correction_patterns
       WHERE frequency >= 3
         AND (examples->0 IS NOT NULL)
       ORDER BY frequency DESC, confidence DESC
       LIMIT 20`,
    );

    for (const pattern of patterns) {
      if (correctionsPromoted >= MAX_PROMOTIONS) break;

      // Check if a similar memory already exists fleet-wide
      // Use the pattern's own embedding if available, otherwise skip
      if (!pattern.embedding) continue;

      const existing = await query<{ similarity: string }>(
        `SELECT 1 - (embedding <=> $1::vector) AS similarity
         FROM forge_semantic_memories
         WHERE 1 - (embedding <=> $1::vector) > 0.85
         LIMIT 1`,
        [pattern.embedding],
      );

      if (existing.length > 0) continue; // Already exists in fleet memory

      // Store as fleet-accessible semantic memory
      // Use a dedicated "fleet" agent ID so it surfaces in recallFleet() for all agents
      const content = `[Correction Pattern — ${pattern.pattern_type}] ${pattern.description} (observed ${pattern.frequency} times, confidence: ${pattern.confidence})`;

      try {
        const mm = getMemoryManager();
        await mm.store('fleet', {
          type: 'semantic',
          ownerId: 'system:correction-promotion',
          content,
          options: {
            source: 'correction-promotion',
            importance: 0.9,
            metadata: {
              correction_pattern_id: pattern.id,
              original_agent_id: pattern.agent_id,
              pattern_type: pattern.pattern_type,
              frequency: pattern.frequency,
            },
          },
        });
        correctionsPromoted++;
        console.log(`[Autonomy] Promoted correction "${pattern.description.substring(0, 60)}..." to fleet memory (freq=${pattern.frequency})`);
      } catch (storeErr) {
        console.warn('[Autonomy] Failed to promote correction:', storeErr instanceof Error ? storeErr.message : storeErr);
      }
    }
  } catch (err) {
    console.warn('[Autonomy] Correction promotion error:', err instanceof Error ? err.message : err);
  }

  // Step 7: Anomaly detection + auto-heal (Level 8 — Vibe Self-Awareness)
  let anomaliesDetected = 0;
  let autoHealed = 0;
  try {
    // Compare last 1h failure rate vs 24h baseline
    const lastHour = await query<{ total: string; failed: string; total_cost: string }>(
      `SELECT COUNT(*)::text AS total,
              COUNT(*) FILTER (WHERE status = 'failed')::text AS failed,
              COALESCE(SUM(cost), 0)::text AS total_cost
       FROM forge_executions
       WHERE started_at > NOW() - INTERVAL '1 hour'`,
    );
    const baseline = await query<{ total: string; failed: string; total_cost: string }>(
      `SELECT COUNT(*)::text AS total,
              COUNT(*) FILTER (WHERE status = 'failed')::text AS failed,
              COALESCE(SUM(cost), 0)::text AS total_cost
       FROM forge_executions
       WHERE started_at BETWEEN NOW() - INTERVAL '24 hours' AND NOW() - INTERVAL '1 hour'`,
    );

    const hourTotal = parseInt(lastHour[0]?.total ?? '0', 10);
    const hourFailed = parseInt(lastHour[0]?.failed ?? '0', 10);
    const hourCost = parseFloat(lastHour[0]?.total_cost ?? '0');
    const baseTotal = parseInt(baseline[0]?.total ?? '0', 10);
    const baseFailed = parseInt(baseline[0]?.failed ?? '0', 10);
    const baseCost = parseFloat(baseline[0]?.total_cost ?? '0');
    const baseHours = 23;

    const hourFailRate = hourTotal > 0 ? hourFailed / hourTotal : 0;
    const baseFailRate = baseTotal > 0 ? baseFailed / baseTotal : 0;
    const hourlyBaseCost = baseHours > 0 ? baseCost / baseHours : 0;

    // Failure rate spike: >2x baseline AND >30% absolute AND >=3 executions
    if (hourTotal >= 3 && hourFailRate > baseFailRate * 2 && hourFailRate > 0.3) {
      anomaliesDetected++;
      const severity = hourFailRate > 0.6 ? 'critical' : 'warning';
      const findingId = `ANOMALY-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;
      await substrateQuery(
        `INSERT INTO agent_findings (id, agent_id, agent_name, finding, severity, category, metadata)
         VALUES ($1, 'system:autonomy', 'Autonomy Loop', $2, $3, 'anomaly', $4)
         ON CONFLICT DO NOTHING`,
        [
          findingId,
          `Failure rate spike: ${(hourFailRate * 100).toFixed(0)}% (last hour) vs ${(baseFailRate * 100).toFixed(0)}% (baseline). ${hourFailed}/${hourTotal} executions failed.`,
          severity,
          JSON.stringify({ type: 'failure_rate_spike', hour_rate: hourFailRate, base_rate: baseFailRate, hour_total: hourTotal }),
        ],
      );
      console.log(`[Autonomy] Anomaly: failure rate ${(hourFailRate * 100).toFixed(0)}% (${severity})`);

      // Auto-heal stuck executions on critical failure spikes
      if (severity === 'critical') {
        const healed = await healStuckExecutions();
        if (healed > 0) {
          autoHealed += healed;
          console.log(`[Autonomy] Auto-healed ${healed} stuck execution(s)`);
        }
      }
    }

    // Cost spike: >3x baseline hourly cost
    if (hourlyBaseCost > 0.01 && hourCost > hourlyBaseCost * 3) {
      anomaliesDetected++;
      const severity = hourCost > hourlyBaseCost * 5 ? 'critical' : 'warning';
      const findingId = `ANOMALY-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;
      await substrateQuery(
        `INSERT INTO agent_findings (id, agent_id, agent_name, finding, severity, category, metadata)
         VALUES ($1, 'system:autonomy', 'Autonomy Loop', $2, $3, 'anomaly', $4)
         ON CONFLICT DO NOTHING`,
        [
          findingId,
          `Cost spike: $${hourCost.toFixed(2)} (last hour) vs $${hourlyBaseCost.toFixed(2)}/hr (baseline). ${(hourCost / hourlyBaseCost).toFixed(1)}x normal.`,
          severity,
          JSON.stringify({ type: 'cost_spike', hour_cost: hourCost, baseline_hourly: hourlyBaseCost }),
        ],
      );
      console.log(`[Autonomy] Anomaly: cost spike $${hourCost.toFixed(2)} vs $${hourlyBaseCost.toFixed(2)}/hr (${severity})`);
    }

    // Per-agent failure detection: >50% failure rate in last hour, min 3 executions
    const failingAgentsNow = await query<{
      agent_id: string; agent_name: string; total: string; failed: string; autonomy_level: number;
    }>(
      `SELECT e.agent_id, a.name AS agent_name,
              COUNT(*)::text AS total,
              COUNT(*) FILTER (WHERE e.status = 'failed')::text AS failed,
              a.autonomy_level
       FROM forge_executions e
       JOIN forge_agents a ON e.agent_id = a.id
       WHERE e.started_at > NOW() - INTERVAL '1 hour'
       GROUP BY e.agent_id, a.name, a.autonomy_level
       HAVING COUNT(*) >= 3
          AND COUNT(*) FILTER (WHERE e.status = 'failed')::float / COUNT(*)::float > 0.5`,
    );

    for (const fa of failingAgentsNow) {
      anomaliesDetected++;
      const failRate = parseInt(fa.failed, 10) / parseInt(fa.total, 10);

      // Auto-rebalance high-autonomy agents with >70% failure rate
      if (fa.autonomy_level >= 4 && failRate > 0.7) {
        try {
          const schedule = await substrateQuery<{ schedule_interval_minutes: number }>(
            `SELECT schedule_interval_minutes FROM agent_schedules WHERE agent_id = $1`,
            [fa.agent_id],
          );
          if (schedule.length > 0) {
            const current = schedule[0]!.schedule_interval_minutes;
            const newInterval = Math.min(current * 2, 240);
            if (newInterval > current) {
              await substrateQuery(
                `UPDATE agent_schedules SET schedule_interval_minutes = $1, next_run_at = NOW() + INTERVAL '1 minute' * $1 WHERE agent_id = $2`,
                [newInterval, fa.agent_id],
              );
              autoHealed++;
              console.log(`[Autonomy] Auto-rebalanced ${fa.agent_name}: ${current}m → ${newInterval}m (${(failRate * 100).toFixed(0)}% failure rate)`);
            }
          }
        } catch { /* non-fatal */ }
      }
    }
  } catch (err) {
    console.warn('[Autonomy] Anomaly detection error:', err instanceof Error ? err.message : err);
  }

  // Step 8: Auto-evolution for top performers (Level 9 — Vibe Evolution)
  let autoEvolved = 0;
  try {
    const MAX_AUTO_EVOLUTIONS = 3;

    // Find top-performing agents eligible for auto-evolution
    const topAgents = await query<{
      id: string; name: string; autonomy_level: number;
      tasks_completed: string; tasks_failed: string;
    }>(
      `SELECT id, name, autonomy_level,
              COALESCE(tasks_completed, 0)::text AS tasks_completed,
              COALESCE(tasks_failed, 0)::text AS tasks_failed
       FROM forge_agents
       WHERE status = 'active'
         AND autonomy_level >= 4
         AND (is_decommissioned IS NULL OR is_decommissioned = false)
         AND COALESCE(tasks_completed, 0) >= 20
         AND COALESCE(tasks_completed, 0)::float /
             GREATEST(COALESCE(tasks_completed, 0) + COALESCE(tasks_failed, 0), 1)::float >= 0.8`,
    );

    for (const agent of topAgents) {
      if (autoEvolved >= MAX_AUTO_EVOLUTIONS) break;

      // Check for pending prompt revisions — auto-propose if none exist
      const pendingRevisions = await query<{ id: string }>(
        `SELECT id FROM forge_prompt_revisions
         WHERE agent_id = $1 AND status = 'pending'
         LIMIT 1`,
        [agent.id],
      );

      if (pendingRevisions.length === 0) {
        // Try to propose a revision based on correction patterns
        try {
          const revision = await proposePromptRevision(agent.id);
          if (revision) {
            autoEvolved++;
            console.log(`[Autonomy] Auto-proposed prompt revision for ${agent.name}`);
          }
        } catch { /* non-fatal — may fail if no correction patterns */ }
      }

      // Check for completed experiments with winning variants — auto-promote
      const winningExperiments = await query<{
        id: string; variant_score: number; parent_score: number;
      }>(
        `SELECT id, variant_score, parent_score
         FROM forge_evolution_experiments
         WHERE parent_agent_id = $1
           AND status = 'completed'
           AND winner = 'variant'
           AND variant_score - parent_score >= 5
         ORDER BY completed_at DESC
         LIMIT 1`,
        [agent.id],
      );

      for (const exp of winningExperiments) {
        if (autoEvolved >= MAX_AUTO_EVOLUTIONS) break;
        try {
          const promoted = await promoteVariant(exp.id);
          if (promoted) {
            autoEvolved++;
            console.log(`[Autonomy] Auto-promoted winning variant for ${agent.name} (score: ${exp.variant_score} vs ${exp.parent_score})`);
          }
        } catch { /* non-fatal */ }
      }
    }
  } catch (err) {
    console.warn('[Autonomy] Auto-evolution error:', err instanceof Error ? err.message : err);
  }

  // ------------------------------------------------------------------
  // Step 9: Auto-orchestrate complex approved goals (Level 10)
  // ------------------------------------------------------------------
  let autoOrchestrated = 0;
  const MAX_AUTO_ORCHESTRATIONS = 2;

  try {
    // Find approved goals that are complex enough to decompose
    const approvedGoals = await query<{
      id: string;
      agent_id: string;
      description: string;
      metadata: Record<string, unknown> | null;
    }>(
      `SELECT g.id, g.agent_id, g.description, g.metadata
       FROM forge_agent_goals g
       JOIN forge_agents a ON a.id = g.agent_id
       WHERE g.status = 'approved'
         AND a.autonomy_level >= 4
         AND (a.is_decommissioned IS NULL OR a.is_decommissioned = false)
         AND (g.metadata IS NULL OR g.metadata->>'orchestration_session_id' IS NULL)
       ORDER BY g.created_at ASC
       LIMIT 5`,
    );

    for (const goal of approvedGoals) {
      if (autoOrchestrated >= MAX_AUTO_ORCHESTRATIONS) break;

      // Check if task is complex enough to warrant orchestration
      if (!shouldDecompose(goal.description)) continue;

      try {
        const result = await orchestrateFromNL({
          instruction: goal.description,
          ownerId: goal.agent_id,
          maxAgents: 4,
          autoApprove: true,
        });

        // Mark goal as in_progress with session reference
        await query(
          `UPDATE forge_agent_goals
           SET status = 'in_progress',
               metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('orchestration_session_id', $1::text, 'orchestrated_at', NOW()::text),
               updated_at = NOW()
           WHERE id = $2`,
          [result.sessionId, goal.id],
        );

        autoOrchestrated++;
        console.log(`[Autonomy] Auto-orchestrated goal "${goal.description.substring(0, 60)}..." → session ${result.sessionId} (${result.totalTasks} tasks)`);
      } catch { /* non-fatal */ }
    }
  } catch (err) {
    console.warn('[Autonomy] Auto-orchestration error:', err instanceof Error ? err.message : err);
  }

  // ------------------------------------------------------------------
  // Step 10: Goal lifecycle management (Level 11)
  // ------------------------------------------------------------------
  let goalsCompleted = 0;
  let goalsRequeued = 0;
  let goalsAutoProposed = 0;
  const MAX_GOAL_COMPLETIONS = 3;
  const MAX_GOAL_PROPOSALS = 2;

  try {
    // Check in_progress goals with orchestration sessions — mark complete or requeue
    const inProgressGoals = await query<{
      id: string;
      agent_id: string;
      title: string;
      metadata: Record<string, unknown> | null;
    }>(
      `SELECT id, agent_id, title, metadata
       FROM forge_agent_goals
       WHERE status = 'in_progress'
         AND metadata->>'orchestration_session_id' IS NOT NULL
       LIMIT 10`,
    );

    for (const goal of inProgressGoals) {
      if (goalsCompleted + goalsRequeued >= MAX_GOAL_COMPLETIONS) break;

      const sessionId = goal.metadata?.['orchestration_session_id'] as string | undefined;
      if (!sessionId) continue;

      try {
        const status = await getOrchestrationStatus(sessionId);
        // Only process if all tasks are done (no running or pending)
        if (status.running > 0 || status.pending > 0) continue;

        if (status.failed === 0 && status.completed > 0) {
          // All tasks completed successfully → mark goal complete
          await query(
            `UPDATE forge_agent_goals
             SET status = 'completed',
                 metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('completed_at', NOW()::text, 'tasks_completed', $1::text),
                 updated_at = NOW()
             WHERE id = $2`,
            [String(status.completed), goal.id],
          );
          goalsCompleted++;
          console.log(`[Autonomy] Goal completed: "${goal.title}" (${status.completed} tasks succeeded)`);
        } else if (status.completed === 0 && status.failed > 0) {
          // All tasks failed → requeue for retry
          await query(
            `UPDATE forge_agent_goals
             SET status = 'approved',
                 metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('requeued_at', NOW()::text, 'tasks_failed', $1::text),
                 updated_at = NOW()
             WHERE id = $2`,
            [String(status.failed), goal.id],
          );
          goalsRequeued++;
          console.log(`[Autonomy] Goal requeued: "${goal.title}" (${status.failed} tasks failed)`);
        }
        // Mixed results: leave in_progress for manual review
      } catch { /* non-fatal */ }
    }

    // Auto-propose goals for high-autonomy agents with stale goals
    const staleAgents = await query<{ id: string; name: string }>(
      `SELECT a.id, a.name
       FROM forge_agents a
       WHERE a.autonomy_level >= 4
         AND (a.is_decommissioned IS NULL OR a.is_decommissioned = false)
         AND a.tasks_completed + a.tasks_failed >= 5
         AND NOT EXISTS (
           SELECT 1 FROM forge_agent_goals g
           WHERE g.agent_id = a.id AND g.created_at > NOW() - INTERVAL '7 days'
         )
       LIMIT 5`,
    );

    for (const agent of staleAgents) {
      if (goalsAutoProposed >= MAX_GOAL_PROPOSALS) break;
      try {
        const goals = await proposeGoals(agent.id);
        if (goals.length > 0) {
          goalsAutoProposed++;
          console.log(`[Autonomy] Auto-proposed ${goals.length} goals for ${agent.name}`);
        }
      } catch { /* non-fatal */ }
    }
  } catch (err) {
    console.warn('[Autonomy] Goal lifecycle error:', err instanceof Error ? err.message : err);
  }

  // ------------------------------------------------------------------
  // Step 11: Feedback-driven autonomy review (Level 12)
  // ------------------------------------------------------------------
  let autonomyIncreased = 0;
  let autonomyDecreased = 0;
  const MAX_AUTONOMY_ADJUSTMENTS = 3;

  try {
    // Get agents with sufficient feedback history for review
    const reviewAgents = await query<{
      id: string;
      name: string;
      autonomy_level: number;
    }>(
      `SELECT a.id, a.name, a.autonomy_level
       FROM forge_agents a
       WHERE (a.is_decommissioned IS NULL OR a.is_decommissioned = false)
         AND a.status != 'error'
         AND EXISTS (
           SELECT 1 FROM forge_execution_feedback f
           WHERE f.agent_id = a.id
           HAVING COUNT(*) >= 10
         )
       LIMIT 10`,
    );

    for (const agent of reviewAgents) {
      if (autonomyIncreased + autonomyDecreased >= MAX_AUTONOMY_ADJUSTMENTS) break;

      try {
        const stats = await getAgentFeedbackStats(agent.id);
        if (stats.total < 10) continue;

        const correctionRate = stats.corrections / stats.total;
        const praiseRate = stats.praises / stats.total;

        // High correction rate → reduce autonomy
        if (correctionRate > 0.4 && agent.autonomy_level > 2) {
          await query(
            `UPDATE forge_agents SET autonomy_level = autonomy_level - 1, updated_at = NOW() WHERE id = $1`,
            [agent.id],
          );
          autonomyDecreased++;
          console.log(`[Autonomy] Reduced autonomy for ${agent.name}: correction rate ${Math.round(correctionRate * 100)}% (${agent.autonomy_level} → ${agent.autonomy_level - 1})`);
        }
        // High praise rate → increase autonomy
        else if (praiseRate > 0.7 && agent.autonomy_level < 4) {
          await query(
            `UPDATE forge_agents SET autonomy_level = autonomy_level + 1, updated_at = NOW() WHERE id = $1`,
            [agent.id],
          );
          autonomyIncreased++;
          console.log(`[Autonomy] Increased autonomy for ${agent.name}: praise rate ${Math.round(praiseRate * 100)}% (${agent.autonomy_level} → ${agent.autonomy_level + 1})`);
        }
      } catch { /* non-fatal */ }
    }
  } catch (err) {
    console.warn('[Autonomy] Feedback review error:', err instanceof Error ? err.message : err);
  }

  // ------------------------------------------------------------------
  // Step 12: Guardrail violation review (Level 13)
  // ------------------------------------------------------------------
  let guardrailViolationsReviewed = 0;
  const MAX_VIOLATION_ADJUSTMENTS = 3;

  try {
    // Find agents with frequent guardrail violations in last 24h
    const violators = await query<{
      agent_id: string;
      agent_name: string;
      violation_count: string;
      autonomy_level: number;
    }>(
      `SELECT a.id AS agent_id, a.name AS agent_name,
              COUNT(*)::text AS violation_count, a.autonomy_level
       FROM forge_audit_log al
       JOIN forge_agents a ON al.owner_id = a.id OR al.details->>'agent_id' = a.id
       WHERE al.action = 'guardrail_violation'
         AND al.created_at > NOW() - INTERVAL '24 hours'
         AND (a.is_decommissioned IS NULL OR a.is_decommissioned = false)
         AND (COALESCE(a.metadata->>'system_agent', 'false') != 'true')
       GROUP BY a.id, a.name, a.autonomy_level
       HAVING COUNT(*) >= 5`,
    );

    for (const violator of violators) {
      if (guardrailViolationsReviewed >= MAX_VIOLATION_ADJUSTMENTS) break;

      if (violator.autonomy_level > 1) {
        await query(
          `UPDATE forge_agents SET autonomy_level = autonomy_level - 1, updated_at = NOW() WHERE id = $1`,
          [violator.agent_id],
        );
        guardrailViolationsReviewed++;
        console.log(`[Autonomy] Reduced autonomy for ${violator.agent_name}: ${violator.violation_count} guardrail violations in 24h (${violator.autonomy_level} → ${violator.autonomy_level - 1})`);
      }
    }
  } catch (err) {
    console.warn('[Autonomy] Guardrail violation review error:', err instanceof Error ? err.message : err);
  }

  // ------------------------------------------------------------------
  // Step 13: Checkpoint timeout cleanup (Level 14)
  // ------------------------------------------------------------------
  let checkpointsExpired = 0;

  try {
    const expired = await query<{ count: string }>(
      `WITH expired AS (
         UPDATE forge_checkpoints
         SET status = 'timeout'
         WHERE status = 'pending'
           AND timeout_at IS NOT NULL
           AND timeout_at < NOW()
         RETURNING id
       )
       SELECT COUNT(*)::text AS count FROM expired`,
    );
    checkpointsExpired = parseInt(expired[0]?.count ?? '0', 10);

    if (checkpointsExpired > 0) {
      console.log(`[Autonomy] Expired ${checkpointsExpired} timed-out checkpoint(s)`);
    }
  } catch (err) {
    console.warn('[Autonomy] Checkpoint cleanup error:', err instanceof Error ? err.message : err);
  }

  // ------------------------------------------------------------------
  // Step 14: Capability drift detection (Level 15)
  // ------------------------------------------------------------------
  let capabilitiesRefreshed = 0;
  const MAX_CAPABILITY_REFRESHES = 5;

  try {
    // Find agents whose top capability proficiency dropped below 30
    const driftedAgents = await query<{ agent_id: string; agent_name: string; top_proficiency: string }>(
      `SELECT c.agent_id, a.name AS agent_name, MAX(c.proficiency)::text AS top_proficiency
       FROM forge_agent_capabilities c
       JOIN forge_agents a ON a.id = c.agent_id
       WHERE a.status = 'active'
         AND (a.is_decommissioned IS NULL OR a.is_decommissioned = false)
       GROUP BY c.agent_id, a.name
       HAVING MAX(c.proficiency) < 30
       LIMIT ${MAX_CAPABILITY_REFRESHES}`,
    );

    for (const agent of driftedAgents) {
      try {
        await detectCapabilities(agent.agent_id);
        capabilitiesRefreshed++;
        console.log(`[Autonomy] Refreshed capabilities for ${agent.agent_name} (top proficiency was ${agent.top_proficiency})`);
      } catch { /* non-fatal */ }
    }
  } catch (err) {
    console.warn('[Autonomy] Capability drift detection error:', err instanceof Error ? err.message : err);
  }

  const elapsed = Date.now() - start;
  recordCycleRun('autonomy-loop', elapsed, { goalsApproved, goalsTicketed, promptsApplied, modelsOptimized, agentsDecommissioned, agentsFlagged, correctionsPromoted, anomaliesDetected, autoHealed, autoEvolved, autoOrchestrated, goalsCompleted, goalsRequeued, goalsAutoProposed, autonomyIncreased, autonomyDecreased, guardrailViolationsReviewed, checkpointsExpired, capabilitiesRefreshed });

  const total = goalsApproved + goalsTicketed + promptsApplied + modelsOptimized + agentsDecommissioned + agentsFlagged + correctionsPromoted + anomaliesDetected + autoEvolved + autoOrchestrated + goalsCompleted + goalsAutoProposed + autonomyIncreased + autonomyDecreased + guardrailViolationsReviewed + checkpointsExpired + capabilitiesRefreshed;
  if (total > 0) {
    console.log(
      `[Autonomy] Loop complete: ${goalsApproved} goals approved, ${goalsTicketed} ticketed, ` +
      `${promptsApplied} prompts applied, ${modelsOptimized} models optimized, ` +
      `${agentsDecommissioned} decommissioned, ${agentsFlagged} flagged, ` +
      `${correctionsPromoted} corrections promoted, ${anomaliesDetected} anomalies, ` +
      `${autoHealed} auto-healed, ${autoEvolved} auto-evolved, ${autoOrchestrated} auto-orchestrated, ` +
      `${goalsCompleted} goals completed, ${goalsRequeued} requeued, ${goalsAutoProposed} auto-proposed, ` +
      `${autonomyIncreased} autonomy↑, ${autonomyDecreased} autonomy↓, ${guardrailViolationsReviewed} guardrail violations reviewed, ${checkpointsExpired} checkpoints expired, ${capabilitiesRefreshed} capabilities refreshed — ${elapsed}ms`,
    );
  }
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
