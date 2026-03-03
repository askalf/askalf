/**
 * Task Dispatcher
 *
 * Bridges FleetCoordinator's Redis pubsub task dispatches with actual
 * CLI agent execution. Without this, FleetCoordinator.dispatchTask()
 * publishes to `agent:{id}:tasks` but nothing picks up the work.
 *
 * Flow:
 * 1. FleetCoordinator publishes task → `agent:{agentId}:tasks`
 * 2. TaskDispatcher receives via psubscribe → creates execution → runs CLI
 *    OR routes to a connected remote device via agent bridge
 * 3. On completion, publishes result → `agent:{agentId}:results`
 * 4. TeamManager picks up result → advances DAG → dispatches next tasks
 */

import { Redis } from 'ioredis';
import { ulid } from 'ulid';
import { query, queryOne } from '../database.js';
import { runDirectCliExecution } from './worker.js';
import { getOnlineDeviceSession, dispatchTaskToDevice } from './agent-bridge.js';
import { findOnlineDevice } from './device-registry.js';

// ============================================
// Types
// ============================================

interface DispatchedTask {
  executionId: string;
  agentId: string;
  input: string;
  ownerId: string;
  timestamp: string;
  planId?: string;
  taskId?: string;
}

// ============================================
// Task Dispatcher
// ============================================

let subscriber: Redis | null = null;
let publisher: Redis | null = null;
let running = false;

/**
 * Get the Redis publisher (used by agent-bridge to publish results).
 */
export function getRedisPublisher(): Redis | null {
  return publisher;
}

/**
 * Start the task dispatcher daemon.
 * Subscribes to all `agent:*:tasks` channels and dispatches
 * incoming tasks as CLI executions.
 */
export async function startTaskDispatcher(redisUrl: string): Promise<void> {
  if (running) return;

  subscriber = new Redis(redisUrl, { maxRetriesPerRequest: null });
  publisher = new Redis(redisUrl, { maxRetriesPerRequest: null });
  running = true;

  subscriber.on('error', (err) => {
    console.error(`[TaskDispatcher] Redis subscriber error: ${err.message}`);
  });

  // Use pattern subscribe to catch all agent task channels
  await subscriber.psubscribe('agent:*:tasks');

  subscriber.on('pmessage', (_pattern: string, channel: string, message: string) => {
    void handleTask(channel, message).catch((err) => {
      console.error(`[TaskDispatcher] Error handling task: ${err instanceof Error ? err.message : String(err)}`);
    });
  });

  console.log('[TaskDispatcher] Listening for fleet coordination tasks on agent:*:tasks');
}

/**
 * Handle an incoming task dispatch from FleetCoordinator.
 */
async function handleTask(channel: string, message: string): Promise<void> {
  let task: DispatchedTask;
  try {
    task = JSON.parse(message) as DispatchedTask;
  } catch {
    console.error('[TaskDispatcher] Invalid task payload, skipping');
    return;
  }

  if (!task.agentId || !task.input) {
    console.error('[TaskDispatcher] Task missing agentId or input, skipping');
    return;
  }

  // Look up agent details for model/prompt config
  const agent = await queryOne<{
    id: string;
    name: string;
    model_id: string | null;
    system_prompt: string | null;
    max_cost_per_execution: string | null;
    max_iterations: number | null;
  }>(
    `SELECT id, name, model_id, system_prompt, max_cost_per_execution, max_iterations
     FROM forge_agents WHERE id = $1 AND status = 'active'`,
    [task.agentId],
  );

  if (!agent) {
    console.error(`[TaskDispatcher] Agent ${task.agentId} not found or inactive, skipping task`);
    await publishResult(task, 'failed', '', 'Agent not found or inactive');
    return;
  }

  // Create execution record
  const execId = ulid();
  const ownerId = task.ownerId || 'system:fleet';

  // Check if task owner has an online device — route there for computer-use execution
  const deviceSession = getOnlineDeviceSession(ownerId);
  const onlineDevice = deviceSession ? null : await findOnlineDevice(ownerId);
  const targetDeviceId = deviceSession?.deviceId ?? null;

  const metadata = {
    planId: task.planId,
    taskId: task.taskId,
    source: 'fleet-dispatch',
    ...(targetDeviceId ? { device_id: targetDeviceId, execution_mode: 'remote-device' } : { execution_mode: 'forge-internal' }),
  };

  await query(
    `INSERT INTO forge_executions (id, agent_id, owner_id, input, status, metadata, device_id, created_at)
     VALUES ($1, $2, $3, $4, 'pending', $5, $6, NOW())`,
    [
      execId,
      task.agentId,
      ownerId,
      task.input,
      JSON.stringify(metadata),
      targetDeviceId,
    ],
  );

  // Try dispatching to remote device first
  if (targetDeviceId) {
    const maxBudget = agent.max_cost_per_execution ? parseFloat(agent.max_cost_per_execution) : undefined;
    const dispatched = dispatchTaskToDevice(
      targetDeviceId,
      execId,
      task.agentId,
      agent.name,
      task.input,
      agent.max_iterations ?? undefined,
      maxBudget,
    );

    if (dispatched) {
      console.log(
        `[TaskDispatcher] Routed ${agent.name} (exec=${execId}) to device=${targetDeviceId} ` +
        `plan=${task.planId ?? 'none'} task=${task.taskId ?? 'none'}`,
      );
      // Result will be reported back via WebSocket → agent-bridge → publishResult
      return;
    }

    // Device dispatch failed (connection dropped) — fall through to internal execution
    console.log(`[TaskDispatcher] Device dispatch failed for ${targetDeviceId}, falling back to internal execution`);
    await query(
      `UPDATE forge_executions SET metadata = jsonb_set(metadata, '{execution_mode}', '"forge-internal-fallback"') WHERE id = $1`,
      [execId],
    );
  }

  console.log(
    `[TaskDispatcher] Dispatching ${agent.name} (exec=${execId}) internally ` +
    `plan=${task.planId ?? 'none'} task=${task.taskId ?? 'none'}`,
  );

  const startTime = Date.now();

  try {
    // Run the CLI execution (this blocks until completion)
    await runDirectCliExecution(execId, task.agentId, task.input, ownerId, {
      modelId: agent.model_id ?? undefined,
      systemPrompt: agent.system_prompt ?? undefined,
      maxBudgetUsd: agent.max_cost_per_execution ?? undefined,
      maxTurns: agent.max_iterations ?? undefined,
    });

    // Fetch the execution result
    const exec = await queryOne<{ status: string; output: string | null; error: string | null }>(
      `SELECT status, output, error FROM forge_executions WHERE id = $1`,
      [execId],
    );

    const durationMs = Date.now() - startTime;
    const status = exec?.status === 'completed' ? 'completed' : 'failed';

    await publishResult(
      task,
      status as 'completed' | 'failed',
      exec?.output ?? '',
      exec?.error ?? undefined,
      execId,
      durationMs,
    );

    console.log(
      `[TaskDispatcher] ${agent.name} ${status} (${Math.round(durationMs / 1000)}s) ` +
      `plan=${task.planId ?? 'none'} task=${task.taskId ?? 'none'}`,
    );
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const errorMsg = err instanceof Error ? err.message : String(err);

    await publishResult(task, 'failed', '', errorMsg, execId, durationMs);

    console.error(
      `[TaskDispatcher] ${agent.name} execution error: ${errorMsg} ` +
      `plan=${task.planId ?? 'none'} task=${task.taskId ?? 'none'}`,
    );
  }
}

/**
 * Publish a task result back to Redis for TeamManager to pick up.
 */
async function publishResult(
  task: DispatchedTask,
  status: 'completed' | 'failed',
  output: string,
  error?: string,
  executionId?: string,
  durationMs?: number,
): Promise<void> {
  if (!publisher) return;

  const result = {
    executionId: executionId ?? task.executionId ?? ulid(),
    agentId: task.agentId,
    status,
    output,
    error,
    durationMs: durationMs ?? 0,
    planId: task.planId,
    taskId: task.taskId,
  };

  await publisher.publish(
    `agent:${task.agentId}:results`,
    JSON.stringify(result),
  );
}

/**
 * Shut down the task dispatcher.
 */
export async function stopTaskDispatcher(): Promise<void> {
  running = false;
  try {
    if (subscriber) {
      await subscriber.punsubscribe();
      await subscriber.quit();
      subscriber = null;
    }
    if (publisher) {
      await publisher.quit();
      publisher = null;
    }
  } catch {
    // Ignore cleanup errors
  }
}
