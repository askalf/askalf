import { useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useHubStore } from '../stores/hub';
import { usePolling } from '../hooks/usePolling';
import StatCard from './hub/shared/StatCard';
import StatusBadge from './hub/shared/StatusBadge';
import AgentIcon from './hub/shared/AgentIcon';
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
    const rates = taskStats.recentByAgent.map((a) => parseFloat(a.success_rate));
    return Math.round(rates.reduce((sum, r) => sum + r, 0) / rates.length);
  }, [taskStats]);

  const upcomingRuns = useMemo(() => {
    return schedules
      .filter((s) => s.schedule_type === 'scheduled' && s.next_run_at)
      .sort((a, b) => new Date(a.next_run_at!).getTime() - new Date(b.next_run_at!).getTime())
      .slice(0, 5);
  }, [schedules]);

  const urgentTickets = useMemo(() => {
    return tickets
      .filter((t) => (t.priority === 'urgent' || t.priority === 'high') && (t.status === 'open' || t.status === 'in_progress'))
      .slice(0, 4);
  }, [tickets]);

  const criticalFindings = useMemo(() => {
    return findings.filter((f) => f.severity === 'critical' || f.severity === 'warning').slice(0, 4);
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
    return <div className="cc-loading">Loading fleet data...</div>;
  }

  return (
    <div className="cc-page">
      <div className="cc-header">
        <h1>Command Center</h1>
        <div className="cc-header-actions">
          <button
            className={`hub-btn hub-btn--primary ${batchRunning ? 'running' : ''}`}
            onClick={batchProcessAgents}
            disabled={batchRunning}
          >
            {batchRunning ? 'Starting...' : 'Run All Agents'}
          </button>
          <button className="hub-btn" onClick={() => navigate('/agents')}>
            Manage Fleet
          </button>
        </div>
      </div>

      {batchResult && (
        <div className="cc-batch-result">
          Started {batchResult.started} agents: {batchResult.agents.join(', ') || 'None'}
        </div>
      )}

      {/* KPI Strip */}
      <div className="cc-kpi-strip">
        <StatCard icon="fleet" value={stats?.agents.active || 0} label="Active Agents" />
        <StatCard
          value={stats?.agents.running || 0}
          label="Running Now"
          variant={(stats?.agents.running || 0) > 0 ? 'success' : 'default'}
        />
        <StatCard
          value={stats?.pendingInterventions || 0}
          label="Pending Review"
          variant={(stats?.pendingInterventions || 0) > 0 ? 'warning' : 'default'}
          pulse={(stats?.pendingInterventions || 0) > 0}
          onClick={() => navigate('/agents')}
        />
        <StatCard value={metrics?.agents.tasks_today || 0} label="Tasks Today" />
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

      {/* Main content: two columns */}
      <div className="cc-columns">
        {/* Left: CLI + Interventions */}
        <div className="cc-col-main">
          <MasterCLI />

          {/* Pending Interventions */}
          {interventions.length > 0 && (
            <div className="cc-card">
              <h3>Pending Interventions ({interventions.length})</h3>
              <div className="cc-intervention-list">
                {interventions.slice(0, 4).map((inv) => (
                  <div key={inv.id} className="cc-intervention-item">
                    <div className="cc-intervention-info">
                      <strong>{inv.title}</strong>
                      <span className="cc-intervention-meta">{inv.agent_name}</span>
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
              </div>
            </div>
          )}
        </div>

        {/* Right: Fleet + Schedule + Alerts */}
        <div className="cc-col-side">
          {/* Fleet Grid */}
          <div className="cc-card">
            <h3>Fleet Status</h3>
            <div className="cc-fleet-grid">
              {activeAgents.slice(0, 12).map((agent) => (
                <div
                  key={agent.id}
                  className="cc-fleet-tile"
                  style={{ borderLeftColor: statusBorderColor(agent.status) }}
                  onClick={() => navigate('/agents')}
                >
                  <AgentIcon type={agent.type} size="small" />
                  <div className="cc-fleet-tile-info">
                    <strong>{agent.name}</strong>
                    <span>{relativeTime(agent.last_run_at)}</span>
                  </div>
                  <StatusBadge status={agent.status} />
                </div>
              ))}
            </div>
          </div>

          {/* Upcoming Runs */}
          <div className="cc-card">
            <h3>Upcoming Runs</h3>
            {upcomingRuns.length === 0 ? (
              <p className="cc-empty">No scheduled runs</p>
            ) : (
              <div className="cc-timeline">
                {upcomingRuns.map((sched) => (
                  <div key={sched.id} className="cc-timeline-item">
                    <strong>{sched.name}</strong>
                    <span className="cc-timeline-countdown">{countdown(sched.next_run_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Urgent Tickets */}
          {urgentTickets.length > 0 && (
            <div className="cc-card">
              <h3>Urgent Tickets</h3>
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
            <div className="cc-card">
              <h3>Critical Findings</h3>
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
