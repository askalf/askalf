/**
 * Generic Webhooks Channel Provider
 * Accepts inbound webhooks with HMAC-SHA256 signature verification.
 * Universal webhook endpoint for custom integrations.
 */

import { createHmac, timingSafeEqual } from 'crypto';
import type { ChannelProvider, ChannelConfig, ChannelInboundMessage, ChannelOutboundMessage, ChannelVerifyResult } from './types.js';

export class WebhooksProvider implements ChannelProvider {
  type = 'webhooks' as const;

  verifyWebhook(headers: Record<string, string>, body: unknown, config: ChannelConfig): ChannelVerifyResult {
    const secret = config.config['webhook_secret'] as string | undefined;
    if (!secret) {
      // No secret configured — accept with API key check only
      const apiKey = config.config['api_key'] as string | undefined;
      if (!apiKey) return { valid: true };
      const authHeader = headers['authorization'] || headers['Authorization'];
      if (authHeader) {
        const token = authHeader.replace(/^Bearer\s+/i, '');
        if (token === apiKey) return { valid: true };
      }
      const xApiKey = headers['x-api-key'] || headers['X-API-Key'];
      if (xApiKey === apiKey) return { valid: true };
      return { valid: false };
    }

    // HMAC-SHA256 signature verification
    const signature = headers['x-webhook-signature'] || headers['X-Webhook-Signature']
      || headers['x-hub-signature-256'] || headers['X-Hub-Signature-256'];
    if (!signature) return { valid: false };

    const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
    const expected = createHmac('sha256', secret).update(bodyStr).digest('hex');
    const sig = signature.replace(/^sha256=/, '');

    try {
      const sigBuf = Buffer.from(sig, 'hex');
      const expBuf = Buffer.from(expected, 'hex');
      if (sigBuf.length !== expBuf.length) return { valid: false };
      return { valid: timingSafeEqual(sigBuf, expBuf) };
    } catch {
      return { valid: false };
    }
  }

  parseMessage(body: unknown): ChannelInboundMessage | null {
    const payload = body as Record<string, unknown>;

    // Flexible payload parsing — accept common field names
    const text = (payload['message'] as string)
      || (payload['text'] as string)
      || (payload['input'] as string)
      || (payload['query'] as string)
      || (payload['prompt'] as string)
      || (payload['content'] as string);

    if (!text || text.trim().length === 0) return null;

    return {
      text: text.trim(),
      externalMessageId: (payload['id'] as string) || (payload['message_id'] as string),
      externalChannelId: 'webhooks',
      externalUserId: (payload['user_id'] as string) || (payload['sender'] as string),
      metadata: {
        source: 'webhook',
        agentId: payload['agent_id'] as string | undefined,
        callbackUrl: payload['callback_url'] as string | undefined,
        event: payload['event'] as string | undefined,
        ...payload['metadata'] as Record<string, unknown> | undefined,
      },
    };
  }

  async sendReply(config: ChannelConfig, message: ChannelOutboundMessage): Promise<void> {
    const callbackUrl = config.config['callback_url'] as string | undefined;
    if (!callbackUrl) return;

    const secret = config.config['webhook_secret'] as string | undefined;
    const body = JSON.stringify({
      executionId: message.executionId,
      text: message.text,
      channelMessageId: message.channelMessageId,
      timestamp: new Date().toISOString(),
    });

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (secret) {
      headers['X-Webhook-Signature'] = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
    }

    await fetch(callbackUrl, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(10_000),
    }).catch(() => { /* best-effort delivery */ });
  }
}
