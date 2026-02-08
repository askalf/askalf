// SUBSTRATE v1: User Management
// User CRUD operations and related functions

import { ulid } from 'ulid';
import { query, queryOne, transaction } from '@substrate/database';
import type { PoolClient } from '@substrate/database';
import {
  hashPassword,
  verifyPassword,
  validatePasswordStrength,
  generateSecureToken,
} from './password.js';
import type {
  User,
  SafeUser,
  CreateUserInput,
  UpdateUserInput,
  AuditLogEntry,
} from './types.js';

// Account lockout settings
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MINUTES = 15;

// Token expiration settings
const EMAIL_VERIFICATION_HOURS = 24;
const PASSWORD_RESET_HOURS = 1;

/**
 * Normalize an email address for comparison
 */
export function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

/**
 * Convert a database row to a User object
 */
function rowToUser(row: Record<string, unknown>): User {
  return {
    id: row['id'] as string,
    tenant_id: row['tenant_id'] as string,
    email: row['email'] as string,
    email_normalized: row['email_normalized'] as string,
    password_hash: row['password_hash'] as string,
    email_verified: row['email_verified'] as boolean,
    email_verification_token: row['email_verification_token'] as string | null,
    email_verification_expires: row['email_verification_expires']
      ? new Date(row['email_verification_expires'] as string)
      : null,
    password_reset_token: row['password_reset_token'] as string | null,
    password_reset_expires: row['password_reset_expires']
      ? new Date(row['password_reset_expires'] as string)
      : null,
    status: row['status'] as User['status'],
    role: row['role'] as User['role'],
    display_name: row['display_name'] as string | null,
    avatar_url: row['avatar_url'] as string | null,
    timezone: row['timezone'] as string,
    failed_login_attempts: row['failed_login_attempts'] as number,
    locked_until: row['locked_until']
      ? new Date(row['locked_until'] as string)
      : null,
    last_login_at: row['last_login_at']
      ? new Date(row['last_login_at'] as string)
      : null,
    last_login_ip: row['last_login_ip'] as string | null,
    created_at: new Date(row['created_at'] as string),
    updated_at: new Date(row['updated_at'] as string),
  };
}

/**
 * Convert a User to a SafeUser (without sensitive fields)
 */
export function toSafeUser(user: User): SafeUser {
  const {
    password_hash,
    email_verification_token,
    password_reset_token,
    password_reset_expires,
    ...safeUser
  } = user;
  return safeUser;
}

/**
 * Create a new user
 */
export async function createUser(
  tenantId: string,
  input: CreateUserInput
): Promise<{ user: SafeUser; verificationToken: string }> {
  // Validate password strength
  const strength = validatePasswordStrength(input.password);
  if (!strength.valid) {
    throw new Error(`Password validation failed: ${strength.errors.join(', ')}`);
  }

  const id = `user_${ulid()}`;
  const emailNormalized = normalizeEmail(input.email);
  const passwordHash = await hashPassword(input.password);
  const verificationToken = generateSecureToken(32);
  const verificationExpires = new Date(
    Date.now() + EMAIL_VERIFICATION_HOURS * 60 * 60 * 1000
  );

  const sql = `
    INSERT INTO users (
      id, tenant_id, email, email_normalized, password_hash,
      email_verification_token, email_verification_expires,
      display_name, timezone, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
    RETURNING *
  `;

  const rows = await query<Record<string, unknown>>(sql, [
    id,
    tenantId,
    input.email,
    emailNormalized,
    passwordHash,
    verificationToken,
    verificationExpires,
    input.display_name ?? null,
    input.timezone ?? 'UTC',
  ]);

  if (!rows[0]) {
    throw new Error('Failed to create user');
  }

  const user = rowToUser(rows[0]);
  return { user: toSafeUser(user), verificationToken };
}

/**
 * Get a user by ID
 */
export async function getUserById(id: string): Promise<User | null> {
  const sql = 'SELECT * FROM users WHERE id = $1';
  const row = await queryOne<Record<string, unknown>>(sql, [id]);
  return row ? rowToUser(row) : null;
}

/**
 * Get a user by email
 */
export async function getUserByEmail(email: string): Promise<User | null> {
  const emailNormalized = normalizeEmail(email);
  const sql = 'SELECT * FROM users WHERE email_normalized = $1';
  const row = await queryOne<Record<string, unknown>>(sql, [emailNormalized]);
  return row ? rowToUser(row) : null;
}

/**
 * Get a safe user by ID (without sensitive fields)
 */
export async function getSafeUserById(id: string): Promise<SafeUser | null> {
  const user = await getUserById(id);
  return user ? toSafeUser(user) : null;
}

/**
 * Update a user
 */
export async function updateUser(
  id: string,
  input: UpdateUserInput
): Promise<SafeUser> {
  const updates: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (input.email !== undefined) {
    updates.push(`email = $${paramIndex}, email_normalized = $${paramIndex + 1}`);
    values.push(input.email, normalizeEmail(input.email));
    paramIndex += 2;
  }

  if (input.display_name !== undefined) {
    updates.push(`display_name = $${paramIndex}`);
    values.push(input.display_name);
    paramIndex++;
  }

  if (input.avatar_url !== undefined) {
    updates.push(`avatar_url = $${paramIndex}`);
    values.push(input.avatar_url);
    paramIndex++;
  }

  if (input.timezone !== undefined) {
    updates.push(`timezone = $${paramIndex}`);
    values.push(input.timezone);
    paramIndex++;
  }

  if (updates.length === 0) {
    const user = await getUserById(id);
    if (!user) throw new Error('User not found');
    return toSafeUser(user);
  }

  updates.push('updated_at = NOW()');
  values.push(id);

  const sql = `
    UPDATE users
    SET ${updates.join(', ')}
    WHERE id = $${paramIndex}
    RETURNING *
  `;

  const rows = await query<Record<string, unknown>>(sql, values);
  if (!rows[0]) throw new Error('User not found');
  return toSafeUser(rowToUser(rows[0]));
}

/**
 * Delete a user (soft delete - sets status to 'deleted')
 */
export async function deleteUser(id: string): Promise<void> {
  const sql = `
    UPDATE users
    SET status = 'deleted', updated_at = NOW()
    WHERE id = $1
  `;
  await query(sql, [id]);
}

/**
 * Permanently delete a user (hard delete)
 */
export async function hardDeleteUser(id: string): Promise<void> {
  const sql = 'DELETE FROM users WHERE id = $1';
  await query(sql, [id]);
}

/**
 * Verify email with token
 */
export async function verifyEmail(token: string): Promise<boolean> {
  const sql = `
    UPDATE users
    SET email_verified = true,
        email_verification_token = NULL,
        email_verification_expires = NULL,
        updated_at = NOW()
    WHERE email_verification_token = $1
      AND email_verification_expires > NOW()
      AND status = 'active'
    RETURNING id
  `;

  const rows = await query<{ id: string }>(sql, [token]);
  return rows.length > 0;
}

/**
 * Resend email verification
 */
export async function resendEmailVerification(
  userId: string
): Promise<string | null> {
  const token = generateSecureToken(32);
  const expires = new Date(
    Date.now() + EMAIL_VERIFICATION_HOURS * 60 * 60 * 1000
  );

  const sql = `
    UPDATE users
    SET email_verification_token = $1,
        email_verification_expires = $2,
        updated_at = NOW()
    WHERE id = $3
      AND email_verified = false
      AND status = 'active'
    RETURNING id
  `;

  const rows = await query<{ id: string }>(sql, [token, expires, userId]);
  return rows.length > 0 ? token : null;
}

/**
 * Request password reset
 */
export async function requestPasswordReset(
  email: string
): Promise<{ userId: string; token: string } | null> {
  const user = await getUserByEmail(email);
  if (!user || user.status !== 'active') {
    return null;
  }

  const token = generateSecureToken(32);
  const expires = new Date(
    Date.now() + PASSWORD_RESET_HOURS * 60 * 60 * 1000
  );

  const sql = `
    UPDATE users
    SET password_reset_token = $1,
        password_reset_expires = $2,
        updated_at = NOW()
    WHERE id = $3
    RETURNING id
  `;

  await query(sql, [token, expires, user.id]);
  return { userId: user.id, token };
}

/**
 * Reset password with token
 */
export async function resetPassword(
  token: string,
  newPassword: string
): Promise<boolean> {
  // Validate password strength
  const strength = validatePasswordStrength(newPassword);
  if (!strength.valid) {
    throw new Error(`Password validation failed: ${strength.errors.join(', ')}`);
  }

  const passwordHash = await hashPassword(newPassword);

  const sql = `
    UPDATE users
    SET password_hash = $1,
        password_reset_token = NULL,
        password_reset_expires = NULL,
        failed_login_attempts = 0,
        locked_until = NULL,
        updated_at = NOW()
    WHERE password_reset_token = $2
      AND password_reset_expires > NOW()
      AND status = 'active'
    RETURNING id
  `;

  const rows = await query<{ id: string }>(sql, [passwordHash, token]);
  return rows.length > 0;
}

/**
 * Change password (authenticated user)
 */
export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string
): Promise<boolean> {
  const user = await getUserById(userId);
  if (!user) {
    throw new Error('User not found');
  }

  // Verify current password
  const isValid = await verifyPassword(currentPassword, user.password_hash);
  if (!isValid) {
    throw new Error('Current password is incorrect');
  }

  // Validate new password strength
  const strength = validatePasswordStrength(newPassword);
  if (!strength.valid) {
    throw new Error(`Password validation failed: ${strength.errors.join(', ')}`);
  }

  const passwordHash = await hashPassword(newPassword);

  const sql = `
    UPDATE users
    SET password_hash = $1, updated_at = NOW()
    WHERE id = $2
  `;

  await query(sql, [passwordHash, userId]);
  return true;
}

/**
 * Attempt login and handle account lockout
 */
export async function attemptLogin(
  email: string,
  password: string,
  ipAddress?: string
): Promise<{ success: boolean; user?: User; error?: string }> {
  const user = await getUserByEmail(email);

  if (!user) {
    return { success: false, error: 'Invalid email or password' };
  }

  if (user.status !== 'active') {
    return { success: false, error: 'Account is not active' };
  }

  // Check if account is locked
  if (user.locked_until && user.locked_until > new Date()) {
    const remainingMinutes = Math.ceil(
      (user.locked_until.getTime() - Date.now()) / 60000
    );
    return {
      success: false,
      error: `Account is locked. Try again in ${remainingMinutes} minutes`,
    };
  }

  // Verify password
  const isValid = await verifyPassword(password, user.password_hash);

  if (!isValid) {
    // Increment failed attempts
    const newAttempts = user.failed_login_attempts + 1;
    const lockUntil =
      newAttempts >= MAX_LOGIN_ATTEMPTS
        ? new Date(Date.now() + LOCKOUT_DURATION_MINUTES * 60 * 1000)
        : null;

    await query(
      `
      UPDATE users
      SET failed_login_attempts = $1,
          locked_until = $2,
          updated_at = NOW()
      WHERE id = $3
    `,
      [newAttempts, lockUntil, user.id]
    );

    if (lockUntil) {
      return {
        success: false,
        error: `Too many failed attempts. Account locked for ${LOCKOUT_DURATION_MINUTES} minutes`,
      };
    }

    return { success: false, error: 'Invalid email or password' };
  }

  // Successful login - reset failed attempts and update last login
  await query(
    `
    UPDATE users
    SET failed_login_attempts = 0,
        locked_until = NULL,
        last_login_at = NOW(),
        last_login_ip = $1,
        updated_at = NOW()
    WHERE id = $2
  `,
    [ipAddress, user.id]
  );

  // Return updated user
  const updatedUser = await getUserById(user.id);
  return { success: true, user: updatedUser! };
}

/**
 * Suspend a user account
 */
export async function suspendUser(id: string): Promise<void> {
  await query(
    `UPDATE users SET status = 'suspended', updated_at = NOW() WHERE id = $1`,
    [id]
  );
}

/**
 * Unsuspend a user account
 */
export async function unsuspendUser(id: string): Promise<void> {
  await query(
    `UPDATE users SET status = 'active', updated_at = NOW() WHERE id = $1`,
    [id]
  );
}

/**
 * Update user role (admin only)
 */
export async function updateUserRole(
  id: string,
  role: User['role']
): Promise<void> {
  await query(
    `UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2`,
    [role, id]
  );
}

/**
 * List users for a tenant
 */
export async function listUsersByTenant(
  tenantId: string,
  options?: {
    status?: User['status'];
    limit?: number;
    offset?: number;
  }
): Promise<SafeUser[]> {
  const conditions = ['tenant_id = $1'];
  const params: unknown[] = [tenantId];
  let paramIndex = 2;

  if (options?.status) {
    conditions.push(`status = $${paramIndex}`);
    params.push(options.status);
    paramIndex++;
  }

  const sql = `
    SELECT * FROM users
    WHERE ${conditions.join(' AND ')}
    ORDER BY created_at DESC
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
  `;

  params.push(options?.limit ?? 50, options?.offset ?? 0);

  const rows = await query<Record<string, unknown>>(sql, params);
  return rows.map((row) => toSafeUser(rowToUser(row)));
}

/**
 * Count users for a tenant
 */
export async function countUsersByTenant(
  tenantId: string,
  status?: User['status']
): Promise<number> {
  let sql = 'SELECT COUNT(*) as count FROM users WHERE tenant_id = $1';
  const params: unknown[] = [tenantId];

  if (status) {
    sql += ' AND status = $2';
    params.push(status);
  }

  const row = await queryOne<{ count: string }>(sql, params);
  return parseInt(row?.count ?? '0', 10);
}

/**
 * Create an audit log entry
 */
export async function createAuditLog(entry: AuditLogEntry): Promise<void> {
  const sql = `
    INSERT INTO audit_logs (
      id, tenant_id, user_id, api_key_id, action, resource_type, resource_id,
      details, ip_address, user_agent, request_id, success, error_message, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
  `;

  await query(sql, [
    `audit_${ulid()}`,
    entry.tenant_id ?? null,
    entry.user_id ?? null,
    entry.api_key_id ?? null,
    entry.action,
    entry.resource_type ?? null,
    entry.resource_id ?? null,
    JSON.stringify(entry.details ?? {}),
    entry.ip_address ?? null,
    entry.user_agent ?? null,
    entry.request_id ?? null,
    entry.success ?? true,
    entry.error_message ?? null,
  ]);
}
