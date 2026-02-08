// SUBSTRATE v1: Email Service
// Main email service with provider abstraction and templates

import { getLogger } from '@substrate/observability';
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
  WelcomeEmailVars,
  PasswordResetEmailVars,
  EmailVerificationVars,
  SubscriptionEmailVars,
  PaymentFailedEmailVars,
  UsageLimitEmailVars,
  TeamInviteEmailVars,
  WaitlistEmailVars,
  WaitlistUpdateEmailVars,
  BetaInviteEmailVars,
  AdminNotificationVars,
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
 * High-level API for sending emails
 */
export class EmailService {
  private provider: EmailProvider;
  private enabled: boolean;

  constructor(config: EmailConfig | null) {
    if (!config) {
      // Use console provider in development/testing
      this.provider = new ConsoleProvider();
      this.enabled = false;
      logger.warn('Email service initialized with ConsoleProvider (emails will be logged, not sent)');
    } else {
      this.provider = createProvider(config);
      this.enabled = true;
      logger.info({ provider: config.provider }, 'Email service initialized');
    }
  }

  /**
   * Send a raw email message
   */
  async send(message: EmailMessage): Promise<EmailResult> {
    return this.provider.send(message);
  }

  /**
   * Send an email using a template
   */
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

  /**
   * Send welcome email
   */
  async sendWelcome(to: string, vars: WelcomeEmailVars): Promise<EmailResult> {
    return this.sendTemplate(to, 'welcome', vars);
  }

  /**
   * Send password reset email
   */
  async sendPasswordReset(to: string, vars: PasswordResetEmailVars): Promise<EmailResult> {
    return this.sendTemplate(to, 'password-reset', vars);
  }

  /**
   * Send email verification
   */
  async sendEmailVerification(to: string, vars: EmailVerificationVars): Promise<EmailResult> {
    return this.sendTemplate(to, 'email-verification', vars);
  }

  /**
   * Send subscription confirmation
   */
  async sendSubscriptionConfirmation(to: string, vars: SubscriptionEmailVars): Promise<EmailResult> {
    return this.sendTemplate(to, 'subscription-confirmation', vars);
  }

  /**
   * Send subscription canceled notification
   */
  async sendSubscriptionCanceled(to: string, vars: SubscriptionEmailVars): Promise<EmailResult> {
    return this.sendTemplate(to, 'subscription-canceled', vars);
  }

  /**
   * Send payment failed notification
   */
  async sendPaymentFailed(to: string, vars: PaymentFailedEmailVars): Promise<EmailResult> {
    return this.sendTemplate(to, 'payment-failed', vars);
  }

  /**
   * Send usage limit warning
   */
  async sendUsageLimitWarning(to: string, vars: UsageLimitEmailVars): Promise<EmailResult> {
    return this.sendTemplate(to, 'usage-limit-warning', vars);
  }

  /**
   * Send team invitation
   */
  async sendTeamInvite(to: string, vars: TeamInviteEmailVars): Promise<EmailResult> {
    return this.sendTemplate(to, 'team-invite', vars);
  }

  /**
   * Send waitlist confirmation
   */
  async sendWaitlist(to: string, vars: WaitlistEmailVars): Promise<EmailResult> {
    return this.sendTemplate(to, 'waitlist', vars);
  }

  /**
   * Check if email sending is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }
}

/**
 * Initialize the email service
 */
export function initializeEmail(config: EmailConfig | null): void {
  emailService = new EmailService(config);
}

/**
 * Initialize email service from environment variables
 */
export function initializeEmailFromEnv(): void {
  const provider = process.env['EMAIL_PROVIDER'] as 'smtp' | 'sendgrid' | 'ses' | undefined;

  if (!provider) {
    // No provider configured, use console
    initializeEmail(null);
    return;
  }

  const fromName = process.env['EMAIL_FROM_NAME'] ?? 'SUBSTRATE';
  const fromEmail = process.env['EMAIL_FROM_ADDRESS'] ?? 'noreply@substrate.io';

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

/**
 * Get the email service instance
 */
export function getEmailService(): EmailService {
  if (!emailService) {
    // Auto-initialize if not already done
    initializeEmailFromEnv();
  }
  return emailService!;
}

// ============================================
// Convenience Functions
// ============================================

/**
 * Send a raw email
 */
export async function sendEmail(message: EmailMessage): Promise<EmailResult> {
  return getEmailService().send(message);
}

/**
 * Send welcome email
 */
export async function sendWelcomeEmail(to: string, vars: WelcomeEmailVars): Promise<EmailResult> {
  return getEmailService().sendWelcome(to, vars);
}

/**
 * Send password reset email
 */
export async function sendPasswordResetEmail(
  to: string,
  vars: PasswordResetEmailVars
): Promise<EmailResult> {
  return getEmailService().sendPasswordReset(to, vars);
}

/**
 * Send email verification
 */
export async function sendEmailVerificationEmail(
  to: string,
  vars: EmailVerificationVars
): Promise<EmailResult> {
  return getEmailService().sendEmailVerification(to, vars);
}

/**
 * Send subscription confirmation email
 */
export async function sendSubscriptionConfirmationEmail(
  to: string,
  vars: SubscriptionEmailVars
): Promise<EmailResult> {
  return getEmailService().sendSubscriptionConfirmation(to, vars);
}

/**
 * Send subscription canceled email
 */
export async function sendSubscriptionCanceledEmail(
  to: string,
  vars: SubscriptionEmailVars
): Promise<EmailResult> {
  return getEmailService().sendSubscriptionCanceled(to, vars);
}

/**
 * Send payment failed email
 */
export async function sendPaymentFailedEmail(
  to: string,
  vars: PaymentFailedEmailVars
): Promise<EmailResult> {
  return getEmailService().sendPaymentFailed(to, vars);
}

/**
 * Send usage limit warning email
 */
export async function sendUsageLimitWarningEmail(
  to: string,
  vars: UsageLimitEmailVars
): Promise<EmailResult> {
  return getEmailService().sendUsageLimitWarning(to, vars);
}

/**
 * Send team invite email
 */
export async function sendTeamInviteEmail(
  to: string,
  vars: TeamInviteEmailVars
): Promise<EmailResult> {
  return getEmailService().sendTeamInvite(to, vars);
}

/**
 * Send waitlist confirmation email
 */
export async function sendWaitlistEmail(
  to: string,
  vars: WaitlistEmailVars
): Promise<EmailResult> {
  return getEmailService().sendWaitlist(to, vars);
}

/**
 * Send waitlist update/announcement email
 */
export async function sendWaitlistUpdateEmail(
  to: string,
  vars: WaitlistUpdateEmailVars
): Promise<EmailResult> {
  return getEmailService().sendTemplate(to, 'waitlist-update', vars);
}

/**
 * Send beta invite email to waitlist user
 */
export async function sendBetaInviteEmail(
  to: string,
  vars: BetaInviteEmailVars
): Promise<EmailResult> {
  return getEmailService().sendTemplate(to, 'beta-invite', vars);
}

/**
 * Send admin notification email
 */
export async function sendAdminNotification(
  to: string,
  vars: AdminNotificationVars
): Promise<EmailResult> {
  return getEmailService().sendTemplate(to, 'admin-notification', vars);
}
