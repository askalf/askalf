import { useCallback, useEffect, useMemo, useState } from 'react';
import { useHubStore } from '../../stores/hub';
import { usePolling } from '../../hooks/usePolling';
import './forge-observe.css';

type CostView = 'all' | 'api' | 'cli';

export default function CostDashboard() {
  const costSummary = useHubStore((s) => s.costSummary);
  const dailyCosts = useHubStore((s) => s.dailyCosts);
  const agents = useHubStore((s) => s.agents);
  const costAgentFilter = useHubStore((s) => s.costAgentFilter);
  const setCostAgentFilter = useHubStore((s) => s.setCostAgentFilter);
  const fetchCosts = useHubStore((s) => s.fetchCosts);
  const fetchAgents = useHubStore((s) => s.fetchAgents);
  const loading = useHubStore((s) => s.loading);
  const [view, setView] = useState<CostView>('all');

  const poll = useCallback(() => { fetchCosts(); }, [fetchCosts]);
  usePolling(poll, 30000);
  useEffect(() => { fetchAgents(); }, [fetchAgents]);

  // Pick the right summary bucket based on view
  const activeSummary = useMemo(() => {
    if (!costSummary) return null;
    if (view === 'api') return costSummary.api;
    if (view === 'cli') return costSummary.cli;
    return costSummary.total;
  }, [costSummary, view]);

  const sortedDaily = useMemo(() => {
    return [...dailyCosts].sort((a, b) => a.date.localeCompare(b.date));
  }, [dailyCosts]);

  // Derive daily cost for the active view
  const dailyForView = useMemo(() => {
    return sortedDaily.map((d) => ({
      ...d,
      viewCost: view === 'api' ? d.apiCost : view === 'cli' ? d.cliCost : d.totalCost,
      viewEvents: view === 'api' ? d.apiEvents : view === 'cli' ? d.cliEvents : d.eventCount,
    }));
  }, [sortedDaily, view]);

  const maxDailyCost = useMemo(() => {
    if (!dailyForView.length) return 1;
    return Math.max(...dailyForView.map((d) => d.viewCost), 0.01);
  }, [dailyForView]);

  const todayCost = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const entry = dailyForView.find((d) => d.date?.slice(0, 10) === today);
    return entry?.viewCost || 0;
  }, [dailyForView]);

  const avgPerEvent = useMemo(() => {
    if (!activeSummary || !activeSummary.totalEvents) return 0;
    return activeSummary.totalCost / activeSummary.totalEvents;
  }, [activeSummary]);

  const totalTokens = activeSummary
    ? activeSummary.totalInputTokens + activeSummary.totalOutputTokens
    : 0;

  const fmt = (n: number, decimals = 2) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return n.toFixed(decimals);
  };

  const viewLabel = view === 'api' ? 'API' : view === 'cli' ? 'CLI (OAuth)' : 'All Sources';

  return (
    <div className="cost-dash">
      {/* Header */}
      <div className="cost-header">
        <h2 className="cost-title">Cost Overview</h2>
        <div className="cost-header-controls">
          <div className="cost-view-toggle">
            <button className={`cost-view-btn ${view === 'all' ? 'active' : ''}`} onClick={() => setView('all')}>All</button>
            <button className={`cost-view-btn cost-view-api ${view === 'api' ? 'active' : ''}`} onClick={() => setView('api')}>API</button>
            <button className={`cost-view-btn cost-view-cli ${view === 'cli' ? 'active' : ''}`} onClick={() => setView('cli')}>CLI</button>
          </div>
          <select
            value={costAgentFilter}
            onChange={(e) => setCostAgentFilter(e.target.value)}
            className="fobs-select"
          >
            <option value="">All Agents</option>
            {agents.filter((a) => !a.is_decommissioned).map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Split summary cards when viewing "all" */}
      {view === 'all' && costSummary && (costSummary.api.totalCost > 0 || costSummary.cli.totalCost > 0) && (
        <div className="cost-split-row">
          <div className="cost-split-card cost-split-api">
            <div className="cost-split-label">API (billed)</div>
            <div className="cost-split-value">${costSummary.api.totalCost.toFixed(2)}</div>
            <div className="cost-split-meta">{costSummary.api.totalEvents} executions</div>
          </div>
          <div className="cost-split-card cost-split-cli">
            <div className="cost-split-label">CLI / OAuth (plan usage)</div>
            <div className="cost-split-value">${costSummary.cli.totalCost.toFixed(2)}</div>
            <div className="cost-split-meta">{costSummary.cli.totalEvents} executions</div>
          </div>
        </div>
      )}

      {/* KPI row */}
      <div className="cost-kpi-row">
        <div className="cost-kpi">
          <div className="cost-kpi-value">{activeSummary ? `$${activeSummary.totalCost.toFixed(2)}` : '—'}</div>
          <div className="cost-kpi-label">30-Day · {viewLabel}</div>
        </div>
        <div className="cost-kpi">
          <div className={`cost-kpi-value ${todayCost > 5 ? 'cost-kpi-warn' : ''}`}>
            {todayCost ? `$${todayCost.toFixed(4)}` : '$0.00'}
          </div>
          <div className="cost-kpi-label">Today</div>
        </div>
        <div className="cost-kpi">
          <div className="cost-kpi-value">{avgPerEvent ? `$${avgPerEvent.toFixed(4)}` : '—'}</div>
          <div className="cost-kpi-label">Avg / Execution</div>
        </div>
        <div className="cost-kpi">
          <div className="cost-kpi-value">{activeSummary?.totalEvents?.toLocaleString() || '0'}</div>
          <div className="cost-kpi-label">Executions</div>
        </div>
        <div className="cost-kpi">
          <div className="cost-kpi-value">{fmt(totalTokens, 0)}</div>
          <div className="cost-kpi-label">Total Tokens</div>
        </div>
      </div>

      {/* Bar chart */}
      <div className="cost-chart-panel">
        <div className="cost-chart-title">Daily Spend — {viewLabel}</div>
        {loading['costs'] && sortedDaily.length === 0 ? (
          <div className="cost-chart-empty">Loading cost data...</div>
        ) : sortedDaily.length === 0 ? (
          <div className="cost-chart-empty">No cost data yet. Run agent executions to see spend.</div>
        ) : (
          <div className="cost-chart">
            {dailyForView.map((day) => {
              const pct = Math.max((day.viewCost / maxDailyCost) * 100, 2);
              const isToday = day.date.slice(0, 10) === new Date().toISOString().slice(0, 10);
              return (
                <div key={day.date} className={`cost-bar-col ${isToday ? 'cost-bar-today' : ''}`}>
                  <div className="cost-bar-tooltip">
                    <div className="cost-bar-tip-date">{day.date.slice(5)}</div>
                    <div className="cost-bar-tip-cost">${day.viewCost.toFixed(4)}</div>
                    <div className="cost-bar-tip-meta">{day.viewEvents} exec · {fmt(day.totalInputTokens + day.totalOutputTokens, 0)} tok</div>
                    {view === 'all' && (day.apiCost > 0 || day.cliCost > 0) && (
                      <div className="cost-bar-tip-split">
                        <span className="cost-tip-api">API ${day.apiCost.toFixed(4)}</span>
                        <span className="cost-tip-cli">CLI ${day.cliCost.toFixed(4)}</span>
                      </div>
                    )}
                  </div>
                  <div className="cost-bar-track">
                    <div className={`cost-bar-fill ${view === 'api' ? 'cost-bar-fill-api' : view === 'cli' ? 'cost-bar-fill-cli' : ''}`} style={{ height: `${pct}%` }} />
                  </div>
                  <div className="cost-bar-date">{day.date.slice(8)}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Breakdown table */}
      {sortedDaily.length > 0 && (
        <div className="cost-table-panel">
          <div className="cost-chart-title">Daily Breakdown</div>
          <div className="fobs-table-wrap">
            <table className="fobs-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th style={{ textAlign: 'right' }}>Total</th>
                  <th style={{ textAlign: 'right' }}>API</th>
                  <th style={{ textAlign: 'right' }}>CLI</th>
                  <th style={{ textAlign: 'right' }}>Execs</th>
                  <th style={{ textAlign: 'right' }}>Tokens</th>
                </tr>
              </thead>
              <tbody>
                {[...sortedDaily].reverse().map((day) => (
                  <tr key={day.date}>
                    <td>{day.date.slice(0, 10)}</td>
                    <td className="fobs-mono" style={{ textAlign: 'right' }}>${day.totalCost.toFixed(4)}</td>
                    <td className="fobs-mono" style={{ textAlign: 'right', color: 'var(--crystal-lighter, #a78bfa)' }}>${day.apiCost.toFixed(4)}</td>
                    <td className="fobs-mono" style={{ textAlign: 'right', color: '#60a5fa' }}>${day.cliCost.toFixed(4)}</td>
                    <td style={{ textAlign: 'right' }}>{day.eventCount}</td>
                    <td style={{ textAlign: 'right' }}>{fmt(day.totalInputTokens + day.totalOutputTokens, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
