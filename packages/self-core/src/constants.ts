// SELF AI: Constants and Defaults

// ============================================
// AUTONOMY LEVELS
// ============================================

export const AUTONOMY_LEVELS = {
  ASK_EVERYTHING: 1,
  ASK_IMPORTANT: 2,
  BALANCED: 3,
  MOSTLY_AUTO: 4,
  FULL_AUTO: 5,
} as const;

export const AUTONOMY_LABELS: Record<number, string> = {
  1: 'Ask Everything',
  2: 'Ask Important',
  3: 'Balanced',
  4: 'Mostly Autonomous',
  5: 'Fully Autonomous',
};

// ============================================
// RISK SCORES
// ============================================

export const ACTION_RISK_SCORES: Record<string, number> = {
  web_search: 1,
  memory_store: 1,
  memory_recall: 1,
  web_browse: 2,
  read_email: 2,
  read_calendar: 2,
  read_file: 2,
  summarize: 2,
  draft_email: 4,
  create_task: 4,
  create_event: 5,
  update_event: 5,
  api_call: 6,
  send_email: 7,
  delete_event: 7,
  code_exec: 8,
  send_message: 8,
  financial_action: 9,
  delete_data: 10,
};

/**
 * Decision matrix: should SELF act or ask?
 * Returns true if SELF should act autonomously.
 */
export function shouldActAutonomously(
  autonomyLevel: number,
  riskScore: number,
): boolean {
  if (autonomyLevel === 5) return true;
  if (autonomyLevel === 1) return false;

  // autonomy 2: act on risk 1-3
  // autonomy 3: act on risk 1-6
  // autonomy 4: act on risk 1-8
  const thresholds: Record<number, number> = {
    2: 3,
    3: 6,
    4: 8,
  };

  const threshold = thresholds[autonomyLevel];
  if (threshold === undefined) return false;
  return riskScore <= threshold;
}

// ============================================
// HEARTBEAT DEFAULTS
// ============================================

export const HEARTBEAT_INTERVALS = {
  ACTIVE: 300_000,    // 5 minutes
  IDLE: 1_800_000,    // 30 minutes
  SLEEPING: 3_600_000, // 60 minutes
} as const;

export const DEFAULT_HEARTBEAT_INTERVAL_MS = HEARTBEAT_INTERVALS.ACTIVE;

// ============================================
// BUDGET DEFAULTS
// ============================================

export const DEFAULT_DAILY_BUDGET_USD = 1.00;
export const DEFAULT_MONTHLY_BUDGET_USD = 20.00;

// ============================================
// SELF SYSTEM PROMPT
// ============================================

export const SELF_SYSTEM_PROMPT = `You are SELF — a personal AI that works for the user 24/7. You are not a generic chatbot. You are THEIR AI.

Core behaviors:
- Be direct and conversational, not corporate or robotic
- Remember everything they tell you — preferences, names, context
- When asked to do something, DO it (or explain why you need approval first)
- Proactively notice things that matter to them
- Reference past conversations naturally: "Last time you mentioned..."
- Adapt your communication style to match theirs over time

You have access to tools for email, calendar, web search, and more. Use them.
When you take an action, briefly confirm what you did. Don't over-explain.

If you're unsure about something risky, ask first. Otherwise, just handle it.`;

export const SELF_DEFAULT_NAME = 'SELF';

// ============================================
// AVAILABLE INTEGRATIONS CATALOG
// ============================================

export interface IntegrationCatalogEntry {
  provider: string;
  display_name: string;
  description: string;
  auth_type: 'oauth2' | 'api_key' | 'basic' | 'none';
  icon: string;
  available: boolean;
}

export const INTEGRATION_CATALOG: IntegrationCatalogEntry[] = [
  {
    provider: 'gmail',
    display_name: 'Gmail',
    description: 'Read, send, and manage emails',
    auth_type: 'oauth2',
    icon: 'mail',
    available: false, // Phase 2
  },
  {
    provider: 'google_calendar',
    display_name: 'Google Calendar',
    description: 'View and manage calendar events',
    auth_type: 'oauth2',
    icon: 'calendar',
    available: false,
  },
  {
    provider: 'slack',
    display_name: 'Slack',
    description: 'Read and send messages in Slack',
    auth_type: 'oauth2',
    icon: 'message-square',
    available: false,
  },
  {
    provider: 'github',
    display_name: 'GitHub',
    description: 'Manage repositories, issues, and PRs',
    auth_type: 'oauth2',
    icon: 'git-branch',
    available: false,
  },
  {
    provider: 'notion',
    display_name: 'Notion',
    description: 'Read and update Notion pages and databases',
    auth_type: 'oauth2',
    icon: 'file-text',
    available: false,
  },
];
