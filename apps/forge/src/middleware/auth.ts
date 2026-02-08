/**
 * Forge Authentication Middleware
 * API key verification via SHA-256 hash lookup in forge_api_keys
 */

import { createHash } from 'node:crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { query, queryOne } from '../database.js';

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
 * Required authentication middleware.
 * Rejects the request with 401 if no valid API key is provided.
 */
export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const authHeader = request.headers['authorization'];

  if (!authHeader || typeof authHeader !== 'string') {
    reply.status(401).send({
      error: 'Unauthorized',
      message: 'Missing Authorization header',
    });
    return;
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    reply.status(401).send({
      error: 'Unauthorized',
      message: 'Invalid Authorization header format. Expected: Bearer <token>',
    });
    return;
  }

  const token = parts[1];
  if (!token) {
    reply.status(401).send({
      error: 'Unauthorized',
      message: 'Missing token',
    });
    return;
  }

  // Only forge API keys (prefix fk_) are supported
  if (!token.startsWith('fk_')) {
    reply.status(401).send({
      error: 'Unauthorized',
      message: 'Invalid token format. Forge API keys must start with fk_',
    });
    return;
  }

  const keyHash = hashApiKey(token);

  const apiKey = await queryOne<ApiKeyRow>(
    `SELECT id, owner_id, permissions, rate_limit, expires_at, is_active
     FROM forge_api_keys
     WHERE key_hash = $1`,
    [keyHash],
  );

  if (!apiKey) {
    reply.status(401).send({
      error: 'Unauthorized',
      message: 'Invalid API key',
    });
    return;
  }

  if (!apiKey.is_active) {
    reply.status(401).send({
      error: 'Unauthorized',
      message: 'API key is deactivated',
    });
    return;
  }

  if (apiKey.expires_at && new Date(apiKey.expires_at) < new Date()) {
    reply.status(401).send({
      error: 'Unauthorized',
      message: 'API key has expired',
    });
    return;
  }

  // Update last_used_at asynchronously (fire and forget)
  void query(
    `UPDATE forge_api_keys SET last_used_at = NOW() WHERE id = $1`,
    [apiKey.id],
  ).catch(() => {
    // Silently ignore update errors
  });

  request.userId = apiKey.owner_id;
  request.apiKeyId = apiKey.id;
  request.apiKeyPermissions = apiKey.permissions as string[];
}

/**
 * Optional authentication middleware.
 * Sets request.userId if a valid API key is present, but does not reject the request otherwise.
 */
export async function optionalAuth(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  const authHeader = request.headers['authorization'];

  if (!authHeader || typeof authHeader !== 'string') {
    return;
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return;
  }

  const token = parts[1];
  if (!token || !token.startsWith('fk_')) {
    return;
  }

  const keyHash = hashApiKey(token);

  const apiKey = await queryOne<ApiKeyRow>(
    `SELECT id, owner_id, permissions, rate_limit, expires_at, is_active
     FROM forge_api_keys
     WHERE key_hash = $1`,
    [keyHash],
  );

  if (!apiKey || !apiKey.is_active) {
    return;
  }

  if (apiKey.expires_at && new Date(apiKey.expires_at) < new Date()) {
    return;
  }

  void query(
    `UPDATE forge_api_keys SET last_used_at = NOW() WHERE id = $1`,
    [apiKey.id],
  ).catch(() => {});

  request.userId = apiKey.owner_id;
  request.apiKeyId = apiKey.id;
  request.apiKeyPermissions = apiKey.permissions as string[];
}
