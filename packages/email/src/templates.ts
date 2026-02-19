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
 * Base HTML template wrapper — dark theme matching the forge brand
 */
function wrapHtml(content: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>forge</title>
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
              <span style="font-size: 28px; font-weight: 800; color: #a78bfa; letter-spacing: -0.03em; line-height: 1; font-family: 'JetBrains Mono', 'Fira Code', 'Courier New', monospace;">orcastr8r</span>
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
                The control plane for autonomous agents
              </p>
              <p style="margin: 0; font-size: 13px;">
                <a href="https://orcastr8r.com" style="color: #7c3aed; text-decoration: none; font-weight: 600;">orcastr8r.com</a>
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
      Your <strong style="color: #a78bfa;">${vars.planName}</strong> deployment is live. The control plane is ready.
    </p>

    <p style="margin: 0 0 24px 0; font-size: 16px; color: #a1a1aa;">
      Orcastr8r gives you Kubernetes-style orchestration for AI agents. Deploy fleets, enforce budgets, evolve what works, kill what doesn't.
    </p>

    ${sectionLabel('What you get')}

    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 24px;">
      <tr>
        <td style="padding: 12px 0; border-bottom: 1px solid #1e1e22;">
          <strong style="color: #fafafa;">Fleet Orchestration</strong>
          <br><span style="color: #71717a; font-size: 14px;">Deploy, scale, and coordinate autonomous agents from a single command center</span>
        </td>
      </tr>
      <tr>
        <td style="padding: 12px 0; border-bottom: 1px solid #1e1e22;">
          <strong style="color: #fafafa;">Darwinian Evolution</strong>
          <br><span style="color: #71717a; font-size: 14px;">Agents that perform get promoted. Agents that don't get killed. Automatically.</span>
        </td>
      </tr>
      <tr>
        <td style="padding: 12px 0; border-bottom: 1px solid #1e1e22;">
          <strong style="color: #fafafa;">4-Tier Memory</strong>
          <br><span style="color: #71717a; font-size: 14px;">Working, episodic, semantic, and procedural memory that persists across executions</span>
        </td>
      </tr>
      <tr>
        <td style="padding: 12px 0;">
          <strong style="color: #fafafa;">Budget Enforcement</strong>
          <br><span style="color: #71717a; font-size: 14px;">Hard limits per agent, per fleet, per cycle. No surprise bills. Ever.</span>
        </td>
      </tr>
    </table>

    ${button('Open Command Center', vars.dashboardUrl)}
  `);
}

export function welcomeEmailText(vars: WelcomeEmailVars): string {
  return `
You're in.

Hi ${vars.userName},

Your ${vars.planName} deployment is live. The control plane is ready.

Orcastr8r gives you Kubernetes-style orchestration for AI agents. Deploy fleets, enforce budgets, evolve what works, kill what doesn't.

// WHAT YOU GET
- Fleet Orchestration — Deploy, scale, and coordinate autonomous agents from a single command center
- Darwinian Evolution — Agents that perform get promoted. Agents that don't get killed. Automatically.
- 4-Tier Memory — Working, episodic, semantic, and procedural memory that persists across executions
- Budget Enforcement — Hard limits per agent, per fleet, per cycle. No surprise bills. Ever.

Open Command Center: ${vars.dashboardUrl}

---
orcastr8r — The control plane for autonomous agents
https://orcastr8r.com
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
orcastr8r — The control plane for autonomous agents
https://orcastr8r.com
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
      One last step to activate your orcastr8r account:
    </p>

    ${button('Verify Email', vars.verifyUrl)}

    ${noteBox(`
      <p style="margin: 0; font-size: 14px; color: #a1a1aa;">
        This link expires in <strong style="color: #fafafa;">${vars.expiresInHours} hours</strong>.
      </p>
    `)}

    <p style="margin: 24px 0 0 0; font-size: 14px; color: #52525b;">
      If you didn't create an orcastr8r account, you can safely ignore this email.
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

One last step to activate your orcastr8r account:

${vars.verifyUrl}

This link expires in ${vars.expiresInHours} hours.

If you didn't create an orcastr8r account, you can safely ignore this email.

---
orcastr8r — The control plane for autonomous agents
https://orcastr8r.com
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
      Your orcastr8r deployment just leveled up.
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
      All features in your plan are now active. Deploy your fleet:
    </p>

    ${button('Open Command Center', vars.dashboardUrl)}
  `);
}

export function subscriptionConfirmationText(vars: SubscriptionEmailVars): string {
  return `
Subscription Confirmed

Hi ${vars.userName},

Your orcastr8r deployment just leveled up.

Plan: ${vars.planName}
Amount: ${vars.amount}
${vars.nextBillingDate ? `Next billing: ${vars.nextBillingDate}` : ''}

All features in your plan are now active.

Open Command Center: ${vars.dashboardUrl}

---
orcastr8r — The control plane for autonomous agents
https://orcastr8r.com
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

    ${button('Manage Subscription', `${vars.dashboardUrl}/billing`)}

    <p style="margin: 24px 0 0 0; font-size: 14px; color: #52525b;">
      We'd love to hear your feedback. It helps us build a better control plane.
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
${vars.dashboardUrl}/billing

---
orcastr8r — The control plane for autonomous agents
https://orcastr8r.com
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
orcastr8r — The control plane for autonomous agents
https://orcastr8r.com
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
      Once you hit the limit, ${vars.limitType.toLowerCase()} will pause until the next billing period. Upgrade to keep your fleet running:
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
orcastr8r — The control plane for autonomous agents
https://orcastr8r.com
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
      <strong style="color: #fafafa;">${vars.inviterName}</strong> invited you to join <strong style="color: #a78bfa;">${vars.teamName}</strong> on orcastr8r.
    </p>

    <p style="margin: 0 0 24px 0; font-size: 16px; color: #a1a1aa;">
      Orcastr8r is the control plane for autonomous AI agents. Deploy fleets, enforce budgets, evolve what works.
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

${vars.inviterName} invited you to join ${vars.teamName} on orcastr8r.

Orcastr8r is the control plane for autonomous AI agents. Deploy fleets, enforce budgets, evolve what works.

Accept Invitation: ${vars.inviteUrl}

This invitation expires in ${vars.expiresInDays} days.

Don't want to join? Just ignore this email.

---
orcastr8r — The control plane for autonomous agents
https://orcastr8r.com
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
      You just reserved your spot for Orcastr8r — the control plane for autonomous AI agents. We're opening access in small batches to ensure every deployment gets white-glove onboarding.
    </p>

    ${sectionLabel('What you\'re getting access to')}

    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin: 0 0 32px 0; background: #0f0f12; border: 1px solid #1e1e22; border-radius: 12px;">
      <tr>
        <td style="padding: 24px 28px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
            <tr>
              <td style="padding: 10px 0; border-bottom: 1px solid #1e1e22;">
                <strong style="color: #fafafa;">Fleet Orchestration</strong>
                <br><span style="color: #71717a; font-size: 14px;">Deploy, scale, and coordinate autonomous agents. Kubernetes-style primitives for LLMs.</span>
              </td>
            </tr>
            <tr>
              <td style="padding: 10px 0; border-bottom: 1px solid #1e1e22;">
                <strong style="color: #fafafa;">Darwinian Evolution</strong>
                <br><span style="color: #71717a; font-size: 14px;">Agents that perform get promoted. Agents that don't get killed. Natural selection for your fleet.</span>
              </td>
            </tr>
            <tr>
              <td style="padding: 10px 0; border-bottom: 1px solid #1e1e22;">
                <strong style="color: #fafafa;">Budget Enforcement</strong>
                <br><span style="color: #71717a; font-size: 14px;">Hard cost limits per agent, per fleet, per cycle. Your agents can't spend what you don't authorize.</span>
              </td>
            </tr>
            <tr>
              <td style="padding: 10px 0; border-bottom: 1px solid #1e1e22;">
                <strong style="color: #fafafa;">4-Tier Cognitive Memory</strong>
                <br><span style="color: #71717a; font-size: 14px;">Working, episodic, semantic, and procedural memory. Agents learn and remember across executions.</span>
              </td>
            </tr>
            <tr>
              <td style="padding: 10px 0; border-bottom: 1px solid #1e1e22;">
                <strong style="color: #fafafa;">Auto-Healing</strong>
                <br><span style="color: #71717a; font-size: 14px;">Failed agents restart automatically. Health checks, circuit breakers, and graceful degradation built in.</span>
              </td>
            </tr>
            <tr>
              <td style="padding: 10px 0;">
                <strong style="color: #fafafa;">Human Checkpoints</strong>
                <br><span style="color: #71717a; font-size: 14px;">Define approval gates. Agents pause and wait for your sign-off before critical actions.</span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    ${noteBox(`
      <p style="margin: 0; font-size: 14px; color: #a1a1aa; line-height: 1.6;">
        <strong style="color: #a78bfa;">Think of it this way:</strong> Kubernetes doesn't run your containers — it orchestrates them. Orcastr8r doesn't run your agents — it orchestrates them. Same model, different substrate.
      </p>
    `)}

    <p style="margin: 24px 0 0 0; font-size: 15px; color: #71717a; line-height: 1.6;">
      We'll email <strong style="color: #a1a1aa;">${vars.email}</strong> the moment your spot opens. It won't be long.
    </p>

    ${button('Follow @meetaskalf', 'https://x.com/meetaskalf')}
  `);
}

export function waitlistEmailText(vars: WaitlistEmailVars): string {
  const firstName = vars.name.split(' ')[0];
  return `
You're on the list, ${firstName}.

You just reserved your spot for Orcastr8r -- the control plane for autonomous AI agents. We're opening access in small batches to ensure every deployment gets white-glove onboarding.

// WHAT YOU'RE GETTING ACCESS TO
- Fleet Orchestration — Deploy, scale, and coordinate autonomous agents. Kubernetes-style primitives for LLMs.
- Darwinian Evolution — Agents that perform get promoted. Agents that don't get killed. Natural selection for your fleet.
- Budget Enforcement — Hard cost limits per agent, per fleet, per cycle. Your agents can't spend what you don't authorize.
- 4-Tier Cognitive Memory — Working, episodic, semantic, and procedural. Agents learn and remember across executions.
- Auto-Healing — Failed agents restart automatically. Health checks, circuit breakers, graceful degradation.
- Human Checkpoints — Define approval gates. Agents pause and wait for your sign-off before critical actions.

Think of it this way: Kubernetes doesn't run your containers -- it orchestrates them. Orcastr8r doesn't run your agents -- it orchestrates them. Same model, different substrate.

We'll email ${vars.email} the moment your spot opens. It won't be long.

Follow us on X: https://x.com/meetaskalf

---
orcastr8r — The control plane for autonomous agents
https://orcastr8r.com
  `.trim();
}

// ============================================
// Claw Replay Waitlist Email
// ============================================

function wrapClawHtml(content: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Claw Replay</title>
  <!--[if mso]>
  <style type="text/css">
    body, table, td {font-family: Arial, sans-serif !important;}
  </style>
  <![endif]-->
</head>
<body style="margin: 0; padding: 0; background-color: #06060b; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #06060b;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width: 600px; width: 100%;">

          <!-- Header -->
          <tr>
            <td align="center" style="padding-bottom: 32px;">
              <span style="font-size: 28px; font-weight: 800; color: #e8eaed; letter-spacing: -0.03em; line-height: 1;">Claw Replay</span>
            </td>
          </tr>

          <!-- Main Content Card -->
          <tr>
            <td>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #111116; border: 1px solid rgba(255,255,255,0.06); border-radius: 12px;">
                <tr>
                  <td style="padding: 48px 40px;">
                    \${content}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top: 32px;">
              <p style="margin: 0 0 8px 0; font-size: 13px; color: #5a5e72;">
                Time-travel debugging for AI conversations
              </p>
              <p style="margin: 0; font-size: 13px;">
                <a href="https://integration.tax" style="color: #3b82f6; text-decoration: none; font-weight: 600;">integration.tax</a>
                &nbsp;&middot;&nbsp;
                <a href="https://x.com/agent_orcastr8r" style="color: #5a5e72; text-decoration: none;">@agent_orcastr8r</a>
              </p>
              <p style="margin: 12px 0 0 0; font-size: 11px; color: #3f3f46;">
                Built by <a href="https://orcastr8r.com" style="color: #5a5e72; text-decoration: none;">Sprayberry Labs</a>
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

function clawButton(text: string, url: string): string {
  return `
    <table role="presentation" cellspacing="0" cellpadding="0" style="margin: 28px 0;">
      <tr>
        <td align="center" style="background: linear-gradient(135deg, #3b82f6, #8b5cf6); border-radius: 8px;">
          <a href="\${url}" style="display: inline-block; padding: 14px 32px; font-size: 15px; font-weight: 600; color: #ffffff; text-decoration: none;">
            \${text}
          </a>
        </td>
      </tr>
    </table>
  `;
}

function clawSectionLabel(text: string): string {
  return `
    <p style="margin: 32px 0 16px 0; font-size: 11px; font-weight: 600; color: #3b82f6; text-transform: uppercase; letter-spacing: 0.1em; font-family: 'SF Mono', 'Fira Code', 'Courier New', monospace;">
      // \${text}
    </p>
  `;
}

export function clawWaitlistEmailHtml(vars: WaitlistEmailVars): string {
  const firstName = vars.name.split(' ')[0];
  return wrapClawHtml(`
    <h1 style="margin: 0 0 8px 0; font-size: 28px; font-weight: 700; color: #e8eaed;">
      You're on the list, ${firstName}.
    </h1>

    <p style="margin: 0 0 24px 0; font-size: 16px; color: #8b8fa3; line-height: 1.7;">
      You just requested early access to Claw Replay — time-travel debugging for AI conversations. We're opening access selectively to ensure quality.
    </p>

    ${clawSectionLabel('What you\'re getting access to')}

    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin: 0 0 32px 0; background: #0a0a10; border: 1px solid rgba(255,255,255,0.06); border-radius: 12px;">
      <tr>
        <td style="padding: 24px 28px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
            <tr>
              <td style="padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.06);">
                <strong style="color: #e8eaed;">Merkle DAG Timelines</strong>
                <br><span style="color: #5a5e72; font-size: 14px;">Every message is a content-addressed node. Branch, merge, and diff any two points in a conversation.</span>
              </td>
            </tr>
            <tr>
              <td style="padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.06);">
                <strong style="color: #e8eaed;">Ghost Mode</strong>
                <br><span style="color: #5a5e72; font-size: 14px;">Preview multiple futures before committing. Speculative execution ranks which paths matter.</span>
              </td>
            </tr>
            <tr>
              <td style="padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.06);">
                <strong style="color: #e8eaed;">Forensics Engine</strong>
                <br><span style="color: #5a5e72; font-size: 14px;">Context pressure, confidence decay, semantic drift — automatically pinpoint where conversations break.</span>
              </td>
            </tr>
            <tr>
              <td style="padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.06);">
                <strong style="color: #e8eaed;">State Snapshots</strong>
                <br><span style="color: #5a5e72; font-size: 14px;">Copy-on-write deltas reconstruct exact model context at any point in milliseconds.</span>
              </td>
            </tr>
            <tr>
              <td style="padding: 10px 0;">
                <strong style="color: #e8eaed;">Portable .claw Files</strong>
                <br><span style="color: #5a5e72; font-size: 14px;">Export entire conversation timelines as shareable capsules. Import, fork, and learn from others.</span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin: 24px 0;">
      <tr>
        <td style="background-color: #0d0f1a; border-left: 4px solid #3b82f6; border-radius: 0 8px 8px 0; padding: 16px 20px;">
          <p style="margin: 0; font-size: 14px; color: #8b8fa3; line-height: 1.6;">
            <strong style="color: #3b82f6;">The problem we're solving:</strong> When your AI conversation breaks at message 47, you shouldn't have to start over. Claw Replay lets you fork at any point, replay with exact context, and see precisely where things went wrong.
          </p>
        </td>
      </tr>
    </table>

    <p style="margin: 24px 0 0 0; font-size: 15px; color: #5a5e72; line-height: 1.6;">
      We'll email <strong style="color: #8b8fa3;">${vars.email}</strong> when your access is ready.
    </p>

    ${clawButton('Visit integration.tax', 'https://integration.tax')}
  `);
}

export function clawWaitlistEmailText(vars: WaitlistEmailVars): string {
  const firstName = vars.name.split(' ')[0];
  return \`
You're on the list, \${firstName}.

You just requested early access to Claw Replay -- time-travel debugging for AI conversations. We're opening access selectively to ensure quality.

// WHAT YOU'RE GETTING ACCESS TO
- Merkle DAG Timelines — Every message is a content-addressed node. Branch, merge, and diff any two points.
- Ghost Mode — Preview multiple futures before committing. Speculative execution ranks which paths matter.
- Forensics Engine — Context pressure, confidence decay, semantic drift. Pinpoint where conversations break.
- State Snapshots — Copy-on-write deltas reconstruct exact model context at any point in milliseconds.
- Portable .claw Files — Export entire conversation timelines as shareable capsules.

The problem we're solving: When your AI conversation breaks at message 47, you shouldn't have to start over. Claw Replay lets you fork at any point, replay with exact context, and see precisely where things went wrong.

We'll email \${vars.email} when your access is ready.

Visit: https://integration.tax

---
Claw Replay — Time-travel debugging for AI conversations
https://integration.tax | @agent_orcastr8r
Built by Sprayberry Labs
  \`.trim();
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
      You signed up for the orcastr8r waitlist. The wait is over:
    </p>

    <p style="margin: 0 0 24px 0; font-size: 22px; font-weight: 600; color: #a78bfa;">
      The control plane is live. Your fleet awaits.
    </p>

    ${sectionLabel('What\'s ready for you')}

    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 24px;">
      <tr>
        <td style="padding: 12px 0; border-bottom: 1px solid #1e1e22;">
          <strong style="color: #fafafa;">Fleet Orchestration</strong>
          <br><span style="color: #71717a; font-size: 14px;">Deploy and coordinate autonomous agents from a single command center</span>
        </td>
      </tr>
      <tr>
        <td style="padding: 12px 0; border-bottom: 1px solid #1e1e22;">
          <strong style="color: #fafafa;">Darwinian Evolution</strong>
          <br><span style="color: #71717a; font-size: 14px;">Natural selection for your agent fleet. The best survive, the rest don't.</span>
        </td>
      </tr>
      <tr>
        <td style="padding: 12px 0; border-bottom: 1px solid #1e1e22;">
          <strong style="color: #fafafa;">4-Tier Memory</strong>
          <br><span style="color: #71717a; font-size: 14px;">Persistent cognitive memory across all agent executions</span>
        </td>
      </tr>
      <tr>
        <td style="padding: 12px 0;">
          <strong style="color: #fafafa;">Budget Enforcement</strong>
          <br><span style="color: #71717a; font-size: 14px;">Hard limits per agent, per fleet, per cycle. Zero surprise bills.</span>
        </td>
      </tr>
    </table>

    ${button('Deploy Your Fleet', 'https://orcastr8r.com')}

    ${noteBox(`
      <p style="margin: 0; font-size: 14px; color: #a1a1aa;">
        <strong style="color: #fafafa;">Free tier available</strong> — get started with no credit card required.
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

You signed up for the orcastr8r waitlist. The wait is over:

The control plane is live. Your fleet awaits.

// WHAT'S READY FOR YOU
- Fleet Orchestration — Deploy and coordinate autonomous agents from a single command center
- Darwinian Evolution — Natural selection for your agent fleet. The best survive, the rest don't.
- 4-Tier Memory — Persistent cognitive memory across all agent executions
- Budget Enforcement — Hard limits per agent, per fleet, per cycle. Zero surprise bills.

Deploy Your Fleet: https://orcastr8r.com

Free tier available — get started with no credit card required.

Thanks for being early. We built this for people like you.

---
orcastr8r — The control plane for autonomous agents
https://orcastr8r.com
  `.trim();
}

// ============================================
// Beta Invite Email
// ============================================

export function betaInviteEmailHtml(vars: BetaInviteEmailVars): string {
  const signupUrl = vars.signupUrl || 'https://orcastr8r.com/signup';
  return wrapHtml(`
    <h1 style="margin: 0 0 24px 0; font-size: 28px; font-weight: 700; color: #fafafa;">
      You've been selected.
    </h1>

    <p style="margin: 0 0 16px 0; font-size: 16px; line-height: 1.6; color: #a1a1aa;">
      You're off the waitlist. Your orcastr8r deployment is ready to create.
    </p>

    <p style="margin: 0 0 24px 0; font-size: 16px; line-height: 1.6; color: #a1a1aa;">
      As a beta operator, you'll be among the first to deploy autonomous agent fleets with Kubernetes-style orchestration.
    </p>

    ${button('Activate Your Account', signupUrl)}

    ${sectionLabel('What you get')}

    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 24px;">
      <tr>
        <td style="padding: 12px 0; border-bottom: 1px solid #1e1e22;">
          <strong style="color: #fafafa;">Fleet Orchestration</strong>
          <br><span style="color: #71717a; font-size: 14px;">Deploy, scale, and coordinate autonomous agents from one command center</span>
        </td>
      </tr>
      <tr>
        <td style="padding: 12px 0; border-bottom: 1px solid #1e1e22;">
          <strong style="color: #fafafa;">Darwinian Evolution</strong>
          <br><span style="color: #71717a; font-size: 14px;">Agents that perform get promoted. Agents that don't get killed.</span>
        </td>
      </tr>
      <tr>
        <td style="padding: 12px 0; border-bottom: 1px solid #1e1e22;">
          <strong style="color: #fafafa;">4-Tier Memory</strong>
          <br><span style="color: #71717a; font-size: 14px;">Persistent cognitive memory across all agent executions</span>
        </td>
      </tr>
      <tr>
        <td style="padding: 12px 0;">
          <strong style="color: #fafafa;">Budget Enforcement</strong>
          <br><span style="color: #71717a; font-size: 14px;">Hard cost limits per agent, per fleet, per cycle. No surprises.</span>
        </td>
      </tr>
    </table>

    <p style="margin: 0 0 16px 0; font-size: 16px; line-height: 1.6; color: #a1a1aa;">
      Your feedback shapes what we build next. We're listening.
    </p>

    <p style="margin: 0; font-size: 14px; line-height: 1.6; color: #52525b;">
      This invite is for <strong style="color: #71717a;">${vars.email}</strong>. If you didn't sign up for orcastr8r, you can ignore this email.
    </p>
  `);
}

export function betaInviteEmailText(vars: BetaInviteEmailVars): string {
  const signupUrl = vars.signupUrl || 'https://orcastr8r.com/signup';
  return `
You've been selected.

You're off the waitlist. Your orcastr8r deployment is ready to create.

As a beta operator, you'll be among the first to deploy autonomous agent fleets with Kubernetes-style orchestration.

Activate Your Account: ${signupUrl}

// WHAT YOU GET
- Fleet Orchestration — Deploy, scale, and coordinate autonomous agents from one command center
- Darwinian Evolution — Agents that perform get promoted. Agents that don't get killed.
- 4-Tier Memory — Persistent cognitive memory across all agent executions
- Budget Enforcement — Hard cost limits per agent, per fleet, per cycle. No surprises.

Your feedback shapes what we build next. We're listening.

This invite is for ${vars.email}. If you didn't sign up for orcastr8r, you can ignore this email.

---
orcastr8r — The control plane for autonomous agents
https://orcastr8r.com
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
          Someone new joined the ${vars.source === 'claw-replay' ? 'Claw Replay' : 'orcastr8r'} waitlist.
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

        ${button('View Dashboard', 'https://orcastr8r.com')}
      `;
      break;

    case 'new_user':
      content = `
        <h1 style="margin: 0 0 24px 0; font-size: 28px; font-weight: 700; color: #fafafa;">
          New User Registration
        </h1>

        <p style="margin: 0 0 24px 0; font-size: 16px; color: #a1a1aa;">
          A new operator registered for orcastr8r.
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
          An error occurred in the orcastr8r system.
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

Someone new joined the ${vars.source === 'claw-replay' ? 'Claw Replay' : 'orcastr8r'} waitlist.

Email: ${vars.email}
${vars.source ? `Source: ${vars.source}` : ''}
Time: ${vars.timestamp}
${vars.totalWaitlistCount ? `Total signups: ${vars.totalWaitlistCount}` : ''}

View Dashboard: https://orcastr8r.com

---
orcastr8r admin notification
      `.trim();

    case 'new_user':
      return `
New User Registration

A new operator registered for orcastr8r.

Email: ${vars.email}
Time: ${vars.timestamp}

---
orcastr8r admin notification
      `.trim();

    case 'error':
      return `
System Alert

An error occurred in the orcastr8r system.

${vars.message}
Time: ${vars.timestamp}

---
orcastr8r admin notification
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
  | 'waitlist-claw'
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
        subject: 'You\'re in — orcastr8r',
        html: welcomeEmailHtml(vars as WelcomeEmailVars),
        text: welcomeEmailText(vars as WelcomeEmailVars),
      };

    case 'password-reset':
      return {
        subject: 'Reset your password — orcastr8r',
        html: passwordResetEmailHtml(vars as PasswordResetEmailVars),
        text: passwordResetEmailText(vars as PasswordResetEmailVars),
      };

    case 'email-verification':
      return {
        subject: 'Verify your email — orcastr8r',
        html: emailVerificationHtml(vars as EmailVerificationVars),
        text: emailVerificationText(vars as EmailVerificationVars),
      };

    case 'subscription-confirmation':
      return {
        subject: 'Subscription confirmed — orcastr8r',
        html: subscriptionConfirmationHtml(vars as SubscriptionEmailVars),
        text: subscriptionConfirmationText(vars as SubscriptionEmailVars),
      };

    case 'subscription-canceled':
      return {
        subject: 'Subscription canceled — orcastr8r',
        html: subscriptionCanceledHtml(vars as SubscriptionEmailVars),
        text: subscriptionCanceledText(vars as SubscriptionEmailVars),
      };

    case 'payment-failed':
      return {
        subject: 'Action required: payment failed — orcastr8r',
        html: paymentFailedHtml(vars as PaymentFailedEmailVars),
        text: paymentFailedText(vars as PaymentFailedEmailVars),
      };

    case 'usage-limit-warning':
      return {
        subject: 'Usage limit warning — orcastr8r',
        html: usageLimitWarningHtml(vars as UsageLimitEmailVars),
        text: usageLimitWarningText(vars as UsageLimitEmailVars),
      };

    case 'team-invite':
      return {
        subject: `You're invited to ${(vars as TeamInviteEmailVars).teamName} — orcastr8r`,
        html: teamInviteHtml(vars as TeamInviteEmailVars),
        text: teamInviteText(vars as TeamInviteEmailVars),
      };

    case 'waitlist':
      return {
        subject: `You're on the list — orcastr8r`,
        html: waitlistEmailHtml(vars as WaitlistEmailVars),
        text: waitlistEmailText(vars as WaitlistEmailVars),
      };

    case 'waitlist-claw':
      return {
        subject: `You're on the list — Claw Replay`,
        html: clawWaitlistEmailHtml(vars as WaitlistEmailVars),
        text: clawWaitlistEmailText(vars as WaitlistEmailVars),
      };

    case 'waitlist-update':
      return {
        subject: `Your spot is ready — orcastr8r`,
        html: waitlistUpdateEmailHtml(vars as WaitlistUpdateEmailVars),
        text: waitlistUpdateEmailText(vars as WaitlistUpdateEmailVars),
      };

    case 'beta-invite':
      return {
        subject: `You've been selected — orcastr8r beta`,
        html: betaInviteEmailHtml(vars as BetaInviteEmailVars),
        text: betaInviteEmailText(vars as BetaInviteEmailVars),
      };

    case 'admin-notification': {
      const adminVars = vars as AdminNotificationVars;
      let subject = 'orcastr8r admin alert';
      if (adminVars.type === 'waitlist_signup') {
        subject = `New ${adminVars.source === 'claw-replay' ? 'Claw Replay' : 'orcastr8r'} waitlist signup: ${adminVars.email}`;
      } else if (adminVars.type === 'new_user') {
        subject = `New user: ${adminVars.email}`;
      } else if (adminVars.type === 'error') {
        subject = 'orcastr8r system alert';
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
