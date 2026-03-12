/**
 * Shared status colors and types — single source of truth.
 * Replaces 5+ duplicate STATUS_COLORS definitions.
 */

/** Canonical status color map — covers agent, task, ticket, finding, coordination statuses. */
export const STATUS_COLORS: Record<string, string> = {
  // Agent statuses
  idle: '#6b7280',
  running: '#3b82f6',
  paused: '#f59e0b',
  error: '#ef4444',
  decommissioned: '#6b7280',
  // Task/execution statuses
  pending: '#6b7280',
  in_progress: '#f59e0b',
  completed: '#10b981',
  failed: '#ef4444',
  cancelled: '#6b7280',
  timeout: '#f97316',
  scheduled: '#f59e0b',
  // Ticket statuses
  open: '#3b82f6',
  resolved: '#10b981',
  closed: '#6b7280',
  // Intervention statuses
  approved: '#10b981',
  denied: '#ef4444',
  // Coordination statuses
  active: '#3b82f6',
  planning: '#60a5fa',
  executing: '#3b82f6',
  // Priority/severity
  low: '#6b7280',
  medium: '#f59e0b',
  high: '#ef4444',
  urgent: '#dc2626',
  info: '#3b82f6',
  warning: '#f59e0b',
  critical: '#ef4444',
};

/** Status with background color for badges/pills. */
export function statusStyle(status: string): { color: string; bg: string } {
  const color = STATUS_COLORS[status] ?? '#6b7280';
  return { color, bg: `${color}1f` }; // 12% opacity
}

/** Canonical ForgeEvent type — use this everywhere instead of local redefinitions. */
export interface ForgeEvent {
  category: string;
  type: string;
  event?: string;
  data?: unknown;
  receivedAt: number;
  agentId?: string;
  agentName?: string;
  sessionId?: string;
  taskId?: string;
  status?: string;
  service?: string;
  [key: string]: unknown;
}
