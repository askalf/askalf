import { useState, useCallback, useMemo } from 'react';
import { usePolling } from '../../hooks/usePolling';
import './OverviewTab.css';

// ── Types ──

interface ForgeEvent {
  category: string;
  type: string;
  data?: unknown;
  receivedAt: number;
  agentId?: string;
  agentName?: string;
  [key: string]: unknown;
}

interface OverviewTabProps {
  wsEvents: ForgeEvent[];
  onNavigate?: (tab: string) => void;
}

interface HealthCheck {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  value?: string | number;
  message?: string;
}

interface HealthData {
  status?: 'HEALTHY' | 'DEGRADED' | 'DOWN';
  overall?: 'healthy' | 'degraded' | 'critical';
  checks: HealthCheck[];
}

interface MetricsData {
  agents?: { total?: number; running?: number; tasks_today?: number };
  tickets?: { open?: number };
}

interface FleetStatsData {
  total?: number;
}

interface LeaderboardEntry {
  agentId: string;
  agentName?: string;
  successRate: number;
  totalCost: number;
  tasksCompleted?: number;
  tasksFailed?: number;
}

interface ExecutionEntry {
  id: string;
  agent_name?: string;
  agent_id?: string;
  status: 'completed' | 'failed' | 'running' | string;
  duration_ms?: number | null;
  cost?: number;
  started_at: string;
}

interface CostBucket {
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalEvents: number;
}

interface DailyCostEntry {
  date: string;
  totalCost: number;
  eventCount: number;
}

interface CostData {
  summary: { total: CostBucket; api: CostBucket; cli: CostBucket & { estimatedCost?: number } };
  dailyCosts: DailyCostEntry[];
}

// ── Helpers ──

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function formatDuration(ms?: number): string {
  if (ms == null) return '--';
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

function formatCost(c?: number): string {
  if (c == null) return '--';
  return `$${c.toFixed(2)}`;
}

function summarizeEvent(event: ForgeEvent): string {
  const agent = event.agentName || event.agentId || 'System';
  const cat = event.category || 'event';
  const verb = event.type || 'unknown';
  if (event.data && typeof event.data === 'object') {
    const d = event.data as Record<string, unknown>;
    if (typeof d.message === 'string') return d.message;
    if (typeof d.task === 'string') return `${cat} ${verb}: ${d.task}`;
  }
  return `${agent} -- ${cat} ${verb}`;
}

function eventTypeIcon(type: string): string {
  switch (type) {
    case 'completed': return '\u2713';
    case 'failed': return '\u2717';
    case 'started': return '\u25B6';
    case 'progress': return '\u25CF';
    default: return '\u25CB';
  }
}

function eventTypeClass(type: string): string {
  switch (type) {
    case 'completed': return 'overview-evt-completed';
    case 'failed': return 'overview-evt-failed';
    case 'started': return 'overview-evt-started';
    case 'progress': return 'overview-evt-progress';
    default: return 'overview-evt-default';
  }
}

async function apiFetch<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// ── Sub-components ──

const PILL_LABELS: Record<string, string> = {
  execution_failure_rate: 'Failures',
  stuck_executions: 'Stuck',
  hourly_cost: 'Cost/hr',
  agents_in_error: 'Errors',
  memory_activity: 'Memory',
  pending_interventions: 'Pending',
};

function HealthBar({ health }: { health: HealthData | null }) {
  const raw = health?.status?.toLowerCase() ?? health?.overall ?? null;
  const statusClass = !raw
    ? 'unknown'
    : raw === 'healthy'
      ? 'healthy'
      : raw === 'degraded'
        ? 'degraded'
        : 'down';

  const statusLabel = raw?.toUpperCase() ?? 'LOADING';

  return (
    <div className="overview-health-bar">
      <div className={`overview-health-status ${statusClass}`}>
        <span className="overview-health-dot" />
        <span className="overview-health-label">{statusLabel}</span>
      </div>
      <div className="overview-health-checks">
        {health?.checks?.map((c) => (
          <span
            key={c.name}
            className={`overview-health-pill ${c.status}`}
            title={c.message || `${c.name}: ${c.value}`}
          >
            <span className="overview-pill-name">{PILL_LABELS[c.name] ?? c.name}</span>
            <span className="overview-pill-value">{c.value ?? c.status}</span>
          </span>
        )) ?? (
          <span className="overview-health-pill unknown">
            <span className="overview-pill-name">Loading</span>
          </span>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  color,
  onClick,
}: {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
  onClick?: () => void;
}) {
  return (
    <button
      className="overview-stat-card"
      onClick={onClick}
      type="button"
      aria-label={`Navigate to ${label}`}
    >
      <div className={`overview-stat-value ${color ?? ''}`}>{value}</div>
      <div className="overview-stat-label">{label}</div>
      {sub && <div className="overview-stat-sub">{sub}</div>}
    </button>
  );
}

function LiveStream({
  events,
  onNavigate,
}: {
  events: ForgeEvent[];
  onNavigate?: (tab: string) => void;
}) {
  const recent = useMemo(() => events.slice(-15).reverse(), [events]);
  return (
    <div className="overview-panel overview-live-stream">
      <div className="overview-panel-header">
        <span className="overview-section-title">Live Event Stream</span>
        <button
          className="overview-panel-link"
          onClick={() => onNavigate?.('live')}
          type="button"
        >
          View All &rarr;
        </button>
      </div>
      <div className="overview-panel-body overview-stream-list">
        {recent.length === 0 && (
          <div className="overview-empty">No events yet</div>
        )}
        {recent.map((ev, i) => (
          <div
            key={`${ev.receivedAt}-${i}`}
            className="overview-stream-row"
            onClick={() => onNavigate?.('live')}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && onNavigate?.('live')}
          >
            <span className="overview-stream-time">{formatTime(ev.receivedAt)}</span>
            <span className={`overview-stream-dot ${eventTypeClass(ev.type)}`} />
            <span className={`overview-stream-icon ${eventTypeClass(ev.type)}`}>
              {eventTypeIcon(ev.type)}
            </span>
            <span className="overview-stream-msg" title={summarizeEvent(ev)}>
              {summarizeEvent(ev)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Leaderboard({
  entries,
  onNavigate,
}: {
  entries: LeaderboardEntry[];
  onNavigate?: (tab: string) => void;
}) {
  return (
    <div className="overview-panel overview-leaderboard">
      <div className="overview-panel-header">
        <span className="overview-section-title">Fleet Leaderboard</span>
        <button
          className="overview-panel-link"
          onClick={() => onNavigate?.('fleet')}
          type="button"
        >
          Fleet &rarr;
        </button>
      </div>
      <div className="overview-panel-body">
        {entries.length === 0 && (
          <div className="overview-empty">No data</div>
        )}
        {entries.length > 0 && (
          <table className="overview-lb-table">
            <thead>
              <tr>
                <th>Agent</th>
                <th>Success</th>
                <th>Cost</th>
                <th>Tasks</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const rateClass =
                  e.successRate > 90 ? 'green' : e.successRate > 70 ? 'yellow' : 'red';
                return (
                  <tr
                    key={e.agentId}
                    onClick={() => onNavigate?.('fleet')}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(ev) => ev.key === 'Enter' && onNavigate?.('fleet')}
                  >
                    <td className="overview-lb-agent">
                      {e.agentName || e.agentId}
                    </td>
                    <td className={`overview-lb-rate ${rateClass}`}>
                      {e.successRate.toFixed(1)}%
                    </td>
                    <td className="overview-lb-cost">{formatCost(e.totalCost)}</td>
                    <td className="overview-lb-tasks">
                      {(e.tasksCompleted ?? 0) + (e.tasksFailed ?? 0)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function RecentExecutions({
  executions,
  onNavigate,
}: {
  executions: ExecutionEntry[];
  onNavigate?: (tab: string) => void;
}) {
  const statusIcon = (s: string) => {
    switch (s) {
      case 'completed': return '\u2713';
      case 'failed': return '\u2717';
      case 'running': return '\u25B6';
      default: return '\u25CB';
    }
  };
  const statusClass = (s: string) => {
    switch (s) {
      case 'completed': return 'green';
      case 'failed': return 'red';
      case 'running': return 'blue';
      default: return '';
    }
  };

  return (
    <div className="overview-panel overview-executions">
      <div className="overview-panel-header">
        <span className="overview-section-title">Recent Executions</span>
        <button
          className="overview-panel-link"
          onClick={() => onNavigate?.('ops')}
          type="button"
        >
          History &rarr;
        </button>
      </div>
      <div className="overview-panel-body overview-exec-list">
        {executions.length === 0 && (
          <div className="overview-empty">No recent executions</div>
        )}
        {executions.map((ex) => (
          <div key={ex.id} className="overview-exec-row">
            <span className={`overview-exec-status ${statusClass(ex.status)}`}>
              {statusIcon(ex.status)}
            </span>
            <span className="overview-exec-agent">
              {ex.agent_name || ex.agent_id || 'Unknown'}
            </span>
            <span className="overview-exec-dur">{formatDuration(ex.duration_ms ?? undefined)}</span>
            <span className="overview-exec-cost">{formatCost(ex.cost)}</span>
            <span className="overview-exec-time">{timeAgo(ex.started_at)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function CostSnapshot({ costData }: { costData: CostData | null }) {
  const daily = costData?.dailyCosts ?? [];
  // API returns daily costs in DESC order — first entry is today
  const todayStr = new Date().toISOString().split('T')[0];
  const todayEntry = daily.find((d) => d.date === todayStr);
  const today = todayEntry?.totalCost ?? (daily.length > 0 ? daily[0]?.totalCost ?? 0 : 0);
  const weekTotal = daily.reduce((sum, d) => sum + d.totalCost, 0);

  // Token totals from summary
  const totalTokens = costData
    ? (costData.summary.total.totalInputTokens ?? 0) + (costData.summary.total.totalOutputTokens ?? 0)
    : 0;

  // Display in chronological order (reverse DESC)
  const chronoDaily = useMemo(() => [...daily].reverse(), [daily]);
  const maxDaily = useMemo(() => {
    if (!chronoDaily.length) return 1;
    return Math.max(...chronoDaily.map((d) => d.totalCost), 1);
  }, [chronoDaily]);

  return (
    <div className="overview-panel overview-cost-snapshot">
      <div className="overview-panel-header">
        <span className="overview-section-title">Cost Snapshot</span>
      </div>
      <div className="overview-panel-body">
        {!costData ? (
          <div className="overview-empty">Loading costs...</div>
        ) : (
          <>
            <div className="overview-cost-totals">
              <div className="overview-cost-total-item">
                <span className="overview-cost-amount">
                  {formatCost(today)}
                </span>
                <span className="overview-cost-period">Today</span>
              </div>
              <div className="overview-cost-total-item">
                <span className="overview-cost-amount">
                  {formatCost(weekTotal)}
                </span>
                <span className="overview-cost-period">7-Day</span>
              </div>
              <div className="overview-cost-total-item">
                <span className="overview-cost-amount">
                  {formatTokens(totalTokens)}
                </span>
                <span className="overview-cost-period">Tokens</span>
              </div>
            </div>
            <div className="overview-cost-totals" style={{ marginTop: '8px' }}>
              <div className="overview-cost-total-item">
                <span className="overview-cost-amount" style={{ fontSize: '14px' }}>
                  {formatCost(costData.summary.api.totalCost)}
                </span>
                <span className="overview-cost-period">API</span>
              </div>
              <div className="overview-cost-total-item">
                <span className="overview-cost-amount" style={{ fontSize: '14px' }}>
                  {formatCost(costData.summary.cli.totalCost)}
                </span>
                <span className="overview-cost-period">CLI</span>
              </div>
            </div>
            {chronoDaily.length > 0 && (
              <div className="overview-cost-chart">
                {chronoDaily.slice(-7).map((d) => (
                  <div key={d.date} className="overview-cost-bar-col">
                    <div
                      className="overview-cost-bar"
                      style={{ height: `${(d.totalCost / maxDaily) * 100}%` }}
                      title={`${d.date}: ${formatCost(d.totalCost)}`}
                    />
                    <span className="overview-cost-bar-label">
                      {d.date.slice(-5)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Main Component ──

export default function OverviewTab({ wsEvents, onNavigate }: OverviewTabProps) {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [metrics, setMetrics] = useState<MetricsData | null>(null);
  const [fleetStats, setFleetStats] = useState<FleetStatsData | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [executions, setExecutions] = useState<ExecutionEntry[]>([]);
  const [costData, setCostData] = useState<CostData | null>(null);

  const fetchAll = useCallback(async () => {
    const [h, m, fs, lb, ex, c] = await Promise.all([
      apiFetch<HealthData>('/api/v1/admin/monitoring/health'),
      apiFetch<MetricsData>('/api/v1/admin/reports/metrics'),
      apiFetch<FleetStatsData>('/api/v1/forge/fleet/stats'),
      apiFetch<LeaderboardEntry[]>('/api/v1/admin/fleet/leaderboard'),
      apiFetch<{ executions: ExecutionEntry[] }>('/api/v1/admin/executions/timeline?hours=24'),
      apiFetch<CostData>('/api/v1/admin/costs?days=7'),
    ]);
    if (h) setHealth(h);
    if (m) setMetrics(m);
    if (fs) setFleetStats(fs);
    if (lb) setLeaderboard(lb);
    if (ex) setExecutions(Array.isArray(ex.executions) ? ex.executions.slice(0, 10) : []);
    if (c) setCostData(c);
  }, []);

  usePolling(fetchAll, 30000);

  const activeAgents = metrics?.agents?.running ?? 0;
  const totalAgents = metrics?.agents?.total ?? 0;
  const execToday = metrics?.agents?.tasks_today ?? 0;
  const openTickets = metrics?.tickets?.open ?? 0;
  const memoryCount = fleetStats?.total ?? 0;

  return (
    <div className="overview-tab">
      {/* Row 1: Health Bar */}
      <HealthBar health={health} />

      {/* Row 2: Stat Cards */}
      <div className="overview-stats-row">
        <StatCard
          label="Active Agents"
          value={activeAgents}
          sub={`${totalAgents} total`}
          color="green"
          onClick={() => onNavigate?.('fleet')}
        />
        <StatCard
          label="Executions (24h)"
          value={execToday}
          color="violet"
          onClick={() => onNavigate?.('ops')}
        />
        <StatCard
          label="Open Tickets"
          value={openTickets}
          color={openTickets > 0 ? 'amber' : ''}
          onClick={() => onNavigate?.('ops')}
        />
        <StatCard
          label="Memory"
          value={memoryCount}
          color="crystal"
          onClick={() => onNavigate?.('brain')}
        />
      </div>

      {/* Row 3: Live Stream + Leaderboard */}
      <div className="overview-two-col">
        <LiveStream events={wsEvents} onNavigate={onNavigate} />
        <Leaderboard entries={leaderboard} onNavigate={onNavigate} />
      </div>

      {/* Row 4: Executions + Cost */}
      <div className="overview-two-col">
        <RecentExecutions executions={executions} onNavigate={onNavigate} />
        <CostSnapshot costData={costData} />
      </div>
    </div>
  );
}
