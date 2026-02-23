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
    statement_timeout: 30000, // 30s — prevent runaway queries from starving the pool
  });

  pool.on('error', (err) => {
    console.error('[DB] Unexpected error on idle client:', err);
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
