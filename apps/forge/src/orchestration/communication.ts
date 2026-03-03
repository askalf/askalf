/**
 * Agent-to-Agent Communication
 * Redis pub/sub based messaging between agents during workflow execution.
 */

import { Redis } from 'ioredis';
import { query } from '../database.js';
import { ulid } from 'ulid';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentMessage {
  from: string;
  to: string;
  type: string;
  payload: unknown;
  timestamp: string;
}

export type MessageHandler = (message: AgentMessage) => void | Promise<void>;

// ---------------------------------------------------------------------------
// Channel naming
// ---------------------------------------------------------------------------

function agentChannel(agentId: string): string {
  return `forge:agent:${agentId}:messages`;
}

// ---------------------------------------------------------------------------
// AgentCommunication
// ---------------------------------------------------------------------------

/**
 * Manages inter-agent communication using Redis pub/sub.
 *
 * Uses two separate Redis connections: one for publishing (the "main"
 * connection) and one dedicated subscriber connection. This is required
 * because Redis clients in subscribe mode cannot issue other commands.
 *
 * ```ts
 * const comms = new AgentCommunication('redis://localhost:6379');
 * comms.subscribe('agent-B', (msg) => { ... });
 * await comms.publish('forge:agent:agent-B:messages', { from: 'agent-A', ... });
 * ```
 */
export class AgentCommunication {
  private readonly pub: Redis;
  private readonly sub: Redis;
  private readonly handlers: Map<string, Set<MessageHandler>> = new Map();
  private closed = false;

  constructor(redisUrl: string);
  constructor(pubClient: Redis, subClient: Redis);
  constructor(urlOrPub: string | Redis, subClient?: Redis) {
    if (typeof urlOrPub === 'string') {
      this.pub = new Redis(urlOrPub, { maxRetriesPerRequest: null });
      this.sub = new Redis(urlOrPub, { maxRetriesPerRequest: null });
    } else {
      this.pub = urlOrPub;
      this.sub = subClient!;
    }

    // Wire up the subscriber message handler once
    this.sub.on('message', (channel: string, raw: string) => {
      void this.handleIncoming(channel, raw);
    });
  }

  // -----------------------------------------------------------------------
  // Publish
  // -----------------------------------------------------------------------

  /**
   * Publish a message to a raw channel name.
   */
  async publish(channel: string, message: AgentMessage): Promise<void> {
    if (this.closed) throw new Error('AgentCommunication is closed');
    await this.pub.publish(channel, JSON.stringify(message));
  }

  /**
   * Convenience: send a message from one agent to another.
   * Now also persists to forge_agent_messages for durability.
   */
  async sendToAgent(
    fromAgentId: string,
    toAgentId: string,
    type: string,
    payload: unknown,
    opts?: { inReplyTo?: string },
  ): Promise<string> {
    const message: AgentMessage = {
      from: fromAgentId,
      to: toAgentId,
      type,
      payload,
      timestamp: new Date().toISOString(),
    };

    // Persist to DB for durability
    const msgId = ulid();
    const content = typeof payload === 'string' ? payload : JSON.stringify(payload);
    await query(
      `INSERT INTO forge_agent_messages (id, from_agent_id, to_agent_id, message_type, content, in_reply_to)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [msgId, fromAgentId, toAgentId, type, content, opts?.inReplyTo ?? null],
    ).catch((err) => {
      // Don't fail if table doesn't exist yet (pre-migration)
      console.warn('[AgentCommunication] Failed to persist message:', err instanceof Error ? err.message : err);
    });

    // Also publish via Redis for real-time delivery
    await this.publish(agentChannel(toAgentId), message);

    // Update relationship interaction count
    await query(
      `UPDATE forge_agent_relationships SET interaction_count = interaction_count + 1, last_interaction = NOW()
       WHERE (agent_a_id = $1 AND agent_b_id = $2) OR (agent_a_id = $2 AND agent_b_id = $1)`,
      [fromAgentId, toAgentId],
    ).catch(() => {});

    return msgId;
  }

  /**
   * Get unread messages for an agent from the database.
   */
  async getUnreadMessages(agentId: string, limit = 10): Promise<Array<{
    id: string; from_agent_id: string; message_type: string; content: string;
    in_reply_to: string | null; created_at: string;
  }>> {
    return query<{
      id: string; from_agent_id: string; message_type: string; content: string;
      in_reply_to: string | null; created_at: string;
    }>(
      `SELECT id, from_agent_id, message_type, content, in_reply_to, created_at
       FROM forge_agent_messages
       WHERE to_agent_id = $1 AND read_at IS NULL
       ORDER BY created_at ASC LIMIT $2`,
      [agentId, limit],
    ).catch(() => []);
  }

  /**
   * Mark messages as read.
   */
  async markRead(messageIds: string[]): Promise<void> {
    if (messageIds.length === 0) return;
    await query(
      `UPDATE forge_agent_messages SET read_at = NOW() WHERE id = ANY($1)`,
      [messageIds],
    ).catch(() => {});
  }

  // -----------------------------------------------------------------------
  // Subscribe
  // -----------------------------------------------------------------------

  /**
   * Subscribe to messages for a given agent ID.
   * Multiple handlers can be registered per agent.
   */
  async subscribe(agentId: string, handler: MessageHandler): Promise<void> {
    if (this.closed) throw new Error('AgentCommunication is closed');

    const channel = agentChannel(agentId);

    let handlerSet = this.handlers.get(channel);
    if (!handlerSet) {
      handlerSet = new Set();
      this.handlers.set(channel, handlerSet);
      // Only subscribe at the Redis level for the first handler on this channel
      await this.sub.subscribe(channel);
    }
    handlerSet.add(handler);
  }

  /**
   * Unsubscribe a specific handler. If it was the last handler for the
   * channel, the Redis subscription is also removed.
   */
  async unsubscribe(agentId: string, handler: MessageHandler): Promise<void> {
    const channel = agentChannel(agentId);
    const handlerSet = this.handlers.get(channel);
    if (!handlerSet) return;

    handlerSet.delete(handler);

    if (handlerSet.size === 0) {
      this.handlers.delete(channel);
      await this.sub.unsubscribe(channel);
    }
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /**
   * Disconnect both Redis clients and clear all handlers.
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.handlers.clear();
    await this.sub.quit();
    await this.pub.quit();
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  /**
   * Check if this instance is still open.
   */
  get isOpen(): boolean {
    return !this.closed;
  }

  private async handleIncoming(channel: string, raw: string): Promise<void> {
    const handlerSet = this.handlers.get(channel);
    if (!handlerSet || handlerSet.size === 0) return;

    let parsed: AgentMessage;
    try {
      parsed = JSON.parse(raw) as AgentMessage;
    } catch {
      console.error(`[AgentCommunication] Failed to parse message on ${channel}:`, raw);
      return;
    }

    const promises: Promise<void>[] = [];
    for (const handler of handlerSet) {
      try {
        const result = handler(parsed);
        if (result && typeof result.then === 'function') {
          promises.push(result);
        }
      } catch (err) {
        console.error(`[AgentCommunication] Handler error on ${channel}:`, err);
      }
    }

    if (promises.length > 0) {
      await Promise.allSettled(promises);
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let instance: AgentCommunication | null = null;

/**
 * Initialize the global AgentCommunication singleton.
 */
export function initAgentCommunication(redisUrl: string): AgentCommunication {
  if (instance) return instance;
  instance = new AgentCommunication(redisUrl);
  console.log('[AgentCommunication] Initialized');
  return instance;
}

/**
 * Get the global AgentCommunication instance.
 */
export function getAgentCommunication(): AgentCommunication | null {
  return instance;
}

/**
 * Close the global AgentCommunication instance.
 */
export async function closeAgentCommunication(): Promise<void> {
  if (instance) {
    await instance.close();
    instance = null;
  }
}
