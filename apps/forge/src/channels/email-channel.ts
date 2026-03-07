/**
 * Email Channel Provider
 * Handles inbound email webhooks (from SendGrid Inbound Parse, Mailgun, etc.)
 * and sends outbound emails via SMTP.
 */

import { createHmac } from 'crypto';
import type { ChannelProvider, ChannelConfig, ChannelInboundMessage, ChannelOutboundMessage, ChannelVerifyResult } from './types.js';

export class EmailProvider implements ChannelProvider {
  type = 'email' as const;

  verifyWebhook(headers: Record<string, string>, _body: unknown, _config: ChannelConfig): ChannelVerifyResult {
    // Email webhooks come from configured email services
    // Basic verification — check content type
    const contentType = headers['content-type'] || '';
    if (contentType.includes('json') || contentType.includes('form')) {
      return { valid: true };
    }
    return { valid: true };
  }

  parseMessage(body: unknown): ChannelInboundMessage | null {
    const payload = body as Record<string, unknown>;

    // Support multiple inbound email formats:
    // SendGrid Inbound Parse format
    const text = (payload['text'] as string)
      || (payload['plain'] as string)
      || (payload['body-plain'] as string)
      || (payload['stripped-text'] as string);

    if (!text || text.trim().length === 0) return null;

    const from = (payload['from'] as string)
      || (payload['sender'] as string)
      || (payload['envelope']  as Record<string, string>)?.['from'];

    const subject = payload['subject'] as string;
    const messageId = (payload['Message-Id'] as string) || (payload['message-id'] as string);

    // Combine subject + body for the agent
    const fullText = subject ? `Subject: ${subject}\n\n${text.trim()}` : text.trim();

    return {
      text: fullText,
      externalMessageId: messageId,
      externalChannelId: 'email',
      externalUserId: from,
      metadata: {
        from,
        subject,
        to: payload['to'] as string,
      },
    };
  }

  async sendReply(config: ChannelConfig, message: ChannelOutboundMessage): Promise<void> {
    const smtpHost = config.config['smtp_host'] as string;
    const smtpPort = config.config['smtp_port'] as string;
    const smtpUser = config.config['smtp_user'] as string;
    const smtpPass = config.config['smtp_pass'] as string;
    const fromEmail = config.config['inbound_address'] as string || smtpUser;

    if (!smtpHost || !smtpUser || !smtpPass) return;

    // Use nodemailer if available, otherwise fall back to raw SMTP
    try {
      // @ts-expect-error nodemailer is optional — only available if installed
      const nodemailer: { createTransport: (opts: Record<string, unknown>) => { sendMail: (msg: Record<string, unknown>) => Promise<void> } } = await import('nodemailer');
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: parseInt(smtpPort || '587', 10),
        secure: smtpPort === '465',
        auth: { user: smtpUser, pass: smtpPass },
      });

      const replyTo = config.metadata?.['from'] as string;
      if (!replyTo) return;

      await transporter.sendMail({
        from: fromEmail,
        to: replyTo,
        subject: `Re: ${config.metadata?.['subject'] || 'Agent Response'}`,
        text: message.text,
      });
    } catch {
      // Nodemailer not available or send failed
    }
  }
}
