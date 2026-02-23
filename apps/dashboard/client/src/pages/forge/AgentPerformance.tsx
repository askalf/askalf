import { useState, useEffect, useCallback } from 'react';
import { hubApi, type AgentPerformanceEntry, type AgentPerformanceReport } from '../../hooks/useHubApi';
import StatCard from '../hub/shared/StatCard';
import EmptyState from '../hub/shared/EmptyState';
import './forge-observe.css';

type SortKey = 'totalExecutions' | 'successRate' | 'failureRate' | 'avgDurationMs' | 'totalCost' | 'ticketsCompleted';
type SortDir = 'asc' | 'desc';

const DAY_OPTIONS = [1, 7, 30] as const;
type DayRange = typeof DAY_OPTIONS[number];

export default function AgentPerformance() {
  const [report, setReport] = useState<AgentPerformanceReport | null>(null);
  const [days, setDays] = useState<DayRange>(7);
  const [sortKey, setSortKey] = useState<SortKey>('totalExecutions');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await hubApi.agents.performance(days);
      setReport(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load performance data');
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const sorted = report
    ? [...report.agents].sort((a, b) => {
        const av = a[sortKey] as number;
        const bv = b[sortKey] as number;
        return sortDir === 'desc' ? bv - av : av - bv;
      })
    : [];

  const fleet = report?.fleet;

  function SortHeader({ label, k }: { label: string; k: SortKey }) {
    const active = sortKey === k;
    return (
      <th
        style={{ padding: '8px', cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
        onClick={() => handleSort(k)}
      >
        <span style={{ opacity: active ? 1 : 0.5, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
          {label}
          {active && <span style={{ fontSize: '10px' }}>{sortDir === 'desc' ? '↓' : '↑'}</span>}
        </span>
      </th>
    );
  }

  function SuccessBar({ rate }: { rate: number }) {
    const color = rate >= 80 ? '#4ade80' : rate >= 50 ? '#eab308' : '#ef4444';
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <div style={{ width: '50px', height: '6px', borderRadius: '3px', background: 'rgba(255,255,255,0.1)', flexShrink: 0 }}>
          <div style={{ width: `${Math.min(rate, 100)}%`, height: '100%', borderRadius: '3px', background: color }} />
        </div>
        <span>{rate.toFixed(1)}%</span>
      </div>
    );
  }

  return (
    <div className="fo-overview">
      {/* Summary Cards */}
      <div className="fo-stats">
        <StatCard
          value={fleet?.totalExecutions ?? '—'}
          label="Total Executions"
        />
        <StatCard
          value={fleet ? `${fleet.successRate.toFixed(1)}%` : '—'}
          label="Fleet Success Rate"
          variant={fleet && fleet.successRate >= 80 ? 'success' : 'warning'}
        />
        <StatCard
          value={fleet ? `${fleet.failureRate.toFixed(1)}%` : '—'}
          label="Fleet Failure Rate"
          variant={fleet && fleet.failureRate > 20 ? 'danger' : undefined}
        />
        <StatCard
          value={fleet ? `$${fleet.totalCost.toFixed(4)}` : '—'}
          label="Total Cost"
        />
      </div>

      <div className="fo-section">
        <div className="fo-section-header">
          <h3>Agent Performance</h3>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <span style={{ fontSize: '12px', opacity: 0.5 }}>Last</span>
            {DAY_OPTIONS.map((d) => (
              <button
                key={d}
                className={`hub-btn hub-btn--sm ${days === d ? 'hub-btn--primary' : ''}`}
                onClick={() => setDays(d)}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>

        {loading && <div className="fo-empty">Loading performance data...</div>}

        {error && !loading && (
          <div className="fo-error-state" style={{ margin: '1rem 0' }}>
            <span>{error}</span>
            <button className="hub-btn hub-btn--sm" onClick={load} style={{ marginLeft: '12px' }}>Retry</button>
          </div>
        )}

        {!loading && !error && sorted.length === 0 && (
          <EmptyState message="No execution data for this period" />
        )}

        {!loading && !error && sorted.length > 0 && (
          <table style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ fontSize: '11px', textAlign: 'left' }}>
                <th style={{ padding: '8px', opacity: 0.5 }}>#</th>
                <th style={{ padding: '8px', opacity: 0.5 }}>Agent</th>
                <SortHeader label="Executions" k="totalExecutions" />
                <SortHeader label="Success Rate" k="successRate" />
                <SortHeader label="Failure Rate" k="failureRate" />
                <SortHeader label="Avg Duration" k="avgDurationMs" />
                <SortHeader label="Total Cost" k="totalCost" />
                <SortHeader label="Tickets" k="ticketsCompleted" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((entry: AgentPerformanceEntry, i) => (
                <tr
                  key={entry.agentId}
                  style={{
                    borderBottom: '1px solid rgba(255,255,255,0.04)',
                    background: i < 3 ? 'rgba(99,102,241,0.03)' : undefined,
                  }}
                >
                  <td style={{ padding: '8px', fontWeight: 700, color: i === 0 ? '#fbbf24' : i === 1 ? '#94a3b8' : i === 2 ? '#cd7f32' : undefined }}>
                    {i + 1}
                  </td>
                  <td style={{ padding: '8px', fontWeight: 600 }}>{entry.agentName}</td>
                  <td style={{ padding: '8px' }}>
                    <span>{entry.totalExecutions}</span>
                    <span style={{ fontSize: '11px', opacity: 0.45, marginLeft: '6px' }}>
                      ({entry.completed}✓ {entry.failed}✗ {entry.cancelled}⊘)
                    </span>
                  </td>
                  <td style={{ padding: '8px' }}>
                    <SuccessBar rate={entry.successRate} />
                  </td>
                  <td style={{ padding: '8px', color: entry.failureRate > 20 ? '#f87171' : undefined }}>
                    {entry.failureRate.toFixed(1)}%
                  </td>
                  <td style={{ padding: '8px' }}>
                    {entry.avgDurationMs > 0
                      ? entry.avgDurationMs >= 60000
                        ? `${(entry.avgDurationMs / 60000).toFixed(1)}m`
                        : `${(entry.avgDurationMs / 1000).toFixed(1)}s`
                      : '—'}
                  </td>
                  <td style={{ padding: '8px' }}>${entry.totalCost.toFixed(4)}</td>
                  <td style={{ padding: '8px' }}>{entry.ticketsCompleted}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
