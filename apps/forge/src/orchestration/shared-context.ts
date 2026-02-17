/**
 * Shared Context Store (Phase 5)
 * Redis-backed shared context for multi-agent coordination.
 * Agents can read/write shared context during coordinated execution.
 *
 * Keys: forge:context:{sessionId}:{key}
 * TTL: 24 hours (matches coordination session lifetime)
 */

import { Redis } from 'ioredis';

const CONTEXT_TTL = 24 * 60 * 60; // 24 hours
const PREFIX = 'forge:context';

let redis: Redis | null = null;

export function initSharedContext(redisClient: Redis): void {
  redis = redisClient;
}

function getRedis(): Redis {
  if (!redis) throw new Error('SharedContext not initialized — call initSharedContext first');
  return redis;
}

/**
 * Set a value in shared context for a coordination session.
 */
export async function setContext(
  sessionId: string,
  key: string,
  value: unknown,
): Promise<void> {
  const r = getRedis();
  const fullKey = `${PREFIX}:${sessionId}:${key}`;
  await r.setex(fullKey, CONTEXT_TTL, JSON.stringify(value));
}

/**
 * Get a value from shared context.
 */
export async function getContext<T = unknown>(
  sessionId: string,
  key: string,
): Promise<T | null> {
  const r = getRedis();
  const fullKey = `${PREFIX}:${sessionId}:${key}`;
  const raw = await r.get(fullKey);
  if (!raw) return null;
  return JSON.parse(raw) as T;
}

/**
 * Append a value to a shared context list (for accumulating results).
 */
export async function appendContext(
  sessionId: string,
  key: string,
  value: unknown,
): Promise<number> {
  const r = getRedis();
  const fullKey = `${PREFIX}:${sessionId}:${key}`;
  const length = await r.rpush(fullKey, JSON.stringify(value));
  await r.expire(fullKey, CONTEXT_TTL);
  return length;
}

/**
 * Get all values from a shared context list.
 */
export async function getContextList<T = unknown>(
  sessionId: string,
  key: string,
): Promise<T[]> {
  const r = getRedis();
  const fullKey = `${PREFIX}:${sessionId}:${key}`;
  const items = await r.lrange(fullKey, 0, -1);
  return items.map((raw) => JSON.parse(raw) as T);
}

/**
 * Get all keys in a session's shared context.
 */
export async function listContextKeys(sessionId: string): Promise<string[]> {
  const r = getRedis();
  const pattern = `${PREFIX}:${sessionId}:*`;
  const keys = await r.keys(pattern);
  const prefixLen = `${PREFIX}:${sessionId}:`.length;
  return keys.map((k) => k.substring(prefixLen));
}

/**
 * Delete a specific key from shared context.
 */
export async function deleteContext(sessionId: string, key: string): Promise<void> {
  const r = getRedis();
  await r.del(`${PREFIX}:${sessionId}:${key}`);
}

/**
 * Delete all shared context for a session.
 */
export async function clearSessionContext(sessionId: string): Promise<number> {
  const r = getRedis();
  const pattern = `${PREFIX}:${sessionId}:*`;
  const keys = await r.keys(pattern);
  if (keys.length === 0) return 0;
  return r.del(...keys);
}

/**
 * Handoff context: Package one agent's working context for another agent.
 * Stores the handoff in shared context and returns the handoff ID.
 */
export async function createHandoff(
  sessionId: string,
  fromAgentId: string,
  toAgentId: string,
  context: {
    task: string;
    progress: string;
    artifacts?: string[];
    notes?: string;
  },
): Promise<string> {
  const handoffId = `handoff:${Date.now()}`;
  await setContext(sessionId, handoffId, {
    fromAgentId,
    toAgentId,
    ...context,
    createdAt: new Date().toISOString(),
  });
  return handoffId;
}

/**
 * Retrieve a handoff context.
 */
export async function getHandoff(
  sessionId: string,
  handoffId: string,
): Promise<{
  fromAgentId: string;
  toAgentId: string;
  task: string;
  progress: string;
  artifacts?: string[];
  notes?: string;
  createdAt: string;
} | null> {
  return getContext(sessionId, handoffId);
}
