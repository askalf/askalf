import { useState, useCallback, useEffect, useRef } from 'react';
import { usePolling } from '../../hooks/usePolling';
import { formatCost, formatCount, relativeTime, todayDateStr } from '../../utils/format';
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

// ── Needs Attention Panel ──

function NeedsAttention({
  executions,
  openTickets,
  onNavigate,
}: {
  executions: ExecutionEntry[];
  openTickets: number;
  onNavigate?: (tab: string) => void;
}) {
  const failedRecent = executions.filter(e => e.status === 'failed');
  const running = executions.filter(e => e.status === 'running');
  const hasIssues = failedRecent.length > 0 || openTickets > 0;

  return (
    <div className="mc-panel mc-attention">
      <div className="mc-panel-hdr">
        <span className="mc-panel-title">
          {hasIssues ? 'Needs Attention' : 'All Clear'}
        </span>
        {!hasIssues && <span className="mc-attention-ok">No issues</span>}
      </div>
      <div className="mc-panel-body">
        {running.length > 0 && (
          <div className="mc-attn-group">
            <div className="mc-attn-label">Running Now</div>
            {running.map(e => (
              <div key={e.id} className="mc-attn-item mc-attn-running" onClick={() => onNavigate?.('ops')}>
                <span className="mc-attn-dot running" />
                <span className="mc-attn-agent">{e.agent_name || 'Agent'}</span>
                <span className="mc-attn-time">{relativeTime(e.started_at)}</span>
              </div>
            ))}
          </div>
        )}
        {failedRecent.length > 0 && (
          <div className="mc-attn-group">
            <div className="mc-attn-label">Failed Recently</div>
            {failedRecent.slice(0, 5).map(e => (
              <div key={e.id} className="mc-attn-item mc-attn-failed" onClick={() => onNavigate?.('ops')}>
                <span className="mc-attn-dot failed" />
                <span className="mc-attn-agent">{e.agent_name || 'Agent'}</span>
                <span className="mc-attn-time">{relativeTime(e.started_at)}</span>
              </div>
            ))}
          </div>
        )}
        {openTickets > 0 && (
          <div className="mc-attn-group">
            <button className="mc-attn-item mc-attn-tickets" onClick={() => onNavigate?.('ops')}>
              <span className="mc-attn-dot ticket" />
              <span className="mc-attn-agent">{openTickets} open ticket{openTickets !== 1 ? 's' : ''}</span>
              <span className="mc-attn-action">View</span>
            </button>
          </div>
        )}
        {!hasIssues && running.length === 0 && (
          <div className="mc-empty" style={{ padding: '2rem 0' }}>
            System is healthy. No failures or open tickets.
          </div>
        )}
      </div>
    </div>
  );
}

// ── Activity Summary ──

function ActivitySummary({
  executions,
  todayCost,
  wsEvents,
  onNavigate,
}: {
  executions: ExecutionEntry[];
  todayCost: number;
  costData: CostData | null;
  wsEvents: ForgeEvent[];
  onNavigate?: (tab: string) => void;
}) {
  const completed = executions.filter(e => e.status === 'completed').length;
  const failed = executions.filter(e => e.status === 'failed').length;
  const recentEvents = wsEvents.slice(0, 8);

  return (
    <div className="mc-panel mc-activity">
      <div className="mc-panel-hdr">
        <span className="mc-panel-title">Activity</span>
      </div>
      <div className="mc-panel-body">
        <div className="mc-activity-stats">
          <button className="mc-activity-stat" onClick={() => onNavigate?.('ops')}>
            <span className="mc-activity-val ok">{completed}</span>
            <span className="mc-activity-lbl">Completed</span>
          </button>
          <button className="mc-activity-stat" onClick={() => onNavigate?.('ops')}>
            <span className="mc-activity-val fail">{failed}</span>
            <span className="mc-activity-lbl">Failed</span>
          </button>
          <button className="mc-activity-stat" onClick={() => onNavigate?.('ops')}>
            <span className="mc-activity-val cost">{formatCost(todayCost)}</span>
            <span className="mc-activity-lbl">Cost Today</span>
          </button>
        </div>
        {recentEvents.length > 0 && (
          <div className="mc-activity-feed">
            {recentEvents.map((evt, i) => (
              <div key={`${evt.id ?? i}`} className={`mc-activity-evt ${eventTypeClass(evt.type || '')}`}>
                <span className="mc-activity-time">{formatTime(typeof evt.timestamp === 'number' ? evt.timestamp : Date.now())}</span>
                <span className="mc-activity-msg">{summarizeEvent(evt)}</span>
              </div>
            ))}
            <button className="mc-activity-more" onClick={() => onNavigate?.('live')}>
              View full feed
            </button>
          </div>
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
  const [executions, setExecutions] = useState<ExecutionEntry[]>([]);
  const [costData, setCostData] = useState<CostData | null>(null);
  const clock = useClock();

  const fetchAll = useCallback(async () => {
    const [h, m, fs, ex, c] = await Promise.all([
      apiFetch<HealthData>('/api/v1/admin/monitoring/health'),
      apiFetch<MetricsData>('/api/v1/admin/reports/metrics'),
      apiFetch<FleetStatsData>('/api/v1/forge/fleet/stats'),
      apiFetch<{ executions: ExecutionEntry[] }>('/api/v1/admin/executions/timeline?hours=24'),
      apiFetch<CostData>('/api/v1/admin/costs?days=7'),
    ]);
    if (h) setHealth(h);
    if (m) setMetrics(m);
    if (fs) setFleetStats(fs);
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

      {/* Row 3: Needs Attention + Activity */}
      <div className="mc-grid-main">
        <NeedsAttention executions={executions} openTickets={openTickets} onNavigate={onNavigate} />
        <ActivitySummary
          executions={executions}
          todayCost={todayCost}
          costData={costData}
          wsEvents={wsEvents}
          onNavigate={onNavigate}
        />
      </div>
    </div>
  );
}
