/**
 * Built-in Tool: Agent Delegate (Level 6 — Vibe Communication)
 * Allows agents to delegate tasks by capability rather than by hardcoded agent ID.
 * Combines the agent matcher (find best agent) with execution (run the agent).
 */

import { ulid } from 'ulid';
import { query } from '../../database.js';
import { matchAgentsToTasks } from '../../orchestration/agent-matcher.js';
import { getExecutionContext } from '../../runtime/execution-context.js';
import type { ToolResult } from '../registry.js';

// ============================================
// Types
// ============================================

export interface AgentDelegateInput {
  action: 'delegate' | 'find';
  // For both:
  task?: string;
  capability?: string;
  agent_type?: string;
  // Context (passed by runtime):
  agent_id?: string;
  agent_name?: string;
  execution_id?: string;
}

const MAX_DEPTH = 5;

// ============================================
// Implementation
// ============================================

export async function agentDelegate(input: AgentDelegateInput): Promise<ToolResult> {
  const startTime = performance.now();

  try {
    switch (input.action) {
      case 'delegate':
        return await handleDelegate(input, startTime);
      case 'find':
        return await handleFind(input, startTime);
      default:
        return {
          output: null,
          error: `Unknown action: ${input.action}. Supported: delegate, find`,
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
// Delegate Action
// ============================================

async function handleDelegate(input: AgentDelegateInput, startTime: number): Promise<ToolResult> {
  if (!input.task) {
    return { output: null, error: 'task is required for delegate action', durationMs: 0 };
  }

  // Depth check via execution context
  const ctx = getExecutionContext();
  const currentDepth = ctx?.depth ?? 0;
  if (currentDepth + 1 > MAX_DEPTH) {
    return {
      output: null,
      error: `Maximum delegation depth exceeded (max: ${MAX_DEPTH}). Current depth: ${currentDepth}. This prevents infinite recursive delegation chains.`,
      durationMs: Math.round(performance.now() - startTime),
    };
  }

  // Find the best agent for this task
  const taskDesc = input.task;
  const agentType = input.agent_type ?? 'custom';

  const matches = await matchAgentsToTasks([{
    title: input.capability ?? 'delegated task',
    description: taskDesc,
    suggestedAgentType: agentType,
    dependencies: [],
    estimatedComplexity: 'medium',
  }]);

  if (matches.length === 0) {
    return {
      output: null,
      error: 'No agents available to handle this task',
      durationMs: Math.round(performance.now() - startTime),
    };
  }

  const match = matches[0]!;

  // Prevent self-delegation
  if (match.agentId === input.agent_id) {
    // Try second best
    if (matches.length > 1) {
      // Re-run with exclusion would be complex; just pick from scored agents manually
      return {
        output: null,
        error: `Best match is self (${match.agentName}). Cannot self-delegate. Use a different capability or agent_type filter.`,
        durationMs: Math.round(performance.now() - startTime),
      };
    }
    return {
      output: null,
      error: 'Only available agent is self. Cannot self-delegate.',
      durationMs: Math.round(performance.now() - startTime),
    };
  }

  // Get the target agent's config
  const targetAgent = await query<{
    id: string; name: string; model_id: string; system_prompt: string;
    max_cost_per_execution: number;
  }>(
    `SELECT id, name, model_id, system_prompt, max_cost_per_execution
     FROM forge_agents WHERE id = $1`,
    [match.agentId],
  );

  if (targetAgent.length === 0) {
    return {
      output: null,
      error: `Matched agent ${match.agentName} (${match.agentId}) not found`,
      durationMs: Math.round(performance.now() - startTime),
    };
  }

  const agent = targetAgent[0]!;
  const ownerId = ctx?.ownerId ?? 'system:forge';

  // Create child execution record
  const childExecutionId = ulid();
  await query(
    `INSERT INTO forge_executions (id, agent_id, owner_id, input, status, parent_execution_id)
     VALUES ($1, $2, $3, $4, 'pending', $5)`,
    [childExecutionId, match.agentId, ownerId, taskDesc, input.execution_id ?? null],
  );

  console.log(
    `[Delegate] ${input.agent_name ?? 'unknown'} → ${match.agentName} (score=${match.score.toFixed(1)}) ` +
    `depth=${currentDepth + 1} exec=${childExecutionId}`,
  );

  // Import and run the execution dynamically to avoid circular dependency
  // runDirectCliExecution is in the same package but importing it statically
  // from a tool would create a circular dep (worker imports tools, tools import worker)
  const { runDirectCliExecution } = await import('../../runtime/worker.js');

  await runDirectCliExecution(
    childExecutionId,
    match.agentId,
    taskDesc,
    ownerId,
    {
      modelId: agent.model_id,
      systemPrompt: agent.system_prompt,
      maxBudgetUsd: String(agent.max_cost_per_execution ?? '0.50'),
    },
  );

  // Read back the result
  const result = await query<{
    status: string; output: string; error: string | null;
    cost: number; duration_ms: number; iterations: number;
  }>(
    `SELECT status, COALESCE(output, '') as output, error,
            COALESCE(cost, 0) as cost, COALESCE(duration_ms, 0) as duration_ms,
            COALESCE(iterations, 0) as iterations
     FROM forge_executions WHERE id = $1`,
    [childExecutionId],
  );

  const execResult = result[0];
  const durationMs = Math.round(performance.now() - startTime);

  if (!execResult || execResult.status === 'failed') {
    return {
      output: {
        delegated_to: match.agentName,
        agent_id: match.agentId,
        match_score: match.score,
        match_reasons: match.reasons,
        status: 'failed',
        error: execResult?.error ?? 'Execution failed',
        execution_id: childExecutionId,
      },
      error: `Delegation to ${match.agentName} failed: ${execResult?.error ?? 'unknown error'}`,
      durationMs,
    };
  }

  return {
    output: {
      delegated_to: match.agentName,
      agent_id: match.agentId,
      match_score: match.score,
      match_reasons: match.reasons,
      status: execResult.status,
      result: execResult.output,
      cost: execResult.cost,
      iterations: execResult.iterations,
      execution_id: childExecutionId,
      delegation_depth: currentDepth + 1,
    },
    durationMs,
  };
}

// ============================================
// Find Action
// ============================================

async function handleFind(input: AgentDelegateInput, startTime: number): Promise<ToolResult> {
  const taskDesc = input.task ?? input.capability ?? '';
  if (!taskDesc) {
    return { output: null, error: 'task or capability is required for find action', durationMs: 0 };
  }

  const agentType = input.agent_type ?? 'custom';

  const matches = await matchAgentsToTasks([{
    title: input.capability ?? 'capability search',
    description: taskDesc,
    suggestedAgentType: agentType,
    dependencies: [],
    estimatedComplexity: 'medium',
  }]);

  // Return top 3 (the matcher returns all agents sorted by score)
  // But matchAgentsToTasks returns 1 per task. We need to call it differently.
  // Actually, the matcher returns 1 match per task. To get top 3 we'd need to
  // query agents directly and score them. Let's just query agents with matching capabilities.

  const agents = await query<{
    id: string; name: string; type: string; description: string;
    autonomy_level: number; tasks_completed: number; tasks_failed: number;
  }>(
    `SELECT a.id, a.name, a.type, a.description,
            a.autonomy_level, COALESCE(a.tasks_completed, 0) as tasks_completed,
            COALESCE(a.tasks_failed, 0) as tasks_failed
     FROM forge_agents a
     WHERE a.status = 'active'
       AND (a.is_decommissioned IS NULL OR a.is_decommissioned = false)
     ORDER BY a.tasks_completed DESC
     LIMIT 20`,
  );

  // Find agents with matching capabilities
  const withCaps = await Promise.all(
    agents.map(async (a) => {
      const caps = await query<{ capability: string; proficiency: number }>(
        `SELECT capability, proficiency FROM forge_agent_capabilities WHERE agent_id = $1`,
        [a.id],
      ).catch(() => []);

      const relevantCaps = caps.filter((c) =>
        taskDesc.toLowerCase().includes(c.capability.toLowerCase()) ||
        c.capability.toLowerCase().includes(taskDesc.toLowerCase()),
      );

      const total = a.tasks_completed + a.tasks_failed;
      const successRate = total > 0 ? a.tasks_completed / total : 0.5;

      return {
        ...a,
        capabilities: caps.map((c) => `${c.capability}(${c.proficiency})`),
        relevant_capabilities: relevantCaps,
        success_rate: successRate,
        relevance_score: relevantCaps.length > 0
          ? relevantCaps.reduce((sum, c) => sum + c.proficiency, 0) / relevantCaps.length
          : 0,
      };
    }),
  );

  // Sort by relevance, then success rate
  const sorted = withCaps
    .sort((a, b) => b.relevance_score - a.relevance_score || b.success_rate - a.success_rate)
    .slice(0, 5);

  return {
    output: {
      query: taskDesc,
      agent_type_filter: agentType,
      matches: sorted.map((a) => ({
        agent_id: a.id,
        name: a.name,
        type: a.type,
        description: a.description,
        capabilities: a.capabilities,
        relevance_score: a.relevance_score,
        success_rate: Math.round(a.success_rate * 100),
        tasks_completed: a.tasks_completed,
        tasks_failed: a.tasks_failed,
      })),
      total_active_agents: agents.length,
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}
