// SUBSTRATE v1: Email Types

/**
 * Email configuration options
 */
export interface EmailConfig {
  provider: 'smtp' | 'sendgrid' | 'ses';
  from: {
    name: string;
    email: string;
  };

  // SMTP settings
  smtp?: {
    host: string;
    port: number;
    secure: boolean;
    auth: {
      user: string;
      pass: string;
    };
  };

  // SendGrid settings
  sendgrid?: {
    apiKey: string;
  };

  // AWS SES settings
  ses?: {
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
  };
}

/**
 * Email message structure
 */
export interface EmailMessage {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  replyTo?: string;
  cc?: string | string[];
  bcc?: string | string[];
  attachments?: EmailAttachment[];
}

/**
 * Email attachment
 */
export interface EmailAttachment {
  filename: string;
  content: string | Buffer;
  contentType?: string;
  encoding?: 'base64' | 'utf-8';
}

/**
 * Email send result
 */
export interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Template variables for different email types
 */
export interface WelcomeEmailVars {
  userName: string;
  planName: string;
  dashboardUrl: string;
  docsUrl: string;
}

export interface PasswordResetEmailVars {
  userName: string;
  resetUrl: string;
  expiresInMinutes: number;
}

export interface EmailVerificationVars {
  userName: string;
  verifyUrl: string;
  expiresInHours: number;
}

export interface SubscriptionEmailVars {
  userName: string;
  planName: string;
  amount: string;
  nextBillingDate?: string;
  dashboardUrl: string;
}

export interface PaymentFailedEmailVars {
  userName: string;
  amount: string;
  retryDate?: string;
  updatePaymentUrl: string;
}

export interface UsageLimitEmailVars {
  userName: string;
  limitType: string;
  currentUsage: number;
  limit: number;
  percentUsed: number;
  upgradeUrl: string;
}

export interface TeamInviteEmailVars {
  inviterName: string;
  teamName: string;
  inviteUrl: string;
  expiresInDays: number;
}

export interface WaitlistEmailVars {
  email: string;
}

export interface WaitlistUpdateEmailVars {
  email: string;
}

export interface BetaInviteEmailVars {
  email: string;
  signupUrl?: string;
}

export interface AdminNotificationVars {
  type: 'waitlist_signup' | 'new_user' | 'error';
  email?: string;
  message?: string;
  timestamp: string;
  totalWaitlistCount?: number;
}

/**
 * Email provider interface
 */
export interface EmailProvider {
  send(message: EmailMessage): Promise<EmailResult>;
}
