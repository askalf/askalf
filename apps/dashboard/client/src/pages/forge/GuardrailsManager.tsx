import { useCallback, useState } from 'react';
import { useHubStore } from '../../stores/hub';
import { usePolling } from '../../hooks/usePolling';
import type { Guardrail } from '../../hooks/useHubApi';
import Modal from '../hub/shared/Modal';
import './forge-observe.css';

type GuardrailType = 'content_filter' | 'cost_limit' | 'rate_limit' | 'tool_restriction' | 'output_filter' | 'custom';

const TYPE_INFO: Record<string, { label: string; color: string; desc: string }> = {
  content_filter: { label: 'Content Filter', color: '#3b82f6', desc: 'Block inputs containing specific keywords (prompt injection defense)' },
  cost_limit: { label: 'Cost Limit', color: '#f59e0b', desc: 'Limit per-execution and daily spending' },
  rate_limit: { label: 'Rate Limit', color: '#ef4444', desc: 'Limit execution frequency per minute/hour' },
  tool_restriction: { label: 'Tool Restriction', color: '#8b5cf6', desc: 'Allow or block specific tools' },
  output_filter: { label: 'Output Filter', color: '#7c3aed', desc: 'Block agent output containing PII, sensitive data, or custom patterns' },
  custom: { label: 'Custom', color: '#6b7280', desc: 'User-defined rules via regex patterns or webhook callbacks' },
};

// Default configs for new guardrails
const DEFAULT_CONFIGS: Record<string, Record<string, unknown>> = {
  content_filter: { blockedKeywords: ['ignore previous instructions', 'ignore all instructions', 'disregard your instructions', 'override your system prompt', 'bypass safety', 'jailbreak'], caseSensitive: false },
  cost_limit: { maxCostPerExecution: 5.00, maxCostPerDay: 50.00 },
  rate_limit: { maxExecutionsPerMinute: 10, maxExecutionsPerHour: 100 },
  tool_restriction: { blockedTools: [], allowedTools: [] },
  output_filter: { blockedPatterns: [], blockPII: true, maxOutputLength: 100000, caseSensitive: false },
  custom: { mode: 'regex', patterns: [] },
};

// Readable config display per type
function ConfigDisplay({ type, config }: { type: string; config: Record<string, unknown> }) {
  if (!config || Object.keys(config).length === 0) return <span className="gr-config-empty">No config</span>;

  switch (type) {
    case 'content_filter': {
      const keywords = (config.blockedKeywords as string[]) || [];
      return (
        <div className="gr-config-detail">
          <div className="gr-config-row">
            <span className="gr-config-key">Blocked keywords:</span>
            <span className="gr-config-val">{keywords.length} phrases</span>
          </div>
          <div className="gr-keyword-list">
            {keywords.map((kw, i) => (
              <span key={i} className="gr-keyword-tag">{kw}</span>
            ))}
          </div>
          {Boolean(config.caseSensitive) && <div className="gr-config-row"><span className="gr-config-note">Case sensitive</span></div>}
        </div>
      );
    }
    case 'cost_limit':
      return (
        <div className="gr-config-detail">
          {config.maxCostPerExecution !== undefined && (
            <div className="gr-config-row">
              <span className="gr-config-key">Per execution:</span>
              <span className="gr-config-val gr-config-money">${Number(config.maxCostPerExecution).toFixed(2)}</span>
            </div>
          )}
          {config.maxCostPerDay !== undefined && (
            <div className="gr-config-row">
              <span className="gr-config-key">Per day:</span>
              <span className="gr-config-val gr-config-money">${Number(config.maxCostPerDay).toFixed(2)}</span>
            </div>
          )}
        </div>
      );
    case 'rate_limit':
      return (
        <div className="gr-config-detail">
          {config.maxExecutionsPerMinute !== undefined && (
            <div className="gr-config-row">
              <span className="gr-config-key">Per minute:</span>
              <span className="gr-config-val">{String(config.maxExecutionsPerMinute)} executions</span>
            </div>
          )}
          {config.maxExecutionsPerHour !== undefined && (
            <div className="gr-config-row">
              <span className="gr-config-key">Per hour:</span>
              <span className="gr-config-val">{String(config.maxExecutionsPerHour)} executions</span>
            </div>
          )}
        </div>
      );
    case 'tool_restriction': {
      const blocked = (config.blockedTools as string[]) || [];
      const allowed = (config.allowedTools as string[]) || [];
      return (
        <div className="gr-config-detail">
          {blocked.length > 0 && (
            <div className="gr-config-row">
              <span className="gr-config-key">Blocked:</span>
              <span className="gr-config-val">{blocked.join(', ')}</span>
            </div>
          )}
          {allowed.length > 0 && (
            <div className="gr-config-row">
              <span className="gr-config-key">Allowed only:</span>
              <span className="gr-config-val">{allowed.join(', ')}</span>
            </div>
          )}
          {blocked.length === 0 && allowed.length === 0 && (
            <span className="gr-config-empty">No restrictions configured</span>
          )}
        </div>
      );
    }
    case 'output_filter': {
      const patterns = (config.blockedPatterns as string[]) || [];
      return (
        <div className="gr-config-detail">
          {patterns.length > 0 && (
            <div className="gr-config-row">
              <span className="gr-config-key">Blocked patterns:</span>
              <span className="gr-config-val">{patterns.length} patterns</span>
            </div>
          )}
          {Boolean(config.blockPII) && <div className="gr-config-row"><span className="gr-config-note">PII detection enabled</span></div>}
          {config.maxOutputLength !== undefined && (
            <div className="gr-config-row">
              <span className="gr-config-key">Max output length:</span>
              <span className="gr-config-val">{String(config.maxOutputLength)} chars</span>
            </div>
          )}
        </div>
      );
    }
    case 'custom': {
      const patterns = (config.patterns as Array<{ pattern: string; action: string; message?: string }>) || [];
      return (
        <div className="gr-config-detail">
          <div className="gr-config-row">
            <span className="gr-config-key">Mode:</span>
            <span className="gr-config-val">{String(config.mode ?? 'regex')}</span>
          </div>
          {patterns.length > 0 && (
            <div className="gr-config-row">
              <span className="gr-config-key">Rules:</span>
              <span className="gr-config-val">{patterns.length} patterns</span>
            </div>
          )}
          {!!config.webhookUrl && (
            <div className="gr-config-row">
              <span className="gr-config-key">Webhook:</span>
              <span className="gr-config-val fobs-mono">{String(config.webhookUrl)}</span>
            </div>
          )}
        </div>
      );
    }
    default:
      return (
        <div className="gr-config-detail">
          <pre className="gr-config-json">{JSON.stringify(config, null, 2)}</pre>
        </div>
      );
  }
}

// Config editor per type
function ConfigEditor({ type, config, onChange }: { type: string; config: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void }) {
  switch (type) {
    case 'content_filter': {
      const keywords = (config.blockedKeywords as string[]) || [];
      const [newKw, setNewKw] = useState('');
      return (
        <div className="gr-config-editor">
          <label>Blocked Keywords</label>
          <div className="gr-keyword-list gr-keyword-list--edit">
            {keywords.map((kw, i) => (
              <span key={i} className="gr-keyword-tag">
                {kw}
                <button className="gr-keyword-remove" onClick={() => {
                  const updated = keywords.filter((_, idx) => idx !== i);
                  onChange({ ...config, blockedKeywords: updated });
                }}>&times;</button>
              </span>
            ))}
          </div>
          <div className="gr-keyword-add">
            <input
              type="text"
              className="fobs-input"
              placeholder="Add blocked phrase..."
              value={newKw}
              onChange={(e) => setNewKw(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newKw.trim()) {
                  onChange({ ...config, blockedKeywords: [...keywords, newKw.trim()] });
                  setNewKw('');
                }
              }}
            />
            <button className="fo-action-btn" disabled={!newKw.trim()} onClick={() => {
              if (newKw.trim()) {
                onChange({ ...config, blockedKeywords: [...keywords, newKw.trim()] });
                setNewKw('');
              }
            }}>Add</button>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', marginTop: '0.5rem', fontSize: '0.8rem' }}>
            <input type="checkbox" checked={!!config.caseSensitive} onChange={(e) => onChange({ ...config, caseSensitive: e.target.checked })} />
            Case sensitive matching
          </label>
        </div>
      );
    }
    case 'cost_limit':
      return (
        <div className="gr-config-editor">
          <div className="gr-config-field">
            <label>Max cost per execution ($)</label>
            <input type="number" className="fobs-input" step="0.50" min="0"
              value={config.maxCostPerExecution as number ?? ''}
              onChange={(e) => onChange({ ...config, maxCostPerExecution: parseFloat(e.target.value) || 0 })} />
          </div>
          <div className="gr-config-field">
            <label>Max cost per day ($)</label>
            <input type="number" className="fobs-input" step="1" min="0"
              value={config.maxCostPerDay as number ?? ''}
              onChange={(e) => onChange({ ...config, maxCostPerDay: parseFloat(e.target.value) || 0 })} />
          </div>
        </div>
      );
    case 'rate_limit':
      return (
        <div className="gr-config-editor">
          <div className="gr-config-field">
            <label>Max executions per minute</label>
            <input type="number" className="fobs-input" step="1" min="1"
              value={config.maxExecutionsPerMinute as number ?? ''}
              onChange={(e) => onChange({ ...config, maxExecutionsPerMinute: parseInt(e.target.value) || 1 })} />
          </div>
          <div className="gr-config-field">
            <label>Max executions per hour</label>
            <input type="number" className="fobs-input" step="1" min="1"
              value={config.maxExecutionsPerHour as number ?? ''}
              onChange={(e) => onChange({ ...config, maxExecutionsPerHour: parseInt(e.target.value) || 1 })} />
          </div>
        </div>
      );
    case 'tool_restriction': {
      const blocked = (config.blockedTools as string[]) || [];
      const allowed = (config.allowedTools as string[]) || [];
      const [newBlocked, setNewBlocked] = useState('');
      const [newAllowed, setNewAllowed] = useState('');
      return (
        <div className="gr-config-editor">
          <div className="gr-config-field">
            <label>Blocked Tools</label>
            <div className="gr-keyword-list gr-keyword-list--edit">
              {blocked.map((t, i) => (
                <span key={i} className="gr-keyword-tag gr-keyword-tag--danger">
                  {t}
                  <button className="gr-keyword-remove" onClick={() => {
                    onChange({ ...config, blockedTools: blocked.filter((_, idx) => idx !== i) });
                  }}>&times;</button>
                </span>
              ))}
            </div>
            <div className="gr-keyword-add">
              <input type="text" className="fobs-input" placeholder="Tool name..." value={newBlocked}
                onChange={(e) => setNewBlocked(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && newBlocked.trim()) { onChange({ ...config, blockedTools: [...blocked, newBlocked.trim()] }); setNewBlocked(''); } }} />
              <button className="fo-action-btn" disabled={!newBlocked.trim()} onClick={() => { if (newBlocked.trim()) { onChange({ ...config, blockedTools: [...blocked, newBlocked.trim()] }); setNewBlocked(''); } }}>Block</button>
            </div>
          </div>
          <div className="gr-config-field">
            <label>Allowed Tools (whitelist — if set, only these tools are permitted)</label>
            <div className="gr-keyword-list gr-keyword-list--edit">
              {allowed.map((t, i) => (
                <span key={i} className="gr-keyword-tag gr-keyword-tag--success">
                  {t}
                  <button className="gr-keyword-remove" onClick={() => {
                    onChange({ ...config, allowedTools: allowed.filter((_, idx) => idx !== i) });
                  }}>&times;</button>
                </span>
              ))}
            </div>
            <div className="gr-keyword-add">
              <input type="text" className="fobs-input" placeholder="Tool name..." value={newAllowed}
                onChange={(e) => setNewAllowed(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && newAllowed.trim()) { onChange({ ...config, allowedTools: [...allowed, newAllowed.trim()] }); setNewAllowed(''); } }} />
              <button className="fo-action-btn" disabled={!newAllowed.trim()} onClick={() => { if (newAllowed.trim()) { onChange({ ...config, allowedTools: [...allowed, newAllowed.trim()] }); setNewAllowed(''); } }}>Allow</button>
            </div>
          </div>
        </div>
      );
    }
    case 'output_filter': {
      const patterns = (config.blockedPatterns as string[]) || [];
      const [newPat, setNewPat] = useState('');
      return (
        <div className="gr-config-editor">
          <label>Blocked Patterns</label>
          <div className="gr-keyword-list gr-keyword-list--edit">
            {patterns.map((p, i) => (
              <span key={i} className="gr-keyword-tag">
                {p}
                <button className="gr-keyword-remove" onClick={() => {
                  onChange({ ...config, blockedPatterns: patterns.filter((_, idx) => idx !== i) });
                }}>&times;</button>
              </span>
            ))}
          </div>
          <div className="gr-keyword-add">
            <input type="text" className="fobs-input" placeholder="Add blocked pattern..." value={newPat}
              onChange={(e) => setNewPat(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && newPat.trim()) { onChange({ ...config, blockedPatterns: [...patterns, newPat.trim()] }); setNewPat(''); } }} />
            <button className="fo-action-btn" disabled={!newPat.trim()} onClick={() => { if (newPat.trim()) { onChange({ ...config, blockedPatterns: [...patterns, newPat.trim()] }); setNewPat(''); } }}>Add</button>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', marginTop: '0.5rem', fontSize: '0.8rem' }}>
            <input type="checkbox" checked={!!config.blockPII} onChange={(e) => onChange({ ...config, blockPII: e.target.checked })} />
            Block PII (SSN, credit cards, passport numbers)
          </label>
          <div className="gr-config-field" style={{ marginTop: '0.5rem' }}>
            <label>Max output length (chars)</label>
            <input type="number" className="fobs-input" step="1000" min="0"
              value={config.maxOutputLength as number ?? ''}
              onChange={(e) => onChange({ ...config, maxOutputLength: parseInt(e.target.value) || 0 })} />
          </div>
        </div>
      );
    }
    case 'custom': {
      const rules = (config.patterns as Array<{ pattern: string; action: string; message?: string }>) || [];
      const [newRule, setNewRule] = useState('');
      const [newMsg, setNewMsg] = useState('');
      return (
        <div className="gr-config-editor">
          <div className="gr-config-field">
            <label>Mode</label>
            <select className="fobs-input" value={String(config.mode ?? 'regex')}
              onChange={(e) => onChange({ ...config, mode: e.target.value })}>
              <option value="regex">Regex Patterns</option>
              <option value="webhook">Webhook Callback</option>
            </select>
          </div>
          {(config.mode ?? 'regex') === 'regex' && (
            <>
              <label>Rules</label>
              <div className="gr-keyword-list gr-keyword-list--edit">
                {rules.map((r, i) => (
                  <span key={i} className="gr-keyword-tag gr-keyword-tag--danger">
                    /{r.pattern}/ → {r.action}
                    <button className="gr-keyword-remove" onClick={() => {
                      onChange({ ...config, patterns: rules.filter((_, idx) => idx !== i) });
                    }}>&times;</button>
                  </span>
                ))}
              </div>
              <div className="gr-keyword-add" style={{ flexDirection: 'column', gap: '0.25rem' }}>
                <input type="text" className="fobs-input" placeholder="Regex pattern..." value={newRule} onChange={(e) => setNewRule(e.target.value)} />
                <input type="text" className="fobs-input" placeholder="Block message (optional)" value={newMsg} onChange={(e) => setNewMsg(e.target.value)} />
                <button className="fo-action-btn" disabled={!newRule.trim()} onClick={() => {
                  if (newRule.trim()) {
                    onChange({ ...config, patterns: [...rules, { pattern: newRule.trim(), action: 'block', message: newMsg.trim() || undefined }] });
                    setNewRule(''); setNewMsg('');
                  }
                }}>Add Rule</button>
              </div>
            </>
          )}
          {config.mode === 'webhook' && (
            <>
              <div className="gr-config-field">
                <label>Webhook URL</label>
                <input type="text" className="fobs-input" placeholder="https://your-server.com/guardrail"
                  value={String(config.webhookUrl ?? '')}
                  onChange={(e) => onChange({ ...config, webhookUrl: e.target.value })} />
              </div>
              <div className="gr-config-field">
                <label>Timeout (ms)</label>
                <input type="number" className="fobs-input" step="1000" min="1000" max="30000"
                  value={config.webhookTimeoutMs as number ?? 5000}
                  onChange={(e) => onChange({ ...config, webhookTimeoutMs: parseInt(e.target.value) || 5000 })} />
              </div>
            </>
          )}
        </div>
      );
    }
    default:
      return (
        <div className="gr-config-editor">
          <label>Config (JSON)</label>
          <textarea className="fobs-input" rows={4}
            value={JSON.stringify(config, null, 2)}
            onChange={(e) => { try { onChange(JSON.parse(e.target.value)); } catch { /* ignore parse errors while typing */ } }}
            style={{ fontFamily: "'SF Mono', 'Fira Code', monospace", fontSize: '0.75rem' }} />
        </div>
      );
  }
}

function GuardrailCard({ guardrail }: { guardrail: Guardrail }) {
  const updateGuardrail = useHubStore((s) => s.updateGuardrail);
  const deleteGuardrail = useHubStore((s) => s.deleteGuardrail);
  const [editing, setEditing] = useState(false);
  const [editConfig, setEditConfig] = useState<Record<string, unknown>>(guardrail.config);

  const typeInfo = TYPE_INFO[guardrail.type] || TYPE_INFO.custom;

  const handleToggle = async () => {
    await updateGuardrail(guardrail.id, { is_enabled: !guardrail.is_enabled });
  };

  const handleSaveConfig = async () => {
    const ok = await updateGuardrail(guardrail.id, { config: editConfig });
    if (ok) setEditing(false);
  };

  const handleDelete = async () => {
    if (guardrail.is_global) return;
    if (!confirm(`Delete guardrail "${guardrail.name}"? This cannot be undone.`)) return;
    await deleteGuardrail(guardrail.id);
  };

  return (
    <div className={`fo-panel gr-card ${guardrail.is_enabled ? '' : 'gr-card--disabled'}`}>
      <div className="gr-card-header">
        <div className="gr-card-left">
          <span className="gr-type-badge" style={{ color: typeInfo.color, borderColor: typeInfo.color + '33', background: typeInfo.color + '15' }}>
            {typeInfo.label}
          </span>
          <strong className="gr-card-name">{guardrail.name}</strong>
        </div>
        <div className="gr-card-actions">
          <button
            className={`prov-toggle-btn ${guardrail.is_enabled ? 'prov-toggle--on' : 'prov-toggle--off'}`}
            onClick={handleToggle}
          >
            {guardrail.is_enabled ? 'Active' : 'Disabled'}
          </button>
          {!guardrail.is_global && (
            <button className="fo-action-btn prov-remove-btn" onClick={handleDelete} title="Delete">Del</button>
          )}
        </div>
      </div>

      {guardrail.description && <p className="gr-card-desc">{guardrail.description}</p>}

      <div className="gr-card-meta">
        {guardrail.is_global && <span className="fobs-badge fobs-badge--green">Global</span>}
        <span className="gr-priority">Priority: {guardrail.priority}</span>
        {guardrail.agent_ids?.length > 0 && (
          <span className="gr-agents">{guardrail.agent_ids.length} agent{guardrail.agent_ids.length !== 1 ? 's' : ''}</span>
        )}
      </div>

      {/* Config display / edit */}
      <div className="gr-config-section">
        {editing ? (
          <>
            <ConfigEditor type={guardrail.type} config={editConfig} onChange={setEditConfig} />
            <div className="gr-edit-actions">
              <button className="fo-action-btn prov-save-btn" onClick={handleSaveConfig}>Save</button>
              <button className="fo-action-btn prov-cancel-btn" onClick={() => { setEditing(false); setEditConfig(guardrail.config); }}>Cancel</button>
            </div>
          </>
        ) : (
          <>
            <ConfigDisplay type={guardrail.type} config={guardrail.config} />
            <button className="fo-action-btn gr-edit-btn" onClick={() => { setEditConfig(guardrail.config); setEditing(true); }}>
              Edit Config
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default function GuardrailsManager() {
  const guardrails = useHubStore((s) => s.guardrails);
  const showCreateGuardrail = useHubStore((s) => s.showCreateGuardrail);
  const setShowCreateGuardrail = useHubStore((s) => s.setShowCreateGuardrail);
  const fetchGuardrails = useHubStore((s) => s.fetchGuardrails);
  const createGuardrail = useHubStore((s) => s.createGuardrail);
  const loading = useHubStore((s) => s.loading);

  const [newType, setNewType] = useState<GuardrailType>('content_filter');
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newEnabled, setNewEnabled] = useState(true);
  const [newGlobal, setNewGlobal] = useState(false);
  const [newPriority, setNewPriority] = useState(100);
  const [newConfig, setNewConfig] = useState<Record<string, unknown>>(DEFAULT_CONFIGS.content_filter);
  const [creating, setCreating] = useState(false);

  const poll = useCallback(() => { fetchGuardrails(); }, [fetchGuardrails]);
  usePolling(poll, 30000);

  const handleTypeChange = (type: GuardrailType) => {
    setNewType(type);
    setNewConfig(DEFAULT_CONFIGS[type] || {});
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    const ok = await createGuardrail({
      name: newName,
      type: newType,
      description: newDesc || undefined,
      config: newConfig,
      is_enabled: newEnabled,
      is_global: newGlobal,
      priority: newPriority,
    });
    if (ok) {
      setShowCreateGuardrail(false);
      setNewName('');
      setNewDesc('');
      setNewType('content_filter');
      setNewConfig(DEFAULT_CONFIGS.content_filter);
      setNewEnabled(true);
      setNewGlobal(false);
      setNewPriority(100);
    }
    setCreating(false);
  };

  const enabledCount = guardrails.filter((g) => g.is_enabled).length;
  const globalCount = guardrails.filter((g) => g.is_global).length;

  return (
    <div className="fo-overview">
      {/* Summary bar */}
      <div className="gr-summary-bar">
        <div className="gr-summary-stats">
          <span className="gr-stat"><strong>{guardrails.length}</strong> guardrail{guardrails.length !== 1 ? 's' : ''}</span>
          <span className="gr-stat-sep" />
          <span className="gr-stat"><strong>{enabledCount}</strong> active</span>
          <span className="gr-stat-sep" />
          <span className="gr-stat"><strong>{globalCount}</strong> global</span>
        </div>
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
        <div className="gr-grid">
          {guardrails.map((g) => (
            <GuardrailCard key={g.id} guardrail={g} />
          ))}
        </div>
      )}

      {/* Create Modal */}
      {showCreateGuardrail && (
        <Modal title="New Guardrail" onClose={() => setShowCreateGuardrail(false)}>
          <div className="hub-form-group">
            <label>Name</label>
            <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g., Prompt Injection Defense" />
          </div>
          <div className="hub-form-group">
            <label>Type</label>
            <div className="hub-type-grid">
              {Object.entries(TYPE_INFO).map(([type, info]) => (
                <button
                  key={type}
                  className={`hub-type-chip ${newType === type ? 'active' : ''}`}
                  onClick={() => handleTypeChange(type as GuardrailType)}
                  style={{ '--type-color': info.color } as React.CSSProperties}
                >
                  {info.label}
                </button>
              ))}
            </div>
            <p className="gr-type-desc">{TYPE_INFO[newType]?.desc}</p>
          </div>

          {/* Type-specific config editor */}
          <div className="hub-form-group">
            <label>Configuration</label>
            <ConfigEditor type={newType} config={newConfig} onChange={setNewConfig} />
          </div>

          <div className="hub-form-group">
            <label>Description <span className="optional">(optional)</span></label>
            <textarea value={newDesc} onChange={(e) => setNewDesc(e.target.value)} placeholder="What does this guardrail enforce?" rows={2} />
          </div>
          <div className="hub-form-group">
            <label>Priority <span className="optional">(lower = higher precedence)</span></label>
            <input type="number" value={newPriority} onChange={(e) => setNewPriority(parseInt(e.target.value) || 100)} min={1} max={999} style={{ width: '80px' }} />
          </div>
          <div className="hub-form-group" style={{ display: 'flex', gap: '1rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={newEnabled} onChange={(e) => setNewEnabled(e.target.checked)} />
              Enabled
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={newGlobal} onChange={(e) => setNewGlobal(e.target.checked)} />
              Global (all agents)
            </label>
          </div>
          <div className="hub-modal-actions">
            <button className="hub-btn" onClick={() => setShowCreateGuardrail(false)}>Cancel</button>
            <button className="hub-btn hub-btn--primary" onClick={handleCreate} disabled={creating || !newName.trim()}>
              {creating ? 'Creating...' : 'Create'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
