import { useState, useCallback } from 'react';
import { useHubStore } from '../../stores/hub';
import { usePolling } from '../../hooks/usePolling';
import AgentIcon, { AGENT_TYPE_INFO, STATUS_INFO } from './shared/AgentIcon';
import StatusBadge from './shared/StatusBadge';
import EmptyState from './shared/EmptyState';

const formatDate = (iso: string | null) => {
  if (!iso) return 'Never';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

export default function AgentFleet() {
  const agents = useHubStore((s) => s.agents);
  const showDecommissioned = useHubStore((s) => s.showDecommissioned);
  const setShowDecommissioned = useHubStore((s) => s.setShowDecommissioned);
  const setShowCreateAgent = useHubStore((s) => s.setShowCreateAgent);
  const setShowRunAgent = useHubStore((s) => s.setShowRunAgent);
  const showAgentDetail = useHubStore((s) => s.showAgentDetail);
  const setShowAgentDetail = useHubStore((s) => s.setShowAgentDetail);
  const selectedAgent = useHubStore((s) => s.selectedAgent);
  const agentLogs = useHubStore((s) => s.agentLogs);
  const agentTasks = useHubStore((s) => s.agentTasks);
  const loading = useHubStore((s) => s.loading);

  const fetchAgents = useHubStore((s) => s.fetchAgents);
  const fetchAgentDetail = useHubStore((s) => s.fetchAgentDetail);
  const stopAgent = useHubStore((s) => s.stopAgent);
  const processAgent = useHubStore((s) => s.processAgent);
  const decommissionAgent = useHubStore((s) => s.decommissionAgent);
  const recommissionAgent = useHubStore((s) => s.recommissionAgent);
  const deleteAgent = useHubStore((s) => s.deleteAgent);

  const [runningId, setRunningId] = useState<string | null>(null);

  const pollAgents = useCallback(() => {
    fetchAgents();
  }, [fetchAgents]);
  usePolling(pollAgents, 15000);

  // Poll agent detail when detail panel is open
  const pollDetail = useCallback(() => {
    if (showAgentDetail) fetchAgentDetail(showAgentDetail);
  }, [showAgentDetail, fetchAgentDetail]);
  usePolling(pollDetail, 5000, !!showAgentDetail);

  const activeAgents = agents.filter((a) => !a.is_decommissioned);
  const decommissionedAgents = agents.filter((a) => a.is_decommissioned);

  const handleProcessAgent = async (id: string) => {
    setRunningId(id);
    await processAgent(id);
    setRunningId(null);
  };

  if (loading.agents && agents.length === 0) {
    return <div className="hub-loading">Loading agents...</div>;
  }

  return (
    <>
      <div className="hub-fleet-header">
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: 'var(--text-secondary)', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={showDecommissioned}
            onChange={(e) => setShowDecommissioned(e.target.checked)}
          />
          Show decommissioned
        </label>
        <button className="hub-btn hub-btn--primary" onClick={() => setShowCreateAgent(true)}>
          Spin Up Agent
        </button>
      </div>

      {activeAgents.length === 0 && !showDecommissioned ? (
        <EmptyState
          icon="🤖"
          title="No agents yet"
          message="Create your first autonomous agent to start automating tasks."
          action={{ label: 'Spin Up Agent', onClick: () => setShowCreateAgent(true) }}
        />
      ) : (
        <div className="hub-fleet-grid">
          {activeAgents.map((agent) => (
            <div
              key={agent.id}
              className={`hub-fleet-card ${agent.status}`}
              onClick={() => setShowAgentDetail(agent.id)}
            >
              <div className="hub-fleet-card-header">
                <AgentIcon type={agent.type} />
                <div className="hub-fleet-card-info">
                  <h3>{agent.name}</h3>
                  <span className="hub-fleet-type">{AGENT_TYPE_INFO[agent.type]?.label || 'Custom'}</span>
                </div>
                <span className="hub-fleet-status" style={{ color: STATUS_INFO[agent.status]?.color }}>
                  <span className="hub-fleet-status-dot" style={{ background: STATUS_INFO[agent.status]?.color }} />
                  {STATUS_INFO[agent.status]?.label}
                </span>
              </div>

              <p className="hub-fleet-desc">{agent.description || 'No description'}</p>

              <div className="hub-fleet-autonomy">
                <div className="hub-fleet-autonomy-bar">
                  <div className="hub-fleet-autonomy-fill" style={{ width: `${(agent.autonomy_level / 5) * 100}%` }} />
                </div>
                <span className="hub-fleet-autonomy-label">Level {agent.autonomy_level}/5</span>
              </div>

              <div className="hub-fleet-footer">
                <span className="hub-fleet-tasks">
                  {agent.tasks_completed} completed
                  {agent.tasks_failed > 0 && <span className="failed"> &middot; {agent.tasks_failed} failed</span>}
                </span>
                <div className="hub-fleet-actions" onClick={(e) => e.stopPropagation()}>
                  {agent.status === 'running' ? (
                    <button className="hub-btn hub-btn--danger" onClick={() => stopAgent(agent.id)}>Stop</button>
                  ) : (
                    <>
                      <button
                        className="hub-btn"
                        onClick={() => handleProcessAgent(agent.id)}
                        disabled={runningId === agent.id}
                        title="Process queued task"
                      >
                        {runningId === agent.id ? '...' : '▶'}
                      </button>
                      <button
                        className="hub-btn hub-btn--primary"
                        onClick={() => setShowRunAgent(agent.id)}
                        disabled={runningId === agent.id}
                      >
                        Run
                      </button>
                    </>
                  )}
                </div>
              </div>

              {agent.pending_interventions > 0 && (
                <div className="hub-fleet-pending-badge">{agent.pending_interventions} pending review</div>
              )}
              {agent.last_run_at && (
                <div className="hub-fleet-last-run">Last run: {formatDate(agent.last_run_at)}</div>
              )}
            </div>
          ))}

          {showDecommissioned && decommissionedAgents.map((agent) => (
            <div key={agent.id} className="hub-fleet-card decommissioned" onClick={() => setShowAgentDetail(agent.id)}>
              <div className="hub-fleet-decom-overlay">DECOMMISSIONED</div>
              <div className="hub-fleet-card-header">
                <AgentIcon type={agent.type} decommissioned />
                <div className="hub-fleet-card-info">
                  <h3>{agent.name}</h3>
                  <span className="hub-fleet-type">{AGENT_TYPE_INFO[agent.type]?.label || 'Custom'}</span>
                </div>
              </div>
              <p className="hub-fleet-desc">{agent.description || 'No description'}</p>
              <div className="hub-fleet-footer">
                <span className="hub-fleet-tasks">{agent.tasks_completed} completed</span>
                <button
                  className="hub-btn"
                  onClick={(e) => { e.stopPropagation(); recommissionAgent(agent.id); }}
                >
                  Recommission
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Agent Detail Slide-over */}
      {showAgentDetail && selectedAgent && (
        <>
          <div className="hub-detail-overlay" onClick={() => setShowAgentDetail(null)} />
          <div className="hub-detail-panel">
            <div className="hub-detail-header">
              <div className="hub-detail-title">
                <AgentIcon type={selectedAgent.type} size="large" />
                <div>
                  <h2>{selectedAgent.name}</h2>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem', color: STATUS_INFO[selectedAgent.status]?.color }}>
                    <span className="hub-fleet-status-dot" style={{ background: STATUS_INFO[selectedAgent.status]?.color }} />
                    {STATUS_INFO[selectedAgent.status]?.label}
                  </span>
                  {selectedAgent.is_decommissioned && (
                    <StatusBadge status="decommissioned" className="hub-badge" />
                  )}
                </div>
              </div>
              <button className="hub-modal__close" onClick={() => setShowAgentDetail(null)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="hub-detail-stats">
              <div className="hub-detail-stat">
                <span className="stat-val">{selectedAgent.tasks_completed}</span>
                <span className="stat-lbl">Completed</span>
              </div>
              <div className="hub-detail-stat">
                <span className="stat-val error">{selectedAgent.tasks_failed}</span>
                <span className="stat-lbl">Failed</span>
              </div>
              <div className="hub-detail-stat">
                <span className="stat-val">{selectedAgent.autonomy_level}/5</span>
                <span className="stat-lbl">Autonomy</span>
              </div>
              <div className="hub-detail-stat">
                <span className="stat-val" style={{ fontSize: '0.8rem' }}>{formatDate(selectedAgent.last_run_at)}</span>
                <span className="stat-lbl">Last Run</span>
              </div>
            </div>

            <div className="hub-detail-section">
              <h3>Recent Tasks</h3>
              {agentTasks.length === 0 ? (
                <p className="hub-no-data">No tasks yet</p>
              ) : (
                agentTasks.slice(0, 5).map((task) => (
                  <div key={task.id} className="hub-detail-task-item">
                    <div className="hub-detail-task-header">
                      <span style={{ fontWeight: 600 }}>{task.type}</span>
                      <StatusBadge status={task.status} />
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem', marginLeft: 'auto' }}>{formatDate(task.created_at)}</span>
                    </div>
                    {task.output && 'response' in task.output && (
                      <div className="hub-detail-task-output">
                        {String(task.output.response).slice(0, 300)}...
                      </div>
                    )}
                    {task.error && <div className="hub-detail-task-error">{task.error}</div>}
                  </div>
                ))
              )}
            </div>

            <div className="hub-detail-section">
              <h3>Logs</h3>
              {agentLogs.length === 0 ? (
                <p className="hub-no-data">No logs yet</p>
              ) : (
                agentLogs.slice(0, 20).map((log) => (
                  <div key={log.id} className="hub-detail-log-item">
                    <span className="hub-detail-log-time">{formatDate(log.created_at)}</span>
                    <span className={`hub-detail-log-level ${log.level}`}>{log.level}</span>
                    <span className="hub-detail-log-msg">{log.message}</span>
                  </div>
                ))
              )}
            </div>

            <div className="hub-detail-actions">
              {selectedAgent.is_decommissioned ? (
                <>
                  <button className="hub-btn hub-btn--danger" onClick={() => { if (confirm('Permanently delete this agent?')) deleteAgent(selectedAgent.id); }}>
                    Delete Permanently
                  </button>
                  <button className="hub-btn hub-btn--primary" onClick={() => recommissionAgent(selectedAgent.id)}>
                    Recommission
                  </button>
                </>
              ) : (
                <>
                  <button className="hub-btn hub-btn--danger" onClick={() => { if (confirm('Decommission this agent?')) decommissionAgent(selectedAgent.id); }}>
                    Decommission
                  </button>
                  {selectedAgent.status === 'running' ? (
                    <button className="hub-btn hub-btn--danger" onClick={() => stopAgent(selectedAgent.id)}>
                      Stop Agent
                    </button>
                  ) : (
                    <button className="hub-btn hub-btn--primary" onClick={() => { setShowAgentDetail(null); setShowRunAgent(selectedAgent.id); }}>
                      Run Agent
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
