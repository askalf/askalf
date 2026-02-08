import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './Reports.css';

const API_BASE = window.location.hostname.includes('askalf.org')
  ? ''
  : 'http://localhost:3001';

interface AgentActivity {
  id: string;
  agent_name: string;
  agent_type: string;
  task_type: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  duration_seconds: number | null;
  has_interventions: boolean;
}

interface SystemMetrics {
  users: { total: number; active_24h: number; new_7d: number };
  shards: { total: number; high_confidence: number; success_rate: number };
  chat: { sessions: number; messages: number; avg_per_session: number };
  agents: { total: number; running: number; tasks_today: number; interventions_pending: number };
  tickets: { total: number; open: number; agent_created: number };
  database: { tables: number; size: string };
}

interface AgentSchedule {
  id: string;
  name: string;
  type: string;
  schedule_type: 'manual' | 'scheduled' | 'continuous';
  schedule_interval_minutes: number | null;
  next_run_at: string | null;
  is_continuous: boolean;
  status: string;
  last_run_at: string | null;
}

interface RecentFinding {
  agent_name: string;
  finding: string;
  severity: 'info' | 'warning' | 'critical';
  created_at: string;
}

interface SchedulerStatus {
  running: boolean;
  nextScheduledAgents: Array<{ name: string; next_run_at: string | null; schedule_type: string }>;
  continuousAgents: Array<{ name: string; status: string }>;
}

export default function Reports() {
  const navigate = useNavigate();
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [activity, setActivity] = useState<AgentActivity[]>([]);
  const [schedules, setSchedules] = useState<AgentSchedule[]>([]);
  const [findings, setFindings] = useState<RecentFinding[]>([]);
  const [schedulerStatus, setSchedulerStatus] = useState<SchedulerStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'activity' | 'schedules' | 'findings'>('overview');

  const fetchReports = async () => {
    try {
      const [metricsRes, activityRes, schedulesRes, findingsRes, schedulerRes] = await Promise.all([
        fetch(`${API_BASE}/api/v1/admin/reports/metrics`, { credentials: 'include' }),
        fetch(`${API_BASE}/api/v1/admin/reports/activity`, { credentials: 'include' }),
        fetch(`${API_BASE}/api/v1/admin/reports/schedules`, { credentials: 'include' }),
        fetch(`${API_BASE}/api/v1/admin/reports/findings`, { credentials: 'include' }),
        fetch(`${API_BASE}/api/v1/admin/reports/scheduler`, { credentials: 'include' }),
      ]);

      if (metricsRes.ok) setMetrics(await metricsRes.json());
      if (activityRes.ok) {
        const data = await activityRes.json();
        setActivity(data.activity || []);
      }
      if (schedulesRes.ok) {
        const data = await schedulesRes.json();
        setSchedules(data.schedules || []);
      }
      if (findingsRes.ok) {
        const data = await findingsRes.json();
        setFindings(data.findings || []);
      }
      if (schedulerRes.ok) {
        setSchedulerStatus(await schedulerRes.json());
      }
    } catch (err) {
      console.error('Failed to fetch reports:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReports();
    const interval = setInterval(fetchReports, 10000); // Refresh every 10s
    return () => clearInterval(interval);
  }, []);

  const updateSchedule = async (agentId: string, scheduleType: string, intervalMinutes?: number) => {
    try {
      await fetch(`${API_BASE}/api/v1/admin/agents/${agentId}/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ schedule_type: scheduleType, interval_minutes: intervalMinutes }),
      });
      fetchReports();
    } catch (err) {
      console.error('Failed to update schedule:', err);
    }
  };

  const toggleScheduler = async (action: 'start' | 'stop') => {
    try {
      await fetch(`${API_BASE}/api/v1/admin/reports/scheduler`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action, intervalMs: 60000 }),
      });
      fetchReports();
    } catch (err) {
      console.error('Failed to toggle scheduler:', err);
    }
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return '-';
    if (seconds < 60) return `${seconds}s`;
    return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  };

  return (
    <div className="reports-page">
      <header className="reports-header">
        <div className="header-left">
          <button className="back-btn" onClick={() => navigate('/admin/hub/agents')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h1>Reports & Monitoring</h1>
            <p className="header-subtitle">Real-time system intelligence and agent operations</p>
          </div>
        </div>
        <div className="header-status">
          <button
            className={`scheduler-toggle ${schedulerStatus?.running ? 'running' : 'stopped'}`}
            onClick={() => toggleScheduler(schedulerStatus?.running ? 'stop' : 'start')}
          >
            <span className="scheduler-dot"></span>
            Scheduler: {schedulerStatus?.running ? 'RUNNING' : 'STOPPED'}
          </button>
          <span className={`status-indicator ${metrics?.agents.running ? 'active' : 'idle'}`}>
            {metrics?.agents.running || 0} agents running
          </span>
          <span className="last-updated">Updated: {new Date().toLocaleTimeString()}</span>
        </div>
      </header>

      {/* Tabs */}
      <div className="reports-tabs">
        <button className={activeTab === 'overview' ? 'active' : ''} onClick={() => setActiveTab('overview')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
            <rect x="3" y="3" width="7" height="9" /><rect x="14" y="3" width="7" height="5" />
            <rect x="14" y="12" width="7" height="9" /><rect x="3" y="16" width="7" height="5" />
          </svg>
          Overview
        </button>
        <button className={activeTab === 'activity' ? 'active' : ''} onClick={() => setActiveTab('activity')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
          </svg>
          Live Activity
        </button>
        <button className={activeTab === 'schedules' ? 'active' : ''} onClick={() => setActiveTab('schedules')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
            <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
          </svg>
          Schedules
        </button>
        <button className={activeTab === 'findings' ? 'active' : ''} onClick={() => setActiveTab('findings')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
          </svg>
          Findings
        </button>
      </div>

      <div className="reports-content">
        {loading ? (
          <div className="reports-loading">Loading reports...</div>
        ) : activeTab === 'overview' ? (
          /* OVERVIEW TAB */
          <div className="overview-grid">
            {/* System Health */}
            <div className="metric-card large">
              <h3>System Health</h3>
              <div className="health-grid">
                <div className="health-item">
                  <span className="health-value">{metrics?.users.total || 0}</span>
                  <span className="health-label">Total Users</span>
                </div>
                <div className="health-item">
                  <span className="health-value">{metrics?.users.active_24h || 0}</span>
                  <span className="health-label">Active (24h)</span>
                </div>
                <div className="health-item">
                  <span className="health-value">{metrics?.shards.total || 0}</span>
                  <span className="health-label">Shards</span>
                </div>
                <div className="health-item">
                  <span className={`health-value ${(metrics?.shards.success_rate || 0) < 80 ? 'warning' : ''}`}>
                    {metrics?.shards.success_rate || 0}%
                  </span>
                  <span className="health-label">Shard Success</span>
                </div>
              </div>
            </div>

            {/* Agent Operations */}
            <div className="metric-card">
              <h3>Agent Operations</h3>
              <div className="stat-row">
                <span className="stat-label">Running Now</span>
                <span className={`stat-value ${(metrics?.agents.running || 0) > 0 ? 'active' : ''}`}>
                  {metrics?.agents.running || 0}
                </span>
              </div>
              <div className="stat-row">
                <span className="stat-label">Tasks Today</span>
                <span className="stat-value">{metrics?.agents.tasks_today || 0}</span>
              </div>
              <div className="stat-row">
                <span className="stat-label">Pending Review</span>
                <span className={`stat-value ${(metrics?.agents.interventions_pending || 0) > 0 ? 'warning' : ''}`}>
                  {metrics?.agents.interventions_pending || 0}
                </span>
              </div>
            </div>

            {/* Chat Activity */}
            <div className="metric-card">
              <h3>Chat Activity</h3>
              <div className="stat-row">
                <span className="stat-label">Sessions</span>
                <span className="stat-value">{metrics?.chat.sessions || 0}</span>
              </div>
              <div className="stat-row">
                <span className="stat-label">Messages</span>
                <span className="stat-value">{metrics?.chat.messages || 0}</span>
              </div>
              <div className="stat-row">
                <span className="stat-label">Avg/Session</span>
                <span className="stat-value">{metrics?.chat.avg_per_session || 0}</span>
              </div>
            </div>

            {/* Tickets */}
            <div className="metric-card">
              <h3>Tickets</h3>
              <div className="stat-row">
                <span className="stat-label">Open</span>
                <span className={`stat-value ${(metrics?.tickets.open || 0) > 0 ? 'warning' : ''}`}>
                  {metrics?.tickets.open || 0}
                </span>
              </div>
              <div className="stat-row">
                <span className="stat-label">Agent Created</span>
                <span className="stat-value">{metrics?.tickets.agent_created || 0}</span>
              </div>
              <div className="stat-row">
                <span className="stat-label">Total</span>
                <span className="stat-value">{metrics?.tickets.total || 0}</span>
              </div>
            </div>

            {/* Database */}
            <div className="metric-card">
              <h3>Database</h3>
              <div className="stat-row">
                <span className="stat-label">Tables</span>
                <span className="stat-value">{metrics?.database.tables || 0}</span>
              </div>
              <div className="stat-row">
                <span className="stat-label">Size</span>
                <span className="stat-value">{metrics?.database.size || '-'}</span>
              </div>
            </div>

            {/* Recent Activity Feed */}
            <div className="metric-card wide">
              <h3>Recent Agent Activity</h3>
              <div className="activity-feed">
                {activity.slice(0, 5).map((act, i) => (
                  <div key={i} className={`activity-item ${act.status}`}>
                    <span className="activity-agent">{act.agent_name}</span>
                    <span className="activity-task">{act.task_type}</span>
                    <span className={`activity-status ${act.status}`}>{act.status}</span>
                    <span className="activity-time">{formatDate(act.started_at)}</span>
                  </div>
                ))}
                {activity.length === 0 && <p className="no-data">No recent activity</p>}
              </div>
            </div>
          </div>
        ) : activeTab === 'activity' ? (
          /* ACTIVITY TAB */
          <div className="activity-table-container">
            <table className="activity-table">
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Type</th>
                  <th>Task</th>
                  <th>Status</th>
                  <th>Started</th>
                  <th>Duration</th>
                  <th>Interventions</th>
                </tr>
              </thead>
              <tbody>
                {activity.map((act, i) => (
                  <tr key={i} className={act.status}>
                    <td className="agent-name">{act.agent_name}</td>
                    <td className="agent-type">{act.agent_type}</td>
                    <td className="task-type">{act.task_type}</td>
                    <td><span className={`status-badge ${act.status}`}>{act.status}</span></td>
                    <td className="timestamp">{formatDate(act.started_at)}</td>
                    <td className="duration">{formatDuration(act.duration_seconds)}</td>
                    <td>{act.has_interventions ? '⚠️ Yes' : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {activity.length === 0 && <p className="no-data">No activity recorded</p>}
          </div>
        ) : activeTab === 'schedules' ? (
          /* SCHEDULES TAB */
          <div className="schedules-container">
            <div className="schedules-header">
              <h2>Agent Schedules</h2>
              <p>Configure agents to run continuously (24/7) or on a schedule</p>
            </div>
            <div className="schedules-grid">
              {schedules.map(agent => (
                <div key={agent.id} className={`schedule-card ${agent.schedule_type}`}>
                  <div className="schedule-header">
                    <h3>{agent.name}</h3>
                    <span className={`schedule-badge ${agent.schedule_type}`}>
                      {agent.schedule_type === 'continuous' ? '24/7' : agent.schedule_type}
                    </span>
                  </div>
                  <div className="schedule-info">
                    <span className="agent-type">{agent.type}</span>
                    <span className={`agent-status ${agent.status}`}>{agent.status}</span>
                  </div>
                  {agent.last_run_at && (
                    <div className="last-run">Last run: {formatDate(agent.last_run_at)}</div>
                  )}
                  {agent.next_run_at && (
                    <div className="next-run">Next run: {formatDate(agent.next_run_at)}</div>
                  )}
                  <div className="schedule-controls">
                    <select
                      value={agent.schedule_type}
                      onChange={e => {
                        const type = e.target.value;
                        if (type === 'scheduled') {
                          const mins = prompt('Run every X minutes:', '60');
                          if (mins) updateSchedule(agent.id, type, parseInt(mins));
                        } else {
                          updateSchedule(agent.id, type);
                        }
                      }}
                    >
                      <option value="manual">Manual</option>
                      <option value="scheduled">Scheduled</option>
                      <option value="continuous">24/7 Continuous</option>
                    </select>
                    {agent.schedule_type === 'scheduled' && agent.schedule_interval_minutes && (
                      <span className="interval">Every {agent.schedule_interval_minutes}m</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          /* FINDINGS TAB */
          <div className="findings-container">
            <div className="findings-header">
              <h2>Agent Findings & Insights</h2>
              <p>Aggregated discoveries from all agent operations</p>
            </div>
            <div className="findings-list">
              {findings.map((finding, i) => (
                <div key={i} className={`finding-card ${finding.severity}`}>
                  <div className="finding-header">
                    <span className={`severity-badge ${finding.severity}`}>{finding.severity}</span>
                    <span className="finding-agent">{finding.agent_name}</span>
                    <span className="finding-time">{formatDate(finding.created_at)}</span>
                  </div>
                  <p className="finding-text">{finding.finding}</p>
                </div>
              ))}
              {findings.length === 0 && <p className="no-data">No findings yet. Run agents to generate insights.</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
