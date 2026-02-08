/**
 * Gmail Integration
 * Provides email capabilities to SELF via Google Gmail API.
 * Implements MCP-compatible tool interface.
 */

import { query, queryOne } from '../database.js';

// ============================================
// OAuth Configuration
// ============================================

const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify',
];

export interface GmailCredentials {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expiry_date: number;
}

export interface EmailMessage {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  snippet: string;
  body: string;
  date: string;
  labels: string[];
  isUnread: boolean;
}

export interface EmailDraft {
  to: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
  replyTo?: string;
}

// ============================================
// OAuth Flow
// ============================================

/**
 * Generate OAuth authorization URL for Gmail
 */
export function getAuthUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const { clientId, redirectUri, state } = params;
  const scopes = GMAIL_SCOPES.join(' ');
  return `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scopes)}&access_type=offline&prompt=consent&state=${state}`;
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCode(params: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<GmailCredentials> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: params.code,
      client_id: params.clientId,
      client_secret: params.clientSecret,
      redirect_uri: params.redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!response.ok) {
    throw new Error(`OAuth token exchange failed: ${response.status}`);
  }

  const data = await response.json() as {
    access_token: string;
    refresh_token: string;
    token_type: string;
    expires_in: number;
  };

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    token_type: data.token_type,
    expiry_date: Date.now() + data.expires_in * 1000,
  };
}

/**
 * Refresh an expired access token
 */
export async function refreshToken(params: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}): Promise<GmailCredentials> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: params.refreshToken,
      client_id: params.clientId,
      client_secret: params.clientSecret,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    throw new Error(`Token refresh failed: ${response.status}`);
  }

  const data = await response.json() as {
    access_token: string;
    token_type: string;
    expires_in: number;
  };

  return {
    access_token: data.access_token,
    refresh_token: params.refreshToken,
    token_type: data.token_type,
    expiry_date: Date.now() + data.expires_in * 1000,
  };
}

// ============================================
// Gmail API Operations
// ============================================

async function gmailFetch(
  endpoint: string,
  credentials: GmailCredentials,
  options: RequestInit = {},
): Promise<unknown> {
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${endpoint}`, {
    ...options,
    headers: {
      'authorization': `Bearer ${credentials.access_token}`,
      'content-type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Gmail API error: ${response.status} ${error}`);
  }

  return response.json();
}

/**
 * List recent emails
 */
export async function listEmails(
  credentials: GmailCredentials,
  params: { maxResults?: number; query?: string; labelIds?: string[] } = {},
): Promise<EmailMessage[]> {
  const queryParams = new URLSearchParams();
  if (params.maxResults) queryParams.set('maxResults', String(params.maxResults));
  if (params.query) queryParams.set('q', params.query);
  if (params.labelIds) queryParams.set('labelIds', params.labelIds.join(','));

  const listData = await gmailFetch(
    `messages?${queryParams.toString()}`,
    credentials,
  ) as { messages?: Array<{ id: string; threadId: string }> };

  if (!listData.messages || listData.messages.length === 0) {
    return [];
  }

  // Fetch full message details (batch up to 10)
  const messages: EmailMessage[] = [];
  const batch = listData.messages.slice(0, params.maxResults ?? 10);

  for (const msg of batch) {
    try {
      const detail = await gmailFetch(
        `messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
        credentials,
      ) as {
        id: string;
        threadId: string;
        snippet: string;
        labelIds: string[];
        payload: {
          headers: Array<{ name: string; value: string }>;
        };
      };

      const headers = detail.payload.headers;
      const getHeader = (name: string) =>
        headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';

      messages.push({
        id: detail.id,
        threadId: detail.threadId,
        from: getHeader('From'),
        to: getHeader('To'),
        subject: getHeader('Subject'),
        snippet: detail.snippet,
        body: detail.snippet, // Full body requires format=full
        date: getHeader('Date'),
        labels: detail.labelIds ?? [],
        isUnread: (detail.labelIds ?? []).includes('UNREAD'),
      });
    } catch {
      // Skip individual message failures
    }
  }

  return messages;
}

/**
 * Get unread email count
 */
export async function getUnreadCount(credentials: GmailCredentials): Promise<number> {
  const data = await gmailFetch(
    'labels/UNREAD',
    credentials,
  ) as { messagesUnread?: number };

  return data.messagesUnread ?? 0;
}

/**
 * Send an email
 */
export async function sendEmail(
  credentials: GmailCredentials,
  draft: EmailDraft,
): Promise<{ id: string; threadId: string }> {
  // Build RFC 2822 email
  const headers = [
    `To: ${draft.to}`,
    `Subject: ${draft.subject}`,
    'Content-Type: text/plain; charset=utf-8',
    'MIME-Version: 1.0',
  ];
  if (draft.cc) headers.push(`Cc: ${draft.cc}`);
  if (draft.bcc) headers.push(`Bcc: ${draft.bcc}`);

  const rawEmail = `${headers.join('\r\n')}\r\n\r\n${draft.body}`;
  const encoded = Buffer.from(rawEmail).toString('base64url');

  const result = await gmailFetch('messages/send', credentials, {
    method: 'POST',
    body: JSON.stringify({ raw: encoded }),
  }) as { id: string; threadId: string };

  return result;
}

/**
 * Mark email as read
 */
export async function markAsRead(
  credentials: GmailCredentials,
  messageId: string,
): Promise<void> {
  await gmailFetch(`messages/${messageId}/modify`, credentials, {
    method: 'POST',
    body: JSON.stringify({ removeLabelIds: ['UNREAD'] }),
  });
}

// ============================================
// Tool Definitions (MCP-compatible)
// ============================================

export const GMAIL_TOOLS = [
  {
    name: 'gmail_list_emails',
    description: 'List recent emails from the user\'s inbox',
    inputSchema: {
      type: 'object',
      properties: {
        max_results: { type: 'number', description: 'Maximum emails to return (default 10)' },
        query: { type: 'string', description: 'Gmail search query (e.g. "is:unread", "from:alice@example.com")' },
      },
    },
  },
  {
    name: 'gmail_get_unread_count',
    description: 'Get the number of unread emails',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'gmail_send_email',
    description: 'Send an email on behalf of the user',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient email address' },
        subject: { type: 'string', description: 'Email subject' },
        body: { type: 'string', description: 'Email body (plain text)' },
        cc: { type: 'string', description: 'CC recipients (optional)' },
      },
      required: ['to', 'subject', 'body'],
    },
  },
  {
    name: 'gmail_mark_read',
    description: 'Mark an email as read',
    inputSchema: {
      type: 'object',
      properties: {
        message_id: { type: 'string', description: 'Gmail message ID' },
      },
      required: ['message_id'],
    },
  },
];
