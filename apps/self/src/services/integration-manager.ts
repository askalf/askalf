/**
 * Integration Manager
 * Manages MCP client lifecycle for connected services.
 * Phase 1: CRUD operations only. Full MCP polling comes in Phase 2.
 */

import { ulid } from 'ulid';
import { query, queryOne } from '../database.js';
import { INTEGRATION_CATALOG, type IntegrationCatalogEntry } from '@substrate/self-core';

interface IntegrationRow {
  id: string;
  self_id: string;
  user_id: string;
  provider: string;
  display_name: string;
  icon_url: string | null;
  status: string;
  auth_type: string;
  poll_interval_ms: number | null;
  last_sync: string | null;
  allowed_actions: string[];
  blocked_actions: string[];
  created_at: string;
  updated_at: string;
}

/**
 * Get available integrations catalog
 */
export function getAvailableIntegrations(): IntegrationCatalogEntry[] {
  return INTEGRATION_CATALOG;
}

/**
 * List connected integrations for a SELF instance
 */
export async function listIntegrations(selfId: string): Promise<IntegrationRow[]> {
  return query<IntegrationRow>(
    `SELECT id, self_id, user_id, provider, display_name, icon_url,
            status, auth_type, poll_interval_ms, last_sync,
            allowed_actions, blocked_actions, created_at, updated_at
     FROM self_integrations
     WHERE self_id = $1
     ORDER BY created_at DESC`,
    [selfId],
  );
}

/**
 * Initiate a new integration connection.
 * Returns the integration ID. OAuth flow handled separately.
 */
export async function connectIntegration(params: {
  selfId: string;
  userId: string;
  provider: string;
}): Promise<{ integrationId: string; oauthUrl?: string }> {
  const { selfId, userId, provider } = params;

  // Validate provider exists in catalog
  const catalog = INTEGRATION_CATALOG.find(c => c.provider === provider);
  if (!catalog) {
    throw new Error(`Unknown integration provider: ${provider}`);
  }

  if (!catalog.available) {
    throw new Error(`Integration '${provider}' is not yet available. Coming in Phase 2.`);
  }

  const integrationId = ulid();

  await query(
    `INSERT INTO self_integrations
     (id, self_id, user_id, provider, display_name, auth_type, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending')`,
    [integrationId, selfId, userId, provider, catalog.display_name, catalog.auth_type],
  );

  // TODO Phase 2: Generate OAuth URL for oauth2 providers
  return { integrationId };
}

/**
 * Disconnect an integration
 */
export async function disconnectIntegration(integrationId: string, selfId: string): Promise<boolean> {
  const result = await query<{ id: string }>(
    `UPDATE self_integrations
     SET status = 'disconnected', credentials = '{}', updated_at = NOW()
     WHERE id = $1 AND self_id = $2
     RETURNING id`,
    [integrationId, selfId],
  );
  return result.length > 0;
}

/**
 * Update integration permissions
 */
export async function updateIntegrationPermissions(
  integrationId: string,
  selfId: string,
  allowedActions?: string[],
  blockedActions?: string[],
): Promise<boolean> {
  const updates: string[] = ['updated_at = NOW()'];
  const values: unknown[] = [];
  let paramIdx = 1;

  if (allowedActions !== undefined) {
    updates.push(`allowed_actions = $${paramIdx}`);
    values.push(allowedActions);
    paramIdx++;
  }

  if (blockedActions !== undefined) {
    updates.push(`blocked_actions = $${paramIdx}`);
    values.push(blockedActions);
    paramIdx++;
  }

  values.push(integrationId, selfId);

  const result = await query<{ id: string }>(
    `UPDATE self_integrations
     SET ${updates.join(', ')}
     WHERE id = $${paramIdx} AND self_id = $${paramIdx + 1}
     RETURNING id`,
    values,
  );

  return result.length > 0;
}
