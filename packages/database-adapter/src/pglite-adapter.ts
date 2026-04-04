/**
 * PGlite Adapter — in-process PostgreSQL via WASM
 * Used in standalone mode. No external database server needed.
 *
 * PGlite speaks real PostgreSQL dialect — $1 params, JSONB, ON CONFLICT,
 * RETURNING, TIMESTAMPTZ, triggers, functions, and pgvector all work.
 * This means zero SQL rewrites across the entire codebase.
 */

import type { DatabaseAdapter, QueryResultRow, TransactionClient } from './interface.js';

// PGlite is an optional dependency — only loaded in standalone mode
let PGliteClass: any;
let vectorExtension: any;

async function loadPGlite() {
  if (!PGliteClass) {
    try {
      const mod = await import('@electric-sql/pglite');
      PGliteClass = mod.PGlite;
    } catch {
      throw new Error(
        'PGlite is required for standalone mode. Install it with: pnpm add @electric-sql/pglite'
      );
    }
    try {
      const vecMod = await import('@electric-sql/pglite/vector');
      vectorExtension = vecMod.vector;
    } catch {
      console.warn('[PGlite] pgvector extension not available — semantic search will be disabled');
    }
  }
}

export class PGliteAdapter implements DatabaseAdapter {
  readonly mode = 'pglite' as const;
  private db: any = null;
  private dataDir: string;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
  }

  async init(): Promise<void> {
    await loadPGlite();

    const extensions: Record<string, any> = {};
    if (vectorExtension) {
      extensions.vector = vectorExtension;
    }

    this.db = new PGliteClass({
      dataDir: this.dataDir,
      extensions,
    });

    await this.db.waitReady;

    // Enable pgvector if available
    if (vectorExtension) {
      await this.db.query('CREATE EXTENSION IF NOT EXISTS vector').catch(() => {});
    }

    // Enable uuid-ossp
    await this.db.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"').catch(() => {});

    console.log(`[PGlite] Database initialized at ${this.dataDir}`);
  }

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<T[]> {
    if (!this.db) throw new Error('PGlite not initialized. Call init() first.');
    const result = await this.db.query(text, params);
    return (result.rows ?? []) as T[];
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
    if (!this.db) throw new Error('PGlite not initialized. Call init() first.');

    // PGlite transactions use the same connection (single-process)
    const client: TransactionClient = {
      query: async <R extends QueryResultRow = QueryResultRow>(
        text: string,
        params?: unknown[],
      ) => {
        const result = await this.db.query(text, params);
        return { rows: (result.rows ?? []) as R[] };
      },
    };

    await this.db.query('BEGIN');
    try {
      const result = await fn(client);
      await this.db.query('COMMIT');
      return result;
    } catch (err) {
      await this.db.query('ROLLBACK');
      throw err;
    }
  }

  async close(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = null;
    }
  }
}
