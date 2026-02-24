/**
 * CSRF Token Protection Middleware
 * Validates CSRF tokens for state-changing requests (POST, PUT, DELETE, PATCH)
 * Token can be provided via:
 * - X-CSRF-Token header
 * - csrf_token form field (URL-encoded or multipart)
 * - csrf_token query parameter
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { createHash } from 'crypto';

const CSRF_HEADER = 'x-csrf-token';
const CSRF_FORM_FIELD = 'csrf_token';
const CSRF_SESSION_KEY = 'csrf_token';

/**
 * Generate a CSRF token (should be stored in session)
 */
export function generateCsrfToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Extract CSRF token from request (header, body, or query)
 */
function extractCsrfToken(request: FastifyRequest): string | null {
  // Check header first
  const headerToken = request.headers[CSRF_HEADER];
  if (typeof headerToken === 'string' && headerToken) {
    return headerToken;
  }

  // Check URL-encoded or multipart form body
  if (request.body && typeof request.body === 'object') {
    const bodyToken = (request.body as Record<string, unknown>)[CSRF_FORM_FIELD];
    if (typeof bodyToken === 'string' && bodyToken) {
      return bodyToken;
    }
  }

  // Check query parameters
  const queryToken = (request.query as Record<string, unknown>)?.[CSRF_FORM_FIELD];
  if (typeof queryToken === 'string' && queryToken) {
    return queryToken;
  }

  return null;
}

/**
 * CSRF protection middleware for state-changing endpoints
 * Should be applied to POST, PUT, DELETE, PATCH routes
 * Skips: GET, OPTIONS, HEAD (safe methods)
 * Skips: API key authenticated requests (assuming scripts/agents can CSRF)
 */
export async function csrfProtectionMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  // Skip safe methods
  const safeMethod = ['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase());
  if (safeMethod) return;

  // Skip API key authenticated requests (assume they're safe)
  const apiKeyAuth = (request as FastifyRequest & { apiKeyAuth?: boolean }).apiKeyAuth;
  if (apiKeyAuth) return;

  // Get session user
  const sessionUser = (request as FastifyRequest & { sessionUser?: unknown }).sessionUser;
  if (!sessionUser) {
    // No session, no CSRF protection needed (API key auth or anonymous)
    return;
  }

  // For session-authenticated users, validate CSRF token
  const providedToken = extractCsrfToken(request);
  if (!providedToken) {
    return reply.status(403).send({
      error: 'Forbidden',
      message: 'CSRF token required for state-changing requests',
      statusCode: 403,
    });
  }

  // Get session CSRF token (stored during login)
  const sessionCsrfToken = (request as FastifyRequest & { sessionCsrfToken?: string }).sessionCsrfToken;
  if (!sessionCsrfToken) {
    return reply.status(403).send({
      error: 'Forbidden',
      message: 'CSRF token not found in session',
      statusCode: 403,
    });
  }

  // Compare tokens (constant-time comparison)
  const providedHash = createHash('sha256').update(providedToken).digest('hex');
  const sessionHash = createHash('sha256').update(sessionCsrfToken).digest('hex');

  if (providedHash !== sessionHash) {
    return reply.status(403).send({
      error: 'Forbidden',
      message: 'CSRF token validation failed',
      statusCode: 403,
    });
  }
}

/**
 * Extend Fastify request type
 */
declare module 'fastify' {
  interface FastifyRequest {
    sessionCsrfToken?: string;
    apiKeyAuth?: boolean;
  }
}
