import { useCallback, useMemo } from 'react';
import { useHubStore } from '../../stores/hub';
import { usePolling } from '../../hooks/usePolling';
import type { Task, ReportFeedItem } from '../../hooks/useHubApi';
import StatCard from './shared/StatCard';
import StatusBadge from './shared/StatusBadge';
import AgentIcon from './shared/AgentIcon';

const formatDate = (iso: string | null) => {
  if (!iso) return 'Never';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const relativeTime = (iso: string | null) => {
  if (!iso) return 'Never';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
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

const formatDuration = (seconds: number | null | undefined) => {
  if (!seconds) return '-';
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
};

export default function CommandCenter() {
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
  const respondToIntervention = useHubStore((s) => s.respondToIntervention);
  const setActiveTab = useHubStore((s) => s.setActiveTab);
  const setShowAgentDetail = useHubStore((s) => s.setShowAgentDetail);
  const setShowCreateAgent = useHubStore((s) => s.setShowCreateAgent);
  const setSelectedTask = useHubStore((s) => s.setSelectedTask);
  const setShowTicketDetail = useHubStore((s) => s.setShowTicketDetail);
  const setSelectedFeedItem = useHubStore((s) => s.setSelectedFeedItem);

  // Critical data: agents, interventions, orchestration status
  const pollCritical = useCallback(() => {
    fetchOrchestration();
    fetchAgents();
    fetchInterventions();
  }, [fetchOrchestration, fetchAgents, fetchInterventions]);
  usePolling(pollCritical, 15000);

  // Secondary data: metrics, activity, tasks, schedules, tickets, findings
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

  // Compute success rate from taskStats
  const successRate = useMemo(() => {
    if (!taskStats?.recentByAgent?.length) return null;
    const rates = taskStats.recentByAgent.map((a: Record<string, unknown>) => Number(a.successRate ?? a.success_rate ?? 0)).filter((r: number) => !isNaN(r));
    const avg = rates.reduce((sum, r) => sum + r, 0) / rates.length;
    return Math.round(avg);
  }, [taskStats]);

  const successVariant = useMemo(() => {
    if (successRate === null) return 'default' as const;
    if (successRate >= 90) return 'success' as const;
    if (successRate >= 70) return 'warning' as const;
    return 'danger' as const;
  }, [successRate]);

  // Compute 24h cost from activity
  const cost24h = useMemo(() => {
    // Activity doesn't include cost directly — use tasks if available
    // For now show tasks_today metric as proxy
    return null;
  }, []);

  // Upcoming scheduled runs
  const upcomingRuns = useMemo(() => {
    return schedules
      .filter((s) => s.schedule_type === 'scheduled' && s.next_run_at)
      .sort((a, b) => new Date(a.next_run_at!).getTime() - new Date(b.next_run_at!).getTime())
      .slice(0, 6);
  }, [schedules]);

  // Urgent tickets
  const urgentTickets = useMemo(() => {
    return tickets
      .filter((t) => (t.priority === 'urgent' || t.priority === 'high') && (t.status === 'open' || t.status === 'in_progress'))
      .slice(0, 5);
  }, [tickets]);

  // Critical findings
  const criticalFindings = useMemo(() => {
    return findings
      .filter((f) => f.severity === 'critical' || f.severity === 'warning')
      .slice(0, 5);
  }, [findings]);

  // Status color map for fleet tiles
  const statusBorderColor = (status: string) => {
    switch (status) {
      case 'running': return 'var(--crystal)';
      case 'error': return 'var(--danger)';
      case 'paused': return 'var(--warning)';
      default: return 'var(--border)';
    }
  };

  if (loading.agents && agents.length === 0) {
    return <div className="hub-loading">Loading orchestration data...</div>;
  }

  return (
    <>
      {/* Row 1: Expanded Stats Grid (8 cards) */}
      <div className="hub-cmd-stats">
        <StatCard icon="🤖" value={stats?.agents.active || 0} label="Active Agents" large />
        <StatCard
          value={stats?.agents.running || 0}
          label="Running Now"
          variant={(stats?.agents.running || 0) > 0 ? 'success' : 'default'}
        />
        <StatCard value={`${stats?.agents.avgAutonomy || 0}%`} label="Avg Autonomy" />
        <StatCard
          value={stats?.pendingInterventions || 0}
          label="Pending Review"
          variant={(stats?.pendingInterventions || 0) > 0 ? 'warning' : 'default'}
          pulse={(stats?.pendingInterventions || 0) > 0}
          onClick={() => setActiveTab('gateway')}
        />
        <StatCard value={metrics?.agents.tasks_today || 0} label="Tasks Today" />
        <StatCard
          value={successRate !== null ? `${successRate}%` : '-'}
          label="Success Rate"
          variant={successVariant}
        />
        <StatCard
          value={metrics?.tickets.open || 0}
          label="Open Tickets"
          variant={(metrics?.tickets.open || 0) > 0 ? 'warning' : 'default'}
          onClick={() => setActiveTab('memory')}
        />
        <StatCard
          value={cost24h !== null ? `$${cost24h}` : '-'}
          label="Cost (24h)"
        />
      </div>

      {/* Row 2: Fleet Status Grid + Upcoming Runs */}
      <div className="hub-cmd-sidebar">
        {/* Fleet Status Grid */}
        <div className="hub-cmd-section">
          <h3>Fleet Status</h3>
          {activeAgents.length === 0 ? (
            <p className="hub-no-data">No active agents</p>
          ) : (
            <div className="hub-cmd-fleet-grid">
              {activeAgents.map((agent) => (
                <div
                  key={agent.id}
                  className="hub-cmd-fleet-tile"
                  style={{ borderLeftColor: statusBorderColor(agent.status) }}
                  onClick={() => setShowAgentDetail(agent.id)}
                >
                  <AgentIcon type={agent.type} size="small" />
                  <div className="hub-cmd-fleet-tile-info">
                    <strong>{agent.name}</strong>
                    <span className="hub-cmd-fleet-tile-time">{relativeTime(agent.last_run_at)}</span>
                  </div>
                  <StatusBadge status={agent.status} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Upcoming Runs */}
        <div className="hub-cmd-section">
          <h3>Upcoming Runs</h3>
          {upcomingRuns.length === 0 ? (
            <p className="hub-no-data">No scheduled runs</p>
          ) : (
            <div className="hub-cmd-timeline">
              {upcomingRuns.map((sched) => (
                <div key={sched.id} className="hub-cmd-timeline-item">
                  <div className="hub-cmd-timeline-info">
                    <strong>{sched.name}</strong>
                    <span className="hub-cmd-timeline-countdown">{countdown(sched.next_run_at)}</span>
                  </div>
                  <StatusBadge status={sched.execution_mode} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Row 3: Quick Actions */}
      <div className="hub-cmd-section">
        <h3>Quick Actions</h3>
        <div className="hub-cmd-actions">
          <button
            className={`hub-btn hub-btn--primary ${batchRunning ? 'running' : ''}`}
            onClick={batchProcessAgents}
            disabled={batchRunning}
          >
            {batchRunning ? 'Starting Agents...' : 'Run All Agents'}
          </button>
          <button className="hub-btn" onClick={() => setShowCreateAgent(true)}>
            Spin Up New Agent
          </button>
          <button className="hub-btn" onClick={() => setActiveTab('gateway')}>
            Review Interventions
          </button>
          <button className="hub-btn" onClick={() => setActiveTab('memory')}>
            Agent Tickets
          </button>
        </div>
        {batchResult && (
          <div className="hub-cmd-batch-result">
            Started {batchResult.started} agents: {batchResult.agents.join(', ') || 'None'}
          </div>
        )}
      </div>

      {/* Row 4: Three columns — Activity / Urgent Tickets / Critical Findings */}
      <div className="hub-cmd-columns">
        {/* Recent Activity */}
        <div className="hub-cmd-column">
          <h3>Recent Activity</h3>
          {activity.length === 0 ? (
            <p className="hub-no-data">No recent activity</p>
          ) : (
            <div className="hub-cmd-column-list">
              {activity.slice(0, 8).map((item) => (
                <div
                  key={item.id}
                  className="hub-cmd-activity-row"
                  onClick={() => {
                    const task: Task = {
                      id: item.id,
                      agent_id: '',
                      agent_name: item.agent_name,
                      agent_type: item.agent_type,
                      type: item.task_type,
                      status: item.status,
                      input: {},
                      output: {},
                      error: null,
                      started_at: item.started_at,
                      completed_at: item.completed_at,
                      created_at: item.started_at,
                      duration_seconds: item.duration_seconds,
                    };
                    setSelectedTask(task);
                    setActiveTab('memory');
                  }}
                >
                  <span className="hub-cmd-activity-agent">{item.agent_name}</span>
                  <StatusBadge status={item.status} />
                  <span className="hub-cmd-activity-duration">{formatDuration(item.duration_seconds)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Urgent Tickets */}
        <div className="hub-cmd-column">
          <h3>Urgent Tickets</h3>
          {urgentTickets.length === 0 ? (
            <p className="hub-no-data">No urgent tickets</p>
          ) : (
            <div className="hub-cmd-column-list">
              {urgentTickets.map((ticket) => (
                <div
                  key={ticket.id}
                  className="hub-cmd-ticket-row"
                  onClick={() => {
                    setShowTicketDetail(ticket);
                    setActiveTab('memory');
                  }}
                >
                  <StatusBadge status={ticket.priority} />
                  <span className="hub-cmd-ticket-title">{ticket.title}</span>
                  {ticket.assigned_to && (
                    <span className="hub-cmd-ticket-assignee">{ticket.assigned_to}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Critical Findings */}
        <div className="hub-cmd-column">
          <h3>Critical Findings</h3>
          {criticalFindings.length === 0 ? (
            <p className="hub-no-data">No critical findings</p>
          ) : (
            <div className="hub-cmd-column-list">
              {criticalFindings.map((finding) => (
                <div
                  key={finding.id}
                  className="hub-cmd-finding-row"
                  onClick={() => {
                    const feedItem: ReportFeedItem = {
                      id: finding.id,
                      type: 'finding',
                      severity: finding.severity,
                      category: finding.category,
                      agent_name: finding.agent_name,
                      content: finding.finding,
                      sort_date: finding.created_at,
                      created_at: finding.created_at,
                      metadata: finding.metadata,
                      execution_id: finding.execution_id,
                      agent_id: finding.agent_id,
                      title: null,
                      description: null,
                    };
                    setSelectedFeedItem(feedItem);
                    setActiveTab('memory');
                  }}
                >
                  <StatusBadge status={finding.severity} />
                  <span className="hub-cmd-finding-agent">{finding.agent_name}</span>
                  <span className="hub-cmd-finding-text">{finding.finding}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Row 5: Pending Interventions */}
      {interventions.length > 0 && (
        <div className="hub-cmd-section">
          <h3>Pending Interventions</h3>
          <div className="hub-cmd-interventions">
            {interventions.slice(0, 5).map((intervention) => (
              <div key={intervention.id} className="hub-cmd-intervention-item">
                <div className="hub-cmd-intervention-info">
                  <strong>{intervention.title}</strong>
                  <span>{intervention.agent_name} &middot; {formatDate(intervention.created_at)}</span>
                </div>
                <div className="hub-cmd-intervention-actions">
                  <button className="hub-btn hub-btn--success" onClick={() => respondToIntervention(intervention.id, 'approve')}>
                    Approve
                  </button>
                  <button className="hub-btn hub-btn--danger" onClick={() => respondToIntervention(intervention.id, 'deny')}>
                    Deny
                  </button>
                </div>
              </div>
            ))}
            {interventions.length > 5 && (
              <button className="hub-btn hub-btn--ghost" onClick={() => setActiveTab('gateway')}>
                View all {interventions.length} interventions
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
