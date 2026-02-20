/**
 * Self Authentication Middleware
 * Validates session cookies against the substrate users/sessions tables.
 * Self only supports session auth (no API keys).
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { substrateQuery, substrateQueryOne } from '../database.js';

const SESSION_COOKIE_NAME = 'substrate_session';

interface SessionRow {
  user_id: string;
  email: string;
  role: string;
  tenant_id: string;
  display_name: string | null;
}

async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

function extractSessionToken(request: FastifyRequest): string | null {
  const cookies = request.cookies as Record<string, string> | undefined;
  if (cookies?.[SESSION_COOKIE_NAME]) {
    return cookies[SESSION_COOKIE_NAME];
  }

  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith('Bearer substrate_sess_')) {
    return authHeader.slice(7);
  }

  return null;
}

declare module 'fastify' {
  interface FastifyRequest {
    userId?: string;
  }
}

/**
 * Required authentication middleware for Self routes.
 * Validates session cookie, rejects with 401 if invalid.
 */
export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const token = extractSessionToken(request);
  if (!token) {
    return reply.status(401).send({ error: 'Unauthorized', message: 'Session required' });
  }

  const tokenHash = await hashToken(token);

  const session = await substrateQueryOne<SessionRow>(
    `SELECT s.user_id, u.email, u.role, u.tenant_id, u.display_name
     FROM sessions s
     JOIN users u ON s.user_id = u.id
     WHERE s.token_hash = $1 AND s.expires_at > NOW() AND s.revoked = false AND u.status = 'active'`,
    [tokenHash],
  );

  if (!session) {
    return reply.status(401).send({ error: 'Unauthorized', message: 'Invalid or expired session' });
  }

  // Update last active (fire-and-forget)
  void substrateQuery(
    'UPDATE sessions SET last_active_at = NOW() WHERE token_hash = $1',
    [tokenHash],
  ).catch(() => {});

  request.userId = session.user_id;
}
