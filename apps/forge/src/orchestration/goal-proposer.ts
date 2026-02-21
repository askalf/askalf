/**
 * Autonomous Goal-Setting (Phase 9)
 * Agents analyze their execution history and propose goals for self-improvement.
 * Goals require human approval before execution.
 */

import { query } from '../database.js';
import { ulid } from 'ulid';
import { runCliQuery } from '../runtime/worker.js';

export interface AgentGoal {
  id: string;
  agent_id: string;
  title: string;
  description: string;
  rationale: string;
  priority: string;
  source: string;
  status: string;
  metadata: Record<string, unknown>;
}

/**
 * Analyze an agent's recent history and propose improvement goals.
 */
export async function proposeGoals(agentId: string): Promise<AgentGoal[]> {
  const agent = await query<{ name: string; system_prompt: string; tasks_completed: number; tasks_failed: number }>(
    `SELECT name, system_prompt, tasks_completed, tasks_failed FROM forge_agents WHERE id = $1`,
    [agentId],
  );
  if (agent.length === 0) return [];
  const { name, tasks_completed, tasks_failed } = agent[0]!;

  // Check for existing pending goals (don't flood)
  const pendingCount = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM forge_agent_goals WHERE agent_id = $1 AND status IN ('proposed', 'approved')`,
    [agentId],
  );
  if (parseInt(pendingCount[0]?.count ?? '0') >= 5) return [];

  // Gather recent execution stats
  const recentExecs = await query<{ status: string; input: string; error: string | null; cost: number }>(
    `SELECT status, input, error, cost
     FROM forge_executions
     WHERE agent_id = $1
     ORDER BY started_at DESC LIMIT 20`,
    [agentId],
  );

  if (recentExecs.length < 3) return []; // Not enough history

  const failedTasks = recentExecs.filter((e) => e.status === 'failed');
  const avgCost = recentExecs.reduce((sum, e) => sum + (parseFloat(String(e.cost)) || 0), 0) / recentExecs.length;
  const successRate = tasks_completed / Math.max(1, tasks_completed + tasks_failed);

  // Get correction patterns
  const corrections = await query<{ description: string; frequency: number }>(
    `SELECT description, frequency FROM forge_correction_patterns
     WHERE agent_id = $1 ORDER BY frequency DESC LIMIT 5`,
    [agentId],
  );

  const context = `Agent "${name}" stats:
- Success rate: ${(successRate * 100).toFixed(0)}%
- Tasks completed: ${tasks_completed}, failed: ${tasks_failed}
- Average cost per execution: $${avgCost.toFixed(4)}
- Recent failures: ${failedTasks.length}/${recentExecs.length}
${failedTasks.length > 0 ? `- Common errors: ${failedTasks.slice(0, 3).map((f) => f.error?.substring(0, 100)).join('; ')}` : ''}
${corrections.length > 0 ? `- Correction patterns: ${corrections.map((c) => `${c.description} (${c.frequency}x)`).join('; ')}` : ''}`;

  const prompt = `You are analyzing an AI agent's performance to propose self-improvement goals.

${context}

Propose 1-3 actionable improvement goals. Return ONLY valid JSON (no markdown fences):
[
  {
    "title": "short goal title",
    "description": "specific actionable description of what to improve",
    "rationale": "why this goal matters based on the data",
    "priority": "low|medium|high|critical"
  }
]

Rules:
- Focus on the most impactful improvements
- Be specific and actionable
- If success rate is >90% and no corrections, return []
- Prioritize: critical = blocking issues, high = frequent failures, medium = efficiency, low = nice-to-have`;

  try {
    const result = await runCliQuery(prompt, {
      model: 'claude-haiku-4-5',
      maxTurns: 1,
      timeout: 60000,
    });

    if (result.isError) return [];

    const jsonMatch = result.output.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const goals = JSON.parse(jsonMatch[0]) as Array<{
      title: string;
      description: string;
      rationale: string;
      priority: string;
    }>;

    const stored: AgentGoal[] = [];
    for (const goal of goals.slice(0, 3)) {
      const id = ulid();
      await query(
        `INSERT INTO forge_agent_goals
         (id, agent_id, title, description, rationale, priority, source, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, 'auto', $7)`,
        [id, agentId, goal.title, goal.description, goal.rationale, goal.priority || 'medium',
         JSON.stringify({ successRate, avgCost, recentFailures: failedTasks.length })],
      );
      stored.push({
        id, agent_id: agentId,
        title: goal.title, description: goal.description,
        rationale: goal.rationale, priority: goal.priority || 'medium',
        source: 'auto', status: 'proposed',
        metadata: { successRate, avgCost },
      });
    }

    if (stored.length > 0) {
      console.log(`[GoalProposer] Proposed ${stored.length} goals for ${name}: ${stored.map((g) => g.title).join(', ')}`);
    }
    return stored;
  } catch (err) {
    console.warn(`[GoalProposer] Error for ${name}:`, err instanceof Error ? err.message : err);
    return [];
  }
}

/**
 * Approve a proposed goal.
 */
export async function approveGoal(goalId: string, approvedBy: string): Promise<boolean> {
  const result = await query(
    `UPDATE forge_agent_goals
     SET status = 'approved', approved_by = $1, approved_at = NOW()
     WHERE id = $2 AND status = 'proposed'
     RETURNING id`,
    [approvedBy, goalId],
  );
  return result.length > 0;
}

/**
 * Reject a proposed goal.
 */
export async function rejectGoal(goalId: string): Promise<boolean> {
  const result = await query(
    `UPDATE forge_agent_goals SET status = 'rejected' WHERE id = $1 AND status = 'proposed' RETURNING id`,
    [goalId],
  );
  return result.length > 0;
}

/**
 * Get goals for an agent.
 */
export async function getAgentGoals(agentId: string, status?: string): Promise<AgentGoal[]> {
  const statusFilter = status ? 'AND status = $2' : '';
  const params: unknown[] = [agentId];
  if (status) params.push(status);

  return query<AgentGoal>(
    `SELECT id, agent_id, title, description, rationale, priority, source, status, metadata
     FROM forge_agent_goals
     WHERE agent_id = $1 ${statusFilter}
     ORDER BY created_at DESC LIMIT 50`,
    params,
  );
}

/**
 * Propose goals for all active agents. Called by metabolic cycle.
 */
export async function proposeAllGoals(): Promise<number> {
  const agents = await query<{ id: string }>(
    `SELECT id FROM forge_agents
     WHERE status != 'error' AND (is_decommissioned IS NULL OR is_decommissioned = false)
       AND tasks_completed + tasks_failed >= 5`,
  );

  let total = 0;
  for (const agent of agents) {
    const goals = await proposeGoals(agent.id).catch(() => []);
    total += goals.length;
  }
  return total;
}
