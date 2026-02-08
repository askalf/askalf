/**
 * SELF Migration Runner
 * Reads SQL files from migrations dir, tracks applied in self_migrations table.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool } from './database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export async function runMigrations(): Promise<void> {
  const pool = getPool();
  const migrationsDir = join(__dirname, 'migrations');

  // Ensure self_migrations table exists
  await pool.query(`
    CREATE TABLE IF NOT EXISTS self_migrations (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Get already-applied migrations
  const { rows: applied } = await pool.query<{ name: string }>(
    'SELECT name FROM self_migrations ORDER BY name',
  );
  const appliedSet = new Set(applied.map(r => r.name));

  // Read migration files
  let files: string[];
  try {
    files = readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();
  } catch {
    console.log('[SELF] No migrations directory found, skipping');
    return;
  }

  for (const file of files) {
    if (appliedSet.has(file)) continue;

    console.log(`[SELF] Applying migration: ${file}`);
    const sql = readFileSync(join(migrationsDir, file), 'utf-8');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        'INSERT INTO self_migrations (name) VALUES ($1)',
        [file],
      );
      await client.query('COMMIT');
      console.log(`[SELF] Migration applied: ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`[SELF] Migration failed: ${file}`, err);
      throw err;
    } finally {
      client.release();
    }
  }
}
