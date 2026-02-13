import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/auth';
import { useBrainStore } from '../../stores/brain';
import {
  formatNumber,
  formatDate,
  formatSlugName,
  tokensToDollars,
  getCategoryIcon,
} from '../../hooks/useBrainApi';
import { useState } from 'react';

export default function BrainDetailModal() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const {
    selectedShard, detailLoading, setSelectedShard,
    selectedPack, packShards, packDetailLoading, setSelectedPack,
    installedSlugs, installingSlug, installPack,
  } = useBrainStore();

  const [techOpen, setTechOpen] = useState(false);

  // --- Shard Detail Modal ---
  if (selectedShard) {
    return (
      <div className="brain-modal-overlay" onClick={() => setSelectedShard(null)}>
        <div className="brain-modal" onClick={(e) => e.stopPropagation()}>
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
                  a.download = `pattern-${selectedShard.name.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                title="Export as JSON"
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
              {/* Badges */}
              <div className="detail-badges">
                <span className="badge category">{selectedShard.category || 'general'}</span>
                {selectedShard.knowledgeType && (
                  <span className={`badge kt-badge-${selectedShard.knowledgeType}`}>{selectedShard.knowledgeType}</span>
                )}
              </div>

              {/* Description */}
              <div className="detail-section">
                <p className="detail-description">
                  {selectedShard.description || formatSlugName(selectedShard.name)}
                </p>
              </div>

              {/* Stats Grid */}
              <div className="detail-stats">
                <div className="detail-stat">
                  <span className="detail-stat-value">{formatNumber(selectedShard.executionCount)}</span>
                  <span className="detail-stat-label">Times Used</span>
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
                  <span className="detail-stat-value">{tokensToDollars(selectedShard.tokensSaved || 0)}</span>
                  <span className="detail-stat-label">Value Saved</span>
                </div>
              </div>

              {/* Execution Bar */}
              {selectedShard.executionCount > 0 && (
                <div className="detail-section">
                  <h4>Success Rate</h4>
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

              {/* Technical Details (collapsed) */}
              <div className="detail-section">
                <button className="brain-collapsible" onClick={() => setTechOpen(!techOpen)}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: techOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                  Technical Details
                </button>
                {techOpen && (
                  <div className="brain-tech-details">
                    {/* Patterns */}
                    <div className="detail-subsection">
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
                    <div className="detail-subsection">
                      <h4>Logic</h4>
                      <pre className="logic-block">{selectedShard.logic}</pre>
                    </div>

                    {/* Metadata */}
                    <div className="detail-grid">
                      <div className="detail-row">
                        <span className="detail-label">ID</span>
                        <code className="detail-value">{selectedShard.id}</code>
                      </div>
                      <div className="detail-row">
                        <span className="detail-label">Lifecycle</span>
                        <span className="detail-value">{selectedShard.lifecycle}</span>
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
                      {selectedShard.verificationStatus && (
                        <div className="detail-row">
                          <span className="detail-label">Verification</span>
                          <span className={`detail-value verification-${selectedShard.verificationStatus}`}>{selectedShard.verificationStatus}</span>
                        </div>
                      )}
                    </div>

                    {/* Intent Template */}
                    {(selectedShard.intentTemplate || selectedShard.patternHash) && (
                      <div className="detail-subsection">
                        <h4>Intent Template</h4>
                        <pre className="logic-block">{selectedShard.intentTemplate || selectedShard.patternHash}</pre>
                      </div>
                    )}

                    {/* Recent Executions */}
                    {selectedShard.recentExecutions && selectedShard.recentExecutions.length > 0 && (
                      <div className="detail-subsection">
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
      </div>
    );
  }

  // --- Pack Detail Modal ---
  if (selectedPack) {
    return (
      <div className="brain-modal-overlay" onClick={() => setSelectedPack(null)}>
        <div className="brain-modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <div className="modal-title-row">
              <span className="modal-icon">{getCategoryIcon(selectedPack.category)}</span>
              <h2>{selectedPack.name}</h2>
            </div>
            <button className="modal-close" onClick={() => setSelectedPack(null)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          {packDetailLoading ? (
            <div className="modal-loading">
              <div className="loading-spinner" />
            </div>
          ) : (
            <div className="modal-body">
              <p className="modal-description">{selectedPack.description}</p>

              <div className="modal-meta">
                <span>{selectedPack.shardCount} patterns</span>
                <span>{tokensToDollars(selectedPack.totalEstimatedTokens)} est. value</span>
                <span>v{selectedPack.version}</span>
                <span>by {selectedPack.author}</span>
              </div>

              <h4>Included Patterns</h4>
              <div className="modal-shard-list">
                {packShards.map((shard) => (
                  <div key={shard.id} className="modal-shard">
                    <span className="shard-name">{shard.name}</span>
                    {shard.description && (
                      <span className="shard-desc">{shard.description}</span>
                    )}
                  </div>
                ))}
              </div>

              <div className="modal-actions">
                {installedSlugs.has(selectedPack.slug) ? (
                  <span className="modal-installed">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                    Already installed
                  </span>
                ) : (
                  <button
                    className="modal-install-btn"
                    onClick={() => {
                      if (!user) {
                        navigate('/login');
                        return;
                      }
                      installPack(selectedPack.slug);
                      setSelectedPack(null);
                    }}
                    disabled={installingSlug === selectedPack.slug}
                  >
                    {installingSlug === selectedPack.slug ? 'Installing...' : 'Install this pack'}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return null;
}
