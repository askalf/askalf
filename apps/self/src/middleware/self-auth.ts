/**
 * SELF Auth Middleware
 * Resolves authenticated user → SELF instance
 * Uses SELF's own sessions and users (self_sessions / self_users)
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { createHash } from 'node:crypto';
import { queryOne } from '../database.js';

// ============================================
// Types
// ============================================

interface SessionRow {
  id: string;
  user_id: string;
  expires_at: string;
  revoked: boolean;
}

interface UserRow {
  id: string;
  email: string;
  display_name: string | null;
  preferred_name: string | null;
  status: string;
  role: string;
}

interface SelfRow {
  id: string;
  user_id: string;
  tenant_id: string;
  status: string;
  forge_agent_id: string | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    userId?: string;
    tenantId?: string;
    selfId?: string;
    selfInstance?: SelfRow;
    userDisplayName?: string | null;
    userEmail?: string;
  }
}

// ============================================
// Session Cookie Auth
// ============================================

const SESSION_COOKIE_NAME = 'self_session';

async function hashToken(token: string): Promise<string> {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Authenticate user via self_session cookie and resolve their SELF instance.
 * Queries self_sessions and self_users (SELF's own tables).
 * Does NOT require a SELF instance to exist (activation creates it).
 */
export async function selfAuthMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  // Extract session token from cookie
  const cookies = request.cookies as Record<string, string> | undefined;
  const token = cookies?.[SESSION_COOKIE_NAME];

  // Also support Bearer token for API access
  let sessionToken = token;
  if (!sessionToken) {
    const authHeader = request.headers['authorization'];
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      sessionToken = authHeader.slice(7);
    }
  }

  if (!sessionToken) {
    reply.status(401).send({
      error: 'Unauthorized',
      message: 'Authentication required',
    });
    return;
  }

  // Validate session against self_sessions
  const tokenHash = await hashToken(sessionToken);
  const session = await queryOne<SessionRow>(
    `SELECT id, user_id, expires_at, revoked
     FROM self_sessions
     WHERE token_hash = $1`,
    [tokenHash],
  );

  if (!session || session.revoked || new Date(session.expires_at) < new Date()) {
    reply.status(401).send({
      error: 'Unauthorized',
      message: 'Invalid or expired session',
    });
    return;
  }

  // Load user from self_users
  const user = await queryOne<UserRow>(
    `SELECT id, email, display_name, preferred_name, status, role
     FROM self_users
     WHERE id = $1 AND status = 'active'`,
    [session.user_id],
  );

  if (!user) {
    reply.status(401).send({
      error: 'Unauthorized',
      message: 'User not found or inactive',
    });
    return;
  }

  // Attach user info to request
  request.userId = user.id;
  request.userDisplayName = user.display_name;
  request.userEmail = user.email;

  // Try to resolve SELF instance (may not exist yet if not activated)
  const self = await queryOne<SelfRow>(
    `SELECT id, user_id, tenant_id, status, forge_agent_id
     FROM self_instances
     WHERE user_id = $1`,
    [user.id],
  );

  if (self) {
    request.selfId = self.id;
    request.selfInstance = self;
    request.tenantId = self.tenant_id;
  }
}

/**
 * Middleware that requires an active SELF instance.
 * Must be used AFTER selfAuthMiddleware.
 */
export async function requireSelf(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (!request.selfId) {
    reply.status(404).send({
      error: 'Not Found',
      message: 'SELF not activated. Call POST /api/v1/self/activate first.',
    });
    return;
  }
}
