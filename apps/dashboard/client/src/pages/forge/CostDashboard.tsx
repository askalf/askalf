import { useCallback, useEffect, useMemo, useState } from 'react';
import { useHubStore } from '../../stores/hub';
import { usePolling } from '../../hooks/usePolling';
import type { AgentCost } from '../../hooks/useHubApi';
import './forge-observe.css';

type CostView = 'all' | 'api' | 'cli';

export default function CostDashboard() {
  const costSummary = useHubStore((s) => s.costSummary);
  const dailyCosts = useHubStore((s) => s.dailyCosts);
  const agentCosts = useHubStore((s) => s.agentCosts);
  const agents = useHubStore((s) => s.agents);
  const costAgentFilter = useHubStore((s) => s.costAgentFilter);
  const setCostAgentFilter = useHubStore((s) => s.setCostAgentFilter);
  const fetchCosts = useHubStore((s) => s.fetchCosts);
  const fetchAgents = useHubStore((s) => s.fetchAgents);
  const loading = useHubStore((s) => s.loading);
  const [view, setView] = useState<CostView>('all');
  const [budgetLimit, setBudgetLimit] = useState<{ perExecution: number; perDay: number } | null>(null);

  const poll = useCallback(() => { fetchCosts(); }, [fetchCosts]);
  usePolling(poll, 30000);
  useEffect(() => { fetchAgents(); }, [fetchAgents]);

  // Fetch budget limits from guardrails
  useEffect(() => {
    fetch('/api/v1/admin/guardrails', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const g = data?.guardrails?.find((g: any) => g.type === 'cost_limit' && g.is_enabled);
        if (g?.config) {
          setBudgetLimit({
            perExecution: g.config.maxCostPerExecution ?? 0,
            perDay: g.config.maxCostPerDay ?? 0,
          });
        }
      })
      .catch(() => {});
  }, []);

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

  const sortedAgentCosts = useMemo<AgentCost[]>(() => {
    return [...agentCosts].sort((a, b) => b.totalCost - a.totalCost).slice(0, 12);
  }, [agentCosts]);

  const maxAgentCost = useMemo(() => {
    if (!sortedAgentCosts.length) return 1;
    return Math.max(...sortedAgentCosts.map((a) => a.totalCost), 0.0001);
  }, [sortedAgentCosts]);

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
            <div className="cost-split-label">CLI / OAuth (subscription)</div>
            <div className="cost-split-value">$0.00</div>
            <div className="cost-split-meta">{costSummary.cli.totalEvents} executions</div>
            {(costSummary.cli as { estimatedCost?: number }).estimatedCost ? (
              <div className="cost-split-est">~${((costSummary.cli as { estimatedCost?: number }).estimatedCost ?? 0).toFixed(2)} est. if billed</div>
            ) : null}
          </div>
        </div>
      )}

      {/* Budget progress bar */}
      {budgetLimit && budgetLimit.perDay > 0 && (
        <div className="cost-budget-row">
          <div className="cost-budget-info">
            <span className="cost-budget-label">Daily Budget</span>
            <span className="cost-budget-numbers">
              ${todayCost.toFixed(2)} / ${budgetLimit.perDay.toFixed(2)}
            </span>
          </div>
          <div className="cost-budget-bar">
            <div
              className={`cost-budget-fill${todayCost / budgetLimit.perDay > 0.8 ? todayCost / budgetLimit.perDay >= 1 ? ' cost-budget-over' : ' cost-budget-warn' : ''}`}
              style={{ width: `${Math.min((todayCost / budgetLimit.perDay) * 100, 100)}%` }}
            />
          </div>
          {budgetLimit.perExecution > 0 && (
            <div className="cost-budget-sub">${budgetLimit.perExecution.toFixed(2)} per-execution limit</div>
          )}
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

      {/* Agent breakdown chart */}
      {sortedAgentCosts.length > 0 && (
        <div className="cost-chart-panel">
          <div className="cost-chart-title">Cost by Agent — {viewLabel}</div>
          <div className="cost-agent-chart">
            {sortedAgentCosts.map((agent) => {
              const pct = (agent.totalCost / maxAgentCost) * 100;
              return (
                <div key={agent.agentId} className="cost-agent-row">
                  <div className="cost-agent-name" title={agent.agentName}>{agent.agentName}</div>
                  <div className="cost-agent-bar-track">
                    <div
                      className={`cost-agent-bar-fill ${view === 'api' ? 'cost-bar-fill-api' : view === 'cli' ? 'cost-bar-fill-cli' : ''}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="cost-agent-value">${agent.totalCost.toFixed(4)}</div>
                  <div className="cost-agent-meta">{agent.totalEvents} exec</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

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
                    {view === 'all' && (day.apiCost > 0 || day.cliEvents > 0) && (
                      <div className="cost-bar-tip-split">
                        <span className="cost-tip-api">API ${day.apiCost.toFixed(4)}</span>
                        <span className="cost-tip-cli">CLI {day.cliEvents} runs{day.cliEstimatedCost ? ` (~$${day.cliEstimatedCost.toFixed(2)} est.)` : ''}</span>
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
                  <th style={{ textAlign: 'right' }}>Billed</th>
                  <th style={{ textAlign: 'right' }}>API</th>
                  <th style={{ textAlign: 'right' }}>CLI Est.</th>
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
                    <td className="fobs-mono" style={{ textAlign: 'right', color: '#60a5fa' }}>{day.cliEstimatedCost ? `~$${day.cliEstimatedCost.toFixed(2)}` : '$0.00'}</td>
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
