/**
 * Self Connection Routes
 * OAuth connection management for Google, Microsoft, GitHub
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ulid } from 'ulid';
import { selfQuery, selfQueryOne } from '../database.js';
import { authMiddleware } from '../middleware/auth.js';
import { encrypt } from '../utils/encryption.js';
import { loadConfig } from '../config.js';

const OAUTH_CONFIGS: Record<string, {
  authUrl: string;
  tokenUrl: string;
  scopes: string[];
  clientIdKey: 'googleClientId' | 'microsoftClientId' | 'githubClientId';
  clientSecretKey: 'googleClientSecret' | 'microsoftClientSecret' | 'githubClientSecret';
}> = {
  google: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['openid', 'profile', 'email', 'https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/calendar.readonly', 'https://www.googleapis.com/auth/contacts.readonly', 'https://www.googleapis.com/auth/drive.readonly'],
    clientIdKey: 'googleClientId',
    clientSecretKey: 'googleClientSecret',
  },
  microsoft: {
    authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scopes: ['openid', 'profile', 'email', 'Mail.Read', 'Calendars.Read', 'Files.Read', 'User.Read'],
    clientIdKey: 'microsoftClientId',
    clientSecretKey: 'microsoftClientSecret',
  },
  github: {
    authUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scopes: ['read:user', 'repo', 'read:org'],
    clientIdKey: 'githubClientId',
    clientSecretKey: 'githubClientSecret',
  },
};

export async function connectionRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/self/connections — List user's connections
   */
  app.get(
    '/api/v1/self/connections',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;

      const connections = await selfQuery<{
        provider: string;
        status: string;
        profile_data: unknown;
        connected_at: string;
        last_sync_at: string | null;
      }>(
        `SELECT provider, status, profile_data, connected_at, last_sync_at
         FROM user_connections WHERE user_id = $1`,
        [userId],
      );

      return reply.send({ connections });
    },
  );

  /**
   * GET /api/v1/self/connections/:provider/auth — Get OAuth authorization URL
   */
  app.get(
    '/api/v1/self/connections/:provider/auth',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { provider } = request.params as { provider: string };
      const config = loadConfig();
      const oauthConfig = OAUTH_CONFIGS[provider];

      if (!oauthConfig) {
        return reply.status(400).send({ error: `Unsupported provider: ${provider}` });
      }

      const clientId = config[oauthConfig.clientIdKey];
      if (!clientId) {
        return reply.status(503).send({ error: `${provider} OAuth not configured` });
      }

      const redirectUri = `${config.oauthRedirectBase || 'https://app.askalf.org'}/api/v1/self/connections/${provider}/callback`;

      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: oauthConfig.scopes.join(' '),
        access_type: 'offline',
        prompt: 'consent',
        state: request.userId!,
      });

      const authUrl = `${oauthConfig.authUrl}?${params.toString()}`;

      return reply.send({ authUrl, provider });
    },
  );

  /**
   * GET /api/v1/self/connections/:provider/callback — OAuth callback
   */
  app.get(
    '/api/v1/self/connections/:provider/callback',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { provider } = request.params as { provider: string };
      const query = request.query as { code?: string; state?: string; error?: string };

      if (query.error) {
        return reply.redirect(`/self?connection_error=${query.error}`);
      }

      if (!query.code || !query.state) {
        return reply.redirect('/self?connection_error=missing_params');
      }

      const userId = query.state;
      const config = loadConfig();
      const oauthConfig = OAUTH_CONFIGS[provider];

      if (!oauthConfig) {
        return reply.redirect('/self?connection_error=invalid_provider');
      }

      const clientId = config[oauthConfig.clientIdKey];
      const clientSecret = config[oauthConfig.clientSecretKey];

      if (!clientId || !clientSecret) {
        return reply.redirect('/self?connection_error=not_configured');
      }

      try {
        const redirectUri = `${config.oauthRedirectBase || 'https://app.askalf.org'}/api/v1/self/connections/${provider}/callback`;

        // Exchange code for tokens
        const tokenBody: Record<string, string> = {
          client_id: clientId,
          client_secret: clientSecret,
          code: query.code,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        };

        const tokenResponse = await fetch(oauthConfig.tokenUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json',
          },
          body: new URLSearchParams(tokenBody).toString(),
        });

        const tokens = await tokenResponse.json() as {
          access_token?: string;
          refresh_token?: string;
          expires_in?: number;
          error?: string;
        };

        if (tokens.error || !tokens.access_token) {
          return reply.redirect(`/self?connection_error=${tokens.error || 'token_exchange_failed'}`);
        }

        // Encrypt and store
        const accessTokenEnc = encrypt(tokens.access_token);
        const refreshTokenEnc = tokens.refresh_token ? encrypt(tokens.refresh_token) : null;
        const expiresAt = tokens.expires_in
          ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
          : null;

        await selfQuery(
          `INSERT INTO user_connections (id, user_id, provider, access_token_enc, refresh_token_enc, token_expires_at, scopes, status, connected_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', NOW())
           ON CONFLICT (user_id, provider) DO UPDATE SET
             access_token_enc = $4, refresh_token_enc = COALESCE($5, user_connections.refresh_token_enc),
             token_expires_at = $6, status = 'active', connected_at = NOW(), updated_at = NOW()`,
          [ulid(), userId, provider, accessTokenEnc, refreshTokenEnc, expiresAt, oauthConfig.scopes],
        );

        return reply.redirect(`/self?connected=${provider}`);
      } catch (err) {
        console.error(`[Self] OAuth callback error for ${provider}:`, err);
        return reply.redirect('/self?connection_error=callback_failed');
      }
    },
  );

  /**
   * DELETE /api/v1/self/connections/:provider — Disconnect
   */
  app.delete(
    '/api/v1/self/connections/:provider',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const { provider } = request.params as { provider: string };

      await selfQuery(
        `UPDATE user_connections SET status = 'revoked', updated_at = NOW()
         WHERE user_id = $1 AND provider = $2`,
        [userId, provider],
      );

      return reply.send({ disconnected: true, provider });
    },
  );
}
