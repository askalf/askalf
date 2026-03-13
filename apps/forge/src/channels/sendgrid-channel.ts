/**
 * SendGrid Channel Provider
 * Handles SendGrid Inbound Parse webhooks and sends emails via SendGrid API.
 */

import type { ChannelProvider, ChannelConfig, ChannelInboundMessage, ChannelOutboundMessage, ChannelVerifyResult } from './types.js';

export class SendGridProvider implements ChannelProvider {
  type = 'sendgrid' as const;

  verifyWebhook(headers: Record<string, string>, _body: unknown, _config: ChannelConfig): ChannelVerifyResult {
    // SendGrid Inbound Parse sends multipart/form-data or JSON
    // Verification is done via the Inbound Parse webhook configuration in SendGrid dashboard
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
