// SUBSTRATE v1: Session Middleware
// HTTP cookie session authentication for Fastify

import type { FastifyRequest, FastifyReply } from 'fastify';
import '@fastify/cookie'; // Import for type augmentation
import { validateSessionWithUser } from '../sessions.js';
import type { AuthContext, SafeUser, Session } from '../types.js';

// Cookie settings
export const SESSION_COOKIE_NAME = 'substrate_session';
export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env['NODE_ENV'] === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
};

// Extend FastifyRequest to include auth context
declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
    user?: SafeUser;
    session?: Session;
  }
}

/**
 * Extract session token from cookie
 */
export function extractSessionToken(request: FastifyRequest): string | null {
  const cookies = request.cookies as Record<string, string> | undefined;
  return cookies?.[SESSION_COOKIE_NAME] ?? null;
}

/**
 * Set session cookie
 */
export function setSessionCookie(
  reply: FastifyReply,
  token: string,
  maxAge?: number
): void {
  reply.setCookie(SESSION_COOKIE_NAME, token, {
    ...SESSION_COOKIE_OPTIONS,
    maxAge: maxAge ?? SESSION_COOKIE_OPTIONS.maxAge,
  });
}

/**
 * Clear session cookie
 */
export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE_NAME, {
    path: '/',
  });
}

/**
 * Session middleware - validates session and attaches user to request
 * Does not reject requests without a session (use requireAuth for that)
 */
export async function sessionMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const token = extractSessionToken(request);

  if (!token) {
    return;
  }

  try {
    const sessionWithUser = await validateSessionWithUser(token);

    if (sessionWithUser) {
      request.auth = {
        user: sessionWithUser.user,
        session: sessionWithUser,
        tenant_id: sessionWithUser.user.tenant_id,
      };
      request.user = sessionWithUser.user;
      request.session = sessionWithUser;
    } else {
      // Invalid session - clear the cookie
      clearSessionCookie(reply);
    }
  } catch (error) {
    // Log error but don't fail the request
    console.error('Session validation error:', error);
  }
}

/**
 * Create a pre-handler hook for session middleware
 */
export function createSessionMiddleware() {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    await sessionMiddleware(request, reply);
  };
}
