import { useCallback, useState } from 'react';
import { useHubStore } from '../../stores/hub';
import { usePolling } from '../../hooks/usePolling';
import type { Workflow } from '../../hooks/useHubApi';
import Modal from '../hub/shared/Modal';
import StatusBadge from '../hub/shared/StatusBadge';
import './forge-workflow.css';

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

export default function WorkflowBuilder() {
  const workflows = useHubStore((s) => s.workflows);
  const selectedWorkflow = useHubStore((s) => s.selectedWorkflow);
  const setSelectedWorkflow = useHubStore((s) => s.setSelectedWorkflow);
  const showCreateWorkflow = useHubStore((s) => s.showCreateWorkflow);
  const setShowCreateWorkflow = useHubStore((s) => s.setShowCreateWorkflow);
  const agents = useHubStore((s) => s.agents);
  const fetchWorkflows = useHubStore((s) => s.fetchWorkflows);
  const createWorkflow = useHubStore((s) => s.createWorkflow);
  const updateWorkflow = useHubStore((s) => s.updateWorkflow);
  const runWorkflow = useHubStore((s) => s.runWorkflow);
  const loading = useHubStore((s) => s.loading);

  const [newWorkflow, setNewWorkflow] = useState({ name: '', description: '' });
  const [creating, setCreating] = useState(false);
  const [running, setRunning] = useState(false);
  const [editingNode, setEditingNode] = useState<{ idx: number; label: string; agentId: string } | null>(null);

  const poll = useCallback(() => {
    fetchWorkflows();
  }, [fetchWorkflows]);
  usePolling(poll, 30000);

  const handleCreate = async () => {
    if (!newWorkflow.name.trim()) return;
    setCreating(true);
    const name = newWorkflow.name;
    const description = newWorkflow.description || undefined;
    // Close modal and reset form before the API call to prevent
    // the modal from being abruptly unmounted when selectedWorkflow changes
    setShowCreateWorkflow(false);
    setNewWorkflow({ name: '', description: '' });
    await createWorkflow({ name, description });
    setCreating(false);
  };

  const handleRun = async (wf: Workflow) => {
    setRunning(true);
    await runWorkflow(wf.id);
    setRunning(false);
  };

  const handleAddNode = async () => {
    if (!selectedWorkflow) return;
    const nodes = [...(selectedWorkflow.definition?.nodes || [])];
    const newNode = {
      id: `node-${nodes.length + 1}`,
      type: 'agent',
      label: `Step ${nodes.length + 1}`,
      agentId: '',
      agentName: '',
    };
    nodes.push(newNode);

    // Auto-connect edges
    const edges = [...(selectedWorkflow.definition?.edges || [])];
    if (nodes.length >= 2) {
      edges.push({ from: nodes[nodes.length - 2].id, to: newNode.id });
    }

    await updateWorkflow(selectedWorkflow.id, { definition: { nodes, edges } });
  };

  const handleSaveNode = async () => {
    if (!selectedWorkflow || !editingNode) return;
    const nodes = [...(selectedWorkflow.definition?.nodes || [])];
    const agent = agents.find((a) => a.id === editingNode.agentId);
    nodes[editingNode.idx] = {
      ...nodes[editingNode.idx],
      label: editingNode.label,
      agentId: editingNode.agentId,
      agentName: agent?.name || '',
    };
    await updateWorkflow(selectedWorkflow.id, { definition: { ...(selectedWorkflow.definition || {}), nodes } });
    setEditingNode(null);
  };

  const handleRemoveNode = async (idx: number) => {
    if (!selectedWorkflow) return;
    const nodes = [...(selectedWorkflow.definition?.nodes || [])];
    const removedId = nodes[idx].id;
    nodes.splice(idx, 1);
    const edges = (selectedWorkflow.definition?.edges || []).filter(
      (e) => e.from !== removedId && e.to !== removedId,
    );
    // Reconnect edges around removed node
    if (idx > 0 && idx < nodes.length) {
      edges.push({ from: nodes[idx - 1].id, to: nodes[idx].id });
    }
    await updateWorkflow(selectedWorkflow.id, { definition: { nodes, edges } });
  };

  const activeAgents = agents.filter((a) => !a.is_decommissioned);

  const nodes = selectedWorkflow
    ? (selectedWorkflow.definition?.nodes || []) as Array<{ id: string; type: string; label: string; agentId?: string; agentName?: string }>
    : [];
  const edges = selectedWorkflow
    ? (selectedWorkflow.definition?.edges || []) as Array<{ from: string; to: string }>
    : [];

  return (
    <div className="fo-overview">
      {/* List view */}
      {!selectedWorkflow && (
        <>
          <div className="fo-actions">
            <span className="fobs-summary-text">
              {workflows.length} workflow{workflows.length !== 1 ? 's' : ''}
            </span>
            <button className="fo-action-btn" onClick={() => setShowCreateWorkflow(true)}>+ New Workflow</button>
          </div>

          {loading['workflows'] && workflows.length === 0 ? (
            <p className="fo-empty">Loading workflows...</p>
          ) : workflows.length === 0 ? (
            <div className="fo-panel">
              <p className="fo-empty">No workflows yet. Create one to orchestrate multi-agent pipelines.</p>
            </div>
          ) : (
            <div className="fwb-workflow-list">
              {workflows.map((wf) => (
                <div key={wf.id} className="fo-panel fwb-workflow-card" onClick={() => setSelectedWorkflow(wf)}>
                  <div className="fwb-workflow-header">
                    <div>
                      <strong className="fwb-workflow-name">{wf.name}</strong>
                      <StatusBadge status={wf.status} />
                    </div>
                    <span className="fwb-workflow-meta">
                      v{wf.version} &middot; {(wf.definition?.nodes || []).length} nodes &middot; Updated {relativeTime(wf.updated_at)}
                    </span>
                  </div>
                  {wf.description && <p className="fwb-workflow-desc">{wf.description}</p>}
                  {(wf.definition?.nodes || []).length > 0 && (
                    <div className="fwb-mini-flow">
                      {(wf.definition?.nodes as Array<{ id: string; label: string }>).map((node, i) => (
                        <span key={node.id} className="fwb-mini-node">
                          {i > 0 && <span className="fwb-mini-arrow">&rarr;</span>}
                          {node.label}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Detail / builder view */}
      {selectedWorkflow && (
        <>
          <div className="fwb-detail-header">
            <button className="fwb-back-btn" onClick={() => setSelectedWorkflow(null)}>&larr; Back</button>
            <div className="fwb-detail-title">
              <h3>{selectedWorkflow.name}</h3>
              <StatusBadge status={selectedWorkflow.status} />
              <span className="fwb-workflow-meta">v{selectedWorkflow.version}</span>
            </div>
            <div className="fwb-detail-actions">
              <button
                className="fo-action-btn fo-action-btn--primary"
                onClick={() => handleRun(selectedWorkflow)}
                disabled={running || nodes.length === 0}
              >
                {running ? 'Starting...' : 'Run Workflow'}
              </button>
              {selectedWorkflow.status === 'draft' && (
                <button
                  className="fo-action-btn"
                  onClick={() => updateWorkflow(selectedWorkflow.id, { status: 'active' })}
                >
                  Activate
                </button>
              )}
            </div>
          </div>

          {selectedWorkflow.description && (
            <p className="fwb-detail-desc">{selectedWorkflow.description}</p>
          )}

          <div className="fo-panel">
            <div className="fo-panel-header">
              <span className="fo-panel-title">Pipeline</span>
              <span className="fo-panel-count">{nodes.length} nodes</span>
            </div>
            <div className="fwb-flow">
              {nodes.map((node, idx) => {
                const hasEdgeIn = edges.some((e) => e.to === node.id);
                return (
                  <div key={node.id} className="fwb-flow-step">
                    {hasEdgeIn && <div className="fwb-flow-connector" />}
                    <div className="fwb-node">
                      <div className="fwb-node-header">
                        <span className="fwb-node-label">{node.label}</span>
                        <div className="fwb-node-actions">
                          <button
                            className="fwb-node-btn"
                            onClick={() => setEditingNode({ idx, label: node.label, agentId: node.agentId || '' })}
                            title="Edit"
                          >
                            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M11.5 1.5l3 3L5 14H2v-3L11.5 1.5z"/></svg>
                          </button>
                          <button className="fwb-node-btn fwb-node-btn--danger" onClick={() => handleRemoveNode(idx)} title="Remove">
                            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 4l8 8M12 4l-8 8"/></svg>
                          </button>
                        </div>
                      </div>
                      {node.agentName && (
                        <span className="fwb-node-agent">{node.agentName}</span>
                      )}
                      {!node.agentId && (
                        <span className="fwb-node-unassigned">No agent assigned</span>
                      )}
                    </div>
                  </div>
                );
              })}
              <button className="fwb-add-node" onClick={handleAddNode}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14"/></svg>
                Add Step
              </button>
            </div>
          </div>

          {/* Edit Node Modal */}
          {editingNode && (
            <Modal title="Edit Node" onClose={() => setEditingNode(null)} size="small">
              <div className="hub-form-group">
                <label>Label</label>
                <input type="text" value={editingNode.label} onChange={(e) => setEditingNode({ ...editingNode, label: e.target.value })} />
              </div>
              <div className="hub-form-group">
                <label>Agent</label>
                <select
                  value={editingNode.agentId}
                  onChange={(e) => setEditingNode({ ...editingNode, agentId: e.target.value })}
                  className="fobs-select"
                  style={{ width: '100%' }}
                >
                  <option value="">Select an agent...</option>
                  {activeAgents.map((a) => (
                    <option key={a.id} value={a.id}>{a.name} ({a.type})</option>
                  ))}
                </select>
              </div>
              <div className="hub-modal-actions">
                <button className="hub-btn" onClick={() => setEditingNode(null)}>Cancel</button>
                <button className="hub-btn hub-btn--primary" onClick={handleSaveNode}>Save</button>
              </div>
            </Modal>
          )}
        </>
      )}

      {/* Create Workflow Modal — always available regardless of view */}
      {showCreateWorkflow && (
        <Modal title="New Workflow" onClose={() => setShowCreateWorkflow(false)}>
          <div className="hub-form-group">
            <label>Name</label>
            <input type="text" value={newWorkflow.name} onChange={(e) => setNewWorkflow({ ...newWorkflow, name: e.target.value })} placeholder="e.g., Deploy Pipeline" />
          </div>
          <div className="hub-form-group">
            <label>Description <span className="optional">(optional)</span></label>
            <textarea value={newWorkflow.description} onChange={(e) => setNewWorkflow({ ...newWorkflow, description: e.target.value })} placeholder="What does this workflow do?" rows={3} />
          </div>
          <div className="hub-modal-actions">
            <button className="hub-btn" onClick={() => setShowCreateWorkflow(false)}>Cancel</button>
            <button className="hub-btn hub-btn--primary" onClick={handleCreate} disabled={creating || !newWorkflow.name.trim()}>
              {creating ? 'Creating...' : 'Create'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
