/**
 * Terminal Chat Routes — CLI mode for the dashboard terminal.
 * Sends messages to Claude via user's Anthropic credential (API key or OAuth token).
 * Supports streaming responses via SSE.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { queryOne } from '../database.js';
import { authMiddleware } from '../middleware/auth.js';
import Anthropic from '@anthropic-ai/sdk';

// ============================================
// Credential resolution
// ============================================

interface UserCredential {
  type: 'api_key' | 'oauth';
  value: string;
}

async function resolveUserCredential(userId: string): Promise<UserCredential | null> {
  // 1. Check for user's own API key (BYOK)
  const userKey = await queryOne<{ api_key_encrypted: string }>(
    `SELECT api_key_encrypted FROM user_provider_keys
     WHERE user_id = $1 AND provider_type = 'anthropic' AND is_active = true`,
    [userId],
  );
  if (userKey?.api_key_encrypted) {
    const decoded = Buffer.from(userKey.api_key_encrypted, 'base64').toString('utf-8');
    return { type: 'api_key', value: decoded };
  }

  // 2. Check for user's OAuth token
  const oauthToken = await queryOne<{ access_token: string; token_expires_at: string | null }>(
    `SELECT access_token, token_expires_at FROM user_oauth_tokens
     WHERE user_id = $1 AND provider = 'anthropic' AND revoked_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    [userId],
  ).catch(() => null);

  if (oauthToken?.access_token) {
    // Check if expired
    if (oauthToken.token_expires_at) {
      const expiresAt = new Date(oauthToken.token_expires_at).getTime();
      if (Date.now() > expiresAt) {
        // Try to refresh
        const refreshed = await refreshOAuthToken(userId);
        if (refreshed) return { type: 'oauth', value: refreshed };
        return null; // Expired and can't refresh
      }
    }
    return { type: 'oauth', value: oauthToken.access_token };
  }

  // 3. Fall back to platform's OAuth credentials (admin only)
  const platformToken = await loadPlatformOAuthToken();
  if (platformToken) {
    return { type: 'oauth', value: platformToken };
  }

  // 4. Fall back to environment API key
  const envKey = process.env['ANTHROPIC_API_KEY'];
  if (envKey) {
    return { type: 'api_key', value: envKey };
  }

  return null;
}

// Load platform OAuth token from mounted credentials file
async function loadPlatformOAuthToken(): Promise<string | null> {
  try {
    const fs = await import('node:fs/promises');
    const paths = ['/tmp/claude-credentials.json', '/tmp/claude-home/.claude/.credentials.json'];
    for (const p of paths) {
      try {
        const raw = await fs.readFile(p, 'utf-8');
        const data = JSON.parse(raw) as { claudeAiOauth?: { accessToken?: string; expiresAt?: number } };
        if (data.claudeAiOauth?.accessToken) {
          // Check if not expired
          if (data.claudeAiOauth.expiresAt && Date.now() > data.claudeAiOauth.expiresAt) continue;
          return data.claudeAiOauth.accessToken;
        }
      } catch { continue; }
    }
  } catch { /* no platform token */ }
  return null;
}

// Refresh an expired OAuth token
async function refreshOAuthToken(userId: string): Promise<string | null> {
  try {
    const row = await queryOne<{ id: string; refresh_token: string }>(
      `SELECT id, refresh_token FROM user_oauth_tokens
       WHERE user_id = $1 AND provider = 'anthropic' AND refresh_token IS NOT NULL AND revoked_at IS NULL
       ORDER BY created_at DESC LIMIT 1`,
      [userId],
    );
    if (!row?.refresh_token) return null;

    const CLIENT_ID = process.env['ANTHROPIC_OAUTH_CLIENT_ID'] ?? '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
    const TOKEN_URL = 'https://console.anthropic.com/v1/oauth/token';

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: CLIENT_ID,
        refresh_token: row.refresh_token,
      }),
    });

    if (!res.ok) return null;
    const data = await res.json() as { access_token: string; refresh_token?: string; expires_in?: number };

    // Update stored token
    const { query } = await import('../database.js');
    const expiresAt = data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : null;
    await query(
      `UPDATE user_oauth_tokens SET
         access_token = $1,
         refresh_token = COALESCE($2, refresh_token),
         token_expires_at = $3,
         updated_at = NOW()
       WHERE id = $4`,
      [data.access_token, data.refresh_token ?? null, expiresAt, row.id],
    );

    return data.access_token;
  } catch {
    return null;
  }
}

// ============================================
// Routes
// ============================================

export async function terminalRoutes(app: FastifyInstance): Promise<void> {

  /**
   * POST /api/v1/terminal/message — Send a message to Claude, get a response.
   * Uses the authenticated user's Anthropic credential.
   */
  app.post(
    '/api/v1/terminal/message',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const body = request.body as {
        message: string;
        history?: { role: 'user' | 'assistant'; content: string }[];
        system?: string;
      };

      if (!body.message?.trim()) {
        return reply.status(400).send({ error: 'message is required' });
      }

      // Resolve credential
      const cred = await resolveUserCredential(userId);
      if (!cred) {
        return reply.status(403).send({
          error: 'No Anthropic credential configured',
          hint: 'Add your API key in Settings > AI Keys, or import your OAuth token via /connect',
        });
      }

      try {
        // Build client based on credential type
        const clientOpts: Record<string, unknown> = {};
        if (cred.type === 'api_key') {
          clientOpts['apiKey'] = cred.value;
        } else {
          // OAuth token — use as Bearer token
          clientOpts['apiKey'] = 'placeholder'; // SDK requires this but we override the header
          clientOpts['defaultHeaders'] = {
            'Authorization': `Bearer ${cred.value}`,
            'anthropic-version': '2023-06-01',
          };
          // Remove the x-api-key header that the SDK adds
          clientOpts['authToken'] = cred.value;
        }

        const client = new Anthropic(cred.type === 'api_key'
          ? { apiKey: cred.value }
          : { apiKey: '', authToken: cred.value }
        );

        // Build messages
        const messages: Anthropic.MessageParam[] = [];
        if (body.history) {
          for (const msg of body.history.slice(-20)) { // Keep last 20 messages
            messages.push({ role: msg.role, content: msg.content });
          }
        }
        messages.push({ role: 'user', content: body.message });

        const systemPrompt = body.system ?? `You are AskAlf, a CLI assistant embedded in a terminal-style command center. You help users manage their AI agent platform.

Keep responses concise and terminal-friendly:
- Use short paragraphs, not walls of text
- Use monospace-friendly formatting (no markdown headers, use CAPS for emphasis)
- Be direct and actionable
- When showing code, keep it brief
- Reference slash commands when relevant (e.g., "run /fleet to see your agents")`;

        const response = await client.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 2048,
          system: systemPrompt,
          messages,
        });

        // Extract text from response
        const text = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map(b => b.text)
          .join('\n');

        // Update last_used_at for the key
        if (cred.type === 'api_key') {
          const { query } = await import('../database.js');
          void query(
            `UPDATE user_provider_keys SET last_used_at = NOW() WHERE user_id = $1 AND provider_type = 'anthropic'`,
            [userId],
          ).catch(() => {});
        }

        return reply.send({
          text,
          model: response.model,
          usage: {
            input_tokens: response.usage.input_tokens,
            output_tokens: response.usage.output_tokens,
          },
          credential_type: cred.type,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);

        // Handle specific Anthropic errors
        if (message.includes('401') || message.includes('authentication') || message.includes('invalid')) {
          return reply.status(401).send({
            error: 'Anthropic credential invalid or expired',
            hint: cred.type === 'oauth' ? 'Your OAuth token may have expired. Re-connect via /connect' : 'Check your API key in Settings > AI Keys',
          });
        }

        if (message.includes('429') || message.includes('rate')) {
          return reply.status(429).send({ error: 'Rate limited by Anthropic. Please wait a moment.' });
        }

        return reply.status(502).send({ error: `Claude API error: ${message}` });
      }
    },
  );

  /**
   * POST /api/v1/terminal/oauth/import — Import OAuth token from Claude Code credentials.
   * User pastes their credentials JSON content.
   */
  app.post(
    '/api/v1/terminal/oauth/import',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const body = request.body as { credentials: string };

      if (!body.credentials?.trim()) {
        return reply.status(400).send({ error: 'credentials JSON is required' });
      }

      try {
        const data = JSON.parse(body.credentials) as {
          claudeAiOauth?: {
            accessToken?: string;
            refreshToken?: string;
            expiresAt?: number;
            scopes?: string[];
          };
        };

        const oauth = data.claudeAiOauth;
        if (!oauth?.accessToken) {
          return reply.status(400).send({
            error: 'Invalid credentials format',
            hint: 'Expected JSON with claudeAiOauth.accessToken. Find it at ~/.claude/.credentials.json',
          });
        }

        // Verify the token works
        try {
          const testClient = new Anthropic({ apiKey: '', authToken: oauth.accessToken });
          await testClient.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 10,
            messages: [{ role: 'user', content: 'hi' }],
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes('401') || msg.includes('authentication')) {
            return reply.status(400).send({ error: 'OAuth token is invalid or expired. Get a fresh token from Claude Code.' });
          }
          // Other errors (rate limit etc) are OK — token is valid
        }

        // Store the OAuth token
        const { query } = await import('../database.js');
        const { ulid } = await import('ulid');

        // Upsert: revoke old tokens, insert new
        await query(
          `UPDATE user_oauth_tokens SET revoked_at = NOW() WHERE user_id = $1 AND provider = 'anthropic' AND revoked_at IS NULL`,
          [userId],
        );

        const expiresAt = oauth.expiresAt ? new Date(oauth.expiresAt).toISOString() : null;

        await query(
          `INSERT INTO user_oauth_tokens (id, user_id, provider, access_token, refresh_token, token_expires_at, scopes, created_at, updated_at)
           VALUES ($1, $2, 'anthropic', $3, $4, $5, $6, NOW(), NOW())`,
          [ulid(), userId, oauth.accessToken, oauth.refreshToken ?? null, expiresAt, JSON.stringify(oauth.scopes ?? [])],
        );

        return reply.send({
          success: true,
          expires_at: expiresAt,
          has_refresh: !!oauth.refreshToken,
        });
      } catch (err) {
        return reply.status(400).send({ error: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}` });
      }
    },
  );

  /**
   * GET /api/v1/terminal/credential — Check what credential the user has available.
   */
  app.get(
    '/api/v1/terminal/credential',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const cred = await resolveUserCredential(userId);

      return reply.send({
        has_credential: !!cred,
        credential_type: cred?.type ?? null,
        hint: cred ? null : 'No Anthropic credential. Add API key via Settings > AI Keys or import OAuth token via /connect',
      });
    },
  );
}
