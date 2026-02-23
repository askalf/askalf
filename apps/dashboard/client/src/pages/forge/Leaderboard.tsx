import { useState, useEffect, useCallback } from 'react';
import { hubApi } from '../../hooks/useHubApi';
import { usePolling } from '../../hooks/usePolling';
import StatCard from '../hub/shared/StatCard';
import './forge-observe.css';

interface LeaderboardEntry {
  agentId: string;
  agentName: string;
  tasksCompleted: number;
  tasksFailed: number;
  successRate: number;
  avgCost: number;
  avgDuration: number;
  totalCost: number;
  memoryCount: number;
}

export default function Leaderboard() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [sortBy, setSortBy] = useState<'tasksCompleted' | 'successRate' | 'avgCost' | 'totalCost'>('tasksCompleted');
  const [loading, setLoading] = useState(true);

  const loadLeaderboard = useCallback(async () => {
    try {
      const data = await hubApi.events.leaderboard();
      setEntries(Array.isArray(data) ? data as LeaderboardEntry[] : []);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { loadLeaderboard(); }, [loadLeaderboard]);
  usePolling(loadLeaderboard, 30000);

  const sorted = [...entries].sort((a, b) => {
    if (sortBy === 'avgCost') return a.avgCost - b.avgCost;
    if (sortBy === 'successRate') return b.successRate - a.successRate;
    if (sortBy === 'totalCost') return b.totalCost - a.totalCost;
    return b.tasksCompleted - a.tasksCompleted;
  });

  const totalTasks = entries.reduce((s, e) => s + e.tasksCompleted + e.tasksFailed, 0);
  const totalCost = entries.reduce((s, e) => s + e.totalCost, 0);
  const avgSuccess = entries.length > 0 ? entries.reduce((s, e) => s + e.successRate, 0) / entries.length : 0;

  return (
    <div className="fo-overview">
      <div className="fo-stats">
        <StatCard value={entries.length} label="Active Agents" />
        <StatCard value={totalTasks} label="Total Tasks" />
        <StatCard value={`${(avgSuccess * 100).toFixed(0)}%`} label="Avg Success Rate" variant={avgSuccess > 0.8 ? 'success' : 'warning'} />
        <StatCard value={`$${totalCost.toFixed(2)}`} label="Total Spend" />
      </div>

      <div className="fo-section">
        <div className="fo-section-header">
          <h3>Fleet Leaderboard</h3>
          <div style={{ display: 'flex', gap: '8px' }}>
            {(['tasksCompleted', 'successRate', 'avgCost', 'totalCost'] as const).map((key) => (
              <button key={key} className={`hub-btn hub-btn--sm ${sortBy === key ? 'hub-btn--primary' : ''}`} onClick={() => setSortBy(key)}>
                {key === 'tasksCompleted' ? 'Tasks' : key === 'successRate' ? 'Success' : key === 'avgCost' ? 'Efficiency' : 'Spend'}
              </button>
            ))}
          </div>
        </div>

        {loading && <div className="fo-empty">Loading leaderboard...</div>}

        <table style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ opacity: 0.5, textAlign: 'left', fontSize: '11px' }}>
              <th style={{ padding: '8px' }}>#</th>
              <th style={{ padding: '8px' }}>Agent</th>
              <th style={{ padding: '8px' }}>Completed</th>
              <th style={{ padding: '8px' }}>Failed</th>
              <th style={{ padding: '8px' }}>Success Rate</th>
              <th style={{ padding: '8px' }}>Avg Cost</th>
              <th style={{ padding: '8px' }}>Avg Duration</th>
              <th style={{ padding: '8px' }}>Total Cost</th>
              <th style={{ padding: '8px' }}>Memories</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((entry, i) => (
              <tr key={entry.agentId} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', background: i < 3 ? 'rgba(99,102,241,0.03)' : undefined }}>
                <td style={{ padding: '8px', fontWeight: 700, color: i === 0 ? '#fbbf24' : i === 1 ? '#94a3b8' : i === 2 ? '#cd7f32' : undefined }}>
                  {i + 1}
                </td>
                <td style={{ padding: '8px', fontWeight: 600 }}>{entry.agentName}</td>
                <td style={{ padding: '8px' }}>{entry.tasksCompleted}</td>
                <td style={{ padding: '8px', color: entry.tasksFailed > 0 ? '#f87171' : undefined }}>{entry.tasksFailed}</td>
                <td style={{ padding: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{ width: '50px', height: '6px', borderRadius: '3px', background: 'rgba(255,255,255,0.1)' }}>
                      <div style={{ width: `${entry.successRate * 100}%`, height: '100%', borderRadius: '3px',
                        background: entry.successRate > 0.8 ? '#4ade80' : entry.successRate > 0.5 ? '#eab308' : '#ef4444' }} />
                    </div>
                    <span>{(entry.successRate * 100).toFixed(0)}%</span>
                  </div>
                </td>
                <td style={{ padding: '8px' }}>${entry.avgCost.toFixed(4)}</td>
                <td style={{ padding: '8px' }}>{entry.avgDuration > 0 ? `${(entry.avgDuration / 1000).toFixed(1)}s` : '-'}</td>
                <td style={{ padding: '8px' }}>${entry.totalCost.toFixed(2)}</td>
                <td style={{ padding: '8px' }}>{entry.memoryCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
