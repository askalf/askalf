// API Key management — minimal surface for dashboard server.js

import { ulid } from 'ulid';
import { query } from '@askalf/database';
import { pbkdf2Sync, randomBytes } from 'node:crypto';

// PBKDF2 configuration for token hashing
const PBKDF2_ITERATIONS = 100000;
const PBKDF2_DIGEST = 'sha256';
const PBKDF2_SALT_LENGTH = 16;

export type ApiKeyScope = 'read' | 'write' | 'execute' | 'admin';

export interface SafeApiKey {
  id: string;
  tenant_id: string;
  user_id: string | null;
  key_prefix: string;
  name: string;
  description: string | null;
  scopes: ApiKeyScope[];
  last_used_at: Date | null;
  usage_count: number;
  status: 'active' | 'revoked' | 'expired';
  expires_at: Date | null;
  revoked_at: Date | null;
  created_at: Date;
}

interface ApiKey extends SafeApiKey {
  key_hash: string;
}

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

function toSafeApiKey(apiKey: ApiKey): SafeApiKey {
  const { key_hash, ...safe } = apiKey;
  return safe;
}

function generateSecureToken(length: number = 32): string {
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => chars[byte % chars.length]).join('');
}

function generateApiKey(
  environment: 'live' | 'test' = 'live'
): { key: string; prefix: string } {
  const randomPart = generateSecureToken(32);
  const key = `sk_${environment}_${randomPart}`;
  const prefix = key.slice(0, 12);
  return { key, prefix };
}

async function hashTokenPbkdf2(token: string): Promise<string> {
  const salt = randomBytes(PBKDF2_SALT_LENGTH);
  const hash = pbkdf2Sync(token, salt, PBKDF2_ITERATIONS, 32, PBKDF2_DIGEST);
  return `${salt.toString('hex')}.${hash.toString('hex')}`;
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
  const keyHash = await hashTokenPbkdf2(key);

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
 * List API keys for a user
 */
export async function listApiKeysByUser(
  userId: string,
  options?: {
    status?: 'active' | 'revoked' | 'expired';
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
