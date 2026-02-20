/**
 * Ask Alf Database Connections
 * - Primary pool: askalf database (conversations, messages, credentials, preferences)
 * - Substrate pool: substrate database (users, sessions — for auth)
 */

import pg from 'pg';
const { Pool } = pg;

// ============================================
// AskAlf DB (primary)
// ============================================

let askalfPool: pg.Pool | null = null;

export function initializeAskalfDatabase(connectionString: string): void {
  askalfPool = new Pool({
    connectionString,
    max: 15,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  askalfPool.on('error', (err) => {
    console.error('[AskAlf DB] Unexpected error on idle client:', err);
  });
}

export async function askalfQuery<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<T[]> {
  if (!askalfPool) throw new Error('AskAlf database not initialized');
  const result = await askalfPool.query<T>(text, params);
  return result.rows;
}

export async function askalfQueryOne<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<T | null> {
  const rows = await askalfQuery<T>(text, params);
  return rows[0] ?? null;
}

// ============================================
// Substrate DB (users, sessions — for auth)
// ============================================

let substratePool: pg.Pool | null = null;

export function initializeSubstrateDatabase(connectionString: string): void {
  substratePool = new Pool({
    connectionString,
    max: 5,
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

// ============================================
// Cleanup
// ============================================

export async function closeDatabase(): Promise<void> {
  if (askalfPool) {
    await askalfPool.end();
    askalfPool = null;
  }
  if (substratePool) {
    await substratePool.end();
    substratePool = null;
  }
}
