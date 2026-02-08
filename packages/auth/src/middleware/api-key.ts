// SUBSTRATE v1: API Key Middleware
// Bearer token authentication for API requests

import type { FastifyRequest, FastifyReply } from 'fastify';
import { validateApiKey } from '../api-keys.js';
import { getSafeUserById } from '../users.js';
import type { AuthContext, SafeApiKey } from '../types.js';

// Extend FastifyRequest to include API key
declare module 'fastify' {
  interface FastifyRequest {
    apiKey?: SafeApiKey;
  }
}

/**
 * Extract API key from Authorization header
 * Supports: Bearer sk_xxx and sk_xxx (without Bearer)
 */
export function extractApiKey(request: FastifyRequest): string | null {
  const authHeader = request.headers.authorization;

  if (!authHeader) {
    return null;
  }

  // Bearer token format
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }

  // Direct API key format (sk_xxx)
  if (authHeader.startsWith('sk_')) {
    return authHeader;
  }

  return null;
}

/**
 * API key middleware - validates API key and attaches tenant context to request
 * Does not reject requests without an API key (use requireAuth for that)
 */
export async function apiKeyMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  // Skip if already authenticated via session
  if (request.auth) {
    return;
  }

  const key = extractApiKey(request);

  if (!key) {
    return;
  }

  try {
    const apiKey = await validateApiKey(key);

    if (apiKey) {
      // Get user if API key is tied to a user
      let user = undefined;
      if (apiKey.user_id) {
        user = await getSafeUserById(apiKey.user_id) ?? undefined;
      }

      // Remove key_hash before attaching
      const { key_hash, ...safeApiKey } = apiKey;

      request.auth = {
        user: user!,
        apiKey: safeApiKey,
        tenant_id: apiKey.tenant_id,
      };
      request.apiKey = safeApiKey;

      // Also set user if available
      if (user) {
        request.user = user;
      }
    }
  } catch (error) {
    // Log error but don't fail the request
    console.error('API key validation error:', error);
  }
}

/**
 * Create a pre-handler hook for API key middleware
 */
export function createApiKeyMiddleware() {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    await apiKeyMiddleware(request, reply);
  };
}

/**
 * Combined middleware - tries session first, then API key
 */
export async function combinedAuthMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  // Import dynamically to avoid circular dependency
  const { sessionMiddleware } = await import('./session.js');

  // Try session first
  await sessionMiddleware(request, reply);

  // If no session, try API key
  if (!request.auth) {
    await apiKeyMiddleware(request, reply);
  }
}

/**
 * Create a pre-handler hook for combined auth middleware
 */
export function createCombinedAuthMiddleware() {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    await combinedAuthMiddleware(request, reply);
  };
}
