// SUBSTRATE v1: API Key Management
// API key creation, validation, and revocation

import { ulid } from 'ulid';
import { query, queryOne } from '@substrate/database';
import { generateApiKey, hashToken, verifyTokenHash } from './password.js';
import type { ApiKey, SafeApiKey, ApiKeyScope } from './types.js';

/**
 * Convert a database row to an ApiKey object
 */
function rowToApiKey(row: Record<string, unknown>): ApiKey {
  return {
    id: row['id'] as string,
    tenant_id: row['tenant_id'] as string,
    user_id: row['user_id'] as string | null,
    key_prefix: row['key_prefix'] as string,
    key_hash: row['key_hash'] as string,
    name: row['name'] as string,
    description: row['description'] as string | null,
    scopes: row['scopes'] as ApiKeyScope[],
    last_used_at: row['last_used_at']
      ? new Date(row['last_used_at'] as string)
      : null,
    usage_count: (row['usage_count'] as number) ?? 0,
    status: row['status'] as ApiKey['status'],
    expires_at: row['expires_at'] ? new Date(row['expires_at'] as string) : null,
    revoked_at: row['revoked_at'] ? new Date(row['revoked_at'] as string) : null,
    created_at: new Date(row['created_at'] as string),
  };
}

/**
 * Convert an ApiKey to a SafeApiKey (without hash)
 */
export function toSafeApiKey(apiKey: ApiKey): SafeApiKey {
  const { key_hash, ...safe } = apiKey;
  return safe;
}

/**
 * Create a new API key
 * Returns the full key (shown once) and the API key record
 */
export async function createApiKey(
  tenantId: string,
  name: string,
  options?: {
    userId?: string;
    description?: string;
    scopes?: ApiKeyScope[];
    expiresAt?: Date;
  }
): Promise<{ key: string; apiKey: SafeApiKey }> {
  const id = `apikey_${ulid()}`;
  const { key, prefix } = generateApiKey('live');
  const keyHash = await hashToken(key);

  const sql = `
    INSERT INTO api_keys (
      id, tenant_id, user_id, key_prefix, key_hash, name, description,
      scopes, expires_at, status, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active', NOW())
    RETURNING *
  `;

  const rows = await query<Record<string, unknown>>(sql, [
    id,
    tenantId,
    options?.userId ?? null,
    prefix,
    keyHash,
    name,
    options?.description ?? null,
    options?.scopes ?? ['read', 'write', 'execute'],
    options?.expiresAt ?? null,
  ]);

  if (!rows[0]) {
    throw new Error('Failed to create API key');
  }

  return { key, apiKey: toSafeApiKey(rowToApiKey(rows[0])) };
}

/**
 * Validate an API key
 * Returns the API key record if valid, null otherwise
 */
export async function validateApiKey(key: string): Promise<ApiKey | null> {
  // Fetch all active, non-expired API keys (we'll verify the hash in memory)
  const sql = `
    SELECT * FROM api_keys
    WHERE status = 'active'
      AND (expires_at IS NULL OR expires_at > NOW())
  `;

  const rows = await query<Record<string, unknown>>(sql, []);

  // Find matching key by verifying hash
  for (const row of rows) {
    const storedHash = row['key_hash'] as string;
    if (await verifyTokenHash(key, storedHash)) {
      // Update usage stats
      await query(
        `
        UPDATE api_keys
        SET last_used_at = NOW(), usage_count = usage_count + 1
        WHERE id = $1
      `,
        [row['id']]
      );

      return rowToApiKey(row);
    }
  }

  return null;
}

/**
 * Get an API key by ID
 */
export async function getApiKeyById(id: string): Promise<ApiKey | null> {
  const sql = 'SELECT * FROM api_keys WHERE id = $1';
  const row = await queryOne<Record<string, unknown>>(sql, [id]);
  return row ? rowToApiKey(row) : null;
}

/**
 * Get an API key by prefix (for identification)
 */
export async function getApiKeyByPrefix(prefix: string): Promise<ApiKey | null> {
  const sql = 'SELECT * FROM api_keys WHERE key_prefix = $1';
  const row = await queryOne<Record<string, unknown>>(sql, [prefix]);
  return row ? rowToApiKey(row) : null;
}

/**
 * Revoke an API key
 */
export async function revokeApiKey(id: string): Promise<boolean> {
  const sql = `
    UPDATE api_keys
    SET status = 'revoked', revoked_at = NOW()
    WHERE id = $1 AND status = 'active'
    RETURNING id
  `;

  const rows = await query<{ id: string }>(sql, [id]);
  return rows.length > 0;
}

/**
 * Revoke all API keys for a tenant
 */
export async function revokeAllTenantApiKeys(tenantId: string): Promise<number> {
  const sql = `
    UPDATE api_keys
    SET status = 'revoked', revoked_at = NOW()
    WHERE tenant_id = $1 AND status = 'active'
    RETURNING id
  `;

  const rows = await query<{ id: string }>(sql, [tenantId]);
  return rows.length;
}

/**
 * Revoke all API keys for a user
 */
export async function revokeAllUserApiKeys(userId: string): Promise<number> {
  const sql = `
    UPDATE api_keys
    SET status = 'revoked', revoked_at = NOW()
    WHERE user_id = $1 AND status = 'active'
    RETURNING id
  `;

  const rows = await query<{ id: string }>(sql, [userId]);
  return rows.length;
}

/**
 * List API keys for a tenant
 */
export async function listApiKeysByTenant(
  tenantId: string,
  options?: {
    status?: ApiKey['status'];
    userId?: string;
    limit?: number;
    offset?: number;
  }
): Promise<SafeApiKey[]> {
  const conditions = ['tenant_id = $1'];
  const params: unknown[] = [tenantId];
  let paramIndex = 2;

  if (options?.status) {
    conditions.push(`status = $${paramIndex}`);
    params.push(options.status);
    paramIndex++;
  }

  if (options?.userId) {
    conditions.push(`user_id = $${paramIndex}`);
    params.push(options.userId);
    paramIndex++;
  }

  const sql = `
    SELECT * FROM api_keys
    WHERE ${conditions.join(' AND ')}
    ORDER BY created_at DESC
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
  `;

  params.push(options?.limit ?? 50, options?.offset ?? 0);

  const rows = await query<Record<string, unknown>>(sql, params);
  return rows.map((row) => toSafeApiKey(rowToApiKey(row)));
}

/**
 * List API keys for a user
 */
export async function listApiKeysByUser(
  userId: string,
  options?: {
    status?: ApiKey['status'];
    limit?: number;
    offset?: number;
  }
): Promise<SafeApiKey[]> {
  const conditions = ['user_id = $1'];
  const params: unknown[] = [userId];
  let paramIndex = 2;

  if (options?.status) {
    conditions.push(`status = $${paramIndex}`);
    params.push(options.status);
    paramIndex++;
  }

  const sql = `
    SELECT * FROM api_keys
    WHERE ${conditions.join(' AND ')}
    ORDER BY created_at DESC
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
  `;

  params.push(options?.limit ?? 50, options?.offset ?? 0);

  const rows = await query<Record<string, unknown>>(sql, params);
  return rows.map((row) => toSafeApiKey(rowToApiKey(row)));
}

/**
 * Count API keys for a tenant
 */
export async function countApiKeysByTenant(
  tenantId: string,
  status?: ApiKey['status']
): Promise<number> {
  let sql = 'SELECT COUNT(*) as count FROM api_keys WHERE tenant_id = $1';
  const params: unknown[] = [tenantId];

  if (status) {
    sql += ' AND status = $2';
    params.push(status);
  }

  const row = await queryOne<{ count: string }>(sql, params);
  return parseInt(row?.count ?? '0', 10);
}

/**
 * Update API key name/description
 */
export async function updateApiKey(
  id: string,
  updates: { name?: string; description?: string }
): Promise<SafeApiKey | null> {
  const setClause: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (updates.name !== undefined) {
    setClause.push(`name = $${paramIndex}`);
    params.push(updates.name);
    paramIndex++;
  }

  if (updates.description !== undefined) {
    setClause.push(`description = $${paramIndex}`);
    params.push(updates.description);
    paramIndex++;
  }

  if (setClause.length === 0) {
    const apiKey = await getApiKeyById(id);
    return apiKey ? toSafeApiKey(apiKey) : null;
  }

  params.push(id);

  const sql = `
    UPDATE api_keys
    SET ${setClause.join(', ')}
    WHERE id = $${paramIndex}
    RETURNING *
  `;

  const rows = await query<Record<string, unknown>>(sql, params);
  return rows[0] ? toSafeApiKey(rowToApiKey(rows[0])) : null;
}

/**
 * Check if an API key has a specific scope
 */
export function hasScope(apiKey: ApiKey | SafeApiKey, scope: ApiKeyScope): boolean {
  return apiKey.scopes.includes(scope);
}

/**
 * Check if an API key has all specified scopes
 */
export function hasAllScopes(
  apiKey: ApiKey | SafeApiKey,
  scopes: ApiKeyScope[]
): boolean {
  return scopes.every((scope) => apiKey.scopes.includes(scope));
}

/**
 * Check if an API key has any of the specified scopes
 */
export function hasAnyScope(
  apiKey: ApiKey | SafeApiKey,
  scopes: ApiKeyScope[]
): boolean {
  return scopes.some((scope) => apiKey.scopes.includes(scope));
}

/**
 * Clean up expired API keys (run periodically)
 */
export async function cleanupExpiredApiKeys(): Promise<number> {
  const sql = `
    UPDATE api_keys
    SET status = 'revoked', revoked_at = NOW()
    WHERE status = 'active'
      AND expires_at IS NOT NULL
      AND expires_at < NOW()
    RETURNING id
  `;

  const rows = await query<{ id: string }>(sql);
  return rows.length;
}
