import { Pool, PoolClient, PoolConfig } from 'pg';
import type { DatabaseAdapter, TransactionClient } from '@askalf/database-adapter';

let pool: Pool | null = null;
let adapter: DatabaseAdapter | null = null;

export interface DatabaseConfig {
  connectionString?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
}

/**
 * Initialize the database connection pool (Docker mode)
 */
export function initializePool(config: DatabaseConfig): Pool {
  if (pool) {
    return pool;
  }

  const poolConfig: PoolConfig = {
    connectionString: config.connectionString,
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    max: config.max ?? 20,
    idleTimeoutMillis: config.idleTimeoutMillis ?? 30000,
    connectionTimeoutMillis: config.connectionTimeoutMillis ?? 5000,
  };

  pool = new Pool(poolConfig);

  pool.on('error', (err) => {
    console.error('Unexpected error on idle client', err);
  });

  return pool;
}

/**
 * Initialize with a pre-created adapter (standalone mode).
 */
export function initializeWithAdapter(dbAdapter: DatabaseAdapter): void {
  adapter = dbAdapter;
  pool = null;
}

/**
 * Inject an existing Pool (for environments that already manage connections).
 */
export function setPool(externalPool: Pool): void {
  pool = externalPool;
}

/**
 * Get the database pool (throws if not initialized or in standalone mode)
 */
export function getPool(): Pool {
  if (!pool) {
    throw new Error('Database pool not initialized. Call initializePool first.');
  }
  return pool;
}

/**
 * Close the database pool
 */
export async function closePool(): Promise<void> {
  if (adapter) {
    await adapter.close();
    adapter = null;
    return;
  }
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/**
 * Execute a query with automatic connection handling
 */
export async function query<T = unknown>(
  text: string,
  params?: unknown[]
): Promise<T[]> {
  if (adapter) return adapter.query<T & Record<string, unknown>>(text, params) as Promise<T[]>;
  const client = await getPool().connect();
  try {
    const result = await client.query(text, params);
    return result.rows as T[];
  } finally {
    client.release();
  }
}

/**
 * Execute a query and return a single row
 */
export async function queryOne<T = unknown>(
  text: string,
  params?: unknown[]
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

/**
 * Execute a transaction with proper type safety
 */
export async function transaction<T>(
  fn: (client: PoolClient | TransactionClient) => Promise<T>
): Promise<T> {
  if (adapter) return adapter.transaction(fn);

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Re-export PoolClient and Pool types for consumers
export type { PoolClient, Pool };
