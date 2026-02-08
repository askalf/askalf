/**
 * Integration Registry
 * Routes tool calls to the appropriate integration handler.
 */

import { query, queryOne } from '../database.js';
import * as gmail from './gmail.js';
import * as gcal from './google-calendar.js';

// ============================================
// Types
// ============================================

export interface IntegrationCredentials {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expiry_date: number;
}

interface IntegrationRow {
  id: string;
  provider: string;
  credentials: IntegrationCredentials;
  status: string;
}

// ============================================
// Tool Execution
// ============================================

/**
 * Execute a tool call for a specific integration
 */
export async function executeIntegrationTool(
  integrationId: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ result: unknown; error?: string }> {
  // Load integration credentials
  const integration = await queryOne<IntegrationRow>(
    `SELECT id, provider, credentials, status
     FROM self_integrations
     WHERE id = $1 AND status = 'connected'`,
    [integrationId],
  );

  if (!integration) {
    return { result: null, error: 'Integration not found or not connected' };
  }

  const creds = integration.credentials;

  try {
    switch (integration.provider) {
      case 'gmail':
        return { result: await executeGmailTool(toolName, args, creds) };
      case 'google_calendar':
        return { result: await executeCalendarTool(toolName, args, creds) };
      default:
        return { result: null, error: `Unknown provider: ${integration.provider}` };
    }
  } catch (err) {
    return {
      result: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function executeGmailTool(
  toolName: string,
  args: Record<string, unknown>,
  creds: IntegrationCredentials,
): Promise<unknown> {
  switch (toolName) {
    case 'gmail_list_emails': {
      const listParams: { maxResults?: number; query?: string } = {};
      if (args['max_results'] != null) listParams.maxResults = args['max_results'] as number;
      if (args['query'] != null) listParams.query = args['query'] as string;
      return gmail.listEmails(creds, listParams);
    }

    case 'gmail_get_unread_count':
      return { unread_count: await gmail.getUnreadCount(creds) };

    case 'gmail_send_email': {
      const draft: gmail.EmailDraft = {
        to: args['to'] as string,
        subject: args['subject'] as string,
        body: args['body'] as string,
      };
      if (args['cc'] != null) draft.cc = args['cc'] as string;
      return gmail.sendEmail(creds, draft);
    }

    case 'gmail_mark_read':
      await gmail.markAsRead(creds, args['message_id'] as string);
      return { success: true };

    default:
      throw new Error(`Unknown Gmail tool: ${toolName}`);
  }
}

async function executeCalendarTool(
  toolName: string,
  args: Record<string, unknown>,
  creds: IntegrationCredentials,
): Promise<unknown> {
  switch (toolName) {
    case 'calendar_list_events': {
      const calParams: { timeMin?: string; timeMax?: string; maxResults?: number } = {};
      if (args['time_min'] != null) calParams.timeMin = args['time_min'] as string;
      if (args['time_max'] != null) calParams.timeMax = args['time_max'] as string;
      if (args['max_results'] != null) calParams.maxResults = args['max_results'] as number;
      return gcal.listEvents(creds, calParams);
    }

    case 'calendar_today':
      return gcal.getTodayEvents(creds);

    case 'calendar_create_event': {
      const eventParams: gcal.CreateEventParams = {
        summary: args['summary'] as string,
        start: args['start'] as string,
        end: args['end'] as string,
      };
      if (args['description'] != null) eventParams.description = args['description'] as string;
      if (args['location'] != null) eventParams.location = args['location'] as string;
      if (args['attendees'] != null) eventParams.attendees = args['attendees'] as string[];
      return gcal.createEvent(creds, eventParams);
    }

    case 'calendar_check_conflicts':
      return gcal.checkConflicts(
        creds,
        args['start'] as string,
        args['end'] as string,
      );

    case 'calendar_delete_event':
      await gcal.deleteEvent(creds, args['event_id'] as string);
      return { success: true };

    default:
      throw new Error(`Unknown Calendar tool: ${toolName}`);
  }
}

/**
 * Get all available tool definitions for connected integrations
 */
export function getToolDefinitions(provider: string): Array<{
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}> {
  switch (provider) {
    case 'gmail':
      return gmail.GMAIL_TOOLS;
    case 'google_calendar':
      return gcal.CALENDAR_TOOLS;
    default:
      return [];
  }
}

/**
 * Get risk score for an integration tool
 */
export function getToolRiskScore(toolName: string): number {
  const scores: Record<string, number> = {
    gmail_list_emails: 2,
    gmail_get_unread_count: 1,
    gmail_send_email: 7,
    gmail_mark_read: 3,
    calendar_list_events: 2,
    calendar_today: 1,
    calendar_create_event: 5,
    calendar_check_conflicts: 1,
    calendar_delete_event: 7,
  };
  return scores[toolName] ?? 5;
}
