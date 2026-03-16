/**
 * OAuth Flow — Claude CLI Authentication
 *
 * Implements the full PKCE OAuth flow for connecting Claude CLI
 * directly from the dashboard. No manual terminal commands needed.
 *
 * Flow:
 * 1. GET /api/v1/forge/oauth/start → generates PKCE, returns auth URL
 * 2. User authorizes on claude.ai
 * 3. GET /api/v1/forge/oauth/callback → exchanges code for tokens
 * 4. Tokens written to credentials file → agent execution works
 */

import { randomBytes, createHash } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware } from '../middleware/auth.js';

// Claude CLI's public OAuth client (PKCE, no secret needed)
const OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const OAUTH_AUTHORIZE_URL = 'https://claude.ai/oauth/authorize';
const OAUTH_TOKEN_URL = 'https://platform.claude.com/v1/oauth/token';
const OAUTH_REDIRECT_URI = 'https://platform.claude.com/oauth/code/callback';
const CREDENTIALS_PATH = '/tmp/claude-credentials/.credentials.json';

// In-memory PKCE state (short-lived, single instance)
const pendingFlows = new Map<string, { codeVerifier: string; createdAt: number }>();

// Clean up expired flows (older than 10 minutes)
function cleanupFlows() {
  const cutoff = Date.now() - 600_000;
  for (const [key, val] of pendingFlows) {
    if (val.createdAt < cutoff) pendingFlows.delete(key);
  }
}

function base64UrlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function generatePKCE(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = base64UrlEncode(randomBytes(32));
  const codeChallenge = base64UrlEncode(createHash('sha256').update(codeVerifier).digest());
  return { codeVerifier, codeChallenge };
}

export async function oauthFlowRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/forge/oauth/start
   * Generates PKCE challenge and returns the authorization URL.
   * Frontend opens this URL in a popup or redirect.
   */
  app.get(
    '/api/v1/forge/oauth/start',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      cleanupFlows();

      const { codeVerifier, codeChallenge } = generatePKCE();
      const state = base64UrlEncode(randomBytes(16));

      pendingFlows.set(state, { codeVerifier, createdAt: Date.now() });

      const params = new URLSearchParams({
        response_type: 'code',
        client_id: OAUTH_CLIENT_ID,
        redirect_uri: OAUTH_REDIRECT_URI,
        scope: 'user:inference user:profile',
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      });

      const authUrl = `${OAUTH_AUTHORIZE_URL}?${params.toString()}`;

      return { authUrl, state };
    },
  );

  /**
   * POST /api/v1/forge/oauth/exchange
   * Manual code exchange — user authorizes on claude.ai, gets redirected to
   * Anthropic's success page with the code, pastes it here.
   */
  app.post(
    '/api/v1/forge/oauth/exchange',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { code, state } = request.body as { code?: string; state?: string };

      if (!code || !state) {
        return reply.code(400).send({ error: 'Missing code or state' });
      }

      const pending = pendingFlows.get(state);
      if (!pending) {
        return reply.code(400).send({ error: 'Invalid or expired state. Start the flow again.' });
      }

      pendingFlows.delete(state);

      try {
        const tokenRes = await fetch(OAUTH_TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: OAUTH_CLIENT_ID,
            code,
            redirect_uri: OAUTH_REDIRECT_URI,
            code_verifier: pending.codeVerifier,
          }),
        });

        if (!tokenRes.ok) {
          const errText = await tokenRes.text().catch(() => 'Unknown');
          console.error(`[OAuth] Token exchange failed (${tokenRes.status}): ${errText}`);
          return reply.code(400).send({ error: 'Token exchange failed', details: errText });
        }

        const tokenData = await tokenRes.json() as {
          access_token: string;
          refresh_token: string;
          expires_in: number;
          scope?: string;
        };

        const credentials = {
          claudeAiOauth: {
            accessToken: tokenData.access_token,
            refreshToken: tokenData.refresh_token,
            expiresAt: Date.now() + tokenData.expires_in * 1000,
            scopes: tokenData.scope?.split(' ') || ['user:inference'],
          },
        };

        await mkdir(dirname(CREDENTIALS_PATH), { recursive: true }).catch(() => {});
        await writeFile(CREDENTIALS_PATH, JSON.stringify(credentials, null, 2), 'utf-8');

        console.log('[OAuth] Claude credentials saved successfully');
        return { success: true, expiresAt: credentials.claudeAiOauth.expiresAt };
      } catch (err) {
        console.error('[OAuth] Flow error:', err);
        return reply.code(500).send({ error: 'Internal error during token exchange' });
      }
    },
  );

  /**
   * GET /api/v1/forge/oauth/status
   * Check if OAuth credentials exist and are valid.
   */
  app.get(
    '/api/v1/forge/oauth/status',
    { preHandler: [authMiddleware] },
    async () => {
      try {
        const { readFile } = await import('node:fs/promises');
        const raw = await readFile(CREDENTIALS_PATH, 'utf-8');
        const creds = JSON.parse(raw) as {
          claudeAiOauth?: { accessToken?: string; expiresAt?: number };
        };

        if (!creds.claudeAiOauth?.accessToken) {
          return { connected: false, status: 'no_token' };
        }

        const expiresAt = creds.claudeAiOauth.expiresAt ?? 0;
        const isExpired = expiresAt < Date.now();

        return {
          connected: !isExpired,
          status: isExpired ? 'expired' : 'healthy',
          expiresAt,
        };
      } catch {
        return { connected: false, status: 'no_credentials' };
      }
    },
  );
}
