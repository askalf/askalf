import { useState, useEffect, useCallback } from 'react';
import { useHubStore } from '../../stores/hub';
import { hubApi } from '../../hooks/useHubApi';
import StatCard from '../hub/shared/StatCard';
import './forge-observe.css';

interface Goal {
  id: string;
  agent_id: string;
  agent_name?: string;
  title: string;
  description: string;
  rationale: string;
  priority: string;
  source: string;
  status: string;
  metadata: Record<string, unknown>;
}

export default function GoalManager() {
  const agents = useHubStore((s) => s.agents);
  const fetchAgents = useHubStore((s) => s.fetchAgents);
  const [selectedAgent, setSelectedAgent] = useState('');
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(false);
  const [proposing, setProposing] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');

  useEffect(() => { fetchAgents(); }, [fetchAgents]);

  const loadGoals = useCallback(async () => {
    setLoading(true);
    try {
      if (selectedAgent) {
        const data = await hubApi.goals.list(selectedAgent, statusFilter || undefined) as Goal[];
        setGoals(Array.isArray(data) ? data : []);
      } else {
        const data = await hubApi.goals.listAll(statusFilter || undefined);
        const list = (data as { goals?: Goal[] })?.goals ?? [];
        setGoals(Array.isArray(list) ? list : []);
      }
    } catch { setGoals([]); }
    setLoading(false);
  }, [selectedAgent, statusFilter]);

  useEffect(() => { loadGoals(); }, [loadGoals]);

  const handlePropose = async () => {
    if (!selectedAgent) return;
    setProposing(true);
    try {
      await hubApi.goals.propose(selectedAgent);
      await loadGoals();
    } catch (err) { console.error(err); }
    setProposing(false);
  };

  const handleAction = async (goalId: string, action: 'approve' | 'reject') => {
    try {
      if (action === 'approve') await hubApi.goals.approve(goalId);
      else await hubApi.goals.reject(goalId);
      await loadGoals();
    } catch (err) { console.error(err); }
  };

  const proposed = goals.filter((g) => g.status === 'proposed');
  const approved = goals.filter((g) => g.status === 'approved' || g.status === 'in_progress');
  const priorityColor: Record<string, string> = { critical: '#ef4444', high: '#f97316', medium: '#eab308', low: '#6b7280' };

  return (
    <div className="fo-overview">
      <div className="fo-stats">
        <StatCard value={goals.length} label="Total Goals" />
        <StatCard value={proposed.length} label="Proposed" variant={proposed.length > 0 ? 'warning' : 'default'} />
        <StatCard value={approved.length} label="Active" variant="success" />
      </div>

      <div className="fo-section">
        <div className="fo-section-header">
          <h3>Autonomous Goals</h3>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <select className="hub-select" value={selectedAgent} onChange={(e) => setSelectedAgent(e.target.value)}>
              <option value="">All Agents</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <select className="hub-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All statuses</option>
              <option value="proposed">Proposed</option>
              <option value="approved">Approved</option>
              <option value="completed">Completed</option>
              <option value="rejected">Rejected</option>
            </select>
            <button className="hub-btn hub-btn--primary" onClick={handlePropose} disabled={proposing || !selectedAgent}>
              {proposing ? 'Analyzing...' : 'Propose Goals'}
            </button>
          </div>
        </div>

        {loading && <div className="fo-empty">Loading goals...</div>}

        {!loading && goals.length === 0 && (
          <div className="fo-empty">{selectedAgent ? 'No goals for this agent. Click "Propose Goals" to analyze performance and suggest improvements.' : 'No goals across the fleet yet. Select an agent to propose goals.'}</div>
        )}

        {goals.map((goal) => (
          <div key={goal.id} className="fo-card" style={{ marginBottom: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '4px' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: priorityColor[goal.priority] || '#6b7280' }} />
                  {!selectedAgent && goal.agent_name && <span style={{ fontSize: '11px', opacity: 0.6, marginRight: '4px' }}>[{goal.agent_name}]</span>}
                  <strong>{goal.title}</strong>
                  <span className={`hub-badge hub-badge--${goal.status === 'proposed' ? 'warning' : goal.status === 'approved' ? 'success' : goal.status === 'rejected' ? 'danger' : 'default'}`}>
                    {goal.status}
                  </span>
                  <span style={{ fontSize: '11px', opacity: 0.5 }}>{goal.priority} priority</span>
                </div>
                <div style={{ fontSize: '13px', marginBottom: '4px' }}>{goal.description}</div>
                <div style={{ fontSize: '12px', opacity: 0.6 }}><em>Rationale:</em> {goal.rationale}</div>
              </div>
              {goal.status === 'proposed' && (
                <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                  <button className="hub-btn hub-btn--primary hub-btn--sm" onClick={() => handleAction(goal.id, 'approve')}>Approve</button>
                  <button className="hub-btn hub-btn--sm" onClick={() => handleAction(goal.id, 'reject')}>Reject</button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
