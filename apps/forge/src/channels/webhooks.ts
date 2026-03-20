/**
 * Generic Webhooks Channel Provider
 * Accepts inbound webhooks with HMAC-SHA256 signature verification.
 * Universal webhook endpoint for custom integrations.
 */

import { createHmac, timingSafeEqual } from 'crypto';
import type { ChannelProvider, ChannelConfig, ChannelInboundMessage, ChannelOutboundMessage, ChannelVerifyResult } from './types.js';

/**
 * Validates that a URL is safe to make outbound requests to.
 * Blocks private/internal IP ranges to prevent SSRF attacks.
 * Allows HTTPS URLs and HTTP only for localhost in non-production environments.
 */
export function isAllowedUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  const hostname = parsed.hostname.toLowerCase();

  // Only allow http and https schemes
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return false;
  }

  // Allow HTTP only for localhost in development
  if (parsed.protocol === 'http:') {
    const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
    if (!isLocalhost) return false;
    // In production, block even localhost HTTP
    if (process.env['NODE_ENV'] === 'production') return false;
  }

  // Block IPv6 loopback and private ranges
  if (hostname === '::1' || hostname === '[::1]') return false;
  if (hostname.startsWith('fc00:') || hostname.startsWith('fd') || hostname.startsWith('fe80:')) return false;

  // Block private IPv4 ranges
  // Strip brackets for IPv6-mapped IPv4
  const bare = hostname.replace(/^\[|\]$/g, '');
  const ipv4Match = bare.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [, a, b] = ipv4Match.map(Number) as [number, number, number, number, number];
    // 10.0.0.0/8
    if (a === 10) return false;
    // 172.16.0.0/12
    if (a === 172 && b! >= 16 && b! <= 31) return false;
    // 192.168.0.0/16
    if (a === 192 && b === 168) return false;
    // 127.0.0.0/8 (loopback) — block in production
    if (a === 127) {
      if (process.env['NODE_ENV'] === 'production') return false;
    }
    // 169.254.0.0/16 (link-local)
    if (a === 169 && b === 254) return false;
    // 0.0.0.0
    if (a === 0) return false;
  }

  // Block known internal hostnames
  if (hostname === 'metadata.google.internal' || hostname === 'metadata.google.com') return false;
  if (bare.endsWith('.internal') || bare.endsWith('.local')) {
    // Allow localhost.local but block others in production
    if (process.env['NODE_ENV'] === 'production') return false;
  }

  return true;
}

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
    if (!callbackUrl) {
      console.warn('[Webhooks] sendReply skipped: no callback_url configured');
      return;
    }

    if (!isAllowedUrl(callbackUrl)) {
      console.warn('[Webhooks] sendReply blocked: callback_url failed SSRF validation');
      return;
    }

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

    const res = await fetch(callbackUrl, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      console.warn(`[Webhooks] sendReply callback returned ${res.status}`);
    }
  }
}
