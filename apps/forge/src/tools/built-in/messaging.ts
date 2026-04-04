/**
 * Built-in Tool: Messaging (Level 15 — Vibe Completeness)
 * Agent-to-agent messaging via Redis pub/sub and forge event bus.
 * Send direct messages, publish to channels, and emit custom events.
 */

import { loadConfig } from '../../config.js';
import { AgentCommunication, type AgentMessage } from '../../orchestration/communication.js';
import { getEventBus } from '../../orchestration/event-bus.js';
import { getExecutionContext } from '../../runtime/execution-context.js';
import type { ToolResult } from '../registry.js';

// ============================================
// Lazy AgentCommunication singleton
// ============================================

let comms: AgentCommunication | null = null;

function getComms(): AgentCommunication {
  if (!comms) {
    const config = loadConfig();
    comms = new AgentCommunication(config.redisUrl);
  }
  return comms;
}

// ============================================
// Types
// ============================================

export interface MessagingInput {
  action: 'send' | 'publish' | 'emit_event';
  // For send:
  to_agent_id?: string;
  type?: string;
  payload?: unknown;
  // For publish:
  channel?: string;
  message?: unknown;
  // For emit_event:
  event_type?: string;
  event_data?: Record<string, unknown>;
  // Context:
  agent_id?: string;
}

// ============================================
// Implementation
// ============================================

export async function messaging(input: MessagingInput): Promise<ToolResult> {
  const startTime = performance.now();

  try {
    switch (input.action) {
      case 'send':
        return await handleSend(input, startTime);
      case 'publish':
        return await handlePublish(input, startTime);
      case 'emit_event':
        return await handleEmitEvent(input, startTime);
      default:
        return {
          output: null,
          error: `Unknown action: ${input.action}. Supported: send, publish, emit_event`,
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
// Send Action
// ============================================

async function handleSend(input: MessagingInput, startTime: number): Promise<ToolResult> {
  const ctx = getExecutionContext();
  const fromAgentId = input.agent_id ?? ctx?.agentId ?? 'unknown';

  if (!input.to_agent_id) {
    return { output: null, error: 'to_agent_id is required for send', durationMs: 0 };
  }
  if (!input.type) {
    return { output: null, error: 'type is required for send (e.g., info, request, response, alert)', durationMs: 0 };
  }

  const comm = getComms();
  await comm.sendToAgent(fromAgentId, input.to_agent_id, input.type, input.payload ?? {});

  return {
    output: {
      from_agent_id: fromAgentId,
      to_agent_id: input.to_agent_id,
      type: input.type,
      message: `Message sent from ${fromAgentId} to ${input.to_agent_id} (type: ${input.type}).`,
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}

// ============================================
// Publish Action
// ============================================

async function handlePublish(input: MessagingInput, startTime: number): Promise<ToolResult> {
  const ctx = getExecutionContext();
  const fromAgentId = input.agent_id ?? ctx?.agentId ?? 'unknown';

  if (!input.channel) {
    return { output: null, error: 'channel is required for publish', durationMs: 0 };
  }

  const comm = getComms();
  const msg: AgentMessage = {
    from: fromAgentId,
    to: input.channel,
    type: 'broadcast',
    payload: input.message ?? {},
    timestamp: new Date().toISOString(),
  };
  await comm.publish(input.channel, msg);

  return {
    output: {
      channel: input.channel,
      from_agent_id: fromAgentId,
      message: `Message published to channel "${input.channel}".`,
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}

// ============================================
// Emit Event Action
// ============================================

async function handleEmitEvent(input: MessagingInput, startTime: number): Promise<ToolResult> {
  const ctx = getExecutionContext();
  const agentId = input.agent_id ?? ctx?.agentId ?? 'unknown';

  if (!input.event_type) {
    return { output: null, error: 'event_type is required for emit_event', durationMs: 0 };
  }

  const eventBus = getEventBus();
  if (!eventBus) {
    return { output: null, error: 'Event bus not initialized', durationMs: Math.round(performance.now() - startTime) };
  }

  await eventBus.emitAgent('status_changed', agentId, agentId, {
    custom_event_type: input.event_type,
    ...(input.event_data ?? {}),
  });

  return {
    output: {
      event_type: input.event_type,
      agent_id: agentId,
      message: `Event "${input.event_type}" emitted successfully.`,
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}
