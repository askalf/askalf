/**
 * Self-Hosted Setup — Auto-seeds admin user and session on first boot
 * Only runs when SELFHOSTED=true environment variable is set
 */

import { ulid } from 'ulid';
import { substrateQuery, substrateQueryOne } from '../database.js';
import { initializeLogger } from '@askalf/observability';

const logger = initializeLogger().child({ component: 'selfhosted-setup' });

export function isSelfHosted(): boolean {
  return process.env['SELFHOSTED'] === 'true';
}

export async function runSelfHostedSetup(): Promise<void> {
  if (!isSelfHosted()) return;

  logger.info('[SelfHosted] Running self-hosted setup...');

  const email = process.env['SELFHOSTED_ADMIN_EMAIL'] || 'admin@localhost';
  const password = process.env['SELFHOSTED_ADMIN_PASSWORD'] || '';

  // Check if any users exist
  const existingUser = await substrateQueryOne<{ id: string }>(
    'SELECT id FROM users LIMIT 1',
  ).catch(() => null);

  if (existingUser) {
    logger.info('[SelfHosted] Admin user already exists, skipping seed');
    return;
  }

  if (!password) {
    logger.warn('[SelfHosted] No ADMIN_PASSWORD set in .env — using default password "askalf". Change this!');
  }

  const actualPassword = password || 'askalf';

  // Load bcrypt
  const bcryptMod = await import('bcryptjs');
  const bcrypt = (bcryptMod as unknown as { default?: typeof bcryptMod }).default || bcryptMod;
  const passwordHash = await bcrypt.hash(actualPassword, 12);

  // Create tenant
  const tenantId = `tenant_${ulid()}`;
  await substrateQuery(
    `INSERT INTO tenants (id, name, slug, type, tier, status, created_at, updated_at)
     VALUES ($1, 'Self-Hosted', 'self-hosted', 'user', 'selfhosted', 'active', NOW(), NOW())
     ON CONFLICT DO NOTHING`,
    [tenantId],
  );

  // Create admin user
  const userId = `user_${ulid()}`;
  const emailNormalized = email.toLowerCase().trim();

  await substrateQuery(
    `INSERT INTO users (
      id, tenant_id, email, email_normalized, password_hash,
      email_verified, display_name, timezone, status, role,
      created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, true, 'Admin', 'UTC', 'active', 'super_admin', NOW(), NOW())
    ON CONFLICT DO NOTHING`,
    [userId, tenantId, email, emailNormalized, passwordHash],
  );

  logger.info(`[SelfHosted] Admin user created: ${email}`);
  logger.info('[SelfHosted] Setup complete. Login at http://localhost:3001');
}
