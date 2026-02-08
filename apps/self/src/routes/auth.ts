/**
 * SELF Auth Routes
 * Independent authentication — no shared substrate sessions.
 * All routes are public (no auth middleware).
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { SelfConfig } from '../config.js';
import {
  createUser,
  authenticateUser,
  createSession,
  validateSession,
  revokeSession,
  requestPasswordReset,
  resetPassword,
} from '../services/auth.js';

// ============================================
// Constants
// ============================================

const COOKIE_NAME = 'self_session';
const SESSION_MAX_AGE = 7 * 24 * 60 * 60; // 7 days in seconds

function getCookieOptions(config: SelfConfig) {
  const isProd = config.nodeEnv === 'production';
  return {
    path: '/',
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax' as const,
    maxAge: SESSION_MAX_AGE,
    ...(isProd ? { domain: '.askalf.org' } : {}),
  };
}

// ============================================
// Routes
// ============================================

export async function authRoutes(app: FastifyInstance, config: SelfConfig): Promise<void> {

  // ---- POST /api/v1/auth/register ----
  app.post('/api/v1/auth/register', async (request: FastifyRequest, reply: FastifyReply) => {
    const { email, password, displayName } = request.body as {
      email?: string;
      password?: string;
      displayName?: string;
    };

    if (!email || !password) {
      return reply.status(400).send({ error: 'Email and password are required' });
    }

    try {
      const user = await createUser(email, password, displayName);
      const token = await createSession(user.id, request.ip, request.headers['user-agent']);

      reply.setCookie(COOKIE_NAME, token, getCookieOptions(config));

      return reply.status(201).send({
        user: {
          id: user.id,
          email: user.email,
          displayName: user.display_name,
          role: user.role,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Registration failed';
      const status = message.includes('already exists') ? 409 : 400;
      return reply.status(status).send({ error: message });
    }
  });

  // ---- POST /api/v1/auth/login ----
  app.post('/api/v1/auth/login', async (request: FastifyRequest, reply: FastifyReply) => {
    const { email, password } = request.body as {
      email?: string;
      password?: string;
    };

    if (!email || !password) {
      return reply.status(400).send({ error: 'Email and password are required' });
    }

    try {
      const user = await authenticateUser(email, password);
      const token = await createSession(user.id, request.ip, request.headers['user-agent']);

      reply.setCookie(COOKIE_NAME, token, getCookieOptions(config));

      return reply.send({
        user: {
          id: user.id,
          email: user.email,
          displayName: user.display_name,
          preferredName: user.preferred_name,
          role: user.role,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Login failed';
      const status = message.includes('locked') ? 423 : 401;
      return reply.status(status).send({ error: message });
    }
  });

  // ---- POST /api/v1/auth/logout ----
  app.post('/api/v1/auth/logout', async (request: FastifyRequest, reply: FastifyReply) => {
    const cookies = request.cookies as Record<string, string> | undefined;
    const token = cookies?.[COOKIE_NAME];

    if (token) {
      await revokeSession(token);
    }

    reply.clearCookie(COOKIE_NAME, { path: '/' });
    return reply.send({ ok: true });
  });

  // ---- GET /api/v1/auth/me ----
  app.get('/api/v1/auth/me', async (request: FastifyRequest, reply: FastifyReply) => {
    const cookies = request.cookies as Record<string, string> | undefined;
    const token = cookies?.[COOKIE_NAME];

    // Also support Bearer token
    let sessionToken = token;
    if (!sessionToken) {
      const authHeader = request.headers['authorization'];
      if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
        sessionToken = authHeader.slice(7);
      }
    }

    if (!sessionToken) {
      return reply.status(401).send({ error: 'Not authenticated' });
    }

    const result = await validateSession(sessionToken);
    if (!result) {
      reply.clearCookie(COOKIE_NAME, { path: '/' });
      return reply.status(401).send({ error: 'Invalid or expired session' });
    }

    return reply.send({
      user: {
        id: result.user.id,
        email: result.user.email,
        displayName: result.user.display_name,
        preferredName: result.user.preferred_name,
        role: result.user.role,
      },
    });
  });

  // ---- POST /api/v1/auth/forgot-password ----
  app.post('/api/v1/auth/forgot-password', async (request: FastifyRequest, reply: FastifyReply) => {
    const { email } = request.body as { email?: string };

    if (!email) {
      return reply.status(400).send({ error: 'Email is required' });
    }

    // Always return success to prevent email enumeration
    await requestPasswordReset(email);

    return reply.send({
      message: 'If an account with that email exists, a reset link has been generated.',
    });
  });

  // ---- POST /api/v1/auth/reset-password ----
  app.post('/api/v1/auth/reset-password', async (request: FastifyRequest, reply: FastifyReply) => {
    const { token, newPassword } = request.body as {
      token?: string;
      newPassword?: string;
    };

    if (!token || !newPassword) {
      return reply.status(400).send({ error: 'Token and new password are required' });
    }

    try {
      await resetPassword(token, newPassword);
      return reply.send({ message: 'Password has been reset. Please log in.' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Reset failed';
      return reply.status(400).send({ error: message });
    }
  });
}
