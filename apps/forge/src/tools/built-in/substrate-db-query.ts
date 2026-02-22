/**
 * Built-in Tool: Substrate Database Query
 * Executes read-only SQL queries against the main substrate database.
 * Uses a separate connection pool from the forge database.
 */

import { getPool as getSharedPool } from '../../database.js';
import type { ToolResult } from '../registry.js';

// ============================================
// Types
// ============================================

export interface SubstrateDbQueryInput {
  sql: string;
  params?: unknown[] | undefined;
}

// ============================================
// Connection Pool (shared forge pool — no separate pool)
// ============================================

function getPool() {
  return getSharedPool();
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
 * Close the substrate database pool.
 * No-op — pool lifecycle is managed by the shared forge pool in database.ts.
 */
export async function closeSubstratePool(): Promise<void> {
  // No-op — shared pool is closed via closeDatabase() in database.ts
}
