/**
 * Forge Authentication Routes
 * Core auth endpoints ported from API service — runs against substrate DB.
 * Supports registration, login, logout, session management, password reset.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ulid } from 'ulid';
import { createHash } from 'node:crypto';
import { substrateQuery, substrateQueryOne } from '../database.js';

// ============================================
// Types
// ============================================

interface CreateUserInput {
  email: string;
  password: string;
  display_name?: string;
  timezone?: string;
  tenant_name?: string;
}

// ============================================
// Cookie config
// ============================================

const SESSION_COOKIE_NAME = 'substrate_session';
const isProduction = process.env['NODE_ENV'] === 'production';
const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: isProduction,
  sameSite: (isProduction ? 'none' : 'lax') as 'lax' | 'none' | 'strict',
  path: '/',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
};

function getCookieDomain(host: string): string | undefined {
  if (!isProduction) return undefined;
  if (host.includes('askalf.org')) return '.askalf.org';
  return undefined;
}

// ============================================
// Helpers
// ============================================

let bcryptMod: typeof import('bcryptjs');

async function loadBcrypt() {
  if (!bcryptMod) {
    bcryptMod = await import('bcryptjs');
  }
  return bcryptMod;
}

async function hashPassword(password: string): Promise<string> {
  const bc = await loadBcrypt();
  return bc.hash(password, 12);
}

async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const bc = await loadBcrypt();
  return bc.compare(password, hash);
}

function validatePasswordStrength(password: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (password.length < 12) errors.push('Password must be at least 12 characters');
  if (!/[A-Z]/.test(password)) errors.push('Must contain at least one uppercase letter');
  if (!/[a-z]/.test(password)) errors.push('Must contain at least one lowercase letter');
  if (!/[0-9]/.test(password)) errors.push('Must contain at least one number');
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) errors.push('Must contain at least one special character');
  return { valid: errors.length === 0, errors };
}

function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

function generateSecureToken(length: number = 32): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => chars[byte % chars.length]).join('');
}

function generateSessionToken(): string {
  return `substrate_sess_${generateSecureToken(48)}`;
}

async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

function detectDeviceType(userAgent?: string): 'desktop' | 'mobile' | 'tablet' | null {
  if (!userAgent) return null;
  const ua = userAgent.toLowerCase();
  if (/tablet|ipad|playbook|silk/.test(ua)) return 'tablet';
  if (/mobile|iphone|ipod|android|blackberry|opera mini|opera mobi|webos|windows phone/.test(ua)) return 'mobile';
  return 'desktop';
}

// ============================================
// Routes
// ============================================

export async function authRoutes(app: FastifyInstance): Promise<void> {

  // ------------------------------------------
  // POST /api/v1/auth/register
  // ------------------------------------------
  app.post('/api/v1/auth/register', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as CreateUserInput;

    if (!body.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
      return reply.code(400).send({ error: 'Valid email is required' });
    }

    if (!body.password) {
      return reply.code(400).send({ error: 'Password is required' });
    }

    const passwordResult = validatePasswordStrength(body.password);
    if (!passwordResult.valid) {
      return reply.code(400).send({
        error: 'Password does not meet requirements',
        details: passwordResult.errors,
      });
    }

    const emailNormalized = normalizeEmail(body.email);

    const existing = await substrateQueryOne<{ id: string }>(
      'SELECT id FROM users WHERE email_normalized = $1',
      [emailNormalized],
    );
    if (existing) {
      return reply.code(409).send({ error: 'Email already registered' });
    }

    // Create tenant
    const tenantId = `tenant_${ulid()}`;
    const emailLocal = emailNormalized.split('@')[0] ?? 'user';
    const tenantSlug = emailLocal.replace(/[^a-z0-9]/g, '-') + '-' + ulid().slice(-6).toLowerCase();

    await substrateQuery(
      `INSERT INTO tenants (id, name, slug, type, tier, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'user', 'free', 'active', NOW(), NOW())`,
      [tenantId, body.tenant_name || body.display_name || emailLocal, tenantSlug],
    );

    // Create user
    const userId = `user_${ulid()}`;
    const passwordHash = await hashPassword(body.password);
    const verificationToken = generateSecureToken(32);
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await substrateQuery(
      `INSERT INTO users (
        id, tenant_id, email, email_normalized, password_hash,
        email_verification_token, email_verification_expires,
        display_name, timezone, status, role, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active', 'user', NOW(), NOW())`,
      [
        userId, tenantId, body.email, emailNormalized, passwordHash,
        verificationToken, verificationExpires,
        body.display_name ?? null, body.timezone ?? 'UTC',
      ],
    );

    // Create default free subscription
    await substrateQuery(
      `INSERT INTO subscriptions (id, tenant_id, plan_id, status, created_at, updated_at)
       VALUES ($1, $2, 'plan_free', 'active', NOW(), NOW())`,
      [`sub_${ulid()}`, tenantId],
    );

    // Audit log
    await substrateQuery(
      `INSERT INTO audit_logs (id, tenant_id, user_id, action, resource_type, resource_id, ip_address, user_agent, success, created_at)
       VALUES ($1, $2, $3, 'user.register', 'user', $3, $4, $5, true, NOW())`,
      [`audit_${ulid()}`, tenantId, userId, request.ip, request.headers['user-agent']],
    );

    console.log(`[Auth] New user registered: ${body.email} (${userId}), verification token generated`);

    return {
      success: true,
      user: { id: userId, email: body.email, tenant_id: tenantId },
      message: 'Registration successful. Please check your email to verify your account.',
    };
  });

  // ------------------------------------------
  // POST /api/v1/auth/login
  // ------------------------------------------
  app.post('/api/v1/auth/login', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { email: string; password: string };

    if (!body.email || !body.password) {
      return reply.code(400).send({ error: 'Email and password are required' });
    }

    const emailNormalized = normalizeEmail(body.email);

    const user = await substrateQueryOne<Record<string, unknown>>(
      'SELECT * FROM users WHERE email_normalized = $1',
      [emailNormalized],
    );

    if (!user) {
      return reply.code(401).send({ error: 'Invalid email or password' });
    }

    if (user['status'] !== 'active') {
      return reply.code(403).send({ error: 'Account is not active' });
    }

    // Check lockout
    if (user['locked_until'] && new Date(user['locked_until'] as string) > new Date()) {
      const remainingMinutes = Math.ceil(
        (new Date(user['locked_until'] as string).getTime() - Date.now()) / 60000,
      );
      return reply.code(429).send({
        error: `Account is locked. Try again in ${remainingMinutes} minutes`,
      });
    }

    const isValid = await verifyPassword(body.password, user['password_hash'] as string);

    if (!isValid) {
      const newAttempts = (user['failed_login_attempts'] as number) + 1;
      const lockUntil = newAttempts >= 5
        ? new Date(Date.now() + 15 * 60 * 1000)
        : null;

      await substrateQuery(
        `UPDATE users SET failed_login_attempts = $1, locked_until = $2, updated_at = NOW() WHERE id = $3`,
        [newAttempts, lockUntil, user['id']],
      );

      void substrateQuery(
        `INSERT INTO audit_logs (id, tenant_id, user_id, action, ip_address, user_agent, success, error_message, created_at)
         VALUES ($1, $2, $3, 'user.login', $4, $5, false, 'Invalid password', NOW())`,
        [`audit_${ulid()}`, user['tenant_id'], user['id'], request.ip, request.headers['user-agent']],
      ).catch(() => {});

      if (lockUntil) {
        return reply.code(429).send({ error: 'Too many failed attempts. Account locked for 15 minutes' });
      }
      return reply.code(401).send({ error: 'Invalid email or password' });
    }

    // Create session
    const sessionId = `sess_${ulid()}`;
    const sessionToken = generateSessionToken();
    const tokenHash = await hashToken(sessionToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const deviceType = detectDeviceType(request.headers['user-agent'] as string);

    await substrateQuery(
      `INSERT INTO sessions (id, user_id, token_hash, ip_address, user_agent, device_type, expires_at, last_active_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
      [sessionId, user['id'], tokenHash, request.ip, request.headers['user-agent'], deviceType, expiresAt],
    );

    // Reset failed attempts + update last login
    await substrateQuery(
      `UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login_at = NOW(), last_login_ip = $1, updated_at = NOW() WHERE id = $2`,
      [request.ip, user['id']],
    );

    void substrateQuery(
      `INSERT INTO audit_logs (id, tenant_id, user_id, action, ip_address, user_agent, success, created_at)
       VALUES ($1, $2, $3, 'user.login', $4, $5, true, NOW())`,
      [`audit_${ulid()}`, user['tenant_id'], user['id'], request.ip, request.headers['user-agent']],
    ).catch(() => {});

    // Set session cookie
    const host = request.headers.host || '';
    const cookieDomain = getCookieDomain(host);
    reply.setCookie(SESSION_COOKIE_NAME, sessionToken, {
      ...SESSION_COOKIE_OPTIONS,
      ...(cookieDomain ? { domain: cookieDomain } : {}),
    });

    return {
      success: true,
      user: {
        id: user['id'],
        email: user['email'],
        email_verified: user['email_verified'],
        display_name: user['display_name'],
        role: user['role'],
        tenant_id: user['tenant_id'],
      },
    };
  });

  // ------------------------------------------
  // POST /api/v1/auth/logout
  // ------------------------------------------
  app.post('/api/v1/auth/logout', async (request: FastifyRequest, reply: FastifyReply) => {
    const cookies = request.cookies as Record<string, string> | undefined;
    const sessionToken = cookies?.[SESSION_COOKIE_NAME];

    if (sessionToken) {
      const tokenHash = await hashToken(sessionToken);
      await substrateQuery(
        `UPDATE sessions SET revoked = true, revoked_at = NOW(), revoked_reason = 'logout' WHERE token_hash = $1`,
        [tokenHash],
      );
    }

    const host = request.headers.host || '';
    const cookieDomain = getCookieDomain(host);
    reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    if (cookieDomain) {
      reply.clearCookie(SESSION_COOKIE_NAME, { path: '/', domain: cookieDomain });
    }

    return { success: true, message: 'Logged out successfully' };
  });

  // ------------------------------------------
  // GET /api/v1/auth/me
  // ------------------------------------------
  app.get('/api/v1/auth/me', async (request: FastifyRequest, reply: FastifyReply) => {
    const cookies = request.cookies as Record<string, string> | undefined;
    const sessionToken = cookies?.[SESSION_COOKIE_NAME];

    if (!sessionToken) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const tokenHash = await hashToken(sessionToken);

    const session = await substrateQueryOne<Record<string, unknown>>(
      `SELECT s.*, u.id as user_id, u.email, u.email_verified, u.display_name, u.avatar_url, u.role, u.tenant_id, u.timezone,
              p.name as plan_name, p.display_name as plan_display_name, t.tier as tenant_tier
       FROM sessions s
       JOIN users u ON s.user_id = u.id
       JOIN tenants t ON u.tenant_id = t.id
       LEFT JOIN subscriptions sub ON u.tenant_id = sub.tenant_id AND sub.status = 'active'
       LEFT JOIN plans p ON sub.plan_id = p.id
       WHERE s.token_hash = $1 AND s.expires_at > NOW() AND s.revoked = false AND u.status = 'active'`,
      [tokenHash],
    );

    if (!session) {
      const host = request.headers.host || '';
      const cookieDomain = getCookieDomain(host);
      reply.clearCookie(SESSION_COOKIE_NAME, {
        path: '/',
        ...(cookieDomain ? { domain: cookieDomain } : {}),
      });
      return reply.code(401).send({ error: 'Session expired or invalid' });
    }

    // Update last active (fire-and-forget)
    void substrateQuery(
      'UPDATE sessions SET last_active_at = NOW() WHERE id = $1',
      [session['id']],
    ).catch(() => {});

    const plan = session['plan_name'] || session['tenant_tier'] || 'free';

    return {
      user: {
        id: session['user_id'],
        email: session['email'],
        emailVerified: session['email_verified'],
        displayName: session['display_name'],
        avatarUrl: session['avatar_url'],
        role: session['role'],
        tenantId: session['tenant_id'],
        timezone: session['timezone'],
        plan: plan,
        planDisplayName: session['plan_display_name'] || (plan === 'free' ? 'Free Starter' : plan),
      },
      session: {
        id: session['id'],
        createdAt: session['created_at'],
        expiresAt: session['expires_at'],
        deviceType: session['device_type'],
      },
    };
  });

  // ------------------------------------------
  // POST /api/v1/auth/verify-email
  // ------------------------------------------
  app.post('/api/v1/auth/verify-email', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { token: string };

    if (!body.token) {
      return reply.code(400).send({ error: 'Token is required' });
    }

    const result = await substrateQuery<{ id: string; email: string; display_name: string | null }>(
      `UPDATE users
       SET email_verified = true, email_verification_token = NULL, email_verification_expires = NULL, updated_at = NOW()
       WHERE email_verification_token = $1 AND email_verification_expires > NOW() AND status = 'active'
       RETURNING id, email, display_name`,
      [body.token],
    );

    if (result.length === 0) {
      return reply.code(400).send({ error: 'Invalid or expired verification token' });
    }

    console.log(`[Auth] Email verified for user ${result[0]!.email}`);

    return { success: true, message: 'Email verified successfully' };
  });

  // ------------------------------------------
  // POST /api/v1/auth/resend-verification
  // ------------------------------------------
  app.post('/api/v1/auth/resend-verification', async (request: FastifyRequest, reply: FastifyReply) => {
    const cookies = request.cookies as Record<string, string> | undefined;
    const sessionToken = cookies?.[SESSION_COOKIE_NAME];

    if (!sessionToken) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const tokenHash = await hashToken(sessionToken);
    const session = await substrateQueryOne<{ user_id: string }>(
      'SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > NOW() AND revoked = false',
      [tokenHash],
    );

    if (!session) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const newToken = generateSecureToken(32);
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const result = await substrateQuery<{ id: string }>(
      `UPDATE users
       SET email_verification_token = $1, email_verification_expires = $2, updated_at = NOW()
       WHERE id = $3 AND email_verified = false AND status = 'active'
       RETURNING id`,
      [newToken, expires, session.user_id],
    );

    if (result.length === 0) {
      return reply.code(400).send({ error: 'Email already verified or account not active' });
    }

    console.log(`[Auth] Verification token regenerated for user ${session.user_id}`);

    return { success: true, message: 'Verification email sent' };
  });

  // ------------------------------------------
  // POST /api/v1/auth/forgot-password
  // ------------------------------------------
  app.post('/api/v1/auth/forgot-password', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { email: string };

    if (!body.email) {
      return reply.code(400).send({ error: 'Email is required' });
    }

    const emailNormalized = normalizeEmail(body.email);
    const user = await substrateQueryOne<{ id: string; tenant_id: string }>(
      'SELECT id, tenant_id FROM users WHERE email_normalized = $1 AND status = $2',
      [emailNormalized, 'active'],
    );

    // Always return success to prevent email enumeration
    if (!user) {
      return { success: true, message: 'If the email exists, a reset link has been sent' };
    }

    const token = generateSecureToken(32);
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await substrateQuery(
      `UPDATE users SET password_reset_token = $1, password_reset_expires = $2, updated_at = NOW() WHERE id = $3`,
      [token, expires, user.id],
    );

    void substrateQuery(
      `INSERT INTO audit_logs (id, tenant_id, user_id, action, ip_address, success, created_at)
       VALUES ($1, $2, $3, 'user.password_reset_request', $4, true, NOW())`,
      [`audit_${ulid()}`, user.tenant_id, user.id, request.ip],
    ).catch(() => {});

    console.log(`[Auth] Password reset requested for ${body.email}, token: ${token.slice(0, 8)}...`);

    return { success: true, message: 'If the email exists, a reset link has been sent' };
  });

  // ------------------------------------------
  // POST /api/v1/auth/reset-password
  // ------------------------------------------
  app.post('/api/v1/auth/reset-password', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { token: string; password: string };

    if (!body.token || !body.password) {
      return reply.code(400).send({ error: 'Token and password are required' });
    }

    const passwordResult = validatePasswordStrength(body.password);
    if (!passwordResult.valid) {
      return reply.code(400).send({
        error: 'Password does not meet requirements',
        details: passwordResult.errors,
      });
    }

    const passwordHash = await hashPassword(body.password);

    const result = await substrateQuery<{ id: string; tenant_id: string }>(
      `UPDATE users
       SET password_hash = $1, password_reset_token = NULL, password_reset_expires = NULL,
           failed_login_attempts = 0, locked_until = NULL, updated_at = NOW()
       WHERE password_reset_token = $2 AND password_reset_expires > NOW() AND status = 'active'
       RETURNING id, tenant_id`,
      [passwordHash, body.token],
    );

    const user = result[0];
    if (!user) {
      return reply.code(400).send({ error: 'Invalid or expired reset token' });
    }

    // Revoke all sessions
    await substrateQuery(
      `UPDATE sessions SET revoked = true, revoked_at = NOW(), revoked_reason = 'password_reset' WHERE user_id = $1`,
      [user.id],
    );

    void substrateQuery(
      `INSERT INTO audit_logs (id, tenant_id, user_id, action, ip_address, success, created_at)
       VALUES ($1, $2, $3, 'user.password_reset', $4, true, NOW())`,
      [`audit_${ulid()}`, user.tenant_id, user.id, request.ip],
    ).catch(() => {});

    return { success: true, message: 'Password reset successfully. Please login with your new password.' };
  });

  // ------------------------------------------
  // POST /api/v1/auth/change-password
  // ------------------------------------------
  app.post('/api/v1/auth/change-password', async (request: FastifyRequest, reply: FastifyReply) => {
    const cookies = request.cookies as Record<string, string> | undefined;
    const sessionToken = cookies?.[SESSION_COOKIE_NAME];

    if (!sessionToken) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const body = request.body as { current_password: string; new_password: string };
    if (!body.current_password || !body.new_password) {
      return reply.code(400).send({ error: 'Current and new password are required' });
    }

    const tokenHash = await hashToken(sessionToken);
    const session = await substrateQueryOne<{ user_id: string }>(
      'SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > NOW() AND revoked = false',
      [tokenHash],
    );

    if (!session) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const user = await substrateQueryOne<{ password_hash: string; tenant_id: string }>(
      'SELECT password_hash, tenant_id FROM users WHERE id = $1',
      [session.user_id],
    );

    if (!user) {
      return reply.code(401).send({ error: 'User not found' });
    }

    const isValid = await verifyPassword(body.current_password, user.password_hash);
    if (!isValid) {
      return reply.code(401).send({ error: 'Current password is incorrect' });
    }

    const passwordResult = validatePasswordStrength(body.new_password);
    if (!passwordResult.valid) {
      return reply.code(400).send({
        error: 'New password does not meet requirements',
        details: passwordResult.errors,
      });
    }

    const passwordHash = await hashPassword(body.new_password);
    await substrateQuery(
      'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
      [passwordHash, session.user_id],
    );

    void substrateQuery(
      `INSERT INTO audit_logs (id, tenant_id, user_id, action, ip_address, success, created_at)
       VALUES ($1, $2, $3, 'user.password_change', $4, true, NOW())`,
      [`audit_${ulid()}`, user.tenant_id, session.user_id, request.ip],
    ).catch(() => {});

    return { success: true, message: 'Password changed successfully' };
  });

  // ------------------------------------------
  // GET /api/v1/auth/sessions
  // ------------------------------------------
  app.get('/api/v1/auth/sessions', async (request: FastifyRequest, reply: FastifyReply) => {
    const cookies = request.cookies as Record<string, string> | undefined;
    const sessionToken = cookies?.[SESSION_COOKIE_NAME];

    if (!sessionToken) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const tokenHash = await hashToken(sessionToken);
    const session = await substrateQueryOne<{ user_id: string; id: string }>(
      'SELECT user_id, id FROM sessions WHERE token_hash = $1 AND expires_at > NOW() AND revoked = false',
      [tokenHash],
    );

    if (!session) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const sessions = await substrateQuery<{
      id: string;
      ip_address: string;
      user_agent: string;
      device_type: string;
      created_at: string;
      last_active_at: string;
    }>(
      `SELECT id, ip_address, user_agent, device_type, created_at, last_active_at
       FROM sessions
       WHERE user_id = $1 AND revoked = false AND expires_at > NOW()
       ORDER BY last_active_at DESC`,
      [session.user_id],
    );

    return {
      sessions: sessions.map((s) => ({
        ...s,
        is_current: s.id === session.id,
      })),
    };
  });

  // ------------------------------------------
  // DELETE /api/v1/auth/sessions/:sessionId
  // ------------------------------------------
  app.delete('/api/v1/auth/sessions/:sessionId', async (request: FastifyRequest, reply: FastifyReply) => {
    const cookies = request.cookies as Record<string, string> | undefined;
    const sessionToken = cookies?.[SESSION_COOKIE_NAME];
    const { sessionId } = request.params as { sessionId: string };

    if (!sessionToken) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const tokenHash = await hashToken(sessionToken);
    const session = await substrateQueryOne<{ user_id: string; id: string }>(
      'SELECT user_id, id FROM sessions WHERE token_hash = $1 AND expires_at > NOW() AND revoked = false',
      [tokenHash],
    );

    if (!session) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    if (sessionId === session.id) {
      return reply.code(400).send({ error: 'Cannot revoke current session. Use logout instead.' });
    }

    const result = await substrateQuery<{ id: string }>(
      `UPDATE sessions SET revoked = true, revoked_at = NOW(), revoked_reason = 'manual_revoke'
       WHERE id = $1 AND user_id = $2 AND revoked = false
       RETURNING id`,
      [sessionId, session.user_id],
    );

    if (result.length === 0) {
      return reply.code(404).send({ error: 'Session not found' });
    }

    return { success: true, message: 'Session revoked' };
  });

  // ------------------------------------------
  // POST /api/v1/auth/sessions/revoke-others
  // ------------------------------------------
  app.post('/api/v1/auth/sessions/revoke-others', async (request: FastifyRequest, reply: FastifyReply) => {
    const cookies = request.cookies as Record<string, string> | undefined;
    const sessionToken = cookies?.[SESSION_COOKIE_NAME];

    if (!sessionToken) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const tokenHash = await hashToken(sessionToken);
    const session = await substrateQueryOne<{ user_id: string; id: string }>(
      'SELECT user_id, id FROM sessions WHERE token_hash = $1 AND expires_at > NOW() AND revoked = false',
      [tokenHash],
    );

    if (!session) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const result = await substrateQuery<{ id: string }>(
      `UPDATE sessions SET revoked = true, revoked_at = NOW(), revoked_reason = 'revoke_all_others'
       WHERE user_id = $1 AND id != $2 AND revoked = false
       RETURNING id`,
      [session.user_id, session.id],
    );

    return {
      success: true,
      message: `${result.length} other session(s) revoked`,
      count: result.length,
    };
  });
}
