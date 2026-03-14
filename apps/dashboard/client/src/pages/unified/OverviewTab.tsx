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

async function apiFetch<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch { return null; }
}

function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

const AGENT_COLORS: Record<string, [number, number, number]> = {
  'Backend Dev': [96, 165, 250], 'Frontend Dev': [167, 139, 250],
  'QA': [52, 211, 153], 'Infra': [251, 146, 60],
  'Security': [248, 113, 113], 'Writer': [232, 121, 249],
  'Watchdog': [45, 212, 191], 'Alf': [245, 158, 11],
  'System': [148, 163, 184], 'core_engine': [245, 158, 11],
};

function agentColor(name: string): [number, number, number] {
  return AGENT_COLORS[name] || [148, 163, 184];
}

function rgba(c: [number, number, number], a: number): string {
  return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
}

const PILL_LABELS: Record<string, string> = {
  execution_failure_rate: 'FAIL RATE',
  stuck_executions: 'STUCK',
  hourly_cost: '$/HR',
  agents_in_error: 'ERRORS',
  memory_activity: 'MEMORY',
  pending_interventions: 'PENDING',
};

// ── Heartbeat Canvas ──

function HeartbeatStrip() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let animId: number;
    let offset = 0;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      if (canvas.width !== rect.width * dpr) {
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      const w = rect.width;
      const h = rect.height;
      ctx.clearRect(0, 0, w, h);

      // Subtle scanline
      ctx.fillStyle = 'rgba(16, 185, 129, 0.015)';
      const scanY = (Date.now() / 30) % h;
      ctx.fillRect(0, scanY, w, 1);

      // Heartbeat line
      ctx.beginPath();
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 1.2;
      ctx.shadowColor = '#10b981';
      ctx.shadowBlur = 6;

      const cycle = 100;
      for (let x = 0; x < w + cycle; x++) {
        const xp = (x + offset) % cycle;
        let y = h / 2;
        if (xp > 25 && xp < 30) y = h / 2 - 6;
        else if (xp > 30 && xp < 35) y = h / 2 + 12;
        else if (xp > 35 && xp < 42) y = h / 2 - 16;
        else if (xp > 42 && xp < 47) y = h / 2 + 5;
        else if (xp > 47 && xp < 51) y = h / 2 - 3;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
      offset = (offset - 0.6 + cycle) % cycle;
      animId = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(animId);
  }, []);

  return <canvas ref={canvasRef} className="mc-hb-canvas" />;
}

// ── Orbital Fleet Canvas ──

interface AgentInfo {
  id: string;
  name: string;
  status: string;
}

function OrbitalFleet({
  executions,
  allAgents,
  running,
  total,
  onClick,
}: {
  executions: ExecutionEntry[];
  allAgents: AgentInfo[];
  running: number;
  total: number;
  onClick?: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let animId: number;

    // Build agent data: start with ALL agents, enrich with execution data
    const execMap = new Map<string, { count: number; lastStatus: string }>();
    for (const e of executions) {
      const name = e.agent_name || 'Unknown';
      const existing = execMap.get(name);
      if (existing) {
        existing.count++;
        if (e.status === 'running') existing.lastStatus = 'running';
      } else {
        execMap.set(name, { count: 1, lastStatus: e.status });
      }
    }

    const agents = allAgents.length > 0
      ? allAgents.map(a => ({
          name: a.name,
          count: execMap.get(a.name)?.count ?? 0,
          lastStatus: execMap.get(a.name)?.lastStatus ?? (a.status === 'active' ? 'idle' : a.status),
        }))
      : Array.from(execMap.entries()).map(([name, data]) => ({ name, ...data }));

    const draw = (time: number) => {
      const dpr = window.devicePixelRatio || 1;
      const rect = container.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      ctx.clearRect(0, 0, w, h);

      const cx = w / 2;
      const cy = h / 2;
      const maxR = Math.min(w, h) * 0.42;

      // Orbital rings
      for (let ring = 1; ring <= 3; ring++) {
        const r = maxR * (ring / 3);
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(124, 58, 237, ${0.06 + ring * 0.02})`;
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }

      // Center core — breathing
      const corePulse = Math.sin(time * 0.002) * 0.3 + 0.7;
      const coreR = 20 + corePulse * 4;

      // Core glow
      const coreGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR * 3);
      coreGlow.addColorStop(0, `rgba(124, 58, 237, ${0.12 * corePulse})`);
      coreGlow.addColorStop(0.5, `rgba(124, 58, 237, ${0.04 * corePulse})`);
      coreGlow.addColorStop(1, 'rgba(124, 58, 237, 0)');
      ctx.beginPath();
      ctx.arc(cx, cy, coreR * 3, 0, Math.PI * 2);
      ctx.fillStyle = coreGlow;
      ctx.fill();

      // Core circle
      const coreGrad = ctx.createRadialGradient(cx - 4, cy - 4, 0, cx, cy, coreR);
      coreGrad.addColorStop(0, 'rgba(167, 139, 250, 0.9)');
      coreGrad.addColorStop(1, 'rgba(124, 58, 237, 0.6)');
      ctx.beginPath();
      ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
      ctx.fillStyle = coreGrad;
      ctx.fill();

      // Core text
      ctx.font = `700 ${coreR * 0.7}px Satoshi, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
      ctx.fillText(String(running), cx, cy - 2);
      ctx.font = `500 ${coreR * 0.3}px Satoshi, system-ui, sans-serif`;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.fillText(`/ ${total}`, cx, cy + coreR * 0.45);

      // Agent satellites
      if (agents.length > 0) {
        agents.forEach((agent, i) => {
          const orbitR = maxR * 0.5 + (i % 3) * (maxR * 0.18);
          const speed = 0.0003 + (i * 0.618 % 1) * 0.0004;
          const angle = time * speed + (i * Math.PI * 2) / Math.max(agents.length, 1);
          const ax = cx + Math.cos(angle) * orbitR;
          const ay = cy + Math.sin(angle) * orbitR;
          const col = agentColor(agent.name);
          const nodeR = 5 + Math.min(agent.count, 8) * 1.2;
          const isRunning = agent.lastStatus === 'running';

          // Connection line to core
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(ax, ay);
          ctx.strokeStyle = rgba(col, 0.08);
          ctx.lineWidth = 0.5;
          ctx.stroke();

          // Satellite glow
          if (isRunning) {
            const satGlow = ctx.createRadialGradient(ax, ay, 0, ax, ay, nodeR * 4);
            satGlow.addColorStop(0, rgba(col, 0.2));
            satGlow.addColorStop(1, rgba(col, 0));
            ctx.beginPath();
            ctx.arc(ax, ay, nodeR * 4, 0, Math.PI * 2);
            ctx.fillStyle = satGlow;
            ctx.fill();
          }

          // Corona
          const coronaR = nodeR * 1.8;
          const corona = ctx.createRadialGradient(ax, ay, nodeR * 0.5, ax, ay, coronaR);
          corona.addColorStop(0, rgba(col, 0.15));
          corona.addColorStop(1, rgba(col, 0));
          ctx.beginPath();
          ctx.arc(ax, ay, coronaR, 0, Math.PI * 2);
          ctx.fillStyle = corona;
          ctx.fill();

          // Node
          ctx.beginPath();
          ctx.arc(ax, ay, nodeR, 0, Math.PI * 2);
          const nodeGrad = ctx.createRadialGradient(ax - 2, ay - 2, 0, ax, ay, nodeR);
          nodeGrad.addColorStop(0, rgba([Math.min(255, col[0] + 40), Math.min(255, col[1] + 40), Math.min(255, col[2] + 40)], 0.9));
          nodeGrad.addColorStop(1, rgba(col, 0.7));
          ctx.fillStyle = nodeGrad;
          ctx.fill();

          // Label
          ctx.font = `500 9px Satoshi, system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillStyle = rgba(col, 0.7);
          ctx.fillText(agent.name, ax, ay + nodeR + 4);
        });
      }

      animId = requestAnimationFrame(draw);
    };
    animId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animId);
  }, [executions, allAgents, running, total]);

  return (
    <div ref={containerRef} className="mc-orbital" onClick={onClick}>
      <canvas ref={canvasRef} className="mc-orbital-canvas" />
    </div>
  );
}

// ── Cost Sparkline ──

function CostSparkline({ dailyCosts }: { dailyCosts: DailyCostEntry[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || dailyCosts.length === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = rect.width;
    const h = rect.height;

    const costs = dailyCosts.slice(-7).map(d => d.totalCost);
    const maxCost = Math.max(...costs, 0.01);
    const pad = 4;

    // Fill gradient
    ctx.beginPath();
    costs.forEach((c, i) => {
      const x = pad + (i / (costs.length - 1)) * (w - pad * 2);
      const y = h - pad - (c / maxCost) * (h - pad * 2);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    const lastX = pad + ((costs.length - 1) / (costs.length - 1)) * (w - pad * 2);
    ctx.lineTo(lastX, h);
    ctx.lineTo(pad, h);
    ctx.closePath();
    const fill = ctx.createLinearGradient(0, 0, 0, h);
    fill.addColorStop(0, 'rgba(124, 58, 237, 0.2)');
    fill.addColorStop(1, 'rgba(124, 58, 237, 0)');
    ctx.fillStyle = fill;
    ctx.fill();

    // Line
    ctx.beginPath();
    costs.forEach((c, i) => {
      const x = pad + (i / (costs.length - 1)) * (w - pad * 2);
      const y = h - pad - (c / maxCost) * (h - pad * 2);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = '#a78bfa';
    ctx.lineWidth = 1.5;
    ctx.shadowColor = '#7c3aed';
    ctx.shadowBlur = 4;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // End dot
    const lastY = h - pad - (costs[costs.length - 1]! / maxCost) * (h - pad * 2);
    ctx.beginPath();
    ctx.arc(lastX, lastY, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#a78bfa';
    ctx.fill();
  }, [dailyCosts]);

  return <canvas ref={canvasRef} className="mc-sparkline" />;
}

// ── Memory Tier Visualization ──

function MemoryTiers({ fleetStats, onClick }: { fleetStats: FleetStatsData | null; onClick?: () => void }) {
  const tiers = fleetStats?.tiers;
  const sem = tiers?.semantic ?? 0;
  const epi = tiers?.episodic ?? 0;
  const proc = tiers?.procedural ?? 0;
  const total = sem + epi + proc;
  if (!total) return null;

  return (
    <button className="mc-mem-panel" onClick={onClick} type="button">
      <div className="mc-mem-header">
        <span className="mc-mem-title">NEURAL MEMORY</span>
        <span className="mc-mem-total">{formatCount(total)}</span>
      </div>
      <div className="mc-mem-bars">
        <div className="mc-mem-row">
          <span className="mc-mem-label">SEM</span>
          <div className="mc-mem-track">
            <div className="mc-mem-fill mc-mem-semantic" style={{ width: `${(sem / total) * 100}%` }} />
          </div>
          <span className="mc-mem-count">{formatCount(sem)}</span>
        </div>
        <div className="mc-mem-row">
          <span className="mc-mem-label">EPI</span>
          <div className="mc-mem-track">
            <div className="mc-mem-fill mc-mem-episodic" style={{ width: `${(epi / total) * 100}%` }} />
          </div>
          <span className="mc-mem-count">{formatCount(epi)}</span>
        </div>
        <div className="mc-mem-row">
          <span className="mc-mem-label">PROC</span>
          <div className="mc-mem-track">
            <div className="mc-mem-fill mc-mem-procedural" style={{ width: `${(proc / total) * 100}%` }} />
          </div>
          <span className="mc-mem-count">{formatCount(proc)}</span>
        </div>
      </div>
    </button>
  );
}

// ── Event Ticker ──

function EventTicker({ events }: { events: ForgeEvent[] }) {
  const recent = events.slice(-30).reverse();

  return (
    <div className="mc-ticker">
      <div className="mc-ticker-label">
        <span className="mc-ticker-live" />
        TELEMETRY
      </div>
      <div className="mc-ticker-scroll">
        <div className="mc-ticker-track">
          {recent.map((evt, i) => {
            const agent = evt.agentName || evt.agentId || 'SYS';
            const type = evt.type || '';
            const statusClass = type === 'completed' ? 'ok' : type === 'failed' ? 'fail' : type === 'started' ? 'start' : 'default';
            const msg = evt.data && typeof evt.data === 'object' && typeof (evt.data as Record<string, unknown>).message === 'string'
              ? (evt.data as Record<string, unknown>).message as string
              : `${evt.category || ''} ${type}`;
            return (
              <span key={`${evt.id ?? i}`} className={`mc-ticker-item ${statusClass}`}>
                <span className="mc-ticker-agent">{agent}</span>
                <span className="mc-ticker-msg">{msg}</span>
              </span>
            );
          })}
        </div>
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
  const [allAgents, setAllAgents] = useState<AgentInfo[]>([]);
  const clock = useClock();

  const fetchAll = useCallback(async () => {
    const [h, m, fs, ex, c, ag] = await Promise.all([
      apiFetch<HealthData>('/api/v1/admin/monitoring/health'),
      apiFetch<MetricsData>('/api/v1/admin/reports/metrics'),
      apiFetch<FleetStatsData>('/api/v1/forge/fleet/stats'),
      apiFetch<{ executions: ExecutionEntry[] }>('/api/v1/admin/executions/timeline?hours=24'),
      apiFetch<CostData>('/api/v1/admin/costs?days=7'),
      apiFetch<{ agents: AgentInfo[] }>('/api/v1/admin/agents'),
    ]);
    if (h) setHealth(h);
    if (m) setMetrics(m);
    if (fs) setFleetStats(fs);
    if (ex) setExecutions(Array.isArray(ex.executions) ? ex.executions.slice(0, 20) : []);
    if (c) setCostData(c);
    if (ag?.agents) setAllAgents(ag.agents.filter(a => a.status === 'active'));
  }, []);

  usePolling(fetchAll, 30000);

  const activeAgents = metrics?.agents?.running ?? 0;
  const totalAgents = metrics?.agents?.total ?? 0;
  const execToday = metrics?.agents?.tasks_today ?? 0;
  const openTickets = metrics?.tickets?.open ?? 0;

  const todayStr = todayDateStr();
  const todayCost = costData?.dailyCosts?.find((d) => d.date === todayStr)?.totalCost
    ?? (costData?.dailyCosts?.[0]?.totalCost ?? 0);

  const weekCost = costData?.dailyCosts?.reduce((s, d) => s + d.totalCost, 0) ?? 0;
  const completed24h = executions.filter(e => e.status === 'completed').length;
  const failed24h = executions.filter(e => e.status === 'failed').length;
  const running = executions.filter(e => e.status === 'running');

  const raw = health?.status?.toLowerCase() ?? health?.overall ?? null;
  const statusClass = !raw ? 'unknown' : raw === 'healthy' ? 'healthy' : raw === 'degraded' ? 'degraded' : 'down';
  const statusLabel = raw?.toUpperCase() ?? 'LOADING';

  const timeStr = clock.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const dateStr = clock.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

  return (
    <div className="mc-root">
      {/* ── Status Bar ── */}
      <div className="mc-status-bar">
        <div className={`mc-status-core ${statusClass}`}>
          <span className="mc-status-dot" />
          <span className="mc-status-text">{statusLabel}</span>
        </div>
        <div className="mc-hb-wrap"><HeartbeatStrip /></div>
        <div className="mc-checks">
          {health?.checks?.map(c => (
            <span key={c.name} className={`mc-check ${c.status}`} title={c.message || ''}>
              <span className="mc-check-name">{PILL_LABELS[c.name] ?? c.name}</span>
              <span className="mc-check-val">{c.value ?? c.status}</span>
            </span>
          ))}
        </div>
        <div className="mc-clock-group">
          <span className="mc-clock-time">{timeStr}</span>
          <span className="mc-clock-date">{dateStr}</span>
        </div>
      </div>

      {/* ── Main Grid ── */}
      <div className="mc-grid">
        {/* Left Column: Telemetry Gauges */}
        <div className="mc-gauges">
          <button className="mc-gauge" onClick={() => onNavigate?.('fleet')} type="button">
            <span className="mc-gauge-val green">{activeAgents}<span className="mc-gauge-of">/{totalAgents}</span></span>
            <span className="mc-gauge-label">FLEET ACTIVE</span>
          </button>
          <button className="mc-gauge" onClick={() => onNavigate?.('ops')} type="button">
            <span className="mc-gauge-val violet">{execToday}</span>
            <span className="mc-gauge-label">EXECUTIONS 24H</span>
          </button>
          <button className="mc-gauge" onClick={() => onNavigate?.('ops')} type="button">
            <span className={`mc-gauge-val ${openTickets > 0 ? 'amber' : ''}`}>{openTickets}</span>
            <span className="mc-gauge-label">OPEN TICKETS</span>
          </button>
          <button className="mc-gauge" onClick={() => onNavigate?.('ops')} type="button">
            <span className="mc-gauge-val rose">{formatCost(todayCost)}</span>
            <span className="mc-gauge-label">COST TODAY</span>
          </button>
          <button className="mc-gauge" onClick={() => onNavigate?.('ops')} type="button">
            <span className="mc-gauge-val">{formatCost(weekCost)}</span>
            <span className="mc-gauge-label">COST 7-DAY</span>
          </button>
          <div className="mc-gauge mc-gauge-spark">
            <CostSparkline dailyCosts={costData?.dailyCosts ?? []} />
            <span className="mc-gauge-label">7-DAY TREND</span>
          </div>
        </div>

        {/* Center: Orbital Fleet */}
        <OrbitalFleet
          executions={executions}
          allAgents={allAgents}
          running={activeAgents}
          total={totalAgents}
          onClick={() => onNavigate?.('fleet')}
        />

        {/* Right Column: Status Panels */}
        <div className="mc-panels">
          {/* Execution Status */}
          <div className="mc-panel">
            <div className="mc-panel-hdr">
              <span className="mc-panel-title">EXECUTION STATUS</span>
            </div>
            <div className="mc-exec-grid">
              <button className="mc-exec-stat" onClick={() => onNavigate?.('ops')} type="button">
                <span className="mc-exec-num ok">{completed24h}</span>
                <span className="mc-exec-label">PASS</span>
              </button>
              <button className="mc-exec-stat" onClick={() => onNavigate?.('ops')} type="button">
                <span className="mc-exec-num fail">{failed24h}</span>
                <span className="mc-exec-label">FAIL</span>
              </button>
              <button className="mc-exec-stat" onClick={() => onNavigate?.('live')} type="button">
                <span className="mc-exec-num running">{running.length}</span>
                <span className="mc-exec-label">LIVE</span>
              </button>
            </div>
            {running.length > 0 && (
              <div className="mc-running-list">
                {running.map(e => {
                  const col = agentColor(e.agent_name || '');
                  return (
                    <div key={e.id} className="mc-running-item">
                      <span className="mc-running-dot" style={{ background: rgba(col, 0.8), boxShadow: `0 0 6px ${rgba(col, 0.4)}` }} />
                      <span className="mc-running-name">{e.agent_name || 'Agent'}</span>
                      <span className="mc-running-time">{relativeTime(e.started_at)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Memory */}
          <MemoryTiers fleetStats={fleetStats} onClick={() => onNavigate?.('brain')} />

          {/* Recent Failures */}
          {failed24h > 0 && (
            <div className="mc-panel mc-failures">
              <div className="mc-panel-hdr">
                <span className="mc-panel-title">RECENT FAILURES</span>
              </div>
              <div className="mc-fail-list">
                {executions.filter(e => e.status === 'failed').slice(0, 4).map(e => (
                  <button key={e.id} className="mc-fail-item" onClick={() => onNavigate?.('ops')} type="button">
                    <span className="mc-fail-dot" />
                    <span className="mc-fail-agent">{e.agent_name || 'Agent'}</span>
                    <span className="mc-fail-time">{relativeTime(e.started_at)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Event Ticker ── */}
      <EventTicker events={wsEvents} />
    </div>
  );
}
