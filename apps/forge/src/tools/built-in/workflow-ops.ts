/**
 * Built-in Tool: Workflow Ops (Level 10 — Vibe Orchestration)
 * Structured multi-agent coordination: decompose tasks, create DAG-based
 * plans, execute across fleet, monitor health, and recover from failures.
 */

import { Redis } from 'ioredis';
import { query } from '../../database.js';
import { decomposeTask } from '../../orchestration/task-decomposer.js';
import { FleetCoordinator, type CoordinationPlan } from '../../runtime/fleet-coordinator.js';
import { assessPlanHealth, planRecovery } from '../../orchestration/replanner.js';
import { getExecutionContext } from '../../runtime/execution-context.js';
import { loadConfig } from '../../config.js';
import type { ToolResult } from '../registry.js';

// ============================================
// Types
// ============================================

export interface WorkflowOpsInput {
  action: 'decompose' | 'create_plan' | 'execute_plan' | 'plan_status' | 'recover';
  // For decompose:
  task_description?: string;
  // For create_plan:
  title?: string;
  pattern?: 'pipeline' | 'fan-out' | 'consensus';
  tasks?: Array<{
    title: string;
    description: string;
    agent_name: string;
    dependencies?: string[];
  }>;
  // For execute_plan / plan_status:
  plan_id?: string;
  // For recover:
  task_id?: string;
  retry_count?: number;
  // Context:
  agent_id?: string;
}

const MAX_ACTIVE_PLANS = 3;

// ============================================
// Lazy FleetCoordinator singleton
// ============================================

let coordinator: FleetCoordinator | null = null;

function getCoordinator(): FleetCoordinator {
  if (!coordinator) {
    const config = loadConfig();
    const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
    coordinator = new FleetCoordinator(redis);
  }
  return coordinator;
}

// ============================================
// Implementation
// ============================================

export async function workflowOps(input: WorkflowOpsInput): Promise<ToolResult> {
  const startTime = performance.now();

  try {
    switch (input.action) {
      case 'decompose':
        return await handleDecompose(input, startTime);
      case 'create_plan':
        return await handleCreatePlan(input, startTime);
      case 'execute_plan':
        return await handleExecutePlan(input, startTime);
      case 'plan_status':
        return await handlePlanStatus(input, startTime);
      case 'recover':
        return await handleRecover(input, startTime);
      default:
        return {
          output: null,
          error: `Unknown action: ${input.action}. Supported: decompose, create_plan, execute_plan, plan_status, recover`,
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
// Decompose Action
// ============================================

async function handleDecompose(input: WorkflowOpsInput, startTime: number): Promise<ToolResult> {
  if (!input.task_description) {
    return { output: null, error: 'task_description is required for decompose', durationMs: 0 };
  }

  // Check autonomy level
  const ctx = getExecutionContext();
  const agentId = input.agent_id ?? ctx?.agentId ?? 'unknown';
  const agents = await query<{ autonomy_level: number }>(`SELECT autonomy_level FROM forge_agents WHERE id = $1`, [agentId]);
  if (agents.length > 0 && agents[0]!.autonomy_level < 3) {
    return { output: null, error: `Autonomy level ${agents[0]!.autonomy_level} insufficient. Need >= 3 for task decomposition.`, durationMs: Math.round(performance.now() - startTime) };
  }

  // Get available agents for decomposition
  const availableAgents = await query<{ name: string; type: string; description: string }>(
    `SELECT name, COALESCE(type, 'custom') AS type, COALESCE(description, '') AS description
     FROM forge_agents
     WHERE (status = 'idle' OR status = 'active')
       AND (is_decommissioned IS NULL OR is_decommissioned = false)`,
  );

  const result = await decomposeTask(input.task_description, availableAgents);

  return {
    output: {
      tasks: result.tasks,
      pattern: result.pattern,
      reasoning: result.reasoning,
      total_subtasks: result.tasks.length,
      available_agents: availableAgents.length,
      message: `Task decomposed into ${result.tasks.length} subtasks (${result.pattern} pattern). Use create_plan to build a coordination plan.`,
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}

// ============================================
// Create Plan Action
// ============================================

async function handleCreatePlan(input: WorkflowOpsInput, startTime: number): Promise<ToolResult> {
  const ctx = getExecutionContext();
  const agentId = input.agent_id ?? ctx?.agentId ?? 'unknown';

  if (agentId === 'unknown') {
    return { output: null, error: 'Could not determine agent ID', durationMs: Math.round(performance.now() - startTime) };
  }
  if (!input.title) {
    return { output: null, error: 'title is required for create_plan', durationMs: 0 };
  }
  if (!input.tasks || input.tasks.length === 0) {
    return { output: null, error: 'tasks array is required for create_plan', durationMs: 0 };
  }

  // Check autonomy level
  const agents = await query<{ autonomy_level: number; name: string }>(`SELECT autonomy_level, name FROM forge_agents WHERE id = $1`, [agentId]);
  if (agents.length > 0 && agents[0]!.autonomy_level < 3) {
    return { output: null, error: `Autonomy level ${agents[0]!.autonomy_level} insufficient. Need >= 3 for plan creation.`, durationMs: Math.round(performance.now() - startTime) };
  }
  const agentName = agents[0]?.name ?? agentId;

  // Guard: limit active plans per agent
  const fc = getCoordinator();
  const existingPlans = await fc.listPlans();
  const activePlans = existingPlans.filter(
    (p) => p.leadAgentId === agentId && (p.status === 'planning' || p.status === 'executing'),
  );

  if (activePlans.length >= MAX_ACTIVE_PLANS) {
    return {
      output: null,
      error: `Maximum ${MAX_ACTIVE_PLANS} active plans reached. Complete or abort existing plans first.`,
      durationMs: Math.round(performance.now() - startTime),
    };
  }

  const plan = await fc.createPlan(
    agentId,
    agentName,
    input.title,
    input.pattern ?? 'pipeline',
    input.tasks.map((t) => ({
      title: t.title,
      description: t.description,
      agentName: t.agent_name,
      dependencies: t.dependencies,
    })),
  );

  return {
    output: {
      plan_id: plan.id,
      title: plan.title,
      pattern: plan.pattern,
      status: plan.status,
      task_count: plan.tasks.length,
      tasks: plan.tasks.map((t) => ({
        id: t.id,
        title: t.title,
        assigned_agent: t.assignedAgent,
        dependencies: t.dependencies.length,
      })),
      message: `Plan created with ${plan.tasks.length} tasks. Use execute_plan with plan_id="${plan.id}" to start.`,
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}

// ============================================
// Execute Plan Action
// ============================================

async function handleExecutePlan(input: WorkflowOpsInput, startTime: number): Promise<ToolResult> {
  if (!input.plan_id) {
    return { output: null, error: 'plan_id is required for execute_plan', durationMs: 0 };
  }

  const fc = getCoordinator();
  const plan = await fc.getPlan(input.plan_id);
  if (!plan) {
    return { output: null, error: `Plan not found: ${input.plan_id}`, durationMs: Math.round(performance.now() - startTime) };
  }
  if (plan.status !== 'planning') {
    return { output: null, error: `Plan status is '${plan.status}', must be 'planning' to execute`, durationMs: Math.round(performance.now() - startTime) };
  }

  const executed = await fc.executePlan(input.plan_id);

  const running = executed.tasks.filter((t) => t.status === 'running').length;
  const pending = executed.tasks.filter((t) => t.status === 'pending').length;

  return {
    output: {
      plan_id: executed.id,
      status: executed.status,
      dispatched: running,
      pending,
      tasks: executed.tasks.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        assigned_agent: t.assignedAgent,
      })),
      message: `Plan executing: ${running} tasks dispatched, ${pending} pending (waiting for dependencies).`,
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}

// ============================================
// Plan Status Action
// ============================================

async function handlePlanStatus(input: WorkflowOpsInput, startTime: number): Promise<ToolResult> {
  if (!input.plan_id) {
    return { output: null, error: 'plan_id is required for plan_status', durationMs: 0 };
  }

  const fc = getCoordinator();
  const plan = await fc.getPlan(input.plan_id);
  if (!plan) {
    return { output: null, error: `Plan not found: ${input.plan_id}`, durationMs: Math.round(performance.now() - startTime) };
  }

  const health = assessPlanHealth(plan);

  return {
    output: {
      plan_id: plan.id,
      title: plan.title,
      pattern: plan.pattern,
      status: plan.status,
      health,
      tasks: plan.tasks.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        assigned_agent: t.assignedAgent,
        result: t.result?.substring(0, 200),
        error: t.error?.substring(0, 200),
      })),
      completed: plan.tasks.filter((t) => t.status === 'completed').length,
      failed: plan.tasks.filter((t) => t.status === 'failed').length,
      running: plan.tasks.filter((t) => t.status === 'running').length,
      pending: plan.tasks.filter((t) => t.status === 'pending').length,
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}

// ============================================
// Recover Action
// ============================================

async function handleRecover(input: WorkflowOpsInput, startTime: number): Promise<ToolResult> {
  if (!input.plan_id) {
    return { output: null, error: 'plan_id is required for recover', durationMs: 0 };
  }
  if (!input.task_id) {
    return { output: null, error: 'task_id is required for recover', durationMs: 0 };
  }

  const fc = getCoordinator();
  const plan = await fc.getPlan(input.plan_id);
  if (!plan) {
    return { output: null, error: `Plan not found: ${input.plan_id}`, durationMs: Math.round(performance.now() - startTime) };
  }

  const failedTask = plan.tasks.find((t) => t.id === input.task_id);
  if (!failedTask) {
    return { output: null, error: `Task not found in plan: ${input.task_id}`, durationMs: Math.round(performance.now() - startTime) };
  }
  if (failedTask.status !== 'failed') {
    return { output: null, error: `Task status is '${failedTask.status}', must be 'failed' to recover`, durationMs: Math.round(performance.now() - startTime) };
  }

  const action = await planRecovery(plan, failedTask, input.retry_count ?? 0);

  return {
    output: {
      plan_id: plan.id,
      task_id: input.task_id,
      recovery_action: action,
      message: `Recovery action: ${action.type} — ${action.reason}`,
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}
