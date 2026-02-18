/**
 * Live Multi-Agent Conversations (Phase 8)
 * Enables real-time multi-agent chat sessions where agents can collaborate,
 * with a human moderator able to observe and intervene.
 */

import { ulid } from 'ulid';
import { query } from '../database.js';
import { runCliQuery } from '../runtime/worker.js';
import { getEventBus } from './event-bus.js';
import { setContext, getContextList, appendContext } from './shared-context.js';

export interface ChatSession {
  id: string;
  topic: string;
  agents: string[];
  status: 'active' | 'paused' | 'completed';
  moderatorId: string;
  messages: ChatMessage[];
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  agentId: string;
  agentName: string;
  role: 'agent' | 'moderator' | 'system';
  content: string;
  replyTo?: string;
  timestamp: string;
}

// In-memory session store (transient — cleared on restart)
const sessions = new Map<string, ChatSession>();

/**
 * Create a new multi-agent chat session.
 */
export async function createChatSession(
  topic: string,
  agentIds: string[],
  moderatorId: string,
): Promise<ChatSession> {
  const sessionId = ulid();

  // Verify agents exist
  const agents = await query<{ id: string; name: string }>(
    `SELECT id, name FROM forge_agents WHERE id = ANY($1)`,
    [agentIds],
  );

  if (agents.length === 0) {
    throw new Error('No valid agents found');
  }

  const session: ChatSession = {
    id: sessionId,
    topic,
    agents: agents.map((a) => a.id),
    status: 'active',
    moderatorId,
    messages: [],
  };

  sessions.set(sessionId, session);

  // Store session context for agent recall
  await setContext(sessionId, 'topic', topic);
  await setContext(sessionId, 'agents', JSON.stringify(agents.map((a) => ({ id: a.id, name: a.name }))));

  // Send system message
  const systemMsg: ChatMessage = {
    id: ulid(),
    sessionId,
    agentId: 'system',
    agentName: 'System',
    role: 'system',
    content: `Chat session started. Topic: "${topic}". Participants: ${agents.map((a) => a.name).join(', ')}.`,
    timestamp: new Date().toISOString(),
  };
  session.messages.push(systemMsg);

  const eventBus = getEventBus();
  void eventBus?.emitCoordination('plan_created', sessionId, {
    data: { type: 'multi-agent-chat', topic, agents: agents.map((a) => a.name) },
  }).catch(() => {});

  return session;
}

/**
 * Send a message from the moderator into the chat.
 */
export function addModeratorMessage(sessionId: string, content: string, moderatorId: string): ChatMessage | null {
  const session = sessions.get(sessionId);
  if (!session || session.status !== 'active') return null;

  const msg: ChatMessage = {
    id: ulid(),
    sessionId,
    agentId: moderatorId,
    agentName: 'Moderator',
    role: 'moderator',
    content,
    timestamp: new Date().toISOString(),
  };

  session.messages.push(msg);
  void appendContext(sessionId, 'chat-history', JSON.stringify(msg)).catch(() => {});

  return msg;
}

/**
 * Have a specific agent respond in the chat.
 * Uses the agent's system prompt + conversation context to generate a response.
 */
export async function getAgentResponse(
  sessionId: string,
  agentId: string,
): Promise<ChatMessage | null> {
  const session = sessions.get(sessionId);
  if (!session || session.status !== 'active') return null;

  // Get agent info
  const agents = await query<{ id: string; name: string; system_prompt: string }>(
    `SELECT id, name, system_prompt FROM forge_agents WHERE id = $1`,
    [agentId],
  );
  if (agents.length === 0) return null;
  const agent = agents[0]!;

  // Build conversation context (last 20 messages)
  const recentMessages = session.messages.slice(-20);
  const conversationContext = recentMessages
    .map((m) => `[${m.agentName}]: ${m.content}`)
    .join('\n');

  const prompt = `You are participating in a multi-agent discussion about: "${session.topic}"

Your role: ${agent.name}
Your guidelines: ${agent.system_prompt.substring(0, 500)}

Recent conversation:
${conversationContext}

Respond naturally to the conversation. Be concise (2-4 sentences). Build on what others have said. If you have nothing meaningful to add, say so briefly.`;

  try {
    const result = await runCliQuery(prompt, {
      model: 'claude-haiku-4-5',
      maxTurns: 1,
      timeout: 30000,
    });

    const msg: ChatMessage = {
      id: ulid(),
      sessionId,
      agentId: agent.id,
      agentName: agent.name,
      role: 'agent',
      content: result.isError ? '[Agent could not respond]' : result.output.trim(),
      timestamp: new Date().toISOString(),
    };

    session.messages.push(msg);
    void appendContext(sessionId, 'chat-history', JSON.stringify(msg)).catch(() => {});

    const eventBus = getEventBus();
    void eventBus?.emitAgent('status_changed', agent.id, agent.name, {
      event: 'chat_message',
      sessionId,
      messageId: msg.id,
    }).catch(() => {});

    return msg;
  } catch (err) {
    console.warn(`[MultiChat] Agent ${agent.name} response failed:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Run a round-robin turn where each agent responds sequentially.
 */
export async function runChatRound(sessionId: string): Promise<ChatMessage[]> {
  const session = sessions.get(sessionId);
  if (!session || session.status !== 'active') return [];

  const responses: ChatMessage[] = [];
  for (const agentId of session.agents) {
    const msg = await getAgentResponse(sessionId, agentId);
    if (msg) responses.push(msg);
  }
  return responses;
}

/**
 * End a chat session.
 */
export function endChatSession(sessionId: string): ChatSession | null {
  const session = sessions.get(sessionId);
  if (!session) return null;
  session.status = 'completed';

  const systemMsg: ChatMessage = {
    id: ulid(),
    sessionId,
    agentId: 'system',
    agentName: 'System',
    role: 'system',
    content: 'Chat session ended.',
    timestamp: new Date().toISOString(),
  };
  session.messages.push(systemMsg);

  return session;
}

/**
 * Get a chat session by ID.
 */
export function getChatSession(sessionId: string): ChatSession | null {
  return sessions.get(sessionId) ?? null;
}

/**
 * List active chat sessions.
 */
export function listChatSessions(): Array<{ id: string; topic: string; status: string; agentCount: number; messageCount: number }> {
  return Array.from(sessions.values()).map((s) => ({
    id: s.id,
    topic: s.topic,
    status: s.status,
    agentCount: s.agents.length,
    messageCount: s.messages.length,
  }));
}
