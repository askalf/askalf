/**
 * Channel Integration Routes
 * - Inbound webhook endpoints (signature-verified, no auth)
 * - Channel config CRUD (auth required)
 * - API dispatch endpoint
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ulid } from 'ulid';
import { query, queryOne } from '../database.js';
import { authMiddleware } from '../middleware/auth.js';
import { getChannelProvider, isValidChannelType, CHANNEL_TYPES } from '../channels/index.js';
import { dispatchChannelMessage } from '../channels/dispatch-adapter.js';
import { encryptConfigFields, decryptConfigFields, SENSITIVE_KEYS } from '../channels/crypto.js';
import { runDirectCliExecution } from '../runtime/worker.js';
import { TelegramProvider } from '../channels/telegram.js';
import type { ChannelConfig, ChannelType } from '../channels/types.js';

export async function channelRoutes(app: FastifyInstance): Promise<void> {

  // ============================================
  // INBOUND WEBHOOKS (no auth — signature verified)
  // ============================================

  /**
   * POST /api/v1/forge/channels/:type/webhook/:configId
   * Receives inbound messages from external platforms.
   */
  app.post(
    '/api/v1/forge/channels/:type/webhook/:configId',
    { schema: { tags: ['Channels'], summary: 'Receive inbound channel webhook' } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { type, configId } = request.params as { type: string; configId: string };

      if (!isValidChannelType(type)) {
        return reply.status(400).send({ error: 'Invalid channel type' });
      }

      // Load channel config
      const config = await queryOne<ChannelConfig>(
        `SELECT * FROM channel_configs WHERE id = $1 AND channel_type = $2 AND is_active = true`,
        [configId, type],
      );
      if (!config) {
        return reply.status(404).send({ error: 'Channel config not found' });
      }

      // Decrypt config for verification
      const decryptedConfig = {
        ...config,
        config: decryptConfigFields(config.config, SENSITIVE_KEYS[type] ?? []),
      };

      const provider = getChannelProvider(type as ChannelType);

      // For chat channels, verify signature and dispatch
      if (provider) {
        // Check for platform challenge (url_verification, PING, etc.)
        const challenge = provider.handleChallenge?.(
          request.headers as Record<string, string>,
          request.body,
          decryptedConfig,
        );
        if (challenge) {
          return reply.send(challenge.challengeResponse);
        }

        // Verify webhook signature
        const verification = provider.verifyWebhook(
          request.headers as Record<string, string>,
          request.body,
          decryptedConfig,
        );
        if (!verification.valid) {
          return reply.status(401).send({ error: 'Invalid webhook signature' });
        }

        // Parse the message
        const message = provider.parseMessage(request.body);
        if (!message) {
          // No actionable message (status update, bot message, etc.)
          return reply.status(200).send({ ok: true });
        }

        // Dispatch to agent pipeline
        const result = await dispatchChannelMessage(decryptedConfig, message);
        if (!result) {
          return reply.status(200).send({ ok: true, message: 'No agent available' });
        }

        return reply.status(200).send({
          ok: true,
          executionId: result.executionId,
        });
      }

      // Webhooks channel: just record the inbound payload
      return reply.status(200).send({ ok: true });
    },
  );

  /**
   * GET /api/v1/forge/channels/whatsapp/webhook/:configId
   * Meta webhook verification challenge handler.
   */
  app.get(
    '/api/v1/forge/channels/whatsapp/webhook/:configId',
    { schema: { tags: ['Channels'], summary: 'WhatsApp webhook verification' } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { configId } = request.params as { configId: string };
      const qs = request.query as Record<string, string>;

      const mode = qs['hub.mode'];
      const token = qs['hub.verify_token'];
      const challenge = qs['hub.challenge'];

      if (mode !== 'subscribe' || !token || !challenge) {
        return reply.status(400).send({ error: 'Missing verification parameters' });
      }

      // Load config and verify token
      const config = await queryOne<ChannelConfig>(
        `SELECT * FROM channel_configs WHERE id = $1 AND channel_type = 'whatsapp' AND is_active = true`,
        [configId],
      );
      if (!config) {
        return reply.status(404).send({ error: 'Config not found' });
      }

      const decrypted = decryptConfigFields(config.config, SENSITIVE_KEYS['whatsapp'] ?? []);
      const verifyToken = decrypted['verify_token'] as string | undefined;

      if (token !== verifyToken) {
        return reply.status(403).send({ error: 'Invalid verify token' });
      }

      // Respond with the challenge to confirm webhook
      return reply.status(200).send(challenge);
    },
  );

  // ============================================
  // API DISPATCH (auth required)
  // ============================================

  /**
   * POST /api/v1/forge/channels/api/dispatch
   * Dispatch an agent task via API. Supports sync (long-poll) and async modes.
   */
  app.post(
    '/api/v1/forge/channels/api/dispatch',
    {
      schema: { tags: ['Channels'], summary: 'Dispatch agent via API' },
      preHandler: [authMiddleware],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const body = (request.body ?? {}) as {
        message?: string;
        agentId?: string;
        sync?: boolean;
      };

      if (!body.message || body.message.trim().length === 0) {
        return reply.status(400).send({ error: 'message is required' });
      }

      if (body.message.length > 50_000) {
        return reply.status(400).send({ error: 'message exceeds 50000 character limit' });
      }

      const message = body.message.trim();

      // If agentId specified, use that agent directly
      interface AgentDispatchRow { id: string; name: string; model_id: string | null; system_prompt: string | null; max_cost_per_execution: string; max_iterations: number }
      const agentId = body.agentId;
      let agentRow: AgentDispatchRow | null = null;

      if (agentId) {
        agentRow = await queryOne<AgentDispatchRow>(
          `SELECT id, name, model_id, system_prompt, max_cost_per_execution, max_iterations
           FROM forge_agents WHERE id = $1 AND owner_id = $2 AND status = 'active'`,
          [agentId, userId],
        );
        if (!agentRow) {
          return reply.status(404).send({ error: 'Agent not found' });
        }
      }

      const executionId = ulid();

      await query(
        `INSERT INTO forge_executions (id, agent_id, owner_id, input, status, metadata, started_at)
         VALUES ($1, $2, $3, $4, 'pending', $5, NOW())`,
        [
          executionId,
          agentId ?? null,
          userId,
          message,
          JSON.stringify({ source: 'channel:api' }),
        ],
      );

      if (agentRow) {
        void runDirectCliExecution(executionId, agentRow.id, message, userId, {
          modelId: agentRow.model_id ?? undefined,
          systemPrompt: agentRow.system_prompt ?? undefined,
          maxBudgetUsd: agentRow.max_cost_per_execution,
          maxTurns: agentRow.max_iterations,
        }).catch((err) => {
          console.error(`[Channel:API] Execution ${executionId} failed:`, err instanceof Error ? err.message : err);
        });
      } else {
        // No agent specified — use dispatch adapter to auto-match
        const tenantRows = await query<{ tenant_id: string }>(
          `SELECT tenant_id FROM users WHERE id = $1`, [userId],
        );
        const tenantId = tenantRows[0]?.tenant_id ?? userId;

        const virtualConfig: ChannelConfig = {
          id: 'api-dispatch',
          tenant_id: tenantId,
          user_id: userId,
          channel_type: 'api',
          name: 'API Dispatch',
          is_active: true,
          config: {},
          metadata: {},
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        const result = await dispatchChannelMessage(virtualConfig, { text: message });
        if (!result) {
          return reply.status(503).send({ error: 'No agent available to handle this request' });
        }

        return reply.status(202).send({
          executionId: result.executionId,
          status: 'dispatched',
        });
      }

      // Sync mode: long-poll up to 120s for result
      if (body.sync) {
        const startTime = Date.now();
        const timeout = 120_000;

        while (Date.now() - startTime < timeout) {
          const execution = await queryOne<{ status: string; output: string | null; error: string | null }>(
            `SELECT status, output, error FROM forge_executions WHERE id = $1`,
            [executionId],
          );

          if (execution?.status === 'completed') {
            return { executionId, status: 'completed', output: execution.output };
          }
          if (execution?.status === 'failed') {
            return reply.status(500).send({ executionId, status: 'failed', error: execution.error });
          }

          // Poll every 2s
          await new Promise(r => setTimeout(r, 2000));
        }

        return reply.status(202).send({
          executionId,
          status: 'running',
          message: 'Execution still in progress. Poll GET /api/v1/forge/executions/:id for result.',
        });
      }

      return reply.status(202).send({
        executionId,
        status: 'dispatched',
      });
    },
  );

  // ============================================
  // CHANNEL CONFIG CRUD (auth required)
  // ============================================

  /**
   * GET /api/v1/forge/channels/configs
   * List all channel configs for the authenticated user.
   */
  app.get(
    '/api/v1/forge/channels/configs',
    {
      schema: { tags: ['Channels'], summary: 'List channel configs' },
      preHandler: [authMiddleware],
    },
    async (request: FastifyRequest) => {
      const userId = request.userId!;

      const configs = await query<ChannelConfig>(
        `SELECT id, tenant_id, user_id, channel_type, name, is_active, metadata, created_at, updated_at
         FROM channel_configs WHERE user_id = $1 ORDER BY channel_type ASC`,
        [userId],
      );

      // Return configs without sensitive data (config column excluded from SELECT)
      return { configs };
    },
  );

  /**
   * GET /api/v1/forge/channels/configs/:id
   * Get a specific channel config (with masked secrets).
   */
  app.get(
    '/api/v1/forge/channels/configs/:id',
    {
      schema: { tags: ['Channels'], summary: 'Get channel config' },
      preHandler: [authMiddleware],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const { id } = request.params as { id: string };

      const config = await queryOne<ChannelConfig>(
        `SELECT * FROM channel_configs WHERE id = $1 AND user_id = $2`,
        [id, userId],
      );
      if (!config) {
        return reply.status(404).send({ error: 'Config not found' });
      }

      // Mask sensitive fields
      const maskedConfig = { ...config.config };
      const sensitiveKeys = SENSITIVE_KEYS[config.channel_type] ?? [];
      for (const key of sensitiveKeys) {
        if (maskedConfig[key] && typeof maskedConfig[key] === 'string') {
          maskedConfig[key] = '••••••••';
        }
      }

      return { ...config, config: maskedConfig };
    },
  );

  /**
   * POST /api/v1/forge/channels/configs
   * Create or update a channel config.
   */
  app.post(
    '/api/v1/forge/channels/configs',
    {
      schema: { tags: ['Channels'], summary: 'Create/update channel config' },
      preHandler: [authMiddleware],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const body = (request.body ?? {}) as {
        channel_type?: string;
        name?: string;
        config?: Record<string, unknown>;
      };

      if (!body.channel_type || !isValidChannelType(body.channel_type)) {
        return reply.status(400).send({ error: `Invalid channel_type. Must be one of: ${CHANNEL_TYPES.join(', ')}` });
      }

      const channelType = body.channel_type;

      // Get tenant_id
      const userRow = await queryOne<{ tenant_id: string }>(
        `SELECT tenant_id FROM users WHERE id = $1`, [userId],
      );
      const tenantId = userRow?.tenant_id ?? userId;

      // Check for existing config
      const existing = await queryOne<ChannelConfig>(
        `SELECT * FROM channel_configs WHERE user_id = $1 AND channel_type = $2 AND is_active = true`,
        [userId, channelType],
      );

      // Encrypt sensitive fields
      const configData = body.config ?? {};
      const sensitiveKeys = SENSITIVE_KEYS[channelType] ?? [];
      const encryptedConfig = encryptConfigFields(configData, sensitiveKeys);

      if (existing) {
        // Merge: keep existing encrypted values if new value is '••••••••' (masked) or empty
        const mergedConfig = { ...existing.config };
        for (const [key, value] of Object.entries(encryptedConfig)) {
          if (value === '••••••••' || value === '') continue;
          mergedConfig[key] = value;
        }

        await query(
          `UPDATE channel_configs SET name = $1, config = $2, updated_at = NOW() WHERE id = $3`,
          [body.name ?? existing.name, JSON.stringify(mergedConfig), existing.id],
        );

        // For Telegram, auto-register webhook on save
        if (channelType === 'telegram') {
          await autoRegisterTelegramWebhook(existing.id, mergedConfig, request);
        }

        return { id: existing.id, updated: true };
      }

      // Create new config
      const id = ulid();
      await query(
        `INSERT INTO channel_configs (id, tenant_id, user_id, channel_type, name, is_active, config)
         VALUES ($1, $2, $3, $4, $5, true, $6)`,
        [id, tenantId, userId, channelType, body.name ?? channelType, JSON.stringify(encryptedConfig)],
      );

      // Generate webhook URL for the user
      const baseUrl = process.env['BASE_URL'] ?? 'https://askalf.org';
      const webhookUrl = `${baseUrl}/api/v1/forge/channels/${channelType}/webhook/${id}`;

      // For Telegram, auto-register webhook
      if (channelType === 'telegram') {
        await autoRegisterTelegramWebhook(id, encryptedConfig, request);
      }

      return { id, webhookUrl, created: true };
    },
  );

  /**
   * DELETE /api/v1/forge/channels/configs/:id
   * Deactivate a channel config.
   */
  app.delete(
    '/api/v1/forge/channels/configs/:id',
    {
      schema: { tags: ['Channels'], summary: 'Deactivate channel config' },
      preHandler: [authMiddleware],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const { id } = request.params as { id: string };

      const result = await query(
        `UPDATE channel_configs SET is_active = false, updated_at = NOW()
         WHERE id = $1 AND user_id = $2 AND is_active = true`,
        [id, userId],
      );

      if ((result as unknown as { rowCount: number }).rowCount === 0) {
        return reply.status(404).send({ error: 'Config not found' });
      }

      return { deleted: true };
    },
  );

  /**
   * POST /api/v1/forge/channels/configs/:id/test
   * Test a channel config by sending a test message.
   */
  app.post(
    '/api/v1/forge/channels/configs/:id/test',
    {
      schema: { tags: ['Channels'], summary: 'Test channel config' },
      preHandler: [authMiddleware],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const { id } = request.params as { id: string };

      const config = await queryOne<ChannelConfig>(
        `SELECT * FROM channel_configs WHERE id = $1 AND user_id = $2`,
        [id, userId],
      );
      if (!config) {
        return reply.status(404).send({ error: 'Config not found' });
      }

      // For webhooks, send a test webhook delivery
      if (config.channel_type === 'webhooks') {
        const decrypted = decryptConfigFields(config.config, SENSITIVE_KEYS['webhooks'] ?? []);
        const webhookUrl = decrypted['webhook_url'] as string | undefined;
        if (!webhookUrl) {
          return reply.status(400).send({ error: 'No webhook_url configured' });
        }

        try {
          const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ event: 'test', timestamp: new Date().toISOString() }),
            signal: AbortSignal.timeout(10_000),
          });
          return { success: response.ok, status: response.status };
        } catch (err) {
          return reply.status(502).send({
            error: 'Webhook test failed',
            message: err instanceof Error ? err.message : 'Network error',
          });
        }
      }

      // Required fields per channel type
      const required: Record<string, string[]> = {
        slack: ['bot_token', 'signing_secret'],
        discord: ['bot_token', 'public_key'],
        telegram: ['bot_token'],
        whatsapp: ['access_token', 'phone_number_id'],
        teams: ['app_id', 'app_password'],
        email: ['smtp_host', 'smtp_user', 'smtp_pass'],
        twilio: ['account_sid', 'auth_token', 'phone_number'],
        sendgrid: ['api_key', 'from_email'],
        twilio_voice: ['account_sid', 'auth_token', 'phone_number'],
        zoom: ['client_id', 'client_secret', 'bot_jid', 'verification_token'],
        zapier: ['webhook_url'],
        n8n: ['webhook_url'],
        make: ['webhook_url'],
      };

      const requiredFields = required[config.channel_type] ?? [];
      const decrypted = decryptConfigFields(config.config, SENSITIVE_KEYS[config.channel_type as ChannelType] ?? []);
      const missing = requiredFields.filter(f => !decrypted[f]);

      if (missing.length > 0) {
        return reply.status(400).send({
          error: 'Missing required fields',
          missing,
        });
      }

      // Actually test the connection for each channel type
      try {
        switch (config.channel_type) {
          case 'slack': {
            // Test Slack bot token by calling auth.test
            const token = decrypted['bot_token'] as string;
            const res = await fetch('https://slack.com/api/auth.test', {
              headers: { 'Authorization': `Bearer ${token}` },
              signal: AbortSignal.timeout(10_000),
            });
            const data = await res.json() as { ok: boolean; error?: string; team?: string; user?: string };
            if (!data.ok) return reply.status(400).send({ error: `Slack auth failed: ${data.error}` });
            return { success: true, message: `Connected as ${data.user} in ${data.team}` };
          }

          case 'discord': {
            // Test Discord bot token by fetching current user
            const token = decrypted['bot_token'] as string;
            const res = await fetch('https://discord.com/api/v10/users/@me', {
              headers: { 'Authorization': `Bot ${token}` },
              signal: AbortSignal.timeout(10_000),
            });
            if (!res.ok) return reply.status(400).send({ error: `Discord auth failed (${res.status})` });
            const data = await res.json() as { username: string; id: string };
            return { success: true, message: `Connected as ${data.username} (${data.id})` };
          }

          case 'telegram': {
            // Test Telegram bot token by calling getMe
            const token = decrypted['bot_token'] as string;
            const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
              signal: AbortSignal.timeout(10_000),
            });
            const data = await res.json() as { ok: boolean; result?: { username: string }; description?: string };
            if (!data.ok) return reply.status(400).send({ error: `Telegram auth failed: ${data.description}` });
            return { success: true, message: `Connected as @${data.result?.username}` };
          }

          case 'whatsapp': {
            // Test WhatsApp access token by fetching phone number info
            const token = decrypted['access_token'] as string;
            const phoneId = decrypted['phone_number_id'] as string;
            const res = await fetch(`https://graph.facebook.com/v18.0/${phoneId}`, {
              headers: { 'Authorization': `Bearer ${token}` },
              signal: AbortSignal.timeout(10_000),
            });
            if (!res.ok) return reply.status(400).send({ error: `WhatsApp auth failed (${res.status})` });
            const data = await res.json() as { display_phone_number?: string };
            return { success: true, message: `Connected to ${data.display_phone_number || phoneId}` };
          }

          case 'teams': {
            // Test Teams app credentials by getting OAuth token
            const appId = decrypted['app_id'] as string;
            const appPassword = decrypted['app_password'] as string;
            const res = await fetch('https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({
                grant_type: 'client_credentials',
                client_id: appId,
                client_secret: appPassword,
                scope: 'https://api.botframework.com/.default',
              }).toString(),
              signal: AbortSignal.timeout(10_000),
            });
            if (!res.ok) return reply.status(400).send({ error: `Teams OAuth failed (${res.status})` });
            return { success: true, message: 'Teams Bot Framework credentials valid' };
          }

          case 'twilio':
          case 'twilio_voice': {
            // Test Twilio credentials by fetching account info
            const sid = decrypted['account_sid'] as string;
            const token = decrypted['auth_token'] as string;
            const authStr = Buffer.from(`${sid}:${token}`).toString('base64');
            const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`, {
              headers: { 'Authorization': `Basic ${authStr}` },
              signal: AbortSignal.timeout(10_000),
            });
            if (!res.ok) return reply.status(400).send({ error: `Twilio auth failed (${res.status})` });
            const data = await res.json() as { friendly_name?: string; status?: string };
            return { success: true, message: `Connected to Twilio account: ${data.friendly_name} (${data.status})` };
          }

          case 'sendgrid': {
            // Test SendGrid API key by checking scopes
            const key = decrypted['api_key'] as string;
            const res = await fetch('https://api.sendgrid.com/v3/scopes', {
              headers: { 'Authorization': `Bearer ${key}` },
              signal: AbortSignal.timeout(10_000),
            });
            if (!res.ok) return reply.status(400).send({ error: `SendGrid auth failed (${res.status})` });
            return { success: true, message: 'SendGrid API key valid' };
          }

          case 'zoom': {
            // Test Zoom credentials by getting OAuth token
            const clientId = decrypted['client_id'] as string;
            const clientSecret = decrypted['client_secret'] as string;
            const authStr = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
            const res = await fetch('https://zoom.us/oauth/token?grant_type=client_credentials', {
              method: 'POST',
              headers: {
                'Authorization': `Basic ${authStr}`,
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              signal: AbortSignal.timeout(10_000),
            });
            if (!res.ok) return reply.status(400).send({ error: `Zoom OAuth failed (${res.status})` });
            return { success: true, message: 'Zoom credentials valid' };
          }

          case 'zapier':
          case 'n8n':
          case 'make': {
            // Test automation webhook URL by sending a test payload
            const webhookUrl = decrypted['webhook_url'] as string;
            const res = await fetch(webhookUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ event: 'test', source: 'askalf', timestamp: new Date().toISOString() }),
              signal: AbortSignal.timeout(10_000),
            });
            return { success: res.ok, status: res.status, message: res.ok ? 'Webhook reachable' : `Webhook returned ${res.status}` };
          }

          case 'email': {
            // Test SMTP by opening a connection
            const host = decrypted['smtp_host'] as string;
            const port = parseInt(decrypted['smtp_port'] as string || '587', 10);
            const net = await import('net');
            const connected = await new Promise<boolean>((resolve) => {
              const socket = net.connect({ host, port, timeout: 5000 }, () => {
                socket.destroy();
                resolve(true);
              });
              socket.on('error', () => resolve(false));
              socket.on('timeout', () => { socket.destroy(); resolve(false); });
            });
            if (!connected) return reply.status(400).send({ error: `Cannot connect to ${host}:${port}` });
            return { success: true, message: `SMTP server ${host}:${port} reachable` };
          }

          default:
            return { success: true, message: 'Configuration valid' };
        }
      } catch (err) {
        return reply.status(502).send({
          error: 'Channel test failed',
          message: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    },
  );
}

/**
 * Auto-register Telegram webhook URL after config save.
 */
async function autoRegisterTelegramWebhook(
  configId: string,
  config: Record<string, unknown>,
  request: FastifyRequest,
): Promise<void> {
  try {
    const { decrypt } = await import('../channels/crypto.js');
    let botToken = config['bot_token'] as string;
    // Try to decrypt (might already be encrypted)
    try { botToken = decrypt(botToken); } catch { /* already plaintext */ }

    if (!botToken) return;

    const baseUrl = process.env['BASE_URL'] ?? 'https://askalf.org';
    const webhookUrl = `${baseUrl}/api/v1/forge/channels/telegram/webhook/${configId}`;

    // Generate a webhook secret
    const { randomBytes } = await import('crypto');
    const secret = randomBytes(32).toString('hex');

    await TelegramProvider.registerWebhook(botToken, webhookUrl, secret);

    // Store the webhook secret in config
    const { encrypt } = await import('../channels/crypto.js');
    await query(
      `UPDATE channel_configs SET config = jsonb_set(config, '{webhook_secret}', $1::jsonb), updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(encrypt(secret)), configId],
    );

    request.log.info({ configId }, 'Telegram webhook registered');
  } catch (err) {
    request.log.warn({ configId, err: err instanceof Error ? err.message : err }, 'Failed to auto-register Telegram webhook');
  }
}
