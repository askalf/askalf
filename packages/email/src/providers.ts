// SUBSTRATE v1: Email Providers
// Provider abstraction for different email services

import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { getLogger } from '@substrate/observability';
import type { EmailConfig, EmailMessage, EmailResult, EmailProvider } from './types.js';

const logger = getLogger();

/**
 * SMTP Provider using Nodemailer
 */
export class SmtpProvider implements EmailProvider {
  private transporter: Transporter;
  private from: { name: string; email: string };

  constructor(config: EmailConfig) {
    if (!config.smtp) {
      throw new Error('SMTP configuration required for SMTP provider');
    }

    this.from = config.from;
    this.transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: {
        user: config.smtp.auth.user,
        pass: config.smtp.auth.pass,
      },
    });
  }

  async send(message: EmailMessage): Promise<EmailResult> {
    try {
      const result = await this.transporter.sendMail({
        from: `"${this.from.name}" <${this.from.email}>`,
        to: Array.isArray(message.to) ? message.to.join(', ') : message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        replyTo: message.replyTo,
        cc: message.cc,
        bcc: message.bcc,
        attachments: message.attachments?.map((a) => ({
          filename: a.filename,
          content: a.content,
          contentType: a.contentType,
          encoding: a.encoding,
        })),
      });

      logger.info({ messageId: result.messageId, to: message.to }, 'Email sent via SMTP');

      return {
        success: true,
        messageId: result.messageId,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      logger.error({ error, to: message.to }, 'Failed to send email via SMTP');

      return {
        success: false,
        error,
      };
    }
  }

  async verify(): Promise<boolean> {
    try {
      await this.transporter.verify();
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * SendGrid Provider
 * Uses SendGrid's HTTP API
 */
export class SendGridProvider implements EmailProvider {
  private apiKey: string;
  private from: { name: string; email: string };

  constructor(config: EmailConfig) {
    if (!config.sendgrid?.apiKey) {
      throw new Error('SendGrid API key required for SendGrid provider');
    }

    this.apiKey = config.sendgrid.apiKey;
    this.from = config.from;
  }

  async send(message: EmailMessage): Promise<EmailResult> {
    try {
      const toAddresses = Array.isArray(message.to) ? message.to : [message.to];

      const requestBody = {
        personalizations: [
          {
            to: toAddresses.map((email) => ({ email })),
            ...(message.cc && {
              cc: (Array.isArray(message.cc) ? message.cc : [message.cc]).map((email) => ({
                email,
              })),
            }),
            ...(message.bcc && {
              bcc: (Array.isArray(message.bcc) ? message.bcc : [message.bcc]).map((email) => ({
                email,
              })),
            }),
          },
        ],
        from: {
          email: this.from.email,
          name: this.from.name,
        },
        subject: message.subject,
        content: [
          ...(message.text ? [{ type: 'text/plain', value: message.text }] : []),
          ...(message.html ? [{ type: 'text/html', value: message.html }] : []),
        ],
        ...(message.replyTo && {
          reply_to: { email: message.replyTo },
        }),
      };

      const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`SendGrid API error: ${response.status} ${errorText}`);
      }

      const messageId = response.headers.get('x-message-id');
      logger.info({ messageId, to: message.to }, 'Email sent via SendGrid');

      const result: EmailResult = { success: true };
      if (messageId) {
        result.messageId = messageId;
      }
      return result;
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      logger.error({ error, to: message.to }, 'Failed to send email via SendGrid');

      return {
        success: false,
        error,
      };
    }
  }
}

/**
 * AWS SES Provider
 * Uses AWS SDK v3
 */
export class SesProvider implements EmailProvider {
  private region: string;
  private credentials: { accessKeyId: string; secretAccessKey: string };
  private from: { name: string; email: string };

  constructor(config: EmailConfig) {
    if (!config.ses) {
      throw new Error('SES configuration required for SES provider');
    }

    this.region = config.ses.region;
    this.credentials = {
      accessKeyId: config.ses.accessKeyId,
      secretAccessKey: config.ses.secretAccessKey,
    };
    this.from = config.from;
  }

  async send(message: EmailMessage): Promise<EmailResult> {
    try {
      // Use AWS SES v2 HTTP API directly
      const toAddresses = Array.isArray(message.to) ? message.to : [message.to];
      const timestamp = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
      const date = timestamp.substring(0, 8);

      // Build raw email
      const boundary = `----=_Part_${Date.now()}`;
      const rawEmail = this.buildRawEmail(message, boundary);

      // Create AWS Signature Version 4
      const host = `email.${this.region}.amazonaws.com`;
      const endpoint = `https://${host}/v2/email/outbound-emails`;

      const requestBody = JSON.stringify({
        Content: {
          Raw: {
            Data: Buffer.from(rawEmail).toString('base64'),
          },
        },
        Destination: {
          ToAddresses: toAddresses,
          ...(message.cc && {
            CcAddresses: Array.isArray(message.cc) ? message.cc : [message.cc],
          }),
          ...(message.bcc && {
            BccAddresses: Array.isArray(message.bcc) ? message.bcc : [message.bcc],
          }),
        },
        FromEmailAddress: `"${this.from.name}" <${this.from.email}>`,
      });

      // Note: In production, use @aws-sdk/client-sesv2 for proper signing
      // This is a simplified implementation
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Host: host,
          'X-Amz-Date': timestamp,
          // In production, add proper AWS Signature V4 headers
        },
        body: requestBody,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`SES API error: ${response.status} ${errorText}`);
      }

      const jsonResult = (await response.json()) as { MessageId?: string };
      logger.info({ messageId: jsonResult.MessageId, to: message.to }, 'Email sent via SES');

      const result: EmailResult = { success: true };
      if (jsonResult.MessageId) {
        result.messageId = jsonResult.MessageId;
      }
      return result;
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      logger.error({ error, to: message.to }, 'Failed to send email via SES');

      return {
        success: false,
        error,
      };
    }
  }

  private buildRawEmail(message: EmailMessage, boundary: string): string {
    const toAddresses = Array.isArray(message.to) ? message.to.join(', ') : message.to;

    let email = `From: "${this.from.name}" <${this.from.email}>\r\n`;
    email += `To: ${toAddresses}\r\n`;
    email += `Subject: ${message.subject}\r\n`;
    email += `MIME-Version: 1.0\r\n`;
    email += `Content-Type: multipart/alternative; boundary="${boundary}"\r\n\r\n`;

    if (message.text) {
      email += `--${boundary}\r\n`;
      email += `Content-Type: text/plain; charset=UTF-8\r\n\r\n`;
      email += `${message.text}\r\n\r\n`;
    }

    if (message.html) {
      email += `--${boundary}\r\n`;
      email += `Content-Type: text/html; charset=UTF-8\r\n\r\n`;
      email += `${message.html}\r\n\r\n`;
    }

    email += `--${boundary}--`;

    return email;
  }
}

/**
 * Console Provider (for development/testing)
 * Logs emails to console instead of sending
 */
export class ConsoleProvider implements EmailProvider {
  async send(message: EmailMessage): Promise<EmailResult> {
    const to = Array.isArray(message.to) ? message.to.join(', ') : message.to;

    console.log('\n========== EMAIL ==========');
    console.log(`To: ${to}`);
    console.log(`Subject: ${message.subject}`);
    if (message.text) {
      console.log(`\n--- Text Content ---\n${message.text}`);
    }
    if (message.html) {
      console.log(`\n--- HTML Content ---\n${message.html}`);
    }
    console.log('===========================\n');

    return {
      success: true,
      messageId: `console-${Date.now()}`,
    };
  }
}

/**
 * Create email provider based on configuration
 */
export function createProvider(config: EmailConfig): EmailProvider {
  switch (config.provider) {
    case 'smtp':
      return new SmtpProvider(config);
    case 'sendgrid':
      return new SendGridProvider(config);
    case 'ses':
      return new SesProvider(config);
    default:
      throw new Error(`Unknown email provider: ${config.provider}`);
  }
}
