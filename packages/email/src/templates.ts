// Ask ALF: Email Templates
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
  <title>Ask ALF</title>
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
                  <td style="font-size: 48px; line-height: 1; padding-right: 12px; vertical-align: middle;">👽</td>
                  <td style="vertical-align: middle;">
                    <span style="display: block; font-size: 11px; font-weight: 600; color: #6b7280; letter-spacing: 0.1em; text-transform: uppercase;">ASK</span>
                    <span style="display: block; font-size: 32px; font-weight: 800; color: #10b981; letter-spacing: -0.02em; line-height: 1;">ALF</span>
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
                Not a chatbot. Not a wrapper. A living intelligence.
              </p>
              <p style="margin: 0; font-size: 13px;">
                <a href="https://askalf.org" style="color: #10b981; text-decoration: none; font-weight: 600;">askalf.org</a>
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
      Welcome to Ask ALF! 👽
    </h1>

    <p style="margin: 0 0 16px 0; font-size: 16px; color: #374151;">
      Hi ${vars.userName},
    </p>

    <p style="margin: 0 0 16px 0; font-size: 16px; color: #374151;">
      You're in. Your <strong style="color: #10b981;">${vars.planName}</strong> account is ready.
    </p>

    <p style="margin: 0 0 24px 0; font-size: 16px; color: #374151;">
      Ask ALF is an AI assistant with memory. It gives you access to models from OpenAI and Anthropic through a single interface — with Google, xAI, DeepSeek, Llama, and more coming soon. But here's what makes it different: ALF learns from every conversation and builds <strong>knowledge shards</strong> — reusable answers that are served instantly at zero cost. The more people use it, the smarter and cheaper it gets for everyone.
    </p>

    <h2 style="margin: 32px 0 16px 0; font-size: 18px; font-weight: 600; color: #111827;">
      What You Get
    </h2>

    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 24px;">
      <tr>
        <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
          <strong style="color: #111827;">OpenAI + Anthropic Models</strong>
          <br><span style="color: #6b7280; font-size: 14px;">GPT-5.2, o3, Claude Opus 4.5, Claude Sonnet 4.5 — with Google, Grok, DeepSeek, and more coming soon</span>
        </td>
      </tr>
      <tr>
        <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
          <strong style="color: #111827;">500+ Knowledge Shards</strong>
          <br><span style="color: #6b7280; font-size: 14px;">Instant answers from ALF's shared memory — always free, always fast</span>
        </td>
      </tr>
      <tr>
        <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
          <strong style="color: #111827;">50 Credits / Day</strong>
          <br><span style="color: #6b7280; font-size: 14px;">Use any model — fast models cost 1 credit, standard 2, reasoning 10</span>
        </td>
      </tr>
      <tr>
        <td style="padding: 12px 0;">
          <strong style="color: #111827;">Smart Routing</strong>
          <br><span style="color: #6b7280; font-size: 14px;">ALF picks the right model for each question — or choose your own</span>
        </td>
      </tr>
    </table>

    ${button('Start Chatting', vars.dashboardUrl)}

    ${noteBox(`
      <p style="margin: 0; font-size: 14px; color: #374151;">
        <strong>Shard hits are always free.</strong> When ALF already knows the answer, you pay nothing. The more you use it, the more free answers you unlock.
      </p>
    `)}
  `);
}

export function welcomeEmailText(vars: WelcomeEmailVars): string {
  return `
Welcome to Ask ALF! 👽

Hi ${vars.userName},

You're in. Your ${vars.planName} account is ready.

Ask ALF is an AI assistant with memory. It gives you access to models from OpenAI and Anthropic through a single interface — with Google, xAI, DeepSeek, Llama, and more coming soon. ALF learns from every conversation and builds knowledge shards — reusable answers served instantly at zero cost. The more people use it, the smarter and cheaper it gets for everyone.

WHAT YOU GET
------------
- OpenAI + Anthropic Models — GPT-5.2, o3, Claude Opus 4.5, Claude Sonnet 4.5, and more coming soon
- 500+ Knowledge Shards — Instant answers from ALF's shared memory, always free
- 50 Credits / Day — Fast models cost 1 credit, standard 2, reasoning 10
- Smart Routing — ALF picks the right model for each question

Shard hits are always free. When ALF already knows the answer, you pay nothing.

Start Chatting: ${vars.dashboardUrl}

---
Ask ALF — Not a chatbot. Not a wrapper. A living intelligence.
https://askalf.org
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
Ask ALF — Not a chatbot. Not a wrapper. A living intelligence.
https://askalf.org
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
      Please verify your email address to complete your Ask ALF account setup:
    </p>

    ${button('Verify Email', vars.verifyUrl)}

    ${noteBox(`
      <p style="margin: 0; font-size: 14px; color: #374151;">
        This link expires in <strong>${vars.expiresInHours} hours</strong>.
      </p>
    `)}

    <p style="margin: 24px 0 0 0; font-size: 14px; color: #6b7280;">
      If you didn't create an Ask ALF account, you can safely ignore this email.
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

Please verify your email address to complete your Ask ALF account setup:

${vars.verifyUrl}

This link expires in ${vars.expiresInHours} hours.

If you didn't create an Ask ALF account, you can safely ignore this email.

---
Ask ALF — Not a chatbot. Not a wrapper. A living intelligence.
https://askalf.org
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
      Thank you for subscribing to Ask ALF!
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

Thank you for subscribing to Ask ALF!

Plan: ${vars.planName}
Amount: ${vars.amount}
${vars.nextBillingDate ? `Next billing: ${vars.nextBillingDate}` : ''}

You now have access to all features in your plan.

Go to Dashboard: ${vars.dashboardUrl}

---
Ask ALF — Not a chatbot. Not a wrapper. A living intelligence.
https://askalf.org
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
      We'd love to hear your feedback — it helps us improve Ask ALF for everyone.
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

We'd love to hear your feedback — it helps us improve Ask ALF for everyone.

---
Ask ALF — Not a chatbot. Not a wrapper. A living intelligence.
https://askalf.org
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
Ask ALF — Not a chatbot. Not a wrapper. A living intelligence.
https://askalf.org
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
Ask ALF — Not a chatbot. Not a wrapper. A living intelligence.
https://askalf.org
  `.trim();
}

// ============================================
// Team Invitation
// ============================================

export function teamInviteHtml(vars: TeamInviteEmailVars): string {
  return wrapHtml(`
    <h1 style="margin: 0 0 24px 0; font-size: 28px; font-weight: 700; color: #111827;">
      You're Invited! 👽
    </h1>

    <p style="margin: 0 0 16px 0; font-size: 16px; color: #374151;">
      <strong>${vars.inviterName}</strong> invited you to join <strong>${vars.teamName}</strong> on Ask ALF.
    </p>

    <p style="margin: 0 0 24px 0; font-size: 16px; color: #374151;">
      Ask ALF is a smarter AI assistant that helps teams save tokens and time.
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
You're Invited! 👽

${vars.inviterName} invited you to join ${vars.teamName} on Ask ALF.

Ask ALF is a smarter AI assistant that helps teams save tokens and time.

Accept Invitation: ${vars.inviteUrl}

This invitation expires in ${vars.expiresInDays} days.

Don't want to join? Just ignore this email.

---
Ask ALF — Not a chatbot. Not a wrapper. A living intelligence.
https://askalf.org
  `.trim();
}

// ============================================
// Waitlist Email
// ============================================

export function waitlistEmailHtml(vars: WaitlistEmailVars): string {
  return wrapHtml(`
    <h1 style="margin: 0 0 24px 0; font-size: 28px; font-weight: 700; color: #111827;">
      You're on the List! 👽
    </h1>

    <p style="margin: 0 0 24px 0; font-size: 16px; color: #374151;">
      Thanks for joining the Ask ALF waitlist. We're building the most universal AI platform on the planet — one account that works everywhere.
    </p>

    <h2 style="margin: 32px 0 16px 0; font-size: 18px; font-weight: 600; color: #111827;">
      What's Coming
    </h2>

    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 24px;">
      <tr>
        <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
          <strong style="color: #111827;">Every AI, One Interface</strong>
          <br><span style="color: #6b7280; font-size: 14px;">OpenAI, Anthropic, Google, Grok — all accessible through Ask ALF</span>
        </td>
      </tr>
      <tr>
        <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
          <strong style="color: #111827;">Works Everywhere</strong>
          <br><span style="color: #6b7280; font-size: 14px;">Desktop app, browser extensions, mobile apps, tablets — your AI follows you</span>
        </td>
      </tr>
      <tr>
        <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
          <strong style="color: #111827;">For Developers Too</strong>
          <br><span style="color: #6b7280; font-size: 14px;">SDK, MCP integration, CLI tools, APIs — build with Ask ALF</span>
        </td>
      </tr>
      <tr>
        <td style="padding: 12px 0;">
          <strong style="color: #111827;">Launching February 1st</strong>
          <br><span style="color: #6b7280; font-size: 14px;">We'll send you updates as we build out the full ecosystem</span>
        </td>
      </tr>
    </table>

    ${noteBox(`
      <p style="margin: 0; font-size: 14px; color: #374151;">
        We'll keep you updated at <strong>${vars.email}</strong>
      </p>
    `)}

    ${button('Explore Ask ALF', 'https://askalf.org')}
  `);
}

export function waitlistEmailText(vars: WaitlistEmailVars): string {
  return `
You're on the List! 👽

Thanks for joining the Ask ALF waitlist. We're building the most universal AI platform on the planet — one account that works everywhere.

WHAT'S COMING
-------------
• Every AI, One Interface - OpenAI, Anthropic, Google, Grok — all accessible through Ask ALF
• Works Everywhere - Desktop app, browser extensions, mobile apps, tablets — your AI follows you
• For Developers Too - SDK, MCP integration, CLI tools, APIs — build with Ask ALF
• Launching February 1st - We'll send you updates as we build out the full ecosystem

We'll keep you updated at ${vars.email}

Explore Ask ALF: https://askalf.org

---
Ask ALF — Not a chatbot. Not a wrapper. A living intelligence.
https://askalf.org
  `.trim();
}

// ============================================
// Waitlist Update Email (Announcement to existing waitlist)
// ============================================

export function waitlistUpdateEmailHtml(vars: WaitlistUpdateEmailVars): string {
  return wrapHtml(`
    <h1 style="margin: 0 0 24px 0; font-size: 28px; font-weight: 700; color: #111827;">
      Ask ALF is Live! 👽
    </h1>

    <p style="margin: 0 0 16px 0; font-size: 16px; color: #374151;">
      You signed up for the Ask ALF waitlist, and we wanted to be the first to tell you:
    </p>

    <p style="margin: 0 0 24px 0; font-size: 20px; font-weight: 600; color: #10b981;">
      The new Ask ALF is ready for you to explore.
    </p>

    <h2 style="margin: 32px 0 16px 0; font-size: 18px; font-weight: 600; color: #111827;">
      What's New
    </h2>

    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 24px;">
      <tr>
        <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
          <strong style="color: #111827;">Chat-First Experience</strong>
          <br><span style="color: #6b7280; font-size: 14px;">Jump straight into conversation - no barriers, no setup</span>
        </td>
      </tr>
      <tr>
        <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
          <strong style="color: #111827;">Memory Shards</strong>
          <br><span style="color: #6b7280; font-size: 14px;">ALF learns and remembers - instant answers at zero cost</span>
        </td>
      </tr>
      <tr>
        <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
          <strong style="color: #111827;">Every Major AI Model</strong>
          <br><span style="color: #6b7280; font-size: 14px;">OpenAI, Anthropic, Google, xAI - all in one place</span>
        </td>
      </tr>
      <tr>
        <td style="padding: 12px 0;">
          <strong style="color: #111827;">Bring Your Own Keys</strong>
          <br><span style="color: #6b7280; font-size: 14px;">Use your API keys with zero markup - or use our credits</span>
        </td>
      </tr>
    </table>

    ${button('Try Ask ALF Now', 'https://askalf.org')}

    ${noteBox(`
      <p style="margin: 0; font-size: 14px; color: #374151;">
        <strong>Free tier available</strong> - 50 credits daily, all models, no credit card required.
      </p>
    `)}

    <p style="margin: 24px 0 0 0; font-size: 14px; color: #6b7280;">
      Thanks for being an early supporter. We built this for people like you.
    </p>
  `);
}

export function waitlistUpdateEmailText(vars: WaitlistUpdateEmailVars): string {
  return `
Ask ALF is Live! 👽

You signed up for the Ask ALF waitlist, and we wanted to be the first to tell you:

The new Ask ALF is ready for you to explore.

WHAT'S NEW
----------
- Chat-First Experience - Jump straight into conversation - no barriers, no setup
- Memory Shards - ALF learns and remembers - instant answers at zero cost
- Every Major AI Model - OpenAI, Anthropic, Google, xAI - all in one place
- Bring Your Own Keys - Use your API keys with zero markup - or use our credits

Try Ask ALF Now: https://askalf.org

Free tier available - 50 credits daily, all models, no credit card required.

Thanks for being an early supporter. We built this for people like you.

---
Ask ALF — Not a chatbot. Not a wrapper. A living intelligence.
https://askalf.org
  `.trim();
}

// ============================================
// Beta Invite Email
// ============================================

export function betaInviteEmailHtml(vars: BetaInviteEmailVars): string {
  const signupUrl = vars.signupUrl || 'https://askalf.org/signup';
  return wrapHtml(`
    <h1 style="margin: 0 0 24px 0; font-size: 28px; font-weight: 700; color: #111827;">
      You're Invited to the Beta! 👽
    </h1>

    <p style="margin: 0 0 16px 0; font-size: 16px; line-height: 1.6; color: #374151;">
      Great news — you've been selected from the waitlist to join the Ask ALF beta.
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
      <li><strong>Every Major AI Model</strong> — OpenAI, Anthropic, and more in one place</li>
      <li><strong>Knowledge Shards</strong> — ALF learns and remembers, giving you instant answers</li>
      <li><strong>Smart Router</strong> — Automatically picks the best model for each question</li>
      <li><strong>Bring Your Own Keys</strong> — Use your API keys with zero markup</li>
    </ul>

    <p style="margin: 0 0 16px 0; font-size: 16px; line-height: 1.6; color: #374151;">
      As a beta tester, your feedback directly shapes what we build. We'd love to hear from you.
    </p>

    <p style="margin: 0; font-size: 14px; line-height: 1.6; color: #6b7280;">
      This invite is for <strong>${vars.email}</strong>. If you didn't sign up for Ask ALF, you can ignore this email.
    </p>
  `);
}

export function betaInviteEmailText(vars: BetaInviteEmailVars): string {
  const signupUrl = vars.signupUrl || 'https://askalf.org/signup';
  return `
You're Invited to the Beta! 👽

Great news — you've been selected from the waitlist to join the Ask ALF beta.

Your account is ready to create. Visit the link below to get started:

${signupUrl}

WHAT YOU GET
------------
- Every Major AI Model — OpenAI, Anthropic, and more in one place
- Knowledge Shards — ALF learns and remembers, giving you instant answers
- Smart Router — Automatically picks the best model for each question
- Bring Your Own Keys — Use your API keys with zero markup

As a beta tester, your feedback directly shapes what we build. We'd love to hear from you.

This invite is for ${vars.email}. If you didn't sign up for Ask ALF, you can ignore this email.

---
Ask ALF — Not a chatbot. Not a wrapper. A living intelligence.
https://askalf.org
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
          New Waitlist Signup 👽
        </h1>

        <p style="margin: 0 0 24px 0; font-size: 16px; color: #374151;">
          Someone new joined the Ask ALF waitlist.
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

        ${button('View Dashboard', 'https://app.askalf.org')}
      `;
      break;

    case 'new_user':
      content = `
        <h1 style="margin: 0 0 24px 0; font-size: 28px; font-weight: 700; color: #111827;">
          New User Registration 🎉
        </h1>

        <p style="margin: 0 0 24px 0; font-size: 16px; color: #374151;">
          A new user registered for Ask ALF.
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
          An error occurred in the Ask ALF system.
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
New Waitlist Signup 👽

A new developer joined the waitlist.

Email: ${vars.email}
Time: ${vars.timestamp}
${vars.totalWaitlistCount ? `Total signups: ${vars.totalWaitlistCount}` : ''}

View Dashboard: https://app.askalf.org

---
Ask ALF Admin Notification
      `.trim();

    case 'new_user':
      return `
New User Registration 🎉

A new user registered for Ask ALF.

Email: ${vars.email}
Time: ${vars.timestamp}

---
Ask ALF Admin Notification
      `.trim();

    case 'error':
      return `
System Alert ⚠️

An error occurred in the Ask ALF system.

${vars.message}
Time: ${vars.timestamp}

---
Ask ALF Admin Notification
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
        subject: 'Welcome to Ask ALF! 👽',
        html: welcomeEmailHtml(vars as WelcomeEmailVars),
        text: welcomeEmailText(vars as WelcomeEmailVars),
      };

    case 'password-reset':
      return {
        subject: 'Reset Your Password - Ask ALF',
        html: passwordResetEmailHtml(vars as PasswordResetEmailVars),
        text: passwordResetEmailText(vars as PasswordResetEmailVars),
      };

    case 'email-verification':
      return {
        subject: 'Verify Your Email - Ask ALF',
        html: emailVerificationHtml(vars as EmailVerificationVars),
        text: emailVerificationText(vars as EmailVerificationVars),
      };

    case 'subscription-confirmation':
      return {
        subject: 'Subscription Confirmed - Ask ALF 🎉',
        html: subscriptionConfirmationHtml(vars as SubscriptionEmailVars),
        text: subscriptionConfirmationText(vars as SubscriptionEmailVars),
      };

    case 'subscription-canceled':
      return {
        subject: 'Subscription Canceled - Ask ALF',
        html: subscriptionCanceledHtml(vars as SubscriptionEmailVars),
        text: subscriptionCanceledText(vars as SubscriptionEmailVars),
      };

    case 'payment-failed':
      return {
        subject: 'Action Required: Payment Failed - Ask ALF',
        html: paymentFailedHtml(vars as PaymentFailedEmailVars),
        text: paymentFailedText(vars as PaymentFailedEmailVars),
      };

    case 'usage-limit-warning':
      return {
        subject: 'Usage Limit Warning - Ask ALF',
        html: usageLimitWarningHtml(vars as UsageLimitEmailVars),
        text: usageLimitWarningText(vars as UsageLimitEmailVars),
      };

    case 'team-invite':
      return {
        subject: `You're invited to join ${(vars as TeamInviteEmailVars).teamName} on Ask ALF 👽`,
        html: teamInviteHtml(vars as TeamInviteEmailVars),
        text: teamInviteText(vars as TeamInviteEmailVars),
      };

    case 'waitlist':
      return {
        subject: `You're on the Ask ALF Developer Waitlist! 👽`,
        html: waitlistEmailHtml(vars as WaitlistEmailVars),
        text: waitlistEmailText(vars as WaitlistEmailVars),
      };

    case 'waitlist-update':
      return {
        subject: `Ask ALF is Live! 👽`,
        html: waitlistUpdateEmailHtml(vars as WaitlistUpdateEmailVars),
        text: waitlistUpdateEmailText(vars as WaitlistUpdateEmailVars),
      };

    case 'beta-invite':
      return {
        subject: `You're Invited to the Ask ALF Beta! 👽`,
        html: betaInviteEmailHtml(vars as BetaInviteEmailVars),
        text: betaInviteEmailText(vars as BetaInviteEmailVars),
      };

    case 'admin-notification': {
      const adminVars = vars as AdminNotificationVars;
      let subject = 'Ask ALF Admin Alert';
      if (adminVars.type === 'waitlist_signup') {
        subject = `New Waitlist Signup: ${adminVars.email} 👽`;
      } else if (adminVars.type === 'new_user') {
        subject = `New User Registration: ${adminVars.email} 🎉`;
      } else if (adminVars.type === 'error') {
        subject = '⚠️ Ask ALF System Alert';
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
