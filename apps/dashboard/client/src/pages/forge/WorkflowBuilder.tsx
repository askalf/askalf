import { useCallback, useMemo, useState } from 'react';
import { useHubStore } from '../../stores/hub';
import { usePolling } from '../../hooks/usePolling';
import type { Workflow, WorkflowNode, WorkflowEdge } from '../../hooks/useHubApi';
import Modal from '../hub/shared/Modal';
import StatusBadge from '../hub/shared/StatusBadge';
import './forge-workflow.css';

/* ─── Node Type Registry ─── */
const NODE_TYPES: Record<string, { icon: string; color: string; bg: string; label: string; desc: string }> = {
  input:            { icon: '→', color: '#10b981', bg: 'rgba(16,185,129,0.12)',  label: 'Input',      desc: 'Workflow entry point' },
  output:           { icon: '←', color: '#ef4444', bg: 'rgba(239,68,68,0.12)',   label: 'Output',     desc: 'Collect final result' },
  agent:            { icon: '⚡', color: '#8b5cf6', bg: 'rgba(139,92,246,0.12)', label: 'Agent',      desc: 'Run an agent with a prompt' },
  condition:        { icon: '◇', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', label: 'Condition',  desc: 'Branch based on expression' },
  parallel:         { icon: '⫘', color: '#3b82f6', bg: 'rgba(59,130,246,0.12)', label: 'Parallel',   desc: 'Run nodes concurrently' },
  merge:            { icon: '⫗', color: '#06b6d4', bg: 'rgba(6,182,212,0.12)',  label: 'Merge',      desc: 'Combine branch outputs' },
  transform:        { icon: '↹', color: '#6b7280', bg: 'rgba(107,114,128,0.12)',label: 'Transform',  desc: 'Reshape data between steps' },
  human_checkpoint: { icon: '⏸', color: '#f97316', bg: 'rgba(249,115,22,0.12)', label: 'Checkpoint', desc: 'Pause for human approval' },
};

const NODE_TYPE_KEYS = Object.keys(NODE_TYPES);

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

/* ─── Node Config Summary (inline preview) ─── */
function nodeConfigSummary(node: WorkflowNode): string {
  const cfg = node.config || {};
  switch (node.type) {
    case 'agent':
      return node.agentName || (node.agentId ? `Agent ${node.agentId.slice(0, 8)}...` : 'No agent assigned');
    case 'condition':
      return (cfg.expression as string) || 'No expression set';
    case 'parallel':
      return (cfg.nodeIds as string[])?.length ? `${(cfg.nodeIds as string[]).length} concurrent nodes` : 'No nodes configured';
    case 'merge':
      return (cfg.sources as string[])?.length ? `${(cfg.sources as string[]).length} sources` : 'No sources configured';
    case 'transform':
      return cfg.mapping ? `${Object.keys(cfg.mapping as object).length} mappings` : 'No mappings set';
    case 'human_checkpoint':
      return (cfg.checkpointType as string) || 'approval';
    case 'input': return 'Passes workflow input';
    case 'output': return (cfg.source as string) ? `Exports: ${cfg.source}` : 'Exports full context';
    default: return '';
  }
}

/* ─── Node Warnings ─── */
function getNodeWarnings(node: WorkflowNode, edges: WorkflowEdge[]): string[] {
  const warnings: string[] = [];
  if (node.type === 'agent' && !node.agentId) warnings.push('No agent assigned');
  if (node.type === 'condition' && !(node.config?.expression)) warnings.push('No expression set');
  const hasIncoming = edges.some(e => e.to === node.id);
  const hasOutgoing = edges.some(e => e.from === node.id);
  if (node.type !== 'input' && !hasIncoming) warnings.push('No incoming connection');
  if (node.type !== 'output' && !hasOutgoing) warnings.push('No outgoing connection');
  return warnings;
}

/* ─── Type-specific Config Editor ─── */
interface NodeEditorProps {
  node: WorkflowNode;
  onChange: (updated: WorkflowNode) => void;
  agents: Array<{ id: string; name: string; type: string; is_decommissioned: boolean }>;
  allNodes: WorkflowNode[];
}

function NodeConfigEditor({ node, onChange, agents, allNodes }: NodeEditorProps) {
  const cfg = { ...(node.config || {}) };
  const setConfig = (key: string, value: unknown) => onChange({ ...node, config: { ...cfg, [key]: value } });
  const activeAgents = agents.filter(a => !a.is_decommissioned);
  const otherNodes = allNodes.filter(n => n.id !== node.id);

  switch (node.type) {
    case 'agent':
      return (
        <>
          <div className="hub-form-group">
            <label>Agent</label>
            <select
              value={node.agentId || ''}
              onChange={(e) => {
                const agent = activeAgents.find(a => a.id === e.target.value);
                onChange({ ...node, agentId: e.target.value, agentName: agent?.name || '' });
              }}
              className="fobs-select" style={{ width: '100%' }}
            >
              <option value="">Select an agent...</option>
              {activeAgents.map(a => <option key={a.id} value={a.id}>{a.name} ({a.type})</option>)}
            </select>
          </div>
          <div className="hub-form-group">
            <label>Prompt Template</label>
            <textarea
              value={(cfg.prompt as string) || ''}
              onChange={(e) => setConfig('prompt', e.target.value)}
              placeholder="Describe the task for this agent..."
              rows={4}
            />
            <span className="fwb-context-hint">Reference previous outputs: {'{{nodeId.field}}'}</span>
          </div>
          <div className="hub-form-group">
            <label>Model Override <span className="optional">(optional)</span></label>
            <select
              value={(cfg.model as string) || ''}
              onChange={(e) => setConfig('model', e.target.value || undefined)}
              className="fobs-select" style={{ width: '100%' }}
            >
              <option value="">Use agent default</option>
              <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5</option>
              <option value="claude-sonnet-4-6">Claude Sonnet 4.6</option>
              <option value="claude-opus-4-6">Claude Opus 4.6</option>
            </select>
          </div>
          <div className="hub-form-group">
            <label>Max Cost <span className="optional">(optional, $)</span></label>
            <input
              type="number" min="0.01" step="0.10"
              value={(cfg.maxCost as number) || ''}
              onChange={(e) => setConfig('maxCost', e.target.value ? parseFloat(e.target.value) : undefined)}
              placeholder="0.50"
              className="fobs-input" style={{ maxWidth: 120 }}
            />
          </div>
        </>
      );

    case 'condition':
      return (
        <>
          <div className="hub-form-group">
            <label>Expression</label>
            <input
              type="text"
              value={(cfg.expression as string) || ''}
              onChange={(e) => setConfig('expression', e.target.value)}
              placeholder='result.score > 80'
            />
            <span className="fwb-context-hint">
              Operators: ==, !=, {'>'}, {'<'}, {'>='}, {'<='}, contains, exists.
              Paths resolve from shared context.
            </span>
          </div>
          <p className="fwb-type-desc">Routes execution to different branches based on this expression. Add conditional edges from this node to target branches.</p>
        </>
      );

    case 'parallel':
      return (
        <>
          <div className="hub-form-group">
            <label>Nodes to Execute Concurrently</label>
            <div className="fwb-multi-select">
              {otherNodes.map(n => {
                const selected = ((cfg.nodeIds as string[]) || []).includes(n.id);
                return (
                  <label key={n.id} className={`fwb-multi-option ${selected ? 'selected' : ''}`}>
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={(e) => {
                        const current = (cfg.nodeIds as string[]) || [];
                        setConfig('nodeIds', e.target.checked ? [...current, n.id] : current.filter(id => id !== n.id));
                      }}
                    />
                    <span className="fwb-node-badge-sm" style={{ color: NODE_TYPES[n.type]?.color || '#6b7280' }}>
                      {NODE_TYPES[n.type]?.icon || '•'}
                    </span>
                    {n.label}
                  </label>
                );
              })}
            </div>
          </div>
        </>
      );

    case 'merge':
      return (
        <>
          <div className="hub-form-group">
            <label>Source Nodes to Merge</label>
            <div className="fwb-multi-select">
              {otherNodes.map(n => {
                const selected = ((cfg.sources as string[]) || []).includes(n.id);
                return (
                  <label key={n.id} className={`fwb-multi-option ${selected ? 'selected' : ''}`}>
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={(e) => {
                        const current = (cfg.sources as string[]) || [];
                        setConfig('sources', e.target.checked ? [...current, n.id] : current.filter(id => id !== n.id));
                      }}
                    />
                    <span className="fwb-node-badge-sm" style={{ color: NODE_TYPES[n.type]?.color || '#6b7280' }}>
                      {NODE_TYPES[n.type]?.icon || '•'}
                    </span>
                    {n.label}
                  </label>
                );
              })}
            </div>
          </div>
        </>
      );

    case 'transform':
      return (
        <>
          <div className="hub-form-group">
            <label>Key Mapping (JSON)</label>
            <textarea
              value={cfg.mapping ? JSON.stringify(cfg.mapping, null, 2) : ''}
              onChange={(e) => {
                try { setConfig('mapping', JSON.parse(e.target.value)); } catch { /* ignore invalid json while typing */ }
              }}
              placeholder={'{\n  "summary": "agent1.output",\n  "score": "agent2.result.score"\n}'}
              rows={5}
              className="fobs-input"
              style={{ fontFamily: 'monospace', fontSize: '0.75rem', width: '100%' }}
            />
            <span className="fwb-context-hint">Map output keys to context paths from previous nodes</span>
          </div>
        </>
      );

    case 'human_checkpoint':
      return (
        <>
          <div className="hub-form-group">
            <label>Checkpoint Type</label>
            <select
              value={(cfg.checkpointType as string) || 'approval'}
              onChange={(e) => setConfig('checkpointType', e.target.value)}
              className="fobs-select" style={{ width: '100%' }}
            >
              <option value="approval">Approval (yes/no)</option>
              <option value="review">Review (with feedback)</option>
              <option value="input">Input (free-form response)</option>
              <option value="confirmation">Confirmation (proceed/cancel)</option>
            </select>
          </div>
          <div className="hub-form-group">
            <label>Title</label>
            <input
              type="text"
              value={(cfg.title as string) || ''}
              onChange={(e) => setConfig('title', e.target.value)}
              placeholder="Review agent output before proceeding"
            />
          </div>
          <div className="hub-form-group">
            <label>Description <span className="optional">(optional)</span></label>
            <textarea
              value={(cfg.description as string) || ''}
              onChange={(e) => setConfig('description', e.target.value)}
              placeholder="Describe what the reviewer should check..."
              rows={3}
            />
          </div>
          <div className="hub-form-group">
            <label>Timeout (minutes) <span className="optional">(optional)</span></label>
            <input
              type="number" min="1" step="1"
              value={(cfg.timeoutMinutes as number) || ''}
              onChange={(e) => setConfig('timeoutMinutes', e.target.value ? parseInt(e.target.value) : undefined)}
              placeholder="5"
              className="fobs-input" style={{ maxWidth: 120 }}
            />
          </div>
        </>
      );

    case 'output':
      return (
        <div className="hub-form-group">
          <label>Source Key <span className="optional">(optional)</span></label>
          <input
            type="text"
            value={(cfg.source as string) || ''}
            onChange={(e) => setConfig('source', e.target.value)}
            placeholder="Leave empty to export full context"
          />
          <span className="fwb-context-hint">Specify a context key to export, e.g. "agent1" or "merged_result"</span>
        </div>
      );

    case 'input':
      return <p className="fwb-type-desc">This node passes the workflow&apos;s input data into the shared context as <code>__input</code>. No configuration needed.</p>;

    default:
      return <p className="fwb-type-desc">No configuration available for this node type.</p>;
  }
}

/* ─── Flow Node Card ─── */
function FlowNode({
  node, edges, onEdit, onDelete, onConnect,
}: {
  node: WorkflowNode;
  edges: WorkflowEdge[];
  onEdit: () => void;
  onDelete: () => void;
  onConnect: () => void;
}) {
  const meta = NODE_TYPES[node.type] || NODE_TYPES.agent;
  const warnings = getNodeWarnings(node, edges);
  const summary = nodeConfigSummary(node);
  const incomingEdges = edges.filter(e => e.to === node.id);

  return (
    <div className="fwb-flow-step">
      {incomingEdges.map((edge) => (
        <div key={`${edge.from}-${edge.to}`} className="fwb-flow-connector">
          {edge.condition && (
            <span className="fwb-edge-label">{edge.condition}</span>
          )}
        </div>
      ))}
      <div className="fwb-node" style={{ borderLeft: `3px solid ${meta.color}` }}>
        <div className="fwb-node-header">
          <div className="fwb-node-title-row">
            <span className="fwb-node-badge" style={{ color: meta.color, background: meta.bg }}>{meta.icon}</span>
            <span className="fwb-node-label">{node.label}</span>
            <span className="fwb-node-type-tag">{meta.label}</span>
          </div>
          <div className="fwb-node-actions">
            <button className="fwb-node-btn" onClick={onConnect} title="Connect to...">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 2v12M2 8h12"/></svg>
            </button>
            <button className="fwb-node-btn" onClick={onEdit} title="Edit">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M11.5 1.5l3 3L5 14H2v-3L11.5 1.5z"/></svg>
            </button>
            <button className="fwb-node-btn fwb-node-btn--danger" onClick={onDelete} title="Remove">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 4l8 8M12 4l-8 8"/></svg>
            </button>
          </div>
        </div>
        <div className="fwb-node-config-summary">{summary}</div>
        {warnings.length > 0 && (
          <div className="fwb-node-warnings">
            {warnings.map((w, i) => (
              <span key={i} className="fwb-node-warning">⚠ {w}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Main Component ─── */
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
  const [editingNode, setEditingNode] = useState<WorkflowNode | null>(null);
  const [addingNodeType, setAddingNodeType] = useState<string | null>(null);
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null);
  const [showNodePicker, setShowNodePicker] = useState(false);

  const poll = useCallback(() => { fetchWorkflows(); }, [fetchWorkflows]);
  usePolling(poll, 30000);

  const nodes: WorkflowNode[] = selectedWorkflow?.definition?.nodes || [];
  const edges: WorkflowEdge[] = selectedWorkflow?.definition?.edges || [];

  // Stats
  const stats = useMemo(() => {
    const active = workflows.filter(w => w.status === 'active').length;
    const draft = workflows.filter(w => w.status === 'draft').length;
    const totalNodes = workflows.reduce((s, w) => s + (w.definition?.nodes?.length || 0), 0);
    return { total: workflows.length, active, draft, totalNodes };
  }, [workflows]);

  /* ─── Handlers ─── */
  const handleCreate = async () => {
    if (!newWorkflow.name.trim()) return;
    setCreating(true);
    const name = newWorkflow.name;
    const description = newWorkflow.description || undefined;
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

  const saveDefinition = async (newNodes: WorkflowNode[], newEdges: WorkflowEdge[]) => {
    if (!selectedWorkflow) return;
    await updateWorkflow(selectedWorkflow.id, { definition: { nodes: newNodes, edges: newEdges } });
  };

  const handleAddNode = (type: string) => {
    setAddingNodeType(type);
    setShowNodePicker(false);
    const id = `${type}-${Date.now().toString(36)}`;
    const meta = NODE_TYPES[type];
    const newNode: WorkflowNode = {
      id, type, label: `${meta?.label || type} ${nodes.length + 1}`,
      config: type === 'human_checkpoint' ? { checkpointType: 'approval' } : {},
    };
    setEditingNode(newNode);
  };

  const handleSaveNode = async () => {
    if (!editingNode) return;
    const existingIdx = nodes.findIndex(n => n.id === editingNode.id);
    let newNodes: WorkflowNode[];
    let newEdges = [...edges];

    if (existingIdx >= 0) {
      // Update existing
      newNodes = [...nodes];
      newNodes[existingIdx] = editingNode;
    } else {
      // Add new
      newNodes = [...nodes, editingNode];
      // Auto-connect from last node if there is one
      if (nodes.length > 0) {
        newEdges.push({ from: nodes[nodes.length - 1].id, to: editingNode.id });
      }
    }

    await saveDefinition(newNodes, newEdges);
    setEditingNode(null);
    setAddingNodeType(null);
  };

  const handleRemoveNode = async (nodeId: string) => {
    const idx = nodes.findIndex(n => n.id === nodeId);
    if (idx < 0) return;
    const newNodes = nodes.filter(n => n.id !== nodeId);
    // Remove edges to/from this node and reconnect
    let newEdges = edges.filter(e => e.from !== nodeId && e.to !== nodeId);
    // Reconnect: if node was between two others, connect them
    const incoming = edges.filter(e => e.to === nodeId).map(e => e.from);
    const outgoing = edges.filter(e => e.from === nodeId).map(e => e.to);
    for (const from of incoming) {
      for (const to of outgoing) {
        if (!newEdges.some(e => e.from === from && e.to === to)) {
          newEdges.push({ from, to });
        }
      }
    }
    await saveDefinition(newNodes, newEdges);
  };

  const handleConnect = async (fromId: string, toId: string, condition?: string) => {
    if (!selectedWorkflow) return;
    // Don't add duplicate edges
    if (edges.some(e => e.from === fromId && e.to === toId)) return;
    const newEdge: WorkflowEdge = { from: fromId, to: toId };
    if (condition) newEdge.condition = condition;
    await saveDefinition(nodes, [...edges, newEdge]);
    setConnectingFrom(null);
  };

  const handleRemoveEdge = async (from: string, to: string) => {
    await saveDefinition(nodes, edges.filter(e => !(e.from === from && e.to === to)));
  };

  return (
    <div className="fwb-container">
      {/* ─── List View ─── */}
      {!selectedWorkflow && (
        <>
          {/* Stats */}
          <div className="fwb-stats-row">
            <div className="fwb-stat-card">
              <div className="fwb-stat-value">{stats.total}</div>
              <div className="fwb-stat-label">Workflows</div>
            </div>
            <div className="fwb-stat-card fwb-stat-card--success">
              <div className="fwb-stat-value">{stats.active}</div>
              <div className="fwb-stat-label">Active</div>
            </div>
            <div className="fwb-stat-card fwb-stat-card--warn">
              <div className="fwb-stat-value">{stats.draft}</div>
              <div className="fwb-stat-label">Draft</div>
            </div>
            <div className="fwb-stat-card fwb-stat-card--info">
              <div className="fwb-stat-value">{stats.totalNodes}</div>
              <div className="fwb-stat-label">Total Nodes</div>
            </div>
          </div>

          <div className="fwb-list-header">
            <span className="fwb-list-count">{workflows.length} workflow{workflows.length !== 1 ? 's' : ''}</span>
            <button className="fo-action-btn" onClick={() => setShowCreateWorkflow(true)}>+ New Workflow</button>
          </div>

          {loading['workflows'] && workflows.length === 0 ? (
            <div className="fwb-empty-state">
              <div className="fwb-empty-icon">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.3">
                  <path d="M12 3v18M3 12h18"/><circle cx="12" cy="12" r="10"/>
                </svg>
              </div>
              <div className="fwb-empty-text">Loading workflows...</div>
            </div>
          ) : workflows.length === 0 ? (
            <div className="fwb-empty-state">
              <div className="fwb-empty-icon">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.3">
                  <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 8v8M8 12h8"/>
                </svg>
              </div>
              <div className="fwb-empty-text">No workflows yet</div>
              <div className="fwb-empty-sub">Create a workflow to build multi-agent DAG pipelines with branching, parallel execution, and human checkpoints.</div>
              <button className="fo-action-btn" onClick={() => setShowCreateWorkflow(true)} style={{ marginTop: '0.75rem' }}>+ Create Your First Workflow</button>
            </div>
          ) : (
            <div className="fwb-workflow-list">
              {workflows.map((wf) => (
                <div key={wf.id} className="fwb-workflow-card fo-panel" onClick={() => setSelectedWorkflow(wf)}>
                  <div className="fwb-workflow-header">
                    <div>
                      <strong className="fwb-workflow-name">{wf.name}</strong>
                      <StatusBadge status={wf.status} />
                    </div>
                    <span className="fwb-workflow-meta">
                      v{wf.version} · {(wf.definition?.nodes || []).length} nodes · Updated {relativeTime(wf.updated_at)}
                    </span>
                  </div>
                  {wf.description && <p className="fwb-workflow-desc">{wf.description}</p>}
                  {(wf.definition?.nodes || []).length > 0 && (
                    <div className="fwb-mini-flow">
                      {(wf.definition.nodes).map((node, i) => {
                        const meta = NODE_TYPES[node.type] || NODE_TYPES.agent;
                        return (
                          <span key={node.id} className="fwb-mini-node" style={{ borderColor: meta.color }}>
                            {i > 0 && <span className="fwb-mini-arrow">→</span>}
                            <span style={{ color: meta.color }}>{meta.icon}</span>
                            {node.label}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ─── Detail / Builder View ─── */}
      {selectedWorkflow && (
        <>
          <div className="fwb-detail-header">
            <button className="fwb-back-btn" onClick={() => setSelectedWorkflow(null)}>← Back</button>
            <div className="fwb-detail-title">
              <h3>{selectedWorkflow.name}</h3>
              <StatusBadge status={selectedWorkflow.status} />
              <span className="fwb-workflow-meta">v{selectedWorkflow.version} · {nodes.length} nodes · {edges.length} edges</span>
            </div>
            <div className="fwb-detail-actions">
              <button
                className="fo-action-btn fo-action-btn--primary"
                onClick={() => handleRun(selectedWorkflow)}
                disabled={running || nodes.length === 0}
              >
                {running ? 'Starting...' : '▶ Run'}
              </button>
              {selectedWorkflow.status === 'draft' && (
                <button className="fo-action-btn" onClick={() => updateWorkflow(selectedWorkflow.id, { status: 'active' })}>
                  Activate
                </button>
              )}
              {selectedWorkflow.status === 'active' && (
                <button className="fo-action-btn" onClick={() => updateWorkflow(selectedWorkflow.id, { status: 'draft' })}>
                  Pause
                </button>
              )}
              <button
                className="fo-action-btn fwb-archive-btn"
                onClick={() => { updateWorkflow(selectedWorkflow.id, { status: 'archived' }); setSelectedWorkflow(null); }}
              >
                Archive
              </button>
            </div>
          </div>

          {selectedWorkflow.description && (
            <p className="fwb-detail-desc">{selectedWorkflow.description}</p>
          )}

          {/* Canvas */}
          <div className="fo-panel">
            <div className="fo-panel-header">
              <span className="fo-panel-title">Pipeline</span>
              <span className="fo-panel-count">{nodes.length} nodes · {edges.length} edges</span>
            </div>

            <div className="fwb-flow">
              {nodes.length === 0 && (
                <div className="fwb-canvas-empty">
                  <p>No nodes yet. Add your first node to start building the workflow.</p>
                </div>
              )}

              {nodes.map((node) => (
                <FlowNode
                  key={node.id}
                  node={node}
                  edges={edges}
                  onEdit={() => setEditingNode({ ...node })}
                  onDelete={() => handleRemoveNode(node.id)}
                  onConnect={() => setConnectingFrom(node.id)}
                />
              ))}

              {/* Node Type Picker */}
              {showNodePicker ? (
                <div className="fwb-node-type-picker">
                  <div className="fwb-picker-header">
                    <span>Add Node</span>
                    <button className="fwb-node-btn" onClick={() => setShowNodePicker(false)} title="Cancel">
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 4l8 8M12 4l-8 8"/></svg>
                    </button>
                  </div>
                  <div className="fwb-type-grid">
                    {NODE_TYPE_KEYS.map(type => {
                      const meta = NODE_TYPES[type];
                      return (
                        <button key={type} className="fwb-node-type-btn" onClick={() => handleAddNode(type)}>
                          <span className="fwb-type-btn-icon" style={{ color: meta.color, background: meta.bg }}>{meta.icon}</span>
                          <span className="fwb-type-btn-label">{meta.label}</span>
                          <span className="fwb-type-btn-desc">{meta.desc}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <button className="fwb-add-node" onClick={() => setShowNodePicker(true)}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14"/></svg>
                  Add Node
                </button>
              )}
            </div>
          </div>

          {/* Edge List */}
          {edges.length > 0 && (
            <div className="fo-panel fwb-edge-panel">
              <div className="fo-panel-header">
                <span className="fo-panel-title">Connections</span>
                <span className="fo-panel-count">{edges.length}</span>
              </div>
              <div className="fwb-edge-list">
                {edges.map((edge, i) => {
                  const fromNode = nodes.find(n => n.id === edge.from);
                  const toNode = nodes.find(n => n.id === edge.to);
                  return (
                    <div key={i} className="fwb-edge-item">
                      <span className="fwb-edge-from">{fromNode?.label || edge.from}</span>
                      <span className="fwb-edge-arrow">→</span>
                      <span className="fwb-edge-to">{toNode?.label || edge.to}</span>
                      {edge.condition && <span className="fwb-edge-cond">when: {edge.condition}</span>}
                      <button className="fwb-node-btn fwb-node-btn--danger fwb-edge-remove" onClick={() => handleRemoveEdge(edge.from, edge.to)} title="Remove edge">
                        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 4l8 8M12 4l-8 8"/></svg>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* ─── Connect Modal ─── */}
      {connectingFrom && (
        <Modal title="Connect To..." onClose={() => setConnectingFrom(null)} size="small">
          <p className="fwb-type-desc">Select a target node to connect from <strong>{nodes.find(n => n.id === connectingFrom)?.label}</strong>:</p>
          <div className="fwb-connect-list">
            {nodes.filter(n => n.id !== connectingFrom && !edges.some(e => e.from === connectingFrom && e.to === n.id)).map(n => {
              const meta = NODE_TYPES[n.type] || NODE_TYPES.agent;
              return (
                <button key={n.id} className="fwb-connect-option" onClick={() => handleConnect(connectingFrom, n.id)}>
                  <span className="fwb-node-badge-sm" style={{ color: meta.color }}>{meta.icon}</span>
                  {n.label}
                  <span className="fwb-connect-type">{meta.label}</span>
                </button>
              );
            })}
            {nodes.filter(n => n.id !== connectingFrom && !edges.some(e => e.from === connectingFrom && e.to === n.id)).length === 0 && (
              <p className="fwb-type-desc">No available nodes to connect to (all already connected).</p>
            )}
          </div>
          {/* Conditional edge (if source is condition type) */}
          {nodes.find(n => n.id === connectingFrom)?.type === 'condition' && (
            <div className="hub-form-group" style={{ marginTop: '0.75rem' }}>
              <label>Edge Condition <span className="optional">(optional)</span></label>
              <input type="text" id="edge-condition-input" placeholder='e.g. result == "approved"' />
              <span className="fwb-context-hint">Leave empty for unconditional edge</span>
            </div>
          )}
        </Modal>
      )}

      {/* ─── Edit / Add Node Modal ─── */}
      {editingNode && (
        <Modal title={addingNodeType ? `Add ${NODE_TYPES[addingNodeType]?.label || 'Node'}` : `Edit ${editingNode.label}`} onClose={() => { setEditingNode(null); setAddingNodeType(null); }}>
          <div className="hub-form-group">
            <label>Label</label>
            <input
              type="text"
              value={editingNode.label}
              onChange={(e) => setEditingNode({ ...editingNode, label: e.target.value })}
            />
          </div>
          <NodeConfigEditor
            node={editingNode}
            onChange={setEditingNode}
            agents={agents}
            allNodes={nodes}
          />
          <div className="hub-modal-actions">
            <button className="hub-btn" onClick={() => { setEditingNode(null); setAddingNodeType(null); }}>Cancel</button>
            <button className="hub-btn hub-btn--primary" onClick={handleSaveNode}>
              {addingNodeType ? 'Add Node' : 'Save'}
            </button>
          </div>
        </Modal>
      )}

      {/* ─── Create Workflow Modal ─── */}
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
