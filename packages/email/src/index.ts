// AskAlf Email Service
// Core email service with provider abstraction

import { getLogger } from '@askalf/observability';
import {
  createProvider,
  ConsoleProvider,
  SmtpProvider,
  SendGridProvider,
  SesProvider,
} from './providers.js';
import { getTemplate } from './templates.js';
import type {
  EmailConfig,
  EmailMessage,
  EmailResult,
  EmailProvider,
  InterventionAlertVars,
} from './types.js';
import type { EmailTemplate, EmailTemplateVars } from './templates.js';

// Re-export types and templates
export * from './types.js';
export * from './templates.js';
export { ConsoleProvider, SmtpProvider, SendGridProvider, SesProvider, createProvider };

const logger = getLogger();

// Global email service instance
let emailService: EmailService | null = null;

/**
 * Email Service
 */
export class EmailService {
  private provider: EmailProvider;
  private enabled: boolean;

  constructor(config: EmailConfig | null) {
    if (!config) {
      this.provider = new ConsoleProvider();
      this.enabled = false;
      logger.warn('Email service initialized with ConsoleProvider (emails will be logged, not sent)');
    } else {
      this.provider = createProvider(config);
      this.enabled = true;
      logger.info({ provider: config.provider }, 'Email service initialized');
    }
  }

  async send(message: EmailMessage): Promise<EmailResult> {
    return this.provider.send(message);
  }

  async sendTemplate(
    to: string | string[],
    template: EmailTemplate,
    vars: EmailTemplateVars
  ): Promise<EmailResult> {
    const rendered = getTemplate(template, vars);
    return this.send({
      to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
  }

  isEnabled(): boolean {
    return this.enabled;
  }
}

export function initializeEmail(config: EmailConfig | null): void {
  emailService = new EmailService(config);
}

export function initializeEmailFromEnv(): void {
  const provider = process.env['EMAIL_PROVIDER'] as 'smtp' | 'sendgrid' | 'ses' | undefined;

  if (!provider) {
    initializeEmail(null);
    return;
  }

  const fromName = process.env['EMAIL_FROM_NAME'] ?? 'AskAlf';
  const fromEmail = process.env['EMAIL_FROM_ADDRESS'] ?? 'noreply@askalf.org';

  const config: EmailConfig = {
    provider,
    from: {
      name: fromName,
      email: fromEmail,
    },
  };

  switch (provider) {
    case 'smtp':
      config.smtp = {
        host: process.env['SMTP_HOST'] ?? 'localhost',
        port: parseInt(process.env['SMTP_PORT'] ?? '587', 10),
        secure: process.env['SMTP_SECURE'] === 'true',
        auth: {
          user: process.env['SMTP_USER'] ?? '',
          pass: process.env['SMTP_PASS'] ?? '',
        },
      };
      break;

    case 'sendgrid':
      config.sendgrid = {
        apiKey: process.env['SENDGRID_API_KEY'] ?? '',
      };
      break;

    case 'ses':
      config.ses = {
        region: process.env['AWS_REGION'] ?? 'us-east-1',
        accessKeyId: process.env['AWS_ACCESS_KEY_ID'] ?? '',
        secretAccessKey: process.env['AWS_SECRET_ACCESS_KEY'] ?? '',
      };
      break;
  }

  initializeEmail(config);
}

export function getEmailService(): EmailService {
  if (!emailService) {
    initializeEmailFromEnv();
  }
  return emailService!;
}

export async function sendEmail(message: EmailMessage): Promise<EmailResult> {
  return getEmailService().send(message);
}

export async function sendInterventionAlert(
  to: string,
  vars: InterventionAlertVars
): Promise<EmailResult> {
  return getEmailService().sendTemplate(to, 'intervention-alert', vars);
}
