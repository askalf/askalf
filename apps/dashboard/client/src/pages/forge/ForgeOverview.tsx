import { useCallback, useMemo } from 'react';
import { useHubStore } from '../../stores/hub';
import { usePolling } from '../../hooks/usePolling';
import type { Task, ReportFeedItem } from '../../hooks/useHubApi';
import StatCard from '../hub/shared/StatCard';
import StatusBadge from '../hub/shared/StatusBadge';
import AgentIcon from '../hub/shared/AgentIcon';

const relativeTime = (iso: string | null) => {
  if (!iso) return 'Never';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
};

const countdown = (iso: string | null) => {
  if (!iso) return '';
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return 'Now';
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `in ${mins}m`;
  const hrs = Math.floor(mins / 60);
  return `in ${hrs}h ${mins % 60}m`;
};

const formatDate = (iso: string | null) => {
  if (!iso) return 'Never';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const formatDuration = (seconds: number | null | undefined) => {
  if (!seconds) return '-';
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  return `${mins}m ${seconds % 60}s`;
};

export default function ForgeOverview() {
  const stats = useHubStore((s) => s.stats);
  const agents = useHubStore((s) => s.agents);
  const interventions = useHubStore((s) => s.interventions);
  const metrics = useHubStore((s) => s.metrics);
  const activity = useHubStore((s) => s.activity);
  const taskStats = useHubStore((s) => s.taskStats);
  const schedules = useHubStore((s) => s.schedules);
  const tickets = useHubStore((s) => s.tickets);
  const findings = useHubStore((s) => s.findings);
  const batchRunning = useHubStore((s) => s.batchRunning);
  const batchResult = useHubStore((s) => s.batchResult);
  const loading = useHubStore((s) => s.loading);

  const fetchOrchestration = useHubStore((s) => s.fetchOrchestration);
  const fetchAgents = useHubStore((s) => s.fetchAgents);
  const fetchInterventions = useHubStore((s) => s.fetchInterventions);
  const fetchMetrics = useHubStore((s) => s.fetchMetrics);
  const fetchActivity = useHubStore((s) => s.fetchActivity);
  const fetchTaskStats = useHubStore((s) => s.fetchTaskStats);
  const fetchSchedules = useHubStore((s) => s.fetchSchedules);
  const fetchTickets = useHubStore((s) => s.fetchTickets);
  const fetchFindings = useHubStore((s) => s.fetchFindings);
  const batchProcessAgents = useHubStore((s) => s.batchProcessAgents);
  const batchPauseAgents = useHubStore((s) => s.batchPauseAgents);
  const respondToIntervention = useHubStore((s) => s.respondToIntervention);
  const setActiveTab = useHubStore((s) => s.setActiveTab);
  const setShowAgentDetail = useHubStore((s) => s.setShowAgentDetail);
  const setShowCreateAgent = useHubStore((s) => s.setShowCreateAgent);
  const setSelectedTask = useHubStore((s) => s.setSelectedTask);
  const setShowTicketDetail = useHubStore((s) => s.setShowTicketDetail);
  const setSelectedFeedItem = useHubStore((s) => s.setSelectedFeedItem);

  const pollCritical = useCallback(() => {
    fetchOrchestration();
    fetchAgents();
    fetchInterventions();
  }, [fetchOrchestration, fetchAgents, fetchInterventions]);
  usePolling(pollCritical, 15000);

  const pollSecondary = useCallback(() => {
    fetchMetrics();
    fetchActivity();
    fetchTaskStats();
    fetchSchedules();
    fetchTickets();
    fetchFindings();
  }, [fetchMetrics, fetchActivity, fetchTaskStats, fetchSchedules, fetchTickets, fetchFindings]);
  usePolling(pollSecondary, 30000);

  const activeAgents = useMemo(() => agents.filter((a) => !a.is_decommissioned), [agents]);
  const fleetRunning = useMemo(() => activeAgents.some((a) => a.status === 'running' || a.status === 'idle'), [activeAgents]);

  const successRate = useMemo(() => {
    if (!taskStats?.recentByAgent?.length) return null;
    const rates = taskStats.recentByAgent.map((a: Record<string, unknown>) => Number(a.successRate ?? a.success_rate ?? 0)).filter((r: number) => !isNaN(r));
    if (rates.length === 0) return null;
    return Math.round(rates.reduce((sum, r) => sum + r, 0) / rates.length);
  }, [taskStats]);

  const successVariant = useMemo(() => {
    if (successRate === null) return 'default' as const;
    if (successRate >= 90) return 'success' as const;
    if (successRate >= 70) return 'warning' as const;
    return 'danger' as const;
  }, [successRate]);

  const upcomingRuns = useMemo(() => {
    return schedules
      .filter((s) => s.schedule_type === 'scheduled' && s.next_run_at)
      .sort((a, b) => new Date(a.next_run_at!).getTime() - new Date(b.next_run_at!).getTime())
      .slice(0, 6);
  }, [schedules]);

  const urgentTickets = useMemo(() => {
    return tickets
      .filter((t) => (t.priority === 'urgent' || t.priority === 'high') && (t.status === 'open' || t.status === 'in_progress'))
      .slice(0, 5);
  }, [tickets]);

  const criticalFindings = useMemo(() => {
    return findings.filter((f) => f.severity === 'critical' || f.severity === 'warning').slice(0, 5);
  }, [findings]);

  const statusBorderColor = (status: string) => {
    switch (status) {
      case 'running': return 'var(--crystal)';
      case 'error': return 'var(--danger)';
      case 'paused': return 'var(--warning)';
      default: return 'var(--border)';
    }
  };

  if (loading.agents && agents.length === 0) {
    return <div className="fo-loading">Connecting to fleet...</div>;
  }

  return (
    <div className="fo-overview">
      {/* Stat Cards */}
      <div className="fo-stats">
        <StatCard value={stats?.agents.active || 0} label="Active Agents" />
        <StatCard value={stats?.agents.running || 0} label="Running Now" variant={(stats?.agents.running || 0) > 0 ? 'success' : 'default'} />
        <StatCard value={`${stats?.agents.avgAutonomy || 0}%`} label="Avg Autonomy" />
        <StatCard value={stats?.pendingInterventions || 0} label="Pending Review" variant={(stats?.pendingInterventions || 0) > 0 ? 'warning' : 'default'} pulse={(stats?.pendingInterventions || 0) > 0} onClick={() => setActiveTab('interventions')} />
        <StatCard value={metrics?.agents.tasks_today || 0} label="Tasks Today" />
        <StatCard value={successRate !== null ? `${successRate}%` : '-'} label="Success Rate" variant={successVariant} />
        <StatCard value={metrics?.tickets.open || 0} label="Open Tickets" variant={(metrics?.tickets.open || 0) > 0 ? 'warning' : 'default'} onClick={() => setActiveTab('tickets')} />
      </div>

      {/* Quick Actions */}
      <div className="fo-actions">
        <button
          className={`fo-action-btn ${fleetRunning ? 'fo-action-btn--danger' : 'fo-action-btn--primary'} ${batchRunning ? 'running' : ''}`}
          onClick={fleetRunning ? batchPauseAgents : batchProcessAgents}
          disabled={batchRunning}
        >
          {batchRunning ? (fleetRunning ? 'Pausing...' : 'Starting...') : (fleetRunning ? 'Pause All' : 'Run All')}
        </button>
        <button className="fo-action-btn" onClick={() => setShowCreateAgent(true)}>+ New Agent</button>
        <button className="fo-action-btn" onClick={() => setActiveTab('interventions')}>Review Queue</button>
        {batchResult && (
          <span className="fo-batch-result">
            {batchResult.started > 0 ? `Started ${batchResult.started}` : `Paused ${batchResult.agents.length}`} agents
          </span>
        )}
      </div>

      {/* Two-column: Fleet + Upcoming / Activity + Alerts */}
      <div className="fo-grid">
        {/* Fleet Pods */}
        <div className="fo-panel">
          <div className="fo-panel-header">
            <span className="fo-panel-title">Fleet Status</span>
            <span className="fo-panel-count">{activeAgents.length}</span>
          </div>
          {activeAgents.length === 0 ? (
            <p className="fo-empty">No agents deployed</p>
          ) : (
            <div className="fo-fleet-grid">
              {activeAgents.map((agent) => (
                <div key={agent.id} className="fo-fleet-tile" style={{ borderLeftColor: statusBorderColor(agent.status) }} onClick={() => setShowAgentDetail(agent.id)}>
                  <AgentIcon type={agent.type} size="small" />
                  <div className="fo-fleet-tile-info">
                    <strong>{agent.name}</strong>
                    <span>{relativeTime(agent.last_run_at)}</span>
                  </div>
                  <StatusBadge status={agent.status} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Upcoming Runs */}
        <div className="fo-panel">
          <div className="fo-panel-header">
            <span className="fo-panel-title">Upcoming Runs</span>
            <span className="fo-panel-count">{upcomingRuns.length}</span>
          </div>
          {upcomingRuns.length === 0 ? (
            <p className="fo-empty">No scheduled runs</p>
          ) : (
            <div className="fo-schedule-list">
              {upcomingRuns.map((sched) => (
                <div key={sched.id} className="fo-schedule-item">
                  <strong>{sched.name}</strong>
                  <span className="fo-schedule-eta">{countdown(sched.next_run_at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Activity */}
        <div className="fo-panel">
          <div className="fo-panel-header">
            <span className="fo-panel-title">Recent Activity</span>
          </div>
          {activity.length === 0 ? (
            <p className="fo-empty">No recent activity</p>
          ) : (
            <div className="fo-activity-list">
              {activity.slice(0, 8).map((item) => (
                <div key={item.id} className="fo-activity-row" onClick={() => {
                  const task: Task = {
                    id: item.id, agent_id: '', agent_name: item.agent_name, agent_type: item.agent_type,
                    type: item.task_type, status: item.status, input: {}, output: {}, error: null,
                    started_at: item.started_at, completed_at: item.completed_at, created_at: item.started_at,
                    duration_seconds: item.duration_seconds,
                  };
                  setSelectedTask(task);
                  setActiveTab('executions');
                }}>
                  <span className="fo-activity-agent">{item.agent_name}</span>
                  <StatusBadge status={item.status} />
                  <span className="fo-activity-duration">{formatDuration(item.duration_seconds)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Urgent Tickets + Findings */}
        <div className="fo-panel">
          {urgentTickets.length > 0 && (
            <>
              <div className="fo-panel-header">
                <span className="fo-panel-title">Urgent Tickets</span>
                <span className="fo-panel-count">{urgentTickets.length}</span>
              </div>
              <div className="fo-alert-list">
                {urgentTickets.map((t) => (
                  <div key={t.id} className="fo-alert-row" onClick={() => { setShowTicketDetail(t); setActiveTab('tickets'); }}>
                    <StatusBadge status={t.priority} />
                    <span>{t.title}</span>
                  </div>
                ))}
              </div>
            </>
          )}
          {criticalFindings.length > 0 && (
            <>
              <div className="fo-panel-header" style={{ marginTop: urgentTickets.length > 0 ? '1rem' : 0 }}>
                <span className="fo-panel-title">Critical Findings</span>
                <span className="fo-panel-count">{criticalFindings.length}</span>
              </div>
              <div className="fo-alert-list">
                {criticalFindings.map((f) => (
                  <div key={f.id} className="fo-alert-row" onClick={() => {
                    const feedItem: ReportFeedItem = {
                      id: f.id, type: 'finding', severity: f.severity, category: f.category,
                      agent_name: f.agent_name, content: f.finding, sort_date: f.created_at,
                      created_at: f.created_at, metadata: f.metadata, execution_id: f.execution_id,
                      agent_id: f.agent_id, title: null, description: null,
                    };
                    setSelectedFeedItem(feedItem);
                  }}>
                    <StatusBadge status={f.severity} />
                    <span className="fo-finding-text">{f.finding}</span>
                  </div>
                ))}
              </div>
            </>
          )}
          {urgentTickets.length === 0 && criticalFindings.length === 0 && (
            <>
              <div className="fo-panel-header">
                <span className="fo-panel-title">Alerts</span>
              </div>
              <p className="fo-empty">All clear</p>
            </>
          )}
        </div>
      </div>

      {/* Interventions */}
      {interventions.length > 0 && (
        <div className="fo-panel" style={{ marginTop: '1rem' }}>
          <div className="fo-panel-header">
            <span className="fo-panel-title">Pending Interventions</span>
            <span className="fo-panel-count">{interventions.length}</span>
          </div>
          <div className="fo-intervention-list">
            {interventions.slice(0, 5).map((inv) => (
              <div key={inv.id} className="fo-intervention-item">
                <div className="fo-intervention-info">
                  <strong>{inv.title}</strong>
                  <span>{inv.agent_name} &middot; {formatDate(inv.created_at)}</span>
                </div>
                <div className="fo-intervention-actions">
                  <button className="fo-action-btn fo-action-btn--success fo-action-btn--sm" onClick={() => respondToIntervention(inv.id, 'approve')}>Approve</button>
                  <button className="fo-action-btn fo-action-btn--danger fo-action-btn--sm" onClick={() => respondToIntervention(inv.id, 'deny')}>Deny</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
