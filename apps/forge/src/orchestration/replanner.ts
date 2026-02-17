/**
 * Adaptive Replanner
 * Monitors coordination plan execution and adjusts when tasks fail.
 * Strategies: retry with same agent, reassign to different agent, skip, or abort.
 */

import { query } from '../database.js';
import type { CoordinationPlan, CoordinationTask } from '../runtime/fleet-coordinator.js';

export type ReplanAction =
  | { type: 'retry'; taskId: string; reason: string }
  | { type: 'reassign'; taskId: string; newAgentId: string; newAgentName: string; reason: string }
  | { type: 'skip'; taskId: string; reason: string }
  | { type: 'abort'; reason: string };

interface AgentRow {
  id: string;
  name: string;
  type: string;
  status: string;
  tasks_completed: number;
  tasks_failed: number;
}

/**
 * Analyze a failed task within a plan and decide the best recovery action.
 */
export async function planRecovery(
  plan: CoordinationPlan,
  failedTask: CoordinationTask,
  retryCount: number,
  maxRetries: number = 2,
): Promise<ReplanAction> {
  // Strategy 1: If we haven't exceeded retries, retry with same agent
  if (retryCount < maxRetries) {
    console.log(
      `[Replanner] Retrying task "${failedTask.title}" (attempt ${retryCount + 1}/${maxRetries})`,
    );
    return {
      type: 'retry',
      taskId: failedTask.id,
      reason: `Retry attempt ${retryCount + 1}/${maxRetries}`,
    };
  }

  // Strategy 2: Try reassigning to a different agent of the same type
  const alternativeAgent = await findAlternativeAgent(
    failedTask.assignedAgentId,
    failedTask.assignedAgent,
  );

  if (alternativeAgent) {
    console.log(
      `[Replanner] Reassigning "${failedTask.title}" from ${failedTask.assignedAgent} to ${alternativeAgent.name}`,
    );
    return {
      type: 'reassign',
      taskId: failedTask.id,
      newAgentId: alternativeAgent.id,
      newAgentName: alternativeAgent.name,
      reason: `Reassigned after ${maxRetries} failures: ${failedTask.error ?? 'unknown error'}`,
    };
  }

  // Strategy 3: If this task has no dependents, skip it
  const hasDependents = plan.tasks.some(
    (t) => t.dependencies.includes(failedTask.id) && t.status === 'pending',
  );

  if (!hasDependents) {
    console.log(
      `[Replanner] Skipping non-critical task "${failedTask.title}" (no dependents)`,
    );
    return {
      type: 'skip',
      taskId: failedTask.id,
      reason: `Skipped after ${maxRetries} retries (no downstream tasks depend on this)`,
    };
  }

  // Strategy 4: If critical path — check if we should abort the whole plan
  const completedCount = plan.tasks.filter((t) => t.status === 'completed').length;
  const totalCount = plan.tasks.length;
  const failedCount = plan.tasks.filter((t) => t.status === 'failed').length;

  // Abort if more than half the tasks have failed
  if (failedCount > totalCount / 2) {
    console.log(
      `[Replanner] Aborting plan "${plan.title}" — too many failures (${failedCount}/${totalCount})`,
    );
    return {
      type: 'abort',
      reason: `Plan aborted: ${failedCount}/${totalCount} tasks failed`,
    };
  }

  // Default: skip the failed task
  return {
    type: 'skip',
    taskId: failedTask.id,
    reason: `Skipped: no alternative agents available and ${maxRetries} retries exhausted`,
  };
}

/**
 * Evaluate overall plan health and suggest interventions.
 */
export function assessPlanHealth(plan: CoordinationPlan): {
  healthy: boolean;
  completionRate: number;
  failureRate: number;
  stalled: boolean;
  recommendation: string;
} {
  const total = plan.tasks.length;
  const completed = plan.tasks.filter((t) => t.status === 'completed').length;
  const failed = plan.tasks.filter((t) => t.status === 'failed').length;
  const running = plan.tasks.filter((t) => t.status === 'running').length;
  const pending = plan.tasks.filter((t) => t.status === 'pending').length;

  const completionRate = total > 0 ? completed / total : 0;
  const failureRate = total > 0 ? failed / total : 0;
  const stalled = running === 0 && pending > 0 && plan.status === 'executing';

  let recommendation = 'On track';
  if (stalled) {
    recommendation = 'Plan stalled — pending tasks may have unresolved dependencies';
  } else if (failureRate > 0.5) {
    recommendation = 'High failure rate — consider aborting and retrying with different approach';
  } else if (failureRate > 0.2) {
    recommendation = 'Elevated failures — monitor closely';
  } else if (completionRate === 1) {
    recommendation = 'All tasks completed successfully';
  }

  return {
    healthy: failureRate < 0.3 && !stalled,
    completionRate,
    failureRate,
    stalled,
    recommendation,
  };
}

/**
 * Find an alternative agent that could handle the failed task.
 * Prefers agents of the same type that aren't currently busy.
 */
async function findAlternativeAgent(
  currentAgentId: string,
  currentAgentName: string,
): Promise<AgentRow | null> {
  // Get the current agent's type
  const currentAgent = await query<{ type: string }>(
    `SELECT type FROM forge_agents WHERE id = $1`,
    [currentAgentId],
  );
  const agentType = currentAgent[0]?.type ?? 'custom';

  // Find alternatives: same type, different agent, idle preferred
  const alternatives = await query<AgentRow>(
    `SELECT id, name, type, status, tasks_completed, tasks_failed
     FROM forge_agents
     WHERE id != $1
       AND (is_decommissioned IS NULL OR is_decommissioned = false)
       AND status != 'error'
       AND (type = $2 OR type = 'custom')
     ORDER BY
       CASE WHEN status = 'idle' THEN 0 ELSE 1 END,
       tasks_completed DESC
     LIMIT 1`,
    [currentAgentId, agentType],
  );

  return alternatives[0] ?? null;
}
