#!/usr/bin/env node
/**
 * SUBSTRATE Database Migration Runner
 *
 * Uses postgres-migrations to apply SQL migrations in order.
 * Tracks applied migrations in a 'migrations' table.
 *
 * Usage:
 *   pnpm migrate          # Apply all pending migrations
 *   pnpm migrate:up       # Same as above
 *   pnpm migrate:down     # Not supported by postgres-migrations (manual rollback required)
 *
 * Environment:
 *   DATABASE_URL          # PostgreSQL connection string
 *
 * Or individual variables:
 *   POSTGRES_HOST, POSTGRES_PORT, POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD
 */

import { migrate } from 'postgres-migrations';
import { Client } from 'pg';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface MigrationConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

function getConfig(): MigrationConfig {
  // Support DATABASE_URL format
  const databaseUrl = process.env['DATABASE_URL'];

  if (databaseUrl) {
    const url = new URL(databaseUrl);
    return {
      host: url.hostname,
      port: parseInt(url.port || '5432', 10),
      database: url.pathname.slice(1), // Remove leading /
      user: url.username,
      password: url.password,
    };
  }

  // Fall back to individual env vars
  return {
    host: process.env['POSTGRES_HOST'] || process.env['DB_HOST'] || 'localhost',
    port: parseInt(process.env['POSTGRES_PORT'] || process.env['DB_PORT'] || '5432', 10),
    database: process.env['POSTGRES_DB'] || process.env['DB_NAME'] || 'substrate',
    user: process.env['POSTGRES_USER'] || process.env['DB_USER'] || 'substrate',
    password: process.env['POSTGRES_PASSWORD'] || process.env['DB_PASSWORD'] || '',
  };
}

async function runMigrations(): Promise<void> {
  const config = getConfig();
  const migrationsDir = join(__dirname, 'migrations');

  console.log('============================================');
  console.log('SUBSTRATE Database Migration');
  console.log('============================================');
  console.log(`Host:     ${config.host}:${config.port}`);
  console.log(`Database: ${config.database}`);
  console.log(`User:     ${config.user}`);
  console.log(`Migrations: ${migrationsDir}`);
  console.log('');

  // Create a client for the migration
  const client = new Client({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
  });

  try {
    console.log('Connecting to database...');
    await client.connect();
    console.log('Connected successfully');
    console.log('');

    console.log('Running migrations...');
    const applied = await migrate({ client }, migrationsDir);

    if (applied.length === 0) {
      console.log('No new migrations to apply. Database is up to date.');
    } else {
      console.log(`Applied ${applied.length} migration(s):`);
      for (const migration of applied) {
        console.log(`  ✓ ${migration.name}`);
      }
    }

    console.log('');
    console.log('Migration complete!');

  } catch (error) {
    console.error('');
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

async function showStatus(): Promise<void> {
  const config = getConfig();

  const client = new Client({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
  });

  try {
    await client.connect();

    // Check if migrations table exists
    const tableCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'migrations'
      );
    `);

    if (!tableCheck.rows[0].exists) {
      console.log('No migrations have been applied yet (migrations table does not exist).');
      return;
    }

    // Get applied migrations
    const result = await client.query(`
      SELECT id, name, applied_at
      FROM migrations
      ORDER BY id;
    `);

    console.log('Applied migrations:');
    for (const row of result.rows) {
      const date = new Date(row.applied_at).toISOString();
      console.log(`  ${row.id}. ${row.name} (${date})`);
    }

  } finally {
    await client.end();
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const command = args[0] || 'up';

switch (command) {
  case 'up':
  case 'migrate':
    runMigrations();
    break;
  case 'status':
    showStatus();
    break;
  case 'down':
    console.error('Error: postgres-migrations does not support down migrations.');
    console.error('For rollbacks, create a new migration that reverses the changes.');
    process.exit(1);
    break;
  default:
    console.error(`Unknown command: ${command}`);
    console.error('Usage: migrate [up|status]');
    process.exit(1);
}
