import { useCallback, useEffect, useMemo } from 'react';
import { useHubStore } from '../../stores/hub';
import { usePolling } from '../../hooks/usePolling';
import StatCard from '../hub/shared/StatCard';
import './forge-observe.css';

export default function CostDashboard() {
  const costSummary = useHubStore((s) => s.costSummary);
  const dailyCosts = useHubStore((s) => s.dailyCosts);
  const agents = useHubStore((s) => s.agents);
  const costAgentFilter = useHubStore((s) => s.costAgentFilter);
  const setCostAgentFilter = useHubStore((s) => s.setCostAgentFilter);
  const fetchCosts = useHubStore((s) => s.fetchCosts);
  const fetchAgents = useHubStore((s) => s.fetchAgents);
  const loading = useHubStore((s) => s.loading);

  const poll = useCallback(() => {
    fetchCosts();
  }, [fetchCosts]);
  usePolling(poll, 30000);

  // Fetch agents for filter dropdown
  useEffect(() => { fetchAgents(); }, [fetchAgents]);

  const maxDailyCost = useMemo(() => {
    if (!dailyCosts.length) return 1;
    return Math.max(...dailyCosts.map((d) => d.totalCost), 0.01);
  }, [dailyCosts]);

  const avgPerEvent = useMemo(() => {
    if (!costSummary || !costSummary.totalEvents) return 0;
    return costSummary.totalCost / costSummary.totalEvents;
  }, [costSummary]);

  const todayCost = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const todayEntry = dailyCosts.find((d) => d.date?.slice(0, 10) === today);
    return todayEntry?.totalCost || 0;
  }, [dailyCosts]);

  const sortedDaily = useMemo(() => {
    return [...dailyCosts].sort((a, b) => a.date.localeCompare(b.date));
  }, [dailyCosts]);

  return (
    <div className="fo-overview">
      {/* Stat Cards */}
      <div className="fo-stats">
        <StatCard
          value={costSummary ? `$${costSummary.totalCost.toFixed(2)}` : '-'}
          label="30-Day Spend"
          variant={costSummary && costSummary.totalCost > 50 ? 'warning' : 'default'}
        />
        <StatCard
          value={todayCost ? `$${todayCost.toFixed(4)}` : '$0'}
          label="Today"
          variant={todayCost > 5 ? 'warning' : 'default'}
        />
        <StatCard
          value={avgPerEvent ? `$${avgPerEvent.toFixed(4)}` : '-'}
          label="Avg / Execution"
        />
        <StatCard
          value={costSummary?.totalEvents || 0}
          label="Total Events"
        />
        <StatCard
          value={costSummary ? `${(costSummary.totalInputTokens / 1000).toFixed(0)}k` : '-'}
          label="Input Tokens"
        />
        <StatCard
          value={costSummary ? `${(costSummary.totalOutputTokens / 1000).toFixed(0)}k` : '-'}
          label="Output Tokens"
        />
      </div>

      {/* Agent Filter */}
      <div className="fobs-filter-bar">
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

      {/* Daily Cost Chart */}
      <div className="fo-panel">
        <div className="fo-panel-header">
          <span className="fo-panel-title">Daily Costs (30 days)</span>
        </div>
        {loading['costs'] && sortedDaily.length === 0 ? (
          <p className="fo-empty">Loading cost data...</p>
        ) : sortedDaily.length === 0 ? (
          <p className="fo-empty">No cost data yet</p>
        ) : (
          <div className="fobs-bar-chart">
            {sortedDaily.map((day) => (
              <div key={day.date} className="fobs-bar-col">
                <div className="fobs-bar-value">${day.totalCost.toFixed(2)}</div>
                <div className="fobs-bar-track">
                  <div
                    className="fobs-bar-fill"
                    style={{ height: `${Math.max((day.totalCost / maxDailyCost) * 100, 2)}%` }}
                  />
                </div>
                <div className="fobs-bar-label">{day.date.slice(5)}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Daily Breakdown Table */}
      {sortedDaily.length > 0 && (
        <div className="fo-panel" style={{ marginTop: '1rem' }}>
          <div className="fo-panel-header">
            <span className="fo-panel-title">Breakdown</span>
          </div>
          <div className="fobs-table-wrap">
            <table className="fobs-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Cost</th>
                  <th>Events</th>
                  <th>Input Tokens</th>
                  <th>Output Tokens</th>
                </tr>
              </thead>
              <tbody>
                {[...sortedDaily].reverse().map((day) => (
                  <tr key={day.date}>
                    <td>{day.date.slice(0, 10)}</td>
                    <td className="fobs-mono">${day.totalCost.toFixed(4)}</td>
                    <td>{day.eventCount}</td>
                    <td>{day.totalInputTokens.toLocaleString()}</td>
                    <td>{day.totalOutputTokens.toLocaleString()}</td>
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
