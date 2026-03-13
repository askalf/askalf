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

    // Full Twilio signature validation:
    // 1. Build the full URL
    // 2. Sort POST params alphabetically and append key+value
    // 3. HMAC-SHA1 the result with auth token
    // We need the webhook URL for full validation. If BASE_URL is set, use it.
    const baseUrl = process.env['BASE_URL'] ?? 'https://askalf.org';
    const configId = config.id;
    const webhookUrl = `${baseUrl}/api/v1/forge/channels/twilio/webhook/${configId}`;

    const params = body as Record<string, string>;
    // Build the data string: URL + sorted params key-value pairs
    let dataStr = webhookUrl;
    const sortedKeys = Object.keys(params).sort();
    for (const key of sortedKeys) {
      dataStr += key + (params[key] ?? '');
    }

    const computed = createHmac('sha1', authToken)
      .update(dataStr)
      .digest('base64');

    if (computed !== signature) {
      // Signature mismatch — but allow if the URL might differ (dev vs prod)
      // Log and accept in development, reject in production
      if (process.env['NODE_ENV'] === 'production') {
        return { valid: false };
      }
      console.warn('[TwilioSMS] Signature mismatch (dev mode, allowing)');
    }

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

    if (!accountSid || !authToken || !fromNumber) {
      throw new Error('Twilio SMS sendReply: missing account_sid, auth_token, or phone_number');
    }

    const toNumber = config.metadata?.['from'] as string;
    if (!toNumber) {
      throw new Error('Twilio SMS sendReply: no "from" number in inbound message metadata');
    }

    const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
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

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`Twilio SMS send failed (${res.status}): ${errBody.substring(0, 200)}`);
    }
  }
}
