/**
 * FleetHealthWidget — Compact fleet health overview for any dashboard tab.
 *
 * Displays: agent statuses, execution stats (last 1h), open tickets, memory totals.
 * Auto-refreshes every 30 seconds using existing API endpoints.
 *
 * Usage:
 *   <FleetHealthWidget />
 *   <FleetHealthWidget onNavigate={(tab) => setActiveTab(tab)} />
 *
 * GitHub issue #9
 */

import { useState, useCallback } from 'react';
import { usePolling } from '../hooks/usePolling';
import { hubApi } from '../hooks/useHubApi';
import type { Agent, FleetMemoryStats, TimelineExecution, Ticket } from '../hooks/useHubApi';
import { formatCount } from '../utils/format';

// ── Types ──

interface FleetHealthWidgetProps {
  /** Optional callback to navigate to a dashboard tab when a section is clicked. */
  onNavigate?: (tab: string) => void;
  /** Polling interval in ms. Defaults to 30000 (30s). */
  refreshInterval?: number;
  /** CSS class to apply to the root element. */
  className?: string;
}

interface AgentStatusCounts {
  total: number;
  running: number;
  idle: number;
  error: number;
  paused: number;
}

interface ExecutionStats {
  completed: number;
  failed: number;
  running: number;
  total: number;
  successRate: number;
}

interface WidgetData {
  agents: AgentStatusCounts;
  executions: ExecutionStats;
  openTickets: number;
  memoryTotal: number;
  memoryTiers: { semantic: number; episodic: number; procedural: number };
  loaded: boolean;
  error: boolean;
}

const INITIAL_DATA: WidgetData = {
  agents: { total: 0, running: 0, idle: 0, error: 0, paused: 0 },
  executions: { completed: 0, failed: 0, running: 0, total: 0, successRate: 0 },
  openTickets: 0,
  memoryTotal: 0,
  memoryTiers: { semantic: 0, episodic: 0, procedural: 0 },
  loaded: false,
  error: false,
};

// ── Component ──

export default function FleetHealthWidget({
  onNavigate,
  refreshInterval = 30000,
  className,
}: FleetHealthWidgetProps) {
  const [data, setData] = useState<WidgetData>(INITIAL_DATA);

  const fetchData = useCallback(async () => {
    try {
      const [agentsRes, execRes, ticketsRes, memRes] = await Promise.all([
        hubApi.agents.list().catch(() => ({ agents: [] as Agent[] })),
        hubApi.timeline.executions(1).catch(() => ({ executions: [] as TimelineExecution[], hours: 1 })),
        hubApi.tickets.list({ filter: 'open', limit: 1 }).catch(() => ({ tickets: [] as Ticket[], pagination: { total: 0, page: 1, limit: 1, totalPages: 0, hasNext: false, hasPrev: false } })),
        hubApi.memory.stats().catch(() => ({ total: 0, tiers: { semantic: 0, episodic: 0, procedural: 0 }, recent24h: { semantic: 0, episodic: 0, procedural: 0 }, recalls24h: 0 } as FleetMemoryStats)),
      ]);

      // Agent status counts (exclude decommissioned)
      const activeAgents = agentsRes.agents.filter(a => !a.is_decommissioned);
      const running = activeAgents.filter(a => a.status === 'running').length;
      const idle = activeAgents.filter(a => a.status === 'idle').length;
      const error = activeAgents.filter(a => a.status === 'error').length;
      const paused = activeAgents.filter(a => a.status === 'paused').length;

      // Execution stats (last 1h)
      const execs = execRes.executions || [];
      const completed = execs.filter(e => e.status === 'completed').length;
      const failed = execs.filter(e => e.status === 'failed').length;
      const runningExecs = execs.filter(e => e.status === 'running').length;
      const totalExecs = execs.length;
      const finishedExecs = completed + failed;
      const successRate = finishedExecs > 0 ? Math.round((completed / finishedExecs) * 100) : 0;

      // Tickets — use pagination total for open count
      const openTickets = ticketsRes.pagination?.total ?? ticketsRes.tickets?.length ?? 0;

      // Memory
      const memoryTotal = memRes.total ?? 0;
      const memoryTiers = memRes.tiers ?? { semantic: 0, episodic: 0, procedural: 0 };

      setData({
        agents: { total: activeAgents.length, running, idle, error, paused },
        executions: { completed, failed, running: runningExecs, total: totalExecs, successRate },
        openTickets,
        memoryTotal,
        memoryTiers,
        loaded: true,
        error: false,
      });
    } catch {
      setData(prev => ({ ...prev, error: true }));
    }
  }, []);

  usePolling(fetchData, refreshInterval);

  const nav = (tab: string) => onNavigate?.(tab);

  if (!data.loaded && !data.error) {
    return (
      <div className={`fhw-root ${className || ''}`} style={rootStyle}>
        <div style={loadingStyle}>Loading team health...</div>
      </div>
    );
  }

  if (data.error && !data.loaded) {
    return (
      <div className={`fhw-root ${className || ''}`} style={rootStyle}>
        <div style={loadingStyle}>Team health unavailable</div>
      </div>
    );
  }

  const { agents, executions, openTickets, memoryTotal, memoryTiers } = data;

  return (
    <div className={`fhw-root ${className || ''}`} style={rootStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <span style={headerTitleStyle}>TEAM HEALTH</span>
        <span style={headerDotStyle(agents.error > 0 ? 'error' : agents.running > 0 ? 'healthy' : 'idle')} />
        <span style={headerStatusStyle}>
          {agents.error > 0 ? 'DEGRADED' : agents.running > 0 ? 'OPERATIONAL' : 'IDLE'}
        </span>
      </div>

      {/* Grid of 4 sections */}
      <div style={gridStyle}>
        {/* 1. Agent Statuses */}
        <button type="button" style={cardStyle} onClick={() => nav('fleet')}>
          <div style={cardHeaderStyle}>
            <span style={cardLabelStyle}>AGENTS</span>
            <span style={cardValueStyle}>{agents.total}</span>
          </div>
          <div style={badgeRowStyle}>
            <StatusBadge label="RUN" count={agents.running} color="#10b981" />
            <StatusBadge label="IDLE" count={agents.idle} color="#94a3b8" />
            <StatusBadge label="ERR" count={agents.error} color="#f87171" />
            {agents.paused > 0 && <StatusBadge label="PAUSE" count={agents.paused} color="#fbbf24" />}
          </div>
        </button>

        {/* 2. Execution Stats (last 1h) */}
        <button type="button" style={cardStyle} onClick={() => nav('ops')}>
          <div style={cardHeaderStyle}>
            <span style={cardLabelStyle}>EXECUTIONS 1H</span>
            <span style={cardValueStyle}>{executions.total}</span>
          </div>
          <div style={badgeRowStyle}>
            <StatusBadge label="PASS" count={executions.completed} color="#10b981" />
            <StatusBadge label="FAIL" count={executions.failed} color="#f87171" />
            <StatusBadge label="LIVE" count={executions.running} color="#60a5fa" />
          </div>
          {executions.total > 0 && (
            <div style={rateBarContainerStyle}>
              <div style={rateBarStyle(executions.successRate)} />
              <span style={rateLabelStyle}>{executions.successRate}% success</span>
            </div>
          )}
        </button>

        {/* 3. Open Tickets */}
        <button type="button" style={cardStyle} onClick={() => nav('ops')}>
          <div style={cardHeaderStyle}>
            <span style={cardLabelStyle}>OPEN TICKETS</span>
            <span style={{ ...cardValueStyle, color: openTickets > 0 ? '#fbbf24' : undefined }}>
              {openTickets}
            </span>
          </div>
          <div style={ticketHintStyle}>
            {openTickets === 0 ? 'All clear' : openTickets === 1 ? '1 ticket needs attention' : `${openTickets} tickets need attention`}
          </div>
        </button>

        {/* 4. Memory Stats */}
        <button type="button" style={cardStyle} onClick={() => nav('brain')}>
          <div style={cardHeaderStyle}>
            <span style={cardLabelStyle}>FLEET MEMORY</span>
            <span style={cardValueStyle}>{formatCount(memoryTotal)}</span>
          </div>
          <div style={memoryRowsStyle}>
            <MemoryRow label="SEM" count={memoryTiers.semantic} total={memoryTotal} color="#a78bfa" />
            <MemoryRow label="EPI" count={memoryTiers.episodic} total={memoryTotal} color="#34d399" />
            <MemoryRow label="PROC" count={memoryTiers.procedural} total={memoryTotal} color="#60a5fa" />
          </div>
        </button>
      </div>
    </div>
  );
}

// ── Sub-components ──

function StatusBadge({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <span style={badgeStyle(color, count > 0)}>
      <span style={badgeDotStyle(color, count > 0)} />
      <span style={badgeCountStyle}>{count}</span>
      <span style={badgeLabelInnerStyle}>{label}</span>
    </span>
  );
}

function MemoryRow({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div style={memRowStyle}>
      <span style={memLabelStyle}>{label}</span>
      <div style={memTrackStyle}>
        <div style={memFillStyle(color, pct)} />
      </div>
      <span style={memCountStyle}>{formatCount(count)}</span>
    </div>
  );
}

// ── Inline styles (uses CSS variable-compatible values matching the dashboard dark theme) ──

const rootStyle: React.CSSProperties = {
  background: 'rgba(255, 255, 255, 0.02)',
  border: '1px solid rgba(255, 255, 255, 0.06)',
  borderRadius: '12px',
  padding: '16px',
  fontFamily: 'Satoshi, system-ui, -apple-system, sans-serif',
  color: '#e2e8f0',
  fontSize: '13px',
};

const loadingStyle: React.CSSProperties = {
  textAlign: 'center',
  padding: '24px 0',
  color: '#64748b',
  fontSize: '12px',
  letterSpacing: '0.05em',
  textTransform: 'uppercase' as const,
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  marginBottom: '14px',
  paddingBottom: '10px',
  borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
};

const headerTitleStyle: React.CSSProperties = {
  fontSize: '11px',
  fontWeight: 700,
  letterSpacing: '0.1em',
  color: '#94a3b8',
  textTransform: 'uppercase' as const,
};

const headerDotStyle = (status: 'healthy' | 'error' | 'idle'): React.CSSProperties => ({
  width: '6px',
  height: '6px',
  borderRadius: '50%',
  background: status === 'healthy' ? '#10b981' : status === 'error' ? '#f87171' : '#64748b',
  boxShadow: status === 'healthy' ? '0 0 6px rgba(16, 185, 129, 0.5)' : status === 'error' ? '0 0 6px rgba(248, 113, 113, 0.5)' : 'none',
  marginLeft: 'auto',
});

const headerStatusStyle: React.CSSProperties = {
  fontSize: '10px',
  fontWeight: 600,
  letterSpacing: '0.08em',
  color: '#94a3b8',
};

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: '10px',
};

const cardStyle: React.CSSProperties = {
  background: 'rgba(255, 255, 255, 0.02)',
  border: '1px solid rgba(255, 255, 255, 0.05)',
  borderRadius: '8px',
  padding: '12px',
  cursor: 'pointer',
  textAlign: 'left' as const,
  color: 'inherit',
  fontFamily: 'inherit',
  fontSize: 'inherit',
  transition: 'background 0.15s, border-color 0.15s',
  display: 'flex',
  flexDirection: 'column' as const,
  gap: '8px',
};

const cardHeaderStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
};

const cardLabelStyle: React.CSSProperties = {
  fontSize: '10px',
  fontWeight: 700,
  letterSpacing: '0.08em',
  color: '#64748b',
  textTransform: 'uppercase' as const,
};

const cardValueStyle: React.CSSProperties = {
  fontSize: '20px',
  fontWeight: 700,
  color: '#e2e8f0',
  lineHeight: 1,
};

const badgeRowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap' as const,
  gap: '6px',
};

const badgeStyle = (color: string, active: boolean): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
  padding: '2px 7px',
  borderRadius: '10px',
  background: active ? `${color}15` : 'rgba(255, 255, 255, 0.03)',
  border: `1px solid ${active ? `${color}30` : 'rgba(255, 255, 255, 0.05)'}`,
  fontSize: '10px',
  lineHeight: '16px',
});

const badgeDotStyle = (color: string, active: boolean): React.CSSProperties => ({
  width: '5px',
  height: '5px',
  borderRadius: '50%',
  background: active ? color : '#475569',
  boxShadow: active ? `0 0 4px ${color}60` : 'none',
});

const badgeCountStyle: React.CSSProperties = {
  fontWeight: 700,
  color: '#e2e8f0',
};

const badgeLabelInnerStyle: React.CSSProperties = {
  fontWeight: 500,
  color: '#94a3b8',
  letterSpacing: '0.04em',
};

const rateBarContainerStyle: React.CSSProperties = {
  position: 'relative' as const,
  height: '14px',
  background: 'rgba(248, 113, 113, 0.1)',
  borderRadius: '4px',
  overflow: 'hidden',
};

const rateBarStyle = (pct: number): React.CSSProperties => ({
  position: 'absolute' as const,
  top: 0,
  left: 0,
  height: '100%',
  width: `${pct}%`,
  background: pct >= 80 ? 'rgba(16, 185, 129, 0.25)' : pct >= 50 ? 'rgba(251, 191, 36, 0.25)' : 'rgba(248, 113, 113, 0.25)',
  borderRadius: '4px',
  transition: 'width 0.4s ease',
});

const rateLabelStyle: React.CSSProperties = {
  position: 'absolute' as const,
  top: 0,
  left: 0,
  right: 0,
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '9px',
  fontWeight: 600,
  color: '#94a3b8',
  letterSpacing: '0.04em',
};

const ticketHintStyle: React.CSSProperties = {
  fontSize: '11px',
  color: '#64748b',
};

const memoryRowsStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column' as const,
  gap: '4px',
};

const memRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
};

const memLabelStyle: React.CSSProperties = {
  fontSize: '9px',
  fontWeight: 600,
  color: '#64748b',
  width: '32px',
  letterSpacing: '0.04em',
};

const memTrackStyle: React.CSSProperties = {
  flex: 1,
  height: '4px',
  background: 'rgba(255, 255, 255, 0.05)',
  borderRadius: '2px',
  overflow: 'hidden',
};

const memFillStyle = (color: string, pct: number): React.CSSProperties => ({
  height: '100%',
  width: `${Math.max(pct, 1)}%`,
  background: color,
  borderRadius: '2px',
  transition: 'width 0.4s ease',
  opacity: 0.6,
});

const memCountStyle: React.CSSProperties = {
  fontSize: '10px',
  fontWeight: 600,
  color: '#94a3b8',
  minWidth: '32px',
  textAlign: 'right' as const,
};
