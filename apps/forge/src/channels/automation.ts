/**
 * Automation Channel Providers
 * Zapier, n8n, Make (Integromat) — webhook-based automation platforms.
 * These accept inbound webhooks from the platform and can send results back.
 */

import { createHmac, timingSafeEqual } from 'crypto';
import type { ChannelProvider, ChannelConfig, ChannelInboundMessage, ChannelOutboundMessage, ChannelVerifyResult } from './types.js';
import { isAllowedUrl } from './webhooks.js';

/**
 * Base class for webhook-based automation platforms.
 * All follow the same pattern: receive webhook → verify API key → parse message → dispatch.
 */
class WebhookAutomationProvider implements ChannelProvider {
  type: 'zapier' | 'n8n' | 'make';
  platformName: string;

  constructor(type: 'zapier' | 'n8n' | 'make', platformName: string) {
    this.type = type;
    this.platformName = platformName;
  }

  verifyWebhook(headers: Record<string, string>, body: unknown, config: ChannelConfig): ChannelVerifyResult {
    const apiKey = config.config['api_key'] as string | undefined;
    if (!apiKey) {
      // No API key configured — accept all (for development/testing)
      return { valid: true };
    }

    // Check Authorization header
    const authHeader = headers['authorization'] || headers['Authorization'];
    if (authHeader) {
      const token = authHeader.replace(/^Bearer\s+/i, '');
      if (token === apiKey) return { valid: true };
    }

    // Check X-API-Key header
    const xApiKey = headers['x-api-key'] || headers['X-API-Key'];
    if (xApiKey === apiKey) return { valid: true };

    // Check query param (some platforms send in URL)
    return { valid: false };
  }

  parseMessage(body: unknown): ChannelInboundMessage | null {
    const payload = body as Record<string, unknown>;

    // Standard webhook payload format
    const text = (payload['message'] as string)
      || (payload['text'] as string)
      || (payload['input'] as string)
      || (payload['query'] as string)
      || (payload['prompt'] as string);

    if (!text || text.trim().length === 0) return null;

    return {
      text: text.trim(),
      externalMessageId: (payload['id'] as string) || (payload['execution_id'] as string),
      externalChannelId: this.type,
      externalUserId: payload['user_id'] as string | undefined,
      metadata: {
        source: this.platformName,
        agentId: payload['agent_id'] as string | undefined,
        callbackUrl: payload['callback_url'] as string | undefined,
        ...payload['metadata'] as Record<string, unknown> | undefined,
      },
    };
  }

  async sendReply(config: ChannelConfig, message: ChannelOutboundMessage): Promise<void> {
    const webhookUrl = config.config['webhook_url'] as string | undefined;
    if (!webhookUrl) {
      console.warn(`[${this.platformName}] sendReply skipped: no webhook_url configured`);
      return;
    }

    if (!isAllowedUrl(webhookUrl)) {
      console.warn(`[${this.platformName}] sendReply blocked: webhook_url failed SSRF validation`);
      return;
    }

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        executionId: message.executionId,
        text: message.text,
        channelMessageId: message.channelMessageId,
        timestamp: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      console.warn(`[${this.platformName}] sendReply webhook returned ${res.status}`);
    }
  }
}

export class ZapierProvider extends WebhookAutomationProvider {
  constructor() { super('zapier', 'Zapier'); }
}

export class N8nProvider extends WebhookAutomationProvider {
  constructor() { super('n8n', 'n8n'); }
}

export class MakeProvider extends WebhookAutomationProvider {
  constructor() { super('make', 'Make'); }
}
