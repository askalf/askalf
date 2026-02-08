import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './ShardLibrary.css';

// ============================================
// TYPES
// ============================================

interface Shard {
  id: string;
  name: string;
  description?: string;
  confidence: number;
  executionCount: number;
  successRate: number;
  successCount: number;
  failureCount: number;
  category?: string;
  visibility: 'public' | 'private' | 'organization';
  lifecycle: string;
  shardType: string;
  patterns: string[];
  patternHash?: string;
  logic: string;
  synthesisMethod?: string;
  tokensSaved?: number;
  avgLatencyMs?: number;
  createdAt: string;
  updatedAt: string;
  lastExecuted?: string;
  intentTemplate?: string;
  knowledgeType?: string;
  verificationStatus?: string;
  sourceTraceIds?: string[];
  sourceUrl?: string;
  sourceType?: string;
  recentExecutions?: Array<{
    id: string;
    success: boolean;
    executionMs: number;
    error?: string;
    createdAt: string;
  }>;
}

const API_BASE = window.location.hostname.includes('askalf.org')
  ? 'https://api.askalf.org'
  : 'http://localhost:3000';

// Categories loaded dynamically from API

const SHARDS_PER_PAGE = 50;

export default function ShardLibrary() {
  const navigate = useNavigate();
  const [shards, setShards] = useState<Shard[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalShards, setTotalShards] = useState(0);

  useEffect(() => { document.title = 'Shard Library — Ask ALF'; }, []);

  // Categories (dynamic from API)
  const [categories, setCategories] = useState<Array<{ value: string; count: number }>>([]);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [sortBy, setSortBy] = useState<'popular' | 'recent' | 'success' | 'confidence'>('popular');

  // Pagination
  const [page, setPage] = useState(1);

  // Detail modal
  const [selectedShard, setSelectedShard] = useState<Shard | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Fetch categories on mount
  useEffect(() => {
    fetch(`${API_BASE}/api/v1/shards/categories`, { credentials: 'include' })
      .then(res => res.json())
      .then(data => setCategories(data.categories || []))
      .catch(() => {});
  }, []);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [category, sortBy]);

  // Fetch shards when filters or page change
  useEffect(() => {
    fetchShards();
  }, [category, sortBy, page]);

  const fetchShards = async () => {
    setLoading(true);
    try {
      const offset = (page - 1) * SHARDS_PER_PAGE;
      const params = new URLSearchParams({
        limit: String(SHARDS_PER_PAGE),
        offset: String(offset),
      });
      if (category !== 'all') params.append('category', category);

      const res = await fetch(`${API_BASE}/api/v1/shards?${params}`, {
        credentials: 'include',
      });

      if (res.ok) {
        const data = await res.json();
        let shardList: Shard[] = data.shards || [];

        // Sort client-side (server returns by execution_count DESC, confidence DESC)
        if (sortBy === 'popular') {
          shardList.sort((a, b) => b.executionCount - a.executionCount);
        } else if (sortBy === 'recent') {
          shardList.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        } else if (sortBy === 'success') {
          shardList.sort((a, b) => b.successRate - a.successRate);
        } else if (sortBy === 'confidence') {
          shardList.sort((a, b) => b.confidence - a.confidence);
        }

        setShards(shardList);
        setTotalShards(data.total || 0);
      }
    } catch (err) {
      console.error('Failed to fetch shards:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchShardDetail = async (id: string) => {
    setDetailLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/shards/${id}`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setSelectedShard({ ...data.shard, recentExecutions: data.executions || [] });
      }
    } catch (err) {
      console.error('Failed to fetch shard detail:', err);
    } finally {
      setDetailLoading(false);
    }
  };

  // Client-side search filter (filters current page)
  const filteredShards = shards.filter((shard) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      shard.name.toLowerCase().includes(q) ||
      shard.description?.toLowerCase().includes(q) ||
      shard.category?.toLowerCase().includes(q) ||
      shard.synthesisMethod?.toLowerCase().includes(q) ||
      shard.knowledgeType?.toLowerCase().includes(q) ||
      shard.sourceType?.toLowerCase().includes(q) ||
      shard.patterns?.some(p => p.toLowerCase().includes(q))
    );
  });

  // Pagination
  const totalPages = Math.ceil(totalShards / SHARDS_PER_PAGE);
  const pageNumbers: number[] = [];
  const maxVisible = 7;
  let pageStart = Math.max(1, page - 3);
  let pageEnd = Math.min(totalPages, pageStart + maxVisible - 1);
  if (pageEnd - pageStart < maxVisible - 1) pageStart = Math.max(1, pageEnd - maxVisible + 1);
  for (let i = pageStart; i <= pageEnd; i++) pageNumbers.push(i);

  const formatNumber = (n: number) => {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return n.toString();
  };

  const formatDate = (d: string) => {
    const date = new Date(d);
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };

  // Convert slug names to readable text (e.g. "what-is-rest-api" → "What is REST API")
  const formatSlugName = (name: string) => {
    return name
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  };

  return (
    <div className="library-page">
      {/* Header */}
      <div className="library-header">
        <button className="library-back-btn" onClick={() => navigate('/app/chat')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back to Chat
        </button>
        <h1>Shard Library</h1>
        <p>Browse ALF's crystallized knowledge - patterns that answer instantly without LLM calls</p>
      </div>

      {/* Filters */}
      <div className="library-controls">
        <div className="library-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            type="text"
            placeholder="Search name, description, pattern, type..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button className="search-clear" onClick={() => setSearchQuery('')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        <div className="library-filters">
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="all">All Categories</option>
            {categories.map((cat) => (
              <option key={cat.value} value={cat.value}>
                {cat.value.charAt(0).toUpperCase() + cat.value.slice(1)} ({cat.count})
              </option>
            ))}
          </select>

          <select value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)}>
            <option value="popular">Most Used</option>
            <option value="recent">Most Recent</option>
            <option value="success">Highest Success</option>
            <option value="confidence">Highest Confidence</option>
          </select>
        </div>
      </div>

      {/* Results Count */}
      <div className="library-results-info">
        <span>
          {totalShards} shard{totalShards !== 1 ? 's' : ''}
          {totalShards > SHARDS_PER_PAGE && ` (page ${page} of ${totalPages})`}
        </span>
        {searchQuery && <span className="search-term">filtering "{searchQuery}"</span>}
      </div>

      {/* Shard List */}
      <div className="library-content">
        {loading ? (
          <div className="library-loading">
            <div className="loading-spinner" />
            <p>Loading shards...</p>
          </div>
        ) : filteredShards.length === 0 ? (
          <div className="library-empty">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <h3>No shards found</h3>
            <p>{searchQuery ? 'Try a different search term' : 'No shards match your filters'}</p>
          </div>
        ) : (
          <div className="shard-list">
            {filteredShards.map((shard) => (
                <div
                  key={shard.id}
                  className="shard-row"
                  onClick={() => fetchShardDetail(shard.id)}
                >
                  <div className="shard-main">
                    <div className="shard-title-row">
                      <h3 className="shard-name">{shard.name}</h3>
                    </div>
                    <p className="shard-desc">
                      {shard.description || formatSlugName(shard.name)}
                    </p>
                    <div className="shard-meta">
                      <span className="shard-category">{shard.category || 'general'}</span>
                      {shard.knowledgeType && (
                        <span className={`shard-type-badge type-${shard.knowledgeType}`}>
                          {shard.knowledgeType === 'immutable' && '💎'}
                          {shard.knowledgeType === 'temporal' && '⏳'}
                          {shard.knowledgeType === 'contextual' && '🎯'}
                          {shard.knowledgeType === 'procedural' && '⚙️'}
                          {shard.knowledgeType}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="shard-stats">
                    <div className="shard-stat">
                      <span className="stat-val">{formatNumber(shard.executionCount)}</span>
                      <span className="stat-lbl">runs</span>
                    </div>
                    <div className="shard-stat">
                      <span className="stat-val">{(shard.successRate * 100).toFixed(0)}%</span>
                      <span className="stat-lbl">success</span>
                    </div>
                    <div className="shard-stat">
                      <span className="stat-val">{(shard.confidence * 100).toFixed(0)}%</span>
                      <span className="stat-lbl">confidence</span>
                    </div>
                  </div>
                  <div className="shard-arrow">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M9 18l6-6-6-6" />
                    </svg>
                  </div>
                </div>
            ))}
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalShards > SHARDS_PER_PAGE && (
        <div className="library-pagination">
          <button
            className="pagination-btn"
            disabled={page <= 1}
            onClick={() => setPage(p => p - 1)}
          >
            Prev
          </button>
          {pageNumbers.map(num => (
            <button
              key={num}
              className={`pagination-btn ${num === page ? 'active' : ''}`}
              onClick={() => setPage(num)}
            >
              {num}
            </button>
          ))}
          <button
            className="pagination-btn"
            disabled={page >= totalPages}
            onClick={() => setPage(p => p + 1)}
          >
            Next
          </button>
        </div>
      )}

      {/* Shard Detail Modal */}
      {selectedShard && (
        <div className="library-modal-overlay" onClick={() => setSelectedShard(null)}>
          <div className="library-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{selectedShard.name}</h2>
              <div className="modal-header-actions">
                <button
                  className="modal-export-btn"
                  onClick={() => {
                    const exportData = {
                      formatVersion: '1.0',
                      exportedAt: new Date().toISOString(),
                      shard: {
                        name: selectedShard.name,
                        description: selectedShard.description,
                        patterns: selectedShard.patterns,
                        logic: selectedShard.logic,
                        category: selectedShard.category,
                        knowledgeType: selectedShard.knowledgeType,
                        confidence: selectedShard.confidence,
                        executionCount: selectedShard.executionCount,
                        successRate: selectedShard.successRate,
                      }
                    };
                    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `shard-${selectedShard.name.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.json`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  title="Export shard as JSON"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
                  </svg>
                  Export
                </button>
                <button className="modal-close" onClick={() => setSelectedShard(null)}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {detailLoading ? (
              <div className="modal-loading">
                <div className="loading-spinner" />
              </div>
            ) : (
              <div className="modal-body">
                {/* Status Badges */}
                <div className="detail-badges">
                  <span className={`badge lifecycle ${selectedShard.lifecycle}`}>
                    {selectedShard.lifecycle}
                  </span>
                  <span className="badge category">{selectedShard.category || 'general'}</span>
                </div>

                {/* Description */}
                <div className="detail-section">
                  <p className="detail-description">
                    {selectedShard.description || formatSlugName(selectedShard.name)}
                  </p>
                </div>

                {/* Patterns */}
                <div className="detail-section">
                  <h4>Match Patterns</h4>
                  <div className="pattern-list">
                    {selectedShard.patterns?.length > 0 ? (
                      selectedShard.patterns.map((pattern, i) => (
                        <code key={i} className="pattern-tag">{pattern}</code>
                      ))
                    ) : (
                      <span className="no-patterns">Semantic matching (no explicit patterns)</span>
                    )}
                  </div>
                </div>

                {/* Logic */}
                <div className="detail-section">
                  <h4>Logic</h4>
                  <pre className="logic-block">{selectedShard.logic}</pre>
                </div>

                {/* Metadata */}
                <div className="detail-section">
                  <h4>Details</h4>
                  <div className="detail-grid">
                    <div className="detail-row">
                      <span className="detail-label">ID</span>
                      <code className="detail-value">{selectedShard.id}</code>
                    </div>
                    <div className="detail-row">
                      <span className="detail-label">Synthesis</span>
                      <span className="detail-value">{selectedShard.synthesisMethod || 'manual'}</span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-label">Avg Latency</span>
                      <span className="detail-value">{selectedShard.avgLatencyMs || 0}ms</span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-label">Created</span>
                      <span className="detail-value">{formatDate(selectedShard.createdAt)}</span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-label">Updated</span>
                      <span className="detail-value">{formatDate(selectedShard.updatedAt)}</span>
                    </div>
                    {selectedShard.lastExecuted && (
                      <div className="detail-row">
                        <span className="detail-label">Last Run</span>
                        <span className="detail-value">{formatDate(selectedShard.lastExecuted)}</span>
                      </div>
                    )}
                    {selectedShard.knowledgeType && (
                      <div className="detail-row">
                        <span className="detail-label">Knowledge Type</span>
                        <span className="detail-value">{selectedShard.knowledgeType}</span>
                      </div>
                    )}
                    {selectedShard.verificationStatus && (
                      <div className="detail-row">
                        <span className="detail-label">Verification</span>
                        <span className={`detail-value verification-${selectedShard.verificationStatus}`}>{selectedShard.verificationStatus}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Intent Template */}
                {(selectedShard.intentTemplate || selectedShard.patternHash) && (
                  <div className="detail-section">
                    <h4>Intent Template</h4>
                    <pre className="logic-block">{selectedShard.intentTemplate || selectedShard.patternHash}</pre>
                  </div>
                )}

                {/* Stats Grid */}
                <div className="detail-stats">
                  <div className="detail-stat">
                    <span className="detail-stat-value">{formatNumber(selectedShard.executionCount)}</span>
                    <span className="detail-stat-label">Executions</span>
                  </div>
                  <div className="detail-stat">
                    <span className="detail-stat-value success">{(selectedShard.successRate * 100).toFixed(1)}%</span>
                    <span className="detail-stat-label">Success Rate</span>
                  </div>
                  <div className="detail-stat">
                    <span className="detail-stat-value">{(selectedShard.confidence * 100).toFixed(1)}%</span>
                    <span className="detail-stat-label">Confidence</span>
                  </div>
                  <div className="detail-stat">
                    <span className="detail-stat-value">{formatNumber(selectedShard.tokensSaved || 0)}</span>
                    <span className="detail-stat-label">Tokens Saved</span>
                  </div>
                </div>

                {/* Execution Bar */}
                {selectedShard.executionCount > 0 && (
                  <div className="detail-section">
                    <h4>Execution History</h4>
                    <div className="execution-bar">
                      <div
                        className="execution-success"
                        style={{ width: `${(selectedShard.successCount || 0) / Math.max(selectedShard.executionCount, 1) * 100}%` }}
                      />
                    </div>
                    <div className="execution-labels">
                      <span className="success">{selectedShard.successCount || 0} successful</span>
                      <span className="failure">{selectedShard.failureCount || 0} failed</span>
                    </div>
                  </div>
                )}

                {/* Recent Executions */}
                {selectedShard.recentExecutions && selectedShard.recentExecutions.length > 0 && (
                  <div className="detail-section">
                    <h4>Recent Executions</h4>
                    <div className="executions-list">
                      {selectedShard.recentExecutions.slice(0, 10).map((exec) => (
                        <div key={exec.id} className={`execution-item ${exec.success ? 'success' : 'failed'}`}>
                          <span className="exec-status">{exec.success ? '\u2713' : '\u2717'}</span>
                          <span className="exec-ms">{exec.executionMs}ms</span>
                          {exec.error && <span className="exec-error">{exec.error}</span>}
                          <span className="exec-date">{formatDate(exec.createdAt)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
