/**
 * Goal Manager — Active goal lifecycle management.
 * Handles goal decomposition, progress tracking, completion evaluation,
 * and integration with the daemon tick loop.
 */

import { query, queryOne } from '../database.js';
import { ulid } from 'ulid';

// ============================================
// Types
// ============================================

export interface ActiveGoal {
  id: string;
  agent_id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  progress: number;
  target_metric: string | null;
  current_value: number | null;
  deadline: string | null;
  max_cost_usd: number;
  total_cost_usd: number;
  execution_count: number;
  parent_goal_id: string | null;
}

export interface GoalAction {
  goalId: string;
  title: string;
  description: string;
  actionType: 'execute' | 'decompose' | 'evaluate' | 'complete';
  priority: string;
  prompt: string;
}

export interface SubGoalSpec {
  title: string;
  description: string;
  priority?: string;
  max_cost_usd?: number;
}

// ============================================
// Goal Manager
// ============================================

/**
 * Get the next goal action for a daemon agent to work on.
 * Priority: in_progress goals first, then approved goals.
 */
export async function getNextGoalAction(agentId: string): Promise<GoalAction | null> {
  // First check in_progress goals
  const inProgress = await queryOne<ActiveGoal>(
    `SELECT id, agent_id, title, description, status, priority, progress,
            target_metric, current_value, deadline,
            COALESCE(max_cost_usd, 1.00)::numeric AS max_cost_usd,
            COALESCE(total_cost_usd, 0)::numeric AS total_cost_usd,
            COALESCE(execution_count, 0) AS execution_count,
            parent_goal_id
     FROM forge_agent_goals
     WHERE agent_id = $1 AND status = 'in_progress'
     ORDER BY
       CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
       created_at ASC
     LIMIT 1`,
    [agentId],
  );

  if (inProgress) {
    return goalToAction(inProgress);
  }

  // Then check approved goals
  const approved = await queryOne<ActiveGoal>(
    `SELECT id, agent_id, title, description, status, priority, progress,
            target_metric, current_value, deadline,
            COALESCE(max_cost_usd, 1.00)::numeric AS max_cost_usd,
            COALESCE(total_cost_usd, 0)::numeric AS total_cost_usd,
            COALESCE(execution_count, 0) AS execution_count,
            parent_goal_id
     FROM forge_agent_goals
     WHERE agent_id = $1 AND status = 'approved'
     ORDER BY
       CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
       created_at ASC
     LIMIT 1`,
    [agentId],
  );

  if (approved) {
    // Transition to in_progress
    await query(
      `UPDATE forge_agent_goals SET status = 'in_progress' WHERE id = $1`,
      [approved.id],
    );
    approved.status = 'in_progress';
    return goalToAction(approved);
  }

  return null;
}

function goalToAction(goal: ActiveGoal): GoalAction {
  // Check if over budget
  if (goal.total_cost_usd >= goal.max_cost_usd) {
    return {
      goalId: goal.id,
      title: goal.title,
      description: goal.description,
      actionType: 'evaluate',
      priority: goal.priority,
      prompt: `Goal "${goal.title}" has exhausted its budget ($${goal.total_cost_usd}/$${goal.max_cost_usd}). Evaluate current progress (${goal.progress}%) and decide: mark as completed if sufficient, or report what remains.`,
    };
  }

  // Check if near completion
  if (goal.progress >= 90) {
    return {
      goalId: goal.id,
      title: goal.title,
      description: goal.description,
      actionType: 'evaluate',
      priority: goal.priority,
      prompt: `Goal "${goal.title}" is at ${goal.progress}% progress. Evaluate whether the goal is truly complete. If yes, finalize it. If not, determine what's remaining.`,
    };
  }

  // Normal execution
  return {
    goalId: goal.id,
    title: goal.title,
    description: goal.description,
    actionType: 'execute',
    priority: goal.priority,
    prompt: `Work on goal: "${goal.title}"\n\nDescription: ${goal.description}\n\nCurrent progress: ${goal.progress}%\nBudget remaining: $${(goal.max_cost_usd - goal.total_cost_usd).toFixed(4)}\nExecutions so far: ${goal.execution_count}\n\nTake the next meaningful step toward completing this goal.`,
  };
}

/**
 * Record an execution against a goal.
 */
export async function recordGoalExecution(
  goalId: string,
  executionId: string,
  actionType: string,
  progressDelta: number,
  costUsd: number,
  notes?: string,
): Promise<void> {
  const id = ulid();

  await query(
    `INSERT INTO forge_goal_executions (id, goal_id, execution_id, action_type, progress_delta, cost_usd, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, goalId, executionId, actionType, progressDelta, costUsd, notes ?? null],
  );

  // Update goal aggregates
  await query(
    `UPDATE forge_agent_goals SET
       progress = LEAST(100, COALESCE(progress, 0) + $1),
       total_cost_usd = COALESCE(total_cost_usd, 0) + $2,
       execution_count = COALESCE(execution_count, 0) + 1,
       metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('last_execution_at', NOW()::text)
     WHERE id = $3`,
    [progressDelta, costUsd, goalId],
  );

  // Auto-complete if progress >= 100
  const goal = await queryOne<{ progress: number; status: string }>(
    `SELECT progress, status FROM forge_agent_goals WHERE id = $1`,
    [goalId],
  );
  if (goal && goal.progress >= 100 && goal.status === 'in_progress') {
    await query(
      `UPDATE forge_agent_goals SET status = 'completed', completed_at = NOW(),
       metadata = COALESCE(metadata, '{}'::jsonb) || '{"auto_completed": true}'::jsonb
       WHERE id = $1`,
      [goalId],
    );

    // Update parent goal progress if this is a sub-goal
    await updateParentProgress(goalId);
  }
}

/**
 * Decompose a goal into sub-goals.
 */
export async function decomposeGoal(
  goalId: string,
  subGoals: SubGoalSpec[],
): Promise<string[]> {
  const goal = await queryOne<{ agent_id: string; max_cost_usd: string }>(
    `SELECT agent_id, COALESCE(max_cost_usd, 1.00)::text AS max_cost_usd FROM forge_agent_goals WHERE id = $1`,
    [goalId],
  );
  if (!goal) throw new Error(`Goal not found: ${goalId}`);

  const parentBudget = parseFloat(goal.max_cost_usd);
  const budgetPerSubGoal = parentBudget / Math.max(1, subGoals.length);

  const ids: string[] = [];
  for (const sub of subGoals) {
    const id = ulid();
    await query(
      `INSERT INTO forge_agent_goals (id, agent_id, title, description, rationale, priority, source, status, parent_goal_id, max_cost_usd)
       VALUES ($1, $2, $3, $4, $5, $6, 'auto', 'approved', $7, $8)`,
      [
        id, goal.agent_id, sub.title, sub.description,
        `Sub-goal of ${goalId}`,
        sub.priority ?? 'medium',
        goalId,
        sub.max_cost_usd ?? budgetPerSubGoal,
      ],
    );
    ids.push(id);
  }

  return ids;
}

/**
 * Update parent goal progress based on sub-goal completion.
 */
async function updateParentProgress(childGoalId: string): Promise<void> {
  const child = await queryOne<{ parent_goal_id: string | null }>(
    `SELECT parent_goal_id FROM forge_agent_goals WHERE id = $1`,
    [childGoalId],
  );
  if (!child?.parent_goal_id) return;

  // Calculate aggregate progress of all sibling sub-goals
  const siblings = await query<{ progress: number }>(
    `SELECT COALESCE(progress, 0) AS progress FROM forge_agent_goals WHERE parent_goal_id = $1`,
    [child.parent_goal_id],
  );

  if (siblings.length === 0) return;
  const avgProgress = siblings.reduce((sum, s) => sum + s.progress, 0) / siblings.length;

  await query(
    `UPDATE forge_agent_goals SET progress = $1 WHERE id = $2`,
    [Math.round(avgProgress * 100) / 100, child.parent_goal_id],
  );
}

/**
 * Get sub-goals for a parent goal.
 */
export async function getSubGoals(parentGoalId: string): Promise<ActiveGoal[]> {
  return query<ActiveGoal>(
    `SELECT id, agent_id, title, description, status, priority, progress,
            target_metric, current_value, deadline,
            COALESCE(max_cost_usd, 1.00)::numeric AS max_cost_usd,
            COALESCE(total_cost_usd, 0)::numeric AS total_cost_usd,
            COALESCE(execution_count, 0) AS execution_count,
            parent_goal_id
     FROM forge_agent_goals
     WHERE parent_goal_id = $1
     ORDER BY created_at ASC`,
    [parentGoalId],
  );
}

/**
 * Get goal execution history.
 */
export async function getGoalExecutions(goalId: string, limit = 20): Promise<Record<string, unknown>[]> {
  return query<Record<string, unknown>>(
    `SELECT * FROM forge_goal_executions WHERE goal_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [goalId, limit],
  );
}

/**
 * Update progress directly (used by agents via goal-ops tool).
 */
export async function updateGoalProgress(goalId: string, progress: number): Promise<void> {
  await query(
    `UPDATE forge_agent_goals SET progress = LEAST(100, GREATEST(0, $1)) WHERE id = $2`,
    [progress, goalId],
  );

  // Auto-complete check
  if (progress >= 100) {
    await query(
      `UPDATE forge_agent_goals SET status = 'completed', completed_at = NOW() WHERE id = $1 AND status = 'in_progress'`,
      [goalId],
    );
    await updateParentProgress(goalId);
  }
}
