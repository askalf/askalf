/**
 * SUBSTRATE v1: Authentication Routes
 *
 * API endpoints for user registration, login, sessions, and password management.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ulid } from 'ulid';
import { createHash } from 'crypto';
import { query, queryOne } from '@substrate/database';
import {
  sendWelcomeEmail,
  sendPasswordResetEmail,
  sendEmailVerificationEmail,
  sendAdminNotification,
} from '@substrate/email';
import { DISPOSABLE_EMAIL_DOMAINS, checkSignupCooldown } from '../middleware/security.js';

// Types from auth package (inline for now until package is built)
interface CreateUserInput {
  email: string;
  password: string;
  display_name?: string;
  timezone?: string;
}

interface SafeUser {
  id: string;
  tenant_id: string;
  email: string;
  email_normalized: string;
  email_verified: boolean;
  email_verification_expires: Date | null;
  status: 'active' | 'suspended' | 'deleted';
  role: 'user' | 'admin' | 'super_admin';
  display_name: string | null;
  avatar_url: string | null;
  timezone: string;
  failed_login_attempts: number;
  locked_until: Date | null;
  last_login_at: Date | null;
  last_login_ip: string | null;
  created_at: Date;
  updated_at: Date;
}

interface Session {
  id: string;
  user_id: string;
  token_hash: string;
  ip_address: string | null;
  user_agent: string | null;
  device_type: 'desktop' | 'mobile' | 'tablet' | null;
  expires_at: Date;
  last_active_at: Date;
  revoked: boolean;
  revoked_at: Date | null;
  revoked_reason: string | null;
  created_at: Date;
}

// Cookie settings
const SESSION_COOKIE_NAME = 'substrate_session';
const isProduction = process.env['NODE_ENV'] === 'production';
const SESSION_COOKIE_OPTIONS: {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'lax' | 'none' | 'strict';
  path: string;
  domain?: string;
  maxAge: number;
} = {
  httpOnly: true,
  secure: isProduction,
  sameSite: isProduction ? 'none' : 'lax', // 'none' required for cross-origin cookies in production
  path: '/',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
};
// Share cookie across subdomains in production
function getCookieDomain(host: string): string | undefined {
  if (!isProduction) return undefined;
  if (host.includes('askalf.org')) return '.askalf.org';
  return undefined;
}

// Import bcrypt dynamically
let bcrypt: typeof import('bcrypt');

// Helper functions (will be replaced by @substrate/auth when built)

async function loadBcrypt() {
  if (!bcrypt) {
    bcrypt = await import('bcrypt');
  }
  return bcrypt;
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

  if (password.length < 12) {
    errors.push('Password must be at least 12 characters');
  }
  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }
  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }
  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    errors.push('Password must contain at least one special character');
  }

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

// API Key encryption for secure storage
const ENCRYPTION_KEY = (() => {
  const key = process.env['API_KEY_ENCRYPTION_KEY'] || process.env['JWT_SECRET'];
  if (!key && process.env['NODE_ENV'] === 'production') {
    throw new Error('API_KEY_ENCRYPTION_KEY or JWT_SECRET must be set in production');
  }
  return key || 'dev-only-key-not-for-production';
})();

async function getEncryptionKey() {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(ENCRYPTION_KEY),
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: encoder.encode('substrate-api-key-salt'), iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptApiKey(apiKey: string): Promise<string> {
  const key = await getEncryptionKey();
  const encoder = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(apiKey)
  );
  // Combine IV + encrypted data and encode as base64
  const combined = new Uint8Array(iv.length + new Uint8Array(encrypted).length);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);
  return Buffer.from(combined).toString('base64');
}

async function decryptApiKey(encryptedKey: string): Promise<string> {
  const key = await getEncryptionKey();
  const combined = Buffer.from(encryptedKey, 'base64');
  const iv = combined.subarray(0, 12);
  const encrypted = combined.subarray(12);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    encrypted
  );
  return new TextDecoder().decode(decrypted);
}

function detectDeviceType(userAgent?: string): 'desktop' | 'mobile' | 'tablet' | null {
  if (!userAgent) return null;
  const ua = userAgent.toLowerCase();
  if (/tablet|ipad|playbook|silk/.test(ua)) return 'tablet';
  if (/mobile|iphone|ipod|android|blackberry|opera mini|opera mobi|webos|windows phone/.test(ua)) return 'mobile';
  return 'desktop';
}

// Extend request type
interface AuthenticatedRequest extends FastifyRequest {
  user?: SafeUser;
  session?: Session;
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // Cookie plugin is registered in main index.ts

  // ============================================
  // CSRF TOKEN ENDPOINT
  // ============================================

  /**
   * Get CSRF token for form submission
   * Must be called before making state-changing requests (POST, PUT, DELETE)
   * The token should be included as X-CSRF-Token header or _csrf body field
   */
  app.get('/api/v1/auth/csrf-token', async (request, reply) => {
    // Generate CSRF token using @fastify/csrf-protection
    const token = await (reply as FastifyReply & { generateCsrf: () => Promise<string> }).generateCsrf();

    return {
      token,
      // Include usage instructions
      usage: {
        header: 'X-CSRF-Token',
        body: '_csrf',
        expires: '1 hour (regenerate on page load)',
      },
    };
  });

  // ============================================
  // PUBLIC: Registration & Login
  // ============================================

  /**
   * Register a new user
   * Creates both a user and their personal tenant
   */
  app.post('/api/v1/auth/register', async (request, reply) => {
    const body = request.body as CreateUserInput & { tenant_name?: string };

    // Validate email
    if (!body.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
      return reply.code(400).send({ error: 'Valid email is required' });
    }

    // Block disposable email domains
    const emailDomain = body.email.toLowerCase().split('@')[1];
    if (emailDomain && DISPOSABLE_EMAIL_DOMAINS.has(emailDomain)) {
      return reply.code(400).send({ error: 'Please use a permanent email address' });
    }

    // Per-IP signup cooldown (3 accounts per IP per hour)
    const cooldownCheck = checkSignupCooldown(request.ip ?? 'unknown');
    if (!cooldownCheck.allowed) {
      const retryAfterSec = Math.ceil(cooldownCheck.retryAfterMs / 1000);
      reply.header('Retry-After', retryAfterSec);
      return reply.code(429).send({
        error: 'Too many accounts created from this address. Please try again later.',
        retryAfter: retryAfterSec,
      });
    }

    // Validate password
    const passwordResult = validatePasswordStrength(body.password);
    if (!passwordResult.valid) {
      return reply.code(400).send({
        error: 'Password does not meet requirements',
        details: passwordResult.errors,
      });
    }

    const emailNormalized = normalizeEmail(body.email);

    // Check if email already exists
    const existingUser = await queryOne(
      'SELECT id FROM users WHERE email_normalized = $1',
      [emailNormalized]
    );

    if (existingUser) {
      return reply.code(409).send({ error: 'Email already registered' });
    }

    // Create tenant for user
    const tenantId = `tenant_${ulid()}`;
    const emailLocal = emailNormalized.split('@')[0] ?? 'user';
    const tenantSlug = emailLocal.replace(/[^a-z0-9]/g, '-') + '-' + ulid().slice(-6).toLowerCase();

    await query(
      `INSERT INTO tenants (id, name, slug, type, tier, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'user', 'free', 'active', NOW(), NOW())`,
      [tenantId, body.tenant_name || body.display_name || emailLocal, tenantSlug]
    );

    // Create user
    const userId = `user_${ulid()}`;
    const passwordHash = await hashPassword(body.password);
    const verificationToken = generateSecureToken(32);
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    await query(
      `INSERT INTO users (
        id, tenant_id, email, email_normalized, password_hash,
        email_verification_token, email_verification_expires,
        display_name, timezone, status, role, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active', 'user', NOW(), NOW())`,
      [
        userId,
        tenantId,
        body.email,
        emailNormalized,
        passwordHash,
        verificationToken,
        verificationExpires,
        body.display_name ?? null,
        body.timezone ?? 'UTC',
      ]
    );

    // Create default subscription on free plan
    await query(
      `INSERT INTO subscriptions (id, tenant_id, plan_id, status, created_at, updated_at)
       VALUES ($1, $2, 'plan_free', 'active', NOW(), NOW())`,
      [`sub_${ulid()}`, tenantId]
    );

    // Create audit log
    await query(
      `INSERT INTO audit_logs (id, tenant_id, user_id, action, resource_type, resource_id, ip_address, user_agent, success, created_at)
       VALUES ($1, $2, $3, 'user.register', 'user', $3, $4, $5, true, NOW())`,
      [`audit_${ulid()}`, tenantId, userId, request.ip, request.headers['user-agent']]
    );

    // Create seed shard for new account - a simple greeting shard
    const { ids } = await import('@substrate/core');
    const seedShardId = ids.shard();
    await query(
      `INSERT INTO procedural_shards (
        id, owner_id, name, logic,
        input_schema, output_schema, patterns, confidence, lifecycle, visibility,
        execution_count, success_count, failure_count, avg_latency_ms,
        synthesis_method, category, created_at, updated_at
      ) VALUES (
        $1, $2, 'Personal Greeting',
        $3,
        '{"type":"object","properties":{"input":{"type":"string"}}}',
        '{"type":"object","properties":{"output":{"type":"string"}}}',
        '["greeting", "hello", "hi", "hey"]',
        0.9, 'promoted', 'private',
        0, 0, 0, 0,
        'seed', 'personal', NOW(), NOW()
      )`,
      [
        seedShardId,
        tenantId,
        `// Your first procedural shard!
// This pattern is now crystallized in your memory.
const greetings = ['Hello!', 'Hey there!', 'Hi!', 'Greetings!'];
const greeting = greetings[Math.floor(Math.random() * greetings.length)];
return greeting + ' Welcome to SUBSTRATE. This is your personal cognitive memory space.';`
      ]
    );

    // Create seed trace - initializes their private reasoning session
    const seedTraceId = `trace_${ulid()}`;
    const seedPatternHash = createHash('sha256')
      .update('session_initialization')
      .digest('hex')
      .slice(0, 64);
    await query(
      `INSERT INTO reasoning_traces (
        id, input, reasoning, output, pattern_hash,
        tokens_used, execution_ms, model,
        intent_category, intent_name, intent_confidence,
        owner_id, visibility, source, timestamp
      ) VALUES (
        $1, $2, $3, $4, $5,
        150, 0, 'seed',
        'session', 'initialization', 1.0,
        $6, 'private', 'registration', NOW()
      )`,
      [
        seedTraceId,
        'Initialize my SUBSTRATE cognitive session',
        'Setting up personal memory space with initial shard and trace for new user registration.',
        `Session initialized. Welcome to SUBSTRATE - your perpetual cognitive continuity system.
Your personal memory space is ready. Start by exploring the dashboard or creating your first shard.`,
        seedPatternHash,
        tenantId
      ]
    );

    // Send verification email only at registration — welcome email is sent after verification
    const dashboardUrl = process.env['DASHBOARD_URL'] ?? 'https://app.askalf.org';
    sendEmailVerificationEmail(body.email, {
      userName: body.display_name ?? body.email.split('@')[0] ?? 'there',
      verifyUrl: `${dashboardUrl}/verify-email?token=${verificationToken}`,
      expiresInHours: 24,
    }).catch((err) => {
      console.error('Failed to send verification email:', err);
    });

    // Notify admin of new user registration
    const adminEmail = process.env['ADMIN_EMAIL'];
    if (adminEmail) {
      sendAdminNotification(adminEmail, {
        type: 'new_user',
        email: body.email.toLowerCase(),
        timestamp: new Date().toISOString(),
      }).catch((err) => {
        console.error('Failed to send admin notification for new registration:', err);
      });
    }

    return {
      success: true,
      user: {
        id: userId,
        email: body.email,
        tenant_id: tenantId,
      },
      message: 'Registration successful. Please check your email to verify your account.',
    };
  });

  /**
   * Login with email and password
   */
  app.post('/api/v1/auth/login', async (request, reply) => {
    const body = request.body as { email: string; password: string };

    if (!body.email || !body.password) {
      return reply.code(400).send({ error: 'Email and password are required' });
    }

    const emailNormalized = normalizeEmail(body.email);

    // Get user
    const user = await queryOne<Record<string, unknown>>(
      'SELECT * FROM users WHERE email_normalized = $1',
      [emailNormalized]
    );

    if (!user) {
      return reply.code(401).send({ error: 'Invalid email or password' });
    }

    // Check account status
    if (user['status'] !== 'active') {
      return reply.code(403).send({ error: 'Account is not active' });
    }

    // Check account lockout
    if (user['locked_until'] && new Date(user['locked_until'] as string) > new Date()) {
      const remainingMinutes = Math.ceil(
        (new Date(user['locked_until'] as string).getTime() - Date.now()) / 60000
      );
      return reply.code(429).send({
        error: `Account is locked. Try again in ${remainingMinutes} minutes`,
      });
    }

    // Verify password
    const isValid = await verifyPassword(body.password, user['password_hash'] as string);

    if (!isValid) {
      // Increment failed attempts
      const newAttempts = (user['failed_login_attempts'] as number) + 1;
      const lockUntil = newAttempts >= 5
        ? new Date(Date.now() + 15 * 60 * 1000) // 15 minutes
        : null;

      await query(
        `UPDATE users SET failed_login_attempts = $1, locked_until = $2, updated_at = NOW() WHERE id = $3`,
        [newAttempts, lockUntil, user['id']]
      );

      // Audit log
      await query(
        `INSERT INTO audit_logs (id, tenant_id, user_id, action, ip_address, user_agent, success, error_message, created_at)
         VALUES ($1, $2, $3, 'user.login', $4, $5, false, 'Invalid password', NOW())`,
        [`audit_${ulid()}`, user['tenant_id'], user['id'], request.ip, request.headers['user-agent']]
      );

      if (lockUntil) {
        return reply.code(429).send({
          error: 'Too many failed attempts. Account locked for 15 minutes',
        });
      }

      return reply.code(401).send({ error: 'Invalid email or password' });
    }

    // Successful login - create session
    const sessionId = `sess_${ulid()}`;
    const sessionToken = generateSessionToken();
    const tokenHash = await hashToken(sessionToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    const deviceType = detectDeviceType(request.headers['user-agent'] as string);

    await query(
      `INSERT INTO sessions (id, user_id, token_hash, ip_address, user_agent, device_type, expires_at, last_active_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
      [sessionId, user['id'], tokenHash, request.ip, request.headers['user-agent'], deviceType, expiresAt]
    );

    // Reset failed attempts and update last login
    await query(
      `UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login_at = NOW(), last_login_ip = $1, updated_at = NOW() WHERE id = $2`,
      [request.ip, user['id']]
    );

    // Audit log
    await query(
      `INSERT INTO audit_logs (id, tenant_id, user_id, action, ip_address, user_agent, success, created_at)
       VALUES ($1, $2, $3, 'user.login', $4, $5, true, NOW())`,
      [`audit_${ulid()}`, user['tenant_id'], user['id'], request.ip, request.headers['user-agent']]
    );

    // Set session cookie with proper domain for cross-subdomain access
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

  /**
   * Logout - revoke current session
   */
  app.post('/api/v1/auth/logout', async (request, reply) => {
    const cookies = request.cookies as Record<string, string> | undefined;
    const sessionToken = cookies?.[SESSION_COOKIE_NAME];

    if (sessionToken) {
      const tokenHash = await hashToken(sessionToken);
      await query(
        `UPDATE sessions SET revoked = true, revoked_at = NOW(), revoked_reason = 'logout' WHERE token_hash = $1`,
        [tokenHash]
      );
    }

    // Clear cookie - clear both with and without domain to handle legacy cookies
    const host = request.headers.host || '';
    const cookieDomain = getCookieDomain(host);

    // Clear cookie without domain (legacy cookies)
    reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' });

    // Clear cookie with domain (new cookies)
    if (cookieDomain) {
      reply.clearCookie(SESSION_COOKIE_NAME, { path: '/', domain: cookieDomain });
    }

    return { success: true, message: 'Logged out successfully' };
  });

  /**
   * Get current user (requires session)
   */
  app.get('/api/v1/auth/me', async (request, reply) => {
    const cookies = request.cookies as Record<string, string> | undefined;
    const sessionToken = cookies?.[SESSION_COOKIE_NAME];

    if (!sessionToken) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const tokenHash = await hashToken(sessionToken);

    // Get session, user, subscription/plan info, and ALF profile
    const session = await queryOne<Record<string, unknown>>(
      `SELECT s.*, u.id as user_id, u.email, u.email_verified, u.display_name, u.avatar_url, u.role, u.tenant_id, u.timezone,
              p.name as plan_name, p.display_name as plan_display_name, t.tier as tenant_tier,
              ap.preferred_name as alf_preferred_name
       FROM sessions s
       JOIN users u ON s.user_id = u.id
       JOIN tenants t ON u.tenant_id = t.id
       LEFT JOIN subscriptions sub ON u.tenant_id = sub.tenant_id AND sub.status = 'active'
       LEFT JOIN plans p ON sub.plan_id = p.id
       LEFT JOIN alf_profiles ap ON u.tenant_id = ap.tenant_id
       WHERE s.token_hash = $1 AND s.expires_at > NOW() AND s.revoked = false AND u.status = 'active'`,
      [tokenHash]
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

    // Update last active
    await query(
      'UPDATE sessions SET last_active_at = NOW() WHERE id = $1',
      [session['id']]
    );

    // Determine plan - from subscription or fallback to tenant tier or 'free'
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
        preferredName: session['alf_preferred_name'] || null,
      },
      session: {
        id: session['id'],
        createdAt: session['created_at'],
        expiresAt: session['expires_at'],
        deviceType: session['device_type'],
      },
    };
  });

  // ============================================
  // EMAIL VERIFICATION
  // ============================================

  /**
   * Verify email with token
   */
  app.post('/api/v1/auth/verify-email', async (request, reply) => {
    const body = request.body as { token: string };

    if (!body.token) {
      return reply.code(400).send({ error: 'Token is required' });
    }

    const result = await query<{ id: string; email: string; display_name: string | null }>(
      `UPDATE users
       SET email_verified = true, email_verification_token = NULL, email_verification_expires = NULL, updated_at = NOW()
       WHERE email_verification_token = $1 AND email_verification_expires > NOW() AND status = 'active'
       RETURNING id, email, display_name`,
      [body.token]
    );

    if (result.length === 0) {
      return reply.code(400).send({ error: 'Invalid or expired verification token' });
    }

    // Send welcome email now that email is verified
    const verifiedUser = result[0]!;
    const websiteUrl = process.env['APP_URL'] ?? 'https://askalf.org';
    const dashboardUrl = process.env['DASHBOARD_URL'] ?? 'https://app.askalf.org';
    sendWelcomeEmail(verifiedUser.email, {
      userName: verifiedUser.display_name ?? verifiedUser.email.split('@')[0] ?? 'there',
      planName: 'Free',
      dashboardUrl: dashboardUrl,
      docsUrl: `${websiteUrl}/docs.html`,
    }).catch((err) => {
      console.error('Failed to send welcome email:', err);
    });

    return { success: true, message: 'Email verified successfully' };
  });

  /**
   * Resend verification email
   */
  app.post('/api/v1/auth/resend-verification', async (request, reply) => {
    const cookies = request.cookies as Record<string, string> | undefined;
    const sessionToken = cookies?.[SESSION_COOKIE_NAME];

    if (!sessionToken) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const tokenHash = await hashToken(sessionToken);
    const session = await queryOne<{ user_id: string }>(
      'SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > NOW() AND revoked = false',
      [tokenHash]
    );

    if (!session) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const newToken = generateSecureToken(32);
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const result = await query<{ id: string }>(
      `UPDATE users
       SET email_verification_token = $1, email_verification_expires = $2, updated_at = NOW()
       WHERE id = $3 AND email_verified = false AND status = 'active'
       RETURNING id`,
      [newToken, expires, session.user_id]
    );

    if (result.length === 0) {
      return reply.code(400).send({ error: 'Email already verified or account not active' });
    }

    // Get user info for email
    const user = await queryOne<{ email: string; display_name: string | null }>(
      'SELECT email, display_name FROM users WHERE id = $1',
      [session.user_id]
    );

    // Send verification email (non-blocking)
    if (user) {
      const dashUrl = process.env['DASHBOARD_URL'] ?? 'https://app.askalf.org';
      sendEmailVerificationEmail(user.email, {
        userName: user.display_name ?? user.email.split('@')[0] ?? 'there',
        verifyUrl: `${dashUrl}/verify-email?token=${newToken}`,
        expiresInHours: 24,
      }).catch((err) => {
        console.error('Failed to send verification email:', err);
      });
    }

    return { success: true, message: 'Verification email sent' };
  });

  // ============================================
  // PASSWORD MANAGEMENT
  // ============================================

  /**
   * Request password reset
   */
  app.post('/api/v1/auth/forgot-password', async (request, reply) => {
    const body = request.body as { email: string };

    if (!body.email) {
      return reply.code(400).send({ error: 'Email is required' });
    }

    const emailNormalized = normalizeEmail(body.email);
    const user = await queryOne<{ id: string; tenant_id: string }>(
      'SELECT id, tenant_id FROM users WHERE email_normalized = $1 AND status = $2',
      [emailNormalized, 'active']
    );

    // Always return success to prevent email enumeration
    if (!user) {
      return { success: true, message: 'If the email exists, a reset link has been sent' };
    }

    const token = generateSecureToken(32);
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await query(
      `UPDATE users SET password_reset_token = $1, password_reset_expires = $2, updated_at = NOW() WHERE id = $3`,
      [token, expires, user.id]
    );

    // Audit log
    await query(
      `INSERT INTO audit_logs (id, tenant_id, user_id, action, ip_address, success, created_at)
       VALUES ($1, $2, $3, 'user.password_reset_request', $4, true, NOW())`,
      [`audit_${ulid()}`, user.tenant_id, user.id, request.ip]
    );

    // Get user display name for email
    const userData = await queryOne<{ display_name: string | null }>(
      'SELECT display_name FROM users WHERE id = $1',
      [user.id]
    );

    // Send password reset email (non-blocking)
    const baseUrl = process.env['APP_URL'] ?? 'http://localhost:3000';
    sendPasswordResetEmail(body.email, {
      userName: userData?.display_name ?? body.email.split('@')[0] ?? 'there',
      resetUrl: `${baseUrl}/reset-password?token=${token}`,
      expiresInMinutes: 60,
    }).catch((err) => {
      console.error('Failed to send password reset email:', err);
    });

    return { success: true, message: 'If the email exists, a reset link has been sent' };
  });

  /**
   * Reset password with token
   */
  app.post('/api/v1/auth/reset-password', async (request, reply) => {
    const body = request.body as { token: string; password: string };

    if (!body.token || !body.password) {
      return reply.code(400).send({ error: 'Token and password are required' });
    }

    // Validate password
    const passwordResult = validatePasswordStrength(body.password);
    if (!passwordResult.valid) {
      return reply.code(400).send({
        error: 'Password does not meet requirements',
        details: passwordResult.errors,
      });
    }

    const passwordHash = await hashPassword(body.password);

    const result = await query<{ id: string; tenant_id: string }>(
      `UPDATE users
       SET password_hash = $1, password_reset_token = NULL, password_reset_expires = NULL,
           failed_login_attempts = 0, locked_until = NULL, updated_at = NOW()
       WHERE password_reset_token = $2 AND password_reset_expires > NOW() AND status = 'active'
       RETURNING id, tenant_id`,
      [passwordHash, body.token]
    );

    const user = result[0];
    if (!user) {
      return reply.code(400).send({ error: 'Invalid or expired reset token' });
    }

    // Revoke all existing sessions
    await query(
      `UPDATE sessions SET revoked = true, revoked_at = NOW(), revoked_reason = 'password_reset' WHERE user_id = $1`,
      [user.id]
    );

    // Audit log
    await query(
      `INSERT INTO audit_logs (id, tenant_id, user_id, action, ip_address, success, created_at)
       VALUES ($1, $2, $3, 'user.password_reset', $4, true, NOW())`,
      [`audit_${ulid()}`, user.tenant_id, user.id, request.ip]
    );

    return { success: true, message: 'Password reset successfully. Please login with your new password.' };
  });

  /**
   * Change password (authenticated)
   */
  app.post('/api/v1/auth/change-password', async (request, reply) => {
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
    const session = await queryOne<{ user_id: string }>(
      'SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > NOW() AND revoked = false',
      [tokenHash]
    );

    if (!session) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const user = await queryOne<{ password_hash: string; tenant_id: string }>(
      'SELECT password_hash, tenant_id FROM users WHERE id = $1',
      [session.user_id]
    );

    if (!user) {
      return reply.code(401).send({ error: 'User not found' });
    }

    // Verify current password
    const isValid = await verifyPassword(body.current_password, user.password_hash);
    if (!isValid) {
      return reply.code(401).send({ error: 'Current password is incorrect' });
    }

    // Validate new password
    const passwordResult = validatePasswordStrength(body.new_password);
    if (!passwordResult.valid) {
      return reply.code(400).send({
        error: 'New password does not meet requirements',
        details: passwordResult.errors,
      });
    }

    const passwordHash = await hashPassword(body.new_password);

    await query(
      'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
      [passwordHash, session.user_id]
    );

    // Audit log
    await query(
      `INSERT INTO audit_logs (id, tenant_id, user_id, action, ip_address, success, created_at)
       VALUES ($1, $2, $3, 'user.password_change', $4, true, NOW())`,
      [`audit_${ulid()}`, user.tenant_id, session.user_id, request.ip]
    );

    return { success: true, message: 'Password changed successfully' };
  });

  // ============================================
  // SESSION MANAGEMENT
  // ============================================

  /**
   * List active sessions
   */
  app.get('/api/v1/auth/sessions', async (request, reply) => {
    const cookies = request.cookies as Record<string, string> | undefined;
    const sessionToken = cookies?.[SESSION_COOKIE_NAME];

    if (!sessionToken) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const tokenHash = await hashToken(sessionToken);
    const session = await queryOne<{ user_id: string; id: string }>(
      'SELECT user_id, id FROM sessions WHERE token_hash = $1 AND expires_at > NOW() AND revoked = false',
      [tokenHash]
    );

    if (!session) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const sessions = await query<{
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
      [session.user_id]
    );

    return {
      sessions: sessions.map(s => ({
        ...s,
        is_current: s.id === session.id,
      })),
    };
  });

  /**
   * Revoke a specific session
   */
  app.delete('/api/v1/auth/sessions/:sessionId', async (request, reply) => {
    const cookies = request.cookies as Record<string, string> | undefined;
    const sessionToken = cookies?.[SESSION_COOKIE_NAME];
    const { sessionId } = request.params as { sessionId: string };

    if (!sessionToken) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const tokenHash = await hashToken(sessionToken);
    const session = await queryOne<{ user_id: string }>(
      'SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > NOW() AND revoked = false',
      [tokenHash]
    );

    if (!session) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const result = await query<{ id: string }>(
      `UPDATE sessions SET revoked = true, revoked_at = NOW(), revoked_reason = 'user_revoked'
       WHERE id = $1 AND user_id = $2 AND revoked = false
       RETURNING id`,
      [sessionId, session.user_id]
    );

    if (result.length === 0) {
      return reply.code(404).send({ error: 'Session not found' });
    }

    return { success: true, message: 'Session revoked' };
  });

  /**
   * Revoke all other sessions
   */
  app.post('/api/v1/auth/sessions/revoke-others', async (request, reply) => {
    const cookies = request.cookies as Record<string, string> | undefined;
    const sessionToken = cookies?.[SESSION_COOKIE_NAME];

    if (!sessionToken) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const tokenHash = await hashToken(sessionToken);
    const session = await queryOne<{ user_id: string; id: string }>(
      'SELECT user_id, id FROM sessions WHERE token_hash = $1 AND expires_at > NOW() AND revoked = false',
      [tokenHash]
    );

    if (!session) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const result = await query<{ id: string }>(
      `UPDATE sessions SET revoked = true, revoked_at = NOW(), revoked_reason = 'revoke_others'
       WHERE user_id = $1 AND id != $2 AND revoked = false
       RETURNING id`,
      [session.user_id, session.id]
    );

    return { success: true, revoked_count: result.length };
  });

  // ============================================
  // USER DASHBOARD ENDPOINTS
  // ============================================

  /**
   * Get current user info (for dashboard)
   */
  app.get('/api/user/me', async (request, reply) => {
    const cookies = request.cookies as Record<string, string> | undefined;
    const sessionToken = cookies?.[SESSION_COOKIE_NAME];

    if (!sessionToken) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const tokenHash = await hashToken(sessionToken);
    const session = await queryOne<{ user_id: string }>(
      'SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > NOW() AND revoked = false',
      [tokenHash]
    );

    if (!session) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const user = await queryOne<SafeUser & { tenant_id: string }>(
      `SELECT id, tenant_id, email, email_verified, status, role, display_name, avatar_url, timezone, created_at
       FROM users WHERE id = $1`,
      [session.user_id]
    );

    if (!user) {
      return reply.code(401).send({ error: 'User not found' });
    }

    // Get subscription/plan info
    const subscription = await queryOne<{
      plan_id: string;
      status: string;
      current_period_end: string | null;
    }>(
      `SELECT s.plan_id, s.status, s.current_period_end
       FROM subscriptions s WHERE s.tenant_id = $1 AND s.status IN ('active', 'trialing')
       LIMIT 1`,
      [user.tenant_id]
    );

    const plan = subscription?.plan_id
      ? await queryOne<{ id: string; name: string; display_name: string }>(
          'SELECT id, name, display_name FROM subscription_plans WHERE id = $1',
          [subscription.plan_id]
        )
      : { id: 'free', name: 'free', display_name: 'Free' };

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.display_name,
        avatarUrl: user.avatar_url,
        emailVerified: user.email_verified,
        role: user.role,
        createdAt: user.created_at,
      },
      subscription: {
        plan,
        status: subscription?.status ?? 'none',
        current_period_end: subscription?.current_period_end,
      },
    };
  });

  /**
   * Get user's usage stats
   */
  app.get('/api/user/usage', async (request, reply) => {
    const cookies = request.cookies as Record<string, string> | undefined;
    const sessionToken = cookies?.[SESSION_COOKIE_NAME];

    if (!sessionToken) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const tokenHash = await hashToken(sessionToken);
    const session = await queryOne<{ user_id: string }>(
      'SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > NOW() AND revoked = false',
      [tokenHash]
    );

    if (!session) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const user = await queryOne<{ tenant_id: string }>(
      'SELECT tenant_id FROM users WHERE id = $1',
      [session.user_id]
    );

    if (!user) {
      return reply.code(401).send({ error: 'User not found' });
    }

    // Get limits from user's active subscription plan
    const [usageData] = await query<{
      executions_today: string;
      traces_today: string;
      api_requests_today: string;
      private_shards_count: string;
      storage_bytes: string;
      executions_limit: number;
      traces_limit: number;
      api_requests_limit: number;
      private_shards_limit: number;
      storage_limit: number;
    }>(`
      SELECT
        (SELECT COUNT(*) FROM shard_executions se
         JOIN procedural_shards ps ON se.shard_id = ps.id
         WHERE ps.owner_id = $1 AND se.created_at >= CURRENT_DATE) as executions_today,
        (SELECT COUNT(*) FROM reasoning_traces
         WHERE owner_id = $1 AND timestamp >= CURRENT_DATE) as traces_today,
        (SELECT COUNT(*) FROM audit_logs
         WHERE tenant_id = $1 AND action LIKE 'api.%' AND created_at >= CURRENT_DATE) as api_requests_today,
        (SELECT COUNT(*) FROM procedural_shards
         WHERE owner_id = $1 AND visibility = 'private') as private_shards_count,
        (SELECT COALESCE(SUM(
           LENGTH(COALESCE(name, '')) + LENGTH(COALESCE(logic, '')) +
           LENGTH(COALESCE(intent_template, '')) + LENGTH(COALESCE(patterns::text, '[]'))
         ), 0) FROM procedural_shards WHERE owner_id = $1) +
        (SELECT COALESCE(SUM(LENGTH(input) + LENGTH(COALESCE(output, ''))), 0)
         FROM reasoning_traces WHERE owner_id = $1) as storage_bytes,
        COALESCE((
          SELECT (p.limits->>'executions_per_day')::int
          FROM subscriptions s
          JOIN plans p ON s.plan_id = p.id
          WHERE s.tenant_id = $1 AND s.status = 'active'
          ORDER BY s.created_at DESC LIMIT 1
        ), 200) as executions_limit,
        COALESCE((
          SELECT (p.limits->>'traces_per_day')::int
          FROM subscriptions s
          JOIN plans p ON s.plan_id = p.id
          WHERE s.tenant_id = $1 AND s.status = 'active'
          ORDER BY s.created_at DESC LIMIT 1
        ), -1) as traces_limit,
        COALESCE((
          SELECT (p.limits->>'api_requests_per_day')::int
          FROM subscriptions s
          JOIN plans p ON s.plan_id = p.id
          WHERE s.tenant_id = $1 AND s.status = 'active'
          ORDER BY s.created_at DESC LIMIT 1
        ), 1000) as api_requests_limit,
        COALESCE((
          SELECT (p.limits->>'private_shards')::int
          FROM subscriptions s
          JOIN plans p ON s.plan_id = p.id
          WHERE s.tenant_id = $1 AND s.status = 'active'
          ORDER BY s.created_at DESC LIMIT 1
        ), 0) as private_shards_limit,
        COALESCE((
          SELECT (p.limits->>'storage_mb')::int
          FROM subscriptions s
          JOIN plans p ON s.plan_id = p.id
          WHERE s.tenant_id = $1 AND s.status = 'active'
          ORDER BY s.created_at DESC LIMIT 1
        ), 100) as storage_limit
    `, [user.tenant_id]);

    const storageMb = parseInt(usageData?.storage_bytes ?? '0', 10) / (1024 * 1024);

    return {
      executions: {
        used: parseInt(usageData?.executions_today ?? '0', 10),
        limit: usageData?.executions_limit ?? 200,
      },
      traces: {
        used: parseInt(usageData?.traces_today ?? '0', 10),
        limit: usageData?.traces_limit ?? -1,
      },
      api_requests: {
        used: parseInt(usageData?.api_requests_today ?? '0', 10),
        limit: usageData?.api_requests_limit ?? 1000,
      },
      private_shards: {
        used: parseInt(usageData?.private_shards_count ?? '0', 10),
        limit: usageData?.private_shards_limit ?? 0,
      },
      storage_mb: {
        used: Math.round(storageMb * 10) / 10,
        limit: usageData?.storage_limit ?? 100,
      },
    };
  });

  /**
   * Get user's stats summary
   */
  app.get('/api/user/stats', async (request, reply) => {
    const cookies = request.cookies as Record<string, string> | undefined;
    const sessionToken = cookies?.[SESSION_COOKIE_NAME];

    if (!sessionToken) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const tokenHash = await hashToken(sessionToken);
    const session = await queryOne<{ user_id: string }>(
      'SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > NOW() AND revoked = false',
      [tokenHash]
    );

    if (!session) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const user = await queryOne<{ tenant_id: string }>(
      'SELECT tenant_id FROM users WHERE id = $1',
      [session.user_id]
    );

    if (!user) {
      return reply.code(401).send({ error: 'User not found' });
    }

    const [stats] = await query<{
      total_shards: string;
      promoted_shards: string;
      tokens_saved: string;
    }>(`
      SELECT
        (SELECT COUNT(*) FROM procedural_shards WHERE owner_id = $1) as total_shards,
        (SELECT COUNT(*) FROM procedural_shards WHERE owner_id = $1 AND lifecycle = 'promoted') as promoted_shards,
        (SELECT COALESCE(SUM(se.tokens_saved), 0) FROM shard_executions se
         JOIN procedural_shards ps ON se.shard_id = ps.id
         WHERE ps.owner_id = $1) as tokens_saved
    `, [user.tenant_id]);

    return {
      shards: {
        total: parseInt(stats?.total_shards ?? '0', 10),
        promoted: parseInt(stats?.promoted_shards ?? '0', 10),
      },
      tokens_saved: parseInt(stats?.tokens_saved ?? '0', 10),
    };
  });

  /**
   * Get user's recent activity
   */
  app.get('/api/user/activity', async (request, reply) => {
    const cookies = request.cookies as Record<string, string> | undefined;
    const sessionToken = cookies?.[SESSION_COOKIE_NAME];
    const { limit = '10' } = request.query as { limit?: string };

    if (!sessionToken) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const tokenHash = await hashToken(sessionToken);
    const session = await queryOne<{ user_id: string }>(
      'SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > NOW() AND revoked = false',
      [tokenHash]
    );

    if (!session) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const user = await queryOne<{ tenant_id: string }>(
      'SELECT tenant_id FROM users WHERE id = $1',
      [session.user_id]
    );

    if (!user) {
      return reply.code(401).send({ error: 'User not found' });
    }

    // Get recent executions
    const executions = await query<{
      shard_id: string;
      shard_name: string;
      success: boolean;
      tokens_saved: number;
      created_at: string;
    }>(`
      SELECT se.shard_id, ps.name as shard_name, se.success, se.tokens_saved, se.created_at
      FROM shard_executions se
      JOIN procedural_shards ps ON se.shard_id = ps.id
      WHERE ps.owner_id = $1
      ORDER BY se.created_at DESC
      LIMIT $2
    `, [user.tenant_id, parseInt(limit, 10)]);

    // Get recent traces
    const traces = await query<{
      id: string;
      input: string;
      synthesized: boolean;
      timestamp: string;
    }>(`
      SELECT id, LEFT(input, 100) as input, synthesized, timestamp
      FROM reasoning_traces
      WHERE owner_id = $1
      ORDER BY timestamp DESC
      LIMIT $2
    `, [user.tenant_id, parseInt(limit, 10)]);

    // Combine and sort by timestamp
    const activities = [
      ...executions.map(e => ({
        type: 'execution' as const,
        timestamp: e.created_at,
        shard_name: e.shard_name,
        success: e.success,
        tokens_saved: e.tokens_saved,
      })),
      ...traces.map(t => ({
        type: 'trace' as const,
        timestamp: t.timestamp,
        preview: t.input,
        synthesized: t.synthesized,
      })),
    ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, parseInt(limit, 10));

    return { activities };
  });

  /**
   * Get usage history (for chart)
   */
  app.get('/api/user/usage-history', async (request, reply) => {
    const cookies = request.cookies as Record<string, string> | undefined;
    const sessionToken = cookies?.[SESSION_COOKIE_NAME];
    const { days = '7' } = request.query as { days?: string };

    if (!sessionToken) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const tokenHash = await hashToken(sessionToken);
    const session = await queryOne<{ user_id: string }>(
      'SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > NOW() AND revoked = false',
      [tokenHash]
    );

    if (!session) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const user = await queryOne<{ tenant_id: string }>(
      'SELECT tenant_id FROM users WHERE id = $1',
      [session.user_id]
    );

    if (!user) {
      return reply.code(401).send({ error: 'User not found' });
    }

    const numDays = Math.min(parseInt(days, 10), 30);

    const history = await query<{
      date: string;
      executions: string;
      traces: string;
    }>(`
      WITH dates AS (
        SELECT generate_series(
          CURRENT_DATE - ($2 - 1)::int,
          CURRENT_DATE,
          '1 day'::interval
        )::date as date
      )
      SELECT
        d.date::text,
        COALESCE((
          SELECT COUNT(*) FROM shard_executions se
          JOIN procedural_shards ps ON se.shard_id = ps.id
          WHERE ps.owner_id = $1 AND se.created_at::date = d.date
        ), 0)::text as executions,
        COALESCE((
          SELECT COUNT(*) FROM reasoning_traces
          WHERE owner_id = $1 AND timestamp::date = d.date
        ), 0)::text as traces
      FROM dates d
      ORDER BY d.date
    `, [user.tenant_id, numDays]);

    return {
      history: history.map(h => ({
        date: h.date,
        executions: parseInt(h.executions, 10),
        traces: parseInt(h.traces, 10),
      })),
    };
  });

  /**
   * Get user's shards
   */
  app.get('/api/user/shards', async (request, reply) => {
    const cookies = request.cookies as Record<string, string> | undefined;
    const sessionToken = cookies?.[SESSION_COOKIE_NAME];
    const { lifecycle = 'all', visibility } = request.query as { lifecycle?: string; visibility?: string };

    if (!sessionToken) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const tokenHash = await hashToken(sessionToken);
    const session = await queryOne<{ user_id: string }>(
      'SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > NOW() AND revoked = false',
      [tokenHash]
    );

    if (!session) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const user = await queryOne<{ tenant_id: string }>(
      'SELECT tenant_id FROM users WHERE id = $1',
      [session.user_id]
    );

    if (!user) {
      return reply.code(401).send({ error: 'User not found' });
    }

    const params: unknown[] = [user.tenant_id];
    let whereClause = 'WHERE owner_id = $1';
    let paramIdx = 1;

    if (lifecycle && lifecycle !== 'all') {
      paramIdx++;
      whereClause += ` AND lifecycle = $${paramIdx}`;
      params.push(lifecycle);
    }

    if (visibility && ['public', 'private'].includes(visibility)) {
      paramIdx++;
      whereClause += ` AND visibility = $${paramIdx}`;
      params.push(visibility);
    }

    const shards = await query<{
      id: string;
      name: string;
      confidence: number;
      lifecycle: string;
      visibility: string;
      execution_count: number;
      success_count: number;
      created_at: string;
    }>(`
      SELECT id, name, confidence, lifecycle, visibility, execution_count, success_count, created_at
      FROM procedural_shards
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT 100
    `, params);

    // Get stats
    const [stats] = await query<{
      total: string;
      promoted: string;
      avg_confidence: string;
    }>(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE lifecycle = 'promoted') as promoted,
        COALESCE(AVG(confidence), 0) as avg_confidence
      FROM procedural_shards
      WHERE owner_id = $1
    `, [user.tenant_id]);

    return {
      shards,
      stats: {
        total: parseInt(stats?.total ?? '0', 10),
        promoted: parseInt(stats?.promoted ?? '0', 10),
        avg_confidence: parseFloat(stats?.avg_confidence ?? '0'),
      },
    };
  });

  /**
   * Get shard details (session-based auth for dashboard)
   */
  app.get('/api/user/shards/:id', async (request, reply) => {
    const cookies = request.cookies as Record<string, string> | undefined;
    const sessionToken = cookies?.[SESSION_COOKIE_NAME];
    const { id } = request.params as { id: string };

    if (!sessionToken) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const tokenHash = await hashToken(sessionToken);
    const session = await queryOne<{ user_id: string }>(
      'SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > NOW() AND revoked = false',
      [tokenHash]
    );

    if (!session) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const user = await queryOne<{ tenant_id: string }>(
      'SELECT tenant_id FROM users WHERE id = $1',
      [session.user_id]
    );

    if (!user) {
      return reply.code(401).send({ error: 'User not found' });
    }

    // Get shard (must be owned by user or be public)
    const shard = await queryOne<{
      id: string;
      name: string;
      confidence: number;
      lifecycle: string;
      visibility: string;
      category: string;
      execution_count: number;
      success_count: number;
      failure_count: number;
      patterns: string[];
      owner_id: string;
      created_at: string;
      last_executed: string;
    }>(`
      SELECT
        id, name, confidence, lifecycle, visibility, category,
        execution_count, success_count, failure_count, patterns,
        owner_id, created_at, last_executed
      FROM procedural_shards
      WHERE id = $1
        AND (visibility = 'public' OR owner_id = $2)
    `, [id, user.tenant_id]);

    if (!shard) {
      return reply.code(404).send({ error: 'Shard not found or access denied' });
    }

    // Get recent executions
    const executions = await query<{
      id: string;
      success: boolean;
      execution_ms: number;
      tokens_saved: number;
      created_at: string;
    }>(`
      SELECT id, success, execution_ms, tokens_saved, created_at
      FROM shard_executions
      WHERE shard_id = $1
      ORDER BY created_at DESC
      LIMIT 10
    `, [id]);

    return {
      shard,
      executions,
    };
  });

  /**
   * Get user's traces
   */
  app.get('/api/user/traces', async (request, reply) => {
    const cookies = request.cookies as Record<string, string> | undefined;
    const sessionToken = cookies?.[SESSION_COOKIE_NAME];

    if (!sessionToken) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const tokenHash = await hashToken(sessionToken);
    const session = await queryOne<{ user_id: string }>(
      'SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > NOW() AND revoked = false',
      [tokenHash]
    );

    if (!session) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const user = await queryOne<{ tenant_id: string }>(
      'SELECT tenant_id FROM users WHERE id = $1',
      [session.user_id]
    );

    if (!user) {
      return reply.code(401).send({ error: 'User not found' });
    }

    const traces = await query<{
      id: string;
      input: string;
      tokens_used: number;
      synthesized: boolean;
      source: string;
      timestamp: string;
    }>(`
      SELECT id, LEFT(input, 200) as input, tokens_used, synthesized,
             COALESCE(model, 'unknown') as source, timestamp
      FROM reasoning_traces
      WHERE owner_id = $1
      ORDER BY timestamp DESC
      LIMIT 50
    `, [user.tenant_id]);

    return { traces };
  });

  /**
   * Get user's API keys
   */
  app.get('/api/user/api-keys', async (request, reply) => {
    const cookies = request.cookies as Record<string, string> | undefined;
    const sessionToken = cookies?.[SESSION_COOKIE_NAME];

    if (!sessionToken) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const tokenHash = await hashToken(sessionToken);
    const session = await queryOne<{ user_id: string }>(
      'SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > NOW() AND revoked = false',
      [tokenHash]
    );

    if (!session) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const user = await queryOne<{ tenant_id: string }>(
      'SELECT tenant_id FROM users WHERE id = $1',
      [session.user_id]
    );

    if (!user) {
      return reply.code(401).send({ error: 'User not found' });
    }

    const keys = await query<{
      id: string;
      name: string;
      key_prefix: string;
      scopes: string[];
      last_used_at: string | null;
      created_at: string;
    }>(`
      SELECT id, name, key_prefix, scopes, last_used_at, created_at
      FROM api_keys
      WHERE tenant_id = $1 AND status = 'active'
      ORDER BY created_at DESC
    `, [user.tenant_id]);

    return {
      keys: keys.map(k => ({
        id: k.id,
        name: k.name,
        key_preview: k.key_prefix + '...',
        scopes: k.scopes,
        last_used_at: k.last_used_at,
        created_at: k.created_at,
      })),
    };
  });

  /**
   * Create API key
   */
  app.post('/api/user/api-keys', async (request, reply) => {
    const cookies = request.cookies as Record<string, string> | undefined;
    const sessionToken = cookies?.[SESSION_COOKIE_NAME];
    const body = request.body as { name: string; scopes?: string[] };

    if (!sessionToken) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    if (!body.name) {
      return reply.code(400).send({ error: 'Name is required' });
    }

    const tokenHash = await hashToken(sessionToken);
    const session = await queryOne<{ user_id: string }>(
      'SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > NOW() AND revoked = false',
      [tokenHash]
    );

    if (!session) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const user = await queryOne<{ tenant_id: string }>(
      'SELECT tenant_id FROM users WHERE id = $1',
      [session.user_id]
    );

    if (!user) {
      return reply.code(401).send({ error: 'User not found' });
    }

    // Generate API key
    const apiKey = `sk_live_${generateSecureToken(32)}`;
    const keyPrefix = apiKey.substring(0, 12);
    const keyHash = await hashToken(apiKey);
    const keyId = `key_${ulid()}`;
    const scopes = (body.scopes ?? ['read', 'write', 'execute']).filter(s =>
      ['read', 'write', 'execute'].includes(s)
    );

    await query(
      `INSERT INTO api_keys (id, tenant_id, name, key_hash, key_prefix, scopes, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'active', NOW())`,
      [keyId, user.tenant_id, body.name, keyHash, keyPrefix, scopes]
    );

    return {
      id: keyId,
      key: apiKey,
      name: body.name,
      message: 'Save your API key - it will not be shown again!',
    };
  });

  /**
   * Revoke API key
   */
  app.delete('/api/user/api-keys/:keyId', async (request, reply) => {
    const cookies = request.cookies as Record<string, string> | undefined;
    const sessionToken = cookies?.[SESSION_COOKIE_NAME];
    const { keyId } = request.params as { keyId: string };

    if (!sessionToken) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const tokenHash = await hashToken(sessionToken);
    const session = await queryOne<{ user_id: string }>(
      'SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > NOW() AND revoked = false',
      [tokenHash]
    );

    if (!session) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const user = await queryOne<{ tenant_id: string }>(
      'SELECT tenant_id FROM users WHERE id = $1',
      [session.user_id]
    );

    if (!user) {
      return reply.code(401).send({ error: 'User not found' });
    }

    const result = await query<{ id: string }>(
      `UPDATE api_keys SET status = 'revoked' WHERE id = $1 AND tenant_id = $2 RETURNING id`,
      [keyId, user.tenant_id]
    );

    if (result.length === 0) {
      return reply.code(404).send({ error: 'API key not found' });
    }

    return { success: true };
  });

  /**
   * Get user's subscription info
   */
  app.get('/api/user/subscription', async (request, reply) => {
    const cookies = request.cookies as Record<string, string> | undefined;
    const sessionToken = cookies?.[SESSION_COOKIE_NAME];

    if (!sessionToken) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const tokenHash = await hashToken(sessionToken);
    const session = await queryOne<{ user_id: string }>(
      'SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > NOW() AND revoked = false',
      [tokenHash]
    );

    if (!session) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const user = await queryOne<{ tenant_id: string }>(
      'SELECT tenant_id FROM users WHERE id = $1',
      [session.user_id]
    );

    if (!user) {
      return reply.code(401).send({ error: 'User not found' });
    }

    const subscription = await queryOne<{
      plan_id: string;
      status: string;
      current_period_end: string | null;
    }>(`
      SELECT plan_id, status, current_period_end
      FROM subscriptions
      WHERE tenant_id = $1 AND status IN ('active', 'trialing')
      LIMIT 1
    `, [user.tenant_id]);

    if (!subscription) {
      return {
        plan: { id: 'free', name: 'free', display_name: 'Free', description: 'Basic plan for getting started' },
        status: 'active',
        current_period_end: null,
      };
    }

    const plan = await queryOne<{
      id: string;
      name: string;
      display_name: string;
      description: string;
      price_monthly: number;
    }>('SELECT id, name, display_name, description, price_monthly FROM subscription_plans WHERE id = $1', [subscription.plan_id]);

    return {
      plan: plan ?? { id: 'free', name: 'free', display_name: 'Free', description: 'Basic plan' },
      status: subscription.status,
      current_period_end: subscription.current_period_end,
    };
  });

  /**
   * Update user profile
   */
  app.patch('/api/user/profile', async (request, reply) => {
    const cookies = request.cookies as Record<string, string> | undefined;
    const sessionToken = cookies?.[SESSION_COOKIE_NAME];
    const body = request.body as { name?: string; preferredName?: string };

    if (!sessionToken) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const tokenHash = await hashToken(sessionToken);
    const session = await queryOne<{ user_id: string; tenant_id: string }>(
      `SELECT s.user_id, u.tenant_id
       FROM sessions s
       JOIN users u ON s.user_id = u.id
       WHERE s.token_hash = $1 AND s.expires_at > NOW() AND s.revoked = false`,
      [tokenHash]
    );

    if (!session) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    // Update display_name in users table
    if (body.name !== undefined) {
      await query(
        'UPDATE users SET display_name = $1, updated_at = NOW() WHERE id = $2',
        [body.name, session.user_id]
      );
    }

    // Update preferred_name in alf_profiles table
    if (body.preferredName !== undefined) {
      await query(
        `UPDATE alf_profiles SET preferred_name = $1, updated_at = NOW() WHERE tenant_id = $2`,
        [body.preferredName || null, session.tenant_id]
      );
    }

    return { success: true };
  });

  /**
   * Change password (from settings)
   */
  app.post('/api/user/password', async (request, reply) => {
    const cookies = request.cookies as Record<string, string> | undefined;
    const sessionToken = cookies?.[SESSION_COOKIE_NAME];
    const body = request.body as { currentPassword: string; newPassword: string };

    if (!sessionToken) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    if (!body.currentPassword || !body.newPassword) {
      return reply.code(400).send({ error: 'Current and new password are required' });
    }

    const tokenHash = await hashToken(sessionToken);
    const session = await queryOne<{ user_id: string }>(
      'SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > NOW() AND revoked = false',
      [tokenHash]
    );

    if (!session) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const user = await queryOne<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE id = $1',
      [session.user_id]
    );

    if (!user) {
      return reply.code(401).send({ error: 'User not found' });
    }

    const isValid = await verifyPassword(body.currentPassword, user.password_hash);
    if (!isValid) {
      return reply.code(401).send({ error: 'Current password is incorrect' });
    }

    const passwordResult = validatePasswordStrength(body.newPassword);
    if (!passwordResult.valid) {
      return reply.code(400).send({ error: 'New password does not meet requirements', details: passwordResult.errors });
    }

    const newPasswordHash = await hashPassword(body.newPassword);
    await query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [newPasswordHash, session.user_id]);

    return { success: true };
  });

  // ============================================
  // AI CONNECTORS (User's external API keys)
  // ============================================

  /**
   * Get user's AI connector configurations
   */
  app.get('/api/user/connectors', async (request, reply) => {
    const cookies = request.cookies as Record<string, string> | undefined;
    const sessionToken = cookies?.[SESSION_COOKIE_NAME];

    if (!sessionToken) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const tokenHash = await hashToken(sessionToken);
    const session = await queryOne<{ user_id: string }>(
      'SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > NOW() AND revoked = false',
      [tokenHash]
    );

    if (!session) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    // Get connectors from user_connectors table
    const connectors = await query<{ provider: string; settings: string; enabled: boolean }>(
      'SELECT provider, settings, enabled FROM user_connectors WHERE user_id = $1',
      [session.user_id]
    );

    const openaiConnector = connectors.find(c => c.provider === 'openai');
    const anthropicConnector = connectors.find(c => c.provider === 'anthropic');

    let openaiSettings: { key_preview?: string } = {};
    let anthropicSettings: { key_preview?: string } = {};

    try {
      if (openaiConnector?.settings) {
        openaiSettings = typeof openaiConnector.settings === 'string'
          ? JSON.parse(openaiConnector.settings)
          : openaiConnector.settings;
      }
      if (anthropicConnector?.settings) {
        anthropicSettings = typeof anthropicConnector.settings === 'string'
          ? JSON.parse(anthropicConnector.settings)
          : anthropicConnector.settings;
      }
    } catch (e) {
      // Invalid JSON, ignore
    }

    // Get model preferences from tenant metadata
    const user = await queryOne<{ tenant_id: string }>(
      'SELECT tenant_id FROM users WHERE id = $1',
      [session.user_id]
    );
    const tenantData = await queryOne<{ metadata: Record<string, string> }>(
      'SELECT metadata FROM tenants WHERE id = $1',
      [user?.tenant_id || '']
    );

    return {
      openai: {
        configured: !!(openaiConnector?.enabled && openaiSettings.key_preview),
        key_preview: openaiSettings.key_preview,
      },
      anthropic: {
        configured: !!(anthropicConnector?.enabled && anthropicSettings.key_preview),
        key_preview: anthropicSettings.key_preview,
      },
      preferences: {
        primary_model: tenantData?.metadata?.['primary_model'] ?? 'system',
        embedding_model: tenantData?.metadata?.['embedding_model'] ?? 'system',
      },
    };
  });

  /**
   * Save OpenAI connector (encrypted storage)
   */
  app.post('/api/user/connectors/openai', async (request, reply) => {
    const cookies = request.cookies as Record<string, string> | undefined;
    const sessionToken = cookies?.[SESSION_COOKIE_NAME];
    const body = request.body as { api_key: string };

    if (!sessionToken) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    if (!body.api_key || !body.api_key.startsWith('sk-')) {
      return reply.code(400).send({ error: 'Invalid OpenAI API key format' });
    }

    const tokenHash = await hashToken(sessionToken);
    const session = await queryOne<{ user_id: string }>(
      'SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > NOW() AND revoked = false',
      [tokenHash]
    );

    if (!session) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    // Encrypt the API key before storage
    const encryptedKey = await encryptApiKey(body.api_key);
    const keyPreview = body.api_key.slice(-4); // Last 4 chars for display

    // Store in user_connectors table with encrypted key
    await query(`
      INSERT INTO user_connectors (id, user_id, provider, settings, enabled, created_at, updated_at)
      VALUES ($1, $2, 'openai', $3, true, NOW(), NOW())
      ON CONFLICT (user_id, provider)
      DO UPDATE SET settings = $3, enabled = true, updated_at = NOW()
    `, [
      `conn_${ulid()}`,
      session.user_id,
      JSON.stringify({ api_key: encryptedKey, key_preview: keyPreview }),
    ]);

    return { success: true };
  });

  /**
   * Save Anthropic connector (encrypted storage)
   */
  app.post('/api/user/connectors/anthropic', async (request, reply) => {
    const cookies = request.cookies as Record<string, string> | undefined;
    const sessionToken = cookies?.[SESSION_COOKIE_NAME];
    const body = request.body as { api_key: string };

    if (!sessionToken) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    if (!body.api_key || !body.api_key.startsWith('sk-ant-')) {
      return reply.code(400).send({ error: 'Invalid Anthropic API key format' });
    }

    const tokenHash = await hashToken(sessionToken);
    const session = await queryOne<{ user_id: string }>(
      'SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > NOW() AND revoked = false',
      [tokenHash]
    );

    if (!session) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    // Encrypt the API key before storage
    const encryptedKey = await encryptApiKey(body.api_key);
    const keyPreview = body.api_key.slice(-4); // Last 4 chars for display

    // Store in user_connectors table with encrypted key
    await query(`
      INSERT INTO user_connectors (id, user_id, provider, settings, enabled, created_at, updated_at)
      VALUES ($1, $2, 'anthropic', $3, true, NOW(), NOW())
      ON CONFLICT (user_id, provider)
      DO UPDATE SET settings = $3, enabled = true, updated_at = NOW()
    `, [
      `conn_${ulid()}`,
      session.user_id,
      JSON.stringify({ api_key: encryptedKey, key_preview: keyPreview }),
    ]);

    return { success: true };
  });

  /**
   * Save model preferences
   */
  app.post('/api/user/connectors/preferences', async (request, reply) => {
    const cookies = request.cookies as Record<string, string> | undefined;
    const sessionToken = cookies?.[SESSION_COOKIE_NAME];
    const body = request.body as { primary_model?: string; embedding_model?: string };

    if (!sessionToken) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const tokenHash = await hashToken(sessionToken);
    const session = await queryOne<{ user_id: string }>(
      'SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > NOW() AND revoked = false',
      [tokenHash]
    );

    if (!session) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const user = await queryOne<{ tenant_id: string }>(
      'SELECT tenant_id FROM users WHERE id = $1',
      [session.user_id]
    );

    if (!user) {
      return reply.code(401).send({ error: 'User not found' });
    }

    const updates: Record<string, string> = {};
    if (body.primary_model) updates['primary_model'] = body.primary_model;
    if (body.embedding_model) updates['embedding_model'] = body.embedding_model;

    if (Object.keys(updates).length > 0) {
      await query(`
        UPDATE tenants
        SET metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb,
            updated_at = NOW()
        WHERE id = $2
      `, [JSON.stringify(updates), user.tenant_id]);
    }

    return { success: true };
  });

  /**
   * Delete AI connector (clear API key)
   */
  app.delete('/api/user/connectors/:provider', async (request, reply) => {
    const cookies = request.cookies as Record<string, string> | undefined;
    const sessionToken = cookies?.[SESSION_COOKIE_NAME];
    const { provider } = request.params as { provider: string };

    if (!sessionToken) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    if (!['openai', 'anthropic'].includes(provider)) {
      return reply.code(400).send({ error: 'Invalid provider' });
    }

    const tokenHash = await hashToken(sessionToken);
    const session = await queryOne<{ user_id: string }>(
      'SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > NOW() AND revoked = false',
      [tokenHash]
    );

    if (!session) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    // Delete the connector
    await query(
      'DELETE FROM user_connectors WHERE user_id = $1 AND provider = $2',
      [session.user_id, provider]
    );

    return { success: true };
  });

  /**
   * Test AI connector
   * If api_key is provided, test that key
   * If api_key is not provided, test the saved key for that provider
   */
  app.post('/api/user/connectors/test', async (request, reply) => {
    const cookies = request.cookies as Record<string, string> | undefined;
    const sessionToken = cookies?.[SESSION_COOKIE_NAME];
    const body = request.body as { provider: string; api_key?: string };

    if (!sessionToken) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    if (!body.provider) {
      return reply.code(400).send({ error: 'Provider is required' });
    }

    const tokenHash = await hashToken(sessionToken);
    const session = await queryOne<{ user_id: string }>(
      'SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > NOW() AND revoked = false',
      [tokenHash]
    );

    if (!session) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    // Get API key - either from request or from saved connector
    let apiKey = body.api_key;

    if (!apiKey) {
      // Try to get saved key
      const connector = await queryOne<{ settings: string }>(
        'SELECT settings FROM user_connectors WHERE user_id = $1 AND provider = $2 AND enabled = true',
        [session.user_id, body.provider]
      );

      if (connector?.settings) {
        try {
          const settings = typeof connector.settings === 'string'
            ? JSON.parse(connector.settings)
            : connector.settings;
          if (settings.api_key) {
            apiKey = await decryptApiKey(settings.api_key);
          }
        } catch (e) {
          return { success: false, error: 'Failed to decrypt saved API key' };
        }
      }

      if (!apiKey) {
        return { success: false, error: 'No API key configured for this provider' };
      }
    }

    // Test the API key by making a simple request
    try {
      if (body.provider === 'openai') {
        const response = await fetch('https://api.openai.com/v1/models', {
          headers: { 'Authorization': `Bearer ${apiKey}` },
        });
        if (response.ok) {
          return { success: true, message: 'OpenAI connection successful' };
        } else {
          const error = await response.json() as { error?: { message?: string } };
          return { success: false, error: error?.error?.message ?? 'Invalid API key' };
        }
      } else if (body.provider === 'anthropic') {
        // Test Anthropic by making a minimal API call
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5',
            max_tokens: 1,
            messages: [{ role: 'user', content: 'Hi' }],
          }),
        });

        if (response.ok) {
          return { success: true, message: 'Anthropic connection successful' };
        } else {
          const error = await response.json() as { error?: { message?: string } };
          return { success: false, error: error?.error?.message ?? 'Invalid API key' };
        }
      }

      return { success: false, error: 'Unknown provider' };
    } catch (err) {
      return { success: false, error: 'Connection test failed' };
    }
  });

  // ============================================
  // USER MEMORY MANAGEMENT (ALF and Me)
  // ============================================

  /**
   * Get user's memory summary (what ALF knows about them)
   */
  app.get('/api/user/memory', async (request, reply) => {
    const cookies = request.cookies as Record<string, string> | undefined;
    const sessionToken = cookies?.[SESSION_COOKIE_NAME];

    if (!sessionToken) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const tokenHash = await hashToken(sessionToken);
    const session = await queryOne<{ user_id: string }>(
      'SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > NOW() AND revoked = false',
      [tokenHash]
    );

    if (!session) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    // Get tenant_id from user
    const user = await queryOne<{ tenant_id: string }>(
      'SELECT tenant_id FROM users WHERE id = $1',
      [session.user_id]
    );

    if (!user) {
      return reply.code(404).send({ error: 'User not found' });
    }

    const tenantId = user.tenant_id;

    // Get ALF profile preferences
    const profile = await queryOne<{
      preferred_name: string | null;
      communication_style: string;
      tone: string;
      detail_level: string;
      interests: string[];
      domains: string[];
      goals: string[];
      custom_instructions: string | null;
      about_user: Record<string, unknown>;
    }>(
      `SELECT preferred_name, communication_style, tone, detail_level,
              interests, domains, goals, custom_instructions, about_user
       FROM alf_profiles WHERE tenant_id = $1`,
      [tenantId]
    );

    // Count episodes (interaction history)
    const episodeStats = await queryOne<{ total: string; positive: string; negative: string }>(
      `SELECT
         COUNT(*) as total,
         COUNT(*) FILTER (WHERE valence = 'positive') as positive,
         COUNT(*) FILTER (WHERE valence = 'negative') as negative
       FROM episodes WHERE owner_id = $1`,
      [tenantId]
    );

    // Count knowledge facts
    const factStats = await queryOne<{ total: string; categories: string }>(
      `SELECT COUNT(*) as total, COUNT(DISTINCT category) as categories
       FROM knowledge_facts WHERE owner_id = $1`,
      [tenantId]
    );

    // Count working contexts
    const contextStats = await queryOne<{ total: string }>(
      'SELECT COUNT(*) as total FROM working_contexts WHERE owner_id = $1',
      [tenantId]
    );

    // Get sample working contexts (up to 50)
    const sampleContexts = await query<{ id: string; summary: string | null; content_type: string; status: string; original_tokens: number | null; created_at: Date }>(
      `SELECT id, summary, content_type, status, original_tokens, created_at
       FROM working_contexts WHERE owner_id = $1
       ORDER BY created_at DESC LIMIT 50`,
      [tenantId]
    );

    // Get sample facts (up to 50)
    const sampleFacts = await query<{ id: string; statement: string; category: string | null; confidence: number }>(
      `SELECT id, statement, category, confidence
       FROM knowledge_facts WHERE owner_id = $1
       ORDER BY created_at DESC LIMIT 50`,
      [tenantId]
    );

    // Get sample episodes (up to 50)
    const sampleEpisodes = await query<{ id: string; summary: string; type: string; valence: string | null; created_at: Date }>(
      `SELECT id, summary, type, valence, created_at
       FROM episodes WHERE owner_id = $1
       ORDER BY created_at DESC LIMIT 50`,
      [tenantId]
    );

    return {
      preferences: {
        preferredName: profile?.preferred_name,
        communicationStyle: profile?.communication_style || 'balanced',
        tone: profile?.tone || 'friendly',
        detailLevel: profile?.detail_level || 'moderate',
        interests: profile?.interests || [],
        domains: profile?.domains || [],
        goals: profile?.goals || [],
        customInstructions: profile?.custom_instructions,
        aboutUser: profile?.about_user || {},
      },
      episodes: {
        total: parseInt(episodeStats?.total ?? '0', 10),
        positive: parseInt(episodeStats?.positive ?? '0', 10),
        negative: parseInt(episodeStats?.negative ?? '0', 10),
        samples: sampleEpisodes || [],
      },
      facts: {
        total: parseInt(factStats?.total ?? '0', 10),
        categories: parseInt(factStats?.categories ?? '0', 10),
        samples: sampleFacts || [],
      },
      contexts: {
        total: parseInt(contextStats?.total ?? '0', 10),
        samples: sampleContexts || [],
      },
    };
  });

  /**
   * Remove a single preference item (interest, domain, goal, or aboutUser key)
   */
  app.delete('/api/user/memory/preference-item', async (request, reply) => {
    const cookies = request.cookies as Record<string, string> | undefined;
    const sessionToken = cookies?.[SESSION_COOKIE_NAME];
    const body = request.body as { field: string; value: string };

    if (!sessionToken) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    if (!body.field || body.value === undefined) {
      return reply.code(400).send({ error: 'field and value are required' });
    }

    const tokenHash = await hashToken(sessionToken);
    const session = await queryOne<{ user_id: string }>(
      'SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > NOW() AND revoked = false',
      [tokenHash]
    );

    if (!session) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const user = await queryOne<{ tenant_id: string }>(
      'SELECT tenant_id FROM users WHERE id = $1',
      [session.user_id]
    );

    if (!user) {
      return reply.code(404).send({ error: 'User not found' });
    }

    const { field, value } = body;

    if (field === 'interests' || field === 'domains' || field === 'goals') {
      await query(
        `UPDATE alf_profiles SET ${field} = array_remove(${field}, $1), updated_at = NOW() WHERE tenant_id = $2`,
        [value, user.tenant_id]
      );
    } else if (field === 'aboutUser') {
      await query(
        `UPDATE alf_profiles SET about_user = about_user - $1, updated_at = NOW() WHERE tenant_id = $2`,
        [value, user.tenant_id]
      );
    } else if (field === 'customInstructions') {
      await query(
        `UPDATE alf_profiles SET custom_instructions = NULL, updated_at = NOW() WHERE tenant_id = $1`,
        [user.tenant_id]
      );
    } else {
      return reply.code(400).send({ error: 'Invalid field' });
    }

    return { success: true };
  });

  /**
   * Remove a single fact by ID
   */
  app.delete('/api/user/memory/facts/:id', async (request, reply) => {
    const cookies = request.cookies as Record<string, string> | undefined;
    const sessionToken = cookies?.[SESSION_COOKIE_NAME];
    const { id } = request.params as { id: string };

    if (!sessionToken) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const tokenHash = await hashToken(sessionToken);
    const session = await queryOne<{ user_id: string }>(
      'SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > NOW() AND revoked = false',
      [tokenHash]
    );

    if (!session) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const user = await queryOne<{ tenant_id: string }>(
      'SELECT tenant_id FROM users WHERE id = $1',
      [session.user_id]
    );

    if (!user) {
      return reply.code(404).send({ error: 'User not found' });
    }

    await query('DELETE FROM knowledge_facts WHERE id = $1 AND owner_id = $2', [id, user.tenant_id]);
    return { success: true };
  });

  /**
   * Remove a single episode by ID
   */
  app.delete('/api/user/memory/episodes/:id', async (request, reply) => {
    const cookies = request.cookies as Record<string, string> | undefined;
    const sessionToken = cookies?.[SESSION_COOKIE_NAME];
    const { id } = request.params as { id: string };

    if (!sessionToken) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const tokenHash = await hashToken(sessionToken);
    const session = await queryOne<{ user_id: string }>(
      'SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > NOW() AND revoked = false',
      [tokenHash]
    );

    if (!session) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const user = await queryOne<{ tenant_id: string }>(
      'SELECT tenant_id FROM users WHERE id = $1',
      [session.user_id]
    );

    if (!user) {
      return reply.code(404).send({ error: 'User not found' });
    }

    await query('DELETE FROM episodes WHERE id = $1 AND owner_id = $2', [id, user.tenant_id]);
    return { success: true };
  });

  /**
   * Remove a single working context by ID
   */
  app.delete('/api/user/memory/contexts/:id', async (request, reply) => {
    const cookies = request.cookies as Record<string, string> | undefined;
    const sessionToken = cookies?.[SESSION_COOKIE_NAME];
    const { id } = request.params as { id: string };

    if (!sessionToken) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const tokenHash = await hashToken(sessionToken);
    const session = await queryOne<{ user_id: string }>(
      'SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > NOW() AND revoked = false',
      [tokenHash]
    );

    if (!session) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const user = await queryOne<{ tenant_id: string }>(
      'SELECT tenant_id FROM users WHERE id = $1',
      [session.user_id]
    );

    if (!user) {
      return reply.code(404).send({ error: 'User not found' });
    }

    await query('DELETE FROM working_contexts WHERE id = $1 AND owner_id = $2', [id, user.tenant_id]);
    return { success: true };
  });

  /**
   * Reset ALF profile preferences (communication style, interests, etc.)
   */
  app.delete('/api/user/memory/preferences', async (request, reply) => {
    const cookies = request.cookies as Record<string, string> | undefined;
    const sessionToken = cookies?.[SESSION_COOKIE_NAME];

    if (!sessionToken) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const tokenHash = await hashToken(sessionToken);
    const session = await queryOne<{ user_id: string }>(
      'SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > NOW() AND revoked = false',
      [tokenHash]
    );

    if (!session) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const user = await queryOne<{ tenant_id: string }>(
      'SELECT tenant_id FROM users WHERE id = $1',
      [session.user_id]
    );

    if (!user) {
      return reply.code(404).send({ error: 'User not found' });
    }

    // Reset ALF profile to defaults (but keep the record)
    await query(
      `UPDATE alf_profiles SET
         communication_style = 'balanced',
         tone = 'friendly',
         detail_level = 'moderate',
         response_format = 'adaptive',
         interests = '{}',
         domains = '{}',
         goals = '{}',
         avoid_topics = '{}',
         about_user = '{}',
         custom_instructions = NULL,
         updated_at = NOW()
       WHERE tenant_id = $1`,
      [user.tenant_id]
    );

    return { success: true, message: 'Preferences reset to defaults' };
  });

  /**
   * Clear learned facts about user (semantic memory)
   */
  app.delete('/api/user/memory/facts', async (request, reply) => {
    const cookies = request.cookies as Record<string, string> | undefined;
    const sessionToken = cookies?.[SESSION_COOKIE_NAME];

    if (!sessionToken) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const tokenHash = await hashToken(sessionToken);
    const session = await queryOne<{ user_id: string }>(
      'SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > NOW() AND revoked = false',
      [tokenHash]
    );

    if (!session) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const user = await queryOne<{ tenant_id: string }>(
      'SELECT tenant_id FROM users WHERE id = $1',
      [session.user_id]
    );

    if (!user) {
      return reply.code(404).send({ error: 'User not found' });
    }

    const result = await query(
      'DELETE FROM knowledge_facts WHERE owner_id = $1',
      [user.tenant_id]
    );

    return { success: true, message: 'Facts cleared', deleted: (result as { rowCount?: number }).rowCount || 0 };
  });

  /**
   * Clear interaction history (episodic memory)
   */
  app.delete('/api/user/memory/episodes', async (request, reply) => {
    const cookies = request.cookies as Record<string, string> | undefined;
    const sessionToken = cookies?.[SESSION_COOKIE_NAME];

    if (!sessionToken) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const tokenHash = await hashToken(sessionToken);
    const session = await queryOne<{ user_id: string }>(
      'SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > NOW() AND revoked = false',
      [tokenHash]
    );

    if (!session) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const user = await queryOne<{ tenant_id: string }>(
      'SELECT tenant_id FROM users WHERE id = $1',
      [session.user_id]
    );

    if (!user) {
      return reply.code(404).send({ error: 'User not found' });
    }

    const result = await query(
      'DELETE FROM episodes WHERE owner_id = $1',
      [user.tenant_id]
    );

    return { success: true, message: 'Episodes cleared', deleted: (result as { rowCount?: number }).rowCount || 0 };
  });

  /**
   * Clear working contexts
   */
  app.delete('/api/user/memory/contexts', async (request, reply) => {
    const cookies = request.cookies as Record<string, string> | undefined;
    const sessionToken = cookies?.[SESSION_COOKIE_NAME];

    if (!sessionToken) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const tokenHash = await hashToken(sessionToken);
    const session = await queryOne<{ user_id: string }>(
      'SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > NOW() AND revoked = false',
      [tokenHash]
    );

    if (!session) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const user = await queryOne<{ tenant_id: string }>(
      'SELECT tenant_id FROM users WHERE id = $1',
      [session.user_id]
    );

    if (!user) {
      return reply.code(404).send({ error: 'User not found' });
    }

    const result = await query(
      'DELETE FROM working_contexts WHERE owner_id = $1',
      [user.tenant_id]
    );

    return { success: true, message: 'Contexts cleared', deleted: (result as { rowCount?: number }).rowCount || 0 };
  });

  /**
   * Full memory reset - clear everything ALF has learned about the user
   */
  app.delete('/api/user/memory/all', async (request, reply) => {
    const cookies = request.cookies as Record<string, string> | undefined;
    const sessionToken = cookies?.[SESSION_COOKIE_NAME];

    if (!sessionToken) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const tokenHash = await hashToken(sessionToken);
    const session = await queryOne<{ user_id: string }>(
      'SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > NOW() AND revoked = false',
      [tokenHash]
    );

    if (!session) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const user = await queryOne<{ tenant_id: string }>(
      'SELECT tenant_id FROM users WHERE id = $1',
      [session.user_id]
    );

    if (!user) {
      return reply.code(404).send({ error: 'User not found' });
    }

    const tenantId = user.tenant_id;

    // Reset preferences
    await query(
      `UPDATE alf_profiles SET
         communication_style = 'balanced',
         tone = 'friendly',
         detail_level = 'moderate',
         response_format = 'adaptive',
         interests = '{}',
         domains = '{}',
         goals = '{}',
         avoid_topics = '{}',
         about_user = '{}',
         custom_instructions = NULL,
         updated_at = NOW()
       WHERE tenant_id = $1`,
      [tenantId]
    );

    // Clear facts
    const factsResult = await query('DELETE FROM knowledge_facts WHERE owner_id = $1', [tenantId]);

    // Clear episodes
    const episodesResult = await query('DELETE FROM episodes WHERE owner_id = $1', [tenantId]);

    // Clear contexts
    const contextsResult = await query('DELETE FROM working_contexts WHERE owner_id = $1', [tenantId]);

    return {
      success: true,
      message: 'All memory cleared',
      deleted: {
        facts: (factsResult as { rowCount?: number }).rowCount || 0,
        episodes: (episodesResult as { rowCount?: number }).rowCount || 0,
        contexts: (contextsResult as { rowCount?: number }).rowCount || 0,
      },
    };
  });

  // ============================================
  // USER SHARD STATS (for header display)
  // ============================================

  /**
   * Get user's lifetime shard hit stats
   * Tracks both public and private shard hits by this user
   */
  app.get('/api/user/shard-stats', async (request, reply) => {
    const cookies = request.cookies as Record<string, string> | undefined;
    const sessionToken = cookies?.[SESSION_COOKIE_NAME];

    if (!sessionToken) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const tokenHash = await hashToken(sessionToken);
    const session = await queryOne<{ user_id: string }>(
      'SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > NOW() AND revoked = false',
      [tokenHash]
    );

    if (!session) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const user = await queryOne<{ tenant_id: string }>(
      'SELECT tenant_id FROM users WHERE id = $1',
      [session.user_id]
    );

    if (!user) {
      return reply.code(404).send({ error: 'User not found' });
    }

    // Get shard stats for this user (last 30 days, matches convergence dashboard)
    const stats = await queryOne<{ shard_hits: string; tokens_saved: string }>(
      `SELECT
         COUNT(*) as shard_hits,
         COALESCE(SUM(tokens_saved), 0) as tokens_saved
       FROM shard_executions
       WHERE executor_tenant_id = $1 AND success = true
         AND created_at >= NOW() - INTERVAL '30 days'`,
      [user.tenant_id]
    );

    return {
      shardHits: parseInt(stats?.shard_hits ?? '0', 10),
      tokensSaved: parseInt(stats?.tokens_saved ?? '0', 10),
    };
  });

  /**
   * Get detailed shard statistics for user's account
   * Shows per-shard breakdown of all hits and savings
   */
  app.get('/api/user/shard-stats/detailed', async (request, reply) => {
    const cookies = request.cookies as Record<string, string> | undefined;
    const sessionToken = cookies?.[SESSION_COOKIE_NAME];

    if (!sessionToken) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const tokenHash = await hashToken(sessionToken);
    const session = await queryOne<{ user_id: string }>(
      'SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > NOW() AND revoked = false',
      [tokenHash]
    );

    if (!session) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const user = await queryOne<{ tenant_id: string }>(
      'SELECT tenant_id FROM users WHERE id = $1',
      [session.user_id]
    );

    if (!user) {
      return reply.code(404).send({ error: 'User not found' });
    }

    // Get lifetime totals
    const totals = await queryOne<{
      total_hits: string;
      total_tokens_saved: string;
      unique_shards: string;
      first_hit: Date | null;
      last_hit: Date | null;
    }>(
      `SELECT
         COUNT(*) as total_hits,
         COALESCE(SUM(tokens_saved), 0) as total_tokens_saved,
         COUNT(DISTINCT shard_id) as unique_shards,
         MIN(created_at) as first_hit,
         MAX(created_at) as last_hit
       FROM shard_executions
       WHERE executor_tenant_id = $1 AND success = true`,
      [user.tenant_id]
    );

    // Get per-shard breakdown (top 50 most-used shards)
    const perShardStats = await query<{
      shard_id: string;
      shard_name: string;
      shard_category: string | null;
      knowledge_type: string;
      verification_status: string;
      hit_count: string;
      tokens_saved: string;
      avg_execution_ms: string;
      first_hit: Date;
      last_hit: Date;
    }>(
      `SELECT
         se.shard_id,
         ps.name as shard_name,
         ps.category as shard_category,
         COALESCE(ps.knowledge_type, 'procedural') as knowledge_type,
         COALESCE(ps.verification_status, 'unverified') as verification_status,
         COUNT(*) as hit_count,
         COALESCE(SUM(se.tokens_saved), 0) as tokens_saved,
         ROUND(AVG(se.execution_ms), 2) as avg_execution_ms,
         MIN(se.created_at) as first_hit,
         MAX(se.created_at) as last_hit
       FROM shard_executions se
       JOIN procedural_shards ps ON se.shard_id = ps.id
       WHERE se.executor_tenant_id = $1 AND se.success = true
       GROUP BY se.shard_id, ps.name, ps.category, ps.knowledge_type, ps.verification_status
       ORDER BY hit_count DESC
       LIMIT 50`,
      [user.tenant_id]
    );

    // Get knowledge type distribution
    const knowledgeTypeStats = await query<{
      knowledge_type: string;
      count: string;
    }>(
      `SELECT
         COALESCE(ps.knowledge_type, 'procedural') as knowledge_type,
         COUNT(DISTINCT se.shard_id)::text as count
       FROM shard_executions se
       JOIN procedural_shards ps ON se.shard_id = ps.id
       WHERE se.executor_tenant_id = $1 AND se.success = true
       GROUP BY ps.knowledge_type
       ORDER BY count DESC`,
      [user.tenant_id]
    );

    // Get daily stats for the last 30 days
    const dailyStats = await query<{
      date: string;
      hits: string;
      tokens_saved: string;
    }>(
      `SELECT
         DATE(created_at) as date,
         COUNT(*) as hits,
         COALESCE(SUM(tokens_saved), 0) as tokens_saved
       FROM shard_executions
       WHERE executor_tenant_id = $1
         AND success = true
         AND created_at >= NOW() - INTERVAL '30 days'
       GROUP BY DATE(created_at)
       ORDER BY date DESC`,
      [user.tenant_id]
    );

    // Get category breakdown
    const categoryStats = await query<{
      category: string;
      hit_count: string;
      tokens_saved: string;
    }>(
      `SELECT
         COALESCE(ps.category, 'uncategorized') as category,
         COUNT(*) as hit_count,
         COALESCE(SUM(se.tokens_saved), 0) as tokens_saved
       FROM shard_executions se
       JOIN procedural_shards ps ON se.shard_id = ps.id
       WHERE se.executor_tenant_id = $1 AND se.success = true
       GROUP BY ps.category
       ORDER BY hit_count DESC`,
      [user.tenant_id]
    );

    return {
      totals: {
        shardHits: parseInt(totals?.total_hits ?? '0', 10),
        tokensSaved: parseInt(totals?.total_tokens_saved ?? '0', 10),
        uniqueShards: parseInt(totals?.unique_shards ?? '0', 10),
        firstHit: totals?.first_hit,
        lastHit: totals?.last_hit,
        // Estimated environmental impact
        estimatedPowerSavedWh: Math.round((parseInt(totals?.total_tokens_saved ?? '0', 10) / 1000) * 10),
      },
      shards: perShardStats.map(s => ({
        id: s.shard_id,
        name: s.shard_name,
        category: s.shard_category || 'uncategorized',
        knowledgeType: s.knowledge_type,
        verificationStatus: s.verification_status,
        hits: parseInt(s.hit_count, 10),
        tokensSaved: parseInt(s.tokens_saved, 10),
        avgExecutionMs: parseFloat(s.avg_execution_ms),
        firstHit: s.first_hit,
        lastHit: s.last_hit,
      })),
      knowledgeTypes: knowledgeTypeStats.map(kt => ({
        type: kt.knowledge_type,
        count: parseInt(kt.count, 10),
      })),
      daily: dailyStats.map(d => ({
        date: d.date,
        hits: parseInt(d.hits, 10),
        tokensSaved: parseInt(d.tokens_saved, 10),
      })),
      categories: categoryStats.map(c => ({
        category: c.category,
        hits: parseInt(c.hit_count, 10),
        tokensSaved: parseInt(c.tokens_saved, 10),
      })),
    };
  });

  // ============================================
  // ADMIN: USER MANAGEMENT
  // ============================================

  /**
   * Admin middleware - checks if user is admin
   */
  async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<{ user_id: string; tenant_id: string } | null> {
    const cookies = request.cookies as Record<string, string> | undefined;
    const sessionToken = cookies?.[SESSION_COOKIE_NAME];

    if (!sessionToken) {
      reply.code(401).send({ error: 'Not authenticated' });
      return null;
    }

    const tokenHash = await hashToken(sessionToken);
    const session = await queryOne<{ user_id: string }>(
      'SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > NOW() AND revoked = false',
      [tokenHash]
    );

    if (!session) {
      reply.code(401).send({ error: 'Not authenticated' });
      return null;
    }

    const user = await queryOne<{ id: string; tenant_id: string; role: string }>(
      'SELECT id, tenant_id, role FROM users WHERE id = $1',
      [session.user_id]
    );

    if (!user || user.role !== 'admin') {
      reply.code(403).send({ error: 'Admin access required' });
      return null;
    }

    return { user_id: user.id, tenant_id: user.tenant_id };
  }

  /**
   * List all users (admin only)
   */
  app.get('/api/admin/users', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return;

    const { search, role, status, plan, limit = '50', offset = '0' } = request.query as {
      search?: string;
      role?: string;
      status?: string;
      plan?: string;
      limit?: string;
      offset?: string;
    };

    let whereClause = 'WHERE 1=1';
    const params: (string | number)[] = [];
    let paramIndex = 1;

    if (search) {
      whereClause += ` AND (u.email ILIKE $${paramIndex} OR u.display_name ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    if (role) {
      whereClause += ` AND u.role = $${paramIndex}`;
      params.push(role);
      paramIndex++;
    }

    if (status) {
      whereClause += ` AND u.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    if (plan) {
      whereClause += ` AND p.name = $${paramIndex}`;
      params.push(plan);
      paramIndex++;
    }

    params.push(parseInt(limit, 10), parseInt(offset, 10));

    const users = await query<{
      id: string;
      email: string;
      display_name: string | null;
      role: string;
      status: string;
      email_verified: boolean;
      created_at: string;
      last_login_at: string | null;
      tenant_id: string;
      plan_name: string | null;
      plan_display_name: string | null;
    }>(`
      SELECT
        u.id, u.email, u.display_name, u.role, u.status, u.email_verified,
        u.created_at, u.last_login_at, u.tenant_id,
        p.name as plan_name, p.display_name as plan_display_name
      FROM users u
      LEFT JOIN subscriptions s ON u.tenant_id = s.tenant_id AND s.status = 'active'
      LEFT JOIN plans p ON s.plan_id = p.id
      ${whereClause}
      ORDER BY u.created_at DESC
      LIMIT $${paramIndex - 1} OFFSET $${paramIndex}
    `, params);

    const [countResult] = await query<{ total: string }>(`
      SELECT COUNT(*) as total
      FROM users u
      LEFT JOIN subscriptions s ON u.tenant_id = s.tenant_id AND s.status = 'active'
      LEFT JOIN plans p ON s.plan_id = p.id
      ${whereClause}
    `, params.slice(0, -2));

    return {
      users: users.map(u => ({
        id: u.id,
        email: u.email,
        name: u.display_name,
        role: u.role,
        status: u.status,
        emailVerified: u.email_verified,
        createdAt: u.created_at,
        lastLoginAt: u.last_login_at,
        tenantId: u.tenant_id,
        plan: u.plan_name || 'free',
        planDisplayName: u.plan_display_name || 'Free',
      })),
      total: parseInt(countResult?.total ?? '0', 10),
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10),
    };
  });

  /**
   * Get single user details (admin only)
   */
  app.get('/api/admin/users/:id', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return;

    const { id } = request.params as { id: string };

    const user = await queryOne<{
      id: string;
      email: string;
      display_name: string | null;
      role: string;
      status: string;
      email_verified: boolean;
      created_at: string;
      last_login_at: string | null;
      tenant_id: string;
      failed_login_attempts: number;
      locked_until: string | null;
    }>('SELECT * FROM users WHERE id = $1', [id]);

    if (!user) {
      return reply.code(404).send({ error: 'User not found' });
    }

    // Get subscription info
    const subscription = await queryOne<{
      plan_id: string;
      plan_name: string;
      plan_display_name: string;
      status: string;
      current_period_end: string | null;
    }>(`
      SELECT s.plan_id, p.name as plan_name, p.display_name as plan_display_name,
             s.status, s.current_period_end
      FROM subscriptions s
      JOIN plans p ON s.plan_id = p.id
      WHERE s.tenant_id = $1 AND s.status = 'active'
      ORDER BY s.created_at DESC LIMIT 1
    `, [user.tenant_id]);

    // Get usage stats
    const [stats] = await query<{
      shards_count: string;
      traces_count: string;
      executions_count: string;
    }>(`
      SELECT
        (SELECT COUNT(*) FROM procedural_shards WHERE owner_id = $1) as shards_count,
        (SELECT COUNT(*) FROM reasoning_traces WHERE owner_id = $1) as traces_count,
        (SELECT COUNT(*) FROM shard_executions se
         JOIN procedural_shards ps ON se.shard_id = ps.id
         WHERE ps.owner_id = $1) as executions_count
    `, [user.tenant_id]);

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.display_name,
        role: user.role,
        status: user.status,
        emailVerified: user.email_verified,
        createdAt: user.created_at,
        lastLoginAt: user.last_login_at,
        tenantId: user.tenant_id,
        failedLoginAttempts: user.failed_login_attempts,
        lockedUntil: user.locked_until,
      },
      subscription: subscription ? {
        planId: subscription.plan_id,
        planName: subscription.plan_name,
        planDisplayName: subscription.plan_display_name,
        status: subscription.status,
        currentPeriodEnd: subscription.current_period_end,
      } : null,
      stats: {
        shards: parseInt(stats?.shards_count ?? '0', 10),
        traces: parseInt(stats?.traces_count ?? '0', 10),
        executions: parseInt(stats?.executions_count ?? '0', 10),
      },
    };
  });

  /**
   * Update user (admin only)
   */
  app.patch('/api/admin/users/:id', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return;

    const { id } = request.params as { id: string };
    const body = request.body as {
      role?: 'user' | 'admin';
      status?: 'active' | 'suspended' | 'deleted';
      plan?: string;
      display_name?: string;
    };

    // Don't allow admin to modify themselves
    if (id === admin.user_id) {
      return reply.code(400).send({ error: 'Cannot modify your own account' });
    }

    const user = await queryOne<{ id: string; tenant_id: string }>(
      'SELECT id, tenant_id FROM users WHERE id = $1',
      [id]
    );

    if (!user) {
      return reply.code(404).send({ error: 'User not found' });
    }

    // Update user fields
    const updates: string[] = [];
    const params: (string | number)[] = [];
    let paramIndex = 1;

    if (body.role) {
      updates.push(`role = $${paramIndex}`);
      params.push(body.role);
      paramIndex++;
    }

    if (body.status) {
      updates.push(`status = $${paramIndex}`);
      params.push(body.status);
      paramIndex++;

      // If suspending, also revoke all sessions
      if (body.status === 'suspended' || body.status === 'deleted') {
        await query('UPDATE sessions SET revoked = true WHERE user_id = $1', [id]);
      }
    }

    if (body.display_name !== undefined) {
      updates.push(`display_name = $${paramIndex}`);
      params.push(body.display_name);
      paramIndex++;
    }

    if (updates.length > 0) {
      params.push(id);
      await query(
        `UPDATE users SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${paramIndex}`,
        params
      );
    }

    // Update plan if specified
    if (body.plan) {
      const plan = await queryOne<{ id: string }>('SELECT id FROM plans WHERE name = $1', [body.plan]);
      if (!plan) {
        return reply.code(400).send({ error: 'Invalid plan name' });
      }

      // Deactivate existing subscriptions
      await query(
        "UPDATE subscriptions SET status = 'cancelled' WHERE tenant_id = $1 AND status = 'active'",
        [user.tenant_id]
      );

      // Create new subscription
      const subId = `sub_${Date.now()}`;
      await query(
        `INSERT INTO subscriptions (id, tenant_id, plan_id, status, current_period_start, current_period_end)
         VALUES ($1, $2, $3, 'active', NOW(), NOW() + INTERVAL '1 year')`,
        [subId, user.tenant_id, plan.id]
      );
    }

    // Log the action
    await query(
      `INSERT INTO audit_logs (tenant_id, user_id, action, resource_type, resource_id, details)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [admin.tenant_id, admin.user_id, 'admin.user.update', 'user', id, JSON.stringify(body)]
    );

    return { success: true };
  });

  /**
   * Delete user (admin only)
   */
  app.delete('/api/admin/users/:id', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return;

    const { id } = request.params as { id: string };

    // Don't allow admin to delete themselves
    if (id === admin.user_id) {
      return reply.code(400).send({ error: 'Cannot delete your own account' });
    }

    const user = await queryOne<{ id: string; tenant_id: string }>(
      'SELECT id, tenant_id FROM users WHERE id = $1',
      [id]
    );

    if (!user) {
      return reply.code(404).send({ error: 'User not found' });
    }

    // Soft delete - mark as deleted and revoke sessions
    await query("UPDATE users SET status = 'deleted', updated_at = NOW() WHERE id = $1", [id]);
    await query('UPDATE sessions SET revoked = true WHERE user_id = $1', [id]);

    // Log the action
    await query(
      `INSERT INTO audit_logs (tenant_id, user_id, action, resource_type, resource_id, details)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [admin.tenant_id, admin.user_id, 'admin.user.delete', 'user', id, '{}']
    );

    return { success: true };
  });

  /**
   * Create user (admin only)
   */
  app.post('/api/admin/users', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return;

    const body = request.body as {
      email: string;
      display_name?: string;
      password: string;
      role?: 'user' | 'admin';
      plan?: string;
    };

    if (!body.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
      return reply.code(400).send({ error: 'Valid email is required' });
    }

    if (!body.password || body.password.length < 8) {
      return reply.code(400).send({ error: 'Password must be at least 8 characters' });
    }

    const emailNormalized = normalizeEmail(body.email);

    const existingUser = await queryOne(
      'SELECT id FROM users WHERE email_normalized = $1',
      [emailNormalized]
    );

    if (existingUser) {
      return reply.code(409).send({ error: 'Email already registered' });
    }

    // Resolve plan
    let planId = 'plan_free';
    if (body.plan) {
      const plan = await queryOne<{ id: string }>(
        'SELECT id FROM plans WHERE name = $1',
        [body.plan]
      );
      if (!plan) {
        return reply.code(400).send({ error: `Invalid plan: ${body.plan}` });
      }
      planId = plan.id;
    }

    // Create tenant
    const tenantId = `tenant_${ulid()}`;
    const emailLocal = emailNormalized.split('@')[0] ?? 'user';
    const tenantSlug = emailLocal.replace(/[^a-z0-9]/g, '-') + '-' + ulid().slice(-6).toLowerCase();

    await query(
      `INSERT INTO tenants (id, name, slug, type, tier, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'user', $4, 'active', NOW(), NOW())`,
      [tenantId, body.display_name || emailLocal, tenantSlug, body.plan || 'free']
    );

    // Create user
    const userId = `user_${ulid()}`;
    const passwordHash = await hashPassword(body.password);
    const role = body.role || 'user';

    await query(
      `INSERT INTO users (
        id, tenant_id, email, email_normalized, password_hash,
        display_name, email_verified, status, role, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, true, 'active', $7, NOW(), NOW())`,
      [userId, tenantId, body.email, emailNormalized, passwordHash, body.display_name ?? null, role]
    );

    // Create subscription
    await query(
      `INSERT INTO subscriptions (id, tenant_id, plan_id, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'active', NOW(), NOW())`,
      [`sub_${ulid()}`, tenantId, planId]
    );

    // Audit log
    await query(
      `INSERT INTO audit_logs (tenant_id, user_id, action, resource_type, resource_id, details)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [admin.tenant_id, admin.user_id, 'admin.user.create', 'user', userId, JSON.stringify({ email: body.email, role, plan: body.plan || 'free' })]
    );

    // Send welcome email (non-blocking)
    const websiteUrl = process.env['APP_URL'] ?? 'https://askalf.org';
    const dashboardUrl = process.env['DASHBOARD_URL'] ?? 'https://app.askalf.org';
    sendWelcomeEmail(body.email, {
      userName: body.display_name ?? body.email.split('@')[0] ?? 'there',
      planName: body.plan || 'Free',
      dashboardUrl,
      docsUrl: `${websiteUrl}/docs.html`,
    }).catch(() => {});

    return { success: true, userId, email: body.email };
  });

  /**
   * Get all plans (admin only)
   */
  app.get('/api/admin/plans', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return;

    const plans = await query<{
      id: string;
      name: string;
      display_name: string;
      price_monthly: number;
      price_yearly: number;
      limits: Record<string, number>;
    }>('SELECT * FROM plans ORDER BY price_monthly ASC');

    return { plans };
  });

  /**
   * Get admin dashboard stats
   */
  app.get('/api/admin/stats', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return;

    const [stats] = await query<{
      total_users: string;
      active_users: string;
      suspended_users: string;
      total_shards: string;
      total_traces: string;
      total_executions: string;
      users_today: string;
      executions_today: string;
    }>(`
      SELECT
        (SELECT COUNT(*) FROM users) as total_users,
        (SELECT COUNT(*) FROM users WHERE status = 'active') as active_users,
        (SELECT COUNT(*) FROM users WHERE status = 'suspended') as suspended_users,
        (SELECT COUNT(*) FROM procedural_shards) as total_shards,
        (SELECT COUNT(*) FROM reasoning_traces) as total_traces,
        (SELECT COUNT(*) FROM shard_executions) as total_executions,
        (SELECT COUNT(*) FROM users WHERE created_at >= CURRENT_DATE) as users_today,
        (SELECT COUNT(*) FROM shard_executions WHERE created_at >= CURRENT_DATE) as executions_today
    `);

    return {
      users: {
        total: parseInt(stats?.total_users ?? '0', 10),
        active: parseInt(stats?.active_users ?? '0', 10),
        suspended: parseInt(stats?.suspended_users ?? '0', 10),
        today: parseInt(stats?.users_today ?? '0', 10),
      },
      content: {
        shards: parseInt(stats?.total_shards ?? '0', 10),
        traces: parseInt(stats?.total_traces ?? '0', 10),
        executions: parseInt(stats?.total_executions ?? '0', 10),
        executionsToday: parseInt(stats?.executions_today ?? '0', 10),
      },
    };
  });
}
