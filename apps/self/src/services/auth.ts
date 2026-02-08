/**
 * SELF Auth Service
 * Independent user management for SELF (not shared substrate users).
 * Reuses crypto helpers from @substrate/auth.
 */

import { ulid } from 'ulid';
import {
  hashPassword,
  verifyPassword,
  validatePasswordStrength,
  generateSessionToken,
  hashToken,
} from '@substrate/auth';
import { query, queryOne } from '../database.js';

// ============================================
// Types
// ============================================

export interface SelfUser {
  id: string;
  email: string;
  email_normalized: string;
  display_name: string | null;
  preferred_name: string | null;
  status: string;
  role: string;
  email_verified: boolean;
  last_login_at: string | null;
  created_at: string;
}

interface SelfUserWithPassword extends SelfUser {
  password_hash: string;
  failed_login_attempts: number;
  locked_until: string | null;
}

export interface SelfSession {
  id: string;
  user_id: string;
  expires_at: string;
  revoked: boolean;
  last_active_at: string;
}

// ============================================
// Constants
// ============================================

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MINUTES = 15;
const SESSION_DURATION_DAYS = 7;

// ============================================
// Helpers
// ============================================

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function detectDeviceType(userAgent?: string): string {
  if (!userAgent) return 'unknown';
  if (/mobile|android|iphone|ipad/i.test(userAgent)) return 'mobile';
  if (/tablet|ipad/i.test(userAgent)) return 'tablet';
  return 'desktop';
}

// ============================================
// User Management
// ============================================

export async function createUser(
  email: string,
  password: string,
  displayName?: string,
): Promise<SelfUser> {
  const emailNormalized = normalizeEmail(email);

  // Check if user already exists
  const existing = await queryOne<{ id: string }>(
    'SELECT id FROM self_users WHERE email_normalized = $1',
    [emailNormalized],
  );
  if (existing) {
    throw new Error('An account with this email already exists');
  }

  // Validate password strength
  const strength = validatePasswordStrength(password);
  if (!strength.valid) {
    throw new Error(`Password too weak: ${strength.errors.join(', ')}`);
  }

  const id = ulid();
  const passwordHash = await hashPassword(password);

  const user = await queryOne<SelfUser>(
    `INSERT INTO self_users (id, email, email_normalized, password_hash, display_name, status, role)
     VALUES ($1, $2, $3, $4, $5, 'active', 'user')
     RETURNING id, email, email_normalized, display_name, preferred_name, status, role, email_verified, last_login_at, created_at`,
    [id, email.trim(), emailNormalized, passwordHash, displayName?.trim() || null],
  );

  if (!user) throw new Error('Failed to create user');
  return user;
}

export async function authenticateUser(
  email: string,
  password: string,
): Promise<SelfUser> {
  const emailNormalized = normalizeEmail(email);

  const user = await queryOne<SelfUserWithPassword>(
    `SELECT id, email, email_normalized, password_hash, display_name, preferred_name,
            status, role, email_verified, failed_login_attempts, locked_until,
            last_login_at, created_at
     FROM self_users
     WHERE email_normalized = $1`,
    [emailNormalized],
  );

  if (!user) {
    throw new Error('Invalid email or password');
  }

  if (user.status !== 'active') {
    throw new Error('Account is disabled');
  }

  // Check lockout
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    const minutesLeft = Math.ceil(
      (new Date(user.locked_until).getTime() - Date.now()) / 60000,
    );
    throw new Error(`Account is locked. Try again in ${minutesLeft} minute${minutesLeft !== 1 ? 's' : ''}`);
  }

  // Verify password
  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    const attempts = user.failed_login_attempts + 1;
    if (attempts >= MAX_FAILED_ATTEMPTS) {
      const lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_MINUTES * 60000);
      await query(
        `UPDATE self_users
         SET failed_login_attempts = $1, locked_until = $2, updated_at = NOW()
         WHERE id = $3`,
        [attempts, lockedUntil.toISOString(), user.id],
      );
    } else {
      await query(
        `UPDATE self_users
         SET failed_login_attempts = $1, updated_at = NOW()
         WHERE id = $2`,
        [attempts, user.id],
      );
    }
    throw new Error('Invalid email or password');
  }

  // Reset failed attempts on successful login
  await query(
    `UPDATE self_users
     SET failed_login_attempts = 0, locked_until = NULL, last_login_at = NOW(), updated_at = NOW()
     WHERE id = $1`,
    [user.id],
  );

  return {
    id: user.id,
    email: user.email,
    email_normalized: user.email_normalized,
    display_name: user.display_name,
    preferred_name: user.preferred_name,
    status: user.status,
    role: user.role,
    email_verified: user.email_verified,
    last_login_at: new Date().toISOString(),
    created_at: user.created_at,
  };
}

export async function getUserById(id: string): Promise<SelfUser | null> {
  return queryOne<SelfUser>(
    `SELECT id, email, email_normalized, display_name, preferred_name,
            status, role, email_verified, last_login_at, created_at
     FROM self_users
     WHERE id = $1 AND status = 'active'`,
    [id],
  );
}

// ============================================
// Session Management
// ============================================

export async function createSession(
  userId: string,
  ip?: string,
  userAgent?: string,
): Promise<string> {
  const id = ulid();
  const token = generateSessionToken();
  const tokenHash = await hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_DURATION_DAYS * 24 * 60 * 60 * 1000);
  const deviceType = detectDeviceType(userAgent);

  await query(
    `INSERT INTO self_sessions (id, user_id, token_hash, ip_address, user_agent, device_type, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, userId, tokenHash, ip || null, userAgent || null, deviceType, expiresAt.toISOString()],
  );

  return token;
}

export async function validateSession(
  token: string,
): Promise<{ session: SelfSession; user: SelfUser } | null> {
  const tokenHash = await hashToken(token);

  const session = await queryOne<SelfSession>(
    `SELECT id, user_id, expires_at, revoked, last_active_at
     FROM self_sessions
     WHERE token_hash = $1`,
    [tokenHash],
  );

  if (!session || session.revoked || new Date(session.expires_at) < new Date()) {
    return null;
  }

  const user = await getUserById(session.user_id);
  if (!user) return null;

  // Update last_active_at (fire-and-forget)
  query(
    'UPDATE self_sessions SET last_active_at = NOW() WHERE id = $1',
    [session.id],
  ).catch(() => {});

  return { session, user };
}

export async function revokeSession(token: string): Promise<void> {
  const tokenHash = await hashToken(token);
  await query(
    'UPDATE self_sessions SET revoked = TRUE WHERE token_hash = $1',
    [tokenHash],
  );
}

// ============================================
// Password Reset
// ============================================

export async function requestPasswordReset(email: string): Promise<string | null> {
  const emailNormalized = normalizeEmail(email);

  const user = await queryOne<{ id: string }>(
    'SELECT id FROM self_users WHERE email_normalized = $1 AND status = $2',
    [emailNormalized, 'active'],
  );

  if (!user) return null; // Don't reveal if email exists

  const token = ulid();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  await query(
    `UPDATE self_users
     SET password_reset_token = $1, password_reset_token_expires_at = $2, updated_at = NOW()
     WHERE id = $3`,
    [token, expiresAt.toISOString(), user.id],
  );

  return token;
}

export async function resetPassword(
  token: string,
  newPassword: string,
): Promise<void> {
  const strength = validatePasswordStrength(newPassword);
  if (!strength.valid) {
    throw new Error(`Password too weak: ${strength.errors.join(', ')}`);
  }

  const user = await queryOne<{ id: string; password_reset_token_expires_at: string }>(
    `SELECT id, password_reset_token_expires_at
     FROM self_users
     WHERE password_reset_token = $1 AND status = 'active'`,
    [token],
  );

  if (!user) {
    throw new Error('Invalid or expired reset token');
  }

  if (new Date(user.password_reset_token_expires_at) < new Date()) {
    throw new Error('Reset token has expired');
  }

  const passwordHash = await hashPassword(newPassword);

  await query(
    `UPDATE self_users
     SET password_hash = $1, password_reset_token = NULL, password_reset_token_expires_at = NULL,
         failed_login_attempts = 0, locked_until = NULL, updated_at = NOW()
     WHERE id = $2`,
    [passwordHash, user.id],
  );

  // Revoke all existing sessions
  await query(
    'UPDATE self_sessions SET revoked = TRUE WHERE user_id = $1',
    [user.id],
  );
}
