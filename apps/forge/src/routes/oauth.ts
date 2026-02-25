/**
 * OAuth Login Routes
 * Supports Google, GitHub, and Apple OAuth 2.0 login flows.
 * Links OAuth accounts to existing users (by email) or creates new users.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ulid } from 'ulid';
import { createHash } from 'node:crypto';
import { query, queryOne, transaction } from '../database.js';
import { generateCsrfToken } from '../middleware/csrf-protection.js';

// ============================================
// Types
// ============================================

interface OAuthProviderConfig {
  clientId: string;
  clientSecret: string;
  authorizeUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  scopes: string[];
  /** Extra params for the authorize URL */
  extraParams?: Record<string, string>;
}

interface OAuthTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type: string;
  id_token?: string;
}

interface OAuthUserInfo {
  provider_user_id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  raw_profile: Record<string, unknown>;
}

type Provider = 'google' | 'github' | 'apple';

// ============================================
// Cookie config (mirrored from auth.ts)
// ============================================

const SESSION_COOKIE_NAME = 'substrate_session';
const isProduction = process.env['NODE_ENV'] === 'production';
const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: isProduction,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 7 * 24 * 60 * 60, // 7 days (seconds)
};

function getCookieDomain(host: string): string | undefined {
  if (!isProduction) return undefined;
  if (host.includes('askalf.org')) return '.askalf.org';
  return undefined;
}

// ============================================
// Helpers
// ============================================

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
// Provider Configs
// ============================================

function getProviderConfig(provider: Provider): OAuthProviderConfig | null {
  switch (provider) {
    case 'google': {
      const clientId = process.env['GOOGLE_CLIENT_ID'];
      const clientSecret = process.env['GOOGLE_CLIENT_SECRET'];
      if (!clientId || !clientSecret) return null;
      return {
        clientId,
        clientSecret,
        authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        userInfoUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
        scopes: ['openid', 'email', 'profile'],
        extraParams: { access_type: 'offline', prompt: 'consent' },
      };
    }
    case 'github': {
      const clientId = process.env['GITHUB_CLIENT_ID'];
      const clientSecret = process.env['GITHUB_CLIENT_SECRET'];
      if (!clientId || !clientSecret) return null;
      return {
        clientId,
        clientSecret,
        authorizeUrl: 'https://github.com/login/oauth/authorize',
        tokenUrl: 'https://github.com/login/oauth/access_token',
        userInfoUrl: 'https://api.github.com/user',
        scopes: ['user:email', 'read:user'],
      };
    }
    case 'apple': {
      const clientId = process.env['APPLE_CLIENT_ID'];
      const clientSecret = process.env['APPLE_CLIENT_SECRET'];
      if (!clientId || !clientSecret) return null;
      return {
        clientId,
        clientSecret,
        authorizeUrl: 'https://appleid.apple.com/auth/authorize',
        tokenUrl: 'https://appleid.apple.com/auth/token',
        userInfoUrl: '', // Apple sends user info in the id_token
        scopes: ['name', 'email'],
        extraParams: { response_mode: 'form_post' },
      };
    }
    default:
      return null;
  }
}

function getRedirectUri(provider: Provider): string {
  const base = isProduction ? 'https://askalf.org' : 'http://localhost:3001';
  return `${base}/api/v1/auth/oauth/${provider}/callback`;
}

// ============================================
// Token Exchange
// ============================================

async function exchangeCodeForTokens(
  provider: Provider,
  config: OAuthProviderConfig,
  code: string,
): Promise<OAuthTokenResponse> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    redirect_uri: getRedirectUri(provider),
    grant_type: 'authorization_code',
  });

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
  };

  // GitHub needs Accept header for JSON response
  if (provider === 'github') {
    headers['Accept'] = 'application/json';
  }

  const response = await fetch(config.tokenUrl, {
    method: 'POST',
    headers,
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token exchange failed (${response.status}): ${text}`);
  }

  return response.json() as Promise<OAuthTokenResponse>;
}

// ============================================
// User Info Fetchers
// ============================================

async function fetchUserInfo(
  provider: Provider,
  config: OAuthProviderConfig,
  tokens: OAuthTokenResponse,
): Promise<OAuthUserInfo> {
  switch (provider) {
    case 'google':
      return fetchGoogleUserInfo(config, tokens);
    case 'github':
      return fetchGithubUserInfo(tokens);
    case 'apple':
      return fetchAppleUserInfo(tokens);
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}

async function fetchGoogleUserInfo(
  config: OAuthProviderConfig,
  tokens: OAuthTokenResponse,
): Promise<OAuthUserInfo> {
  const response = await fetch(config.userInfoUrl, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  if (!response.ok) {
    throw new Error(`Google user info failed: ${response.status}`);
  }

  const profile = await response.json() as Record<string, unknown>;
  return {
    provider_user_id: String(profile['id']),
    email: String(profile['email']),
    display_name: (profile['name'] as string) ?? null,
    avatar_url: (profile['picture'] as string) ?? null,
    raw_profile: profile,
  };
}

async function fetchGithubUserInfo(tokens: OAuthTokenResponse): Promise<OAuthUserInfo> {
  const headers = {
    Authorization: `Bearer ${tokens.access_token}`,
    Accept: 'application/vnd.github+json',
  };

  // Fetch user profile
  const userResponse = await fetch('https://api.github.com/user', { headers });
  if (!userResponse.ok) {
    throw new Error(`GitHub user info failed: ${userResponse.status}`);
  }
  const profile = await userResponse.json() as Record<string, unknown>;

  // Fetch primary email (may not be in profile if email is private)
  let email = profile['email'] as string | null;
  if (!email) {
    const emailResponse = await fetch('https://api.github.com/user/emails', { headers });
    if (emailResponse.ok) {
      const emails = await emailResponse.json() as Array<{ email: string; primary: boolean; verified: boolean }>;
      const primary = emails.find((e) => e.primary && e.verified);
      email = primary?.email ?? emails.find((e) => e.verified)?.email ?? null;
    }
  }

  if (!email) {
    throw new Error('Could not retrieve email from GitHub. Please ensure your GitHub email is verified.');
  }

  return {
    provider_user_id: String(profile['id']),
    email,
    display_name: (profile['name'] as string) ?? (profile['login'] as string) ?? null,
    avatar_url: (profile['avatar_url'] as string) ?? null,
    raw_profile: profile,
  };
}

async function fetchAppleUserInfo(tokens: OAuthTokenResponse): Promise<OAuthUserInfo> {
  // Apple sends user info in the id_token JWT
  const idToken = tokens.id_token;
  if (!idToken) {
    throw new Error('Apple did not return an id_token');
  }

  // Decode JWT payload (we trust Apple's token since we just exchanged it)
  const parts = idToken.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid Apple id_token format');
  }
  const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString()) as Record<string, unknown>;

  const email = payload['email'] as string | undefined;
  if (!email) {
    throw new Error('Apple id_token did not contain an email');
  }

  return {
    provider_user_id: String(payload['sub']),
    email,
    display_name: null, // Apple only sends name on first auth, handled via form_post
    avatar_url: null,
    raw_profile: payload,
  };
}

// ============================================
// Session Creation (shared with auth.ts pattern)
// ============================================

async function createSessionForUser(
  userId: string,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<{ csrfToken: string }> {
  const sessionId = `sess_${ulid()}`;
  const sessionToken = generateSessionToken();
  const tokenHash = await hashToken(sessionToken);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const deviceType = detectDeviceType(request.headers['user-agent'] as string);
  const csrfToken = generateCsrfToken();

  await query(
    `INSERT INTO sessions (id, user_id, token_hash, csrf_token, ip_address, user_agent, device_type, expires_at, last_active_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())`,
    [sessionId, userId, tokenHash, csrfToken, request.ip, request.headers['user-agent'], deviceType, expiresAt],
  );

  // Update last login
  await query(
    `UPDATE users SET last_login_at = NOW(), last_login_ip = $1, updated_at = NOW() WHERE id = $2`,
    [request.ip, userId],
  );

  // Set session cookie
  const host = (request.headers['x-forwarded-host'] as string) || request.headers.host || '';
  const cookieDomain = getCookieDomain(host);
  reply.setCookie(SESSION_COOKIE_NAME, sessionToken, {
    ...SESSION_COOKIE_OPTIONS,
    ...(cookieDomain ? { domain: cookieDomain } : {}),
  });

  return { csrfToken };
}

// ============================================
// Routes
// ============================================

export async function oauthRoutes(app: FastifyInstance): Promise<void> {

  // ------------------------------------------
  // GET /api/v1/auth/oauth/:provider
  // Initiates OAuth flow — redirects to provider
  // ------------------------------------------
  app.get('/api/v1/auth/oauth/:provider', async (request: FastifyRequest, reply: FastifyReply) => {
    const { provider } = request.params as { provider: string };

    if (!['google', 'github', 'apple'].includes(provider)) {
      return reply.code(400).send({ error: `Unsupported OAuth provider: ${provider}` });
    }

    const config = getProviderConfig(provider as Provider);
    if (!config) {
      return reply.code(501).send({ error: `OAuth provider "${provider}" is not configured` });
    }

    // Generate and store state for CSRF protection
    const state = generateSecureToken(32);
    await query(
      `INSERT INTO oauth_states (state, provider, redirect_uri, created_at, expires_at)
       VALUES ($1, $2, $3, NOW(), NOW() + INTERVAL '10 minutes')`,
      [state, provider, getRedirectUri(provider as Provider)],
    );

    // Clean up expired states (fire-and-forget)
    void query(`DELETE FROM oauth_states WHERE expires_at < NOW()`).catch(() => {});

    // Build authorization URL
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: getRedirectUri(provider as Provider),
      response_type: 'code',
      scope: config.scopes.join(' '),
      state,
      ...(config.extraParams ?? {}),
    });

    const authorizationUrl = `${config.authorizeUrl}?${params.toString()}`;
    return reply.redirect(authorizationUrl);
  });

  // ------------------------------------------
  // GET /api/v1/auth/oauth/:provider/callback
  // Handles OAuth callback — creates/links user, sets session
  // ------------------------------------------
  app.get('/api/v1/auth/oauth/:provider/callback', async (request: FastifyRequest, reply: FastifyReply) => {
    const { provider } = request.params as { provider: string };
    const { code, state, error: oauthError } = request.query as { code?: string; state?: string; error?: string };

    if (oauthError) {
      console.error(`[OAuth] ${provider} returned error: ${oauthError}`);
      return reply.redirect(`/login?error=oauth_denied`);
    }

    if (!code || !state) {
      return reply.redirect(`/login?error=oauth_missing_params`);
    }

    if (!['google', 'github', 'apple'].includes(provider)) {
      return reply.redirect(`/login?error=oauth_invalid_provider`);
    }

    // Validate state (CSRF check)
    const storedState = await queryOne<{ provider: string }>(
      `DELETE FROM oauth_states WHERE state = $1 AND expires_at > NOW() RETURNING provider`,
      [state],
    );

    if (!storedState || storedState.provider !== provider) {
      console.warn(`[OAuth] Invalid or expired state for ${provider}`);
      return reply.redirect(`/login?error=oauth_state_invalid`);
    }

    const config = getProviderConfig(provider as Provider);
    if (!config) {
      return reply.redirect(`/login?error=oauth_not_configured`);
    }

    try {
      // Exchange code for tokens
      const tokens = await exchangeCodeForTokens(provider as Provider, config, code);

      // Fetch user info from provider
      const userInfo = await fetchUserInfo(provider as Provider, config, tokens);

      const emailNormalized = userInfo.email.toLowerCase().trim();

      // Check if this OAuth account is already linked
      const existingOAuth = await queryOne<{ user_id: string }>(
        `SELECT user_id FROM user_oauth_accounts WHERE provider = $1 AND provider_user_id = $2`,
        [provider, userInfo.provider_user_id],
      );

      let userId: string;

      if (existingOAuth) {
        // Returning OAuth user — update tokens
        userId = existingOAuth.user_id;
        await query(
          `UPDATE user_oauth_accounts SET
            access_token = $1, refresh_token = $2,
            token_expires_at = $3,
            email = $4, display_name = $5, avatar_url = $6,
            raw_profile = $7, updated_at = NOW()
          WHERE provider = $8 AND provider_user_id = $9`,
          [
            tokens.access_token, tokens.refresh_token ?? null,
            tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null,
            userInfo.email, userInfo.display_name, userInfo.avatar_url,
            JSON.stringify(userInfo.raw_profile),
            provider, userInfo.provider_user_id,
          ],
        );
        console.log(`[OAuth] Returning user via ${provider}: ${userInfo.email} (${userId})`);
      } else {
        // New OAuth account — check if email matches existing user
        const existingUser = await queryOne<{ id: string; tenant_id: string }>(
          `SELECT id, tenant_id FROM users WHERE email_normalized = $1 AND status = 'active'`,
          [emailNormalized],
        );

        if (existingUser) {
          // Link OAuth to existing user
          userId = existingUser.id;
          await query(
            `INSERT INTO user_oauth_accounts (id, user_id, provider, provider_user_id, email, display_name, avatar_url, access_token, refresh_token, token_expires_at, raw_profile)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [
              `oauth_${ulid()}`, userId, provider, userInfo.provider_user_id,
              userInfo.email, userInfo.display_name, userInfo.avatar_url,
              tokens.access_token, tokens.refresh_token ?? null,
              tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null,
              JSON.stringify(userInfo.raw_profile),
            ],
          );
          // Update avatar if user doesn't have one
          if (userInfo.avatar_url) {
            await query(
              `UPDATE users SET avatar_url = COALESCE(avatar_url, $1), updated_at = NOW() WHERE id = $2`,
              [userInfo.avatar_url, userId],
            );
          }
          console.log(`[OAuth] Linked ${provider} to existing user: ${userInfo.email} (${userId})`);
        } else {
          // Create brand new user (no password)
          userId = await transaction(async (client) => {
            const tenantId = `tenant_${ulid()}`;
            const emailLocal = emailNormalized.split('@')[0] ?? 'user';
            const tenantSlug = emailLocal.replace(/[^a-z0-9]/g, '-') + '-' + ulid().slice(-6).toLowerCase();

            await client.query(
              `INSERT INTO tenants (id, name, slug, type, tier, status, created_at, updated_at)
               VALUES ($1, $2, $3, 'user', 'free', 'active', NOW(), NOW())`,
              [tenantId, userInfo.display_name || emailLocal, tenantSlug],
            );

            const newUserId = `user_${ulid()}`;
            await client.query(
              `INSERT INTO users (
                id, tenant_id, email, email_normalized, password_hash,
                email_verified, display_name, avatar_url, timezone,
                status, role, created_at, updated_at
              ) VALUES ($1, $2, $3, $4, NULL, true, $5, $6, 'UTC', 'active', 'admin', NOW(), NOW())`,
              [
                newUserId, tenantId, userInfo.email, emailNormalized,
                userInfo.display_name, userInfo.avatar_url,
              ],
            );

            await client.query(
              `INSERT INTO user_oauth_accounts (id, user_id, provider, provider_user_id, email, display_name, avatar_url, access_token, refresh_token, token_expires_at, raw_profile)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
              [
                `oauth_${ulid()}`, newUserId, provider, userInfo.provider_user_id,
                userInfo.email, userInfo.display_name, userInfo.avatar_url,
                tokens.access_token, tokens.refresh_token ?? null,
                tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null,
                JSON.stringify(userInfo.raw_profile),
              ],
            );

            return newUserId;
          });

          console.log(`[OAuth] New user created via ${provider}: ${userInfo.email} (${userId})`);
        }
      }

      // Verify user is still active
      const user = await queryOne<{ status: string }>(
        `SELECT status FROM users WHERE id = $1`,
        [userId],
      );
      if (!user || user.status !== 'active') {
        return reply.redirect(`/login?error=account_suspended`);
      }

      // Create session
      await createSessionForUser(userId, request, reply);

      // Audit log
      const userTenant = await queryOne<{ tenant_id: string }>(
        `SELECT tenant_id FROM users WHERE id = $1`,
        [userId],
      );
      void query(
        `INSERT INTO audit_logs (id, tenant_id, user_id, action, resource_type, resource_id, ip_address, user_agent, success, metadata, created_at)
         VALUES ($1, $2, $3, 'user.oauth_login', 'user', $3, $4, $5, true, $6, NOW())`,
        [
          `audit_${ulid()}`, userTenant?.tenant_id, userId,
          request.ip, request.headers['user-agent'],
          JSON.stringify({ provider, provider_user_id: userInfo.provider_user_id }),
        ],
      ).catch(() => {});

      // Redirect to dashboard
      return reply.redirect('/');
    } catch (err) {
      console.error(`[OAuth] ${provider} callback error:`, err);
      return reply.redirect(`/login?error=oauth_failed`);
    }
  });

  // ------------------------------------------
  // GET /api/v1/auth/oauth/providers
  // Returns which OAuth providers are configured
  // ------------------------------------------
  app.get('/api/v1/auth/oauth/providers', async () => {
    const providers: Array<{ provider: string; enabled: boolean }> = [
      { provider: 'google', enabled: !!getProviderConfig('google') },
      { provider: 'github', enabled: !!getProviderConfig('github') },
      { provider: 'apple', enabled: !!getProviderConfig('apple') },
    ];
    return { providers };
  });
}
