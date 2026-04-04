/**
 * OutputsPanel — View worker execution outputs, reports, drafts, and files.
 * Shows latest results from each worker with search, filter, and expand.
 */

import { useState, useEffect, useCallback, useRef } from 'react';

const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? 'http://localhost:3001' : '';

interface ExecutionOutput {
  id: string;
  agent_id: string;
  agent_name: string;
  agent_type: string;
  status: string;
  input: string;
  output: string | null;
  cost: string;
  total_tokens: number;
  duration_ms: number | null;
  started_at: string;
  completed_at: string | null;
}

function timeAgo(iso: string | null): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

const TYPE_COLORS: Record<string, string> = {
  monitor: '#22c55e',
  security: '#f87171',
  worker: '#a78bfa',
  marketing: '#fb923c',
  research: '#3b82f6',
};

export default function OutputsPanel() {
  const [outputs, setOutputs] = useState<ExecutionOutput[]>([]);
  const [branches, setBranches] = useState<Array<{ name: string; lastCommit: string; agent?: string; hasChanges?: boolean }>>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'completed' | 'failed'>('all');
  const [search, setSearch] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [reviewResult, setReviewResult] = useState<Record<string, string>>({});
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [streamOutput, setStreamOutput] = useState<string[]>([]);
  const streamRef = useRef<EventSource | null>(null);
  const streamEndRef = useRef<HTMLDivElement>(null);

  const fetchOutputs = useCallback(async () => {
    try {
      const [execRes, branchRes] = await Promise.all([
        fetch(`${API_BASE}/api/v1/admin/executions?limit=50`, { credentials: 'include' }).catch(() =>
          fetch(`${API_BASE}/api/v1/forge/executions?limit=50&sort=desc`, { credentials: 'include' })
        ),
        fetch(`${API_BASE}/api/v1/forge/git/branches`, { credentials: 'include' }),
      ]);
      if (execRes.ok) {
        const data = await execRes.json() as { executions: ExecutionOutput[] };
        // Admin endpoint doesn't join agent names — fetch agent list to map
        const agentRes = await fetch(`${API_BASE}/api/v1/admin/agents`, { credentials: 'include' }).catch(() => null);
        const agentMap: Record<string, { name: string; type: string }> = {};
        if (agentRes?.ok) {
          const agentData = await agentRes.json() as { agents: Array<{ id: string; name: string; type: string }> };
          for (const a of (agentData.agents || [])) agentMap[a.id] = { name: a.name, type: a.type };
        }
        const enriched = (data.executions || []).map(e => ({
          ...e,
          agent_name: e.agent_name || agentMap[e.agent_id]?.name || 'Unknown',
          agent_type: e.agent_type || agentMap[e.agent_id]?.type || 'worker',
        }));
        setOutputs(enriched);
      }
      if (branchRes.ok) {
        const data = await branchRes.json() as { branches: Array<{ name: string; lastCommit: string; agent?: string; hasChanges?: boolean }> };
        // Filter to only agent branches
        setBranches((data.branches || []).filter(b => b.name !== 'main'));
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  const handleReview = async (branch: string) => {
    setReviewing(branch);
    try {
      // Fetch diff first
      const diffRes = await fetch(`${API_BASE}/api/v1/forge/git/diff/${encodeURIComponent(branch)}`, { credentials: 'include' });
      if (!diffRes.ok) { setReviewResult(prev => ({ ...prev, [branch]: 'Failed to get diff' })); setReviewing(null); return; }
      const diffData = await diffRes.json() as { diff?: string };
      if (!diffData.diff) { setReviewResult(prev => ({ ...prev, [branch]: 'No changes vs main' })); setReviewing(null); return; }

      // Send for AI review
      const res = await fetch(`${API_BASE}/api/v1/forge/git-space/ai-review`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch, diff: diffData.diff }),
      });
      if (res.ok) {
        const data = await res.json() as { id?: string; review?: string; summary?: string };
        if (data.id) {
          // Poll for async result
          setReviewResult(prev => ({ ...prev, [branch]: 'Reviewing...' }));
          for (let i = 0; i < 20; i++) {
            await new Promise(r => setTimeout(r, 3000));
            const poll = await fetch(`${API_BASE}/api/v1/forge/git-space/review-result/${data.id}`, { credentials: 'include' });
            if (poll.ok) {
              const result = await poll.json() as { status?: string; review?: string; summary?: string };
              if (result.review || result.status === 'completed') {
                setReviewResult(prev => ({ ...prev, [branch]: result.summary || result.review || 'Review complete' }));
                break;
              }
            }
          }
        } else {
          setReviewResult(prev => ({ ...prev, [branch]: data.summary || data.review || 'Review complete' }));
        }
      } else {
        const err = await res.json().catch(() => ({})) as { error?: string };
        setReviewResult(prev => ({ ...prev, [branch]: err.error || 'Review failed' }));
      }
    } catch { setReviewResult(prev => ({ ...prev, [branch]: 'Review failed' })); }
    setReviewing(null);
  };

  const handleMerge = async (branch: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/forge/git/merge`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch }),
      });
      if (res.ok) {
        setBranches(prev => prev.filter(b => b.name !== branch));
      }
    } catch { /* ignore */ }
  };

  useEffect(() => { fetchOutputs(); }, [fetchOutputs]);

  const startStream = useCallback((executionId: string) => {
    if (streamRef.current) streamRef.current.close();
    setStreamingId(executionId);
    setStreamOutput([]);

    const es = new EventSource(`${API_BASE}/api/v1/forge/executions/${executionId}/stream`);
    streamRef.current = es;

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as { type: string; status?: string; output?: string; error?: string; message?: string };
        if (data.type === 'status') {
          setStreamOutput(prev => [...prev, `[${data.status}]`]);
        } else if (data.type === 'output' || data.type === 'message') {
          setStreamOutput(prev => [...prev, data.output || data.message || '']);
        } else if (data.type === 'tool_call') {
          setStreamOutput(prev => [...prev, `> Tool: ${data.message || ''}`]);
        } else if (data.type === 'done') {
          setStreamOutput(prev => [...prev, `\n--- ${data.status} ---`, data.output || data.error || '']);
          es.close();
          streamRef.current = null;
          // Refresh outputs to get final result
          setTimeout(fetchOutputs, 2000);
        }
        streamEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      } catch { /* ignore parse errors */ }
    };

    es.onerror = () => {
      setStreamOutput(prev => [...prev, '[stream disconnected]']);
      es.close();
      streamRef.current = null;
    };
  }, [fetchOutputs]);

  const stopStream = useCallback(() => {
    if (streamRef.current) streamRef.current.close();
    streamRef.current = null;
    setStreamingId(null);
    setStreamOutput([]);
  }, []);

  // Cleanup on unmount
  useEffect(() => () => { if (streamRef.current) streamRef.current.close(); }, []);

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const filtered = outputs.filter(o => {
    if (filter === 'completed' && o.status !== 'completed') return false;
    if (filter === 'failed' && o.status !== 'failed') return false;
    if (search) {
      const q = search.toLowerCase();
      return (o.agent_name || '').toLowerCase().includes(q) ||
        (o.output || '').toLowerCase().includes(q) ||
        (o.input || '').toLowerCase().includes(q);
    }
    return true;
  });

  if (loading) {
    return <div style={{ padding: '2rem', color: 'var(--text-muted)', textAlign: 'center' }}>Loading outputs...</div>;
  }

  return (
    <div style={{ padding: '1.5rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text)' }}>Worker Outputs</h3>
          <p style={{ margin: '2px 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Reports, drafts, scan results, and execution outputs from your workers
          </p>
        </div>
        <button onClick={fetchOutputs} style={{ padding: '6px 14px', fontSize: '0.75rem', fontWeight: 600, borderRadius: 8, cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}>
          Refresh
        </button>
      </div>

      {/* Search + Filter */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search outputs..."
          style={{ flex: 1, padding: '8px 12px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', fontSize: '0.85rem' }}
        />
        {(['all', 'completed', 'failed'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            style={{
              padding: '6px 14px', fontSize: '0.75rem', fontWeight: 600, borderRadius: 8, cursor: 'pointer',
              border: filter === f ? '1px solid rgba(124,58,237,0.4)' : '1px solid var(--border)',
              background: filter === f ? 'rgba(124,58,237,0.12)' : 'var(--surface)',
              color: filter === f ? '#a78bfa' : 'var(--text-muted)',
            }}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* Branch review queue */}
      {branches.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
            Pending Branches
            <span style={{ fontSize: '0.65rem', padding: '2px 8px', borderRadius: 10, background: 'rgba(251,146,60,0.1)', color: '#fb923c', border: '1px solid rgba(251,146,60,0.2)' }}>{branches.length}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {branches.slice(0, 10).map(b => {
              const parts = b.name.split('/');
              const agentName = parts[1] || 'unknown';
              void parts[2]; // execution ID available in branch name
              return (
                <div key={b.name} style={{ padding: '10px 14px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, borderLeft: '3px solid #fb923c' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text)' }}>{agentName.replace(/-/g, ' ')}</div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{b.name} &middot; {b.lastCommit}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        onClick={() => handleReview(b.name)}
                        disabled={reviewing === b.name}
                        style={{ padding: '5px 12px', fontSize: '0.7rem', fontWeight: 600, borderRadius: 6, cursor: 'pointer', border: '1px solid rgba(124,58,237,0.3)', background: 'rgba(124,58,237,0.08)', color: '#a78bfa' }}
                      >
                        {reviewing === b.name ? 'Reviewing...' : 'AI Review'}
                      </button>
                      <button
                        onClick={() => handleMerge(b.name)}
                        style={{ padding: '5px 12px', fontSize: '0.7rem', fontWeight: 600, borderRadius: 6, cursor: 'pointer', border: '1px solid rgba(34,197,94,0.3)', background: 'rgba(34,197,94,0.08)', color: '#22c55e' }}
                      >
                        Merge
                      </button>
                    </div>
                  </div>
                  {reviewResult[b.name] && (
                    <div style={{ marginTop: 8, padding: '8px 10px', background: 'var(--elevated)', borderRadius: 6, fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: 1.5, whiteSpace: 'pre-wrap', maxHeight: 150, overflow: 'auto' }}>
                      {reviewResult[b.name]}
                    </div>
                  )}
                </div>
              );
            })}
            {branches.length > 10 && (
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center', padding: 4 }}>
                +{branches.length - 10} more branches
              </div>
            )}
          </div>
        </div>
      )}

      {/* Live stream viewer */}
      {streamingId && (
        <div style={{ marginBottom: 16, padding: '12px 16px', background: '#0a0a0f', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 10, borderLeft: '3px solid #22c55e' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#22c55e', animation: 'pulse 1.5s infinite' }} />
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#22c55e' }}>Live Stream</span>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{streamingId.slice(0, 12)}...</span>
            </div>
            <button onClick={stopStream}
              style={{ padding: '3px 10px', fontSize: '0.65rem', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 6, color: '#ef4444', cursor: 'pointer' }}>
              Stop
            </button>
          </div>
          <div style={{
            maxHeight: 300, overflow: 'auto', padding: '8px 12px', background: '#04040a', borderRadius: 8,
            fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: '#d4d4d8', lineHeight: 1.6, whiteSpace: 'pre-wrap',
          }}>
            {streamOutput.length === 0 ? (
              <span style={{ color: '#6b7280' }}>Connecting to execution stream...</span>
            ) : (
              streamOutput.map((line, i) => (
                <div key={i} style={{ color: line.startsWith('>') ? '#a78bfa' : line.startsWith('[') ? '#f59e0b' : line.startsWith('---') ? '#22c55e' : '#d4d4d8' }}>
                  {line}
                </div>
              ))
            )}
            <div ref={streamEndRef} />
          </div>
        </div>
      )}

      {/* Outputs list */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem 1rem' }}>
          <div style={{ fontSize: '2rem', marginBottom: 8, opacity: 0.3 }}>{'\u{1F4C4}'}</div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>
            {outputs.length === 0 ? 'No executions yet — run a worker to see outputs here' : 'No outputs match this filter'}
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {filtered.map(o => {
            const isExpanded = expandedId === o.id;
            const statusColor = o.status === 'completed' ? '#22c55e' : o.status === 'failed' ? '#ef4444' : o.status === 'running' ? '#f59e0b' : '#6b7280';
            const typeColor = TYPE_COLORS[o.agent_type] || '#6b7280';
            const hasOutput = o.output && o.output.length > 0;

            return (
              <div key={o.id}
                style={{
                  background: 'var(--surface)', border: `1px solid ${isExpanded ? 'rgba(124,58,237,0.3)' : 'var(--border)'}`,
                  borderRadius: 10, overflow: 'hidden', transition: 'border-color 0.2s',
                }}
              >
                {/* Card header */}
                <div
                  style={{ padding: '12px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12 }}
                  onClick={() => setExpandedId(isExpanded ? null : o.id)}
                >
                  <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: statusColor, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--text)' }}>{o.agent_name || 'Unknown'}</span>
                      <span style={{ fontSize: '0.6rem', padding: '1px 6px', borderRadius: 8, background: `${typeColor}15`, color: typeColor, border: `1px solid ${typeColor}30` }}>{o.agent_type}</span>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {o.input?.slice(0, 100) || 'No input'}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                    {(o.status === 'running' || o.status === 'pending') && (
                      <button
                        onClick={(e) => { e.stopPropagation(); streamingId === o.id ? stopStream() : startStream(o.id); }}
                        style={{
                          padding: '3px 10px', fontSize: '0.65rem', fontWeight: 600, borderRadius: 6, cursor: 'pointer',
                          border: streamingId === o.id ? '1px solid rgba(239,68,68,0.3)' : '1px solid rgba(34,197,94,0.3)',
                          background: streamingId === o.id ? 'rgba(239,68,68,0.08)' : 'rgba(34,197,94,0.08)',
                          color: streamingId === o.id ? '#ef4444' : '#22c55e',
                          animation: streamingId === o.id ? 'none' : 'pulse 2s infinite',
                        }}
                      >
                        {streamingId === o.id ? 'Stop' : '\u{25CF} Live'}
                      </button>
                    )}
                    <div>
                      <div style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                        ${parseFloat(o.cost || '0').toFixed(2)}
                      </div>
                      <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                        {timeAgo(o.completed_at || o.started_at)}
                      </div>
                    </div>
                  </div>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>{'\u25BC'}</span>
                </div>

                {/* Expanded output */}
                {isExpanded && (
                  <div style={{ padding: '0 16px 14px', borderTop: '1px solid var(--border)' }}>
                    {/* Meta row */}
                    <div style={{ display: 'flex', gap: 16, padding: '10px 0 8px', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                      <span>Status: <strong style={{ color: statusColor }}>{o.status}</strong></span>
                      <span>Tokens: <strong style={{ color: 'var(--text)' }}>{o.total_tokens?.toLocaleString() || '—'}</strong></span>
                      {o.duration_ms && <span>Duration: <strong style={{ color: 'var(--text)' }}>{(o.duration_ms / 1000).toFixed(1)}s</strong></span>}
                      <span>Started: {new Date(o.started_at).toLocaleString()}</span>
                    </div>

                    {/* Input */}
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 4 }}>Input</div>
                      <div style={{ padding: '8px 12px', background: 'var(--elevated)', borderRadius: 8, fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5, whiteSpace: 'pre-wrap', maxHeight: 100, overflow: 'auto' }}>
                        {o.input || '—'}
                      </div>
                    </div>

                    {/* Output */}
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <div style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>Output</div>
                        {hasOutput && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleCopy(o.output!, o.id); }}
                            style={{ padding: '2px 8px', fontSize: '0.65rem', background: 'var(--elevated)', border: '1px solid var(--border)', borderRadius: 6, color: copiedId === o.id ? '#22c55e' : 'var(--text-muted)', cursor: 'pointer' }}
                          >
                            {copiedId === o.id ? 'Copied!' : 'Copy'}
                          </button>
                        )}
                      </div>
                      <div style={{
                        padding: '10px 14px', background: 'var(--elevated)', borderRadius: 8,
                        fontSize: '0.8rem', color: 'var(--text)', lineHeight: 1.6,
                        whiteSpace: 'pre-wrap', maxHeight: 400, overflow: 'auto',
                        borderLeft: `3px solid ${hasOutput ? typeColor : 'var(--border)'}`,
                      }}>
                        {o.output || (o.status === 'failed' ? 'Execution failed — check worker logs' : 'No output yet')}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
