/**
 * Shared Database Connection Pools
 *
 * Provides lazy-initialized connection pools for the forge and substrate
 * databases, plus Redis. Used by all MCP servers to avoid duplicating
 * connection pool setup in every tool implementation.
 */

import pg from 'pg';
import { Redis } from 'ioredis';

const { Pool } = pg;

// ============================================
// Forge Database Pool
// ============================================

let forgePool: pg.Pool | null = null;

export function getForgePool(): pg.Pool {
  if (!forgePool) {
    const connectionString = process.env['FORGE_DATABASE_URL'];
    if (!connectionString) {
      throw new Error('FORGE_DATABASE_URL not configured');
    }
    forgePool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    forgePool.on('error', (err) => {
      console.error('[shared-pools] Forge pool error:', err.message);
    });
  }
  return forgePool;
}

export async function forgeQuery<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  const result = await getForgePool().query<T>(text, params);
  return result.rows;
}

export async function forgeQueryOne<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<T | null> {
  const rows = await forgeQuery<T>(text, params);
  return rows[0] ?? null;
}

// ============================================
// Substrate Database Pool
// ============================================

let substratePool: pg.Pool | null = null;

export function getSubstratePool(): pg.Pool {
  if (!substratePool) {
    const connectionString = process.env['SUBSTRATE_DATABASE_URL'];
    if (!connectionString) {
      throw new Error('SUBSTRATE_DATABASE_URL not configured');
    }
    substratePool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    substratePool.on('error', (err) => {
      console.error('[shared-pools] Substrate pool error:', err.message);
    });
  }
  return substratePool;
}

export async function substrateQuery<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  const result = await getSubstratePool().query<T>(text, params);
  return result.rows;
}

export async function substrateQueryOne<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<T | null> {
  const rows = await substrateQuery<T>(text, params);
  return rows[0] ?? null;
}

// ============================================
// Redis Connection
// ============================================

let redis: Redis | null = null;

export function getRedis(): Redis {
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
  pool: pg.Pool,
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
    await pool.query(
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
  if (forgePool) {
    promises.push(forgePool.end().then(() => { forgePool = null; }));
  }
  if (substratePool) {
    promises.push(substratePool.end().then(() => { substratePool = null; }));
  }
  if (redis) {
    promises.push(redis.quit().then(() => { redis = null; }));
  }
  await Promise.all(promises);
}
