/**
 * Forge Authentication Middleware — Self-Hosted
 * Always resolves to admin user. API key auth still works for agents/scripts.
 */

import { createHash, pbkdf2Sync } from 'node:crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { query, queryOne, retryQuery } from '../database.js';

interface ApiKeyRow {
  id: string;
  owner_id: string;
  name: string;
  key_hash: string;
  key_prefix: string;
  permissions: string[];
  rate_limit: number;
  last_used_at: string | null;
  expires_at: string | null;
  is_active: boolean;
  created_at: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    userId?: string;
    apiKeyId?: string;
    apiKeyPermissions?: string[];
    apiKeyExpiresAt?: Date;
  }
}

const PBKDF2_ITERATIONS = 100000;
const PBKDF2_DIGEST = 'sha256';

function verifyApiKeyHash(key: string, storedHash: string): boolean {
  try {
    if (storedHash.includes('.')) {
      const [saltHex, hashHex] = storedHash.split('.');
      if (!saltHex || !hashHex) return false;
      const salt = Buffer.from(saltHex, 'hex');
      const derivedHash = pbkdf2Sync(key, salt, PBKDF2_ITERATIONS, 32, PBKDF2_DIGEST);
      return derivedHash.toString('hex') === hashHex;
    }
    const sha256Hash = createHash('sha256').update(key).digest('hex');
    return sha256Hash === storedHash;
  } catch {
    return false;
  }
}

async function tryApiKeyAuth(request: FastifyRequest): Promise<boolean> {
  const authHeader = request.headers['authorization'];
  if (!authHeader || typeof authHeader !== 'string') return false;

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') return false;

  const token = parts[1];
  if (!token || !token.startsWith('fk_')) return false;

  const apiKeys = await query<ApiKeyRow>(
    `SELECT id, owner_id, permissions, rate_limit, expires_at, is_active, key_hash
     FROM forge_api_keys WHERE is_active = true`,
    [],
  );

  for (const apiKey of apiKeys) {
    if (!verifyApiKeyHash(token, apiKey.key_hash)) continue;
    if (apiKey.expires_at && new Date(apiKey.expires_at) < new Date()) continue;

    void retryQuery(
      `UPDATE forge_api_keys SET last_used_at = NOW() WHERE id = $1`,
      [apiKey.id],
    ).catch(() => {});

    const forwardedUserId = request.headers['x-user-id'];
    request.userId = (typeof forwardedUserId === 'string' && forwardedUserId) ? forwardedUserId : apiKey.owner_id;
    request.apiKeyId = apiKey.id;
    request.apiKeyPermissions = apiKey.permissions as string[];

    if (apiKey.expires_at) {
      request.apiKeyExpiresAt = new Date(apiKey.expires_at);
    }

    return true;
  }

  return false;
}

let cachedAdminUserId: string | null = null;

async function getAdminUserId(): Promise<string> {
  if (cachedAdminUserId) return cachedAdminUserId;
  const admin = await queryOne<{ id: string }>(
    `SELECT id FROM users WHERE role IN ('super_admin', 'admin') ORDER BY created_at ASC LIMIT 1`,
  );
  if (admin) {
    cachedAdminUserId = admin.id;
    return admin.id;
  }
  throw new Error('No admin user found. Run setup first.');
}

export async function authMiddleware(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  if (await tryApiKeyAuth(request)) return;
  request.userId = await getAdminUserId();
}

export async function optionalAuth(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  if (await tryApiKeyAuth(request)) return;
  request.userId = await getAdminUserId();
}

export async function requireAdmin(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  if (request.userId) return;
  request.userId = await getAdminUserId();
}
