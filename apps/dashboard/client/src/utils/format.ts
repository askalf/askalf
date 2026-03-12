/**
 * Shared formatting utilities — single source of truth.
 * Replaces 37+ duplicate implementations across the dashboard.
 */

/** Format cost with dollar sign. Adaptive precision: $0.0012 for small, $1.23 for larger. */
export function formatCost(cost?: number | null): string {
  if (cost == null) return '-';
  if (cost === 0) return '$0';
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

/** Format cost with 4 decimal places always (for tables/detail views). */
export function formatCostPrecise(cost?: number | null): string {
  if (cost == null) return '-';
  return `$${cost.toFixed(4)}`;
}

/** Format duration from milliseconds. */
export function formatDuration(ms?: number | null): string {
  if (ms == null || ms <= 0) return '-';
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

/** Format duration from two ISO timestamps. */
export function formatDurationBetween(start: string | null, end: string | null): string {
  if (!start) return '-';
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  return formatDuration(e - s);
}

/** Format duration from seconds. */
export function formatDurationSeconds(seconds?: number | null): string {
  if (!seconds) return '-';
  return formatDuration(seconds * 1000);
}

/** Format token count with K/M abbreviation. */
export function formatTokens(tokens?: number | null): string {
  if (!tokens) return '-';
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return String(tokens);
}

/** Format any large number with K/M abbreviation. */
export function formatCount(n?: number | null, decimals = 0): string {
  if (n == null) return '-';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toFixed(decimals);
}

/** Relative time string from ISO date. */
export function relativeTime(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

/** Format ISO date as short date+time: "Mar 12, 14:30". */
export function formatDate(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Format ISO date with seconds: "Mar 12, 14:30:05". */
export function formatDateFull(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** Format timestamp (epoch ms) as HH:MM:SS. */
export function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** Format time as HH:MM. */
export function formatTime(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/** Today's date as YYYY-MM-DD. */
export function todayDateStr(): string {
  return new Date().toISOString().split('T')[0];
}
