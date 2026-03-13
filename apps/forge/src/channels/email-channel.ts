/**
 * Email Channel Provider
 * Handles inbound email webhooks (from SendGrid Inbound Parse, Mailgun, etc.)
 * and sends outbound emails via SMTP using nodemailer, or via raw fetch fallback.
 */

import type { ChannelProvider, ChannelConfig, ChannelInboundMessage, ChannelOutboundMessage, ChannelVerifyResult } from './types.js';

export class EmailProvider implements ChannelProvider {
  type = 'email' as const;

  verifyWebhook(headers: Record<string, string>, _body: unknown, _config: ChannelConfig): ChannelVerifyResult {
    // Email webhooks come from configured email services
    const contentType = headers['content-type'] || '';
    if (contentType.includes('json') || contentType.includes('form')) {
      return { valid: true };
    }
    return { valid: true };
  }

  parseMessage(body: unknown): ChannelInboundMessage | null {
    const payload = body as Record<string, unknown>;

    // Support multiple inbound email formats:
    // SendGrid Inbound Parse, Mailgun, generic
    const text = (payload['text'] as string)
      || (payload['plain'] as string)
      || (payload['body-plain'] as string)
      || (payload['stripped-text'] as string);

    if (!text || text.trim().length === 0) return null;

    const from = (payload['from'] as string)
      || (payload['sender'] as string)
      || (payload['envelope'] as Record<string, string>)?.['from'];

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

    if (!smtpHost || !smtpUser || !smtpPass) {
      throw new Error('Email sendReply: missing SMTP configuration (smtp_host, smtp_user, smtp_pass)');
    }

    const replyTo = config.metadata?.['from'] as string;
    if (!replyTo) {
      throw new Error('Email sendReply: no "from" address in inbound message metadata');
    }

    // Try nodemailer first
    try {
      // @ts-expect-error nodemailer is optional — only available if installed
      const nodemailer = await import('nodemailer');
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: parseInt(smtpPort || '587', 10),
        secure: smtpPort === '465',
        auth: { user: smtpUser, pass: smtpPass },
      });

      await transporter.sendMail({
        from: fromEmail,
        to: replyTo,
        subject: `Re: ${config.metadata?.['subject'] || 'Agent Response'}`,
        text: message.text,
      });
      return;
    } catch (importErr) {
      // nodemailer not installed — fall back to raw SMTP via fetch (for services with HTTP API)
    }

    // Fallback: use raw SMTP connection via net/tls
    // This is a minimal SMTP implementation for environments without nodemailer
    const net = await import('net');
    const tls = await import('tls');

    const port = parseInt(smtpPort || '587', 10);
    const secure = port === 465;

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('SMTP connection timeout')), 15_000);

      const commands: string[] = [];
      let step = 0;

      function sendNext(socket: import('net').Socket | import('tls').TLSSocket) {
        const cmds = [
          `EHLO askalf.local\r\n`,
          `AUTH LOGIN\r\n`,
          `${Buffer.from(smtpUser).toString('base64')}\r\n`,
          `${Buffer.from(smtpPass).toString('base64')}\r\n`,
          `MAIL FROM:<${fromEmail}>\r\n`,
          `RCPT TO:<${replyTo}>\r\n`,
          `DATA\r\n`,
          `From: ${fromEmail}\r\nTo: ${replyTo}\r\nSubject: Re: ${config.metadata?.['subject'] || 'Agent Response'}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${message.text}\r\n.\r\n`,
          `QUIT\r\n`,
        ];

        if (step < cmds.length) {
          socket.write(cmds[step]!);
          step++;
        }
      }

      function handleConnection(socket: import('net').Socket | import('tls').TLSSocket) {
        socket.setEncoding('utf8');
        socket.on('data', (data: string) => {
          const code = parseInt(data.substring(0, 3), 10);
          if (code >= 400 && step > 0) {
            clearTimeout(timeout);
            socket.destroy();
            reject(new Error(`SMTP error at step ${step}: ${data.trim().substring(0, 200)}`));
            return;
          }
          if (step === 0 && data.includes('220')) {
            sendNext(socket);
          } else if (data.includes('221')) {
            // QUIT acknowledged
            clearTimeout(timeout);
            socket.destroy();
            resolve();
          } else {
            sendNext(socket);
          }
        });
        socket.on('error', (err) => {
          clearTimeout(timeout);
          reject(new Error(`SMTP socket error: ${err.message}`));
        });
      }

      if (secure) {
        const socket = tls.connect({ host: smtpHost, port }, () => handleConnection(socket));
      } else {
        const socket = net.connect({ host: smtpHost, port }, () => handleConnection(socket));
      }
    });
  }
}
