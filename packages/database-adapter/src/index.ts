/**
 * @askalf/database-adapter
 *
 * Dual-mode database adapter for AskAlf.
 * - pg mode: connects to a real PostgreSQL server (Docker/production)
 * - pglite mode: runs PostgreSQL in-process via WASM (standalone/desktop)
 *
 * Usage:
 *   const db = await createAdapter({ mode: 'pglite', dataDir: '~/.askalf/data' });
 *   const rows = await db.query('SELECT * FROM agents WHERE active = $1', [true]);
 */

export type { DatabaseAdapter, QueryResultRow, TransactionClient } from './interface.js';
export { PgAdapter } from './pg-adapter.js';
export { PGliteAdapter } from './pglite-adapter.js';

import { PgAdapter } from './pg-adapter.js';
import { PGliteAdapter } from './pglite-adapter.js';
import type { DatabaseAdapter } from './interface.js';

export type AdapterConfig =
  | { mode: 'pg'; connectionString: string; max?: number }
  | { mode: 'pglite'; dataDir: string };

/**
 * Create a database adapter based on the runtime mode.
 * In standalone mode, PGlite runs PostgreSQL in-process — no server needed.
 * In Docker mode, connects to a real PostgreSQL server.
 */
export async function createAdapter(config: AdapterConfig): Promise<DatabaseAdapter> {
  if (config.mode === 'pglite') {
    const adapter = new PGliteAdapter(config.dataDir);
    await adapter.init();
    return adapter;
  }

  return new PgAdapter(config.connectionString, { max: config.max });
}

/**
 * Auto-detect mode from environment.
 * ASKALF_MODE=standalone → PGlite
 * Everything else → pg (requires DATABASE_URL)
 */
export async function createAdapterFromEnv(): Promise<DatabaseAdapter> {
  const mode = process.env['ASKALF_MODE'];

  if (mode === 'standalone') {
    const dataDir = process.env['ASKALF_DATA_DIR']
      || (process.platform === 'win32'
        ? `${process.env['APPDATA']}/askalf/data`
        : `${process.env['HOME']}/.askalf/data`);

    return createAdapter({ mode: 'pglite', dataDir });
  }

  const connectionString = process.env['DATABASE_URL']
    || process.env['FORGE_DATABASE_URL'];

  if (!connectionString) {
    throw new Error('DATABASE_URL is required in Docker mode');
  }

  return createAdapter({ mode: 'pg', connectionString });
}
