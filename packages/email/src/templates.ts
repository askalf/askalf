// Forge: Email Templates
// HTML and text templates for transactional emails

import type {
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

/**
 * Base HTML template wrapper - Clean light theme for better email client compatibility
 */
function wrapHtml(content: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Forge</title>
  <!--[if mso]>
  <style type="text/css">
    body, table, td {font-family: Arial, sans-serif !important;}
  </style>
  <![endif]-->
</head>
<body style="margin: 0; padding: 0; background-color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f4f4f5;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width: 600px; width: 100%;">

          <!-- Header -->
          <tr>
            <td align="center" style="padding-bottom: 32px;">
              <table role="presentation" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="vertical-align: middle;">
                    <span style="display: inline-block; width: 40px; height: 40px; background-color: #10b981; border-radius: 8px; text-align: center; line-height: 40px; font-size: 22px; font-weight: 800; color: #ffffff; margin-right: 12px; vertical-align: middle;">F</span>
                    <span style="font-size: 32px; font-weight: 800; color: #10b981; letter-spacing: -0.02em; line-height: 1; vertical-align: middle;">Forge</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Main Content Card -->
          <tr>
            <td>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #ffffff; border-radius: 16px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);">
                <tr>
                  <td style="padding: 48px 40px;">
                    ${content}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top: 32px;">
              <p style="margin: 0 0 8px 0; font-size: 13px; color: #6b7280;">
                AI Agent Orchestration Platform
              </p>
              <p style="margin: 0; font-size: 13px;">
                <a href="https://integration.tax" style="color: #10b981; text-decoration: none; font-weight: 600;">integration.tax</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

/** Reusable button component */
function button(text: string, url: string): string {
  return `
    <table role="presentation" cellspacing="0" cellpadding="0" style="margin: 28px 0;">
      <tr>
        <td align="center" style="background-color: #10b981; border-radius: 8px;">
          <a href="${url}" style="display: inline-block; padding: 14px 32px; font-size: 15px; font-weight: 600; color: #ffffff; text-decoration: none;">
            ${text}
          </a>
        </td>
      </tr>
    </table>
  `;
}

/** Reusable note/callout box */
function noteBox(content: string, type: 'info' | 'warning' | 'error' = 'info'): string {
  const colors = {
    info: { bg: '#f0fdf4', border: '#10b981' },
    warning: { bg: '#fffbeb', border: '#f59e0b' },
    error: { bg: '#fef2f2', border: '#ef4444' },
  };
  const { bg, border } = colors[type];

  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin: 24px 0;">
      <tr>
        <td style="background-color: ${bg}; border-left: 4px solid ${border}; border-radius: 0 8px 8px 0; padding: 16px 20px;">
          ${content}
        </td>
      </tr>
    </table>
  `;
}

// ============================================
// Welcome Email
// ============================================

export function welcomeEmailHtml(vars: WelcomeEmailVars): string {
  return wrapHtml(`
    <h1 style="margin: 0 0 24px 0; font-size: 28px; font-weight: 700; color: #111827;">
      Welcome to Forge!    </h1>

    <p style="margin: 0 0 16px 0; font-size: 16px; color: #374151;">
      Hi ${vars.userName},
    </p>

    <p style="margin: 0 0 16px 0; font-size: 16px; color: #374151;">
      You're in. Your <strong style="color: #10b981;">${vars.planName}</strong> deployment is ready.
    </p>

    <p style="margin: 0 0 24px 0; font-size: 16px; color: #374151;">
      Forge is an AI agent orchestration platform. Create, deploy, and manage autonomous AI agents that work together — with built-in memory, monitoring, and self-healing capabilities.
    </p>

    <h2 style="margin: 32px 0 16px 0; font-size: 18px; font-weight: 600; color: #111827;">
      What You Get
    </h2>

    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 24px;">
      <tr>
        <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
          <strong style="color: #111827;">Agent Fleet Management</strong>
          <br><span style="color: #6b7280; font-size: 14px;">Create and orchestrate multiple AI agents from a single command center</span>
        </td>
      </tr>
      <tr>
        <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
          <strong style="color: #111827;">Universal Memory</strong>
          <br><span style="color: #6b7280; font-size: 14px;">Agents learn and retain knowledge across executions — episodic, semantic, and procedural</span>
        </td>
      </tr>
      <tr>
        <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
          <strong style="color: #111827;">Multi-Provider AI</strong>
          <br><span style="color: #6b7280; font-size: 14px;">Anthropic, OpenAI, Google, and more — each agent uses the right model for the job</span>
        </td>
      </tr>
      <tr>
        <td style="padding: 12px 0;">
          <strong style="color: #111827;">Production Monitoring</strong>
          <br><span style="color: #6b7280; font-size: 14px;">Real-time health checks, event logs, and auto-healing for your agent fleet</span>
        </td>
      </tr>
    </table>

    ${button('Open Command Center', vars.dashboardUrl)}
  `);
}

export function welcomeEmailText(vars: WelcomeEmailVars): string {
  return `
Welcome to Forge!
Hi ${vars.userName},

You're in. Your ${vars.planName} deployment is ready.

Forge is an AI agent orchestration platform. Create, deploy, and manage autonomous AI agents that work together — with built-in memory, monitoring, and self-healing capabilities.

WHAT YOU GET
------------
- Agent Fleet Management — Create and orchestrate multiple AI agents from a single command center
- Universal Memory — Agents learn and retain knowledge across executions
- Multi-Provider AI — Anthropic, OpenAI, Google, and more
- Production Monitoring — Real-time health checks, event logs, and auto-healing

Open Command Center: ${vars.dashboardUrl}

---
Forge — AI Agent Orchestration Platform
https://integration.tax
  `.trim();
}

// ============================================
// Password Reset Email
// ============================================

export function passwordResetEmailHtml(vars: PasswordResetEmailVars): string {
  return wrapHtml(`
    <h1 style="margin: 0 0 24px 0; font-size: 28px; font-weight: 700; color: #111827;">
      Reset Your Password
    </h1>

    <p style="margin: 0 0 16px 0; font-size: 16px; color: #374151;">
      Hi ${vars.userName},
    </p>

    <p style="margin: 0 0 24px 0; font-size: 16px; color: #374151;">
      We received a request to reset your password. Click the button below to create a new one:
    </p>

    ${button('Reset Password', vars.resetUrl)}

    ${noteBox(`
      <p style="margin: 0; font-size: 14px; color: #374151;">
        This link expires in <strong>${vars.expiresInMinutes} minutes</strong>.
      </p>
    `, 'warning')}

    <p style="margin: 24px 0 0 0; font-size: 14px; color: #6b7280;">
      If you didn't request this, you can safely ignore this email. Your password won't change.
    </p>

    <p style="margin: 24px 0 0 0; font-size: 12px; color: #9ca3af;">
      Button not working? Copy this link:<br>
      <a href="${vars.resetUrl}" style="color: #10b981; word-break: break-all;">${vars.resetUrl}</a>
    </p>
  `);
}

export function passwordResetEmailText(vars: PasswordResetEmailVars): string {
  return `
Reset Your Password

Hi ${vars.userName},

We received a request to reset your password. Click the link below to create a new one:

${vars.resetUrl}

This link expires in ${vars.expiresInMinutes} minutes.

If you didn't request this, you can safely ignore this email. Your password won't change.

---
Forge — AI Agent Orchestration Platform
https://integration.tax
  `.trim();
}

// ============================================
// Email Verification
// ============================================

export function emailVerificationHtml(vars: EmailVerificationVars): string {
  return wrapHtml(`
    <h1 style="margin: 0 0 24px 0; font-size: 28px; font-weight: 700; color: #111827;">
      Verify Your Email
    </h1>

    <p style="margin: 0 0 16px 0; font-size: 16px; color: #374151;">
      Hi ${vars.userName},
    </p>

    <p style="margin: 0 0 24px 0; font-size: 16px; color: #374151;">
      Please verify your email address to complete your Forge account setup:
    </p>

    ${button('Verify Email', vars.verifyUrl)}

    ${noteBox(`
      <p style="margin: 0; font-size: 14px; color: #374151;">
        This link expires in <strong>${vars.expiresInHours} hours</strong>.
      </p>
    `)}

    <p style="margin: 24px 0 0 0; font-size: 14px; color: #6b7280;">
      If you didn't create an Forge account, you can safely ignore this email.
    </p>

    <p style="margin: 24px 0 0 0; font-size: 12px; color: #9ca3af;">
      Button not working? Copy this link:<br>
      <a href="${vars.verifyUrl}" style="color: #10b981; word-break: break-all;">${vars.verifyUrl}</a>
    </p>
  `);
}

export function emailVerificationText(vars: EmailVerificationVars): string {
  return `
Verify Your Email

Hi ${vars.userName},

Please verify your email address to complete your Forge account setup:

${vars.verifyUrl}

This link expires in ${vars.expiresInHours} hours.

If you didn't create an Forge account, you can safely ignore this email.

---
Forge — AI Agent Orchestration Platform
https://integration.tax
  `.trim();
}

// ============================================
// Subscription Confirmation
// ============================================

export function subscriptionConfirmationHtml(vars: SubscriptionEmailVars): string {
  return wrapHtml(`
    <h1 style="margin: 0 0 24px 0; font-size: 28px; font-weight: 700; color: #111827;">
      Subscription Confirmed! 🎉
    </h1>

    <p style="margin: 0 0 16px 0; font-size: 16px; color: #374151;">
      Hi ${vars.userName},
    </p>

    <p style="margin: 0 0 24px 0; font-size: 16px; color: #374151;">
      Thank you for subscribing to Forge!
    </p>

    ${noteBox(`
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
        <tr>
          <td style="padding: 4px 0; font-size: 14px; color: #374151;">
            <strong>Plan:</strong> ${vars.planName}
          </td>
        </tr>
        <tr>
          <td style="padding: 4px 0; font-size: 14px; color: #374151;">
            <strong>Amount:</strong> ${vars.amount}
          </td>
        </tr>
        ${vars.nextBillingDate ? `
        <tr>
          <td style="padding: 4px 0; font-size: 14px; color: #374151;">
            <strong>Next billing:</strong> ${vars.nextBillingDate}
          </td>
        </tr>
        ` : ''}
      </table>
    `)}

    <p style="margin: 24px 0 0 0; font-size: 16px; color: #374151;">
      You now have access to all features in your plan. Start exploring:
    </p>

    ${button('Go to Dashboard', vars.dashboardUrl)}
  `);
}

export function subscriptionConfirmationText(vars: SubscriptionEmailVars): string {
  return `
Subscription Confirmed! 🎉

Hi ${vars.userName},

Thank you for subscribing to Forge!

Plan: ${vars.planName}
Amount: ${vars.amount}
${vars.nextBillingDate ? `Next billing: ${vars.nextBillingDate}` : ''}

You now have access to all features in your plan.

Go to Dashboard: ${vars.dashboardUrl}

---
Forge — AI Agent Orchestration Platform
https://integration.tax
  `.trim();
}

// ============================================
// Subscription Canceled
// ============================================

export function subscriptionCanceledHtml(vars: SubscriptionEmailVars): string {
  return wrapHtml(`
    <h1 style="margin: 0 0 24px 0; font-size: 28px; font-weight: 700; color: #111827;">
      Subscription Canceled
    </h1>

    <p style="margin: 0 0 16px 0; font-size: 16px; color: #374151;">
      Hi ${vars.userName},
    </p>

    <p style="margin: 0 0 24px 0; font-size: 16px; color: #374151;">
      Your ${vars.planName} subscription has been canceled.
    </p>

    ${vars.nextBillingDate ? noteBox(`
      <p style="margin: 0; font-size: 14px; color: #374151;">
        You'll continue to have access until <strong>${vars.nextBillingDate}</strong>.
      </p>
    `) : ''}

    <p style="margin: 24px 0 0 0; font-size: 16px; color: #374151;">
      Changed your mind? You can reactivate anytime:
    </p>

    ${button('Manage Subscription', `${vars.dashboardUrl}/billing`)}

    <p style="margin: 24px 0 0 0; font-size: 14px; color: #6b7280;">
      We'd love to hear your feedback — it helps us improve Forge for everyone.
    </p>
  `);
}

export function subscriptionCanceledText(vars: SubscriptionEmailVars): string {
  return `
Subscription Canceled

Hi ${vars.userName},

Your ${vars.planName} subscription has been canceled.

${vars.nextBillingDate ? `You'll continue to have access until ${vars.nextBillingDate}.` : ''}

Changed your mind? You can reactivate anytime:
${vars.dashboardUrl}/billing

We'd love to hear your feedback — it helps us improve Forge for everyone.

---
Forge — AI Agent Orchestration Platform
https://integration.tax
  `.trim();
}

// ============================================
// Payment Failed
// ============================================

export function paymentFailedHtml(vars: PaymentFailedEmailVars): string {
  return wrapHtml(`
    <h1 style="margin: 0 0 24px 0; font-size: 28px; font-weight: 700; color: #111827;">
      Payment Failed
    </h1>

    <p style="margin: 0 0 16px 0; font-size: 16px; color: #374151;">
      Hi ${vars.userName},
    </p>

    <p style="margin: 0 0 24px 0; font-size: 16px; color: #374151;">
      We couldn't process your payment of <strong>${vars.amount}</strong>.
    </p>

    ${noteBox(`
      <p style="margin: 0; font-size: 14px; color: #374151;">
        ${vars.retryDate
          ? `We'll automatically retry on <strong>${vars.retryDate}</strong>.`
          : 'Please update your payment method to avoid service interruption.'}
      </p>
    `, 'error')}

    ${button('Update Payment Method', vars.updatePaymentUrl)}

    <p style="margin: 24px 0 0 0; font-size: 14px; color: #6b7280;">
      Questions about billing? Reply to this email and we'll help.
    </p>
  `);
}

export function paymentFailedText(vars: PaymentFailedEmailVars): string {
  return `
Payment Failed

Hi ${vars.userName},

We couldn't process your payment of ${vars.amount}.

${vars.retryDate ? `We'll automatically retry on ${vars.retryDate}.` : 'Please update your payment method to avoid service interruption.'}

Update Payment Method: ${vars.updatePaymentUrl}

Questions about billing? Reply to this email and we'll help.

---
Forge — AI Agent Orchestration Platform
https://integration.tax
  `.trim();
}

// ============================================
// Usage Limit Warning
// ============================================

export function usageLimitWarningHtml(vars: UsageLimitEmailVars): string {
  const isHigh = vars.percentUsed >= 90;

  return wrapHtml(`
    <h1 style="margin: 0 0 24px 0; font-size: 28px; font-weight: 700; color: #111827;">
      Usage Limit Warning
    </h1>

    <p style="margin: 0 0 16px 0; font-size: 16px; color: #374151;">
      Hi ${vars.userName},
    </p>

    <p style="margin: 0 0 24px 0; font-size: 16px; color: #374151;">
      You're approaching your ${vars.limitType} limit.
    </p>

    ${noteBox(`
      <p style="margin: 0; font-size: 14px; color: #374151;">
        <strong>Current usage:</strong> ${vars.currentUsage.toLocaleString()} / ${vars.limit.toLocaleString()} (${vars.percentUsed}%)
      </p>
    `, isHigh ? 'error' : 'warning')}

    <p style="margin: 24px 0 0 0; font-size: 16px; color: #374151;">
      Once you hit the limit, ${vars.limitType.toLowerCase()} will pause until the next billing period. Upgrade to continue uninterrupted:
    </p>

    ${button('Upgrade Plan', vars.upgradeUrl)}
  `);
}

export function usageLimitWarningText(vars: UsageLimitEmailVars): string {
  return `
Usage Limit Warning

Hi ${vars.userName},

You're approaching your ${vars.limitType} limit.

Current usage: ${vars.currentUsage.toLocaleString()} / ${vars.limit.toLocaleString()} (${vars.percentUsed}%)

Once you hit the limit, ${vars.limitType.toLowerCase()} will pause until the next billing period.

Upgrade Plan: ${vars.upgradeUrl}

---
Forge — AI Agent Orchestration Platform
https://integration.tax
  `.trim();
}

// ============================================
// Team Invitation
// ============================================

export function teamInviteHtml(vars: TeamInviteEmailVars): string {
  return wrapHtml(`
    <h1 style="margin: 0 0 24px 0; font-size: 28px; font-weight: 700; color: #111827;">
      You're Invited!    </h1>

    <p style="margin: 0 0 16px 0; font-size: 16px; color: #374151;">
      <strong>${vars.inviterName}</strong> invited you to join <strong>${vars.teamName}</strong> on Forge.
    </p>

    <p style="margin: 0 0 24px 0; font-size: 16px; color: #374151;">
      Forge is an AI agent orchestration platform for teams.
    </p>

    ${button('Accept Invitation', vars.inviteUrl)}

    ${noteBox(`
      <p style="margin: 0; font-size: 14px; color: #374151;">
        This invitation expires in <strong>${vars.expiresInDays} days</strong>.
      </p>
    `)}

    <p style="margin: 24px 0 0 0; font-size: 14px; color: #6b7280;">
      Don't want to join? Just ignore this email.
    </p>
  `);
}

export function teamInviteText(vars: TeamInviteEmailVars): string {
  return `
You're Invited!
${vars.inviterName} invited you to join ${vars.teamName} on Forge.

Forge is an AI agent orchestration platform for teams.

Accept Invitation: ${vars.inviteUrl}

This invitation expires in ${vars.expiresInDays} days.

Don't want to join? Just ignore this email.

---
Forge — AI Agent Orchestration Platform
https://integration.tax
  `.trim();
}

// ============================================
// Waitlist Email
// ============================================

export function waitlistEmailHtml(vars: WaitlistEmailVars): string {
  return wrapHtml(`
    <h1 style="margin: 0 0 24px 0; font-size: 28px; font-weight: 700; color: #111827;">
      You're on the List!    </h1>

    <p style="margin: 0 0 24px 0; font-size: 16px; color: #374151;">
      Thanks for joining the Forge waitlist. We're building the next generation of AI agent orchestration.
    </p>

    <h2 style="margin: 32px 0 16px 0; font-size: 18px; font-weight: 600; color: #111827;">
      What's Coming
    </h2>

    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 24px;">
      <tr>
        <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
          <strong style="color: #111827;">Agent Orchestration</strong>
          <br><span style="color: #6b7280; font-size: 14px;">Create, deploy, and manage autonomous AI agents that work together</span>
        </td>
      </tr>
      <tr>
        <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
          <strong style="color: #111827;">Universal Memory</strong>
          <br><span style="color: #6b7280; font-size: 14px;">Agents learn and retain knowledge across executions</span>
        </td>
      </tr>
      <tr>
        <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
          <strong style="color: #111827;">Multi-Provider AI</strong>
          <br><span style="color: #6b7280; font-size: 14px;">Anthropic, OpenAI, Google — each agent uses the right model</span>
        </td>
      </tr>
      <tr>
        <td style="padding: 12px 0;">
          <strong style="color: #111827;">Production Ready</strong>
          <br><span style="color: #6b7280; font-size: 14px;">Health monitoring, auto-healing, and event logging built in</span>
        </td>
      </tr>
    </table>

    ${noteBox(`
      <p style="margin: 0; font-size: 14px; color: #374151;">
        We'll keep you updated at <strong>${vars.email}</strong>
      </p>
    `)}

    ${button('Explore Forge', 'https://integration.tax')}
  `);
}

export function waitlistEmailText(vars: WaitlistEmailVars): string {
  return `
You're on the List!
Thanks for joining the Forge waitlist. We're building the next generation of AI agent orchestration.

WHAT'S COMING
-------------
- Agent Orchestration - Create, deploy, and manage autonomous AI agents
- Universal Memory - Agents learn and retain knowledge across executions
- Multi-Provider AI - Anthropic, OpenAI, Google — each agent uses the right model
- Production Ready - Health monitoring, auto-healing, and event logging built in

We'll keep you updated at ${vars.email}

Explore Forge: https://integration.tax

---
Forge — AI Agent Orchestration Platform
https://integration.tax
  `.trim();
}

// ============================================
// Waitlist Update Email (Announcement to existing waitlist)
// ============================================

export function waitlistUpdateEmailHtml(vars: WaitlistUpdateEmailVars): string {
  return wrapHtml(`
    <h1 style="margin: 0 0 24px 0; font-size: 28px; font-weight: 700; color: #111827;">
      Forge is Live!    </h1>

    <p style="margin: 0 0 16px 0; font-size: 16px; color: #374151;">
      You signed up for the Forge waitlist, and we wanted to be the first to tell you:
    </p>

    <p style="margin: 0 0 24px 0; font-size: 20px; font-weight: 600; color: #10b981;">
      The new Forge is ready for you to explore.
    </p>

    <h2 style="margin: 32px 0 16px 0; font-size: 18px; font-weight: 600; color: #111827;">
      What's New
    </h2>

    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 24px;">
      <tr>
        <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
          <strong style="color: #111827;">Agent Fleet Management</strong>
          <br><span style="color: #6b7280; font-size: 14px;">Create and orchestrate AI agents from a single command center</span>
        </td>
      </tr>
      <tr>
        <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
          <strong style="color: #111827;">Universal Memory</strong>
          <br><span style="color: #6b7280; font-size: 14px;">Agents learn and retain knowledge across executions</span>
        </td>
      </tr>
      <tr>
        <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
          <strong style="color: #111827;">Multi-Provider AI</strong>
          <br><span style="color: #6b7280; font-size: 14px;">Anthropic, OpenAI, Google, xAI - all in one place</span>
        </td>
      </tr>
      <tr>
        <td style="padding: 12px 0;">
          <strong style="color: #111827;">Production Monitoring</strong>
          <br><span style="color: #6b7280; font-size: 14px;">Health checks, event logs, and auto-healing built in</span>
        </td>
      </tr>
    </table>

    ${button('Try Forge Now', 'https://integration.tax')}

    ${noteBox(`
      <p style="margin: 0; font-size: 14px; color: #374151;">
        <strong>Free tier available</strong> — get started with no credit card required.
      </p>
    `)}

    <p style="margin: 24px 0 0 0; font-size: 14px; color: #6b7280;">
      Thanks for being an early supporter. We built this for people like you.
    </p>
  `);
}

export function waitlistUpdateEmailText(vars: WaitlistUpdateEmailVars): string {
  return `
Forge is Live!
You signed up for the Forge waitlist, and we wanted to be the first to tell you:

The new Forge is ready for you to explore.

WHAT'S NEW
----------
- Agent Fleet Management - Create and orchestrate AI agents from a single command center
- Universal Memory - Agents learn and retain knowledge across executions
- Multi-Provider AI - Anthropic, OpenAI, Google, xAI - all in one place
- Production Monitoring - Health checks, event logs, and auto-healing built in

Try Forge Now: https://integration.tax

Free tier available — get started with no credit card required.

Thanks for being an early supporter. We built this for people like you.

---
Forge — AI Agent Orchestration Platform
https://integration.tax
  `.trim();
}

// ============================================
// Beta Invite Email
// ============================================

export function betaInviteEmailHtml(vars: BetaInviteEmailVars): string {
  const signupUrl = vars.signupUrl || 'https://integration.tax/signup';
  return wrapHtml(`
    <h1 style="margin: 0 0 24px 0; font-size: 28px; font-weight: 700; color: #111827;">
      You're Invited to the Beta!    </h1>

    <p style="margin: 0 0 16px 0; font-size: 16px; line-height: 1.6; color: #374151;">
      Great news — you've been selected from the waitlist to join the Forge beta.
    </p>

    <p style="margin: 0 0 24px 0; font-size: 16px; line-height: 1.6; color: #374151;">
      Your account is ready to create. Click the button below to get started:
    </p>

    <div style="text-align: center; margin: 32px 0;">
      <a href="${signupUrl}" style="display: inline-block; padding: 14px 32px; background: #10b981; color: #ffffff; font-size: 16px; font-weight: 600; text-decoration: none; border-radius: 8px;">
        Join the Beta
      </a>
    </div>

    <h2 style="margin: 32px 0 16px 0; font-size: 20px; font-weight: 600; color: #111827;">
      What You Get
    </h2>

    <ul style="margin: 0 0 24px 0; padding-left: 20px; font-size: 15px; line-height: 1.8; color: #374151;">
      <li><strong>Agent Fleet Management</strong> — Create and orchestrate AI agents from one command center</li>
      <li><strong>Universal Memory</strong> — Agents learn and retain knowledge across executions</li>
      <li><strong>Multi-Provider AI</strong> — Anthropic, OpenAI, Google — the right model for each job</li>
      <li><strong>Production Monitoring</strong> — Health checks, event logs, and auto-healing</li>
    </ul>

    <p style="margin: 0 0 16px 0; font-size: 16px; line-height: 1.6; color: #374151;">
      As a beta tester, your feedback directly shapes what we build. We'd love to hear from you.
    </p>

    <p style="margin: 0; font-size: 14px; line-height: 1.6; color: #6b7280;">
      This invite is for <strong>${vars.email}</strong>. If you didn't sign up for Forge, you can ignore this email.
    </p>
  `);
}

export function betaInviteEmailText(vars: BetaInviteEmailVars): string {
  const signupUrl = vars.signupUrl || 'https://integration.tax/signup';
  return `
You're Invited to the Beta!
Great news — you've been selected from the waitlist to join the Forge beta.

Your account is ready to create. Visit the link below to get started:

${signupUrl}

WHAT YOU GET
------------
- Agent Fleet Management — Create and orchestrate AI agents from one command center
- Universal Memory — Agents learn and retain knowledge across executions
- Multi-Provider AI — Anthropic, OpenAI, Google — the right model for each job
- Production Monitoring — Health checks, event logs, and auto-healing

As a beta tester, your feedback directly shapes what we build. We'd love to hear from you.

This invite is for ${vars.email}. If you didn't sign up for Forge, you can ignore this email.

---
Forge — AI Agent Orchestration Platform
https://integration.tax
  `.trim();
}

// ============================================
// Admin Notification Email
// ============================================

export function adminNotificationHtml(vars: AdminNotificationVars): string {
  let content = '';

  switch (vars.type) {
    case 'waitlist_signup':
      content = `
        <h1 style="margin: 0 0 24px 0; font-size: 28px; font-weight: 700; color: #111827;">
          New Waitlist Signup        </h1>

        <p style="margin: 0 0 24px 0; font-size: 16px; color: #374151;">
          Someone new joined the Forge waitlist.
        </p>

        ${noteBox(`
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
            <tr>
              <td style="padding: 4px 0; font-size: 14px; color: #374151;">
                <strong>Email:</strong> ${vars.email}
              </td>
            </tr>
            <tr>
              <td style="padding: 4px 0; font-size: 14px; color: #374151;">
                <strong>Time:</strong> ${vars.timestamp}
              </td>
            </tr>
            ${vars.totalWaitlistCount ? `
            <tr>
              <td style="padding: 4px 0; font-size: 14px; color: #374151;">
                <strong>Total signups:</strong> ${vars.totalWaitlistCount}
              </td>
            </tr>
            ` : ''}
          </table>
        `)}

        ${button('View Dashboard', 'https://integration.tax')}
      `;
      break;

    case 'new_user':
      content = `
        <h1 style="margin: 0 0 24px 0; font-size: 28px; font-weight: 700; color: #111827;">
          New User Registration 🎉
        </h1>

        <p style="margin: 0 0 24px 0; font-size: 16px; color: #374151;">
          A new user registered for Forge.
        </p>

        ${noteBox(`
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
            <tr>
              <td style="padding: 4px 0; font-size: 14px; color: #374151;">
                <strong>Email:</strong> ${vars.email}
              </td>
            </tr>
            <tr>
              <td style="padding: 4px 0; font-size: 14px; color: #374151;">
                <strong>Time:</strong> ${vars.timestamp}
              </td>
            </tr>
          </table>
        `)}
      `;
      break;

    case 'error':
      content = `
        <h1 style="margin: 0 0 24px 0; font-size: 28px; font-weight: 700; color: #111827;">
          System Alert ⚠️
        </h1>

        <p style="margin: 0 0 24px 0; font-size: 16px; color: #374151;">
          An error occurred in the Forge system.
        </p>

        ${noteBox(`
          <p style="margin: 0 0 8px 0; font-size: 14px; color: #374151;">${vars.message}</p>
          <p style="margin: 0; font-size: 14px; color: #374151;"><strong>Time:</strong> ${vars.timestamp}</p>
        `, 'error')}
      `;
      break;
  }

  return wrapHtml(content);
}

export function adminNotificationText(vars: AdminNotificationVars): string {
  switch (vars.type) {
    case 'waitlist_signup':
      return `
New Waitlist Signup
A new developer joined the waitlist.

Email: ${vars.email}
Time: ${vars.timestamp}
${vars.totalWaitlistCount ? `Total signups: ${vars.totalWaitlistCount}` : ''}

View Dashboard: https://integration.tax

---
Forge Admin Notification
      `.trim();

    case 'new_user':
      return `
New User Registration 🎉

A new user registered for Forge.

Email: ${vars.email}
Time: ${vars.timestamp}

---
Forge Admin Notification
      `.trim();

    case 'error':
      return `
System Alert ⚠️

An error occurred in the Forge system.

${vars.message}
Time: ${vars.timestamp}

---
Forge Admin Notification
      `.trim();

    default:
      return 'Admin notification';
  }
}

// ============================================
// Template Factory
// ============================================

export type EmailTemplate =
  | 'welcome'
  | 'password-reset'
  | 'email-verification'
  | 'subscription-confirmation'
  | 'subscription-canceled'
  | 'payment-failed'
  | 'usage-limit-warning'
  | 'team-invite'
  | 'waitlist'
  | 'waitlist-update'
  | 'beta-invite'
  | 'admin-notification';

export type EmailTemplateVars =
  | WelcomeEmailVars
  | PasswordResetEmailVars
  | EmailVerificationVars
  | SubscriptionEmailVars
  | PaymentFailedEmailVars
  | UsageLimitEmailVars
  | TeamInviteEmailVars
  | WaitlistEmailVars
  | WaitlistUpdateEmailVars
  | BetaInviteEmailVars
  | AdminNotificationVars;

interface TemplateResult {
  subject: string;
  html: string;
  text: string;
}

/**
 * Get rendered template by name
 */
export function getTemplate(template: EmailTemplate, vars: EmailTemplateVars): TemplateResult {
  switch (template) {
    case 'welcome':
      return {
        subject: 'Welcome to Forge!',
        html: welcomeEmailHtml(vars as WelcomeEmailVars),
        text: welcomeEmailText(vars as WelcomeEmailVars),
      };

    case 'password-reset':
      return {
        subject: 'Reset Your Password - Forge',
        html: passwordResetEmailHtml(vars as PasswordResetEmailVars),
        text: passwordResetEmailText(vars as PasswordResetEmailVars),
      };

    case 'email-verification':
      return {
        subject: 'Verify Your Email - Forge',
        html: emailVerificationHtml(vars as EmailVerificationVars),
        text: emailVerificationText(vars as EmailVerificationVars),
      };

    case 'subscription-confirmation':
      return {
        subject: 'Subscription Confirmed - Forge 🎉',
        html: subscriptionConfirmationHtml(vars as SubscriptionEmailVars),
        text: subscriptionConfirmationText(vars as SubscriptionEmailVars),
      };

    case 'subscription-canceled':
      return {
        subject: 'Subscription Canceled - Forge',
        html: subscriptionCanceledHtml(vars as SubscriptionEmailVars),
        text: subscriptionCanceledText(vars as SubscriptionEmailVars),
      };

    case 'payment-failed':
      return {
        subject: 'Action Required: Payment Failed - Forge',
        html: paymentFailedHtml(vars as PaymentFailedEmailVars),
        text: paymentFailedText(vars as PaymentFailedEmailVars),
      };

    case 'usage-limit-warning':
      return {
        subject: 'Usage Limit Warning - Forge',
        html: usageLimitWarningHtml(vars as UsageLimitEmailVars),
        text: usageLimitWarningText(vars as UsageLimitEmailVars),
      };

    case 'team-invite':
      return {
        subject: `You're invited to join ${(vars as TeamInviteEmailVars).teamName} on Forge`,
        html: teamInviteHtml(vars as TeamInviteEmailVars),
        text: teamInviteText(vars as TeamInviteEmailVars),
      };

    case 'waitlist':
      return {
        subject: `You're on the Forge Waitlist!`,
        html: waitlistEmailHtml(vars as WaitlistEmailVars),
        text: waitlistEmailText(vars as WaitlistEmailVars),
      };

    case 'waitlist-update':
      return {
        subject: `Forge is Live!`,
        html: waitlistUpdateEmailHtml(vars as WaitlistUpdateEmailVars),
        text: waitlistUpdateEmailText(vars as WaitlistUpdateEmailVars),
      };

    case 'beta-invite':
      return {
        subject: `You're Invited to the Forge Beta!`,
        html: betaInviteEmailHtml(vars as BetaInviteEmailVars),
        text: betaInviteEmailText(vars as BetaInviteEmailVars),
      };

    case 'admin-notification': {
      const adminVars = vars as AdminNotificationVars;
      let subject = 'Forge Admin Alert';
      if (adminVars.type === 'waitlist_signup') {
        subject = `New Waitlist Signup: ${adminVars.email}`;
      } else if (adminVars.type === 'new_user') {
        subject = `New User Registration: ${adminVars.email} 🎉`;
      } else if (adminVars.type === 'error') {
        subject = '⚠️ Forge System Alert';
      }
      return {
        subject,
        html: adminNotificationHtml(adminVars),
        text: adminNotificationText(adminVars),
      };
    }

    default:
      throw new Error(`Unknown email template: ${template}`);
  }
}
