/**
 * PostgreSQL Adapter — wraps pg.Pool
 * Used in Docker/production mode. This is the existing behavior.
 */

import pg from 'pg';
import type { DatabaseAdapter, QueryResultRow, TransactionClient } from './interface.js';

const { Pool } = pg;

export class PgAdapter implements DatabaseAdapter {
  readonly mode = 'pg' as const;
  private pool: pg.Pool;

  constructor(connectionString: string, opts?: { max?: number }) {
    this.pool = new Pool({
      connectionString,
      max: opts?.max ?? 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 15_000,
    });

    this.pool.on('error', (err) => {
      console.error('[PgAdapter] Unexpected error on idle client:', err);
    });

    this.pool.on('connect', (client) => {
      client.query('SET statement_timeout = 30000').catch((err: Error) => {
        console.warn('[PgAdapter] Failed to set statement_timeout:', err.message);
      });
    });
  }

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<T[]> {
    const result = await this.pool.query<T>(text, params);
    return result.rows;
  }

  async queryOne<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<T | null> {
    const rows = await this.query<T>(text, params);
    return rows[0] ?? null;
  }

  async transaction<T>(
    fn: (client: TransactionClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
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

  /** Get the raw pg.Pool for code that needs it directly. */
  getPool(): pg.Pool {
    return this.pool;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
