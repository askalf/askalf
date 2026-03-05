/**
 * Forge Authentication Middleware
 * Supports two auth methods:
 * 1. API key (fk_ prefix) — for scripts, agents, admin-hub proxy
 * 2. Session cookie (substrate_session) — for dashboard users
 */

import { createHash, pbkdf2Sync } from 'node:crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { query, queryOne, retryQuery } from '../database.js';
import { sessionAuthMiddleware } from './session-auth.js';

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

// PBKDF2 configuration for API key hashing
const PBKDF2_ITERATIONS = 100000;
const PBKDF2_DIGEST = 'sha256';

/**
 * Verify an API key against a stored PBKDF2 hash
 * Handles both new PBKDF2 format (salt.hash) and legacy SHA-256 format
 */
function verifyApiKeyHash(key: string, storedHash: string): boolean {
  try {
    // Check if this is the new PBKDF2 format (contains a dot)
    if (storedHash.includes('.')) {
      const [saltHex, hashHex] = storedHash.split('.');
      if (!saltHex || !hashHex) return false;

      const salt = Buffer.from(saltHex, 'hex');
      const derivedHash = pbkdf2Sync(
        key,
        salt,
        PBKDF2_ITERATIONS,
        32,
        PBKDF2_DIGEST
      );

      return derivedHash.toString('hex') === hashHex;
    }

    // Legacy SHA-256 format (for backward compatibility with existing keys)
    const sha256Hash = createHash('sha256').update(key).digest('hex');
    return sha256Hash === storedHash;
  } catch {
    return false;
  }
}

/**
 * Try API key authentication. Returns true if authenticated.
 */
async function tryApiKeyAuth(request: FastifyRequest): Promise<boolean> {
  const authHeader = request.headers['authorization'];
  if (!authHeader || typeof authHeader !== 'string') return false;

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') return false;

  const token = parts[1];
  if (!token || !token.startsWith('fk_')) return false;

  // Fetch all active API keys (we'll verify the hash in memory)
  const apiKeys = await query<ApiKeyRow>(
    `SELECT id, owner_id, permissions, rate_limit, expires_at, is_active, key_hash
     FROM forge_api_keys WHERE is_active = true`,
    [],
  );

  // Find matching key by verifying hash
  for (const apiKey of apiKeys) {
    if (!verifyApiKeyHash(token, apiKey.key_hash)) continue;

    // Check expiration
    if (apiKey.expires_at && new Date(apiKey.expires_at) < new Date()) continue;

    // Update last_used_at asynchronously with retry on transient DB errors
    void retryQuery(
      `UPDATE forge_api_keys SET last_used_at = NOW() WHERE id = $1`,
      [apiKey.id],
    ).catch((err) => {
      console.warn('[Auth] Failed to update last_used_at after retries:', err instanceof Error ? err.message : err);
    });

    // If dashboard forwards a real user ID via X-User-Id, use it instead of the API key owner
    const forwardedUserId = request.headers['x-user-id'];
    request.userId = (typeof forwardedUserId === 'string' && forwardedUserId) ? forwardedUserId : apiKey.owner_id;
    request.apiKeyId = apiKey.id;
    request.apiKeyPermissions = apiKey.permissions as string[];

    // Attach expiry metadata so the onSend hook can warn callers
    if (apiKey.expires_at) {
      request.apiKeyExpiresAt = new Date(apiKey.expires_at);
    }

    return true;
  }

  return false;
}

/**
 * Required authentication middleware.
 * Tries API key first, then session cookie. Rejects with 401 if neither works.
 */
export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  // Try API key auth first
  if (await tryApiKeyAuth(request)) return;

  // Try session auth (sets request.userId if valid)
  await sessionAuthMiddleware(request, reply);
  if (request.userId) return;

  // Neither worked — return reply to stop Fastify v5 lifecycle
  return reply.status(401).send({
    error: 'Unauthorized',
    message: 'Valid API key or session required',
  }) as never;
}

/**
 * Optional authentication middleware.
 * Sets request.userId if authenticated, but does not reject.
 */
export async function optionalAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (await tryApiKeyAuth(request)) return;
  await sessionAuthMiddleware(request, reply);
}
