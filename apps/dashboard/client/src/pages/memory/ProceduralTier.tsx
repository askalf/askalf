import { useEffect } from 'react';
import { useMemoryStore } from '../../stores/memory';
import { ITEMS_PER_PAGE, lifecycleBadgeClass, formatDateShort, type LifecycleFilter } from '../../hooks/useMemoryApi';

function Pagination({ page, total, setPage }: { page: number; total: number; setPage: (p: number) => void }) {
  const totalPages = Math.ceil(total / ITEMS_PER_PAGE);
  if (total <= ITEMS_PER_PAGE) return null;
  const maxVisible = 7;
  let start = Math.max(1, page - 3);
  let end = Math.min(totalPages, start + maxVisible - 1);
  if (end - start < maxVisible - 1) start = Math.max(1, end - maxVisible + 1);
  const nums: number[] = [];
  for (let i = start; i <= end; i++) nums.push(i);

  return (
    <div className="brain-pagination">
      <button className="pagination-btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</button>
      {nums.map(n => (
        <button key={n} className={`pagination-btn ${n === page ? 'active' : ''}`} onClick={() => setPage(n)}>{n}</button>
      ))}
      <button className="pagination-btn" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</button>
    </div>
  );
}

export default function ProceduralTier() {
  const {
    shards, shardTotal, shardPage, lifecycle, shardCategory, shardCategories, showTraces,
    traces, traceTotal, tracePage, searchQuery, loading,
    setLifecycle, setShardCategory, setShowTraces, setShardPage, setTracePage, setSearchQuery,
    fetchShards, fetchTraces, fetchShardDetail, fetchTraceDetail,
  } = useMemoryStore();

  useEffect(() => {
    if (showTraces) fetchTraces();
    else fetchShards();
  }, [lifecycle, showTraces, shardPage, tracePage, shardCategory]);

  const matchesSearch = (text: string) => {
    if (!searchQuery.trim()) return true;
    return text.toLowerCase().includes(searchQuery.toLowerCase());
  };

  const filteredShards = shards.filter((s) =>
    matchesSearch(`${s.name} ${s.description || ''} ${s.category || ''}`)
  );

  const filteredTraces = traces.filter((t) =>
    matchesSearch(`${t.intentName} ${t.intentCategory} ${t.input} ${t.output}`)
  );

  const totalPages = Math.ceil(shardTotal / ITEMS_PER_PAGE);
  const traceTotalPages = Math.ceil(traceTotal / ITEMS_PER_PAGE);

  return (
    <>
      <div className="memory-filters">
        <div className="filter-group">
          <div className="brain-view-toggle">
            <button className={`toggle-pill ${!showTraces ? 'active' : ''}`} onClick={() => setShowTraces(false)}>Shards</button>
            <button className={`toggle-pill ${showTraces ? 'active' : ''}`} onClick={() => setShowTraces(true)}>Traces</button>
          </div>
        </div>
        {!showTraces && (
          <>
            <div className="filter-group">
              <label>Lifecycle:</label>
              <div className="filter-buttons">
                {(['promoted', 'testing', 'candidate', 'shadow', 'archived', 'all'] as LifecycleFilter[]).map((l) => (
                  <button key={l} className={`filter-btn ${lifecycle === l ? 'active' : ''}`} onClick={() => setLifecycle(l)}>
                    {l.charAt(0).toUpperCase() + l.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            <div className="filter-group">
              <label>Category:</label>
              <select value={shardCategory} onChange={(e) => setShardCategory(e.target.value)}>
                <option value="all">All Categories</option>
                {shardCategories.map((cat) => (
                  <option key={cat.value} value={cat.value}>
                    {cat.value.charAt(0).toUpperCase() + cat.value.slice(1).replace(/_/g, ' ')} ({cat.count})
                  </option>
                ))}
              </select>
            </div>
          </>
        )}
        <div className="brain-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
          <input type="text" placeholder="Search..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
        </div>
        <span className="filter-count">
          {showTraces
            ? `${traceTotal} traces${traceTotal > ITEMS_PER_PAGE ? ` (page ${tracePage} of ${traceTotalPages})` : ''}`
            : `${shardTotal} shards${shardTotal > ITEMS_PER_PAGE ? ` (page ${shardPage} of ${totalPages})` : ''}`
          }
        </span>
      </div>

      {/* Shards */}
      {!showTraces && (
        loading.shards ? (
          <div className="brain-loading">Loading shards...</div>
        ) : filteredShards.length === 0 ? (
          <div className="brain-empty">No shards found</div>
        ) : (
          <div className="brain-card-grid">
            {filteredShards.map((shard) => (
              <div key={shard.id} className="brain-card" onClick={() => fetchShardDetail(shard.id)}>
                <div className="brain-card-header">
                  <span className="brain-card-title">{shard.name}</span>
                  {shard.isOwned && <span className="owned-badge">owned</span>}
                </div>
                <div className="brain-card-badges">
                  <span className="badge badge-blue">{shard.category || 'general'}</span>
                  <span className={`badge ${lifecycleBadgeClass(shard.lifecycle)}`}>{shard.lifecycle}</span>
                </div>
                <div className="brain-card-body">
                  <div className="brain-card-metric">
                    <span className="metric-value">{(shard.confidence * 100).toFixed(1)}%</span>
                    <span className="metric-label">Confidence</span>
                  </div>
                  <div className="brain-card-metric">
                    <span className="metric-value">{shard.executionCount}</span>
                    <span className="metric-label">Executions</span>
                  </div>
                  <div className="brain-card-metric">
                    <span className={`metric-value ${shard.successRate >= 0.9 ? 'success-rate-high' : shard.successRate >= 0.7 ? 'success-rate-mid' : 'success-rate-low'}`}>
                      {(shard.successRate * 100).toFixed(0)}%
                    </span>
                    <span className="metric-label">Success</span>
                  </div>
                </div>
                <div className="brain-card-footer">
                  <span className="date-cell">{formatDateShort(shard.createdAt)}</span>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {!showTraces && <Pagination page={shardPage} total={shardTotal} setPage={setShardPage} />}

      {/* Traces */}
      {showTraces && (
        loading.traces ? (
          <div className="brain-loading">Loading traces...</div>
        ) : filteredTraces.length === 0 ? (
          <div className="brain-empty">No traces found</div>
        ) : (
          <div className="brain-card-grid">
            {filteredTraces.map((trace) => (
              <div key={trace.id} className="brain-card" onClick={() => fetchTraceDetail(trace.id)}>
                <div className="brain-card-header">
                  <span className="brain-card-title">{trace.intentName || 'unknown'}</span>
                  {trace.synthesized && <span className="badge badge-success">synthesized</span>}
                </div>
                <div className="brain-card-badges">
                  <span className="badge badge-blue">{trace.intentCategory || '-'}</span>
                  <span className="badge badge-purple">{trace.model?.split('/').pop() || '-'}</span>
                </div>
                <div className="brain-card-footer">
                  <span className="date-cell">{formatDateShort(trace.timestamp)}</span>
                  {trace.tokensUsed > 0 && <span className="footer-meta">{trace.tokensUsed} tokens</span>}
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {showTraces && <Pagination page={tracePage} total={traceTotal} setPage={setTracePage} />}
    </>
  );
}
