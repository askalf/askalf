/**
 * Self Database Connections
 * - Primary pool: self database (conversations, connections, credentials, preferences)
 * - Substrate pool: substrate database (users, sessions — for auth)
 */

import pg from 'pg';
const { Pool } = pg;

// ============================================
// Self DB (primary)
// ============================================

let selfPool: pg.Pool | null = null;

export function initializeSelfDatabase(connectionString: string): void {
  selfPool = new Pool({
    connectionString,
    max: 15,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  selfPool.on('error', (err) => {
    console.error('[Self DB] Unexpected error on idle client:', err);
  });
}

export async function selfQuery<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<T[]> {
  if (!selfPool) throw new Error('Self database not initialized');
  const result = await selfPool.query<T>(text, params);
  return result.rows;
}

export async function selfQueryOne<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<T | null> {
  const rows = await selfQuery<T>(text, params);
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
  if (selfPool) {
    await selfPool.end();
    selfPool = null;
  }
  if (substratePool) {
    await substratePool.end();
    substratePool = null;
  }
}
