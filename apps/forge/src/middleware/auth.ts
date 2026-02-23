/**
 * Forge Authentication Middleware
 * Supports two auth methods:
 * 1. API key (fk_ prefix) — for scripts, agents, admin-hub proxy
 * 2. Session cookie (substrate_session) — for dashboard users
 */

import { createHash } from 'node:crypto';
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
  }
}

function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
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

  const keyHash = hashApiKey(token);
  const apiKey = await queryOne<ApiKeyRow>(
    `SELECT id, owner_id, permissions, rate_limit, expires_at, is_active
     FROM forge_api_keys WHERE key_hash = $1`,
    [keyHash],
  );

  if (!apiKey || !apiKey.is_active) return false;
  if (apiKey.expires_at && new Date(apiKey.expires_at) < new Date()) return false;

  // Update last_used_at asynchronously with retry on transient DB errors
  void retryQuery(
    `UPDATE forge_api_keys SET last_used_at = NOW() WHERE id = $1`,
    [apiKey.id],
  ).catch((err) => {
    console.warn('[Auth] Failed to update last_used_at after retries:', err instanceof Error ? err.message : err);
  });

  request.userId = apiKey.owner_id;
  request.apiKeyId = apiKey.id;
  request.apiKeyPermissions = apiKey.permissions as string[];
  return true;
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

  // Neither worked
  reply.status(401).send({
    error: 'Unauthorized',
    message: 'Valid API key or session required',
  });
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
