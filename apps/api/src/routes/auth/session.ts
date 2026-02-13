/**
 * Session Management
 * Session creation, validation, and revocation
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { query, queryOne } from '@substrate/database';
import { generateSessionToken, hashToken } from './jwt.js';
import { SESSION_COOKIE_NAME, SESSION_COOKIE_OPTIONS, getCookieDomain } from './cookies.js';

export interface Session {
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

export function detectDeviceType(userAgent?: string): 'desktop' | 'mobile' | 'tablet' | null {
  if (!userAgent) return null;
  const ua = userAgent.toLowerCase();

  if (/tablet|ipad|playbook|silk/.test(ua)) return 'tablet';
  if (/mobile|iphone|ipod|android|blackberry|mini|windows\s+phone/.test(ua)) return 'mobile';
  if (/windows|macintosh|linux/.test(ua)) return 'desktop';

  return null;
}

export async function createSession(
  userId: string,
  ipAddress: string | null,
  userAgent: string | null
): Promise<{ token: string; sessionId: string }> {
  const sessionId = generateSessionToken();
  const tokenHash = await hashToken(sessionId);
  const deviceType = detectDeviceType(userAgent ?? undefined);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  await query(
    `
    INSERT INTO sessions (id, user_id, token_hash, ip_address, user_agent, device_type, expires_at, last_active_at, revoked, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `,
    [userId, sessionId, tokenHash, ipAddress, userAgent, deviceType, expiresAt, new Date(), false, new Date()]
  );

  return { token: sessionId, sessionId };
}

export async function validateSession(token: string): Promise<Session | null> {
  const tokenHash = await hashToken(token);

  const session = await queryOne<Session>(
    `
    SELECT * FROM sessions
    WHERE token_hash = $1 AND revoked = false AND expires_at > NOW()
    LIMIT 1
    `,
    [tokenHash]
  );

  if (session) {
    // Update last_active_at
    await query(
      `UPDATE sessions SET last_active_at = NOW() WHERE id = $1`,
      [session.id]
    );
  }

  return session || null;
}

export async function revokeSession(sessionId: string, reason?: string): Promise<void> {
  await query(
    `
    UPDATE sessions
    SET revoked = true, revoked_at = NOW(), revoked_reason = $2
    WHERE id = $1
    `,
    [sessionId, reason || null]
  );
}

export async function revokeAllUserSessions(userId: string, exceptSessionId?: string): Promise<void> {
  const params = [userId];
  let query_str = `
    UPDATE sessions
    SET revoked = true, revoked_at = NOW(), revoked_reason = 'User revoked all sessions'
    WHERE user_id = $1
  `;

  if (exceptSessionId) {
    query_str += ` AND id != $2`;
    params.push(exceptSessionId);
  }

  await query(query_str, params);
}

export async function getUserSessions(userId: string): Promise<Session[]> {
  return query<Session>(
    `
    SELECT * FROM sessions
    WHERE user_id = $1 AND revoked = false
    ORDER BY last_active_at DESC
    `,
    [userId]
  );
}

export function setSessionCookie(
  reply: FastifyReply,
  token: string,
  host: string
): void {
  const cookieOptions = {
    ...SESSION_COOKIE_OPTIONS,
    domain: getCookieDomain(host),
  };

  reply.setCookie(SESSION_COOKIE_NAME, token, cookieOptions as Parameters<typeof reply.setCookie>[2]);
}

export function clearSessionCookie(reply: FastifyReply, host: string): void {
  const cookieOptions = {
    ...SESSION_COOKIE_OPTIONS,
    domain: getCookieDomain(host),
    maxAge: 0,
  };

  reply.clearCookie(SESSION_COOKIE_NAME, cookieOptions as Parameters<typeof reply.clearCookie>[1]);
}
