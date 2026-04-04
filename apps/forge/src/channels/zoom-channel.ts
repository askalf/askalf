/**
 * Zoom Channel Provider
 * Handles Zoom Chatbot webhooks and sends messages via Zoom API.
 */

import { createHmac } from 'crypto';
import type { ChannelProvider, ChannelConfig, ChannelInboundMessage, ChannelOutboundMessage, ChannelVerifyResult } from './types.js';

export class ZoomProvider implements ChannelProvider {
  type = 'zoom' as const;

  verifyWebhook(headers: Record<string, string>, body: unknown, config: ChannelConfig): ChannelVerifyResult {
    const verificationToken = config.config['verification_token'] as string | undefined;
    if (!verificationToken) return { valid: false };

    // Zoom sends x-zm-signature header for webhook validation
    const signature = headers['x-zm-signature'];
    const timestamp = headers['x-zm-request-timestamp'];

    if (signature && timestamp) {
      const rawBody = typeof body === 'string' ? body : JSON.stringify(body);
      const message = `v0:${timestamp}:${rawBody}`;
      const hash = createHmac('sha256', config.config['client_secret'] as string || verificationToken)
        .update(message)
        .digest('hex');
      const expected = `v0=${hash}`;

      if (signature === expected) return { valid: true };
    }

    // Fallback: check authorization header
    const authHeader = headers['authorization'];
    if (authHeader === verificationToken) return { valid: true };

    // In production, reject unverified requests
    if (process.env['NODE_ENV'] === 'production') {
      return { valid: false };
    }

    console.warn('[Zoom] Webhook verification fallback (dev mode)');
    return { valid: true };
  }

  handleChallenge(_headers: Record<string, string>, body: unknown, config: ChannelConfig): ChannelVerifyResult | null {
    const payload = body as Record<string, unknown>;

    // Zoom URL validation event
    if (payload['event'] === 'endpoint.url_validation') {
      const plainToken = (payload['payload'] as Record<string, unknown>)?.['plainToken'] as string;
      if (plainToken) {
        const hashForValidation = createHmac('sha256', config.config['client_secret'] as string || '')
          .update(plainToken)
          .digest('hex');
        return {
          valid: true,
          challengeResponse: {
            plainToken,
            encryptedToken: hashForValidation,
          },
        };
      }
    }

    return null;
  }

  parseMessage(body: unknown): ChannelInboundMessage | null {
    const payload = body as Record<string, unknown>;

    // Zoom Chatbot message event
    if (payload['event'] !== 'bot_notification') return null;

    const eventPayload = payload['payload'] as Record<string, unknown>;
    if (!eventPayload) return null;

    const cmd = eventPayload['cmd'] as string;
    const text = (eventPayload['toJid'] ? cmd : null)
      || (eventPayload['cmd'] as string);

    if (!text || text.trim().length === 0) return null;

    return {
      text: text.trim(),
      externalMessageId: eventPayload['messageId'] as string | undefined,
      externalChannelId: eventPayload['channelName'] as string || 'zoom',
      externalUserId: eventPayload['userId'] as string | undefined,
      metadata: {
        accountId: eventPayload['accountId'],
        toJid: eventPayload['toJid'],
        userJid: eventPayload['userJid'],
        robotJid: eventPayload['robotJid'],
      },
    };
  }

  async sendReply(config: ChannelConfig, message: ChannelOutboundMessage): Promise<void> {
    const clientId = config.config['client_id'] as string;
    const clientSecret = config.config['client_secret'] as string;
    const botJid = config.config['bot_jid'] as string;

    if (!clientId || !clientSecret || !botJid) {
      throw new Error('Zoom sendReply: missing client_id, client_secret, or bot_jid');
    }

    // Get OAuth token
    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const tokenRes = await fetch('https://zoom.us/oauth/token?grant_type=client_credentials', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!tokenRes.ok) {
      const errBody = await tokenRes.text().catch(() => '');
      throw new Error(`Zoom OAuth failed (${tokenRes.status}): ${errBody.substring(0, 200)}`);
    }
    const tokenData = await tokenRes.json() as { access_token: string };

    const toJid = config.metadata?.['toJid'] as string;
    const accountId = config.metadata?.['accountId'] as string;
    if (!toJid) {
      throw new Error('Zoom sendReply: no toJid in message metadata');
    }

    const replyRes = await fetch('https://api.zoom.us/v2/im/chat/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenData.access_token}`,
      },
      body: JSON.stringify({
        robot_jid: botJid,
        to_jid: toJid,
        account_id: accountId,
        content: {
          head: { text: 'Agent Response' },
          body: [{ type: 'message', text: message.text }],
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!replyRes.ok) {
      const errBody = await replyRes.text().catch(() => '');
      throw new Error(`Zoom send failed (${replyRes.status}): ${errBody.substring(0, 200)}`);
    }
  }
}
