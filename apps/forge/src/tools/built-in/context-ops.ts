/**
 * Built-in Tool: Context Ops (Level 14 — Vibe Governance)
 * Redis-backed shared context for multi-agent coordination: read/write session
 * state, accumulate results in lists, and formalize agent-to-agent handoffs.
 */

import {
  setContext,
  getContext,
  appendContext,
  getContextList,
  listContextKeys,
  createHandoff,
  getHandoff,
} from '../../orchestration/shared-context.js';
import { getExecutionContext } from '../../runtime/execution-context.js';
import type { ToolResult } from '../registry.js';

// ============================================
// Types
// ============================================

export interface ContextOpsInput {
  action: 'set' | 'get' | 'append' | 'list_keys' | 'handoff' | 'get_handoff';
  // For all actions:
  session_id?: string;
  // For set/get/append:
  key?: string;
  value?: unknown;
  // For handoff:
  to_agent_id?: string;
  task?: string;
  progress?: string;
  artifacts?: string[];
  notes?: string;
  // For get_handoff:
  handoff_id?: string;
}

// ============================================
// Implementation
// ============================================

export async function contextOps(input: ContextOpsInput): Promise<ToolResult> {
  const startTime = performance.now();

  try {
    switch (input.action) {
      case 'set':
        return await handleSet(input, startTime);
      case 'get':
        return await handleGet(input, startTime);
      case 'append':
        return await handleAppend(input, startTime);
      case 'list_keys':
        return await handleListKeys(input, startTime);
      case 'handoff':
        return await handleHandoff(input, startTime);
      case 'get_handoff':
        return await handleGetHandoff(input, startTime);
      default:
        return {
          output: null,
          error: `Unknown action: ${input.action}. Supported: set, get, append, list_keys, handoff, get_handoff`,
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
// Set Action
// ============================================

async function handleSet(input: ContextOpsInput, startTime: number): Promise<ToolResult> {
  if (!input.session_id) {
    return { output: null, error: 'session_id is required', durationMs: 0 };
  }
  if (!input.key) {
    return { output: null, error: 'key is required for set', durationMs: 0 };
  }
  if (input.value === undefined) {
    return { output: null, error: 'value is required for set', durationMs: 0 };
  }

  await setContext(input.session_id, input.key, input.value);

  return {
    output: {
      session_id: input.session_id,
      key: input.key,
      message: `Context key "${input.key}" set successfully.`,
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}

// ============================================
// Get Action
// ============================================

async function handleGet(input: ContextOpsInput, startTime: number): Promise<ToolResult> {
  if (!input.session_id) {
    return { output: null, error: 'session_id is required', durationMs: 0 };
  }
  if (!input.key) {
    // If no key, get as list
    const keys = await listContextKeys(input.session_id);
    return {
      output: {
        session_id: input.session_id,
        keys,
        total: keys.length,
        message: `${keys.length} keys in session context.`,
      },
      durationMs: Math.round(performance.now() - startTime),
    };
  }

  const value = await getContext(input.session_id, input.key);

  if (value === null) {
    // Try as list
    const list = await getContextList(input.session_id, input.key);
    if (list.length > 0) {
      return {
        output: {
          session_id: input.session_id,
          key: input.key,
          type: 'list',
          value: list,
          length: list.length,
        },
        durationMs: Math.round(performance.now() - startTime),
      };
    }

    return {
      output: {
        session_id: input.session_id,
        key: input.key,
        value: null,
        message: `Key "${input.key}" not found in session context.`,
      },
      durationMs: Math.round(performance.now() - startTime),
    };
  }

  return {
    output: {
      session_id: input.session_id,
      key: input.key,
      type: 'value',
      value,
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}

// ============================================
// Append Action
// ============================================

async function handleAppend(input: ContextOpsInput, startTime: number): Promise<ToolResult> {
  if (!input.session_id) {
    return { output: null, error: 'session_id is required', durationMs: 0 };
  }
  if (!input.key) {
    return { output: null, error: 'key is required for append', durationMs: 0 };
  }
  if (input.value === undefined) {
    return { output: null, error: 'value is required for append', durationMs: 0 };
  }

  const length = await appendContext(input.session_id, input.key, input.value);

  return {
    output: {
      session_id: input.session_id,
      key: input.key,
      list_length: length,
      message: `Value appended to "${input.key}". List now has ${length} items.`,
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}

// ============================================
// List Keys Action
// ============================================

async function handleListKeys(input: ContextOpsInput, startTime: number): Promise<ToolResult> {
  if (!input.session_id) {
    return { output: null, error: 'session_id is required', durationMs: 0 };
  }

  const keys = await listContextKeys(input.session_id);

  return {
    output: {
      session_id: input.session_id,
      keys,
      total: keys.length,
      message: keys.length > 0
        ? `${keys.length} keys in session context.`
        : 'No keys found in session context.',
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}

// ============================================
// Handoff Action
// ============================================

async function handleHandoff(input: ContextOpsInput, startTime: number): Promise<ToolResult> {
  const ctx = getExecutionContext();
  const fromAgentId = ctx?.agentId ?? 'unknown';

  if (!input.session_id) {
    return { output: null, error: 'session_id is required for handoff', durationMs: 0 };
  }
  if (!input.to_agent_id) {
    return { output: null, error: 'to_agent_id is required for handoff', durationMs: 0 };
  }
  if (!input.task) {
    return { output: null, error: 'task is required for handoff', durationMs: 0 };
  }

  const handoffId = await createHandoff(input.session_id, fromAgentId, input.to_agent_id, {
    task: input.task,
    progress: input.progress ?? '',
    artifacts: input.artifacts,
    notes: input.notes,
  });

  return {
    output: {
      handoff_id: handoffId,
      session_id: input.session_id,
      from_agent_id: fromAgentId,
      to_agent_id: input.to_agent_id,
      task: input.task,
      message: `Handoff created from ${fromAgentId} to ${input.to_agent_id}. ID: ${handoffId}`,
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}

// ============================================
// Get Handoff Action
// ============================================

async function handleGetHandoff(input: ContextOpsInput, startTime: number): Promise<ToolResult> {
  if (!input.session_id) {
    return { output: null, error: 'session_id is required for get_handoff', durationMs: 0 };
  }
  if (!input.handoff_id) {
    return { output: null, error: 'handoff_id is required for get_handoff', durationMs: 0 };
  }

  const handoff = await getHandoff(input.session_id, input.handoff_id);

  if (!handoff) {
    return {
      output: null,
      error: `Handoff not found: ${input.handoff_id} in session ${input.session_id}`,
      durationMs: Math.round(performance.now() - startTime),
    };
  }

  return {
    output: {
      handoff_id: input.handoff_id,
      session_id: input.session_id,
      from_agent_id: handoff.fromAgentId,
      to_agent_id: handoff.toAgentId,
      task: handoff.task,
      progress: handoff.progress,
      artifacts: handoff.artifacts,
      notes: handoff.notes,
      created_at: handoff.createdAt,
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}
