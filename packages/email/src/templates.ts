// AskAlf: Email Templates
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
  InterventionAlertVars,
} from './types.js';

/**
 * Base HTML template wrapper — dark theme matching AskAlf brand
 */
function wrapHtml(content: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AskAlf</title>
  <!--[if mso]>
  <style type="text/css">
    body, table, td {font-family: Arial, sans-serif !important;}
  </style>
  <![endif]-->
</head>
<body style="margin: 0; padding: 0; background-color: #0a0a0b; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #0a0a0b;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width: 600px; width: 100%;">

          <!-- Header -->
          <tr>
            <td align="center" style="padding-bottom: 32px;">
              <span style="font-size: 28px; font-weight: 800; color: #a78bfa; letter-spacing: -0.03em; line-height: 1; font-family: 'JetBrains Mono', 'Fira Code', 'Courier New', monospace;">askalf</span>
            </td>
          </tr>

          <!-- Main Content Card -->
          <tr>
            <td>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #111113; border: 1px solid #1e1e22; border-radius: 12px;">
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
              <p style="margin: 0 0 8px 0; font-size: 13px; color: #52525b;">
                AI agents that work like you do
              </p>
              <p style="margin: 0; font-size: 13px;">
                <a href="https://askalf.org" style="color: #7c3aed; text-decoration: none; font-weight: 600;">askalf.org</a>
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
        <td align="center" style="background-color: #7c3aed; border-radius: 8px;">
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
    info: { bg: '#1a1625', border: '#7c3aed' },
    warning: { bg: '#1a1810', border: '#f59e0b' },
    error: { bg: '#1a1012', border: '#ef4444' },
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

/** Section label — mimics the // comment style from the site */
function sectionLabel(text: string): string {
  return `
    <p style="margin: 32px 0 16px 0; font-size: 11px; font-weight: 600; color: #7c3aed; text-transform: uppercase; letter-spacing: 0.1em; font-family: 'JetBrains Mono', 'Fira Code', 'Courier New', monospace;">
      // ${text}
    </p>
  `;
}

/** Feature row for feature lists */
function featureRow(title: string, desc: string, isLast = false): string {
  return `
    <tr>
      <td style="padding: 12px 0;${isLast ? '' : ' border-bottom: 1px solid #1e1e22;'}">
        <strong style="color: #fafafa;">${title}</strong>
        <br><span style="color: #71717a; font-size: 14px;">${desc}</span>
      </td>
    </tr>
  `;
}

/** Standard feature list matching the website */
function platformFeatures(): string {
  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 24px;">
      ${featureRow('Fleet Orchestration', 'Deploy, coordinate, and monitor AI agents from one command center. Fan-out, pipelines, consensus patterns.')}
      ${featureRow('Multi-Provider', 'Anthropic, OpenAI, xAI, DeepSeek built in. Optionally bring your own keys. Switch providers per-agent, no lock-in.')}
      ${featureRow('Cost Control', 'Per-agent budgets, per-execution caps, real-time cost tracking. No surprise bills.')}
      ${featureRow('Guardrails & Checkpoints', 'Human-in-the-loop approvals, content filtering, execution boundaries. Trust but verify.')}
      ${featureRow('24 Built-in Tools', 'Database, Docker, web search, code analysis, team coordination — all via MCP.')}
      ${featureRow('Full Observability', 'Structured logs, execution traces, performance metrics. See everything your agents do.', true)}
    </table>
  `;
}

// ============================================
// Welcome Email
// ============================================

export function welcomeEmailHtml(vars: WelcomeEmailVars): string {
  return wrapHtml(`
    <h1 style="margin: 0 0 24px 0; font-size: 28px; font-weight: 700; color: #fafafa;">
      You're in.
    </h1>

    <p style="margin: 0 0 16px 0; font-size: 16px; color: #a1a1aa;">
      Hi ${vars.userName},
    </p>

    <p style="margin: 0 0 16px 0; font-size: 16px; color: #a1a1aa;">
      Your <strong style="color: #a78bfa;">${vars.planName}</strong> account is live. Your agents are ready to deploy.
    </p>

    <p style="margin: 0 0 24px 0; font-size: 16px; color: #a1a1aa;">
      AskAlf is the AI agent platform where agents don't just chat — they use computers like you do. Mouse, keyboard, browser, terminal. Real work, not conversation.
    </p>

    ${sectionLabel('What you get')}

    ${platformFeatures()}

    ${button('Open Command Center', vars.dashboardUrl)}
  `);
}

export function welcomeEmailText(vars: WelcomeEmailVars): string {
  return `
You're in.

Hi ${vars.userName},

Your ${vars.planName} account is live. Your agents are ready to deploy.

AskAlf is the AI agent platform where agents don't just chat -- they use computers like you do. Mouse, keyboard, browser, terminal. Real work, not conversation.

// WHAT YOU GET
- Fleet Orchestration -- Deploy, coordinate, and monitor AI agents from one command center
- Multi-Provider -- Anthropic, OpenAI, xAI, DeepSeek built in. Optionally bring your own keys
- Cost Control -- Per-agent budgets, per-execution caps, real-time tracking
- Guardrails & Checkpoints -- Human-in-the-loop approvals, execution boundaries
- 24 Built-in Tools -- Database, Docker, web search, code analysis via MCP
- Full Observability -- Structured logs, execution traces, performance metrics

Open Command Center: ${vars.dashboardUrl}

---
askalf -- AI agents that work like you do
https://askalf.org
  `.trim();
}

// ============================================
// Password Reset Email
// ============================================

export function passwordResetEmailHtml(vars: PasswordResetEmailVars): string {
  return wrapHtml(`
    <h1 style="margin: 0 0 24px 0; font-size: 28px; font-weight: 700; color: #fafafa;">
      Reset Your Password
    </h1>

    <p style="margin: 0 0 16px 0; font-size: 16px; color: #a1a1aa;">
      Hi ${vars.userName},
    </p>

    <p style="margin: 0 0 24px 0; font-size: 16px; color: #a1a1aa;">
      We received a request to reset your password. Click the button below to create a new one:
    </p>

    ${button('Reset Password', vars.resetUrl)}

    ${noteBox(`
      <p style="margin: 0; font-size: 14px; color: #a1a1aa;">
        This link expires in <strong style="color: #fafafa;">${vars.expiresInMinutes} minutes</strong>.
      </p>
    `, 'warning')}

    <p style="margin: 24px 0 0 0; font-size: 14px; color: #52525b;">
      If you didn't request this, you can safely ignore this email. Your password won't change.
    </p>

    <p style="margin: 24px 0 0 0; font-size: 12px; color: #3f3f46;">
      Button not working? Copy this link:<br>
      <a href="${vars.resetUrl}" style="color: #7c3aed; word-break: break-all;">${vars.resetUrl}</a>
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
askalf -- AI agents that work like you do
https://askalf.org
  `.trim();
}

// ============================================
// Email Verification
// ============================================

export function emailVerificationHtml(vars: EmailVerificationVars): string {
  return wrapHtml(`
    <h1 style="margin: 0 0 24px 0; font-size: 28px; font-weight: 700; color: #fafafa;">
      Verify Your Email
    </h1>

    <p style="margin: 0 0 16px 0; font-size: 16px; color: #a1a1aa;">
      Hi ${vars.userName},
    </p>

    <p style="margin: 0 0 24px 0; font-size: 16px; color: #a1a1aa;">
      One last step to activate your AskAlf account:
    </p>

    ${button('Verify Email', vars.verifyUrl)}

    ${noteBox(`
      <p style="margin: 0; font-size: 14px; color: #a1a1aa;">
        This link expires in <strong style="color: #fafafa;">${vars.expiresInHours} hours</strong>.
      </p>
    `)}

    <p style="margin: 24px 0 0 0; font-size: 14px; color: #52525b;">
      If you didn't create an AskAlf account, you can safely ignore this email.
    </p>

    <p style="margin: 24px 0 0 0; font-size: 12px; color: #3f3f46;">
      Button not working? Copy this link:<br>
      <a href="${vars.verifyUrl}" style="color: #7c3aed; word-break: break-all;">${vars.verifyUrl}</a>
    </p>
  `);
}

export function emailVerificationText(vars: EmailVerificationVars): string {
  return `
Verify Your Email

Hi ${vars.userName},

One last step to activate your AskAlf account:

${vars.verifyUrl}

This link expires in ${vars.expiresInHours} hours.

If you didn't create an AskAlf account, you can safely ignore this email.

---
askalf -- AI agents that work like you do
https://askalf.org
  `.trim();
}

// ============================================
// Subscription Confirmation
// ============================================

export function subscriptionConfirmationHtml(vars: SubscriptionEmailVars): string {
  return wrapHtml(`
    <h1 style="margin: 0 0 24px 0; font-size: 28px; font-weight: 700; color: #fafafa;">
      Subscription Confirmed
    </h1>

    <p style="margin: 0 0 16px 0; font-size: 16px; color: #a1a1aa;">
      Hi ${vars.userName},
    </p>

    <p style="margin: 0 0 24px 0; font-size: 16px; color: #a1a1aa;">
      Your AskAlf account just leveled up.
    </p>

    ${noteBox(`
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
        <tr>
          <td style="padding: 4px 0; font-size: 14px; color: #a1a1aa;">
            <strong style="color: #fafafa;">Plan:</strong> ${vars.planName}
          </td>
        </tr>
        <tr>
          <td style="padding: 4px 0; font-size: 14px; color: #a1a1aa;">
            <strong style="color: #fafafa;">Amount:</strong> ${vars.amount}
          </td>
        </tr>
        ${vars.nextBillingDate ? `
        <tr>
          <td style="padding: 4px 0; font-size: 14px; color: #a1a1aa;">
            <strong style="color: #fafafa;">Next billing:</strong> ${vars.nextBillingDate}
          </td>
        </tr>
        ` : ''}
      </table>
    `)}

    <p style="margin: 24px 0 0 0; font-size: 16px; color: #a1a1aa;">
      All features in your plan are now active. Deploy your agents:
    </p>

    ${button('Open Command Center', vars.dashboardUrl)}
  `);
}

export function subscriptionConfirmationText(vars: SubscriptionEmailVars): string {
  return `
Subscription Confirmed

Hi ${vars.userName},

Your AskAlf account just leveled up.

Plan: ${vars.planName}
Amount: ${vars.amount}
${vars.nextBillingDate ? `Next billing: ${vars.nextBillingDate}` : ''}

All features in your plan are now active.

Open Command Center: ${vars.dashboardUrl}

---
askalf -- AI agents that work like you do
https://askalf.org
  `.trim();
}

// ============================================
// Subscription Canceled
// ============================================

export function subscriptionCanceledHtml(vars: SubscriptionEmailVars): string {
  return wrapHtml(`
    <h1 style="margin: 0 0 24px 0; font-size: 28px; font-weight: 700; color: #fafafa;">
      Subscription Canceled
    </h1>

    <p style="margin: 0 0 16px 0; font-size: 16px; color: #a1a1aa;">
      Hi ${vars.userName},
    </p>

    <p style="margin: 0 0 24px 0; font-size: 16px; color: #a1a1aa;">
      Your ${vars.planName} subscription has been canceled.
    </p>

    ${vars.nextBillingDate ? noteBox(`
      <p style="margin: 0; font-size: 14px; color: #a1a1aa;">
        You'll continue to have access until <strong style="color: #fafafa;">${vars.nextBillingDate}</strong>.
      </p>
    `) : ''}

    <p style="margin: 24px 0 0 0; font-size: 16px; color: #a1a1aa;">
      Changed your mind? Reactivate anytime:
    </p>

    ${button('Manage Subscription', `${vars.dashboardUrl}/settings`)}

    <p style="margin: 24px 0 0 0; font-size: 14px; color: #52525b;">
      We'd love to hear your feedback. Reply to this email — it goes straight to the team.
    </p>
  `);
}

export function subscriptionCanceledText(vars: SubscriptionEmailVars): string {
  return `
Subscription Canceled

Hi ${vars.userName},

Your ${vars.planName} subscription has been canceled.

${vars.nextBillingDate ? `You'll continue to have access until ${vars.nextBillingDate}.` : ''}

Changed your mind? Reactivate anytime:
${vars.dashboardUrl}/settings

---
askalf -- AI agents that work like you do
https://askalf.org
  `.trim();
}

// ============================================
// Payment Failed
// ============================================

export function paymentFailedHtml(vars: PaymentFailedEmailVars): string {
  return wrapHtml(`
    <h1 style="margin: 0 0 24px 0; font-size: 28px; font-weight: 700; color: #fafafa;">
      Payment Failed
    </h1>

    <p style="margin: 0 0 16px 0; font-size: 16px; color: #a1a1aa;">
      Hi ${vars.userName},
    </p>

    <p style="margin: 0 0 24px 0; font-size: 16px; color: #a1a1aa;">
      We couldn't process your payment of <strong style="color: #fafafa;">${vars.amount}</strong>.
    </p>

    ${noteBox(`
      <p style="margin: 0; font-size: 14px; color: #a1a1aa;">
        ${vars.retryDate
          ? `We'll automatically retry on <strong style="color: #fafafa;">${vars.retryDate}</strong>.`
          : 'Please update your payment method to avoid service interruption.'}
      </p>
    `, 'error')}

    ${button('Update Payment Method', vars.updatePaymentUrl)}

    <p style="margin: 24px 0 0 0; font-size: 14px; color: #52525b;">
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
askalf -- AI agents that work like you do
https://askalf.org
  `.trim();
}

// ============================================
// Usage Limit Warning
// ============================================

export function usageLimitWarningHtml(vars: UsageLimitEmailVars): string {
  const isHigh = vars.percentUsed >= 90;

  return wrapHtml(`
    <h1 style="margin: 0 0 24px 0; font-size: 28px; font-weight: 700; color: #fafafa;">
      Usage Limit Warning
    </h1>

    <p style="margin: 0 0 16px 0; font-size: 16px; color: #a1a1aa;">
      Hi ${vars.userName},
    </p>

    <p style="margin: 0 0 24px 0; font-size: 16px; color: #a1a1aa;">
      You're approaching your ${vars.limitType} limit.
    </p>

    ${noteBox(`
      <p style="margin: 0; font-size: 14px; color: #a1a1aa;">
        <strong style="color: #fafafa;">Current usage:</strong> ${vars.currentUsage.toLocaleString()} / ${vars.limit.toLocaleString()} (${vars.percentUsed}%)
      </p>
    `, isHigh ? 'error' : 'warning')}

    <p style="margin: 24px 0 0 0; font-size: 16px; color: #a1a1aa;">
      Once you hit the limit, ${vars.limitType.toLowerCase()} will pause until the next billing period. Upgrade to keep your agents running:
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
askalf -- AI agents that work like you do
https://askalf.org
  `.trim();
}

// ============================================
// Team Invitation
// ============================================

export function teamInviteHtml(vars: TeamInviteEmailVars): string {
  return wrapHtml(`
    <h1 style="margin: 0 0 24px 0; font-size: 28px; font-weight: 700; color: #fafafa;">
      You're Invited
    </h1>

    <p style="margin: 0 0 16px 0; font-size: 16px; color: #a1a1aa;">
      <strong style="color: #fafafa;">${vars.inviterName}</strong> invited you to join <strong style="color: #a78bfa;">${vars.teamName}</strong> on AskAlf.
    </p>

    <p style="margin: 0 0 24px 0; font-size: 16px; color: #a1a1aa;">
      AskAlf is the AI agent platform where agents use computers like you do — browsing the web, running commands, writing code, and executing real tasks.
    </p>

    ${button('Accept Invitation', vars.inviteUrl)}

    ${noteBox(`
      <p style="margin: 0; font-size: 14px; color: #a1a1aa;">
        This invitation expires in <strong style="color: #fafafa;">${vars.expiresInDays} days</strong>.
      </p>
    `)}

    <p style="margin: 24px 0 0 0; font-size: 14px; color: #52525b;">
      Don't want to join? Just ignore this email.
    </p>
  `);
}

export function teamInviteText(vars: TeamInviteEmailVars): string {
  return `
You're Invited

${vars.inviterName} invited you to join ${vars.teamName} on AskAlf.

AskAlf is the AI agent platform where agents use computers like you do -- browsing the web, running commands, writing code, and executing real tasks.

Accept Invitation: ${vars.inviteUrl}

This invitation expires in ${vars.expiresInDays} days.

Don't want to join? Just ignore this email.

---
askalf -- AI agents that work like you do
https://askalf.org
  `.trim();
}

// ============================================
// Waitlist Email
// ============================================

export function waitlistEmailHtml(vars: WaitlistEmailVars): string {
  const firstName = vars.name.split(' ')[0];
  return wrapHtml(`
    <h1 style="margin: 0 0 8px 0; font-size: 28px; font-weight: 700; color: #fafafa;">
      You're on the list, ${firstName}.
    </h1>

    <p style="margin: 0 0 24px 0; font-size: 16px; color: #a1a1aa; line-height: 1.7;">
      You just reserved your spot for AskAlf — the AI agent platform where agents don't just chat, they use computers like you do. We're opening access in small batches to make sure every account gets a great onboarding experience.
    </p>

    ${sectionLabel('What you\'re getting access to')}

    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin: 0 0 32px 0; background: #0f0f12; border: 1px solid #1e1e22; border-radius: 12px;">
      <tr>
        <td style="padding: 24px 28px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
            ${featureRow('Computer-Use Agents', 'Agents that control mouse, keyboard, browser, and terminal. They do real work — not just answer questions.')}
            ${featureRow('Fleet Orchestration', 'Deploy, coordinate, and monitor multiple agents. Fan-out tasks, build pipelines, use consensus patterns.')}
            ${featureRow('Multi-Provider', 'Anthropic, OpenAI, xAI, DeepSeek built in. Optionally bring your own keys. Switch providers per-agent.')}
            ${featureRow('Cost Control', 'Per-agent budgets, per-execution caps, real-time cost tracking. Your agents can\'t spend what you don\'t authorize.')}
            ${featureRow('Guardrails & Checkpoints', 'Human-in-the-loop approvals for sensitive actions. Agents pause and wait for your sign-off.')}
            ${featureRow('24 Built-in Tools', 'Database queries, Docker management, web search, code analysis, team coordination — all via MCP.', true)}
          </table>
        </td>
      </tr>
    </table>

    ${noteBox(`
      <p style="margin: 0; font-size: 14px; color: #a1a1aa; line-height: 1.6;">
        <strong style="color: #a78bfa;">Think of it this way:</strong> Other platforms give you chatbots. AskAlf gives you digital employees that sit at a virtual desk and do real work — browsing, coding, monitoring, analyzing.
      </p>
    `)}

    <p style="margin: 24px 0 0 0; font-size: 15px; color: #71717a; line-height: 1.6;">
      We'll email <strong style="color: #a1a1aa;">${vars.email}</strong> the moment your spot opens. It won't be long.
    </p>
  `);
}

export function waitlistEmailText(vars: WaitlistEmailVars): string {
  const firstName = vars.name.split(' ')[0];
  return `
You're on the list, ${firstName}.

You just reserved your spot for AskAlf -- the AI agent platform where agents don't just chat, they use computers like you do. We're opening access in small batches to make sure every account gets a great onboarding experience.

// WHAT YOU'RE GETTING ACCESS TO
- Computer-Use Agents -- Agents that control mouse, keyboard, browser, and terminal. Real work, not conversation.
- Fleet Orchestration -- Deploy, coordinate, and monitor multiple agents. Fan-out, pipelines, consensus patterns.
- Multi-Provider -- Anthropic, OpenAI, xAI, DeepSeek built in. Optionally bring your own keys.
- Cost Control -- Per-agent budgets, per-execution caps. Your agents can't spend what you don't authorize.
- Guardrails & Checkpoints -- Human-in-the-loop approvals. Agents pause and wait for your sign-off.
- 24 Built-in Tools -- Database, Docker, web search, code analysis, team coordination via MCP.

Think of it this way: Other platforms give you chatbots. AskAlf gives you digital employees that sit at a virtual desk and do real work.

We'll email ${vars.email} the moment your spot opens. It won't be long.

---
askalf -- AI agents that work like you do
https://askalf.org
  `.trim();
}


// ============================================
// Waitlist Update Email (Announcement to existing waitlist)
// ============================================

export function waitlistUpdateEmailHtml(vars: WaitlistUpdateEmailVars): string {
  return wrapHtml(`
    <h1 style="margin: 0 0 24px 0; font-size: 28px; font-weight: 700; color: #fafafa;">
      Your spot is ready.
    </h1>

    <p style="margin: 0 0 16px 0; font-size: 16px; color: #a1a1aa;">
      You signed up for the AskAlf waitlist. The wait is over:
    </p>

    <p style="margin: 0 0 24px 0; font-size: 22px; font-weight: 600; color: #a78bfa;">
      Your agents are ready to deploy.
    </p>

    ${sectionLabel('What\'s ready for you')}

    ${platformFeatures()}

    ${button('Get Started', 'https://askalf.org/register')}

    ${noteBox(`
      <p style="margin: 0; font-size: 14px; color: #a1a1aa;">
        <strong style="color: #fafafa;">Free during beta</strong> — AI access included, start deploying agents immediately. No credit card required.
      </p>
    `)}

    <p style="margin: 24px 0 0 0; font-size: 14px; color: #52525b;">
      Thanks for being early. We built this for people like you.
    </p>
  `);
}

export function waitlistUpdateEmailText(vars: WaitlistUpdateEmailVars): string {
  return `
Your spot is ready.

You signed up for the AskAlf waitlist. The wait is over.

Your agents are ready to deploy.

// WHAT'S READY FOR YOU
- Fleet Orchestration -- Deploy, coordinate, and monitor AI agents from one command center
- Multi-Provider -- Anthropic, OpenAI, xAI, DeepSeek built in. Optionally bring your own keys
- Cost Control -- Per-agent budgets, per-execution caps, real-time tracking
- Guardrails & Checkpoints -- Human-in-the-loop approvals, execution boundaries
- 24 Built-in Tools -- Database, Docker, web search, code analysis via MCP
- Full Observability -- Structured logs, execution traces, performance metrics

Get Started: https://askalf.org/register

Free during beta -- AI access included. No credit card required.

Thanks for being early. We built this for people like you.

---
askalf -- AI agents that work like you do
https://askalf.org
  `.trim();
}

// ============================================
// Beta Invite Email
// ============================================

export function betaInviteEmailHtml(vars: BetaInviteEmailVars): string {
  const signupUrl = vars.signupUrl || 'https://askalf.org/register';
  return wrapHtml(`
    <h1 style="margin: 0 0 24px 0; font-size: 28px; font-weight: 700; color: #fafafa;">
      You've been selected.
    </h1>

    <p style="margin: 0 0 16px 0; font-size: 16px; line-height: 1.6; color: #a1a1aa;">
      You're off the waitlist. Your AskAlf account is ready to create.
    </p>

    <p style="margin: 0 0 24px 0; font-size: 16px; line-height: 1.6; color: #a1a1aa;">
      As a beta member, you'll be among the first to deploy AI agents that use computers like you do — browsing the web, running commands, writing and committing code, monitoring systems, and executing real tasks.
    </p>

    ${button('Activate Your Account', signupUrl)}

    ${sectionLabel('What you get')}

    ${platformFeatures()}

    ${noteBox(`
      <p style="margin: 0; font-size: 14px; color: #a1a1aa; line-height: 1.6;">
        <strong style="color: #06d6a0;">Beta perks:</strong> Free platform access, every agent, every tool. You only pay for AI provider usage through your own API keys. Beta members get guaranteed early-adopter pricing when we launch paid tiers.
      </p>
    `)}

    <p style="margin: 24px 0 0 0; font-size: 16px; line-height: 1.6; color: #a1a1aa;">
      Your feedback shapes what we build next. We're listening.
    </p>

    <p style="margin: 16px 0 0 0; font-size: 14px; line-height: 1.6; color: #52525b;">
      This invite is for <strong style="color: #71717a;">${vars.email}</strong>. If you didn't sign up for AskAlf, you can ignore this email.
    </p>
  `);
}

export function betaInviteEmailText(vars: BetaInviteEmailVars): string {
  const signupUrl = vars.signupUrl || 'https://askalf.org/register';
  return `
You've been selected.

You're off the waitlist. Your AskAlf account is ready to create.

As a beta member, you'll be among the first to deploy AI agents that use computers like you do -- browsing the web, running commands, writing code, monitoring systems.

Activate Your Account: ${signupUrl}

// WHAT YOU GET
- Fleet Orchestration -- Deploy, coordinate, and monitor AI agents from one command center
- Multi-Provider -- Anthropic, OpenAI, xAI, DeepSeek built in. Optionally bring your own keys
- Cost Control -- Per-agent budgets, per-execution caps, real-time tracking
- Guardrails & Checkpoints -- Human-in-the-loop approvals, execution boundaries
- 24 Built-in Tools -- Database, Docker, web search, code analysis via MCP
- Full Observability -- Structured logs, execution traces, performance metrics

Beta perks: Free platform access, every agent, every tool. You only pay for AI provider usage. Beta members get guaranteed early-adopter pricing.

Your feedback shapes what we build next. We're listening.

This invite is for ${vars.email}. If you didn't sign up for AskAlf, you can ignore this email.

---
askalf -- AI agents that work like you do
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
        <h1 style="margin: 0 0 24px 0; font-size: 28px; font-weight: 700; color: #fafafa;">
          New Waitlist Signup
        </h1>

        <p style="margin: 0 0 24px 0; font-size: 16px; color: #a1a1aa;">
          Someone new joined the AskAlf waitlist.
        </p>

        ${noteBox(`
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
            <tr>
              <td style="padding: 4px 0; font-size: 14px; color: #a1a1aa;">
                <strong style="color: #fafafa;">Email:</strong> ${vars.email}
              </td>
            </tr>
            ${vars.source ? `
            <tr>
              <td style="padding: 4px 0; font-size: 14px; color: #a1a1aa;">
                <strong style="color: #fafafa;">Source:</strong> ${vars.source}
              </td>
            </tr>
            ` : ''}
            <tr>
              <td style="padding: 4px 0; font-size: 14px; color: #a1a1aa;">
                <strong style="color: #fafafa;">Time:</strong> ${vars.timestamp}
              </td>
            </tr>
            ${vars.totalWaitlistCount ? `
            <tr>
              <td style="padding: 4px 0; font-size: 14px; color: #a1a1aa;">
                <strong style="color: #fafafa;">Total signups:</strong> ${vars.totalWaitlistCount}
              </td>
            </tr>
            ` : ''}
          </table>
        `)}

        ${button('View Dashboard', 'https://askalf.org/users')}
      `;
      break;

    case 'new_user':
      content = `
        <h1 style="margin: 0 0 24px 0; font-size: 28px; font-weight: 700; color: #fafafa;">
          New User Registration
        </h1>

        <p style="margin: 0 0 24px 0; font-size: 16px; color: #a1a1aa;">
          A new user registered for AskAlf.
        </p>

        ${noteBox(`
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
            <tr>
              <td style="padding: 4px 0; font-size: 14px; color: #a1a1aa;">
                <strong style="color: #fafafa;">Email:</strong> ${vars.email}
              </td>
            </tr>
            <tr>
              <td style="padding: 4px 0; font-size: 14px; color: #a1a1aa;">
                <strong style="color: #fafafa;">Time:</strong> ${vars.timestamp}
              </td>
            </tr>
          </table>
        `)}
      `;
      break;

    case 'error':
      content = `
        <h1 style="margin: 0 0 24px 0; font-size: 28px; font-weight: 700; color: #fafafa;">
          System Alert
        </h1>

        <p style="margin: 0 0 24px 0; font-size: 16px; color: #a1a1aa;">
          An error occurred in the AskAlf system.
        </p>

        ${noteBox(`
          <p style="margin: 0 0 8px 0; font-size: 14px; color: #a1a1aa;">${vars.message}</p>
          <p style="margin: 0; font-size: 14px; color: #a1a1aa;"><strong style="color: #fafafa;">Time:</strong> ${vars.timestamp}</p>
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
New Waitlist Signup${vars.source ? ` (${vars.source})` : ''}

Someone new joined the AskAlf waitlist.

Email: ${vars.email}
${vars.source ? `Source: ${vars.source}` : ''}
Time: ${vars.timestamp}
${vars.totalWaitlistCount ? `Total signups: ${vars.totalWaitlistCount}` : ''}

View Dashboard: https://askalf.org/users

---
askalf admin notification
      `.trim();

    case 'new_user':
      return `
New User Registration

A new user registered for AskAlf.

Email: ${vars.email}
Time: ${vars.timestamp}

---
askalf admin notification
      `.trim();

    case 'error':
      return `
System Alert

An error occurred in the AskAlf system.

${vars.message}
Time: ${vars.timestamp}

---
askalf admin notification
      `.trim();

    default:
      return 'Admin notification';
  }
}

// ============================================
// Intervention Alert Email
// ============================================

export function interventionAlertHtml(vars: InterventionAlertVars): string {
  const noteType = vars.riskLevel === 'high' ? 'error' : vars.interventionType === 'error' || vars.interventionType === 'escalation' ? 'error' : 'warning';

  return wrapHtml(`
    <h1 style="margin: 0 0 24px 0; font-size: 28px; font-weight: 700; color: #fafafa;">
      Intervention Required
    </h1>

    <p style="margin: 0 0 16px 0; font-size: 16px; color: #a1a1aa;">
      Agent <strong style="color: #a78bfa;">${vars.agentName}</strong> needs your attention.
    </p>

    ${noteBox(`
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
        <tr><td style="padding: 4px 0; font-size: 14px; color: #a1a1aa;"><strong style="color: #fafafa;">Type:</strong> ${vars.interventionType.toUpperCase()}</td></tr>
        ${vars.riskLevel ? `<tr><td style="padding: 4px 0; font-size: 14px; color: #a1a1aa;"><strong style="color: #fafafa;">Risk:</strong> ${vars.riskLevel.toUpperCase()}</td></tr>` : ''}
        <tr><td style="padding: 4px 0; font-size: 14px; color: #a1a1aa;"><strong style="color: #fafafa;">Action:</strong> ${vars.title}</td></tr>
      </table>
    `, noteType)}

    <p style="margin: 16px 0; font-size: 15px; color: #a1a1aa; line-height: 1.6;">
      ${vars.description}
    </p>

    ${vars.proposedAction ? `
    ${sectionLabel('Proposed Action')}
    <pre style="background: #0f0f12; border: 1px solid #1e1e22; border-radius: 8px; padding: 16px; color: #a1a1aa; font-size: 13px; overflow-x: auto; font-family: 'JetBrains Mono', 'Fira Code', monospace;">${vars.proposedAction}</pre>
    ` : ''}

    ${button('Approve', vars.approveUrl)}

    <p style="margin: 0 0 16px 0; font-size: 13px; color: #52525b;">
      Or <a href="${vars.denyUrl}" style="color: #ef4444; text-decoration: underline;">deny this request</a>
    </p>

    <p style="margin: 24px 0 0 0; font-size: 13px; color: #3f3f46;">
      ${vars.timestamp} &middot; <a href="${vars.dashboardUrl}" style="color: #7c3aed;">View in Dashboard</a>
    </p>
  `);
}

export function interventionAlertText(vars: InterventionAlertVars): string {
  return `INTERVENTION REQUIRED

Agent: ${vars.agentName}
Type: ${vars.interventionType.toUpperCase()}
${vars.riskLevel ? `Risk: ${vars.riskLevel.toUpperCase()}\n` : ''}Action: ${vars.title}

${vars.description}
${vars.proposedAction ? `\nProposed Action:\n${vars.proposedAction}\n` : ''}
Approve: ${vars.approveUrl}
Deny: ${vars.denyUrl}

${vars.timestamp}
View in Dashboard: ${vars.dashboardUrl}

---
askalf admin notification`.trim();
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
  | 'admin-notification'
  | 'intervention-alert';

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
  | AdminNotificationVars
  | InterventionAlertVars;

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
        subject: 'You\'re in — AskAlf',
        html: welcomeEmailHtml(vars as WelcomeEmailVars),
        text: welcomeEmailText(vars as WelcomeEmailVars),
      };

    case 'password-reset':
      return {
        subject: 'Reset your password — AskAlf',
        html: passwordResetEmailHtml(vars as PasswordResetEmailVars),
        text: passwordResetEmailText(vars as PasswordResetEmailVars),
      };

    case 'email-verification':
      return {
        subject: 'Verify your email — AskAlf',
        html: emailVerificationHtml(vars as EmailVerificationVars),
        text: emailVerificationText(vars as EmailVerificationVars),
      };

    case 'subscription-confirmation':
      return {
        subject: 'Subscription confirmed — AskAlf',
        html: subscriptionConfirmationHtml(vars as SubscriptionEmailVars),
        text: subscriptionConfirmationText(vars as SubscriptionEmailVars),
      };

    case 'subscription-canceled':
      return {
        subject: 'Subscription canceled — AskAlf',
        html: subscriptionCanceledHtml(vars as SubscriptionEmailVars),
        text: subscriptionCanceledText(vars as SubscriptionEmailVars),
      };

    case 'payment-failed':
      return {
        subject: 'Action required: payment failed — AskAlf',
        html: paymentFailedHtml(vars as PaymentFailedEmailVars),
        text: paymentFailedText(vars as PaymentFailedEmailVars),
      };

    case 'usage-limit-warning':
      return {
        subject: 'Usage limit warning — AskAlf',
        html: usageLimitWarningHtml(vars as UsageLimitEmailVars),
        text: usageLimitWarningText(vars as UsageLimitEmailVars),
      };

    case 'team-invite':
      return {
        subject: `You're invited to ${(vars as TeamInviteEmailVars).teamName} — AskAlf`,
        html: teamInviteHtml(vars as TeamInviteEmailVars),
        text: teamInviteText(vars as TeamInviteEmailVars),
      };

    case 'waitlist':
      return {
        subject: `You're on the list — AskAlf`,
        html: waitlistEmailHtml(vars as WaitlistEmailVars),
        text: waitlistEmailText(vars as WaitlistEmailVars),
      };

    case 'waitlist-update':
      return {
        subject: `Your spot is ready — AskAlf`,
        html: waitlistUpdateEmailHtml(vars as WaitlistUpdateEmailVars),
        text: waitlistUpdateEmailText(vars as WaitlistUpdateEmailVars),
      };

    case 'beta-invite':
      return {
        subject: `You've been selected — AskAlf beta`,
        html: betaInviteEmailHtml(vars as BetaInviteEmailVars),
        text: betaInviteEmailText(vars as BetaInviteEmailVars),
      };

    case 'admin-notification': {
      const adminVars = vars as AdminNotificationVars;
      let subject = 'AskAlf admin alert';
      if (adminVars.type === 'waitlist_signup') {
        subject = `New AskAlf waitlist signup: ${adminVars.email}`;
      } else if (adminVars.type === 'new_user') {
        subject = `New user: ${adminVars.email}`;
      } else if (adminVars.type === 'error') {
        subject = 'AskAlf system alert';
      }
      return {
        subject,
        html: adminNotificationHtml(adminVars),
        text: adminNotificationText(adminVars),
      };
    }

    case 'intervention-alert': {
      const alertVars = vars as InterventionAlertVars;
      const riskPrefix = alertVars.riskLevel === 'high' ? '[HIGH RISK] ' : '';
      return {
        subject: `${riskPrefix}Intervention: ${alertVars.title} — AskAlf`,
        html: interventionAlertHtml(alertVars),
        text: interventionAlertText(alertVars),
      };
    }

    default:
      throw new Error(`Unknown email template: ${template}`);
  }
}
