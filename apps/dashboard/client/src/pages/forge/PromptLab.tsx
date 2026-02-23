import { useState, useEffect, useCallback } from 'react';
import { useHubStore } from '../../stores/hub';
import { hubApi } from '../../hooks/useHubApi';
import { usePolling } from '../../hooks/usePolling';
import StatCard from '../hub/shared/StatCard';
import './forge-observe.css';

interface Revision {
  id: string;
  agent_id: string;
  agent_name?: string;
  current_prompt: string;
  proposed_prompt: string;
  reasoning: string;
  status: string;
  correction_patterns_used: string[];
}

export default function PromptLab() {
  const agents = useHubStore((s) => s.agents);
  const fetchAgents = useHubStore((s) => s.fetchAgents);
  const [selectedAgent, setSelectedAgent] = useState('');
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [loading, setLoading] = useState(false);
  const [proposing, setProposing] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => { fetchAgents(); }, [fetchAgents]);

  const loadRevisions = useCallback(async () => {
    setLoading(true);
    try {
      if (selectedAgent) {
        const data = await hubApi.promptRevisions.list(selectedAgent) as Revision[];
        setRevisions(Array.isArray(data) ? data : []);
      } else {
        const data = await hubApi.promptRevisions.listAll();
        const list = (data as { revisions?: Revision[] })?.revisions ?? [];
        setRevisions(Array.isArray(list) ? list : []);
      }
    } catch { setRevisions([]); }
    setLoading(false);
  }, [selectedAgent]);

  useEffect(() => { loadRevisions(); }, [loadRevisions]);
  usePolling(loadRevisions, 30000);

  const handlePropose = async () => {
    if (!selectedAgent) return;
    setProposing(true);
    try {
      await hubApi.promptRevisions.propose(selectedAgent);
      await loadRevisions();
    } catch (err) {
      console.error(err);
    }
    setProposing(false);
  };

  const handleAction = async (revisionId: string, action: 'apply' | 'reject') => {
    try {
      if (action === 'apply') await hubApi.promptRevisions.apply(revisionId);
      else await hubApi.promptRevisions.reject(revisionId);
      await loadRevisions();
    } catch (err) {
      console.error(err);
    }
  };

  const pending = revisions.filter((r) => r.status === 'pending');
  const applied = revisions.filter((r) => r.status === 'applied');

  return (
    <div className="fo-overview">
      <div className="fo-stats">
        <StatCard value={revisions.length} label="Total Revisions" />
        <StatCard value={pending.length} label="Pending Review" variant={pending.length > 0 ? 'warning' : 'default'} />
        <StatCard value={applied.length} label="Applied" variant="success" />
      </div>

      <div className="fo-section">
        <div className="fo-section-header">
          <h3>Self-Rewriting Prompts</h3>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <select className="hub-select" value={selectedAgent} onChange={(e) => setSelectedAgent(e.target.value)}>
              <option value="">All Agents</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            {selectedAgent && (
              <button className="hub-btn hub-btn--primary" onClick={handlePropose} disabled={proposing}>
                {proposing ? 'Analyzing...' : 'Propose Revision'}
              </button>
            )}
          </div>
        </div>

        {loading && <div className="fo-empty">Loading revisions...</div>}

        {!loading && revisions.length === 0 && (
          <div className="fo-empty">{selectedAgent ? 'No prompt revisions for this agent yet. Click "Propose Revision" to analyze correction patterns.' : 'No pending prompt revisions across the fleet.'}</div>
        )}

        {revisions.map((rev) => (
          <div key={rev.id} className="fo-card" style={{ marginBottom: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <div>
                {!selectedAgent && rev.agent_name && <span style={{ fontSize: '12px', opacity: 0.6, marginRight: '8px' }}>[{rev.agent_name}]</span>}
                <span className={`hub-badge hub-badge--${rev.status === 'pending' ? 'warning' : rev.status === 'applied' ? 'success' : 'default'}`}>
                  {rev.status}
                </span>
                <span style={{ marginLeft: '8px', fontSize: '13px', opacity: 0.7 }}>
                  {rev.correction_patterns_used?.length ?? 0} correction patterns used
                </span>
              </div>
              {rev.status === 'pending' && (
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button className="hub-btn hub-btn--primary hub-btn--sm" onClick={() => handleAction(rev.id, 'apply')}>Apply</button>
                  <button className="hub-btn hub-btn--sm" onClick={() => handleAction(rev.id, 'reject')}>Reject</button>
                </div>
              )}
            </div>
            <div style={{ fontSize: '13px', marginBottom: '8px' }}><strong>Reasoning:</strong> {rev.reasoning}</div>
            <button className="hub-btn hub-btn--sm" onClick={() => setExpandedId(expandedId === rev.id ? null : rev.id)}>
              {expandedId === rev.id ? 'Hide Diff' : 'Show Diff'}
            </button>
            {expandedId === rev.id && (
              <div style={{ marginTop: '8px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <div>
                  <div style={{ fontSize: '11px', fontWeight: 600, marginBottom: '4px', opacity: 0.6 }}>CURRENT</div>
                  <pre style={{ fontSize: '11px', background: 'rgba(255,255,255,0.03)', padding: '8px', borderRadius: '6px', maxHeight: '300px', overflow: 'auto', whiteSpace: 'pre-wrap' }}>{rev.current_prompt}</pre>
                </div>
                <div>
                  <div style={{ fontSize: '11px', fontWeight: 600, marginBottom: '4px', color: '#4ade80' }}>PROPOSED</div>
                  <pre style={{ fontSize: '11px', background: 'rgba(74,222,128,0.05)', padding: '8px', borderRadius: '6px', maxHeight: '300px', overflow: 'auto', whiteSpace: 'pre-wrap' }}>{rev.proposed_prompt}</pre>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
