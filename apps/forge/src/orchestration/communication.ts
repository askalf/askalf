/**
 * Agent-to-Agent Communication
 * Redis pub/sub based messaging between agents during workflow execution.
 */

import { Redis } from 'ioredis';

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
   */
  async sendToAgent(
    fromAgentId: string,
    toAgentId: string,
    type: string,
    payload: unknown,
  ): Promise<void> {
    const message: AgentMessage = {
      from: fromAgentId,
      to: toAgentId,
      type,
      payload,
      timestamp: new Date().toISOString(),
    };
    await this.publish(agentChannel(toAgentId), message);
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
