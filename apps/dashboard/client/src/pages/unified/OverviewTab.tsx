import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { usePolling } from '../../hooks/usePolling';
import { formatCost, formatDuration, formatTokens, formatCount, relativeTime, todayDateStr } from '../../utils/format';
import type { ForgeEvent } from '../../constants/status';
import './OverviewTab.css';

// ── Types ──

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
  uptime?: number;
}

interface MetricsData {
  agents?: { total?: number; running?: number; tasks_today?: number };
  tickets?: { open?: number };
}

interface FleetStatsData {
  total?: number;
  tiers?: { semantic?: number; episodic?: number; procedural?: number };
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

function eventTypeClass(type: string): string {
  switch (type) {
    case 'completed': return 'mc-evt-ok';
    case 'failed': return 'mc-evt-fail';
    case 'started': return 'mc-evt-start';
    case 'progress': return 'mc-evt-prog';
    default: return 'mc-evt-default';
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

// ── Clock ──

function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

// ── Heartbeat Visualizer ──

function HeartbeatLine() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    let offset = 0;

    const draw = () => {
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      // Draw heartbeat line
      ctx.beginPath();
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 1.5;
      ctx.shadowColor = '#10b981';
      ctx.shadowBlur = 4;

      const cycleWidth = 120;
      for (let x = 0; x < w + cycleWidth; x++) {
        const xPos = (x + offset) % cycleWidth;
        let y = h / 2;

        // Heartbeat spike pattern
        if (xPos > 30 && xPos < 35) {
          y = h / 2 - 8;
        } else if (xPos > 35 && xPos < 40) {
          y = h / 2 + 14;
        } else if (xPos > 40 && xPos < 48) {
          y = h / 2 - 18;
        } else if (xPos > 48 && xPos < 53) {
          y = h / 2 + 6;
        } else if (xPos > 53 && xPos < 58) {
          y = h / 2 - 4;
        }

        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

      offset = (offset - 0.8 + cycleWidth) % cycleWidth;
      animId = requestAnimationFrame(draw);
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * window.devicePixelRatio;
      canvas.height = rect.height * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
    };

    resize();
    draw();

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    return () => {
      cancelAnimationFrame(animId);
      ro.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} className="mc-heartbeat-canvas" />;
}

// ── System Status Banner ──

const PILL_LABELS: Record<string, string> = {
  execution_failure_rate: 'Failures',
  stuck_executions: 'Stuck',
  hourly_cost: 'Cost/hr',
  agents_in_error: 'Errors',
  memory_activity: 'Memory',
  pending_interventions: 'Pending',
};

function SystemBanner({
  health,
  clock,
}: {
  health: HealthData | null;
  clock: Date;
}) {
  const raw = health?.status?.toLowerCase() ?? health?.overall ?? null;
  const statusClass = !raw
    ? 'unknown'
    : raw === 'healthy'
      ? 'healthy'
      : raw === 'degraded'
        ? 'degraded'
        : 'down';

  const statusLabel = raw?.toUpperCase() ?? 'LOADING';

  const timeStr = clock.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  return (
    <div className="mc-banner">
      <div className="mc-banner-left">
        <div className={`mc-status-badge ${statusClass}`}>
          <span className="mc-status-dot" />
          <span className="mc-status-label">{statusLabel}</span>
        </div>
        <div className="mc-heartbeat-wrap">
          <HeartbeatLine />
        </div>
      </div>

      <div className="mc-banner-checks">
        {health?.checks?.map((c) => (
          <span
            key={c.name}
            className={`mc-check-pill ${c.status}`}
            title={c.message || `${c.name}: ${c.value}`}
          >
            <span className="mc-pill-name">{PILL_LABELS[c.name] ?? c.name}</span>
            <span className="mc-pill-val">{c.value ?? c.status}</span>
          </span>
        ))}
      </div>

      <div className="mc-banner-right">
        <span className="mc-clock">{timeStr}</span>
      </div>
    </div>
  );
}

// ── Stat Tile ──

function StatTile({
  label,
  value,
  sub,
  accent,
  glyph,
  onClick,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: string;
  glyph?: string;
  onClick?: () => void;
}) {
  return (
    <button className="mc-tile" onClick={onClick} type="button">
      {glyph && <span className="mc-tile-glyph">{glyph}</span>}
      <span className={`mc-tile-value ${accent ?? ''}`}>{value}</span>
      <span className="mc-tile-label">{label}</span>
      {sub && <span className="mc-tile-sub">{sub}</span>}
    </button>
  );
}

// ── Agent Ring Chart (CSS-only) ──

function AgentRing({
  running,
  total,
  onClick,
}: {
  running: number;
  total: number;
  onClick?: () => void;
}) {
  const pct = total > 0 ? (running / total) * 100 : 0;

  return (
    <button className="mc-ring-wrap" onClick={onClick} type="button">
      <svg className="mc-ring-svg" viewBox="0 0 36 36">
        <circle
          className="mc-ring-bg"
          cx="18" cy="18" r="15.9"
          fill="none"
          strokeWidth="2.5"
        />
        <circle
          className="mc-ring-fg"
          cx="18" cy="18" r="15.9"
          fill="none"
          strokeWidth="2.5"
          strokeDasharray={`${pct} ${100 - pct}`}
          strokeDashoffset="25"
          strokeLinecap="round"
        />
      </svg>
      <div className="mc-ring-center">
        <span className="mc-ring-num">{running}</span>
        <span className="mc-ring-label">/{total}</span>
      </div>
    </button>
  );
}

// ── Live Feed ──

function LiveFeed({
  events,
  onNavigate,
}: {
  events: ForgeEvent[];
  onNavigate?: (tab: string) => void;
}) {
  const recent = useMemo(() => events.slice(-20).reverse(), [events]);
  const listRef = useRef<HTMLDivElement>(null);

  return (
    <div className="mc-panel mc-feed">
      <div className="mc-panel-hdr">
        <span className="mc-panel-title">
          <span className="mc-live-dot" />
          Live Feed
        </span>
        <button className="mc-panel-link" onClick={() => onNavigate?.('live')} type="button">
          Full Stream &rarr;
        </button>
      </div>
      <div className="mc-panel-body mc-feed-list" ref={listRef}>
        {recent.length === 0 && (
          <div className="mc-empty">Waiting for events...</div>
        )}
        {recent.map((ev, i) => (
          <div
            key={`${ev.receivedAt}-${i}`}
            className={`mc-feed-row ${i === 0 ? 'mc-feed-new' : ''}`}
          >
            <span className={`mc-feed-dot ${eventTypeClass(ev.type)}`} />
            <span className="mc-feed-time">{formatTime(ev.receivedAt)}</span>
            <span className="mc-feed-msg" title={summarizeEvent(ev)}>
              {summarizeEvent(ev)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Leaderboard ──

function Leaderboard({
  entries,
  onNavigate,
}: {
  entries: LeaderboardEntry[];
  onNavigate?: (tab: string) => void;
}) {
  return (
    <div className="mc-panel mc-leaderboard">
      <div className="mc-panel-hdr">
        <span className="mc-panel-title">Fleet Leaderboard</span>
        <button className="mc-panel-link" onClick={() => onNavigate?.('fleet')} type="button">
          Fleet &rarr;
        </button>
      </div>
      <div className="mc-panel-body">
        {entries.length === 0 && <div className="mc-empty">No data</div>}
        {entries.length > 0 && (
          <table className="mc-lb-table">
            <thead>
              <tr>
                <th>Agent</th>
                <th>Rate</th>
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
                    <td className="mc-lb-agent">{e.agentName || e.agentId}</td>
                    <td className={`mc-lb-rate ${rateClass}`}>
                      {e.successRate.toFixed(0)}%
                    </td>
                    <td className="mc-lb-cost">{formatCost(e.totalCost)}</td>
                    <td className="mc-lb-tasks">
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

// ── Recent Executions ──

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
    <div className="mc-panel mc-executions">
      <div className="mc-panel-hdr">
        <span className="mc-panel-title">Recent Executions</span>
        <button className="mc-panel-link" onClick={() => onNavigate?.('ops')} type="button">
          History &rarr;
        </button>
      </div>
      <div className="mc-panel-body mc-exec-list">
        {executions.length === 0 && (
          <div className="mc-empty">No recent executions</div>
        )}
        {executions.map((ex) => (
          <div key={ex.id} className="mc-exec-row">
            <span className={`mc-exec-badge ${statusClass(ex.status)}`}>
              {statusIcon(ex.status)}
            </span>
            <span className="mc-exec-agent">
              {ex.agent_name || ex.agent_id || 'Unknown'}
            </span>
            <span className="mc-exec-dur">{formatDuration(ex.duration_ms ?? undefined)}</span>
            <span className="mc-exec-cost">{formatCost(ex.cost)}</span>
            <span className="mc-exec-time">{relativeTime(ex.started_at)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Cost Command Panel ──

function CostPanel({ costData }: { costData: CostData | null }) {
  const daily = costData?.dailyCosts ?? [];
  const todayStr = todayDateStr();
  const todayEntry = daily.find((d) => d.date === todayStr);
  const today = todayEntry?.totalCost ?? (daily.length > 0 ? daily[0]?.totalCost ?? 0 : 0);
  const weekTotal = daily.reduce((sum, d) => sum + d.totalCost, 0);

  const totalTokens = costData
    ? (costData.summary.total.totalInputTokens ?? 0) + (costData.summary.total.totalOutputTokens ?? 0)
    : 0;

  const chronoDaily = useMemo(() => [...daily].reverse(), [daily]);
  const maxDaily = useMemo(() => {
    if (!chronoDaily.length) return 1;
    return Math.max(...chronoDaily.map((d) => d.totalCost), 0.01);
  }, [chronoDaily]);

  return (
    <div className="mc-panel mc-cost">
      <div className="mc-panel-hdr">
        <span className="mc-panel-title">Cost Telemetry</span>
      </div>
      <div className="mc-panel-body">
        {!costData ? (
          <div className="mc-empty">Loading costs...</div>
        ) : (
          <>
            <div className="mc-cost-kpis">
              <div className="mc-cost-kpi">
                <span className="mc-cost-num">{formatCost(today)}</span>
                <span className="mc-cost-lbl">Today</span>
              </div>
              <div className="mc-cost-kpi">
                <span className="mc-cost-num">{formatCost(weekTotal)}</span>
                <span className="mc-cost-lbl">7-Day</span>
              </div>
              <div className="mc-cost-kpi">
                <span className="mc-cost-num">{formatTokens(totalTokens)}</span>
                <span className="mc-cost-lbl">Tokens</span>
              </div>
              <div className="mc-cost-kpi">
                <span className="mc-cost-num sm">{formatCost(costData.summary.api.totalCost)}</span>
                <span className="mc-cost-lbl">API</span>
              </div>
              <div className="mc-cost-kpi">
                <span className="mc-cost-num sm">{formatCost(costData.summary.cli.totalCost)}</span>
                <span className="mc-cost-lbl">CLI</span>
              </div>
            </div>
            {chronoDaily.length > 0 && (
              <div className="mc-cost-chart">
                {chronoDaily.slice(-7).map((d) => {
                  const barPct = (d.totalCost / maxDaily) * 100;
                  const isToday = d.date === todayStr;
                  return (
                    <div key={d.date} className={`mc-cost-col ${isToday ? 'today' : ''}`}>
                      <div className="mc-cost-bar-track">
                        <div
                          className="mc-cost-bar"
                          style={{ height: `${Math.max(barPct, 2)}%` }}
                          title={`${d.date}: ${formatCost(d.totalCost)}`}
                        />
                      </div>
                      <span className="mc-cost-day">{d.date.slice(-5)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Memory Tier Bar ──

function MemoryBar({
  fleetStats,
  onClick,
}: {
  fleetStats: FleetStatsData | null;
  onClick?: () => void;
}) {
  const tiers = fleetStats?.tiers;
  const sem = tiers?.semantic ?? 0;
  const epi = tiers?.episodic ?? 0;
  const proc = tiers?.procedural ?? 0;
  const total = sem + epi + proc;

  if (!total) return null;

  const semPct = (sem / total) * 100;
  const epiPct = (epi / total) * 100;
  const procPct = (proc / total) * 100;

  return (
    <button className="mc-memory-bar-wrap" onClick={onClick} type="button">
      <div className="mc-memory-bar">
        {semPct > 0 && (
          <div
            className="mc-mem-seg mc-mem-semantic"
            style={{ width: `${semPct}%` }}
            title={`Semantic: ${sem.toLocaleString()}`}
          />
        )}
        {epiPct > 0 && (
          <div
            className="mc-mem-seg mc-mem-episodic"
            style={{ width: `${epiPct}%` }}
            title={`Episodic: ${epi.toLocaleString()}`}
          />
        )}
        {procPct > 0 && (
          <div
            className="mc-mem-seg mc-mem-procedural"
            style={{ width: `${procPct}%` }}
            title={`Procedural: ${proc.toLocaleString()}`}
          />
        )}
      </div>
      <div className="mc-memory-legend">
        <span className="mc-mem-leg"><span className="mc-mem-dot mc-mem-semantic" /> SEM</span>
        <span className="mc-mem-leg"><span className="mc-mem-dot mc-mem-episodic" /> EPI</span>
        <span className="mc-mem-leg"><span className="mc-mem-dot mc-mem-procedural" /> PROC</span>
      </div>
    </button>
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
  const clock = useClock();

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
    if (ex) setExecutions(Array.isArray(ex.executions) ? ex.executions.slice(0, 12) : []);
    if (c) setCostData(c);
  }, []);

  usePolling(fetchAll, 30000);

  const activeAgents = metrics?.agents?.running ?? 0;
  const totalAgents = metrics?.agents?.total ?? 0;
  const execToday = metrics?.agents?.tasks_today ?? 0;
  const openTickets = metrics?.tickets?.open ?? 0;
  const memoryCount = fleetStats?.total ?? 0;

  const todayStr = todayDateStr();
  const todayCost = costData?.dailyCosts?.find((d) => d.date === todayStr)?.totalCost
    ?? (costData?.dailyCosts?.[0]?.totalCost ?? 0);

  return (
    <div className="mc-root">
      {/* Row 1: System Banner */}
      <SystemBanner health={health} clock={clock} />

      {/* Row 2: Command Tiles + Agent Ring */}
      <div className="mc-command-row">
        <AgentRing running={activeAgents} total={totalAgents} onClick={() => onNavigate?.('fleet')} />
        <div className="mc-tiles">
          <StatTile
            label="Active"
            value={activeAgents}
            sub={`of ${totalAgents}`}
            accent="green"
            onClick={() => onNavigate?.('fleet')}
          />
          <StatTile
            label="Executions"
            value={execToday}
            sub="24h"
            accent="violet"
            onClick={() => onNavigate?.('ops')}
          />
          <StatTile
            label="Tickets"
            value={openTickets}
            accent={openTickets > 0 ? 'amber' : ''}
            onClick={() => onNavigate?.('ops')}
          />
          <StatTile
            label="Memories"
            value={formatCount(memoryCount)}
            accent="cyan"
            onClick={() => onNavigate?.('brain')}
          />
          <StatTile
            label="Cost Today"
            value={formatCost(todayCost)}
            accent="rose"
            onClick={() => onNavigate?.('ops')}
          />
        </div>
        <MemoryBar fleetStats={fleetStats} onClick={() => onNavigate?.('brain')} />
      </div>

      {/* Row 3: Main Grid — Feed | Executions + Leaderboard | Cost */}
      <div className="mc-grid-main">
        <LiveFeed events={wsEvents} onNavigate={onNavigate} />
        <div className="mc-grid-center">
          <RecentExecutions executions={executions} onNavigate={onNavigate} />
          <Leaderboard entries={leaderboard} onNavigate={onNavigate} />
        </div>
        <CostPanel costData={costData} />
      </div>
    </div>
  );
}
