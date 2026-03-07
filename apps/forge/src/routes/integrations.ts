/**
 * User Integration Routes
 * Connect/disconnect git providers (GitHub, GitLab, Bitbucket),
 * list connected integrations, sync repos.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ulid } from 'ulid';
import { query, queryOne, transaction } from '../database.js';
import { getProvider, getOAuthConfig, isValidProvider, type IntegrationProvider } from '../integrations/index.js';
import { isApiKeyProvider, testApiKeyIntegration, PROVIDER_CONFIGS, API_KEY_PROVIDERS, type ApiKeyProvider } from '../integrations/api-key-providers.js';

// ============================================
// Auth helper (same pattern as auth.ts)
// ============================================

const SESSION_COOKIE_NAME = 'substrate_session';

async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function getAuthenticatedUser(request: FastifyRequest): Promise<{ userId: string; tenantId: string } | null> {
  const cookies = request.cookies as Record<string, string> | undefined;
  const sessionToken = cookies?.[SESSION_COOKIE_NAME];
  if (!sessionToken) return null;

  const tokenHash = await hashToken(sessionToken);
  const session = await queryOne<{ user_id: string; tenant_id: string }>(
    `SELECT s.user_id, u.tenant_id
     FROM sessions s JOIN users u ON s.user_id = u.id
     WHERE s.token_hash = $1 AND s.expires_at > NOW() AND s.revoked = false AND u.status = 'active'`,
    [tokenHash],
  );
  return session ? { userId: session.user_id, tenantId: session.tenant_id } : null;
}

function generateSecureToken(length: number = 32): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => chars[byte % chars.length]).join('');
}

const isProduction = process.env['NODE_ENV'] === 'production';

function getRedirectUri(provider: IntegrationProvider): string {
  const base = isProduction ? 'https://askalf.org' : 'http://localhost:3001';
  return `${base}/api/v1/integrations/connect/${provider}/callback`;
}

// ============================================
// Routes
// ============================================

export async function integrationRoutes(app: FastifyInstance): Promise<void> {

  // ------------------------------------------
  // GET /api/v1/integrations
  // List user's connected integrations
  // ------------------------------------------
  app.get('/api/v1/integrations', async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = await getAuthenticatedUser(request);
    if (!auth) return reply.code(401).send({ error: 'Not authenticated' });

    const integrations = await query<{
      id: string;
      provider: string;
      provider_username: string | null;
      display_name: string | null;
      status: string;
      scopes: string[] | null;
      repos_synced_at: string | null;
      created_at: string;
    }>(
      `SELECT id, provider, provider_username, display_name, status, scopes, repos_synced_at, created_at
       FROM user_integrations
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [auth.userId],
    );

    // Get repo counts per integration
    const repoCounts = await query<{ integration_id: string; count: string }>(
      `SELECT integration_id, COUNT(*)::text as count FROM user_repos WHERE user_id = $1 GROUP BY integration_id`,
      [auth.userId],
    );
    const countMap = new Map(repoCounts.map((r) => [r.integration_id, parseInt(r.count, 10)]));

    return {
      integrations: integrations.map((i) => ({
        ...i,
        repo_count: countMap.get(i.id) ?? 0,
      })),
    };
  });

  // ------------------------------------------
  // GET /api/v1/integrations/available
  // List which providers are configurable
  // ------------------------------------------
  app.get('/api/v1/integrations/available', async () => {
    const oauthProviders = (['github', 'gitlab', 'bitbucket'] as const).map((p) => ({
      provider: p,
      configured: !!getOAuthConfig(p),
      type: 'oauth' as const,
    }));

    // API key providers are always "available" — they just need configuration
    const apiKeyProviders = API_KEY_PROVIDERS.map((p) => ({
      provider: p,
      configured: true, // Always available for API key entry
      type: 'api_key' as const,
    }));

    return { providers: [...oauthProviders, ...apiKeyProviders] };
  });

  // ------------------------------------------
  // POST /api/v1/integrations/connect/:provider/apikey
  // Connect an API key-based integration
  // ------------------------------------------
  app.post('/api/v1/integrations/connect/:provider/apikey', async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = await getAuthenticatedUser(request);
    if (!auth) return reply.code(401).send({ error: 'Not authenticated' });

    const { provider } = request.params as { provider: string };
    if (!isApiKeyProvider(provider)) {
      return reply.code(400).send({ error: `Not an API key provider: ${provider}` });
    }

    const body = (request.body ?? {}) as { config?: Record<string, string> };
    if (!body.config || Object.keys(body.config).length === 0) {
      return reply.code(400).send({ error: 'config is required' });
    }

    // Check if already connected
    const existing = await queryOne<{ id: string }>(
      `SELECT id FROM user_integrations WHERE user_id = $1 AND provider = $2`,
      [auth.userId, provider],
    );

    const providerConfig = PROVIDER_CONFIGS[provider as ApiKeyProvider];

    if (existing) {
      // Update existing
      await query(
        `UPDATE user_integrations SET access_token = $1, status = 'active', display_name = $2, updated_at = NOW() WHERE id = $3`,
        [JSON.stringify(body.config), providerConfig?.name ?? provider, existing.id],
      );
      return { id: existing.id, updated: true };
    }

    // Test the connection first
    const testResult = await testApiKeyIntegration(provider as ApiKeyProvider, body.config);

    const integrationId = `intg_${ulid()}`;
    await query(
      `INSERT INTO user_integrations (id, user_id, provider, provider_user_id, provider_username, display_name, access_token, status, scopes, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())`,
      [
        integrationId, auth.userId, provider,
        provider, // provider_user_id
        testResult.username ?? provider, // provider_username
        providerConfig?.name ?? provider, // display_name
        JSON.stringify(body.config), // store config as JSON in access_token
        testResult.success ? 'active' : 'pending', // status
        providerConfig?.requiredFields.map(f => f.key) ?? [], // scopes
      ],
    );

    return {
      id: integrationId,
      created: true,
      testResult,
    };
  });

  // ------------------------------------------
  // POST /api/v1/integrations/:id/test
  // Test an API key integration
  // ------------------------------------------
  app.post('/api/v1/integrations/:id/test', async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = await getAuthenticatedUser(request);
    if (!auth) return reply.code(401).send({ error: 'Not authenticated' });

    const { id } = request.params as { id: string };

    const integration = await queryOne<{ provider: string; access_token: string }>(
      `SELECT provider, access_token FROM user_integrations WHERE id = $1 AND user_id = $2`,
      [id, auth.userId],
    );
    if (!integration) return reply.code(404).send({ error: 'Integration not found' });

    if (!isApiKeyProvider(integration.provider)) {
      return reply.code(400).send({ error: 'Not an API key provider' });
    }

    let config: Record<string, string>;
    try {
      config = JSON.parse(integration.access_token);
    } catch {
      return reply.code(400).send({ error: 'Invalid config format' });
    }

    const result = await testApiKeyIntegration(integration.provider as ApiKeyProvider, config);

    if (result.success) {
      await query(
        `UPDATE user_integrations SET status = 'active', updated_at = NOW() WHERE id = $1`,
        [id],
      );
    }

    return result;
  });

  // ------------------------------------------
  // GET /api/v1/integrations/connect/:provider
  // Initiate OAuth for a git provider (integration flow, not login)
  // ------------------------------------------
  app.get('/api/v1/integrations/connect/:provider', async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = await getAuthenticatedUser(request);
    if (!auth) return reply.code(401).send({ error: 'Not authenticated' });

    const { provider } = request.params as { provider: string };
    if (!isValidProvider(provider)) {
      return reply.code(400).send({ error: `Unsupported provider: ${provider}` });
    }

    const config = getOAuthConfig(provider);
    if (!config) {
      return reply.code(501).send({ error: `Provider "${provider}" is not configured on this server` });
    }

    // Check if already connected
    const existing = await queryOne<{ id: string }>(
      `SELECT id FROM user_integrations WHERE user_id = $1 AND provider = $2`,
      [auth.userId, provider],
    );
    if (existing) {
      return reply.code(409).send({ error: `Already connected to ${provider}. Disconnect first.` });
    }

    // Generate state with metadata to identify this as an integration flow
    const state = generateSecureToken(32);
    await query(
      `INSERT INTO oauth_states (state, provider, redirect_uri, metadata, created_at, expires_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW() + INTERVAL '10 minutes')`,
      [state, provider, getRedirectUri(provider), JSON.stringify({ flow: 'integration', user_id: auth.userId })],
    );

    // Build authorization URL
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: getRedirectUri(provider),
      response_type: 'code',
      scope: config.scopes.join(' '),
      state,
    });

    return reply.redirect(`${config.authorizeUrl}?${params.toString()}`);
  });

  // ------------------------------------------
  // GET /api/v1/integrations/connect/:provider/callback
  // Handle OAuth callback for integration
  // ------------------------------------------
  app.get('/api/v1/integrations/connect/:provider/callback', async (request: FastifyRequest, reply: FastifyReply) => {
    const { provider } = request.params as { provider: string };
    const { code, state, error: oauthError } = request.query as { code?: string; state?: string; error?: string };

    if (oauthError) {
      console.error(`[Integration] ${provider} OAuth error: ${oauthError}`);
      return reply.redirect(`/command-center/settings?tab=integrations&error=oauth_denied`);
    }

    if (!code || !state || !isValidProvider(provider)) {
      return reply.redirect(`/command-center/settings?tab=integrations&error=missing_params`);
    }

    // Validate state
    const storedState = await queryOne<{ provider: string; metadata: { flow: string; user_id: string } }>(
      `DELETE FROM oauth_states WHERE state = $1 AND expires_at > NOW() RETURNING provider, metadata`,
      [state],
    );

    if (!storedState || storedState.provider !== provider || storedState.metadata.flow !== 'integration') {
      return reply.redirect(`/command-center/settings?tab=integrations&error=state_invalid`);
    }

    const userId = storedState.metadata.user_id;
    const config = getOAuthConfig(provider);
    if (!config) {
      return reply.redirect(`/command-center/settings?tab=integrations&error=not_configured`);
    }

    try {
      // Exchange code for tokens
      const tokenBody = new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        redirect_uri: getRedirectUri(provider),
        grant_type: 'authorization_code',
      });

      const tokenHeaders: Record<string, string> = {
        'Content-Type': 'application/x-www-form-urlencoded',
      };
      if (provider === 'github') {
        tokenHeaders['Accept'] = 'application/json';
      }

      const tokenRes = await fetch(config.tokenUrl, {
        method: 'POST',
        headers: tokenHeaders,
        body: tokenBody.toString(),
      });

      if (!tokenRes.ok) {
        const text = await tokenRes.text();
        throw new Error(`Token exchange failed (${tokenRes.status}): ${text}`);
      }

      const tokens = await tokenRes.json() as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
      };

      // Fetch user info from provider
      const gitProvider = getProvider(provider);
      const userInfo = await gitProvider.getUserInfo(tokens.access_token);

      // Create integration record
      const integrationId = `intg_${ulid()}`;
      await query(
        `INSERT INTO user_integrations (id, user_id, provider, provider_user_id, provider_username, display_name, access_token, refresh_token, token_expires_at, scopes, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'active', NOW(), NOW())`,
        [
          integrationId, userId, provider,
          userInfo.id, userInfo.username, userInfo.displayName,
          tokens.access_token, tokens.refresh_token ?? null,
          tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null,
          config.scopes,
        ],
      );

      console.log(`[Integration] ${provider} connected for user ${userId} (${userInfo.username})`);

      // Sync repos in background (fire-and-forget)
      void syncReposForIntegration(integrationId, userId, provider, tokens.access_token).catch((err) => {
        console.error(`[Integration] Repo sync failed for ${integrationId}:`, err);
      });

      return reply.redirect(`/command-center/settings?tab=integrations&connected=${provider}`);
    } catch (err) {
      console.error(`[Integration] ${provider} callback error:`, err);
      return reply.redirect(`/command-center/settings?tab=integrations&error=connect_failed`);
    }
  });

  // ------------------------------------------
  // DELETE /api/v1/integrations/:id
  // Disconnect an integration
  // ------------------------------------------
  app.delete('/api/v1/integrations/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = await getAuthenticatedUser(request);
    if (!auth) return reply.code(401).send({ error: 'Not authenticated' });

    const { id } = request.params as { id: string };

    // Cascade delete (user_repos FK has ON DELETE CASCADE)
    const result = await query<{ id: string }>(
      `DELETE FROM user_integrations WHERE id = $1 AND user_id = $2 RETURNING id`,
      [id, auth.userId],
    );

    if (result.length === 0) {
      return reply.code(404).send({ error: 'Integration not found' });
    }

    console.log(`[Integration] Disconnected ${id} for user ${auth.userId}`);
    return { success: true };
  });

  // ------------------------------------------
  // GET /api/v1/integrations/:id/repos
  // List cached repos for an integration
  // ------------------------------------------
  app.get('/api/v1/integrations/:id/repos', async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = await getAuthenticatedUser(request);
    if (!auth) return reply.code(401).send({ error: 'Not authenticated' });

    const { id } = request.params as { id: string };

    // Verify ownership
    const integration = await queryOne<{ provider: string }>(
      `SELECT provider FROM user_integrations WHERE id = $1 AND user_id = $2`,
      [id, auth.userId],
    );
    if (!integration) return reply.code(404).send({ error: 'Integration not found' });

    const repos = await query<{
      id: string;
      repo_full_name: string;
      repo_url: string;
      clone_url: string | null;
      default_branch: string;
      is_private: boolean;
      description: string | null;
      language: string | null;
      last_synced_at: string;
    }>(
      `SELECT id, repo_full_name, repo_url, clone_url, default_branch, is_private, description, language, last_synced_at
       FROM user_repos
       WHERE integration_id = $1 AND user_id = $2
       ORDER BY repo_full_name`,
      [id, auth.userId],
    );

    return { repos };
  });

  // ------------------------------------------
  // GET /api/v1/integrations/repos
  // List ALL repos across all integrations (for target picker)
  // ------------------------------------------
  app.get('/api/v1/integrations/repos', async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = await getAuthenticatedUser(request);
    if (!auth) return reply.code(401).send({ error: 'Not authenticated' });

    const repos = await query<{
      id: string;
      provider: string;
      repo_full_name: string;
      repo_url: string;
      clone_url: string | null;
      default_branch: string;
      is_private: boolean;
      description: string | null;
      language: string | null;
    }>(
      `SELECT r.id, r.provider, r.repo_full_name, r.repo_url, r.clone_url, r.default_branch, r.is_private, r.description, r.language
       FROM user_repos r
       JOIN user_integrations i ON r.integration_id = i.id
       WHERE r.user_id = $1 AND i.status = 'active'
       ORDER BY r.provider, r.repo_full_name`,
      [auth.userId],
    );

    return { repos };
  });

  // ------------------------------------------
  // POST /api/v1/integrations/:id/sync
  // Force re-sync repos from provider
  // ------------------------------------------
  app.post('/api/v1/integrations/:id/sync', async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = await getAuthenticatedUser(request);
    if (!auth) return reply.code(401).send({ error: 'Not authenticated' });

    const { id } = request.params as { id: string };

    const integration = await queryOne<{ provider: string; access_token: string }>(
      `SELECT provider, access_token FROM user_integrations WHERE id = $1 AND user_id = $2 AND status = 'active'`,
      [id, auth.userId],
    );
    if (!integration) return reply.code(404).send({ error: 'Integration not found or inactive' });

    if (!isValidProvider(integration.provider)) {
      return reply.code(400).send({ error: 'Invalid provider' });
    }

    const count = await syncReposForIntegration(id, auth.userId, integration.provider as IntegrationProvider, integration.access_token);
    return { success: true, repos_synced: count };
  });

  // ------------------------------------------
  // GET /api/v1/integrations/:integrationId/repos/:repoFullName/branches
  // List branches for a specific repo (live API call)
  // ------------------------------------------
  app.get('/api/v1/integrations/:integrationId/repos/:repoFullName/branches', async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = await getAuthenticatedUser(request);
    if (!auth) return reply.code(401).send({ error: 'Not authenticated' });

    const { integrationId, repoFullName } = request.params as { integrationId: string; repoFullName: string };

    const integration = await queryOne<{ provider: string; access_token: string }>(
      `SELECT provider, access_token FROM user_integrations WHERE id = $1 AND user_id = $2 AND status = 'active'`,
      [integrationId, auth.userId],
    );
    if (!integration) return reply.code(404).send({ error: 'Integration not found' });
    if (!isValidProvider(integration.provider)) {
      return reply.code(400).send({ error: 'Invalid provider' });
    }

    const provider = getProvider(integration.provider as IntegrationProvider);
    const branches = await provider.getBranches(integration.access_token, decodeURIComponent(repoFullName));
    return { branches };
  });
}

// ============================================
// Repo Sync Helper
// ============================================

async function syncReposForIntegration(
  integrationId: string,
  userId: string,
  providerName: IntegrationProvider,
  accessToken: string,
): Promise<number> {
  const provider = getProvider(providerName);
  const repos = await provider.listRepos(accessToken);

  await transaction(async (client) => {
    // Delete old repos for this integration
    await client.query(
      `DELETE FROM user_repos WHERE integration_id = $1`,
      [integrationId],
    );

    // Insert fresh repos
    for (const repo of repos) {
      await client.query(
        `INSERT INTO user_repos (id, user_id, integration_id, provider, repo_full_name, repo_url, clone_url, default_branch, is_private, description, language, last_synced_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
         ON CONFLICT (user_id, provider, repo_full_name) DO UPDATE SET
           repo_url = EXCLUDED.repo_url,
           clone_url = EXCLUDED.clone_url,
           default_branch = EXCLUDED.default_branch,
           is_private = EXCLUDED.is_private,
           description = EXCLUDED.description,
           language = EXCLUDED.language,
           last_synced_at = NOW()`,
        [
          `repo_${ulid()}`, userId, integrationId, providerName,
          repo.fullName, repo.url, repo.cloneUrl, repo.defaultBranch,
          repo.isPrivate, repo.description, repo.language,
        ],
      );
    }

    // Update sync timestamp on integration
    await client.query(
      `UPDATE user_integrations SET repos_synced_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [integrationId],
    );
  });

  console.log(`[Integration] Synced ${repos.length} repos for integration ${integrationId} (${providerName})`);
  return repos.length;
}
