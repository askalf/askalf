/**
 * Fleet Coordinator
 *
 * Enables multi-agent coordination on complex tasks using
 * Agent Teams patterns. When a task requires multiple agents:
 *
 * 1. Lead agent analyzes task, creates work breakdown
 * 2. Spawns teammate sessions for required agents
 * 3. Teammates share task list with DAG dependencies
 * 4. Lead monitors, handles failures, synthesizes results
 *
 * Coordination patterns:
 * - Pipeline: Architect → Backend Dev → QA (sequential handoff)
 * - Fan-out: Sentinel dispatches parallel security scans
 * - Consensus: Multiple agents analyze, lead synthesizes
 */

import { ulid } from 'ulid';
import { query, queryOne } from '../database.js';
import { Redis } from 'ioredis';

// ============================================
// Types
// ============================================

export interface CoordinationTask {
  id: string;
  title: string;
  description: string;
  assignedAgent: string;
  assignedAgentId: string;
  dependencies: string[]; // Task IDs that must complete first
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: string;
  error?: string;
}

export interface CoordinationPlan {
  id: string;
  title: string;
  pattern: 'pipeline' | 'fan-out' | 'consensus';
  leadAgentId: string;
  leadAgentName: string;
  tasks: CoordinationTask[];
  status: 'planning' | 'executing' | 'completed' | 'failed';
  createdAt: string;
}

export interface AgentInfo {
  id: string;
  name: string;
  runtimeMode: string;
  enabledTools: string[];
  autonomyLevel: number;
}

// ============================================
// Fleet Coordinator
// ============================================

export class FleetCoordinator {
  private redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  /**
   * Create a coordination plan for a multi-agent task.
   * The lead agent creates the work breakdown; this function
   * structures it into a DAG of tasks with dependencies.
   */
  async createPlan(
    leadAgentId: string,
    leadAgentName: string,
    title: string,
    pattern: CoordinationPlan['pattern'],
    tasks: Array<{
      title: string;
      description: string;
      agentName: string;
      dependencies?: string[]; // Task titles that must complete first
    }>,
  ): Promise<CoordinationPlan> {
    const planId = ulid();

    // Resolve agent names to IDs
    const agentRows = await query<{ id: string; name: string }>(
      `SELECT id, name FROM forge_agents WHERE status = 'active'`,
    );
    const agentMap = new Map(agentRows.map((a) => [a.name.toLowerCase(), a.id]));

    // Build task DAG
    const coordinationTasks: CoordinationTask[] = [];
    const taskTitleToId = new Map<string, string>();

    // First pass: create task IDs
    for (const task of tasks) {
      const taskId = ulid();
      taskTitleToId.set(task.title, taskId);
    }

    // Second pass: resolve dependencies
    for (const task of tasks) {
      const taskId = taskTitleToId.get(task.title)!;
      const agentId = agentMap.get(task.agentName.toLowerCase()) ?? '';

      const deps: string[] = [];
      if (task.dependencies) {
        for (const depTitle of task.dependencies) {
          const depId = taskTitleToId.get(depTitle);
          if (depId) deps.push(depId);
        }
      }

      coordinationTasks.push({
        id: taskId,
        title: task.title,
        description: task.description,
        assignedAgent: task.agentName,
        assignedAgentId: agentId,
        dependencies: deps,
        status: 'pending',
      });
    }

    const plan: CoordinationPlan = {
      id: planId,
      title,
      pattern,
      leadAgentId,
      leadAgentName,
      tasks: coordinationTasks,
      status: 'planning',
      createdAt: new Date().toISOString(),
    };

    // Store plan in Redis
    await this.redis.setex(
      `fleet:plan:${planId}`,
      86400, // 24 hour TTL
      JSON.stringify(plan),
    );

    return plan;
  }

  /**
   * Execute a coordination plan.
   * Dispatches tasks to agents respecting DAG dependencies.
   */
  async executePlan(planId: string): Promise<CoordinationPlan> {
    const planData = await this.redis.get(`fleet:plan:${planId}`);
    if (!planData) throw new Error(`Plan not found: ${planId}`);

    const plan = JSON.parse(planData) as CoordinationPlan;
    plan.status = 'executing';

    // Find tasks with no dependencies (ready to run)
    const readyTasks = plan.tasks.filter(
      (t) => t.status === 'pending' && t.dependencies.length === 0,
    );

    // Dispatch ready tasks
    for (const task of readyTasks) {
      await this.dispatchTask(plan, task);
    }

    // Save updated plan
    await this.redis.setex(`fleet:plan:${planId}`, 86400, JSON.stringify(plan));
    return plan;
  }

  /**
   * Report task completion and advance the DAG.
   */
  async completeTask(
    planId: string,
    taskId: string,
    result: string,
    status: 'completed' | 'failed' = 'completed',
    error?: string,
  ): Promise<CoordinationPlan> {
    const planData = await this.redis.get(`fleet:plan:${planId}`);
    if (!planData) throw new Error(`Plan not found: ${planId}`);

    const plan = JSON.parse(planData) as CoordinationPlan;
    const task = plan.tasks.find((t) => t.id === taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    task.status = status;
    task.result = result;
    if (error) task.error = error;

    if (status === 'completed') {
      // Find newly unblocked tasks
      const newlyReady = plan.tasks.filter((t) => {
        if (t.status !== 'pending') return false;
        return t.dependencies.every((depId) => {
          const dep = plan.tasks.find((d) => d.id === depId);
          return dep?.status === 'completed';
        });
      });

      // Dispatch newly ready tasks
      for (const readyTask of newlyReady) {
        await this.dispatchTask(plan, readyTask);
      }
    }

    // Check if plan is complete
    const allDone = plan.tasks.every(
      (t) => t.status === 'completed' || t.status === 'failed',
    );
    if (allDone) {
      const anyFailed = plan.tasks.some((t) => t.status === 'failed');
      plan.status = anyFailed ? 'failed' : 'completed';
    }

    await this.redis.setex(`fleet:plan:${planId}`, 86400, JSON.stringify(plan));
    return plan;
  }

  /**
   * Get plan status.
   */
  async getPlan(planId: string): Promise<CoordinationPlan | null> {
    const planData = await this.redis.get(`fleet:plan:${planId}`);
    if (!planData) return null;
    return JSON.parse(planData) as CoordinationPlan;
  }

  /**
   * List active plans.
   */
  async listPlans(): Promise<CoordinationPlan[]> {
    const keys = await this.scanKeys('fleet:plan:*');
    const plans: CoordinationPlan[] = [];

    for (const key of keys) {
      const data = await this.redis.get(key);
      if (data) {
        try {
          plans.push(JSON.parse(data) as CoordinationPlan);
        } catch { /* skip invalid */ }
      }
    }

    return plans.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  // ============================================
  // Private
  // ============================================

  private async scanKeys(pattern: string): Promise<string[]> {
    const keys: string[] = [];
    let cursor = '0';
    do {
      const [nextCursor, batch] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = nextCursor;
      keys.push(...batch);
    } while (cursor !== '0');
    return keys;
  }

  private async dispatchTask(plan: CoordinationPlan, task: CoordinationTask): Promise<void> {
    task.status = 'running';

    // Build context from completed dependency results
    const depResults: string[] = [];
    for (const depId of task.dependencies) {
      const dep = plan.tasks.find((t) => t.id === depId);
      if (dep?.result) {
        depResults.push(`[${dep.assignedAgent}] ${dep.title}: ${dep.result}`);
      }
    }

    const contextPrefix = depResults.length > 0
      ? `## Prior Results\n${depResults.join('\n')}\n\n## Your Task\n`
      : '';

    const input = `${contextPrefix}${task.description}`;

    // Dispatch via Redis pubsub to agent container
    const payload = JSON.stringify({
      executionId: ulid(),
      agentId: task.assignedAgentId,
      input,
      ownerId: plan.leadAgentId,
      sessionId: null,
      timestamp: new Date().toISOString(),
      planId: plan.id,
      taskId: task.id,
    });

    await this.redis.publish(`agent:${task.assignedAgentId}:tasks`, payload);
    console.log(`[FleetCoordinator] Dispatched task "${task.title}" to ${task.assignedAgent}`);
  }
}
