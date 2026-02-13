import { useCallback } from 'react';
import { useHubStore } from '../../stores/hub';
import { usePolling } from '../../hooks/usePolling';
import AgentIcon from './shared/AgentIcon';
import PaginationBar from './shared/PaginationBar';
import EmptyState from './shared/EmptyState';

const formatDate = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

export default function InterventionGateway() {
  const interventions = useHubStore((s) => s.interventions);
  const pagination = useHubStore((s) => s.interventionPagination);
  const page = useHubStore((s) => s.interventionPage);
  const setPage = useHubStore((s) => s.setInterventionPage);
  const respondingTo = useHubStore((s) => s.respondingTo);
  const setRespondingTo = useHubStore((s) => s.setRespondingTo);
  const responseText = useHubStore((s) => s.responseText);
  const setResponseText = useHubStore((s) => s.setResponseText);
  const respondToIntervention = useHubStore((s) => s.respondToIntervention);
  const fetchInterventions = useHubStore((s) => s.fetchInterventions);
  const loading = useHubStore((s) => s.loading);

  const poll = useCallback(() => {
    fetchInterventions();
  }, [fetchInterventions]);
  usePolling(poll, 3000);

  if (loading.interventions && interventions.length === 0) {
    return <div className="hub-loading">Loading interventions...</div>;
  }

  if (interventions.length === 0) {
    return (
      <EmptyState
        icon="✅"
        title="All clear"
        message="No pending interventions. Agents are operating autonomously."
      />
    );
  }

  return (
    <>
      <div className="hub-gate-list">
        {interventions.map((intervention) => (
          <div key={intervention.id} className={`hub-gate-card ${intervention.type}`}>
            <div className="hub-gate-header">
              <AgentIcon type={intervention.agent_type} size="small" />
              <div className="hub-gate-info">
                <strong>{intervention.agent_name}</strong>
                <span className={`hub-gate-type ${intervention.type}`}>{intervention.type}</span>
              </div>
              <span className="hub-gate-time">{formatDate(intervention.created_at)}</span>
            </div>

            <h4 className="hub-gate-title">{intervention.title}</h4>

            {intervention.description && (
              <p className="hub-gate-desc">{intervention.description}</p>
            )}

            {intervention.proposed_action && (
              <div className="hub-gate-proposed">
                <strong>Proposed Action:</strong> {intervention.proposed_action}
              </div>
            )}

            <div className="hub-gate-actions">
              {respondingTo === intervention.id ? (
                <div className="hub-gate-response-form">
                  <textarea
                    value={responseText}
                    onChange={(e) => setResponseText(e.target.value)}
                    placeholder="Optional feedback for the agent..."
                    rows={2}
                  />
                  <div className="hub-gate-response-buttons">
                    <button className="hub-btn hub-btn--success" onClick={() => respondToIntervention(intervention.id, 'approve')}>
                      Approve
                    </button>
                    <button className="hub-btn hub-btn--danger" onClick={() => respondToIntervention(intervention.id, 'deny')}>
                      Deny
                    </button>
                    <button className="hub-btn" onClick={() => respondToIntervention(intervention.id, 'feedback')}>
                      Feedback Only
                    </button>
                    <button className="hub-btn hub-btn--ghost" onClick={() => { setRespondingTo(null); setResponseText(''); }}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <button className="hub-btn hub-btn--success" onClick={() => respondToIntervention(intervention.id, 'approve')}>
                    Approve
                  </button>
                  <button className="hub-btn hub-btn--danger" onClick={() => respondToIntervention(intervention.id, 'deny')}>
                    Deny
                  </button>
                  <button className="hub-btn" onClick={() => setRespondingTo(intervention.id)}>
                    Add Feedback
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      <PaginationBar pagination={pagination} currentPage={page} onPageChange={setPage} />
    </>
  );
}
