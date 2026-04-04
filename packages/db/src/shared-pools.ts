/**
 * Shared Database Connection Pool
 *
 * Dual-mode: PostgreSQL + Redis (Docker) or PGlite + in-memory (standalone).
 * Used by MCP servers and other services.
 * Forge/askalf query functions are aliases for backwards compatibility.
 */

import pg from 'pg';
import { Redis } from 'ioredis';
import type { DatabaseAdapter } from '@askalf/database-adapter';
import type { IRedisAdapter } from '@askalf/redis-adapter';

const { Pool } = pg;

// ============================================
// Unified Database Pool
// ============================================

let pool: pg.Pool | null = null;
let dbAdapter: DatabaseAdapter | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    const connectionString = process.env['DATABASE_URL']
      || process.env['FORGE_DATABASE_URL'];
    if (!connectionString) {
      throw new Error('DATABASE_URL (or FORGE_DATABASE_URL) not configured');
    }
    pool = new Pool({
      connectionString,
      max: 15,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    pool.on('error', (err) => {
      console.error('[shared-pools] Pool error:', err.message);
    });
  }
  return pool;
}

/** Inject an adapter for standalone mode. */
export function setDatabaseAdapter(adapter: DatabaseAdapter): void {
  dbAdapter = adapter;
}

/** Inject a Redis adapter for standalone mode. */
let redisAdapter: IRedisAdapter | null = null;
export function setRedisAdapter(adapter: IRedisAdapter): void {
  redisAdapter = adapter;
}

async function dbQuery<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  if (dbAdapter) return dbAdapter.query<T>(text, params);
  const result = await getPool().query<T>(text, params);
  return result.rows;
}

async function dbQueryOne<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<T | null> {
  const rows = await dbQuery<T>(text, params);
  return rows[0] ?? null;
}

// All aliases point to the same pool
export const getForgePool = getPool;
export const forgeQuery = dbQuery;
export const forgeQueryOne = dbQueryOne;
export const query = dbQuery;
export const queryOne = dbQueryOne;

// ============================================
// Redis Connection
// ============================================

let redis: Redis | null = null;

export function getRedisAdapter(): IRedisAdapter | null {
  return redisAdapter;
}

export function getRedis(): Redis {
  if (redisAdapter) return redisAdapter as unknown as Redis;
  if (!redis) {
    const url = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
    redis = new Redis(url, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => Math.min(times * 100, 3000),
      lazyConnect: true,
    });
    redis.on('error', (err) => {
      console.error('[shared-pools] Redis error:', err.message);
    });
  }
  return redis;
}

// ============================================
// Helpers
// ============================================

/** Generate a unique ID (timestamp + random, uppercase). */
export function generateId(): string {
  const timestamp = Date.now().toString(36).padStart(10, '0');
  const bytes = new Uint8Array(10);
  globalThis.crypto.getRandomValues(bytes);
  const random = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
  return (timestamp + random).toUpperCase();
}

/** Record an audit log entry. Non-fatal on failure. */
export async function audit(
  _pool: pg.Pool,
  entityType: string,
  entityId: string,
  action: string,
  actor: string,
  actorId: string | null,
  oldValue: Record<string, unknown>,
  newValue: Record<string, unknown>,
  executionId?: string | null,
): Promise<void> {
  try {
    await dbQuery(
      `INSERT INTO agent_audit_log (entity_type, entity_id, action, actor, actor_id, old_value, new_value, execution_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [entityType, entityId, action, actor, actorId ?? null, JSON.stringify(oldValue), JSON.stringify(newValue), executionId ?? null],
    );
  } catch {
    // Audit failure is non-fatal — never block operations
  }
}

// ============================================
// Shutdown
// ============================================

export async function closeAll(): Promise<void> {
  const promises: Promise<void>[] = [];
  if (dbAdapter) {
    promises.push(dbAdapter.close().then(() => { dbAdapter = null; }));
  }
  if (pool) {
    promises.push(pool.end().then(() => { pool = null; }));
  }
  if (redisAdapter) {
    promises.push(redisAdapter.quit().then(() => { redisAdapter = null; }));
  }
  if (redis) {
    promises.push(redis.quit().then(() => { redis = null; }));
  }
  await Promise.all(promises);
}
