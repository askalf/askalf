/**
 * Credentials Health Routes
 * OAuth token health check and forced refresh endpoint.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { readFile, writeFile } from 'node:fs/promises';
import { authMiddleware } from '../middleware/auth.js';

// Check multiple possible credential locations
const CREDENTIAL_PATHS = [
  '/tmp/claude-credentials/.credentials.json',
  '/tmp/claude-home/.claude/.credentials.json',
  '/home/substrate/.claude-session/.claude/.credentials.json',
];
const OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const OAUTH_TOKEN_URL = 'https://platform.claude.com/v1/oauth/token';

interface CredentialsFile {
  claudeAiOauth?: {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
  };
}

function computeStatus(expiresAt: number | null | undefined): {
  status: 'healthy' | 'expiring' | 'expired' | 'unknown';
  expiresIn: string | null;
} {
  if (expiresAt == null) {
    return { status: 'unknown', expiresIn: null };
  }

  const now = Date.now();
  const diffMs = expiresAt - now;

  if (diffMs <= 0) {
    return { status: 'expired', expiresIn: null };
  }

  const diffMin = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHours / 24);

  let expiresIn: string;
  if (diffDays > 0) {
    expiresIn = `${diffDays}d ${diffHours % 24}h`;
  } else if (diffHours > 0) {
    expiresIn = `${diffHours}h ${diffMin % 60}m`;
  } else {
    expiresIn = `${diffMin}m`;
  }

  // Expiring if less than 1 hour remaining
  if (diffMs < 3_600_000) {
    return { status: 'expiring', expiresIn };
  }

  return { status: 'healthy', expiresIn };
}

async function readCredentials(): Promise<CredentialsFile | null> {
  for (const path of CREDENTIAL_PATHS) {
    try {
      const raw = await readFile(path, 'utf-8');
      return JSON.parse(raw) as CredentialsFile;
    } catch {
      continue;
    }
  }
  return null;
}

export async function credentialsHealthRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/forge/credentials/health — check OAuth token status
   */
  app.get(
    '/api/v1/forge/credentials/health',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const creds = await readCredentials();
        const expiresAt = creds?.claudeAiOauth?.expiresAt ?? null;
        const { status, expiresIn } = computeStatus(expiresAt);

        return reply.send({
          status,
          expiresAt,
          expiresIn,
        });
      } catch (err) {
        request.log.error(err, 'Failed to check credential health');
        return reply.status(500).send({ error: 'Internal Server Error' });
      }
    },
  );

  /**
   * POST /api/v1/forge/credentials/refresh — force token refresh
   */
  app.post(
    '/api/v1/forge/credentials/refresh',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const creds = await readCredentials();
        if (!creds?.claudeAiOauth?.refreshToken) {
          return reply.status(400).send({
            refreshed: false,
            expiresAt: null,
            error: 'No refresh token found in credentials file',
          });
        }

        const refreshToken = creds.claudeAiOauth.refreshToken;

        const response = await fetch(OAUTH_TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: OAUTH_CLIENT_ID,
            refresh_token: refreshToken,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text().catch(() => 'Unknown error');
          return reply.status(502).send({
            refreshed: false,
            expiresAt: creds.claudeAiOauth.expiresAt ?? null,
            error: `OAuth refresh failed (${response.status}): ${errorText}`,
          });
        }

        const tokenData = (await response.json()) as {
          access_token?: string;
          refresh_token?: string;
          expires_in?: number;
        };

        const newExpiresAt = tokenData.expires_in
          ? Date.now() + tokenData.expires_in * 1000
          : null;

        // Update credentials file
        creds.claudeAiOauth.accessToken = tokenData.access_token ?? creds.claudeAiOauth.accessToken;
        creds.claudeAiOauth.refreshToken = tokenData.refresh_token ?? creds.claudeAiOauth.refreshToken;
        if (newExpiresAt) {
          creds.claudeAiOauth.expiresAt = newExpiresAt;
        }

        // Write back to the first path that exists
        for (const path of CREDENTIAL_PATHS) {
          try {
            await readFile(path);
            await writeFile(path, JSON.stringify(creds, null, 2), 'utf-8');
            break;
          } catch { continue; }
        }

        return reply.send({
          refreshed: true,
          expiresAt: newExpiresAt,
        });
      } catch (err) {
        request.log.error(err, 'Failed to refresh credentials');
        return reply.status(500).send({
          refreshed: false,
          expiresAt: null,
          error: err instanceof Error ? err.message : 'Internal Server Error',
        });
      }
    },
  );
}
