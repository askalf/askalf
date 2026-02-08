/**
 * Built-in Tool: Substrate Database Query
 * Executes read-only SQL queries against the main substrate database.
 * Uses a separate connection pool from the forge database.
 */

import pg from 'pg';
import type { ToolResult } from '../registry.js';

// ============================================
// Types
// ============================================

export interface SubstrateDbQueryInput {
  sql: string;
  params?: unknown[] | undefined;
}

// ============================================
// Connection Pool
// ============================================

let pool: pg.Pool | null = null;

function getPool(): pg.Pool {
  if (!pool) {
    const connectionString = process.env['SUBSTRATE_DATABASE_URL'];
    if (!connectionString) {
      throw new Error('SUBSTRATE_DATABASE_URL not configured');
    }
    pool = new pg.Pool({
      connectionString,
      max: 3, // Small pool since this is a secondary connection
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
  }
  return pool;
}

// ============================================
// Implementation
// ============================================

const MAX_ROWS = 100;

/**
 * Execute a read-only SQL query against the substrate database.
 *
 * - Only SELECT, WITH (CTE), and EXPLAIN queries are allowed
 * - Automatically adds LIMIT if not present
 * - Returns up to 100 rows
 * - Uses a separate pg.Pool from the forge database connection
 */
export async function substrateDbQuery(input: SubstrateDbQueryInput): Promise<ToolResult> {
  const startTime = performance.now();

  // Only allow read queries
  const trimmed = input.sql.trim().toUpperCase();
  if (
    !trimmed.startsWith('SELECT') &&
    !trimmed.startsWith('WITH') &&
    !trimmed.startsWith('EXPLAIN')
  ) {
    return {
      output: null,
      error: 'Only SELECT, WITH (CTE), and EXPLAIN queries are allowed on the substrate database',
      durationMs: Math.round(performance.now() - startTime),
    };
  }

  try {
    const p = getPool();

    // Add LIMIT if not present
    let sql = input.sql;
    if (!sql.toUpperCase().includes('LIMIT')) {
      sql = `${sql} LIMIT ${MAX_ROWS}`;
    }

    const result = await p.query(sql, input.params ?? []);

    return {
      output: {
        rows: result.rows,
        rowCount: result.rows.length,
        truncated: result.rows.length >= MAX_ROWS,
        database: 'substrate',
      },
      durationMs: Math.round(performance.now() - startTime),
    };
  } catch (err) {
    return {
      output: null,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Math.round(performance.now() - startTime),
    };
  }
}

/**
 * Close the substrate database pool. Called during graceful shutdown.
 */
export async function closeSubstratePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
