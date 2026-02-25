// SUBSTRATE v1: Session Management
// HTTP session creation, validation, and revocation

import { ulid } from 'ulid';
import { query, queryOne } from '@askalf/database';
import { generateSessionToken, hashToken } from './password.js';
import { getUserById, toSafeUser } from './users.js';
import type { Session, SessionMetadata, SessionWithUser, SafeUser } from './types.js';

// Session settings
const SESSION_DURATION_DAYS = 7;
const SESSION_REFRESH_THRESHOLD_HOURS = 24; // Refresh if less than this time remaining

/**
 * Convert a database row to a Session object
 */
function rowToSession(row: Record<string, unknown>): Session {
  return {
    id: row['id'] as string,
    user_id: row['user_id'] as string,
    token_hash: row['token_hash'] as string,
    ip_address: row['ip_address'] as string | null,
    user_agent: row['user_agent'] as string | null,
    device_type: row['device_type'] as Session['device_type'],
    expires_at: new Date(row['expires_at'] as string),
    last_active_at: new Date(row['last_active_at'] as string),
    revoked: row['revoked'] as boolean,
    revoked_at: row['revoked_at'] ? new Date(row['revoked_at'] as string) : null,
    revoked_reason: row['revoked_reason'] as string | null,
    created_at: new Date(row['created_at'] as string),
  };
}

/**
 * Detect device type from user agent
 */
function detectDeviceType(
  userAgent?: string
): 'desktop' | 'mobile' | 'tablet' | null {
  if (!userAgent) return null;

  const ua = userAgent.toLowerCase();

  if (/tablet|ipad|playbook|silk/.test(ua)) {
    return 'tablet';
  }

  if (
    /mobile|iphone|ipod|android|blackberry|opera mini|opera mobi|webos|windows phone/.test(
      ua
    )
  ) {
    return 'mobile';
  }

  return 'desktop';
}

/**
 * Create a new session for a user
 * Returns the session token (to be set in cookie) and the session object
 */
export async function createSession(
  userId: string,
  metadata?: SessionMetadata
): Promise<{ token: string; session: Session }> {
  const id = `sess_${ulid()}`;
  const token = generateSessionToken();
  const tokenHash = await hashToken(token);
  const expiresAt = new Date(
    Date.now() + SESSION_DURATION_DAYS * 24 * 60 * 60 * 1000
  );
  const deviceType = metadata?.device_type ?? detectDeviceType(metadata?.user_agent);

  const sql = `
    INSERT INTO sessions (
      id, user_id, token_hash, ip_address, user_agent, device_type,
      expires_at, last_active_at, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
    RETURNING *
  `;

  const rows = await query<Record<string, unknown>>(sql, [
    id,
    userId,
    tokenHash,
    metadata?.ip_address ?? null,
    metadata?.user_agent ?? null,
    deviceType,
    expiresAt,
  ]);

  if (!rows[0]) {
    throw new Error('Failed to create session');
  }

  return { token, session: rowToSession(rows[0]) };
}

/**
 * Validate a session token
 * Returns the session if valid, null otherwise
 */
export async function validateSession(token: string): Promise<Session | null> {
  const tokenHash = await hashToken(token);

  const sql = `
    SELECT * FROM sessions
    WHERE token_hash = $1
      AND expires_at > NOW()
      AND revoked = false
  `;

  const row = await queryOne<Record<string, unknown>>(sql, [tokenHash]);

  if (!row) {
    return null;
  }

  // Update last_active_at
  await query(
    'UPDATE sessions SET last_active_at = NOW() WHERE id = $1',
    [row['id']]
  );

  return rowToSession(row);
}

/**
 * Validate a session and return with user data
 */
export async function validateSessionWithUser(
  token: string
): Promise<SessionWithUser | null> {
  const session = await validateSession(token);

  if (!session) {
    return null;
  }

  const user = await getUserById(session.user_id);

  if (!user || user.status !== 'active') {
    // User deleted or suspended - revoke session
    await revokeSession(token, 'user_inactive');
    return null;
  }

  return {
    ...session,
    user: toSafeUser(user),
  };
}

/**
 * Refresh a session if it's close to expiring
 * Returns a new token if refreshed, null if not needed
 */
export async function refreshSession(
  token: string
): Promise<{ token: string; session: Session } | null> {
  const session = await validateSession(token);

  if (!session) {
    return null;
  }

  // Check if refresh is needed
  const timeRemaining = session.expires_at.getTime() - Date.now();
  const refreshThreshold = SESSION_REFRESH_THRESHOLD_HOURS * 60 * 60 * 1000;

  if (timeRemaining > refreshThreshold) {
    // No refresh needed
    return null;
  }

  // Generate new token and extend expiration
  const newToken = generateSessionToken();
  const newTokenHash = await hashToken(newToken);
  const newExpiresAt = new Date(
    Date.now() + SESSION_DURATION_DAYS * 24 * 60 * 60 * 1000
  );

  const sql = `
    UPDATE sessions
    SET token_hash = $1, expires_at = $2, last_active_at = NOW()
    WHERE id = $3
    RETURNING *
  `;

  const rows = await query<Record<string, unknown>>(sql, [
    newTokenHash,
    newExpiresAt,
    session.id,
  ]);

  if (!rows[0]) {
    return null;
  }

  return { token: newToken, session: rowToSession(rows[0]) };
}

/**
 * Revoke a session by token
 */
export async function revokeSession(
  token: string,
  reason?: string
): Promise<boolean> {
  const tokenHash = await hashToken(token);

  const sql = `
    UPDATE sessions
    SET revoked = true, revoked_at = NOW(), revoked_reason = $1
    WHERE token_hash = $2 AND revoked = false
    RETURNING id
  `;

  const rows = await query<{ id: string }>(sql, [reason ?? 'manual', tokenHash]);
  return rows.length > 0;
}

/**
 * Revoke a session by ID
 */
export async function revokeSessionById(
  sessionId: string,
  reason?: string
): Promise<boolean> {
  const sql = `
    UPDATE sessions
    SET revoked = true, revoked_at = NOW(), revoked_reason = $1
    WHERE id = $2 AND revoked = false
    RETURNING id
  `;

  const rows = await query<{ id: string }>(sql, [reason ?? 'manual', sessionId]);
  return rows.length > 0;
}

/**
 * Revoke all sessions for a user
 */
export async function revokeAllUserSessions(
  userId: string,
  reason?: string
): Promise<number> {
  const sql = `
    UPDATE sessions
    SET revoked = true, revoked_at = NOW(), revoked_reason = $1
    WHERE user_id = $2 AND revoked = false
    RETURNING id
  `;

  const rows = await query<{ id: string }>(sql, [
    reason ?? 'revoke_all',
    userId,
  ]);
  return rows.length;
}

/**
 * Revoke all sessions except the current one
 */
export async function revokeOtherSessions(
  userId: string,
  currentSessionId: string,
  reason?: string
): Promise<number> {
  const sql = `
    UPDATE sessions
    SET revoked = true, revoked_at = NOW(), revoked_reason = $1
    WHERE user_id = $2 AND id != $3 AND revoked = false
    RETURNING id
  `;

  const rows = await query<{ id: string }>(sql, [
    reason ?? 'revoke_others',
    userId,
    currentSessionId,
  ]);
  return rows.length;
}

/**
 * List active sessions for a user
 */
export async function listUserSessions(userId: string): Promise<Session[]> {
  const sql = `
    SELECT * FROM sessions
    WHERE user_id = $1 AND revoked = false AND expires_at > NOW()
    ORDER BY last_active_at DESC
  `;

  const rows = await query<Record<string, unknown>>(sql, [userId]);
  return rows.map(rowToSession);
}

/**
 * Get session by ID (for admin viewing)
 */
export async function getSessionById(id: string): Promise<Session | null> {
  const sql = 'SELECT * FROM sessions WHERE id = $1';
  const row = await queryOne<Record<string, unknown>>(sql, [id]);
  return row ? rowToSession(row) : null;
}

/**
 * Clean up expired sessions (run periodically)
 */
export async function cleanupExpiredSessions(): Promise<number> {
  const sql = `
    DELETE FROM sessions
    WHERE expires_at < NOW() - INTERVAL '30 days'
       OR (revoked = true AND revoked_at < NOW() - INTERVAL '30 days')
    RETURNING id
  `;

  const rows = await query<{ id: string }>(sql);
  return rows.length;
}

/**
 * Count active sessions for a user
 */
export async function countUserSessions(userId: string): Promise<number> {
  const sql = `
    SELECT COUNT(*) as count FROM sessions
    WHERE user_id = $1 AND revoked = false AND expires_at > NOW()
  `;

  const row = await queryOne<{ count: string }>(sql, [userId]);
  return parseInt(row?.count ?? '0', 10);
}
