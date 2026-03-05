import { useState, useEffect, useCallback, useRef } from 'react';
import { hubApi, type TimelineExecution } from '../../hooks/useHubApi';

// ---- Types ----
interface AgentRow {
  agentId: string;
  agentName: string;
  execs: TimelineExecution[];
}

type TimeRange = 2 | 6 | 12 | 24;

// ---- Helpers ----
const STATUS_COLORS: Record<string, string> = {
  completed: 'var(--color-success, #22c55e)',
  failed: 'var(--color-danger, #ef4444)',
  timeout: '#f97316',
  cancelled: '#6b7280',
  running: '#3b82f6',
  pending: '#6b7280',
};

function statusColor(status: string): string {
  return STATUS_COLORS[status] ?? '#6b7280';
}

function fmtDuration(ms: number | null): string {
  if (!ms) return '—';
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  return `${Math.round(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

function fmtCost(cost: number): string {
  if (cost === 0) return '$0';
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(3)}`;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export default function AgentTimeline() {
  const [hours, setHours] = useState<TimeRange>(6);
  const [rows, setRows] = useState<AgentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rangeStart, setRangeStart] = useState<Date>(new Date());
  const [rangeEnd, setRangeEnd] = useState<Date>(new Date());
  const [tooltip, setTooltip] = useState<{ exec: TimelineExecution; x: number; y: number } | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const data = await hubApi.timeline.executions(hours);
      const end = new Date();
      const start = new Date(end.getTime() - hours * 60 * 60 * 1000);
      setRangeEnd(end);
      setRangeStart(start);

      // Group by agent
      const agentMap = new Map<string, AgentRow>();
      for (const exec of data.executions) {
        const key = exec.agent_id;
        if (!agentMap.has(key)) {
          agentMap.set(key, { agentId: exec.agent_id, agentName: exec.agent_name, execs: [] });
        }
        agentMap.get(key)!.execs.push(exec);
      }

      // Sort agents alphabetically, then sort executions by start time
      const sorted = Array.from(agentMap.values())
        .sort((a, b) => a.agentName.localeCompare(b.agentName));
      for (const row of sorted) {
        row.execs.sort((a, b) =>
          new Date(a.started_at).getTime() - new Date(b.started_at).getTime()
        );
      }

      setRows(sorted);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load timeline');
    } finally {
      setLoading(false);
    }
  }, [hours]);

  useEffect(() => {
    setLoading(true);
    load();
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, [load]);

  // Close tooltip on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (tooltipRef.current && !tooltipRef.current.contains(e.target as Node)) {
        setTooltip(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const rangeMs = rangeEnd.getTime() - rangeStart.getTime();

  function barStyle(exec: TimelineExecution): React.CSSProperties {
    const start = new Date(exec.started_at).getTime();
    const end = exec.completed_at
      ? new Date(exec.completed_at).getTime()
      : exec.status === 'running' ? rangeEnd.getTime() : start + 5000;

    const left = Math.max(0, (start - rangeStart.getTime()) / rangeMs) * 100;
    const width = Math.max(0.3, ((end - start) / rangeMs) * 100);

    return {
      left: `${left}%`,
      width: `${Math.min(width, 100 - left)}%`,
      background: statusColor(exec.status),
    };
  }

  function handleBarClick(e: React.MouseEvent, exec: TimelineExecution) {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).closest('.atl-track-area')?.getBoundingClientRect();
    if (!rect) return;
    setTooltip({ exec, x: e.clientX - rect.left, y: e.clientY - rect.top });
  }

  // Time axis ticks
  const tickCount = hours <= 6 ? hours * 4 : hours; // 15min ticks for ≤6h, hourly for longer
  const ticks = Array.from({ length: tickCount + 1 }, (_, i) => {
    const ts = new Date(rangeStart.getTime() + (i / tickCount) * rangeMs);
    return { pct: (i / tickCount) * 100, label: ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) };
  });
  // Show fewer tick labels to avoid crowding
  const labelEvery = hours <= 6 ? 4 : 6;

  if (loading) {
    return <div className="hub-loading">Loading timeline…</div>;
  }

  if (error) {
    return (
      <div className="hub-empty">
        <div className="hub-empty__icon">⚠</div>
        <div className="hub-empty__title">Failed to load</div>
        <div className="hub-empty__message">{error}</div>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="hub-empty">
        <div className="hub-empty__icon">📋</div>
        <div className="hub-empty__title">No executions</div>
        <div className="hub-empty__message">No agent executions in the last {hours} hours.</div>
      </div>
    );
  }

  return (
    <div className="atl-root">
      {/* Header */}
      <div className="atl-header">
        <div className="atl-title">
          Agent Activity Timeline
          <span className="atl-count">{rows.reduce((s, r) => s + r.execs.length, 0)} executions</span>
        </div>
        <div className="atl-controls">
          {([2, 6, 12, 24] as TimeRange[]).map(h => (
            <button
              key={h}
              className={`atl-range-btn${hours === h ? ' active' : ''}`}
              onClick={() => setHours(h)}
            >
              {h}h
            </button>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="atl-legend">
        {Object.entries(STATUS_COLORS).map(([s, c]) => (
          <span key={s} className="atl-legend-item">
            <span className="atl-legend-dot" style={{ background: c }} />
            {s}
          </span>
        ))}
      </div>

      {/* Chart */}
      <div className="atl-chart">
        {/* Agent labels */}
        <div className="atl-labels">
          <div className="atl-label-spacer" />
          {rows.map(row => (
            <div key={row.agentId} className="atl-label">{row.agentName}</div>
          ))}
        </div>

        {/* Tracks area */}
        <div className="atl-track-area" onClick={() => setTooltip(null)}>
          {/* Time axis */}
          <div className="atl-axis">
            {ticks.map((t, i) => (
              <div key={i} className="atl-tick" style={{ left: `${t.pct}%` }}>
                <div className="atl-tick-line" />
                {i % labelEvery === 0 && (
                  <div className="atl-tick-label">{t.label}</div>
                )}
              </div>
            ))}
          </div>

          {/* Agent rows */}
          {rows.map(row => (
            <div key={row.agentId} className="atl-track">
              {/* Grid lines */}
              {ticks.map((t, i) => (
                <div key={i} className="atl-grid-line" style={{ left: `${t.pct}%` }} />
              ))}
              {/* Execution bars */}
              {row.execs.map(exec => (
                <div
                  key={exec.id}
                  className={`atl-bar atl-bar--${exec.status}`}
                  style={barStyle(exec)}
                  onClick={e => handleBarClick(e, exec)}
                  title={`${exec.status} · ${fmtDuration(exec.duration_ms)} · ${fmtCost(exec.cost)}`}
                  role="button"
                  tabIndex={0}
                  aria-label={`${row.agentName} execution: ${exec.status}`}
                  onKeyDown={e => e.key === 'Enter' && handleBarClick(e as unknown as React.MouseEvent, exec)}
                />
              ))}
            </div>
          ))}

          {/* Tooltip */}
          {tooltip && (
            <div
              ref={tooltipRef}
              className="atl-tooltip"
              style={{
                left: Math.min(tooltip.x + 8, 520),
                top: tooltip.y + 8,
              }}
              onClick={e => e.stopPropagation()}
            >
              <div className="atl-tooltip-agent">{tooltip.exec.agent_name}</div>
              <div className="atl-tooltip-row">
                <span className="atl-tooltip-dot" style={{ background: statusColor(tooltip.exec.status) }} />
                <strong>{tooltip.exec.status}</strong>
              </div>
              <div className="atl-tooltip-row">Start: {fmtTime(tooltip.exec.started_at)}</div>
              {tooltip.exec.completed_at && (
                <div className="atl-tooltip-row">End: {fmtTime(tooltip.exec.completed_at)}</div>
              )}
              <div className="atl-tooltip-row">Duration: {fmtDuration(tooltip.exec.duration_ms)}</div>
              <div className="atl-tooltip-row">Cost: {fmtCost(tooltip.exec.cost)}</div>
              {tooltip.exec.tokens > 0 && (
                <div className="atl-tooltip-row">Tokens: {tooltip.exec.tokens.toLocaleString()}</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
