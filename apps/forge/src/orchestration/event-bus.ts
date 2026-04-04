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
import type { IRedisAdapter } from '@askalf/redis-adapter';

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
  private pub: Redis | IRedisAdapter;
  private sub: Redis | IRedisAdapter;
  private emitter: EventEmitter;
  private closed = false;

  constructor(redisUrl: string);
  constructor(pubAdapter: IRedisAdapter, subAdapter: IRedisAdapter);
  constructor(urlOrAdapter: string | IRedisAdapter, subAdapter?: IRedisAdapter) {
    if (typeof urlOrAdapter === 'string') {
      this.pub = new Redis(urlOrAdapter, { maxRetriesPerRequest: null, lazyConnect: true });
      this.sub = new Redis(urlOrAdapter, { maxRetriesPerRequest: null, lazyConnect: true });
    } else {
      this.pub = urlOrAdapter;
      this.sub = subAdapter ?? urlOrAdapter.duplicate();
    }
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(100);
  }

  async connect(): Promise<void> {
    if (this.pub instanceof Redis) {
      await Promise.all([(this.pub as Redis).connect(), (this.sub as Redis).connect()]);
    }

    // Subscribe to all forge event channels using pattern
    await this.sub.psubscribe(CHANNELS.all);

    this.sub.on('pmessage', (_pattern: string, channel: string, raw: string) => {
      try {
        const event = JSON.parse(raw) as ForgeEvent;
        this.emitter.emit(event.type, event);
        this.emitter.emit('*', event);
      } catch {
        // Ignore malformed messages
      }
    });

    console.log('[EventBus] Connected, listening on forge:events:*');
  }

  // -----------------------------------------------------------------------
  // Publish
  // -----------------------------------------------------------------------

  async emit(event: ForgeEvent): Promise<void> {
    if (this.closed) return;

    const channel = `forge:events:${event.type}`;

    // Publish to Redis — the psubscribe handler will emit locally when it arrives back
    await this.pub.publish(channel, JSON.stringify(event)).catch((e) => { if (e) console.debug("[catch]", String(e)); });
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
    await this.sub.quit().catch((e) => { if (e) console.debug("[catch]", String(e)); });
    await this.pub.quit().catch((e) => { if (e) console.debug("[catch]", String(e)); });
  }
}

// ============================================
// Singleton API
// ============================================

export async function initEventBus(redisUrl: string): Promise<ForgeEventBus>;
export async function initEventBus(adapter: IRedisAdapter): Promise<ForgeEventBus>;
export async function initEventBus(urlOrAdapter: string | IRedisAdapter): Promise<ForgeEventBus> {
  if (instance) return instance;

  if (typeof urlOrAdapter === 'string') {
    instance = new ForgeEventBus(urlOrAdapter);
    await instance.connect();
    cacheClient = new Redis(urlOrAdapter, { maxRetriesPerRequest: null, lazyConnect: true });
    await cacheClient.connect();
  } else {
    const sub = urlOrAdapter.duplicate();
    instance = new ForgeEventBus(urlOrAdapter, sub);
    await instance.connect();
    cacheAdapter = urlOrAdapter;
  }

  console.log('[Cache] Query cache initialized');
  return instance;
}

export function getEventBus(): ForgeEventBus | null {
  return instance;
}

// ============================================
// Redis Query Cache
// ============================================

let cacheClient: Redis | null = null;
let cacheAdapter: IRedisAdapter | null = null;

/**
 * Get a value from cache or compute it. Results cached with TTL.
 */
export async function getCached<T>(key: string, ttlSeconds: number, fetchFn: () => Promise<T>): Promise<T> {
  const client = cacheClient || cacheAdapter;
  if (!client) return fetchFn();

  const cacheKey = `forge:cache:${key}`;
  try {
    const cached = await client.get(cacheKey);
    if (cached) return JSON.parse(cached) as T;
  } catch { /* cache miss, compute fresh */ }

  const result = await fetchFn();

  try {
    await client.setex(cacheKey, ttlSeconds, JSON.stringify(result));
  } catch { /* cache write failed, not fatal */ }

  return result;
}

/** Invalidate a specific cache key */
export async function invalidateCache(key: string): Promise<void> {
  const client = cacheClient || cacheAdapter;
  if (!client) return;
  try { await client.del(`forge:cache:${key}`); } catch { /* ignore */ }
}
