/**
 * Built-in Tool: Agent Chat (Level 13 — Vibe Collaboration)
 * Multi-agent collaborative discussions: create chat sessions, run discussion
 * rounds, get individual agent responses, and manage session lifecycle.
 */

import { query } from '../../database.js';
import {
  createChatSession,
  runChatRound,
  getAgentResponse,
  getChatSession,
  listChatSessions,
  endChatSession,
} from '../../orchestration/multi-agent-chat.js';
import { getExecutionContext } from '../../runtime/execution-context.js';
import type { ToolResult } from '../registry.js';

// ============================================
// Types
// ============================================

export interface AgentChatInput {
  action: 'create' | 'round' | 'respond' | 'status' | 'end';
  // For create:
  topic?: string;
  agent_ids?: string[];
  // For round, respond, status, end:
  session_id?: string;
  // For respond:
  agent_id?: string;
}

// ============================================
// Constants
// ============================================

const MAX_ACTIVE_SESSIONS = 5;

// ============================================
// Implementation
// ============================================

export async function agentChat(input: AgentChatInput): Promise<ToolResult> {
  const startTime = performance.now();

  try {
    switch (input.action) {
      case 'create':
        return await handleCreate(input, startTime);
      case 'round':
        return await handleRound(input, startTime);
      case 'respond':
        return await handleRespond(input, startTime);
      case 'status':
        return await handleStatus(input, startTime);
      case 'end':
        return await handleEnd(input, startTime);
      default:
        return {
          output: null,
          error: `Unknown action: ${input.action}. Supported: create, round, respond, status, end`,
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

async function handleCreate(input: AgentChatInput, startTime: number): Promise<ToolResult> {
  const ctx = getExecutionContext();
  const moderatorId = ctx?.agentId ?? 'unknown';

  if (moderatorId === 'unknown') {
    return { output: null, error: 'Could not determine agent ID', durationMs: Math.round(performance.now() - startTime) };
  }
  if (!input.topic) {
    return { output: null, error: 'topic is required for create', durationMs: 0 };
  }
  if (!input.agent_ids || input.agent_ids.length === 0) {
    return { output: null, error: 'agent_ids is required for create', durationMs: 0 };
  }

  // Guard: autonomy >= 3
  const agents = await query<{ autonomy_level: number }>(
    `SELECT autonomy_level FROM forge_agents WHERE id = $1`,
    [moderatorId],
  );
  if (agents.length > 0 && agents[0]!.autonomy_level < 3) {
    return {
      output: null,
      error: `Autonomy level ${agents[0]!.autonomy_level} insufficient. Need >= 3 to initiate agent chat.`,
      durationMs: Math.round(performance.now() - startTime),
    };
  }

  // Guard: max active sessions
  const activeSessions = listChatSessions().filter((s) => s.status === 'active');
  if (activeSessions.length >= MAX_ACTIVE_SESSIONS) {
    return {
      output: null,
      error: `Too many active chat sessions (${activeSessions.length}/${MAX_ACTIVE_SESSIONS}). End some sessions first.`,
      durationMs: Math.round(performance.now() - startTime),
    };
  }

  const session = await createChatSession(input.topic, input.agent_ids, moderatorId);

  return {
    output: {
      session_id: session.id,
      topic: session.topic,
      agents: session.agents,
      status: session.status,
      moderator_id: session.moderatorId,
      message_count: session.messages.length,
      message: `Chat session created with ${session.agents.length} agents on topic "${session.topic}".`,
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}

// ============================================
// Round Action
// ============================================

async function handleRound(input: AgentChatInput, startTime: number): Promise<ToolResult> {
  if (!input.session_id) {
    return { output: null, error: 'session_id is required for round', durationMs: 0 };
  }

  const session = getChatSession(input.session_id);
  if (!session) {
    return { output: null, error: `Chat session not found: ${input.session_id}`, durationMs: Math.round(performance.now() - startTime) };
  }
  if (session.status !== 'active') {
    return { output: null, error: `Chat session is ${session.status}, not active`, durationMs: Math.round(performance.now() - startTime) };
  }

  const responses = await runChatRound(input.session_id);

  return {
    output: {
      session_id: input.session_id,
      responses: responses.map((r) => ({
        agent_id: r.agentId,
        agent_name: r.agentName,
        role: r.role,
        content: r.content,
        timestamp: r.timestamp,
      })),
      total_responses: responses.length,
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}

// ============================================
// Respond Action
// ============================================

async function handleRespond(input: AgentChatInput, startTime: number): Promise<ToolResult> {
  if (!input.session_id) {
    return { output: null, error: 'session_id is required for respond', durationMs: 0 };
  }
  if (!input.agent_id) {
    return { output: null, error: 'agent_id is required for respond', durationMs: 0 };
  }

  const response = await getAgentResponse(input.session_id, input.agent_id);
  if (!response) {
    return {
      output: null,
      error: `No response from agent ${input.agent_id} in session ${input.session_id}`,
      durationMs: Math.round(performance.now() - startTime),
    };
  }

  return {
    output: {
      session_id: input.session_id,
      agent_id: response.agentId,
      agent_name: response.agentName,
      role: response.role,
      content: response.content,
      timestamp: response.timestamp,
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}

// ============================================
// Status Action
// ============================================

async function handleStatus(input: AgentChatInput, startTime: number): Promise<ToolResult> {
  if (!input.session_id) {
    // List all sessions
    const sessions = listChatSessions();
    return {
      output: {
        sessions: sessions.map((s) => ({
          id: s.id,
          topic: s.topic,
          status: s.status,
          agent_count: s.agentCount,
          message_count: s.messageCount,
        })),
        total: sessions.length,
      },
      durationMs: Math.round(performance.now() - startTime),
    };
  }

  const session = getChatSession(input.session_id);
  if (!session) {
    return { output: null, error: `Chat session not found: ${input.session_id}`, durationMs: Math.round(performance.now() - startTime) };
  }

  // Return last 20 messages to avoid overwhelming output
  const recentMessages = session.messages.slice(-20);

  return {
    output: {
      session_id: session.id,
      topic: session.topic,
      status: session.status,
      agents: session.agents,
      moderator_id: session.moderatorId,
      total_messages: session.messages.length,
      recent_messages: recentMessages.map((m) => ({
        agent_id: m.agentId,
        agent_name: m.agentName,
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
      })),
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}

// ============================================
// End Action
// ============================================

async function handleEnd(input: AgentChatInput, startTime: number): Promise<ToolResult> {
  if (!input.session_id) {
    return { output: null, error: 'session_id is required for end', durationMs: 0 };
  }

  const session = endChatSession(input.session_id);
  if (!session) {
    return { output: null, error: `Chat session not found or already ended: ${input.session_id}`, durationMs: Math.round(performance.now() - startTime) };
  }

  return {
    output: {
      session_id: session.id,
      topic: session.topic,
      status: session.status,
      total_messages: session.messages.length,
      message: `Chat session ended. ${session.messages.length} total messages.`,
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}
