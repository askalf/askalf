/**
 * Built-in Tool: Checkpoint Ops (Level 14 — Vibe Governance)
 * Human-in-the-loop checkpoints: create approval/review/input requests,
 * list pending checkpoints, respond to checkpoints, and check status.
 */

import { query, queryOne } from '../../database.js';
import {
  createCheckpoint,
  getActiveCheckpoints,
  respondToCheckpoint,
  type CheckpointRow,
} from '../../orchestration/checkpoint.js';
import { getExecutionContext } from '../../runtime/execution-context.js';
import type { ToolResult } from '../registry.js';

// ============================================
// Types
// ============================================

export interface CheckpointOpsInput {
  action: 'create' | 'list' | 'respond' | 'get';
  // For create:
  type?: 'approval' | 'review' | 'input' | 'confirmation';
  title?: string;
  description?: string;
  context?: Record<string, unknown>;
  timeout_minutes?: number;
  // For respond:
  checkpoint_id?: string;
  response?: Record<string, unknown>;
  // For get:
  // checkpoint_id (shared with respond)
  // Context:
  agent_id?: string;
}

// ============================================
// Implementation
// ============================================

export async function checkpointOps(input: CheckpointOpsInput): Promise<ToolResult> {
  const startTime = performance.now();

  try {
    switch (input.action) {
      case 'create':
        return await handleCreate(input, startTime);
      case 'list':
        return await handleList(startTime);
      case 'respond':
        return await handleRespond(input, startTime);
      case 'get':
        return await handleGet(input, startTime);
      default:
        return {
          output: null,
          error: `Unknown action: ${input.action}. Supported: create, list, respond, get`,
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
// Create Action
// ============================================

async function handleCreate(input: CheckpointOpsInput, startTime: number): Promise<ToolResult> {
  const ctx = getExecutionContext();
  const ownerId = ctx?.ownerId ?? 'unknown';
  const agentId = input.agent_id ?? ctx?.agentId ?? 'unknown';

  if (ownerId === 'unknown') {
    return { output: null, error: 'Could not determine owner ID', durationMs: Math.round(performance.now() - startTime) };
  }
  if (!input.type) {
    return { output: null, error: 'type is required for create (approval, review, input, confirmation)', durationMs: 0 };
  }
  if (!input.title) {
    return { output: null, error: 'title is required for create', durationMs: 0 };
  }

  // Guard: autonomy >= 2
  const agents = await query<{ autonomy_level: number }>(
    `SELECT autonomy_level FROM forge_agents WHERE id = $1`,
    [agentId],
  );
  if (agents.length > 0 && agents[0]!.autonomy_level < 2) {
    return {
      output: null,
      error: `Autonomy level ${agents[0]!.autonomy_level} insufficient. Need >= 2 to create checkpoints.`,
      durationMs: Math.round(performance.now() - startTime),
    };
  }

  const checkpointId = await createCheckpoint({
    ownerId,
    executionId: ctx?.executionId,
    type: input.type,
    title: input.title,
    description: input.description,
    context: input.context,
    timeoutMinutes: input.timeout_minutes ?? 60,
  });

  return {
    output: {
      checkpoint_id: checkpointId,
      type: input.type,
      title: input.title,
      status: 'pending',
      timeout_minutes: input.timeout_minutes ?? 60,
      message: `Checkpoint created. Awaiting human ${input.type}. ID: ${checkpointId}`,
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}

// ============================================
// List Action
// ============================================

async function handleList(startTime: number): Promise<ToolResult> {
  const ctx = getExecutionContext();
  const ownerId = ctx?.ownerId ?? 'unknown';

  if (ownerId === 'unknown') {
    return { output: null, error: 'Could not determine owner ID', durationMs: Math.round(performance.now() - startTime) };
  }

  const checkpoints = await getActiveCheckpoints(ownerId);

  return {
    output: {
      checkpoints: checkpoints.map((c) => ({
        id: c.id,
        type: c.type,
        title: c.title,
        description: c.description,
        status: c.status,
        execution_id: c.execution_id,
        timeout_at: c.timeout_at,
        created_at: c.created_at,
      })),
      total: checkpoints.length,
      message: checkpoints.length > 0
        ? `${checkpoints.length} pending checkpoint(s) awaiting human response.`
        : 'No pending checkpoints.',
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}

// ============================================
// Respond Action
// ============================================

async function handleRespond(input: CheckpointOpsInput, startTime: number): Promise<ToolResult> {
  const ctx = getExecutionContext();
  const agentId = input.agent_id ?? ctx?.agentId ?? 'unknown';

  if (!input.checkpoint_id) {
    return { output: null, error: 'checkpoint_id is required for respond', durationMs: 0 };
  }
  if (!input.response) {
    return { output: null, error: 'response is required for respond', durationMs: 0 };
  }

  // Guard: autonomy >= 4 to respond to checkpoints
  const agents = await query<{ autonomy_level: number }>(
    `SELECT autonomy_level FROM forge_agents WHERE id = $1`,
    [agentId],
  );
  if (agents.length > 0 && agents[0]!.autonomy_level < 4) {
    return {
      output: null,
      error: `Autonomy level ${agents[0]!.autonomy_level} insufficient. Need >= 4 to respond to checkpoints.`,
      durationMs: Math.round(performance.now() - startTime),
    };
  }

  await respondToCheckpoint(input.checkpoint_id, input.response);

  return {
    output: {
      checkpoint_id: input.checkpoint_id,
      status: 'responded',
      message: `Checkpoint ${input.checkpoint_id} responded to successfully.`,
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}

// ============================================
// Get Action
// ============================================

async function handleGet(input: CheckpointOpsInput, startTime: number): Promise<ToolResult> {
  if (!input.checkpoint_id) {
    return { output: null, error: 'checkpoint_id is required for get', durationMs: 0 };
  }

  const checkpoint = await queryOne<CheckpointRow>(
    `SELECT * FROM forge_checkpoints WHERE id = $1`,
    [input.checkpoint_id],
  );

  if (!checkpoint) {
    return { output: null, error: `Checkpoint not found: ${input.checkpoint_id}`, durationMs: Math.round(performance.now() - startTime) };
  }

  return {
    output: {
      id: checkpoint.id,
      type: checkpoint.type,
      title: checkpoint.title,
      description: checkpoint.description,
      status: checkpoint.status,
      context: checkpoint.context,
      response: checkpoint.response,
      execution_id: checkpoint.execution_id,
      timeout_at: checkpoint.timeout_at,
      responded_at: checkpoint.responded_at,
      created_at: checkpoint.created_at,
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}
