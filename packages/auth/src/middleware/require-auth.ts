// SUBSTRATE v1: Auth Requirement Middleware
// Enforces authentication and role-based access control

import type { FastifyRequest, FastifyReply } from 'fastify';
import type { UserRole, ApiKeyScope } from '../types.js';
import { hasAllScopes } from '../api-keys.js';

/**
 * Error response for unauthorized requests
 */
function sendUnauthorized(reply: FastifyReply, message: string): void {
  reply.code(401).send({
    error: 'Unauthorized',
    message,
    code: 'UNAUTHORIZED',
  });
}

/**
 * Error response for forbidden requests
 */
function sendForbidden(reply: FastifyReply, message: string): void {
  reply.code(403).send({
    error: 'Forbidden',
    message,
    code: 'FORBIDDEN',
  });
}

/**
 * Require authentication - rejects requests without valid auth
 */
export function requireAuth() {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.auth) {
      sendUnauthorized(reply, 'Authentication required');
      return reply;
    }
  };
}

/**
 * Require session authentication (not API key)
 */
export function requireSession() {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.auth?.session) {
      sendUnauthorized(reply, 'Session authentication required');
      return reply;
    }
  };
}

/**
 * Require API key authentication (not session)
 */
export function requireApiKey() {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.auth?.apiKey) {
      sendUnauthorized(reply, 'API key authentication required');
      return reply;
    }
  };
}

/**
 * Require specific user role(s)
 */
export function requireRole(roles: UserRole | UserRole[]) {
  const allowedRoles = Array.isArray(roles) ? roles : [roles];

  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.auth) {
      sendUnauthorized(reply, 'Authentication required');
      return reply;
    }

    // API keys don't have roles - need user
    if (!request.auth.user) {
      sendForbidden(reply, 'User authentication required for this endpoint');
      return reply;
    }

    if (!allowedRoles.includes(request.auth.user.role)) {
      sendForbidden(
        reply,
        `Required role: ${allowedRoles.join(' or ')}`
      );
      return reply;
    }
  };
}

/**
 * Require admin role (admin or super_admin)
 */
export function requireAdmin() {
  return requireRole(['admin', 'super_admin']);
}

/**
 * Require super_admin role
 */
export function requireSuperAdmin() {
  return requireRole('super_admin');
}

/**
 * Require specific API key scopes
 */
export function requireScopes(scopes: ApiKeyScope | ApiKeyScope[]) {
  const requiredScopes = Array.isArray(scopes) ? scopes : [scopes];

  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.auth) {
      sendUnauthorized(reply, 'Authentication required');
      return reply;
    }

    // Session auth has all scopes
    if (request.auth.session) {
      return;
    }

    // API key must have required scopes
    if (request.auth.apiKey) {
      if (!hasAllScopes(request.auth.apiKey, requiredScopes)) {
        sendForbidden(
          reply,
          `Required scopes: ${requiredScopes.join(', ')}`
        );
        return reply;
      }
    }
  };
}

/**
 * Require email verification
 */
export function requireVerifiedEmail() {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.auth) {
      sendUnauthorized(reply, 'Authentication required');
      return reply;
    }

    if (!request.auth.user?.email_verified) {
      sendForbidden(reply, 'Email verification required');
      return reply;
    }
  };
}

/**
 * Require the authenticated user to match the requested user ID
 * (or be an admin)
 */
export function requireSelfOrAdmin(userIdParam: string = 'userId') {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.auth) {
      sendUnauthorized(reply, 'Authentication required');
      return reply;
    }

    const requestedUserId = (request.params as Record<string, string>)[userIdParam];
    const authUserId = request.auth.user?.id;
    const isAdmin = request.auth.user?.role === 'admin' || request.auth.user?.role === 'super_admin';

    if (!authUserId) {
      sendForbidden(reply, 'User authentication required');
      return reply;
    }

    if (authUserId !== requestedUserId && !isAdmin) {
      sendForbidden(reply, 'Access denied');
      return reply;
    }
  };
}

/**
 * Require tenant membership
 * Ensures the authenticated user/API key belongs to the specified tenant
 */
export function requireTenantAccess(tenantIdParam: string = 'tenantId') {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.auth) {
      sendUnauthorized(reply, 'Authentication required');
      return reply;
    }

    const requestedTenantId = (request.params as Record<string, string>)[tenantIdParam];
    const authTenantId = request.auth.tenant_id;
    const isSuperAdmin = request.auth.user?.role === 'super_admin';

    if (authTenantId !== requestedTenantId && !isSuperAdmin) {
      sendForbidden(reply, 'Access denied to this tenant');
      return reply;
    }
  };
}

/**
 * Optional authentication - attaches auth context if present but doesn't require it
 * This is the default behavior of the auth middleware, but can be used explicitly
 */
export function optionalAuth() {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    // Auth middleware already ran, nothing to do
    return;
  };
}

/**
 * Combine multiple auth requirements
 */
export function combineRequirements(
  ...requirements: Array<(request: FastifyRequest, reply: FastifyReply) => Promise<void>>
) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    for (const requirement of requirements) {
      await requirement(request, reply);
      // If reply was sent (status code set), stop processing
      if (reply.sent) {
        return;
      }
    }
  };
}
