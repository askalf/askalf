import { useEffect } from 'react';
import { useMemoryStore } from '../../stores/memory';
import { ITEMS_PER_PAGE, formatDateShort, type ContextFilterType } from '../../hooks/useMemoryApi';

export default function WorkingTier() {
  const {
    contexts, contextTotal, contextPage, contextFilter, searchQuery, loading,
    setContextFilter, setContextPage, setSearchQuery, fetchContexts, fetchContextDetail,
  } = useMemoryStore();

  useEffect(() => {
    fetchContexts();
  }, [contextFilter, contextPage]);

  const matchesSearch = (text: string) => {
    if (!searchQuery.trim()) return true;
    return text.toLowerCase().includes(searchQuery.toLowerCase());
  };

  const filtered = contexts.filter((c) =>
    matchesSearch(`${c.sessionId} ${c.contentType} ${c.status}`)
  );
  const totalPages = Math.ceil(contextTotal / ITEMS_PER_PAGE);

  return (
    <>
      <div className="memory-filters">
        <div className="filter-group">
          <label>Status:</label>
          <div className="filter-buttons">
            {(['all', 'raw', 'liquidated', 'promoted'] as ContextFilterType[]).map((s) => (
              <button key={s} className={`filter-btn ${contextFilter === s ? 'active' : ''}`} onClick={() => setContextFilter(s)}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <div className="brain-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
          <input type="text" placeholder="Search..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
        </div>
        <span className="filter-count">
          {contextTotal} contexts{contextTotal > ITEMS_PER_PAGE ? ` (page ${contextPage} of ${totalPages})` : ''}
        </span>
      </div>

      {loading.contexts ? (
        <div className="brain-loading">Loading contexts...</div>
      ) : filtered.length === 0 ? (
        <div className="brain-empty">No active contexts found</div>
      ) : (
        <div className="brain-card-grid">
          {filtered.map((ctx) => (
            <div key={ctx.id} className="brain-card" onClick={() => fetchContextDetail(ctx.id)}>
              <div className="brain-card-header">
                <span className="brain-card-title mono">{ctx.sessionId?.slice(0, 8)}...</span>
                <span className={`badge ${ctx.status === 'promoted' ? 'badge-success' : ctx.status === 'liquidated' ? 'badge-purple' : 'badge-warning'}`}>
                  {ctx.status}
                </span>
              </div>
              <div className="brain-card-badges">
                <span className="badge badge-blue">{ctx.contentType}</span>
              </div>
              <div className="brain-card-body">
                <div className="brain-card-metric">
                  <span className="metric-value">{ctx.originalTokens || '-'}</span>
                  <span className="metric-label">Original</span>
                </div>
                <div className="brain-card-metric">
                  <span className="metric-value">{ctx.liquidatedTokens || '-'}</span>
                  <span className="metric-label">Liquidated</span>
                </div>
                <div className="brain-card-metric">
                  <span className="metric-value">{ctx.compressionRatio ? `${(ctx.compressionRatio * 100).toFixed(0)}%` : '-'}</span>
                  <span className="metric-label">Compression</span>
                </div>
              </div>
              <div className="brain-card-footer">
                <span className="date-cell">{formatDateShort(ctx.createdAt)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {contextTotal > ITEMS_PER_PAGE && (() => {
        const maxVisible = 7;
        let start = Math.max(1, contextPage - 3);
        let end = Math.min(totalPages, start + maxVisible - 1);
        if (end - start < maxVisible - 1) start = Math.max(1, end - maxVisible + 1);
        const nums: number[] = [];
        for (let i = start; i <= end; i++) nums.push(i);
        return (
          <div className="brain-pagination">
            <button className="pagination-btn" disabled={contextPage <= 1} onClick={() => setContextPage(contextPage - 1)}>Prev</button>
            {nums.map(n => (
              <button key={n} className={`pagination-btn ${n === contextPage ? 'active' : ''}`} onClick={() => setContextPage(n)}>{n}</button>
            ))}
            <button className="pagination-btn" disabled={contextPage >= totalPages} onClick={() => setContextPage(contextPage + 1)}>Next</button>
          </div>
        );
      })()}
    </>
  );
}
