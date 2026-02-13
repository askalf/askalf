/**
 * Forge Database Connections
 * - Primary pool: forge database (agents, executions, tools, etc.)
 * - Substrate pool: substrate database (users, sessions, shards, tickets, etc.)
 */

import pg from 'pg';
const { Pool } = pg;

// ============================================
// Forge DB (primary)
// ============================================

let pool: pg.Pool | null = null;

export function initializeDatabase(connectionString: string): void {
  pool = new Pool({
    connectionString,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  pool.on('error', (err) => {
    console.error('[Forge DB] Unexpected error on idle client:', err);
  });
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

export async function closeDatabase(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
  if (substratePool) {
    await substratePool.end();
    substratePool = null;
  }
}

export function getPool(): pg.Pool {
  if (!pool) throw new Error('Database not initialized');
  return pool;
}

// ============================================
// Substrate DB (users, sessions, tickets, etc.)
// ============================================

let substratePool: pg.Pool | null = null;

export function initializeSubstrateDatabase(connectionString: string): void {
  substratePool = new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  substratePool.on('error', (err) => {
    console.error('[Substrate DB] Unexpected error on idle client:', err);
  });
}

export async function substrateQuery<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<T[]> {
  if (!substratePool) throw new Error('Substrate database not initialized');
  const result = await substratePool.query<T>(text, params);
  return result.rows;
}

export async function substrateQueryOne<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<T | null> {
  const rows = await substrateQuery<T>(text, params);
  return rows[0] ?? null;
}

export function getSubstratePool(): pg.Pool {
  if (!substratePool) throw new Error('Substrate database not initialized');
  return substratePool;
}
