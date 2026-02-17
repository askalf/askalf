import { useCallback, useState } from 'react';
import { useHubStore } from '../../stores/hub';
import { usePolling } from '../../hooks/usePolling';
import Modal from '../hub/shared/Modal';
import StatusBadge from '../hub/shared/StatusBadge';
import './forge-observe.css';

const TYPE_INFO: Record<string, { label: string; color: string }> = {
  content_filter: { label: 'Content Filter', color: '#3b82f6' },
  cost_limit: { label: 'Cost Limit', color: '#f59e0b' },
  rate_limit: { label: 'Rate Limit', color: '#ef4444' },
  tool_restriction: { label: 'Tool Restriction', color: '#8b5cf6' },
  output_filter: { label: 'Output Filter', color: '#7c3aed' },
  custom: { label: 'Custom', color: '#6b7280' },
};

export default function GuardrailsManager() {
  const guardrails = useHubStore((s) => s.guardrails);
  const showCreateGuardrail = useHubStore((s) => s.showCreateGuardrail);
  const setShowCreateGuardrail = useHubStore((s) => s.setShowCreateGuardrail);
  const fetchGuardrails = useHubStore((s) => s.fetchGuardrails);
  const createGuardrail = useHubStore((s) => s.createGuardrail);
  const loading = useHubStore((s) => s.loading);

  const [newGuardrail, setNewGuardrail] = useState({
    name: '',
    type: 'content_filter',
    description: '',
    is_enabled: true,
    is_global: false,
    priority: 100,
  });
  const [creating, setCreating] = useState(false);

  const poll = useCallback(() => {
    fetchGuardrails();
  }, [fetchGuardrails]);
  usePolling(poll, 30000);

  const handleCreate = async () => {
    if (!newGuardrail.name.trim()) return;
    setCreating(true);
    const ok = await createGuardrail({
      name: newGuardrail.name,
      type: newGuardrail.type,
      description: newGuardrail.description || undefined,
      is_enabled: newGuardrail.is_enabled,
      is_global: newGuardrail.is_global,
      priority: newGuardrail.priority,
    });
    if (ok) {
      setShowCreateGuardrail(false);
      setNewGuardrail({ name: '', type: 'content_filter', description: '', is_enabled: true, is_global: false, priority: 100 });
    }
    setCreating(false);
  };

  const enabledCount = guardrails.filter((g) => g.is_enabled).length;
  const globalCount = guardrails.filter((g) => g.is_global).length;

  return (
    <div className="fo-overview">
      {/* Summary + Add */}
      <div className="fo-actions">
        <span className="fobs-summary-text">
          {guardrails.length} guardrail{guardrails.length !== 1 ? 's' : ''} configured
          {enabledCount > 0 && <> &middot; {enabledCount} active</>}
          {globalCount > 0 && <> &middot; {globalCount} global</>}
        </span>
        <button className="fo-action-btn" onClick={() => setShowCreateGuardrail(true)}>+ New Guardrail</button>
      </div>

      {/* Guardrail Cards */}
      {loading['guardrails'] && guardrails.length === 0 ? (
        <p className="fo-empty">Loading guardrails...</p>
      ) : guardrails.length === 0 ? (
        <div className="fo-panel">
          <p className="fo-empty">No guardrails configured. Create one to set safety limits for your fleet.</p>
        </div>
      ) : (
        <div className="fobs-guardrail-grid">
          {guardrails.map((g) => {
            const typeInfo = TYPE_INFO[g.type] || TYPE_INFO.custom;
            return (
              <div key={g.id} className={`fo-panel fobs-guardrail-card ${g.is_enabled ? '' : 'fobs-guardrail--disabled'}`}>
                <div className="fobs-guardrail-header">
                  <span className="fobs-guardrail-type" style={{ color: typeInfo.color }}>
                    {typeInfo.label}
                  </span>
                  <StatusBadge status={g.is_enabled ? 'active' : 'paused'} />
                </div>
                <h4 className="fobs-guardrail-name">{g.name}</h4>
                {g.description && <p className="fobs-guardrail-desc">{g.description}</p>}
                <div className="fobs-guardrail-meta">
                  {g.is_global && <span className="fobs-badge fobs-badge--green">Global</span>}
                  <span className="fobs-guardrail-priority">Priority: {g.priority}</span>
                  {g.agent_ids?.length > 0 && (
                    <span className="fobs-guardrail-agents">{g.agent_ids.length} agent{g.agent_ids.length !== 1 ? 's' : ''}</span>
                  )}
                </div>
                {g.config && Object.keys(g.config).length > 0 && (
                  <div className="fobs-guardrail-config">
                    <pre>{JSON.stringify(g.config, null, 2)}</pre>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Create Modal */}
      {showCreateGuardrail && (
        <Modal title="New Guardrail" onClose={() => setShowCreateGuardrail(false)}>
          <div className="hub-form-group">
            <label>Name</label>
            <input type="text" value={newGuardrail.name} onChange={(e) => setNewGuardrail({ ...newGuardrail, name: e.target.value })} placeholder="e.g., Max Cost Per Run" />
          </div>
          <div className="hub-form-group">
            <label>Type</label>
            <div className="hub-type-grid">
              {Object.entries(TYPE_INFO).map(([type, info]) => (
                <button
                  key={type}
                  className={`hub-type-chip ${newGuardrail.type === type ? 'active' : ''}`}
                  onClick={() => setNewGuardrail({ ...newGuardrail, type })}
                  style={{ '--type-color': info.color } as React.CSSProperties}
                >
                  {info.label}
                </button>
              ))}
            </div>
          </div>
          <div className="hub-form-group">
            <label>Description <span className="optional">(optional)</span></label>
            <textarea value={newGuardrail.description} onChange={(e) => setNewGuardrail({ ...newGuardrail, description: e.target.value })} placeholder="What does this guardrail enforce?" rows={3} />
          </div>
          <div className="hub-form-group" style={{ display: 'flex', gap: '1rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={newGuardrail.is_enabled} onChange={(e) => setNewGuardrail({ ...newGuardrail, is_enabled: e.target.checked })} />
              Enabled
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={newGuardrail.is_global} onChange={(e) => setNewGuardrail({ ...newGuardrail, is_global: e.target.checked })} />
              Global (all agents)
            </label>
          </div>
          <div className="hub-modal-actions">
            <button className="hub-btn" onClick={() => setShowCreateGuardrail(false)}>Cancel</button>
            <button className="hub-btn hub-btn--primary" onClick={handleCreate} disabled={creating || !newGuardrail.name.trim()}>
              {creating ? 'Creating...' : 'Create'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
