/**
 * Built-in Tool: Event Query (Level 12 — Vibe Reflection)
 * Fleet intelligence: replay execution events, query orchestration sessions,
 * view fleet leaderboard, and monitor event volume.
 */

import {
  getExecutionEvents,
  getSessionEvents,
  getRecentEvents,
  getFleetLeaderboard,
  getEventLogStats,
} from '../../orchestration/event-log.js';
import type { ToolResult } from '../registry.js';

// ============================================
// Types
// ============================================

export interface EventQueryInput {
  action: 'execution' | 'session' | 'recent' | 'leaderboard' | 'stats';
  // For execution:
  execution_id?: string;
  // For session:
  session_id?: string;
  // For recent:
  limit?: number;
}

// ============================================
// Implementation
// ============================================

export async function eventQuery(input: EventQueryInput): Promise<ToolResult> {
  const startTime = performance.now();

  try {
    switch (input.action) {
      case 'execution':
        return await handleExecution(input, startTime);
      case 'session':
        return await handleSession(input, startTime);
      case 'recent':
        return await handleRecent(input, startTime);
      case 'leaderboard':
        return await handleLeaderboard(startTime);
      case 'stats':
        return await handleStats(startTime);
      default:
        return {
          output: null,
          error: `Unknown action: ${input.action}. Supported: execution, session, recent, leaderboard, stats`,
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
// Execution Action
// ============================================

async function handleExecution(input: EventQueryInput, startTime: number): Promise<ToolResult> {
  if (!input.execution_id) {
    return { output: null, error: 'execution_id is required for execution', durationMs: 0 };
  }

  const events = await getExecutionEvents(input.execution_id);

  return {
    output: {
      execution_id: input.execution_id,
      events: events.map((e) => ({
        event_type: e.event_type,
        event_name: e.event_name,
        agent_name: e.agent_name,
        timestamp: e.created_at,
      })),
      total: events.length,
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}

// ============================================
// Session Action
// ============================================

async function handleSession(input: EventQueryInput, startTime: number): Promise<ToolResult> {
  if (!input.session_id) {
    return { output: null, error: 'session_id is required for session', durationMs: 0 };
  }

  const events = await getSessionEvents(input.session_id);

  return {
    output: {
      session_id: input.session_id,
      events: events.map((e) => ({
        event_type: e.event_type,
        event_name: e.event_name,
        agent_name: e.agent_name,
        timestamp: e.created_at,
      })),
      total: events.length,
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}

// ============================================
// Recent Action
// ============================================

async function handleRecent(input: EventQueryInput, startTime: number): Promise<ToolResult> {
  const limit = Math.min(input.limit ?? 50, 200);
  const events = await getRecentEvents(limit);

  return {
    output: {
      events: events.map((e) => ({
        event_type: e.event_type,
        event_name: e.event_name,
        agent_name: e.agent_name,
        execution_id: e.execution_id,
        session_id: e.session_id,
        timestamp: e.created_at,
      })),
      total: events.length,
      limit,
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}

// ============================================
// Leaderboard Action
// ============================================

async function handleLeaderboard(startTime: number): Promise<ToolResult> {
  const leaderboard = await getFleetLeaderboard();

  return {
    output: {
      agents: leaderboard.map((a) => ({
        agent_id: a.agentId,
        agent_name: a.agentName,
        tasks_completed: a.tasksCompleted,
        tasks_failed: a.tasksFailed,
        success_rate: Math.round(a.successRate * 100),
        avg_cost: Math.round(a.avgCost * 10000) / 10000,
        avg_duration_ms: Math.round(a.avgDuration),
        total_cost: Math.round(a.totalCost * 10000) / 10000,
        memory_count: a.memoryCount,
      })),
      total_agents: leaderboard.length,
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}

// ============================================
// Stats Action
// ============================================

async function handleStats(startTime: number): Promise<ToolResult> {
  const stats = await getEventLogStats();

  return {
    output: {
      total_events: stats.totalEvents,
      events_last_24h: stats.eventsLast24h,
      top_event_types: stats.topEventTypes,
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}
