/**
 * Google Calendar Integration
 * Provides calendar capabilities to SELF via Google Calendar API.
 */

// ============================================
// OAuth Configuration
// ============================================

const CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
];

export interface CalendarCredentials {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expiry_date: number;
}

export interface CalendarEvent {
  id: string;
  summary: string;
  description: string | null;
  location: string | null;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  attendees: Array<{ email: string; displayName?: string; responseStatus: string }>;
  status: string;
  htmlLink: string;
  organizer: { email: string; displayName?: string };
  created: string;
  updated: string;
}

export interface CreateEventParams {
  summary: string;
  description?: string;
  location?: string;
  start: string; // ISO 8601
  end: string;   // ISO 8601
  timeZone?: string;
  attendees?: string[]; // email addresses
}

// ============================================
// OAuth Flow
// ============================================

export function getAuthUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const scopes = CALENDAR_SCOPES.join(' ');
  return `https://accounts.google.com/o/oauth2/v2/auth?client_id=${params.clientId}&redirect_uri=${encodeURIComponent(params.redirectUri)}&response_type=code&scope=${encodeURIComponent(scopes)}&access_type=offline&prompt=consent&state=${params.state}`;
}

export async function exchangeCode(params: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<CalendarCredentials> {
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

export async function refreshToken(params: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}): Promise<CalendarCredentials> {
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
// Calendar API Operations
// ============================================

async function calendarFetch(
  endpoint: string,
  credentials: CalendarCredentials,
  options: RequestInit = {},
): Promise<unknown> {
  const response = await fetch(`https://www.googleapis.com/calendar/v3/${endpoint}`, {
    ...options,
    headers: {
      'authorization': `Bearer ${credentials.access_token}`,
      'content-type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Calendar API error: ${response.status} ${error}`);
  }

  return response.json();
}

/**
 * List upcoming events
 */
export async function listEvents(
  credentials: CalendarCredentials,
  params: {
    timeMin?: string;
    timeMax?: string;
    maxResults?: number;
    calendarId?: string;
  } = {},
): Promise<CalendarEvent[]> {
  const queryParams = new URLSearchParams({
    orderBy: 'startTime',
    singleEvents: 'true',
    timeMin: params.timeMin ?? new Date().toISOString(),
    maxResults: String(params.maxResults ?? 10),
  });
  if (params.timeMax) queryParams.set('timeMax', params.timeMax);

  const calendarId = encodeURIComponent(params.calendarId ?? 'primary');

  const data = await calendarFetch(
    `calendars/${calendarId}/events?${queryParams.toString()}`,
    credentials,
  ) as { items?: CalendarEvent[] };

  return data.items ?? [];
}

/**
 * Get today's events
 */
export async function getTodayEvents(credentials: CalendarCredentials): Promise<CalendarEvent[]> {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

  return listEvents(credentials, {
    timeMin: startOfDay.toISOString(),
    timeMax: endOfDay.toISOString(),
    maxResults: 50,
  });
}

/**
 * Create a new event
 */
export async function createEvent(
  credentials: CalendarCredentials,
  params: CreateEventParams,
): Promise<CalendarEvent> {
  const body: Record<string, unknown> = {
    summary: params.summary,
    start: { dateTime: params.start, timeZone: params.timeZone ?? 'UTC' },
    end: { dateTime: params.end, timeZone: params.timeZone ?? 'UTC' },
  };

  if (params.description) body['description'] = params.description;
  if (params.location) body['location'] = params.location;
  if (params.attendees) {
    body['attendees'] = params.attendees.map(email => ({ email }));
  }

  return calendarFetch('calendars/primary/events', credentials, {
    method: 'POST',
    body: JSON.stringify(body),
  }) as Promise<CalendarEvent>;
}

/**
 * Delete an event
 */
export async function deleteEvent(
  credentials: CalendarCredentials,
  eventId: string,
): Promise<void> {
  await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`, {
    method: 'DELETE',
    headers: { 'authorization': `Bearer ${credentials.access_token}` },
  });
}

/**
 * Check for conflicts
 */
export async function checkConflicts(
  credentials: CalendarCredentials,
  start: string,
  end: string,
): Promise<CalendarEvent[]> {
  const events = await listEvents(credentials, {
    timeMin: start,
    timeMax: end,
    maxResults: 50,
  });

  return events.filter(e => e.status !== 'cancelled');
}

// ============================================
// Tool Definitions (MCP-compatible)
// ============================================

export const CALENDAR_TOOLS = [
  {
    name: 'calendar_list_events',
    description: 'List upcoming calendar events',
    inputSchema: {
      type: 'object',
      properties: {
        time_min: { type: 'string', description: 'Start time (ISO 8601). Defaults to now.' },
        time_max: { type: 'string', description: 'End time (ISO 8601)' },
        max_results: { type: 'number', description: 'Maximum events (default 10)' },
      },
    },
  },
  {
    name: 'calendar_today',
    description: 'Get all of today\'s calendar events',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'calendar_create_event',
    description: 'Create a new calendar event',
    inputSchema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'Event title' },
        start: { type: 'string', description: 'Start time (ISO 8601)' },
        end: { type: 'string', description: 'End time (ISO 8601)' },
        description: { type: 'string', description: 'Event description' },
        location: { type: 'string', description: 'Event location' },
        attendees: { type: 'array', items: { type: 'string' }, description: 'Attendee email addresses' },
      },
      required: ['summary', 'start', 'end'],
    },
  },
  {
    name: 'calendar_check_conflicts',
    description: 'Check for calendar conflicts in a time range',
    inputSchema: {
      type: 'object',
      properties: {
        start: { type: 'string', description: 'Start time (ISO 8601)' },
        end: { type: 'string', description: 'End time (ISO 8601)' },
      },
      required: ['start', 'end'],
    },
  },
  {
    name: 'calendar_delete_event',
    description: 'Delete a calendar event',
    inputSchema: {
      type: 'object',
      properties: {
        event_id: { type: 'string', description: 'Calendar event ID' },
      },
      required: ['event_id'],
    },
  },
];
