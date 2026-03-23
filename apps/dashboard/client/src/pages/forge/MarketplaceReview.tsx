/**
 * MarketplaceReview — Admin panel for reviewing community skill submissions.
 * Shows pending submissions with AI review, approve/reject buttons.
 */

import { useState, useEffect, useCallback } from 'react';

const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? 'http://localhost:3001' : '';

interface Submission {
  id: string;
  name: string;
  slug: string;
  category: string;
  description: string;
  system_prompt: string;
  tools: string[];
  model: string;
  author_name: string;
  author_email: string;
  instance_url: string;
  status: string;
  ai_review: {
    security: { score: string; findings: string[] };
    quality: { score: string; findings: string[] };
    usefulness: { score: string; notes: string };
    overall_score: number;
    recommendation: string;
    summary: string;
  } | null;
  ai_review_score: number | null;
  reviewer_notes: string | null;
  install_count: number;
  created_at: string;
}

const SCORE_COLORS: Record<string, string> = {
  PASS: '#22c55e', WARN: '#f59e0b', FAIL: '#ef4444',
  HIGH: '#22c55e', MEDIUM: '#f59e0b', LOW: '#6b7280',
  APPROVE: '#22c55e', NEEDS_CHANGES: '#f59e0b', REJECT: '#ef4444',
};

export default function MarketplaceReview() {
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [filter, setFilter] = useState<'all' | 'pending_review' | 'reviewed' | 'approved' | 'rejected'>('all');
  const [triggeringReview, setTriggeringReview] = useState<string | null>(null);

  const fetchSubmissions = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/forge/marketplace/review-queue`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json() as { submissions: Submission[] };
        setSubmissions(data.submissions || []);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchSubmissions(); }, [fetchSubmissions]);

  const handleApprove = async (id: string) => {
    setActionLoading(id);
    try {
      const res = await fetch(`${API_BASE}/api/v1/forge/marketplace/review/${id}/approve`, {
        method: 'POST', credentials: 'include',
      });
      if (res.ok) {
        setMessage({ type: 'success', text: 'Approved and published' });
        fetchSubmissions();
      }
    } catch { setMessage({ type: 'error', text: 'Approve failed' }); }
    setActionLoading(null);
    setTimeout(() => setMessage(null), 3000);
  };

  const handleReject = async (id: string) => {
    const reason = prompt('Rejection reason (optional):');
    setActionLoading(id);
    try {
      const res = await fetch(`${API_BASE}/api/v1/forge/marketplace/review/${id}/reject`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason || 'Does not meet quality standards' }),
      });
      if (res.ok) {
        setMessage({ type: 'success', text: 'Rejected' });
        fetchSubmissions();
      }
    } catch { setMessage({ type: 'error', text: 'Reject failed' }); }
    setActionLoading(null);
    setTimeout(() => setMessage(null), 3000);
  };

  const handleTriggerReview = async (id: string) => {
    setTriggeringReview(id);
    try {
      // Dispatch the Marketplace Reviewer worker with the submission data
      const sub = submissions.find(s => s.id === id);
      if (!sub) return;
      const res = await fetch(`${API_BASE}/api/v1/forge/executions`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: 'agt_marketplace_reviewer',
          input: `Review this community skill submission:\n\nName: ${sub.name}\nCategory: ${sub.category}\nDescription: ${sub.description}\nTools: ${sub.tools.join(', ')}\nModel: ${sub.model}\nAuthor: ${sub.author_name}\n\nSystem Prompt:\n${sub.system_prompt}\n\nProvide your review in the JSON format specified in your instructions. Submission ID: ${sub.id}`,
        }),
      });
      if (res.ok) {
        setMessage({ type: 'success', text: 'AI review dispatched — check Outputs for results' });
        // Mark as ai_reviewing
        await fetch(`${API_BASE}/api/v1/forge/marketplace/review-queue`, { credentials: 'include' });
      }
    } catch { setMessage({ type: 'error', text: 'Failed to trigger review' }); }
    setTriggeringReview(null);
    setTimeout(() => setMessage(null), 3000);
  };

  const filtered = filter === 'all' ? submissions : submissions.filter(s => s.status === filter);
  const pendingCount = submissions.filter(s => s.status === 'pending_review').length;

  if (loading) return <div style={{ padding: '2rem', color: 'var(--text-muted)', textAlign: 'center' }}>Loading submissions...</div>;

  return (
    <div style={{ padding: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text)' }}>
            Marketplace Review Queue
            {pendingCount > 0 && <span style={{ marginLeft: 8, fontSize: '0.7rem', padding: '2px 8px', borderRadius: 10, background: 'rgba(251,146,60,0.1)', color: '#fb923c', border: '1px solid rgba(251,146,60,0.2)' }}>{pendingCount} pending</span>}
          </h3>
          <p style={{ margin: '2px 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>Review community submissions before publishing. AI security review + your approval.</p>
        </div>
        <button onClick={fetchSubmissions} style={{ padding: '6px 14px', fontSize: '0.75rem', fontWeight: 600, borderRadius: 8, cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-muted)' }}>Refresh</button>
      </div>

      {message && <div style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 8, fontSize: '0.8rem', fontWeight: 600, background: message.type === 'success' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)', color: message.type === 'success' ? '#22c55e' : '#ef4444' }}>{message.text}</div>}

      {/* Filter */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        {(['all', 'pending_review', 'reviewed', 'approved', 'rejected'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            padding: '5px 12px', fontSize: '0.75rem', fontWeight: 600, borderRadius: 8, cursor: 'pointer',
            border: filter === f ? '1px solid rgba(124,58,237,0.4)' : '1px solid var(--border)',
            background: filter === f ? 'rgba(124,58,237,0.12)' : 'var(--surface)',
            color: filter === f ? '#a78bfa' : 'var(--text-muted)',
          }}>{f === 'all' ? `All (${submissions.length})` : f.replace(/_/g, ' ')}</button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
          {submissions.length === 0 ? 'No submissions yet' : 'No submissions match this filter'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {filtered.map(sub => {
            const isExpanded = expandedId === sub.id;
            const statusColor = sub.status === 'approved' ? '#22c55e' : sub.status === 'rejected' ? '#ef4444' : sub.status === 'reviewed' ? '#3b82f6' : '#f59e0b';

            return (
              <div key={sub.id} style={{ background: 'var(--surface)', border: `1px solid ${isExpanded ? 'rgba(124,58,237,0.3)' : 'var(--border)'}`, borderRadius: 10, overflow: 'hidden' }}>
                <div style={{ padding: '12px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12 }} onClick={() => setExpandedId(isExpanded ? null : sub.id)}>
                  <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: statusColor }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--text)' }}>{sub.name}</span>
                      <span style={{ fontSize: '0.6rem', padding: '1px 6px', borderRadius: 8, background: `${statusColor}15`, color: statusColor }}>{sub.status.replace(/_/g, ' ')}</span>
                      <span style={{ fontSize: '0.6rem', padding: '1px 6px', borderRadius: 8, background: 'rgba(107,114,128,0.1)', color: '#6b7280' }}>{sub.category}</span>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>
                      by {sub.author_name || 'Anonymous'} &middot; {new Date(sub.created_at).toLocaleDateString()}
                    </div>
                  </div>
                  {sub.ai_review_score !== null && (
                    <span style={{ fontSize: '1rem', fontWeight: 800, color: sub.ai_review_score >= 7 ? '#22c55e' : sub.ai_review_score >= 4 ? '#f59e0b' : '#ef4444' }}>{sub.ai_review_score}/10</span>
                  )}
                </div>

                {isExpanded && (
                  <div style={{ padding: '0 16px 14px', borderTop: '1px solid var(--border)' }}>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '10px 0', lineHeight: 1.5 }}>{sub.description}</div>

                    {/* System prompt */}
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 4 }}>System Prompt</div>
                      <div style={{ padding: '8px 12px', background: 'var(--elevated)', borderRadius: 8, fontSize: '0.75rem', color: 'var(--text)', lineHeight: 1.5, whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto', fontFamily: 'var(--font-mono)' }}>{sub.system_prompt}</div>
                    </div>

                    {/* Tools + Model */}
                    <div style={{ display: 'flex', gap: 16, marginBottom: 10, fontSize: '0.75rem' }}>
                      <div><span style={{ color: 'var(--text-muted)' }}>Tools:</span> <span style={{ color: 'var(--text)' }}>{sub.tools.join(', ') || 'None'}</span></div>
                      <div><span style={{ color: 'var(--text-muted)' }}>Model:</span> <span style={{ color: 'var(--text)' }}>{sub.model}</span></div>
                    </div>

                    {/* AI Review */}
                    {sub.ai_review && (
                      <div style={{ marginBottom: 10, padding: '10px 14px', background: 'var(--elevated)', borderRadius: 8, borderLeft: '3px solid #7c3aed' }}>
                        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#a78bfa', marginBottom: 6 }}>AI Review</div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
                          <div>
                            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Security</div>
                            <div style={{ fontWeight: 700, color: SCORE_COLORS[sub.ai_review.security.score] || '#6b7280' }}>{sub.ai_review.security.score}</div>
                          </div>
                          <div>
                            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Quality</div>
                            <div style={{ fontWeight: 700, color: SCORE_COLORS[sub.ai_review.quality.score] || '#6b7280' }}>{sub.ai_review.quality.score}</div>
                          </div>
                          <div>
                            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Usefulness</div>
                            <div style={{ fontWeight: 700, color: SCORE_COLORS[sub.ai_review.usefulness.score] || '#6b7280' }}>{sub.ai_review.usefulness.score}</div>
                          </div>
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>{sub.ai_review.summary}</div>
                        {sub.ai_review.security.findings.length > 0 && (
                          <div style={{ marginTop: 6, fontSize: '0.7rem', color: '#f87171' }}>
                            Security findings: {sub.ai_review.security.findings.join('; ')}
                          </div>
                        )}
                        <div style={{ marginTop: 6, fontSize: '0.8rem', fontWeight: 700, color: SCORE_COLORS[sub.ai_review.recommendation] || '#6b7280' }}>
                          Recommendation: {sub.ai_review.recommendation}
                        </div>
                      </div>
                    )}

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: 8 }}>
                      {!sub.ai_review && sub.status === 'pending_review' && (
                        <button onClick={() => handleTriggerReview(sub.id)} disabled={triggeringReview === sub.id}
                          style={{ padding: '6px 14px', fontSize: '0.75rem', fontWeight: 600, borderRadius: 8, cursor: 'pointer', border: '1px solid rgba(124,58,237,0.3)', background: 'rgba(124,58,237,0.08)', color: '#a78bfa' }}>
                          {triggeringReview === sub.id ? 'Reviewing...' : 'Run AI Review'}
                        </button>
                      )}
                      {sub.status !== 'approved' && sub.status !== 'rejected' && (
                        <button onClick={() => handleApprove(sub.id)} disabled={actionLoading === sub.id}
                          style={{ padding: '6px 14px', fontSize: '0.75rem', fontWeight: 600, borderRadius: 8, cursor: 'pointer', border: '1px solid rgba(34,197,94,0.3)', background: 'rgba(34,197,94,0.08)', color: '#22c55e' }}>
                          Approve & Publish
                        </button>
                      )}
                      {sub.status !== 'rejected' && (
                        <button onClick={() => handleReject(sub.id)} disabled={actionLoading === sub.id}
                          style={{ padding: '6px 14px', fontSize: '0.75rem', fontWeight: 600, borderRadius: 8, cursor: 'pointer', border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.08)', color: '#ef4444' }}>
                          Reject
                        </button>
                      )}
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
