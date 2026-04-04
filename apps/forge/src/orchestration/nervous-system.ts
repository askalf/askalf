/**
 * The Nervous System — Agent-to-Agent Communication
 *
 * Agents communicate directly through a message bus, not just tickets.
 * Real-time inter-agent messaging with intent, urgency, and context.
 *
 * Message types:
 * - REQUEST: "Builder, what's the status of TKT-B002?"
 * - INFORM: "Watchdog here — container X just crashed"
 * - CONSULT: "Fleet Chief asking Cost Optimizer — who's burning money?"
 * - SIGNAL: Emotion/confidence/urgency broadcasts
 * - HANDOFF: Transfer responsibility for a task between agents
 */

import { query, queryOne } from '../database.js';
import { query } from '../database.js';
import { ulid } from 'ulid';

export type MessageType = 'request' | 'inform' | 'consult' | 'signal' | 'handoff';
export type SignalType = 'confidence' | 'urgency' | 'stuck' | 'success' | 'overloaded' | 'idle';

export interface AgentMessage {
  id: string;
  from_agent: string;
  to_agent: string | null;  // null = broadcast to all
  message_type: MessageType;
  subject: string;
  body: string;
  context: Record<string, unknown>;  // ticket_id, execution_id, etc.
  urgency: number;  // 0-1
  requires_response: boolean;
  response_to: string | null;  // reply to a previous message
  created_at: string;
  read_at: string | null;
  responded_at: string | null;
}

export interface AgentSignal {
  agent_id: string;
  agent_name: string;
  signal_type: SignalType;
  value: number;  // 0-1
  context: string;
  timestamp: string;
}

// In-memory signal board (fast reads, persisted to DB periodically)
const signalBoard = new Map<string, AgentSignal>();

/**
 * Send a message from one agent to another.
 */
export async function sendAgentMessage(
  fromAgent: string,
  toAgent: string | null,
  type: MessageType,
  subject: string,
  body: string,
  context: Record<string, unknown> = {},
  urgency: number = 0.5,
  requiresResponse: boolean = false,
  responseTo: string | null = null,
): Promise<string> {
  const id = ulid();
  await query(
    `INSERT INTO agent_messages (id, from_agent, to_agent, message_type, subject, body, context, urgency, requires_response, response_to)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [id, fromAgent, toAgent, type, subject, body, JSON.stringify(context), urgency, requiresResponse, responseTo],
  );

  console.log(`[NervousSystem] ${type.toUpperCase()}: ${fromAgent} → ${toAgent || 'ALL'}: ${subject}`);
  return id;
}

/**
 * Get unread messages for an agent.
 */
export async function getAgentInbox(agentName: string, limit: number = 10): Promise<AgentMessage[]> {
  return query<AgentMessage>(
    `SELECT * FROM agent_messages
     WHERE (to_agent = $1 OR to_agent IS NULL) AND read_at IS NULL
     ORDER BY urgency DESC, created_at DESC LIMIT $2`,
    [agentName, limit],
  );
}

/**
 * Mark messages as read.
 */
export async function markRead(messageIds: string[]): Promise<void> {
  if (messageIds.length === 0) return;
  await query(
    `UPDATE agent_messages SET read_at = NOW() WHERE id = ANY($1)`,
    [messageIds],
  );
}

/**
 * Emit a signal (confidence, urgency, stuck, etc.)
 */
export async function emitSignal(
  agentId: string,
  agentName: string,
  signalType: SignalType,
  value: number,
  context: string = '',
): Promise<void> {
  const signal: AgentSignal = {
    agent_id: agentId,
    agent_name: agentName,
    signal_type: signalType,
    value: Math.max(0, Math.min(1, value)),
    context,
    timestamp: new Date().toISOString(),
  };

  signalBoard.set(`${agentId}:${signalType}`, signal);

  // Persist to DB
  await query(
    `INSERT INTO agent_signals (id, agent_id, agent_name, signal_type, value, context)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [ulid(), agentId, agentName, signalType, value, context],
  );

  // Fleet Chief auto-intervention on critical signals
  if (signalType === 'stuck' && value > 0.8) {
    await sendAgentMessage(
      'System', 'Fleet Chief', 'inform',
      `Agent ${agentName} is stuck`,
      `${agentName} reported stuck signal (${value.toFixed(2)}): ${context}`,
      { agent_id: agentId, signal_type: signalType },
      0.9, false,
    );
  }

  if (signalType === 'overloaded' && value > 0.7) {
    await sendAgentMessage(
      'System', 'Fleet Chief', 'inform',
      `Agent ${agentName} is overloaded`,
      `${agentName} reported overloaded signal (${value.toFixed(2)}): ${context}`,
      { agent_id: agentId, signal_type: signalType },
      0.8, false,
    );
  }
}

/**
 * Read the signal board — get all current agent signals.
 */
export function readSignalBoard(): AgentSignal[] {
  return Array.from(signalBoard.values())
    .filter(s => Date.now() - new Date(s.timestamp).getTime() < 30 * 60 * 1000); // Last 30 min
}

/**
 * Get signals for a specific agent.
 */
export function getAgentSignals(agentId: string): AgentSignal[] {
  return Array.from(signalBoard.values()).filter(s => s.agent_id === agentId);
}

/**
 * Build a fleet context string from all current signals.
 * This gets injected into every agent's system prompt for awareness.
 */
export function buildFleetAwareness(): string {
  const signals = readSignalBoard();
  if (signals.length === 0) return '';

  const lines = ['== FLEET SIGNALS =='];
  const grouped = new Map<string, AgentSignal[]>();
  for (const s of signals) {
    const list = grouped.get(s.agent_name) || [];
    list.push(s);
    grouped.set(s.agent_name, list);
  }

  for (const [name, sigs] of grouped) {
    const parts = sigs.map(s => `${s.signal_type}=${s.value.toFixed(1)}`);
    lines.push(`${name}: ${parts.join(', ')}`);
  }

  return lines.join('\n');
}

/**
 * Post-execution signal emission — called after every agent execution.
 * Automatically emits signals based on execution results.
 */
export async function postExecutionSignals(
  agentId: string,
  agentName: string,
  status: string,
  cost: number,
  durationMs: number,
  output: string,
): Promise<void> {
  // Success signal
  if (status === 'completed') {
    await emitSignal(agentId, agentName, 'success', 1.0, `Completed in ${Math.round(durationMs / 1000)}s, $${cost.toFixed(4)}`);
  }

  // Stuck signal — hit max turns
  if (output?.includes('Max turns reached')) {
    await emitSignal(agentId, agentName, 'stuck', 0.9, `Hit max turns — task incomplete`);
  }

  // Failed
  if (status === 'failed') {
    await emitSignal(agentId, agentName, 'stuck', 0.7, `Execution failed`);
  }

  // Cost concern
  if (cost > 0.5) {
    await emitSignal(agentId, agentName, 'urgency', cost / 2, `High cost execution: $${cost.toFixed(4)}`);
  }

  // Confidence based on output quality
  const hasSubstance = output && output.length > 100 && !output.includes('Max turns');
  await emitSignal(agentId, agentName, 'confidence', hasSubstance ? 0.8 : 0.3, hasSubstance ? 'Substantial output' : 'Low-quality output');
}
