/**
 * Forge Database Connection
 * Single pool for the unified orcastr8r database.
 * Substrate query functions are aliases — kept for backwards compatibility.
 */

import pg from 'pg';
const { Pool } = pg;

let pool: pg.Pool | null = null;

export function initializeDatabase(connectionString: string): void {
  pool = new Pool({
    connectionString,
    max: 40,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 15000,
  });

  pool.on('error', (err) => {
    console.error('[DB] Unexpected error on idle client:', err);
  });

  // Set statement_timeout per-connection (not as startup param — PGBouncer doesn't support it)
  pool.on('connect', (client) => {
    client.query('SET statement_timeout = 30000').catch((err) => {
      console.warn('[DB] Failed to set statement_timeout:', err.message);
    });
  });
}

/** No-op — substrate tables are in the same database now. */
export function initializeSubstrateDatabase(_connectionString: string): void {
  console.log('[DB] initializeSubstrateDatabase is a no-op (merged into orcastr8r)');
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<T[]> {
  if (!pool) throw new Error('Database not initialized');
  const result = await pool.query<T>(text, params);
  return result.rows;
}

export async function queryOne<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

export async function transaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Retries a query up to maxRetries times with exponential backoff.
 * Designed for non-critical fire-and-forget updates (e.g. last_used_at, access_count)
 * that silently lose data on transient DB connection issues.
 *
 * Backoff: 100ms → 200ms → 400ms before each retry.
 * Throws after all attempts are exhausted so the caller can log the final error.
 */
export async function retryQuery<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
  maxRetries = 3,
): Promise<T[]> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await query<T>(text, params);
    } catch (err) {
      lastErr = err;
      if (attempt < maxRetries) {
        await new Promise<void>((resolve) => setTimeout(resolve, 100 * Math.pow(2, attempt)));
      }
    }
  }
  throw lastErr;
}

export async function clientQuery<T extends pg.QueryResultRow = pg.QueryResultRow>(
  client: pg.PoolClient,
  text: string,
  params?: unknown[],
): Promise<T[]> {
  const result = await client.query<T>(text, params);
  return result.rows;
}

export async function closeDatabase(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export function getPool(): pg.Pool {
  if (!pool) throw new Error('Database not initialized');
  return pool;
}

// Aliases — substrate tables are in the same database
export const substrateQuery = query;
export const substrateQueryOne = queryOne;
export const getSubstratePool = getPool;
