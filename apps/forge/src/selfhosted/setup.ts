/**
 * Self-Hosted Setup
 * Auth removed — dashboard uses synthetic admin identity.
 * This module now only handles platform_settings initialization.
 */

import { query } from '../database.js';
import { initializeLogger } from '@askalf/observability';

const logger = initializeLogger().child({ component: 'selfhosted-setup' });

export function isSelfHosted(): boolean {
  return process.env['SELFHOSTED'] === 'true';
}

export async function runSelfHostedSetup(): Promise<void> {
  if (!isSelfHosted()) return;

  logger.info('[SelfHosted] Running self-hosted setup...');

  // Seed onboarding_completed if not set (fresh install shows wizard)
  await query(
    `INSERT INTO platform_settings (key, value) VALUES ('onboarding_completed', 'false')
     ON CONFLICT (key) DO NOTHING`,
  ).catch(() => {});

  logger.info('[SelfHosted] Setup complete');
}
