/**
 * Session-based Authentication Middleware for Forge
 * Authenticates dashboard users via session cookies (from the API auth system).
 * Works alongside existing API key auth — API keys for scripts/agents, sessions for dashboard users.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { createHash } from 'crypto';
import { substrateQuery, substrateQueryOne } from '../database.js';

const SESSION_COOKIE_NAME = 'substrate_session';

interface SessionUser {
  id: string;
  email: string;
  role: 'user' | 'admin' | 'super_admin';
  tenantId: string;
  displayName: string | null;
  plan: string | null;
}

interface SessionRow {
  user_id: string;
  email: string;
  role: string;
  tenant_id: string;
  display_name: string | null;
  plan_name: string | null;
  tenant_tier: string | null;
}

async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Extract session token from cookie or Authorization header.
 */
function extractSessionToken(request: FastifyRequest): string | null {
  // Try cookie first
  const cookies = request.cookies as Record<string, string> | undefined;
  if (cookies?.[SESSION_COOKIE_NAME]) {
    return cookies[SESSION_COOKIE_NAME];
  }

  // Try Authorization header: Bearer <token>
  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith('Bearer substrate_sess_')) {
    return authHeader.slice(7);
  }

  return null;
}

/**
 * Resolve a session token to a user. Returns null if invalid/expired.
 */
export async function resolveSession(token: string): Promise<SessionUser | null> {
  const tokenHash = await hashToken(token);

  const session = await substrateQueryOne<SessionRow>(
    `SELECT s.user_id, u.email, u.role, u.tenant_id, u.display_name,
            t.tier as tenant_tier
     FROM sessions s
     JOIN users u ON s.user_id = u.id
     JOIN tenants t ON u.tenant_id = t.id
     WHERE s.token_hash = $1 AND s.expires_at > NOW() AND s.revoked = false AND u.status = 'active'`,
    [tokenHash],
  );

  if (!session) return null;

  // Update last active (fire-and-forget)
  void substrateQuery(
    `UPDATE sessions SET last_active_at = NOW() WHERE token_hash = $1`,
    [tokenHash],
  ).catch(() => {});

  return {
    id: session.user_id,
    email: session.email,
    role: session.role as SessionUser['role'],
    tenantId: session.tenant_id,
    displayName: session.display_name,
    plan: session.tenant_tier || 'free',
  };
}

/**
 * Session auth middleware for Forge routes.
 * Sets request.userId and request.sessionUser if a valid session is found.
 * Does NOT reject — falls through to let API key auth try next.
 */
export async function sessionAuthMiddleware(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  // Skip if already authenticated (API key auth ran first)
  if (request.userId) return;

  const token = extractSessionToken(request);
  if (!token) return;

  const user = await resolveSession(token);
  if (!user) return;

  // Set user info on request (same field names as API key auth)
  request.userId = user.id;
  (request as FastifyRequest & { sessionUser?: SessionUser }).sessionUser = user;

  // Load CSRF token from session (stored during login)
  const csrfToken = await getCsrfTokenFromSession(token);
  if (csrfToken) {
    (request as FastifyRequest & { sessionCsrfToken?: string }).sessionCsrfToken = csrfToken;
  }
}

/**
 * Get CSRF token stored in session
 */
async function getCsrfTokenFromSession(sessionToken: string): Promise<string | null> {
  const tokenHash = await hashToken(sessionToken);
  const session = await substrateQueryOne<{ csrf_token?: string }>(
    `SELECT csrf_token FROM sessions WHERE token_hash = $1 AND expires_at > NOW() AND revoked = false`,
    [tokenHash],
  ).catch(() => null);

  return session?.csrf_token ?? null;
}

/**
 * Require admin role. Use after sessionAuthMiddleware or authMiddleware.
 */
export async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const sessionUser = (request as FastifyRequest & { sessionUser?: SessionUser }).sessionUser;
  if (sessionUser && sessionUser.role !== 'admin' && sessionUser.role !== 'super_admin') {
    return reply.status(403).send({ error: 'Admin access required' });
  }
  // If no sessionUser, it's API key auth — assume admin (API keys are admin-only)
}

// Extend Fastify request type
declare module 'fastify' {
  interface FastifyRequest {
    userId?: string;
    sessionUser?: SessionUser;
  }
}

export type { SessionUser };
