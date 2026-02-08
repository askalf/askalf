/**
 * OAuth Routes
 * Handles OAuth callbacks for integration connections
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ulid } from 'ulid';
import { query, queryOne } from '../database.js';
import { requireSelf } from '../middleware/self-auth.js';
import * as gmail from '../integrations/gmail.js';
import * as gcal from '../integrations/google-calendar.js';
import { logActivity } from '../services/activity-logger.js';

const GOOGLE_CLIENT_ID = process.env['GOOGLE_CLIENT_ID'] ?? '';
const GOOGLE_CLIENT_SECRET = process.env['GOOGLE_CLIENT_SECRET'] ?? '';
const OAUTH_REDIRECT_BASE = process.env['OAUTH_REDIRECT_BASE'] ?? 'https://self.askalf.org';

interface PendingOAuth {
  selfId: string;
  userId: string;
  provider: string;
  integrationId: string;
  createdAt: number;
}

// In-memory store for pending OAuth flows (TTL: 10 minutes)
const pendingOAuth = new Map<string, PendingOAuth>();

// Cleanup expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [state, pending] of pendingOAuth) {
    if (now - pending.createdAt > 600_000) {
      pendingOAuth.delete(state);
    }
  }
}, 300_000);

export async function oauthRoutes(app: FastifyInstance): Promise<void> {
  // ---- POST /api/v1/self/integrations/:provider/connect ----
  // Initiate OAuth flow
  app.post('/api/v1/self/integrations/:provider/connect', {
    preHandler: [requireSelf],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { provider } = request.params as { provider: string };
    const selfId = request.selfId!;
    const userId = request.userId!;

    // Create or find integration record
    let integration = await queryOne<{ id: string }>(
      `SELECT id FROM self_integrations WHERE self_id = $1 AND provider = $2`,
      [selfId, provider],
    );

    if (!integration) {
      const integrationId = ulid();
      await query(
        `INSERT INTO self_integrations (id, self_id, user_id, provider, display_name, auth_type, status)
         VALUES ($1, $2, $3, $4, $5, 'oauth2', 'pending')`,
        [integrationId, selfId, userId, provider, getDisplayName(provider)],
      );
      integration = { id: integrationId };
    }

    // Generate state parameter
    const state = ulid();
    pendingOAuth.set(state, {
      selfId,
      userId,
      provider,
      integrationId: integration.id,
      createdAt: Date.now(),
    });

    const redirectUri = `${OAUTH_REDIRECT_BASE}/api/v1/self/oauth/callback`;

    let authUrl: string;
    switch (provider) {
      case 'gmail':
        authUrl = gmail.getAuthUrl({
          clientId: GOOGLE_CLIENT_ID,
          redirectUri,
          state,
        });
        break;
      case 'google_calendar':
        authUrl = gcal.getAuthUrl({
          clientId: GOOGLE_CLIENT_ID,
          redirectUri,
          state,
        });
        break;
      default:
        return reply.status(400).send({
          error: 'Bad Request',
          message: `OAuth not supported for provider: ${provider}`,
        });
    }

    return reply.send({ auth_url: authUrl, state });
  });

  // ---- GET /api/v1/self/oauth/callback ----
  // OAuth callback handler
  app.get('/api/v1/self/oauth/callback', async (request: FastifyRequest, reply: FastifyReply) => {
    const qs = request.query as { code?: string; state?: string; error?: string };

    if (qs.error) {
      return reply.status(400).send({
        error: 'OAuth Error',
        message: `OAuth authorization failed: ${qs.error}`,
      });
    }

    if (!qs.code || !qs.state) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Missing code or state parameter',
      });
    }

    const pending = pendingOAuth.get(qs.state);
    if (!pending) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Invalid or expired OAuth state',
      });
    }

    pendingOAuth.delete(qs.state);

    const redirectUri = `${OAUTH_REDIRECT_BASE}/api/v1/self/oauth/callback`;

    try {
      let credentials: gmail.GmailCredentials | gcal.CalendarCredentials;

      switch (pending.provider) {
        case 'gmail':
          credentials = await gmail.exchangeCode({
            code: qs.code,
            clientId: GOOGLE_CLIENT_ID,
            clientSecret: GOOGLE_CLIENT_SECRET,
            redirectUri,
          });
          break;
        case 'google_calendar':
          credentials = await gcal.exchangeCode({
            code: qs.code,
            clientId: GOOGLE_CLIENT_ID,
            clientSecret: GOOGLE_CLIENT_SECRET,
            redirectUri,
          });
          break;
        default:
          return reply.status(400).send({ error: 'Unknown provider' });
      }

      // Store credentials and mark as connected
      await query(
        `UPDATE self_integrations
         SET credentials = $1, status = 'connected', last_sync = NOW(), updated_at = NOW()
         WHERE id = $2`,
        [JSON.stringify(credentials), pending.integrationId],
      );

      // Log activity
      await logActivity({
        selfId: pending.selfId,
        userId: pending.userId,
        type: 'integration',
        title: `Connected ${getDisplayName(pending.provider)}`,
        body: `${getDisplayName(pending.provider)} is now connected. SELF can access your ${pending.provider === 'gmail' ? 'emails' : 'calendar'}.`,
        integrationId: pending.integrationId,
        importance: 8,
      });

      // Redirect to frontend success page
      return reply.redirect(`${OAUTH_REDIRECT_BASE}/integrations/success?provider=${pending.provider}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      await query(
        `UPDATE self_integrations SET status = 'error', updated_at = NOW() WHERE id = $1`,
        [pending.integrationId],
      );

      return reply.status(500).send({
        error: 'OAuth Failed',
        message: `Failed to complete OAuth: ${message}`,
      });
    }
  });
}

function getDisplayName(provider: string): string {
  const names: Record<string, string> = {
    gmail: 'Gmail',
    google_calendar: 'Google Calendar',
    slack: 'Slack',
    github: 'GitHub',
    notion: 'Notion',
  };
  return names[provider] ?? provider;
}
