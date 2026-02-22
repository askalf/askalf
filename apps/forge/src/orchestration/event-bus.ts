/**
 * Forge Event Bus (Phase 5)
 * Unified real-time event system bridging execution lifecycle, agent messaging,
 * fleet coordination, and client SSE updates.
 *
 * Architecture:
 * - Redis pub/sub for cross-process events
 * - In-memory EventEmitter for in-process listeners
 * - Channels: forge:events:{type} for lifecycle, forge:agent:{id}:messages for messaging
 */

import { Redis } from 'ioredis';
import { EventEmitter } from 'events';

// ============================================
// Event Types
// ============================================

export interface ExecutionEvent {
  type: 'execution';
  event: 'started' | 'progress' | 'completed' | 'failed' | 'cancelled';
  executionId: string;
  agentId: string;
  agentName: string;
  data?: {
    input?: string;
    output?: string;
    error?: string;
    tokens?: number;
    cost?: number;
    durationMs?: number;
    turns?: number;
  };
  timestamp: string;
}

export interface CoordinationEvent {
  type: 'coordination';
  event: 'plan_created' | 'task_started' | 'task_completed' | 'task_failed' | 'plan_completed' | 'plan_failed';
  sessionId: string;
  planId?: string;
  taskId?: string;
  agentId?: string;
  agentName?: string;
  data?: Record<string, unknown>;
  timestamp: string;
}

export interface AgentEvent {
  type: 'agent';
  event: 'status_changed' | 'capability_updated' | 'feedback_received' | 'memory_stored';
  agentId: string;
  agentName: string;
  data?: Record<string, unknown>;
  timestamp: string;
}

export interface HandoffEvent {
  type: 'handoff';
  event: 'requested' | 'accepted' | 'rejected' | 'completed';
  fromAgentId: string;
  toAgentId: string;
  sessionId?: string;
  context?: string;
  timestamp: string;
}

export type ForgeEvent = ExecutionEvent | CoordinationEvent | AgentEvent | HandoffEvent;

export type EventHandler = (event: ForgeEvent) => void | Promise<void>;

// ============================================
// Channels
// ============================================

const CHANNELS = {
  execution: 'forge:events:execution',
  coordination: 'forge:events:coordination',
  agent: 'forge:events:agent',
  handoff: 'forge:events:handoff',
  all: 'forge:events:*',
} as const;

// ============================================
// Event Bus Singleton
// ============================================

let instance: ForgeEventBus | null = null;

export class ForgeEventBus {
  private pub: Redis;
  private sub: Redis;
  private emitter: EventEmitter;
  private closed = false;

  constructor(redisUrl: string) {
    this.pub = new Redis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: true });
    this.sub = new Redis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: true });
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(100);
  }

  async connect(): Promise<void> {
    await Promise.all([this.pub.connect(), this.sub.connect()]);

    // Subscribe to all forge event channels using pattern
    await this.sub.psubscribe(CHANNELS.all);

    this.sub.on('pmessage', (_pattern: string, channel: string, raw: string) => {
      try {
        const event = JSON.parse(raw) as ForgeEvent;
        // Emit locally for in-process listeners
        this.emitter.emit(event.type, event);
        this.emitter.emit('*', event);
      } catch {
        // Ignore malformed messages
      }
    });

    console.log('[EventBus] Connected to Redis, listening on forge:events:*');
  }

  // -----------------------------------------------------------------------
  // Publish
  // -----------------------------------------------------------------------

  async emit(event: ForgeEvent): Promise<void> {
    if (this.closed) return;

    const channel = `forge:events:${event.type}`;

    // Publish to Redis — the psubscribe handler will emit locally when it arrives back
    await this.pub.publish(channel, JSON.stringify(event)).catch(() => {});
  }

  // -----------------------------------------------------------------------
  // Convenience emitters
  // -----------------------------------------------------------------------

  async emitExecution(
    eventName: ExecutionEvent['event'],
    executionId: string,
    agentId: string,
    agentName: string,
    data?: ExecutionEvent['data'],
  ): Promise<void> {
    await this.emit({
      type: 'execution',
      event: eventName,
      executionId,
      agentId,
      agentName,
      data,
      timestamp: new Date().toISOString(),
    });
  }

  async emitCoordination(
    eventName: CoordinationEvent['event'],
    sessionId: string,
    extra?: Partial<Omit<CoordinationEvent, 'type' | 'event' | 'sessionId' | 'timestamp'>>,
  ): Promise<void> {
    await this.emit({
      type: 'coordination',
      event: eventName,
      sessionId,
      ...extra,
      timestamp: new Date().toISOString(),
    });
  }

  async emitAgent(
    eventName: AgentEvent['event'],
    agentId: string,
    agentName: string,
    data?: Record<string, unknown>,
  ): Promise<void> {
    await this.emit({
      type: 'agent',
      event: eventName,
      agentId,
      agentName,
      data,
      timestamp: new Date().toISOString(),
    });
  }

  async emitHandoff(
    eventName: HandoffEvent['event'],
    fromAgentId: string,
    toAgentId: string,
    extra?: { sessionId?: string; context?: string },
  ): Promise<void> {
    await this.emit({
      type: 'handoff',
      event: eventName,
      fromAgentId,
      toAgentId,
      ...extra,
      timestamp: new Date().toISOString(),
    });
  }

  // -----------------------------------------------------------------------
  // Subscribe
  // -----------------------------------------------------------------------

  on(eventType: ForgeEvent['type'] | '*', handler: EventHandler): void {
    this.emitter.on(eventType, handler);
  }

  off(eventType: ForgeEvent['type'] | '*', handler: EventHandler): void {
    this.emitter.off(eventType, handler);
  }

  once(eventType: ForgeEvent['type'] | '*', handler: EventHandler): void {
    this.emitter.once(eventType, handler);
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.emitter.removeAllListeners();
    await this.sub.quit().catch(() => {});
    await this.pub.quit().catch(() => {});
  }
}

// ============================================
// Singleton API
// ============================================

export async function initEventBus(redisUrl: string): Promise<ForgeEventBus> {
  if (instance) return instance;
  instance = new ForgeEventBus(redisUrl);
  await instance.connect();
  return instance;
}

export function getEventBus(): ForgeEventBus | null {
  return instance;
}
