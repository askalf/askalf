/**
 * Twilio SMS Channel Provider
 * Handles inbound SMS webhooks and sends replies via Twilio API.
 */

import { createHmac } from 'crypto';
import type { ChannelProvider, ChannelConfig, ChannelInboundMessage, ChannelOutboundMessage, ChannelVerifyResult } from './types.js';

export class TwilioSmsProvider implements ChannelProvider {
  type = 'twilio' as const;

  verifyWebhook(headers: Record<string, string>, body: unknown, config: ChannelConfig): ChannelVerifyResult {
    const authToken = config.config['auth_token'] as string | undefined;
    if (!authToken) return { valid: false };

    // Twilio uses X-Twilio-Signature for webhook verification
    const signature = headers['x-twilio-signature'];
    if (!signature) return { valid: false };

    // For now, accept if auth token is configured
    // Full Twilio signature validation requires the full URL + sorted params
    return { valid: true };
  }

  parseMessage(body: unknown): ChannelInboundMessage | null {
    const payload = body as Record<string, unknown>;

    // Twilio sends SMS webhooks as form-encoded data
    const text = (payload['Body'] as string) || (payload['body'] as string);
    if (!text || text.trim().length === 0) return null;

    return {
      text: text.trim(),
      externalMessageId: (payload['MessageSid'] as string) || (payload['SmsSid'] as string),
      externalChannelId: (payload['To'] as string) || (payload['to'] as string),
      externalUserId: (payload['From'] as string) || (payload['from'] as string),
      metadata: {
        from: payload['From'] || payload['from'],
        to: payload['To'] || payload['to'],
        accountSid: payload['AccountSid'],
        numMedia: payload['NumMedia'],
      },
    };
  }

  async sendReply(config: ChannelConfig, message: ChannelOutboundMessage): Promise<void> {
    const accountSid = config.config['account_sid'] as string;
    const authToken = config.config['auth_token'] as string;
    const fromNumber = config.config['phone_number'] as string;

    if (!accountSid || !authToken || !fromNumber) return;

    const toNumber = config.metadata?.['from'] as string;
    if (!toNumber) return;

    const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

    await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${auth}`,
      },
      body: new URLSearchParams({
        To: toNumber,
        From: fromNumber,
        Body: message.text.substring(0, 1600), // SMS limit
      }).toString(),
      signal: AbortSignal.timeout(10_000),
    });
  }
}
