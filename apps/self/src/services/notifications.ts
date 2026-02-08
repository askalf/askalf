/**
 * Notification System
 * WebSocket push notifications + email for critical alerts.
 * Bridges activity feed events to user-facing notifications.
 */

import { query, queryOne } from '../database.js';

// ============================================
// Types
// ============================================

export interface Notification {
  id: string;
  selfId: string;
  userId: string;
  type: 'approval' | 'action' | 'insight' | 'error' | 'briefing';
  title: string;
  body: string;
  actionUrl?: string;
  read: boolean;
  createdAt: string;
}

// ============================================
// WebSocket Connections
// ============================================

interface WSClient {
  userId: string;
  send: (data: string) => void;
}

const wsClients = new Map<string, Set<WSClient>>();

/**
 * Register a WebSocket client for push notifications
 */
export function registerWSClient(userId: string, send: (data: string) => void): () => void {
  const client: WSClient = { userId, send };

  if (!wsClients.has(userId)) {
    wsClients.set(userId, new Set());
  }
  wsClients.get(userId)!.add(client);

  // Return cleanup function
  return () => {
    const clients = wsClients.get(userId);
    if (clients) {
      clients.delete(client);
      if (clients.size === 0) {
        wsClients.delete(userId);
      }
    }
  };
}

/**
 * Push a notification to a user via WebSocket
 */
export function pushNotification(userId: string, notification: Partial<Notification>): void {
  const clients = wsClients.get(userId);
  if (!clients || clients.size === 0) return;

  const message = JSON.stringify({ type: 'notification', data: notification });
  const dead: WSClient[] = [];

  for (const client of clients) {
    try {
      client.send(message);
    } catch {
      dead.push(client);
    }
  }

  for (const d of dead) {
    clients.delete(d);
  }
}

// ============================================
// Notification Triggers
// ============================================

/**
 * Notify user of a pending approval
 */
export async function notifyApproval(params: {
  selfId: string;
  userId: string;
  approvalId: string;
  title: string;
  urgency: string;
}): Promise<void> {
  pushNotification(params.userId, {
    type: 'approval',
    title: params.title,
    body: `SELF needs your approval`,
    actionUrl: `/approvals/${params.approvalId}`,
  });

  // For critical urgency, also send email notification
  if (params.urgency === 'critical') {
    await sendEmailNotification(params.userId, {
      subject: `[SELF] Urgent: ${params.title}`,
      body: `SELF needs your immediate approval for: ${params.title}`,
    });
  }
}

/**
 * Notify user of a completed action
 */
export function notifyAction(userId: string, title: string): void {
  pushNotification(userId, {
    type: 'action',
    title,
    body: 'SELF completed an action',
  });
}

/**
 * Notify user of an error
 */
export function notifyError(userId: string, title: string, body: string): void {
  pushNotification(userId, {
    type: 'error',
    title,
    body,
  });
}

/**
 * Send morning briefing notification
 */
export function notifyBriefing(userId: string, briefing: string): void {
  pushNotification(userId, {
    type: 'briefing',
    title: 'Morning Briefing',
    body: briefing,
  });
}

// ============================================
// Email Notifications (via SendGrid)
// ============================================

async function sendEmailNotification(
  userId: string,
  params: { subject: string; body: string },
): Promise<void> {
  // Load user email
  const user = await queryOne<{ email: string }>(
    `SELECT email FROM users WHERE id = $1`,
    [userId],
  );

  if (!user) return;

  const sendgridApiKey = process.env['SENDGRID_API_KEY'];
  if (!sendgridApiKey) return;

  const fromEmail = process.env['SENDGRID_FROM_EMAIL'] ?? 'self@askalf.org';

  try {
    await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'authorization': `Bearer ${sendgridApiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: user.email }] }],
        from: { email: fromEmail, name: 'SELF AI' },
        subject: params.subject,
        content: [{ type: 'text/plain', value: params.body }],
      }),
    });
  } catch (err) {
    console.error('[SELF Notifications] Failed to send email:', err);
  }
}

/**
 * Get count of connected WebSocket clients
 */
export function getWSClientCount(): number {
  let count = 0;
  for (const clients of wsClients.values()) {
    count += clients.size;
  }
  return count;
}
