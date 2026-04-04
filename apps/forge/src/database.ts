/**
 * Forge Database Connection
 *
 * Dual-mode: connects to PostgreSQL (Docker) or PGlite (standalone).
 * The exported query/queryOne/transaction API is identical in both modes —
 * callers don't need to know which backend is active.
 *
 * Substrate query functions are aliases — kept for backwards compatibility.
 */

import pg from 'pg';
import type { DatabaseAdapter, TransactionClient } from '@askalf/database-adapter';
import { PgAdapter } from '@askalf/database-adapter';

const { Pool } = pg;

let pool: pg.Pool | null = null;
let adapter: DatabaseAdapter | null = null;

/**
 * Initialize with a PostgreSQL connection string (Docker mode).
 */
export function initializeDatabase(connectionString: string): void {
  const pgAdapter = new PgAdapter(connectionString);
  pool = pgAdapter.getPool();
  adapter = pgAdapter;
}

/**
 * Initialize with a pre-created adapter (standalone mode).
 * Call this instead of initializeDatabase() when using PGlite.
 */
export function initializeDatabaseWithAdapter(dbAdapter: DatabaseAdapter): void {
  adapter = dbAdapter;
  // In PGlite mode there's no pg.Pool, so pool stays null.
  // Code that calls getPool() directly will need to use the adapter path instead.
  pool = null;
}

/** No-op — askalf tables are in the same database now. */

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<T[]> {
  if (adapter) return adapter.query<T>(text, params);
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
  if (adapter) {
    return adapter.transaction(fn as (client: TransactionClient) => Promise<T>);
  }

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
  if (adapter) {
    await adapter.close();
    adapter = null;
    pool = null;
    return;
  }
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export function getPool(): pg.Pool {
  if (!pool) throw new Error('Database not initialized (or running in standalone mode — use query() instead of getPool())');
  return pool;
}

/** Get the active adapter (works in both modes). */
export function getAdapter(): DatabaseAdapter | null {
  return adapter;
}

/** Check if running in standalone/PGlite mode. */
export function isStandaloneMode(): boolean {
  return adapter?.mode === 'pglite';
}


/**
 * Run forge SQL migrations from apps/forge/migrations/ in order.
 * Uses a tracking table (forge_migrations) to skip already-applied files.
 * Safe to call on every startup — idempotent.
 *
 * Works with both pg.Pool (Docker) and PGlite (standalone).
 */
export async function runForgeMigrations(migrationsDir: string): Promise<void> {
  const { readdir, readFile } = await import('fs/promises');
  const { join } = await import('path');

  // In standalone mode, use the adapter directly (no pool.connect())
  if (adapter && !pool) {
    const readFileStr = (p: string, enc: string) => readFile(p, enc as BufferEncoding) as Promise<string>;
    await runMigrationsViaAdapter(adapter, migrationsDir, readdir as (p: string) => Promise<string[]>, readFileStr, join);
    return;
  }

  const client = await getPool().connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS forge_migrations (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      ALTER TABLE IF EXISTS forge_agents DROP CONSTRAINT IF EXISTS forge_agents_model_id_fkey
    `).catch(() => {});

    const applied = await client.query<{ name: string }>('SELECT name FROM forge_migrations ORDER BY name');
    const appliedSet = new Set(applied.rows.map(r => r.name));

    let files: string[];
    try {
      files = (await readdir(migrationsDir)).filter(f => f.endsWith('.sql')).sort();
    } catch {
      console.warn('[DB] No migrations directory found at', migrationsDir);
      return;
    }

    let count = 0;
    for (const file of files) {
      if (appliedSet.has(file)) continue;

      const sql = await readFile(join(migrationsDir, file), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO forge_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        count++;
        console.log(`[DB] Migration applied: ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        const msg = err instanceof Error ? err.message : String(err);
        const skippable = /relation "(users|sessions|tenants)" does not exist|violates foreign key/i;
        if (skippable.test(msg)) {
          await client.query('INSERT INTO forge_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING', [file]);
          console.warn(`[DB] Migration skipped (auth dependency): ${file}`);
        } else {
          console.error(`[DB] Migration failed: ${file} — ${msg}`);
          throw err;
        }
      }
    }

    if (count === 0) {
      console.log(`[DB] All ${files.length} migrations already applied`);
    } else {
      console.log(`[DB] Applied ${count} new migration(s)`);
    }
  } finally {
    client.release();
  }
}

/**
 * Run migrations using the adapter interface (for PGlite standalone mode).
 */
async function runMigrationsViaAdapter(
  db: DatabaseAdapter,
  migrationsDir: string,
  readdir: (path: string) => Promise<string[]>,
  readFile: (path: string, encoding: string) => Promise<string>,
  join: (...paths: string[]) => string,
): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS forge_migrations (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.query(`
    ALTER TABLE IF EXISTS forge_agents DROP CONSTRAINT IF EXISTS forge_agents_model_id_fkey
  `).catch(() => {});

  const applied = await db.query<{ name: string }>('SELECT name FROM forge_migrations ORDER BY name');
  const appliedSet = new Set(applied.map(r => r.name));

  let files: string[];
  try {
    files = (await readdir(migrationsDir)).filter(f => f.endsWith('.sql')).sort();
  } catch {
    console.warn('[DB] No migrations directory found at', migrationsDir);
    return;
  }

  let count = 0;
  for (const file of files) {
    if (appliedSet.has(file)) continue;

    const sql = await readFile(join(migrationsDir, file), 'utf8');
    try {
      await db.transaction(async (client) => {
        await client.query(sql);
        await client.query('INSERT INTO forge_migrations (name) VALUES ($1)', [file]);
      });
      count++;
      console.log(`[DB] Migration applied: ${file}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const skippable = /relation "(users|sessions|tenants)" does not exist|violates foreign key/i;
      if (skippable.test(msg)) {
        await db.query('INSERT INTO forge_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING', [file]);
        console.warn(`[DB] Migration skipped (auth dependency): ${file}`);
      } else {
        console.error(`[DB] Migration failed: ${file} — ${msg}`);
        throw err;
      }
    }
  }

  if (count === 0) {
    console.log(`[DB] All ${files.length} migrations already applied`);
  } else {
    console.log(`[DB] Applied ${count} new migration(s)`);
  }
}
