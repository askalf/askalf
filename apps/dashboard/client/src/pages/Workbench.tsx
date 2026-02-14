import { useEffect, useState } from 'react';
import { useAuthStore } from '../stores/auth';
import './Workbench.css';

// ============================================
// TYPES
// ============================================

interface PrivateShard {
  id: string;
  name: string;
  description?: string;
  logic: string;
  patterns: string[];
  category: string;
  confidence: number;
  executionCount: number;
  successRate: number;
  submissionStatus: string;
  createdAt: string;
  updatedAt: string;
}

interface Submission {
  id: string;
  shardId: string;
  shardName: string;
  shardDescription?: string;
  shardCategory?: string;
  status: string;
  submittedAt: string;
  reviewedAt?: string;
  reviewerNotes?: string;
}

const API_BASE = window.location.hostname.includes('askalf.org')
  ? 'https://api.askalf.org'
  : 'http://localhost:3005';

const CATEGORIES = [
  { value: 'general', label: 'General' },
  { value: 'math', label: 'Math & Calculations' },
  { value: 'code', label: 'Code & Programming' },
  { value: 'writing', label: 'Writing & Text' },
  { value: 'data', label: 'Data & Analysis' },
];

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  draft: { label: 'Draft', color: 'var(--text-tertiary)' },
  pending: { label: 'Pending Review', color: 'var(--warning)' },
  approved: { label: 'Published', color: 'var(--crystal)' },
  rejected: { label: 'Rejected', color: 'var(--danger)' },
  changes_requested: { label: 'Changes Requested', color: 'var(--warning)' },
};

export default function Workbench() {
  const { user } = useAuthStore();
  const [activeTab, setActiveTab] = useState<'shards' | 'submissions' | 'create'>('shards');
  const [shards, setShards] = useState<PrivateShard[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedShard, setSelectedShard] = useState<PrivateShard | null>(null);

  // Create form state
  const [newShard, setNewShard] = useState({
    name: '',
    description: '',
    category: 'general',
    logic: '',
    patterns: [''],
  });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  // Submit form state
  const [submitDescription, setSubmitDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  // Test sandbox state
  const [testInput, setTestInput] = useState('');
  const [testOutput, setTestOutput] = useState('');
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (activeTab === 'shards') {
      fetchShards();
    } else if (activeTab === 'submissions') {
      fetchSubmissions();
    }
  }, [activeTab]);

  const fetchShards = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/shards?visibility=private&limit=100`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setShards(data.shards || []);
      }
    } catch (err) {
      console.error('Failed to fetch shards:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchSubmissions = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/submissions`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setSubmissions(data.submissions || []);
      }
    } catch (err) {
      console.error('Failed to fetch submissions:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateShard = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setCreateError('');

    try {
      const res = await fetch(`${API_BASE}/api/v1/shards`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: newShard.name,
          description: newShard.description,
          category: newShard.category,
          logic: newShard.logic,
          patterns: newShard.patterns.filter(p => p.trim()),
          visibility: 'private',
        }),
      });

      if (res.ok) {
        setNewShard({ name: '', description: '', category: 'general', logic: '', patterns: [''] });
        setActiveTab('shards');
        fetchShards();
      } else {
        const data = await res.json();
        setCreateError(data.error || 'Failed to create shard');
      }
    } catch (err) {
      setCreateError('Network error');
    } finally {
      setCreating(false);
    }
  };

  const handleSubmitForReview = async () => {
    if (!selectedShard) return;
    setSubmitting(true);
    setSubmitError('');

    try {
      const res = await fetch(`${API_BASE}/api/v1/shards/${selectedShard.id}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          description: submitDescription,
          authorName: user?.displayName || user?.email?.split('@')[0],
        }),
      });

      if (res.ok) {
        setSelectedShard(null);
        setSubmitDescription('');
        fetchShards();
      } else {
        const data = await res.json();
        setSubmitError(data.error || 'Failed to submit');
      }
    } catch (err) {
      setSubmitError('Network error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleWithdraw = async (shardId: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/shards/${shardId}/withdraw`, {
        method: 'POST',
        credentials: 'include',
      });

      if (res.ok) {
        fetchShards();
        fetchSubmissions();
      }
    } catch (err) {
      console.error('Failed to withdraw:', err);
    }
  };

  const handleTestShard = async () => {
    if (!selectedShard || !testInput.trim()) return;
    setTesting(true);
    setTestOutput('');

    try {
      const res = await fetch(`${API_BASE}/api/v1/shards/${selectedShard.id}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ input: testInput }),
      });

      const data = await res.json();
      if (res.ok) {
        setTestOutput(data.output || 'No output');
      } else {
        setTestOutput(`Error: ${data.error || 'Execution failed'}`);
      }
    } catch (err) {
      setTestOutput('Network error');
    } finally {
      setTesting(false);
    }
  };

  const addPatternField = () => {
    setNewShard(prev => ({ ...prev, patterns: [...prev.patterns, ''] }));
  };

  const updatePattern = (index: number, value: string) => {
    setNewShard(prev => ({
      ...prev,
      patterns: prev.patterns.map((p, i) => (i === index ? value : p)),
    }));
  };

  const removePattern = (index: number) => {
    if (newShard.patterns.length > 1) {
      setNewShard(prev => ({
        ...prev,
        patterns: prev.patterns.filter((_, i) => i !== index),
      }));
    }
  };

  return (
    <div className="workbench">
      <div className="workbench-header">
        <h1>Shard Builder</h1>
        <p className="workbench-subtitle">
          Create, test, and submit your own shards for the public library
        </p>
      </div>

      <div className="workbench-tabs">
        <button
          className={`workbench-tab ${activeTab === 'shards' ? 'active' : ''}`}
          onClick={() => setActiveTab('shards')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
          My Shards ({shards.length})
        </button>
        <button
          className={`workbench-tab ${activeTab === 'submissions' ? 'active' : ''}`}
          onClick={() => setActiveTab('submissions')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
          </svg>
          Submissions ({submissions.length})
        </button>
        <button
          className={`workbench-tab ${activeTab === 'create' ? 'active' : ''}`}
          onClick={() => setActiveTab('create')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="16" />
            <line x1="8" y1="12" x2="16" y2="12" />
          </svg>
          Create New
        </button>
      </div>

      <div className="workbench-content">
        {/* My Shards Tab */}
        {activeTab === 'shards' && (
          <div className="shards-grid">
            {loading ? (
              <div className="loading-state">Loading your shards...</div>
            ) : shards.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">📦</div>
                <h3>No shards yet</h3>
                <p>Create your first shard to get started</p>
                <button className="btn-primary" onClick={() => setActiveTab('create')}>
                  Create Shard
                </button>
              </div>
            ) : (
              shards.map(shard => (
                <div
                  key={shard.id}
                  className={`shard-card ${selectedShard?.id === shard.id ? 'selected' : ''}`}
                  onClick={() => setSelectedShard(shard)}
                >
                  <div className="shard-card-header">
                    <h3>{shard.name}</h3>
                    <span
                      className="shard-status"
                      style={{ color: STATUS_LABELS[shard.submissionStatus]?.color }}
                    >
                      {STATUS_LABELS[shard.submissionStatus]?.label || shard.submissionStatus}
                    </span>
                  </div>
                  <p className="shard-description">{shard.description || 'No description'}</p>
                  <div className="shard-meta">
                    <span className="shard-category">{shard.category}</span>
                    <span className="shard-stats">
                      {shard.executionCount} runs · {Math.round(shard.successRate * 100)}% success
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Submissions Tab */}
        {activeTab === 'submissions' && (
          <div className="submissions-list">
            {loading ? (
              <div className="loading-state">Loading submissions...</div>
            ) : submissions.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">📝</div>
                <h3>No submissions yet</h3>
                <p>Submit a shard for review to see it here</p>
              </div>
            ) : (
              submissions.map(sub => (
                <div key={sub.id} className="submission-item">
                  <div className="submission-header">
                    <h3>{sub.shardName}</h3>
                    <span
                      className="submission-status"
                      style={{ color: STATUS_LABELS[sub.status]?.color }}
                    >
                      {STATUS_LABELS[sub.status]?.label || sub.status}
                    </span>
                  </div>
                  <p className="submission-desc">{sub.shardDescription || 'No description'}</p>
                  <div className="submission-meta">
                    <span>Submitted {new Date(sub.submittedAt).toLocaleDateString()}</span>
                    {sub.reviewedAt && (
                      <span>Reviewed {new Date(sub.reviewedAt).toLocaleDateString()}</span>
                    )}
                  </div>
                  {sub.reviewerNotes && (
                    <div className="reviewer-notes">
                      <strong>Reviewer Notes:</strong> {sub.reviewerNotes}
                    </div>
                  )}
                  {sub.status === 'pending' && (
                    <button
                      className="btn-ghost btn-sm"
                      onClick={() => handleWithdraw(sub.shardId)}
                    >
                      Withdraw
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* Create Tab */}
        {activeTab === 'create' && (
          <form className="create-form" onSubmit={handleCreateShard}>
            <div className="form-group">
              <label>Shard Name</label>
              <input
                type="text"
                value={newShard.name}
                onChange={e => setNewShard(prev => ({ ...prev, name: e.target.value }))}
                placeholder="e.g., Calculate Compound Interest"
                required
              />
            </div>

            <div className="form-group">
              <label>Description</label>
              <textarea
                value={newShard.description}
                onChange={e => setNewShard(prev => ({ ...prev, description: e.target.value }))}
                placeholder="What does this shard do?"
                rows={2}
              />
            </div>

            <div className="form-group">
              <label>Category</label>
              <select
                value={newShard.category}
                onChange={e => setNewShard(prev => ({ ...prev, category: e.target.value }))}
              >
                {CATEGORIES.map(cat => (
                  <option key={cat.value} value={cat.value}>{cat.label}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>Pattern Templates</label>
              <p className="form-hint">
                Use {'{variable}'} for dynamic parts. e.g., "Calculate {'{percentage}'}% of {'{amount}'}"
              </p>
              {newShard.patterns.map((pattern, index) => (
                <div key={index} className="pattern-row">
                  <input
                    type="text"
                    value={pattern}
                    onChange={e => updatePattern(index, e.target.value)}
                    placeholder="Enter a pattern template"
                  />
                  {newShard.patterns.length > 1 && (
                    <button type="button" className="btn-icon" onClick={() => removePattern(index)}>
                      ×
                    </button>
                  )}
                </div>
              ))}
              <button type="button" className="btn-ghost btn-sm" onClick={addPatternField}>
                + Add Pattern
              </button>
            </div>

            <div className="form-group">
              <label>Logic (Response Template)</label>
              <p className="form-hint">
                Use {'${variable}'} to insert extracted values. JavaScript template syntax supported.
              </p>
              <textarea
                value={newShard.logic}
                onChange={e => setNewShard(prev => ({ ...prev, logic: e.target.value }))}
                placeholder="The result is ${percentage}% of ${amount} = ${(amount * percentage / 100).toFixed(2)}"
                rows={4}
                required
              />
            </div>

            {createError && <div className="error-message">{createError}</div>}

            <div className="form-actions">
              <button type="submit" className="btn-primary" disabled={creating}>
                {creating ? 'Creating...' : 'Create Shard'}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Shard Detail Sidebar */}
      {selectedShard && activeTab === 'shards' && (
        <div className="shard-detail-sidebar">
          <div className="sidebar-header">
            <h2>{selectedShard.name}</h2>
            <button className="btn-close" onClick={() => setSelectedShard(null)}>×</button>
          </div>

          <div className="sidebar-content">
            <div className="detail-section">
              <h4>Description</h4>
              <p>{selectedShard.description || 'No description'}</p>
            </div>

            <div className="detail-section">
              <h4>Status</h4>
              <span style={{ color: STATUS_LABELS[selectedShard.submissionStatus]?.color }}>
                {STATUS_LABELS[selectedShard.submissionStatus]?.label}
              </span>
            </div>

            <div className="detail-section">
              <h4>Stats</h4>
              <div className="stats-grid">
                <div className="stat">
                  <span className="stat-value">{selectedShard.executionCount}</span>
                  <span className="stat-label">Executions</span>
                </div>
                <div className="stat">
                  <span className="stat-value">{Math.round(selectedShard.successRate * 100)}%</span>
                  <span className="stat-label">Success Rate</span>
                </div>
                <div className="stat">
                  <span className="stat-value">{Math.round(selectedShard.confidence * 100)}%</span>
                  <span className="stat-label">Confidence</span>
                </div>
              </div>
            </div>

            <div className="detail-section">
              <h4>Test Sandbox</h4>
              <textarea
                value={testInput}
                onChange={e => setTestInput(e.target.value)}
                placeholder="Enter test input..."
                rows={2}
              />
              <button
                className="btn-primary btn-sm"
                onClick={handleTestShard}
                disabled={testing || !testInput.trim()}
              >
                {testing ? 'Testing...' : 'Test Shard'}
              </button>
              {testOutput && (
                <div className="test-output">
                  <strong>Output:</strong>
                  <pre>{testOutput}</pre>
                </div>
              )}
            </div>

            {selectedShard.submissionStatus === 'draft' && (
              <div className="detail-section submit-section">
                <h4>Submit for Review</h4>
                <textarea
                  value={submitDescription}
                  onChange={e => setSubmitDescription(e.target.value)}
                  placeholder="Add a description for the review team..."
                  rows={3}
                />
                {submitError && <div className="error-message">{submitError}</div>}
                <button
                  className="btn-crystal"
                  onClick={handleSubmitForReview}
                  disabled={submitting}
                >
                  {submitting ? 'Submitting...' : 'Submit for Review'}
                </button>
              </div>
            )}

            {selectedShard.submissionStatus === 'pending' && (
              <div className="detail-section">
                <button
                  className="btn-ghost"
                  onClick={() => handleWithdraw(selectedShard.id)}
                >
                  Withdraw Submission
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
