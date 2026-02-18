import { useCallback } from 'react';
import { useHubStore } from '../../stores/hub';
import { usePolling } from '../../hooks/usePolling';
import StatusBadge from './shared/StatusBadge';

const formatDate = (iso: string | null) => {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

// Cost estimates per run (input+output averaged across typical agent runs)
const COST_PER_RUN: Record<string, number> = {
  haiku: 0.015,
  sonnet: 0.17,
  opus: 0.50,
};
const BATCH_DISCOUNT = 0.5;

function getModelTier(modelId: string | null): string {
  const id = (modelId || '').toLowerCase();
  if (id.includes('opus')) return 'opus';
  if (id.includes('sonnet')) return 'sonnet';
  return 'haiku';
}

function estimateDailyCost(modelId: string | null, intervalMinutes: number | null, executionMode: string): string {
  if (executionMode === 'cli') return 'OAuth';
  const tier = getModelTier(modelId);
  const interval = intervalMinutes || 60;
  const runsPerDay = (24 * 60) / interval;
  const costPerRun = COST_PER_RUN[tier] || COST_PER_RUN.haiku;
  const discount = executionMode === 'batch' ? BATCH_DISCOUNT : 1;
  const daily = runsPerDay * costPerRun * discount;
  return `~$${daily.toFixed(2)}/day`;
}

export default function SchedulerControl() {
  const schedulerStatus = useHubStore((s) => s.schedulerStatus);
  const schedules = useHubStore((s) => s.schedules);

  const fetchSchedulerStatus = useHubStore((s) => s.fetchSchedulerStatus);
  const fetchSchedules = useHubStore((s) => s.fetchSchedules);
  const toggleScheduler = useHubStore((s) => s.toggleScheduler);
  const updateSchedule = useHubStore((s) => s.updateSchedule);
  const updateAgentModel = useHubStore((s) => s.updateAgentModel);

  const poll = useCallback(() => {
    fetchSchedulerStatus();
    fetchSchedules();
  }, [fetchSchedulerStatus, fetchSchedules]);
  usePolling(poll, 10000);

  return (
    <>
      {/* Scheduler Status */}
      <div className="hub-sched-header">
        <div>
          <h2>Scheduler Control</h2>
          <p>Configure agents to run continuously (24/7) or on a schedule</p>
        </div>
        <button
          className={`hub-scheduler-toggle ${schedulerStatus?.running ? 'running' : 'stopped'}`}
          onClick={() => toggleScheduler(schedulerStatus?.running ? 'stop' : 'start')}
          style={{ fontSize: '0.9rem', padding: '8px 16px' }}
        >
          <span className="hub-scheduler-dot" />
          {schedulerStatus?.running ? 'Stop Scheduler' : 'Start Scheduler'}
        </button>
      </div>

      {/* Scheduler Info */}
      {schedulerStatus && (
        <div style={{ display: 'flex', gap: 'var(--space-lg)', marginBottom: 'var(--space-xl)' }}>
          {schedulerStatus.continuousAgents.length > 0 && (
            <div className="hub-report-card" style={{ flex: 1 }}>
              <h3>Continuous Agents (24/7)</h3>
              {schedulerStatus.continuousAgents.map((agent, i) => (
                <div key={i} className="hub-report-row">
                  <span className="hub-report-row-label">{agent.name}</span>
                  <StatusBadge status={agent.status} />
                </div>
              ))}
            </div>
          )}
          {schedulerStatus.nextScheduledAgents.length > 0 && (
            <div className="hub-report-card" style={{ flex: 1 }}>
              <h3>Next Scheduled Runs</h3>
              {schedulerStatus.nextScheduledAgents.map((agent, i) => (
                <div key={i} className="hub-report-row">
                  <span className="hub-report-row-label">{agent.name}</span>
                  <span className="hub-report-row-value" style={{ fontSize: '0.8rem' }}>
                    {agent.next_run_at ? formatDate(agent.next_run_at) : '-'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Schedule Grid */}
      <div className="hub-sched-grid">
        {schedules.map((agent) => (
          <div key={agent.id} className={`hub-sched-card ${agent.schedule_type}`}>
            <div className="hub-sched-card-header">
              <h3>{agent.name}</h3>
              <span className={`hub-sched-type-badge ${agent.schedule_type}`}>
                {agent.schedule_type === 'continuous' ? '24/7' : agent.schedule_type}
              </span>
            </div>

            <div className="hub-sched-info">
              <span>{agent.type}</span>
              <StatusBadge status={agent.status} />
            </div>

            {agent.last_run_at && (
              <div className="hub-sched-run-info">Last run: {formatDate(agent.last_run_at)}</div>
            )}
            {agent.next_run_at && (
              <div className="hub-sched-run-info">Next run: {formatDate(agent.next_run_at)}</div>
            )}

            {/* Execution mode toggle */}
            <div className="hub-sched-controls">
              <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '2px' }}>Execution Mode</label>
              <select
                value={agent.execution_mode || 'batch'}
                onChange={(e) => {
                  const mode = e.target.value;
                  updateSchedule(
                    agent.id,
                    agent.schedule_type,
                    agent.schedule_interval_minutes || undefined,
                    mode,
                  );
                }}
                style={{ fontSize: '0.8rem' }}
              >
                <option value="cli">CLI (OAuth)</option>
                <option value="batch">Batch API (50% off)</option>
                <option value="individual">Individual API (fast)</option>
              </select>
            </div>

            {/* Model selector */}
            <div className="hub-sched-controls" style={{ marginTop: '4px' }}>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '2px' }}>Model</label>
              <select
                value={agent.model_id || ''}
                onChange={(e) => {
                  const modelId = e.target.value;
                  updateAgentModel(agent.id, modelId);
                }}
                style={{ fontSize: '0.8rem' }}
              >
                <option value="">Default (Sonnet 4.6)</option>
                <option value="claude-haiku-4-5">Haiku 4.5 ($1/$5)</option>
                <option value="claude-sonnet-4-6">Sonnet 4.6 ($3/$15)</option>
                <option value="claude-opus-4-6">Opus 4.6 ($5/$25)</option>
              </select>
            </div>

            {/* Schedule type */}
            <div className="hub-sched-controls" style={{ marginTop: '4px' }}>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '2px' }}>Schedule</label>
              <select
                value={agent.schedule_type}
                onChange={(e) => {
                  const type = e.target.value;
                  if (type === 'scheduled') {
                    const mins = prompt('Run every X minutes:', '60');
                    if (mins) updateSchedule(agent.id, type, parseInt(mins), agent.execution_mode);
                  } else {
                    updateSchedule(agent.id, type, undefined, agent.execution_mode);
                  }
                }}
              >
                <option value="manual">Manual</option>
                <option value="scheduled">Scheduled</option>
                <option value="continuous">24/7 Continuous</option>
              </select>
              {agent.schedule_type === 'scheduled' && agent.schedule_interval_minutes && (
                <span className="hub-sched-interval">Every {agent.schedule_interval_minutes}m</span>
              )}
            </div>

            {/* Cost estimate badge */}
            {agent.schedule_type === 'scheduled' && (
              <div style={{
                marginTop: '6px',
                padding: '3px 8px',
                borderRadius: '4px',
                fontSize: '0.72rem',
                fontWeight: 500,
                background: (agent.execution_mode || 'batch') === 'batch'
                  ? 'rgba(124, 58, 237, 0.15)'
                  : 'rgba(245, 158, 11, 0.15)',
                color: (agent.execution_mode || 'batch') === 'batch'
                  ? 'var(--success, #7c3aed)'
                  : 'var(--warning, #f59e0b)',
                display: 'inline-block',
              }}>
                {estimateDailyCost(agent.model_id, agent.schedule_interval_minutes, agent.execution_mode || 'batch')}
              </div>
            )}
          </div>
        ))}
      </div>

      {schedules.length === 0 && (
        <p className="hub-no-data" style={{ textAlign: 'center', padding: '40px' }}>
          No agents found. Create agents in the Agent Fleet tab to configure schedules.
        </p>
      )}
    </>
  );
}
