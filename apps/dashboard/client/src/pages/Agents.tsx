import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './Agents.css';

const API_BASE = window.location.hostname.includes('askalf.org')
  ? ''
  : 'http://localhost:3001';

interface Agent {
  id: string;
  name: string;
  type: 'dev' | 'research' | 'support' | 'content' | 'monitor' | 'custom';
  status: 'idle' | 'running' | 'paused' | 'error';
  description: string;
  system_prompt: string;
  schedule: string | null;
  config: Record<string, unknown>;
  autonomy_level: number;
  is_decommissioned: boolean;
  decommissioned_at: string | null;
  created_at: string;
  updated_at: string;
  last_run_at: string | null;
  tasks_completed: number;
  tasks_failed: number;
  current_task: string | null;
  pending_interventions: number;
}

interface AgentLog {
  id: string;
  level: string;
  message: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface AgentTask {
  id: string;
  type: string;
  status: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  error: string | null;
  started_at: string;
  completed_at: string | null;
  created_at: string;
}

interface Intervention {
  id: string;
  agent_id: string;
  agent_name: string;
  agent_type: string;
  task_id: string | null;
  type: string;
  title: string;
  description: string;
  context: Record<string, unknown>;
  proposed_action: string;
  status: string;
  human_response: string | null;
  autonomy_delta: number;
  created_at: string;
}

interface OrchestrationStats {
  agents: {
    total: number;
    active: number;
    running: number;
    decommissioned: number;
    avgAutonomy: number;
  };
  pendingInterventions: number;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

const AGENT_TYPE_INFO: Record<string, { icon: string; color: string; label: string }> = {
  dev: { icon: '🔧', color: '#8b5cf6', label: 'Development' },
  research: { icon: '🔬', color: '#3b82f6', label: 'Research' },
  support: { icon: '💬', color: '#10b981', label: 'Support' },
  content: { icon: '✍️', color: '#f59e0b', label: 'Content' },
  monitor: { icon: '📊', color: '#ef4444', label: 'Monitoring' },
  custom: { icon: '⚡', color: '#6366f1', label: 'Custom' },
};

const STATUS_INFO: Record<string, { color: string; label: string }> = {
  idle: { color: '#6b7280', label: 'Idle' },
  running: { color: '#10b981', label: 'Running' },
  paused: { color: '#f59e0b', label: 'Paused' },
  error: { color: '#ef4444', label: 'Error' },
};

export default function Agents() {
  const navigate = useNavigate();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [interventions, setInterventions] = useState<Intervention[]>([]);
  const [stats, setStats] = useState<OrchestrationStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'orchestration' | 'agents' | 'interventions'>('orchestration');
  const [showDecommissioned, setShowDecommissioned] = useState(false);
  const [interventionPage, setInterventionPage] = useState(1);
  const [interventionPagination, setInterventionPagination] = useState<Pagination | null>(null);

  // Modal states
  const [showCreate, setShowCreate] = useState(false);
  const [showDetail, setShowDetail] = useState<string | null>(null);
  const [showRun, setShowRun] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [agentLogs, setAgentLogs] = useState<AgentLog[]>([]);
  const [agentTasks, setAgentTasks] = useState<AgentTask[]>([]);

  const [newAgent, setNewAgent] = useState<{
    name: string;
    type: Agent['type'];
    description: string;
    system_prompt: string;
  }>({
    name: '',
    type: 'custom',
    description: '',
    system_prompt: '',
  });
  const [runPrompt, setRunPrompt] = useState('');
  const [creating, setCreating] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [respondingTo, setRespondingTo] = useState<string | null>(null);
  const [responseText, setResponseText] = useState('');

  const fetchAll = async () => {
    try {
      const [agentsRes, interventionsRes, statsRes] = await Promise.all([
        fetch(`${API_BASE}/api/v1/admin/agents?include_decommissioned=${showDecommissioned}`, { credentials: 'include' }),
        fetch(`${API_BASE}/api/v1/admin/interventions?status=pending&page=${interventionPage}&limit=20`, { credentials: 'include' }),
        fetch(`${API_BASE}/api/v1/admin/orchestration`, { credentials: 'include' }),
      ]);

      if (agentsRes.ok) {
        const data = await agentsRes.json();
        setAgents(data.agents || []);
      }
      if (interventionsRes.ok) {
        const data = await interventionsRes.json();
        setInterventions(data.interventions || []);
        setInterventionPagination(data.pagination || null);
      }
      if (statsRes.ok) {
        const data = await statsRes.json();
        setStats(data);
      }
    } catch (err) {
      console.error('Failed to fetch:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchAgentDetail = async (id: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/admin/agents/${id}`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setSelectedAgent(data.agent);
        setAgentLogs(data.logs || []);
        setAgentTasks(data.tasks || []);
      }
    } catch (err) {
      console.error('Failed to fetch agent detail:', err);
    }
  };

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 5000);
    return () => clearInterval(interval);
  }, [showDecommissioned, interventionPage]);

  useEffect(() => {
    if (showDetail) {
      fetchAgentDetail(showDetail);
      const interval = setInterval(() => fetchAgentDetail(showDetail), 3000);
      return () => clearInterval(interval);
    }
  }, [showDetail]);

  const createAgent = async () => {
    if (!newAgent.name.trim()) return;
    setCreating(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/admin/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(newAgent),
      });
      if (res.ok) {
        setShowCreate(false);
        setNewAgent({ name: '', type: 'custom', description: '', system_prompt: '' });
        fetchAll();
      }
    } catch (err) {
      console.error('Failed to create agent:', err);
    } finally {
      setCreating(false);
    }
  };

  const runAgent = async (agentId: string, prompt?: string) => {
    setRunning(agentId);
    try {
      const res = await fetch(`${API_BASE}/api/v1/admin/agents/${agentId}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          task_type: 'manual',
          input: prompt ? { prompt } : {},
        }),
      });
      if (res.ok) {
        setShowRun(null);
        setRunPrompt('');
        fetchAll();
      }
    } catch (err) {
      console.error('Failed to run agent:', err);
    } finally {
      setRunning(null);
    }
  };

  const stopAgent = async (agentId: string) => {
    try {
      await fetch(`${API_BASE}/api/v1/admin/agents/${agentId}/stop`, {
        method: 'POST',
        credentials: 'include',
      });
      fetchAll();
    } catch (err) {
      console.error('Failed to stop agent:', err);
    }
  };

  const decommissionAgent = async (agentId: string) => {
    if (!confirm('Decommission this agent? It will stop all tasks and be marked inactive.')) return;
    try {
      await fetch(`${API_BASE}/api/v1/admin/agents/${agentId}/decommission`, {
        method: 'POST',
        credentials: 'include',
      });
      setShowDetail(null);
      fetchAll();
    } catch (err) {
      console.error('Failed to decommission agent:', err);
    }
  };

  const recommissionAgent = async (agentId: string) => {
    try {
      await fetch(`${API_BASE}/api/v1/admin/agents/${agentId}/recommission`, {
        method: 'POST',
        credentials: 'include',
      });
      fetchAll();
    } catch (err) {
      console.error('Failed to recommission agent:', err);
    }
  };

  const deleteAgent = async (agentId: string) => {
    if (!confirm('Permanently delete this agent? This cannot be undone.')) return;
    try {
      await fetch(`${API_BASE}/api/v1/admin/agents/${agentId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      setShowDetail(null);
      fetchAll();
    } catch (err) {
      console.error('Failed to delete agent:', err);
    }
  };

  const [batchRunning, setBatchRunning] = useState(false);
  const [batchResult, setBatchResult] = useState<{ started: number; agents: string[] } | null>(null);

  const batchProcessAgents = async () => {
    setBatchRunning(true);
    setBatchResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/admin/agents/batch/process`, {
        method: 'POST',
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setBatchResult({ started: data.started, agents: data.agents || [] });
        fetchAll();
      }
    } catch (err) {
      console.error('Failed to batch process agents:', err);
    } finally {
      setBatchRunning(false);
    }
  };

  const processAgentPending = async (agentId: string) => {
    setRunning(agentId);
    try {
      const res = await fetch(`${API_BASE}/api/v1/admin/agents/${agentId}/process`, {
        method: 'POST',
        credentials: 'include',
      });
      if (res.ok) {
        fetchAll();
      }
    } catch (err) {
      console.error('Failed to process agent pending task:', err);
    } finally {
      setRunning(null);
    }
  };

  const respondToIntervention = async (id: string, action: 'approve' | 'deny' | 'feedback') => {
    setRespondingTo(id);
    try {
      await fetch(`${API_BASE}/api/v1/admin/interventions/${id}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          action,
          response: responseText || undefined,
        }),
      });
      setResponseText('');
      setRespondingTo(null);
      fetchAll();
    } catch (err) {
      console.error('Failed to respond:', err);
    }
  };

  const formatDate = (iso: string | null) => {
    if (!iso) return 'Never';
    const d = new Date(iso);
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const activeAgents = agents.filter(a => !a.is_decommissioned);
  const decommissionedAgents = agents.filter(a => a.is_decommissioned);

  return (
    <div className="agents-page">
      <header className="agents-header">
        <div className="header-left">
          <button className="back-btn" onClick={() => navigate('/app/chat')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h1>Agent Orchestration</h1>
            <p className="header-subtitle">Monitor, control, and scale autonomous agents</p>
          </div>
        </div>
        <div className="header-actions">
          {interventions.length > 0 && (
            <button
              className={`intervention-badge ${activeTab === 'interventions' ? 'active' : ''}`}
              onClick={() => setActiveTab('interventions')}
            >
              <span className="badge-count">{interventions.length}</span>
              Needs Attention
            </button>
          )}
          <button className="reports-btn" onClick={() => navigate('/admin/hub/reports')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
              <path d="M9 19v-6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2zm0 0V9a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v10m-6 0a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2m0 0V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2z" />
            </svg>
            Reports
          </button>
          <button className="create-btn" onClick={() => setShowCreate(true)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Spin Up Agent
          </button>
        </div>
      </header>

      {/* Navigation Tabs */}
      <div className="orchestration-tabs">
        <button
          className={activeTab === 'orchestration' ? 'active' : ''}
          onClick={() => setActiveTab('orchestration')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
            <rect x="3" y="3" width="7" height="7" />
            <rect x="14" y="3" width="7" height="7" />
            <rect x="14" y="14" width="7" height="7" />
            <rect x="3" y="14" width="7" height="7" />
          </svg>
          Overview
        </button>
        <button
          className={activeTab === 'agents' ? 'active' : ''}
          onClick={() => setActiveTab('agents')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
            <circle cx="12" cy="8" r="4" />
            <path d="M6 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" />
          </svg>
          Agents ({activeAgents.length})
        </button>
        <button
          className={`${activeTab === 'interventions' ? 'active' : ''} ${interventions.length > 0 ? 'has-pending' : ''}`}
          onClick={() => setActiveTab('interventions')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
            <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          Interventions {interventions.length > 0 && <span className="tab-badge">{interventions.length}</span>}
        </button>
      </div>

      {/* Content based on active tab */}
      <div className="orchestration-content">
        {loading ? (
          <div className="agents-loading">Loading orchestration data...</div>
        ) : activeTab === 'orchestration' ? (
          // ORCHESTRATION OVERVIEW
          <div className="orchestration-overview">
            <div className="stats-grid">
              <div className="stat-card large">
                <div className="stat-icon">🤖</div>
                <div className="stat-value">{stats?.agents.active || 0}</div>
                <div className="stat-label">Active Agents</div>
              </div>
              <div className="stat-card">
                <div className={`stat-value ${(stats?.agents.running || 0) > 0 ? 'running' : ''}`}>
                  {stats?.agents.running || 0}
                </div>
                <div className="stat-label">Running Now</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{stats?.agents.avgAutonomy || 0}%</div>
                <div className="stat-label">Avg Autonomy</div>
              </div>
              <div className={`stat-card ${(stats?.pendingInterventions || 0) > 0 ? 'warning' : ''}`}>
                <div className="stat-value">{stats?.pendingInterventions || 0}</div>
                <div className="stat-label">Pending Review</div>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="quick-actions">
              <h3>Quick Actions</h3>
              <div className="action-buttons">
                <button
                  className={`run-all-btn ${batchRunning ? 'running' : ''}`}
                  onClick={batchProcessAgents}
                  disabled={batchRunning}
                >
                  <span>{batchRunning ? '⏳' : '🚀'}</span>
                  {batchRunning ? 'Starting Agents...' : 'Run All Agents'}
                </button>
                <button onClick={() => setShowCreate(true)}>
                  <span>➕</span> Spin Up New Agent
                </button>
                <button onClick={() => setActiveTab('interventions')}>
                  <span>👁️</span> Review Interventions
                </button>
                <button onClick={() => navigate('/admin/hub/tickets?source=agent')}>
                  <span>🎫</span> Agent Tickets
                </button>
              </div>
              {batchResult && (
                <div className="batch-result">
                  Started {batchResult.started} agents: {batchResult.agents.join(', ') || 'None'}
                </div>
              )}
            </div>

            {/* Running Agents */}
            <div className="running-agents">
              <h3>Currently Running</h3>
              {activeAgents.filter(a => a.status === 'running').length === 0 ? (
                <p className="no-data">No agents currently running</p>
              ) : (
                <div className="running-list">
                  {activeAgents.filter(a => a.status === 'running').map(agent => (
                    <div key={agent.id} className="running-item" onClick={() => setShowDetail(agent.id)}>
                      <span className="agent-icon" style={{ background: AGENT_TYPE_INFO[agent.type]?.color }}>
                        {AGENT_TYPE_INFO[agent.type]?.icon}
                      </span>
                      <div className="running-info">
                        <strong>{agent.name}</strong>
                        <span>{agent.current_task || 'Processing...'}</span>
                      </div>
                      <button className="stop-btn-small" onClick={(e) => { e.stopPropagation(); stopAgent(agent.id); }}>
                        Stop
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Agents Needing Attention */}
            {activeAgents.filter(a => a.pending_interventions > 0 || a.status === 'error').length > 0 && (
              <div className="attention-agents">
                <h3>Needs Attention</h3>
                <div className="attention-list">
                  {activeAgents.filter(a => a.pending_interventions > 0 || a.status === 'error').map(agent => (
                    <div key={agent.id} className="attention-item" onClick={() => setShowDetail(agent.id)}>
                      <span className="agent-icon" style={{ background: AGENT_TYPE_INFO[agent.type]?.color }}>
                        {AGENT_TYPE_INFO[agent.type]?.icon}
                      </span>
                      <div className="attention-info">
                        <strong>{agent.name}</strong>
                        {agent.status === 'error' && <span className="attention-badge error">Error</span>}
                        {agent.pending_interventions > 0 && (
                          <span className="attention-badge warning">{agent.pending_interventions} pending</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : activeTab === 'agents' ? (
          // AGENTS LIST
          <div className="agents-list-view">
            <div className="list-header">
              <label className="show-decom">
                <input
                  type="checkbox"
                  checked={showDecommissioned}
                  onChange={(e) => setShowDecommissioned(e.target.checked)}
                />
                Show decommissioned
              </label>
            </div>

            {activeAgents.length === 0 && !showDecommissioned ? (
              <div className="agents-empty">
                <div className="empty-icon">🤖</div>
                <h3>No agents yet</h3>
                <p>Create your first autonomous agent to start automating tasks.</p>
                <button className="create-btn" onClick={() => setShowCreate(true)}>Spin Up Agent</button>
              </div>
            ) : (
              <div className="agents-grid">
                {activeAgents.map(agent => (
                  <div key={agent.id} className={`agent-card ${agent.status}`} onClick={() => setShowDetail(agent.id)}>
                    <div className="agent-header">
                      <span className="agent-icon" style={{ background: AGENT_TYPE_INFO[agent.type]?.color }}>
                        {AGENT_TYPE_INFO[agent.type]?.icon}
                      </span>
                      <div className="agent-info">
                        <h3>{agent.name}</h3>
                        <span className="agent-type">{AGENT_TYPE_INFO[agent.type]?.label}</span>
                      </div>
                      <span className="agent-status" style={{ color: STATUS_INFO[agent.status]?.color }}>
                        <span className="status-dot" style={{ background: STATUS_INFO[agent.status]?.color }} />
                        {STATUS_INFO[agent.status]?.label}
                      </span>
                    </div>
                    <p className="agent-description">{agent.description || 'No description'}</p>
                    <div className="agent-autonomy">
                      <div className="autonomy-bar">
                        <div className="autonomy-fill" style={{ width: `${agent.autonomy_level}%` }} />
                      </div>
                      <span className="autonomy-label">{agent.autonomy_level}% autonomy</span>
                    </div>
                    <div className="agent-footer">
                      <span className="agent-tasks">
                        {agent.tasks_completed} completed
                        {agent.tasks_failed > 0 && <span className="failed"> · {agent.tasks_failed} failed</span>}
                      </span>
                      <div className="agent-actions" onClick={e => e.stopPropagation()}>
                        {agent.status === 'running' ? (
                          <button className="agent-btn danger" onClick={() => stopAgent(agent.id)}>Stop</button>
                        ) : (
                          <>
                            <button
                              className="agent-btn"
                              onClick={() => processAgentPending(agent.id)}
                              disabled={running === agent.id}
                              title="Process queued task"
                            >
                              {running === agent.id ? '...' : '▶'}
                            </button>
                            <button
                              className="agent-btn primary"
                              onClick={() => setShowRun(agent.id)}
                              disabled={running === agent.id}
                            >
                              Run
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    {agent.pending_interventions > 0 && (
                      <div className="agent-pending-badge">{agent.pending_interventions} pending review</div>
                    )}
                    {agent.last_run_at && (
                      <div className="agent-last-run">Last run: {formatDate(agent.last_run_at)}</div>
                    )}
                  </div>
                ))}

                {showDecommissioned && decommissionedAgents.map(agent => (
                  <div key={agent.id} className="agent-card decommissioned" onClick={() => setShowDetail(agent.id)}>
                    <div className="decom-overlay">DECOMMISSIONED</div>
                    <div className="agent-header">
                      <span className="agent-icon" style={{ background: '#4b5563' }}>
                        {AGENT_TYPE_INFO[agent.type]?.icon}
                      </span>
                      <div className="agent-info">
                        <h3>{agent.name}</h3>
                        <span className="agent-type">{AGENT_TYPE_INFO[agent.type]?.label}</span>
                      </div>
                    </div>
                    <p className="agent-description">{agent.description || 'No description'}</p>
                    <div className="agent-footer">
                      <span className="agent-tasks">{agent.tasks_completed} completed</span>
                      <button
                        className="agent-btn"
                        onClick={(e) => { e.stopPropagation(); recommissionAgent(agent.id); }}
                      >
                        Recommission
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          // INTERVENTIONS
          <div className="interventions-view">
            {interventions.length === 0 ? (
              <div className="interventions-empty">
                <div className="empty-icon">✅</div>
                <h3>All clear</h3>
                <p>No pending interventions. Agents are operating autonomously.</p>
              </div>
            ) : (
              <>
                <div className="interventions-list">
                  {interventions.map(intervention => (
                    <div key={intervention.id} className={`intervention-card ${intervention.type}`}>
                      <div className="intervention-header">
                        <span className="agent-icon" style={{ background: AGENT_TYPE_INFO[intervention.agent_type]?.color }}>
                          {AGENT_TYPE_INFO[intervention.agent_type]?.icon}
                        </span>
                        <div className="intervention-info">
                          <strong>{intervention.agent_name}</strong>
                          <span className={`intervention-type ${intervention.type}`}>{intervention.type}</span>
                          <span className="intervention-time">{formatDate(intervention.created_at)}</span>
                        </div>
                      </div>
                      <h4 className="intervention-title">{intervention.title}</h4>
                      {intervention.description && (
                        <p className="intervention-desc">{intervention.description}</p>
                      )}
                      {intervention.proposed_action && (
                        <div className="intervention-proposed">
                          <strong>Proposed Action:</strong> {intervention.proposed_action}
                        </div>
                      )}
                      <div className="intervention-actions">
                        {respondingTo === intervention.id ? (
                          <div className="response-form">
                            <textarea
                              value={responseText}
                              onChange={(e) => setResponseText(e.target.value)}
                              placeholder="Optional feedback for the agent..."
                              rows={2}
                            />
                            <div className="response-buttons">
                              <button className="approve-btn" onClick={() => respondToIntervention(intervention.id, 'approve')}>
                                ✓ Approve
                              </button>
                              <button className="deny-btn" onClick={() => respondToIntervention(intervention.id, 'deny')}>
                                ✕ Deny
                              </button>
                              <button className="feedback-btn" onClick={() => respondToIntervention(intervention.id, 'feedback')}>
                                💬 Feedback Only
                              </button>
                              <button className="cancel-btn" onClick={() => { setRespondingTo(null); setResponseText(''); }}>
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="quick-response">
                            <button className="approve-btn" onClick={() => respondToIntervention(intervention.id, 'approve')}>
                              ✓ Approve
                            </button>
                            <button className="deny-btn" onClick={() => respondToIntervention(intervention.id, 'deny')}>
                              ✕ Deny
                            </button>
                            <button className="expand-btn" onClick={() => setRespondingTo(intervention.id)}>
                              Add Feedback
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Pagination */}
                {interventionPagination && interventionPagination.totalPages > 1 && (
                  <div className="interventions-pagination">
                    <button
                      disabled={!interventionPagination.hasPrev}
                      onClick={() => setInterventionPage(interventionPage - 1)}
                    >
                      ← Prev
                    </button>
                    <span className="page-info">
                      Page {interventionPagination.page} of {interventionPagination.totalPages}
                      <span className="total-count">({interventionPagination.total} total)</span>
                    </span>
                    <button
                      disabled={!interventionPagination.hasNext}
                      onClick={() => setInterventionPage(interventionPage + 1)}
                    >
                      Next →
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Create Agent Modal */}
      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h2>Spin Up Agent</h2>
            <div className="form-group">
              <label>Name</label>
              <input
                type="text"
                value={newAgent.name}
                onChange={e => setNewAgent({ ...newAgent, name: e.target.value })}
                placeholder="e.g., DevOps Monitor"
              />
            </div>
            <div className="form-group">
              <label>Type</label>
              <div className="type-grid">
                {Object.entries(AGENT_TYPE_INFO).map(([type, info]) => (
                  <button
                    key={type}
                    className={`type-chip ${newAgent.type === type ? 'active' : ''}`}
                    onClick={() => setNewAgent({ ...newAgent, type: type as Agent['type'] })}
                    style={{ '--type-color': info.color } as React.CSSProperties}
                  >
                    <span>{info.icon}</span>
                    {info.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="form-group">
              <label>Description</label>
              <input
                type="text"
                value={newAgent.description}
                onChange={e => setNewAgent({ ...newAgent, description: e.target.value })}
                placeholder="What does this agent do?"
              />
            </div>
            <div className="form-group">
              <label>System Prompt <span className="optional">(optional - uses default if empty)</span></label>
              <textarea
                value={newAgent.system_prompt}
                onChange={e => setNewAgent({ ...newAgent, system_prompt: e.target.value })}
                placeholder="Custom instructions for this agent..."
                rows={4}
              />
            </div>
            <div className="modal-actions">
              <button className="cancel-btn" onClick={() => setShowCreate(false)}>Cancel</button>
              <button className="submit-btn" onClick={createAgent} disabled={creating || !newAgent.name.trim()}>
                {creating ? 'Creating...' : 'Spin Up'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Run Agent Modal */}
      {showRun && (
        <div className="modal-overlay" onClick={() => setShowRun(null)}>
          <div className="modal-content small" onClick={e => e.stopPropagation()}>
            <h2>Run Agent</h2>
            <div className="form-group">
              <label>Task Prompt <span className="optional">(optional - uses default task if empty)</span></label>
              <textarea
                value={runPrompt}
                onChange={e => setRunPrompt(e.target.value)}
                placeholder="What should the agent work on?"
                rows={4}
                autoFocus
              />
            </div>
            <div className="modal-actions">
              <button className="cancel-btn" onClick={() => setShowRun(null)}>Cancel</button>
              <button
                className="submit-btn"
                onClick={() => runAgent(showRun, runPrompt)}
                disabled={running === showRun}
              >
                {running === showRun ? 'Starting...' : 'Run Now'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Agent Detail Modal */}
      {showDetail && selectedAgent && (
        <div className="modal-overlay" onClick={() => setShowDetail(null)}>
          <div className="modal-content large" onClick={e => e.stopPropagation()}>
            <div className="detail-header">
              <div className="detail-title">
                <span className="agent-icon" style={{ background: AGENT_TYPE_INFO[selectedAgent.type]?.color }}>
                  {AGENT_TYPE_INFO[selectedAgent.type]?.icon}
                </span>
                <div>
                  <h2>{selectedAgent.name}</h2>
                  <span className="agent-status" style={{ color: STATUS_INFO[selectedAgent.status]?.color }}>
                    <span className="status-dot" style={{ background: STATUS_INFO[selectedAgent.status]?.color }} />
                    {STATUS_INFO[selectedAgent.status]?.label}
                  </span>
                  {selectedAgent.is_decommissioned && (
                    <span className="decom-badge">DECOMMISSIONED</span>
                  )}
                </div>
              </div>
              <button className="modal-close" onClick={() => setShowDetail(null)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="detail-stats">
              <div className="detail-stat">
                <span className="stat-val">{selectedAgent.tasks_completed}</span>
                <span className="stat-lbl">Completed</span>
              </div>
              <div className="detail-stat">
                <span className="stat-val error">{selectedAgent.tasks_failed}</span>
                <span className="stat-lbl">Failed</span>
              </div>
              <div className="detail-stat">
                <span className="stat-val">{selectedAgent.autonomy_level}%</span>
                <span className="stat-lbl">Autonomy</span>
              </div>
              <div className="detail-stat">
                <span className="stat-val">{formatDate(selectedAgent.last_run_at)}</span>
                <span className="stat-lbl">Last Run</span>
              </div>
            </div>

            <div className="detail-section">
              <h3>Recent Tasks</h3>
              {agentTasks.length === 0 ? (
                <p className="no-data">No tasks yet</p>
              ) : (
                <div className="tasks-list">
                  {agentTasks.slice(0, 5).map(task => (
                    <div key={task.id} className={`task-item ${task.status}`}>
                      <div className="task-header">
                        <span className="task-type">{task.type}</span>
                        <span className={`task-status ${task.status}`}>{task.status}</span>
                        <span className="task-time">{formatDate(task.created_at)}</span>
                      </div>
                      {task.output && 'response' in task.output && (
                        <div className="task-output">{String(task.output.response as string).slice(0, 300)}...</div>
                      )}
                      {task.error && <div className="task-error">{task.error}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="detail-section">
              <h3>Logs</h3>
              {agentLogs.length === 0 ? (
                <p className="no-data">No logs yet</p>
              ) : (
                <div className="logs-list">
                  {agentLogs.slice(0, 20).map(log => (
                    <div key={log.id} className={`log-item ${log.level}`}>
                      <span className="log-time">{formatDate(log.created_at)}</span>
                      <span className={`log-level ${log.level}`}>{log.level}</span>
                      <span className="log-message">{log.message}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="detail-actions">
              {selectedAgent.is_decommissioned ? (
                <>
                  <button className="delete-btn" onClick={() => deleteAgent(selectedAgent.id)}>Delete Permanently</button>
                  <button className="recommission-btn" onClick={() => recommissionAgent(selectedAgent.id)}>Recommission</button>
                </>
              ) : (
                <>
                  <button className="decom-btn" onClick={() => decommissionAgent(selectedAgent.id)}>Decommission</button>
                  {selectedAgent.status === 'running' ? (
                    <button className="stop-btn" onClick={() => stopAgent(selectedAgent.id)}>Stop Agent</button>
                  ) : (
                    <button className="run-btn" onClick={() => { setShowDetail(null); setShowRun(selectedAgent.id); }}>
                      Run Agent
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
