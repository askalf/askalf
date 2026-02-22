import { useState, useEffect, useCallback } from 'react';
import { hubApi } from '../../hooks/useHubApi';
import { usePolling } from '../../hooks/usePolling';
import EmptyState from './shared/EmptyState';

interface Checkpoint {
  id: string;
  executionId: string;
  agentId: string;
  agentName: string;
  type: string;
  title: string;
  description: string;
  proposedAction: string;
  status: string;
  response: string | null;
  createdAt: string;
  respondedAt: string | null;
}

const formatDate = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

export default function Checkpoints() {
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [respondingTo, setRespondingTo] = useState<string | null>(null);
  const [responseText, setResponseText] = useState('');

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await hubApi.checkpoints.list({ status: statusFilter || undefined });
      const list = (data as { checkpoints?: Checkpoint[] })?.checkpoints ?? [];
      setCheckpoints(Array.isArray(list) ? list : []);
    } catch (err) {
      console.error('Failed to load checkpoints:', err);
      setError('Failed to load checkpoints. The API may be unavailable.');
    }
    setLoading(false);
  }, [statusFilter]);

  useEffect(() => { setLoading(true); load(); }, [load]);
  usePolling(load, 5000);

  const handleRespond = async (id: string, action: 'approved' | 'rejected') => {
    try {
      await hubApi.checkpoints.respond(id, { response: responseText, status: action });
      setRespondingTo(null);
      setResponseText('');
      await load();
    } catch (err) { console.error(err); }
  };

  if (loading && checkpoints.length === 0) {
    return <div className="hub-loading">Loading checkpoints...</div>;
  }

  if (error) {
    return (
      <EmptyState
        icon="⚠"
        title="Failed to load checkpoints"
        message={error}
        action={{ label: 'Retry', onClick: load }}
      />
    );
  }

  if (checkpoints.length === 0) {
    return (
      <div>
        <div style={{ marginBottom: '12px' }}>
          <select className="hub-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="pending">Pending</option>
            <option value="">All</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
        <EmptyState
          icon="checkpoint"
          title="No checkpoints"
          message={statusFilter === 'pending'
            ? 'No pending checkpoints. Agents are running without needing human approval.'
            : 'No checkpoints match the selected filter.'}
        />
      </div>
    );
  }

  return (
    <>
      <div style={{ marginBottom: '12px' }}>
        <select className="hub-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="pending">Pending</option>
          <option value="">All</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>

      <div className="hub-gate-list">
        {checkpoints.map((cp) => (
          <div key={cp.id} className={`hub-gate-card ${cp.type || 'approval'}`}>
            <div className="hub-gate-header">
              <div className="hub-gate-info">
                <strong>{cp.agentName || cp.agentId}</strong>
                <span className={`hub-gate-type ${cp.type || 'approval'}`}>{cp.type || 'checkpoint'}</span>
              </div>
              <span className="hub-gate-time">{formatDate(cp.createdAt)}</span>
            </div>

            <h4 className="hub-gate-title">{cp.title}</h4>

            {cp.description && (
              <p className="hub-gate-desc">{cp.description}</p>
            )}

            {cp.proposedAction && (
              <div className="hub-gate-proposed">
                <strong>Proposed Action:</strong> {cp.proposedAction}
              </div>
            )}

            {cp.status === 'pending' && (
              <div className="hub-gate-actions">
                {respondingTo === cp.id ? (
                  <div className="hub-gate-response-form">
                    <textarea
                      value={responseText}
                      onChange={(e) => setResponseText(e.target.value)}
                      placeholder="Optional feedback for the agent..."
                      rows={2}
                    />
                    <div className="hub-gate-response-buttons">
                      <button className="hub-btn hub-btn--success" onClick={() => handleRespond(cp.id, 'approved')}>
                        Approve
                      </button>
                      <button className="hub-btn hub-btn--danger" onClick={() => handleRespond(cp.id, 'rejected')}>
                        Reject
                      </button>
                      <button className="hub-btn hub-btn--ghost" onClick={() => { setRespondingTo(null); setResponseText(''); }}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <button className="hub-btn hub-btn--success" onClick={() => handleRespond(cp.id, 'approved')}>
                      Approve
                    </button>
                    <button className="hub-btn hub-btn--danger" onClick={() => handleRespond(cp.id, 'rejected')}>
                      Reject
                    </button>
                    <button className="hub-btn" onClick={() => setRespondingTo(cp.id)}>
                      Add Feedback
                    </button>
                  </>
                )}
              </div>
            )}

            {cp.status !== 'pending' && (
              <div style={{ marginTop: '8px', fontSize: '12px', opacity: 0.6 }}>
                <span className={`hub-badge hub-badge--${cp.status === 'approved' ? 'success' : 'danger'}`}>{cp.status}</span>
                {cp.response && <span style={{ marginLeft: '8px' }}>{cp.response}</span>}
                {cp.respondedAt && <span style={{ marginLeft: '8px' }}>{formatDate(cp.respondedAt)}</span>}
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
