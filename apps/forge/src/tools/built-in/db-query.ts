/**
 * Built-in Tool: Database Query
 * Executes read-only SQL queries against the forge database.
 * Write operations are blocked for safety.
 */

import { query } from '../../database.js';
import type { ToolResult } from '../registry.js';

// ============================================
// Types
// ============================================

export interface DbQueryInput {
  sql: string;
  params?: unknown[] | undefined;
}

// ============================================
// Implementation
// ============================================

const MAX_ROWS = 100;

/**
 * Execute a read-only SQL query against the forge database.
 *
 * - Only SELECT, WITH (CTE), and EXPLAIN queries are allowed
 * - Automatically adds LIMIT if not present
 * - Returns up to 100 rows
 */
export async function dbQuery(input: DbQueryInput): Promise<ToolResult> {
  const startTime = performance.now();

  // Only allow read queries — strict validation
  const trimmed = input.sql.trim().toUpperCase();
  if (
    !trimmed.startsWith('SELECT') &&
    !trimmed.startsWith('WITH') &&
    !trimmed.startsWith('EXPLAIN')
  ) {
    return {
      output: null,
      error: 'Only SELECT, WITH (CTE), and EXPLAIN queries are allowed',
      durationMs: Math.round(performance.now() - startTime),
    };
  }

  // Block mutation keywords anywhere in the query (prevents CTE-wrapped writes, multi-statement injection, etc.)
  const BLOCKED_KEYWORDS = [
    'UPDATE', 'INSERT', 'DELETE', 'DROP', 'ALTER', 'TRUNCATE', 'CREATE',
    'GRANT', 'REVOKE', 'COPY', 'EXECUTE', 'CALL', 'DO ',
  ];
  const stripped = trimmed
    .replace(/'[^']*'/g, '')
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  for (const kw of BLOCKED_KEYWORDS) {
    const pattern = new RegExp(`\\b${kw.trim()}\\b`);
    if (pattern.test(stripped)) {
      return {
        output: null,
        error: `Blocked: "${kw.trim()}" is not allowed. This tool is READ-ONLY. Use the appropriate ops tool (ticket_ops, finding_ops, etc.) for mutations.`,
        durationMs: Math.round(performance.now() - startTime),
      };
    }
  }

  // Block multiple statements
  if (stripped.replace(/;[\s]*$/, '').includes(';')) {
    return {
      output: null,
      error: 'Multiple SQL statements are not allowed. Submit one query at a time.',
      durationMs: Math.round(performance.now() - startTime),
    };
  }

  try {
    // Add LIMIT if not present
    let sql = input.sql;
    if (!sql.toUpperCase().includes('LIMIT')) {
      sql = `${sql} LIMIT ${MAX_ROWS}`;
    }

    const rows = await query(sql, input.params ?? []);

    return {
      output: {
        rows,
        rowCount: rows.length,
        truncated: rows.length >= MAX_ROWS,
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
