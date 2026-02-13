import { useMemoryStore } from '../../stores/memory';
import { formatDate, formatDateShort, lifecycleBadgeClass } from '../../hooks/useMemoryApi';

function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="modal-close" onClick={onClick}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
    </button>
  );
}

function ShardModal() {
  const { selectedShard, setSelectedShard } = useMemoryStore();
  if (!selectedShard) return null;

  return (
    <div className="modal-overlay" onClick={() => setSelectedShard(null)}>
      <div className="modal-content large" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{'\u26A1'} {selectedShard.name}</h2>
          <CloseButton onClick={() => setSelectedShard(null)} />
        </div>
        <div className="modal-body">
          {selectedShard.description && (
            <div className="detail-description">{selectedShard.description}</div>
          )}
          <div className="detail-grid">
            <div className="detail-item">
              <span className="detail-label">ID</span>
              <span className="detail-value mono">{selectedShard.id}</span>
            </div>
            <div className="detail-item">
              <span className="detail-label">Lifecycle</span>
              <span className={`badge ${lifecycleBadgeClass(selectedShard.lifecycle)}`}>{selectedShard.lifecycle}</span>
            </div>
            <div className="detail-item">
              <span className="detail-label">Confidence</span>
              <span className="detail-value">{(selectedShard.confidence * 100).toFixed(1)}%</span>
            </div>
            <div className="detail-item">
              <span className="detail-label">Category</span>
              <span className="badge badge-blue">{selectedShard.category || 'general'}</span>
            </div>
            <div className="detail-item">
              <span className="detail-label">Synthesis</span>
              <span className="detail-value">{selectedShard.synthesisMethod || 'manual'}</span>
            </div>
            <div className="detail-item">
              <span className="detail-label">Avg Latency</span>
              <span className="detail-value">{selectedShard.avgLatencyMs || 0}ms</span>
            </div>
            <div className="detail-item">
              <span className="detail-label">Created</span>
              <span className="detail-value">{formatDate(selectedShard.createdAt)}</span>
            </div>
            <div className="detail-item">
              <span className="detail-label">Updated</span>
              <span className="detail-value">{formatDate(selectedShard.updatedAt || '')}</span>
            </div>
            {selectedShard.lastExecuted && (
              <div className="detail-item">
                <span className="detail-label">Last Run</span>
                <span className="detail-value">{formatDate(selectedShard.lastExecuted)}</span>
              </div>
            )}
            {selectedShard.knowledgeType && (
              <div className="detail-item">
                <span className="detail-label">Knowledge Type</span>
                <span className="badge badge-blue">{selectedShard.knowledgeType}</span>
              </div>
            )}
            {selectedShard.verificationStatus && (
              <div className="detail-item">
                <span className="detail-label">Verification</span>
                <span className={`badge ${selectedShard.verificationStatus === 'verified' ? 'badge-success' : selectedShard.verificationStatus === 'failed' ? 'badge-warning' : 'badge-purple'}`}>{selectedShard.verificationStatus}</span>
              </div>
            )}
          </div>

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

          <div className="detail-section">
            <h4>Intent Template</h4>
            <pre className="code-block">{selectedShard.intentTemplate || selectedShard.patternHash || 'No template'}</pre>
          </div>

          <div className="detail-section">
            <h4>Logic</h4>
            <pre className="code-block">{selectedShard.logic}</pre>
          </div>

          <div className="detail-section">
            <h4>Execution Stats</h4>
            <div className="stats-grid">
              <div className="mini-stat"><span className="mini-stat-value">{selectedShard.executionCount}</span><span className="mini-stat-label">Total</span></div>
              <div className="mini-stat success"><span className="mini-stat-value">{selectedShard.successCount || 0}</span><span className="mini-stat-label">Success</span></div>
              <div className="mini-stat failed"><span className="mini-stat-value">{selectedShard.failureCount || 0}</span><span className="mini-stat-label">Failed</span></div>
              <div className="mini-stat"><span className="mini-stat-value">{(selectedShard.successRate * 100).toFixed(1)}%</span><span className="mini-stat-label">Success Rate</span></div>
              <div className="mini-stat"><span className="mini-stat-value">{selectedShard.tokensSaved || 0}</span><span className="mini-stat-label">Tokens Saved</span></div>
            </div>
            {selectedShard.executionCount > 0 && (
              <div className="execution-bar-wrapper">
                <div className="execution-bar">
                  <div className="execution-success" style={{ width: `${(selectedShard.successCount || 0) / Math.max(selectedShard.executionCount, 1) * 100}%` }} />
                </div>
                <div className="execution-labels">
                  <span className="success">{selectedShard.successCount || 0} successful</span>
                  <span className="failure">{selectedShard.failureCount || 0} failed</span>
                </div>
              </div>
            )}
          </div>

          {selectedShard.recentExecutions && selectedShard.recentExecutions.length > 0 && (
            <div className="detail-section">
              <h4>Recent Executions</h4>
              <div className="executions-list">
                {selectedShard.recentExecutions.slice(0, 10).map((exec) => (
                  <div key={exec.id} className={`execution-item ${exec.success ? 'success' : 'failed'}`}>
                    <span className="exec-status">{exec.success ? '\u2713' : '\u2717'}</span>
                    <span className="exec-ms">{exec.executionMs}ms</span>
                    {exec.error && <span className="exec-error">{exec.error}</span>}
                    <span className="exec-date">{formatDateShort(exec.createdAt)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TraceModal() {
  const { selectedTrace, setSelectedTrace } = useMemoryStore();
  if (!selectedTrace) return null;

  return (
    <div className="modal-overlay" onClick={() => setSelectedTrace(null)}>
      <div className="modal-content large" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{'\uD83D\uDCCA'} Trace Detail</h2>
          <CloseButton onClick={() => setSelectedTrace(null)} />
        </div>
        <div className="modal-body">
          <div className="detail-grid">
            <div className="detail-item"><span className="detail-label">ID</span><span className="detail-value mono">{selectedTrace.id}</span></div>
            <div className="detail-item"><span className="detail-label">Intent</span><span className="badge badge-purple">{selectedTrace.intentName || 'unknown'}</span></div>
            <div className="detail-item"><span className="detail-label">Category</span><span className="badge badge-blue">{selectedTrace.intentCategory || '-'}</span></div>
            <div className="detail-item"><span className="detail-label">Synthesized</span><span className={`badge ${selectedTrace.synthesized ? 'badge-success' : 'badge-warning'}`}>{selectedTrace.synthesized ? 'Yes' : 'No'}</span></div>
            <div className="detail-item"><span className="detail-label">Tokens Used</span><span className="detail-value">{selectedTrace.tokensUsed || '-'}</span></div>
            <div className="detail-item"><span className="detail-label">Model</span><span className="detail-value mono">{selectedTrace.model || '-'}</span></div>
            <div className="detail-item"><span className="detail-label">Session</span><span className="detail-value mono">{selectedTrace.sessionId || '-'}</span></div>
            <div className="detail-item"><span className="detail-label">Timestamp</span><span className="detail-value">{formatDate(selectedTrace.timestamp)}</span></div>
          </div>
          <div className="detail-section">
            <h4>Intent Template</h4>
            <code className="code-block">{selectedTrace.intentTemplate || '-'}</code>
          </div>
        </div>
      </div>
    </div>
  );
}

function EpisodeModal() {
  const { selectedEpisode, setSelectedEpisode } = useMemoryStore();
  if (!selectedEpisode) return null;

  return (
    <div className="modal-overlay" onClick={() => setSelectedEpisode(null)}>
      <div className="modal-content large" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{'\uD83D\uDCD6'} Episode Detail</h2>
          <CloseButton onClick={() => setSelectedEpisode(null)} />
        </div>
        <div className="modal-body">
          <div className="detail-grid">
            <div className="detail-item"><span className="detail-label">ID</span><span className="detail-value mono">{selectedEpisode.id}</span></div>
            <div className="detail-item"><span className="detail-label">Type</span><span className="badge badge-blue">{selectedEpisode.type}</span></div>
            <div className="detail-item"><span className="detail-label">Valence</span><span className={`badge ${selectedEpisode.valence === 'positive' ? 'badge-success' : selectedEpisode.valence === 'negative' ? 'badge-warning' : 'badge-purple'}`}>{selectedEpisode.valence}</span></div>
            <div className="detail-item"><span className="detail-label">Importance</span><span className="detail-value">{(selectedEpisode.importance * 100).toFixed(0)}%</span></div>
            <div className="detail-item"><span className="detail-label">Success</span><span className="detail-value">{selectedEpisode.success === true ? '\u2713 Yes' : selectedEpisode.success === false ? '\u2717 No' : '-'}</span></div>
            <div className="detail-item"><span className="detail-label">Timestamp</span><span className="detail-value">{formatDate(selectedEpisode.timestamp)}</span></div>
          </div>

          <div className="detail-section">
            <h4>Summary</h4>
            <p className="detail-text">{selectedEpisode.summary}</p>
          </div>

          <div className="detail-section sao-chain">
            <h4>SAO Chain (Situation {'\u2192'} Action {'\u2192'} Outcome)</h4>
            <div className="sao-grid">
              <div className="sao-card situation">
                <h5>{'\uD83C\uDFAF'} Situation</h5>
                <p><strong>Context:</strong> {selectedEpisode.situation?.context || '-'}</p>
                <p><strong>Entities:</strong> {selectedEpisode.situation?.entities?.join(', ') || '-'}</p>
                {selectedEpisode.situation?.state && Object.keys(selectedEpisode.situation.state).length > 0 && (
                  <pre className="sao-json">{JSON.stringify(selectedEpisode.situation.state, null, 2)}</pre>
                )}
              </div>
              <div className="sao-card action">
                <h5>{'\u26A1'} Action</h5>
                <p><strong>Type:</strong> {selectedEpisode.action?.type || '-'}</p>
                <p><strong>Description:</strong> {selectedEpisode.action?.description || '-'}</p>
                {selectedEpisode.action?.parameters && Object.keys(selectedEpisode.action.parameters).length > 0 && (
                  <pre className="sao-json">{JSON.stringify(selectedEpisode.action.parameters, null, 2)}</pre>
                )}
              </div>
              <div className="sao-card outcome">
                <h5>{'\uD83D\uDCCA'} Outcome</h5>
                <p><strong>Result:</strong> {selectedEpisode.outcome?.result || '-'}</p>
                <p><strong>Success:</strong> {selectedEpisode.outcome?.success ? '\u2713' : '\u2717'}</p>
                <p><strong>Effects:</strong> {selectedEpisode.outcome?.effects?.join(', ') || '-'}</p>
                {selectedEpisode.outcome?.metrics && Object.keys(selectedEpisode.outcome.metrics).length > 0 && (
                  <pre className="sao-json">{JSON.stringify(selectedEpisode.outcome.metrics, null, 2)}</pre>
                )}
              </div>
            </div>
          </div>

          {selectedEpisode.lessonsLearned && selectedEpisode.lessonsLearned.length > 0 && (
            <div className="detail-section">
              <h4>Lessons Learned</h4>
              <ul className="lessons-list">
                {selectedEpisode.lessonsLearned.map((lesson, i) => (
                  <li key={i}>{lesson}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FactModal() {
  const { selectedFact, setSelectedFact } = useMemoryStore();
  if (!selectedFact) return null;

  return (
    <div className="modal-overlay" onClick={() => setSelectedFact(null)}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{'\uD83D\uDCDA'} Fact Detail</h2>
          <CloseButton onClick={() => setSelectedFact(null)} />
        </div>
        <div className="modal-body">
          <div className="fact-triple">
            <div className="triple-item subject">
              <span className="triple-label">Subject</span>
              <span className="triple-value">{selectedFact.subject}</span>
            </div>
            <div className="triple-arrow">{'\u2192'}</div>
            <div className="triple-item predicate">
              <span className="triple-label">Predicate</span>
              <span className="triple-value">{selectedFact.predicate}</span>
            </div>
            <div className="triple-arrow">{'\u2192'}</div>
            <div className="triple-item object">
              <span className="triple-label">Object</span>
              <span className="triple-value">{selectedFact.object}</span>
            </div>
          </div>
          <div className="detail-section">
            <h4>Statement</h4>
            <p className="detail-text">{selectedFact.statement}</p>
          </div>
          <div className="detail-grid">
            <div className="detail-item"><span className="detail-label">ID</span><span className="detail-value mono">{selectedFact.id}</span></div>
            <div className="detail-item"><span className="detail-label">Confidence</span><span className={`detail-value ${selectedFact.confidence >= 0.8 ? 'success-rate-high' : 'success-rate-mid'}`}>{(selectedFact.confidence * 100).toFixed(0)}%</span></div>
            <div className="detail-item"><span className="detail-label">Category</span><span className="badge badge-purple">{selectedFact.category}</span></div>
            <div className="detail-item"><span className="detail-label">Created</span><span className="detail-value">{formatDate(selectedFact.createdAt)}</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ContextModal() {
  const { selectedContext, setSelectedContext } = useMemoryStore();
  if (!selectedContext) return null;

  return (
    <div className="modal-overlay" onClick={() => setSelectedContext(null)}>
      <div className="modal-content large" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{'\uD83E\uDDE0'} Context Detail</h2>
          <CloseButton onClick={() => setSelectedContext(null)} />
        </div>
        <div className="modal-body">
          <div className="detail-grid">
            <div className="detail-item"><span className="detail-label">ID</span><span className="detail-value mono">{selectedContext.id}</span></div>
            <div className="detail-item"><span className="detail-label">Session</span><span className="detail-value mono">{selectedContext.sessionId}</span></div>
            <div className="detail-item"><span className="detail-label">Type</span><span className="badge badge-blue">{selectedContext.contentType}</span></div>
            <div className="detail-item"><span className="detail-label">Status</span><span className={`badge ${selectedContext.status === 'promoted' ? 'badge-success' : selectedContext.status === 'liquidated' ? 'badge-purple' : 'badge-warning'}`}>{selectedContext.status}</span></div>
            <div className="detail-item"><span className="detail-label">Original Tokens</span><span className="detail-value">{selectedContext.originalTokens}</span></div>
            <div className="detail-item"><span className="detail-label">Liquidated Tokens</span><span className="detail-value">{selectedContext.liquidatedTokens || '-'}</span></div>
            <div className="detail-item"><span className="detail-label">Compression</span><span className="detail-value">{selectedContext.compressionRatio ? `${(selectedContext.compressionRatio * 100).toFixed(0)}%` : '-'}</span></div>
            <div className="detail-item"><span className="detail-label">Expires</span><span className="detail-value">{selectedContext.expiresAt ? formatDate(selectedContext.expiresAt) : 'Never'}</span></div>
          </div>

          {selectedContext.rawContent && (
            <div className="detail-section">
              <h4>Raw Content</h4>
              <pre className="code-block">{selectedContext.rawContent}</pre>
            </div>
          )}

          {selectedContext.extractedFacts && selectedContext.extractedFacts.length > 0 && (
            <div className="detail-section">
              <h4>Extracted Facts</h4>
              <pre className="code-block">{JSON.stringify(selectedContext.extractedFacts, null, 2)}</pre>
            </div>
          )}

          {selectedContext.extractedEntities && selectedContext.extractedEntities.length > 0 && (
            <div className="detail-section">
              <h4>Extracted Entities</h4>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {selectedContext.extractedEntities.map((entity, i) => (
                  <span key={i} className="badge badge-blue">{entity}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function MemoryDetailModals() {
  return (
    <>
      <ShardModal />
      <TraceModal />
      <EpisodeModal />
      <FactModal />
      <ContextModal />
    </>
  );
}
