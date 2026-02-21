import { useEffect, useState, useMemo } from 'react';
import { hubApi, type TimelineExecution } from '../../hooks/useHubApi';

const MODEL_COLORS: Record<string, string> = {
  opus: '#a78bfa',
  sonnet: '#60a5fa',
  haiku: '#34d399',
  unknown: '#9ca3af',
};

const STATUS_OPACITY: Record<string, number> = {
  completed: 1,
  running: 0.8,
  failed: 0.6,
  pending: 0.4,
};

const formatDuration = (ms: number | null) => {
  if (!ms) return '-';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
};

const formatTime = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
};

const formatCost = (cost: number) => {
  if (!cost || !Number.isFinite(cost)) return '$0';
  return `$${cost.toFixed(4)}`;
};

export default function ExecutionTimeline() {
  const [executions, setExecutions] = useState<TimelineExecution[]>([]);
  const [hours, setHours] = useState(24);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<TimelineExecution | null>(null);
  const [now, setNow] = useState(Date.now());

  const fetchTimeline = async () => {
    try {
      setLoading(true);
      const data = await hubApi.timeline.executions(hours);
      setExecutions(data.executions);
    } catch (err) {
      console.error('Failed to load timeline:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchTimeline(); }, [hours]);

  // Auto-refresh every 30s + update "now" marker
  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Date.now());
      fetchTimeline();
    }, 30000);
    return () => clearInterval(interval);
  }, [hours]);

  // Group executions by agent
  const agentGroups = useMemo(() => {
    const groups = new Map<string, { name: string; executions: TimelineExecution[] }>();
    for (const exec of executions) {
      const key = exec.agent_id;
      if (!groups.has(key)) {
        groups.set(key, { name: exec.agent_name, executions: [] });
      }
      groups.get(key)!.executions.push(exec);
    }
    // Sort by execution count descending
    return [...groups.entries()].sort((a, b) => b[1].executions.length - a[1].executions.length);
  }, [executions]);

  // Time range for the timeline
  const timeRange = useMemo(() => {
    return { start: now - hours * 3600 * 1000, end: now };
  }, [hours, now]);

  const totalRange = timeRange.end - timeRange.start;

  // Stats
  const stats = useMemo(() => {
    const totalCost = executions.reduce((s, e) => s + (Number.isFinite(e.cost) ? e.cost : 0), 0);
    const completed = executions.filter(e => e.status === 'completed').length;
    const failed = executions.filter(e => e.status === 'failed').length;
    const running = executions.filter(e => e.status === 'running').length;
    const modelCounts = { opus: 0, sonnet: 0, haiku: 0, unknown: 0 };
    for (const e of executions) modelCounts[e.model_tier]++;
    return { total: executions.length, completed, failed, running, totalCost, modelCounts };
  }, [executions]);

  // Hour tick marks
  const hourTicks = useMemo(() => {
    const ticks: { label: string; pct: number }[] = [];
    const startHour = new Date(timeRange.start);
    startHour.setMinutes(0, 0, 0);
    let t = startHour.getTime() + 3600000;
    while (t < timeRange.end) {
      const pct = ((t - timeRange.start) / totalRange) * 100;
      if (pct > 0 && pct < 100) {
        const d = new Date(t);
        ticks.push({ label: d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }), pct });
      }
      t += 3600000;
    }
    return ticks;
  }, [timeRange, totalRange]);

  return (
    <div style={{ padding: '0' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>Execution Timeline</h2>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            {stats.total} executions in the last {hours}h
          </span>
        </div>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          {[6, 12, 24, 48].map(h => (
            <button
              key={h}
              onClick={() => setHours(h)}
              style={{
                padding: '4px 10px',
                fontSize: '0.75rem',
                borderRadius: '6px',
                border: '1px solid var(--border)',
                background: hours === h ? 'var(--accent)' : 'var(--bg-secondary)',
                color: hours === h ? '#fff' : 'var(--text-secondary)',
                cursor: 'pointer',
                fontWeight: hours === h ? 600 : 400,
              }}
            >
              {h}h
            </button>
          ))}
          <button
            onClick={fetchTimeline}
            style={{
              padding: '4px 10px',
              fontSize: '0.75rem',
              borderRadius: '6px',
              border: '1px solid var(--border)',
              background: 'var(--bg-secondary)',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
            }}
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Stats bar */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <StatPill label="Total" value={stats.total} />
        <StatPill label="Completed" value={stats.completed} color="#34d399" />
        <StatPill label="Failed" value={stats.failed} color={stats.failed > 0 ? '#f87171' : undefined} />
        <StatPill label="Running" value={stats.running} color={stats.running > 0 ? '#fbbf24' : undefined} />
        <StatPill label="Cost" value={formatCost(stats.totalCost)} />
        {/* Model legend */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginLeft: 'auto', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
          {(['opus', 'sonnet', 'haiku'] as const).map(m => (
            <span key={m} style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: MODEL_COLORS[m], display: 'inline-block' }} />
              {m} ({stats.modelCounts[m]})
            </span>
          ))}
        </div>
      </div>

      {/* Timeline */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>Loading timeline...</div>
      ) : agentGroups.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>No executions in this time range</div>
      ) : (
        <div style={{ border: '1px solid var(--border)', borderRadius: '8px', overflow: 'hidden', background: 'var(--bg-secondary)' }}>
          {/* Time axis */}
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--bg-primary)' }}>
            <div style={{ width: '140px', minWidth: '140px', borderRight: '1px solid var(--border)' }} />
            <div style={{ flex: 1, position: 'relative', height: '24px' }}>
              {hourTicks.filter((_, i) => i % Math.max(1, Math.floor(hourTicks.length / 12)) === 0).map((tick, i) => (
                <span
                  key={i}
                  style={{
                    position: 'absolute',
                    left: `${tick.pct}%`,
                    top: '50%',
                    transform: 'translate(-50%, -50%)',
                    fontSize: '0.6rem',
                    color: 'var(--text-tertiary)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {tick.label}
                </span>
              ))}
              {/* Now marker */}
              <div style={{
                position: 'absolute',
                right: 0,
                top: 0,
                bottom: 0,
                width: '2px',
                background: '#f87171',
                opacity: 0.7,
              }} />
            </div>
          </div>

          {/* Agent rows */}
          {agentGroups.map(([agentId, group]) => (
            <div
              key={agentId}
              style={{
                display: 'flex',
                borderBottom: '1px solid var(--border)',
                minHeight: '32px',
              }}
            >
              {/* Agent label */}
              <div style={{
                width: '140px',
                minWidth: '140px',
                padding: '4px 8px',
                fontSize: '0.7rem',
                fontWeight: 600,
                color: 'var(--text-secondary)',
                display: 'flex',
                alignItems: 'center',
                borderRight: '1px solid var(--border)',
                background: 'var(--bg-primary)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                <span title={group.name} style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{group.name}</span>
                <span style={{ marginLeft: '4px', fontSize: '0.6rem', color: 'var(--text-tertiary)', fontWeight: 400 }}>
                  ({group.executions.length})
                </span>
              </div>

              {/* Timeline bar area */}
              <div style={{ flex: 1, position: 'relative', minHeight: '28px' }}>
                {/* Now marker */}
                <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '2px', background: '#f87171', opacity: 0.3, pointerEvents: 'none', zIndex: 1 }} />
                {group.executions.map(exec => {
                  const startMs = new Date(exec.started_at).getTime();
                  const endMs = exec.completed_at
                    ? new Date(exec.completed_at).getTime()
                    : exec.duration_ms ? startMs + exec.duration_ms : startMs + 60000;
                  const leftPct = Math.max(0, ((startMs - timeRange.start) / totalRange) * 100);
                  const widthPct = Math.max(0.3, ((endMs - startMs) / totalRange) * 100);

                  return (
                    <div
                      key={exec.id}
                      onClick={() => setSelected(selected?.id === exec.id ? null : exec)}
                      title={`${exec.agent_name} | ${exec.status} | ${formatDuration(exec.duration_ms)} | ${formatCost(exec.cost)}`}
                      style={{
                        position: 'absolute',
                        left: `${leftPct}%`,
                        width: `${Math.min(widthPct, 100 - leftPct)}%`,
                        top: '3px',
                        bottom: '3px',
                        minWidth: '4px',
                        background: MODEL_COLORS[exec.model_tier],
                        opacity: STATUS_OPACITY[exec.status] ?? 0.7,
                        borderRadius: '3px',
                        cursor: 'pointer',
                        border: selected?.id === exec.id ? '2px solid #fff' : exec.status === 'failed' ? '1px solid #f87171' : 'none',
                        boxSizing: 'border-box',
                        transition: 'opacity 0.15s',
                      }}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Detail panel */}
      {selected && (
        <div style={{
          marginTop: '12px',
          padding: '12px 16px',
          border: '1px solid var(--border)',
          borderRadius: '8px',
          background: 'var(--bg-primary)',
          fontSize: '0.8rem',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <strong>{selected.agent_name}</strong>
            <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1rem' }}>
              &times;
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '8px' }}>
            <DetailItem label="Status" value={selected.status} color={selected.status === 'completed' ? '#34d399' : selected.status === 'failed' ? '#f87171' : '#fbbf24'} />
            <DetailItem label="Model" value={selected.model_tier} color={MODEL_COLORS[selected.model_tier]} />
            <DetailItem label="Started" value={formatTime(selected.started_at)} />
            <DetailItem label="Duration" value={formatDuration(selected.duration_ms)} />
            <DetailItem label="Cost" value={formatCost(selected.cost)} />
            <DetailItem label="Tokens" value={selected.tokens.toLocaleString()} />
          </div>
          <div style={{ marginTop: '6px', fontSize: '0.65rem', color: 'var(--text-tertiary)', fontFamily: 'monospace' }}>
            ID: {selected.id}
          </div>
        </div>
      )}
    </div>
  );
}

function StatPill({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div style={{
      padding: '4px 10px',
      borderRadius: '6px',
      background: 'var(--bg-primary)',
      border: '1px solid var(--border)',
      fontSize: '0.75rem',
      display: 'flex',
      gap: '4px',
      alignItems: 'center',
    }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontWeight: 600, color: color || 'var(--text-primary)' }}>{value}</span>
    </div>
  );
}

function DetailItem({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)', marginBottom: '2px' }}>{label}</div>
      <div style={{ fontWeight: 600, color: color || 'var(--text-primary)' }}>{value}</div>
    </div>
  );
}
