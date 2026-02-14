import { useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useHubStore } from '../stores/hub';
import { usePolling } from '../hooks/usePolling';
import StatCard from './hub/shared/StatCard';
import StatusBadge from './hub/shared/StatusBadge';
import MasterCLI from '../components/MasterCLI';
import './hub/shared/hub-shared.css';
import './CommandCenter.css';

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
  return `in ${Math.floor(mins / 60)}h ${mins % 60}m`;
};

const podDotClass = (status: string) => {
  switch (status) {
    case 'running': return 'cc-fleet-pod-dot--running';
    case 'error': return 'cc-fleet-pod-dot--error';
    case 'paused': return 'cc-fleet-pod-dot--paused';
    default: return 'cc-fleet-pod-dot--idle';
  }
};

export default function CommandCenter() {
  const navigate = useNavigate();
  const stats = useHubStore((s) => s.stats);
  const agents = useHubStore((s) => s.agents);
  const interventions = useHubStore((s) => s.interventions);
  const metrics = useHubStore((s) => s.metrics);
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
  const fetchTaskStats = useHubStore((s) => s.fetchTaskStats);
  const fetchSchedules = useHubStore((s) => s.fetchSchedules);
  const fetchTickets = useHubStore((s) => s.fetchTickets);
  const fetchFindings = useHubStore((s) => s.fetchFindings);
  const batchProcessAgents = useHubStore((s) => s.batchProcessAgents);
  const respondToIntervention = useHubStore((s) => s.respondToIntervention);

  const pollCritical = useCallback(() => {
    fetchOrchestration();
    fetchAgents();
    fetchInterventions();
  }, [fetchOrchestration, fetchAgents, fetchInterventions]);
  usePolling(pollCritical, 15000);

  const pollSecondary = useCallback(() => {
    fetchMetrics();
    fetchTaskStats();
    fetchSchedules();
    fetchTickets();
    fetchFindings();
  }, [fetchMetrics, fetchTaskStats, fetchSchedules, fetchTickets, fetchFindings]);
  usePolling(pollSecondary, 30000);

  const activeAgents = useMemo(() => agents.filter((a) => !a.is_decommissioned), [agents]);

  const successRate = useMemo(() => {
    if (!taskStats?.recentByAgent?.length) return null;
    const rates = taskStats.recentByAgent.map((a: Record<string, unknown>) => Number(a.successRate ?? a.success_rate ?? 0)).filter((r: number) => !isNaN(r));
    if (rates.length === 0) return null;
    return Math.round(rates.reduce((sum, r) => sum + r, 0) / rates.length);
  }, [taskStats]);

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

  // Cluster health: degraded if any errors or pending interventions
  const hasErrors = activeAgents.some((a) => a.status === 'error');
  const clusterHealthy = !hasErrors && (interventions.length === 0);

  if (loading.agents && agents.length === 0) {
    return <div className="cc-loading">Connecting to fleet...</div>;
  }

  return (
    <div className="cc-page">
      {/* Top Bar: Brand + Cluster Status + Actions */}
      <div className="cc-topbar">
        <div className="cc-topbar-left">
          <div className="cc-brand">
            <div className="cc-brand-logo">O</div>
            <div>
              <div className="cc-brand-title">Orgi</div>
              <div className="cc-brand-subtitle">Agent Orchestration</div>
            </div>
          </div>
          <div className={`cc-cluster-status ${clusterHealthy ? '' : 'cc-cluster-status--degraded'}`}>
            <span className="cc-cluster-dot" />
            {clusterHealthy ? 'Cluster Healthy' : hasErrors ? 'Degraded' : 'Attention Required'}
          </div>
        </div>
        <div className="cc-topbar-actions">
          {batchResult && (
            <div className="cc-batch-result">
              Started {batchResult.started} agents: {batchResult.agents.join(', ') || 'None'}
            </div>
          )}
          <button
            className={`hub-btn hub-btn--primary ${batchRunning ? 'running' : ''}`}
            onClick={batchProcessAgents}
            disabled={batchRunning}
          >
            {batchRunning ? 'Deploying...' : 'Deploy All'}
          </button>
          <button className="hub-btn" onClick={() => navigate('/agents')}>
            Fleet Manager
          </button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="cc-kpi-strip">
        <StatCard value={stats?.agents.active || 0} label="Agents Online" />
        <StatCard
          value={stats?.agents.running || 0}
          label="Executing"
          variant={(stats?.agents.running || 0) > 0 ? 'success' : 'default'}
        />
        <StatCard
          value={stats?.pendingInterventions || 0}
          label="Awaiting Review"
          variant={(stats?.pendingInterventions || 0) > 0 ? 'warning' : 'default'}
          pulse={(stats?.pendingInterventions || 0) > 0}
          onClick={() => navigate('/agents')}
        />
        <StatCard value={metrics?.agents.tasks_today || 0} label="Executions Today" />
        <StatCard
          value={successRate !== null ? `${successRate}%` : '-'}
          label="Success Rate"
          variant={successRate !== null ? (successRate >= 90 ? 'success' : successRate >= 70 ? 'warning' : 'danger') : 'default'}
        />
        <StatCard
          value={metrics?.tickets.open || 0}
          label="Open Tickets"
          variant={(metrics?.tickets.open || 0) > 0 ? 'warning' : 'default'}
          onClick={() => navigate('/agents')}
        />
      </div>

      {/* Main: CLI (dominant) + Side Panels */}
      <div className="cc-main">
        {/* Left: CLI fills the space */}
        <div className="cc-left">
          <MasterCLI />

          {/* Inline Intervention Queue (below CLI if any pending) */}
          {interventions.length > 0 && (
            <div className="cc-panel" style={{ flexShrink: 0 }}>
              <div className="cc-panel-header">
                <span className="cc-panel-title">Intervention Queue</span>
                <span className="cc-panel-count">{interventions.length}</span>
              </div>
              <div className="cc-intervention-list">
                {interventions.slice(0, 3).map((inv) => (
                  <div key={inv.id} className="cc-intervention-item">
                    <div className="cc-intervention-info">
                      <span className="cc-intervention-title">{inv.title}</span>
                      <span className="cc-intervention-agent">{inv.agent_name}</span>
                    </div>
                    <div className="cc-intervention-actions">
                      <button className="hub-btn hub-btn--success hub-btn--sm" onClick={() => respondToIntervention(inv.id, 'approve')}>
                        Approve
                      </button>
                      <button className="hub-btn hub-btn--danger hub-btn--sm" onClick={() => respondToIntervention(inv.id, 'deny')}>
                        Deny
                      </button>
                    </div>
                  </div>
                ))}
                {interventions.length > 3 && (
                  <button className="hub-btn hub-btn--ghost hub-btn--sm" onClick={() => navigate('/agents')}>
                    +{interventions.length - 3} more
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right: Fleet + Schedule + Alerts */}
        <div className="cc-right">
          {/* Fleet Status (Pods view) */}
          <div className="cc-panel">
            <div className="cc-panel-header">
              <span className="cc-panel-title">Fleet Pods</span>
              <span className="cc-panel-count">{activeAgents.length}</span>
            </div>
            {activeAgents.length === 0 ? (
              <p className="cc-panel-empty">No agents deployed</p>
            ) : (
              <div className="cc-fleet-grid">
                {activeAgents.map((agent) => (
                  <div
                    key={agent.id}
                    className="cc-fleet-pod"
                    onClick={() => navigate('/agents')}
                  >
                    <span className={`cc-fleet-pod-dot ${podDotClass(agent.status)}`} />
                    <div className="cc-fleet-pod-info">
                      <span className="cc-fleet-pod-name">{agent.name}</span>
                      <span className="cc-fleet-pod-time">{relativeTime(agent.last_run_at)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Schedule (CronJobs) */}
          <div className="cc-panel">
            <div className="cc-panel-header">
              <span className="cc-panel-title">Scheduled Runs</span>
              <span className="cc-panel-count">{upcomingRuns.length}</span>
            </div>
            {upcomingRuns.length === 0 ? (
              <p className="cc-panel-empty">No scheduled runs</p>
            ) : (
              <div className="cc-schedule-list">
                {upcomingRuns.map((sched) => (
                  <div key={sched.id} className="cc-schedule-item">
                    <span className="cc-schedule-name">{sched.name}</span>
                    <span className="cc-schedule-eta">{countdown(sched.next_run_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Urgent Tickets */}
          {urgentTickets.length > 0 && (
            <div className="cc-panel">
              <div className="cc-panel-header">
                <span className="cc-panel-title">Urgent Tickets</span>
                <span className="cc-panel-count">{urgentTickets.length}</span>
              </div>
              <div className="cc-alert-list">
                {urgentTickets.map((t) => (
                  <div key={t.id} className="cc-alert-row" onClick={() => navigate('/agents')}>
                    <StatusBadge status={t.priority} />
                    <span>{t.title}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Critical Findings */}
          {criticalFindings.length > 0 && (
            <div className="cc-panel">
              <div className="cc-panel-header">
                <span className="cc-panel-title">Critical Findings</span>
                <span className="cc-panel-count">{criticalFindings.length}</span>
              </div>
              <div className="cc-alert-list">
                {criticalFindings.map((f) => (
                  <div key={f.id} className="cc-alert-row" onClick={() => navigate('/agents')}>
                    <StatusBadge status={f.severity} />
                    <span>{f.finding}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
