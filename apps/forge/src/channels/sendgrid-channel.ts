/**
 * SendGrid Channel Provider
 * Handles SendGrid Inbound Parse webhooks and sends emails via SendGrid API.
 */

import { createHmac, timingSafeEqual } from 'crypto';
import type { ChannelProvider, ChannelConfig, ChannelInboundMessage, ChannelOutboundMessage, ChannelVerifyResult } from './types.js';

export class SendGridProvider implements ChannelProvider {
  type = 'sendgrid' as const;

  verifyWebhook(headers: Record<string, string>, body: unknown, config: ChannelConfig): ChannelVerifyResult {
    const webhookVerificationKey = config.config['webhook_verification_key'] as string | undefined;
    const apiKey = config.config['api_key'] as string | undefined;

    // If a SendGrid webhook verification key is configured, validate the signature
    if (webhookVerificationKey) {
      const signature = headers['x-twilio-email-event-webhook-signature'] || headers['X-Twilio-Email-Event-Webhook-Signature'];
      const timestamp = headers['x-twilio-email-event-webhook-timestamp'] || headers['X-Twilio-Email-Event-Webhook-Timestamp'];
      if (!signature || !timestamp) return { valid: false };

      const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
      const payload = timestamp + bodyStr;
      const expected = createHmac('sha256', webhookVerificationKey).update(payload).digest('base64');

      try {
        const sigBuf = Buffer.from(signature, 'base64');
        const expBuf = Buffer.from(expected, 'base64');
        if (sigBuf.length !== expBuf.length) return { valid: false };
        return { valid: timingSafeEqual(sigBuf, expBuf) };
      } catch {
        return { valid: false };
      }
    }

    // Fallback: check API key / bearer token if configured
    if (apiKey) {
      const authHeader = headers['authorization'] || headers['Authorization'];
      if (authHeader) {
        const token = authHeader.replace(/^Bearer\s+/i, '');
        if (token === apiKey) return { valid: true };
      }
      const xApiKey = headers['x-api-key'] || headers['X-API-Key'];
      if (xApiKey === apiKey) return { valid: true };
      return { valid: false };
    }

    // No credentials configured — accept but warn
    if (process.env['NODE_ENV'] === 'production') {
      console.warn('[SendGrid] verifyWebhook: no webhook_verification_key or api_key configured — accepting unauthenticated webhook');
    }
    return { valid: true };
  }

  parseMessage(body: unknown): ChannelInboundMessage | null {
    const payload = body as Record<string, unknown>;

    // SendGrid Inbound Parse format
    const text = (payload['text'] as string)
      || (payload['plain'] as string);

    if (!text || text.trim().length === 0) return null;

    const from = payload['from'] as string;
    const subject = payload['subject'] as string;

    const fullText = subject ? `Subject: ${subject}\n\n${text.trim()}` : text.trim();

    return {
      text: fullText,
      externalMessageId: payload['message-id'] as string | undefined,
      externalChannelId: 'sendgrid',
      externalUserId: from,
      metadata: {
        from,
        to: payload['to'] as string,
        subject,
        envelope: payload['envelope'],
      },
    };
  }

  async sendReply(config: ChannelConfig, message: ChannelOutboundMessage): Promise<void> {
    const apiKey = config.config['api_key'] as string;
    const fromEmail = config.config['from_email'] as string;
    const fromName = config.config['from_name'] as string || 'AskAlf Agent';

    if (!apiKey || !fromEmail) {
      throw new Error('SendGrid sendReply: missing api_key or from_email');
    }

    const toEmail = config.metadata?.['from'] as string;
    if (!toEmail) {
      throw new Error('SendGrid sendReply: no "from" address in inbound message metadata');
    }

    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: toEmail }] }],
        from: { email: fromEmail, name: fromName },
        subject: `Re: ${config.metadata?.['subject'] || 'Agent Response'}`,
        content: [{ type: 'text/plain', value: message.text }],
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`SendGrid send failed (${res.status}): ${errBody.substring(0, 200)}`);
    }
  }
}
