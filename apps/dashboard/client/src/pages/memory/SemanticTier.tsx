import { useEffect } from 'react';
import { useMemoryStore } from '../../stores/memory';
import { ITEMS_PER_PAGE, formatDateShort } from '../../hooks/useMemoryApi';

export default function SemanticTier() {
  const {
    facts, factTotal, factPage, factCategory, factCategories, searchQuery, loading,
    setFactCategory, setFactPage, setSearchQuery, fetchFacts, setSelectedFact,
  } = useMemoryStore();

  useEffect(() => {
    fetchFacts();
  }, [factCategory, factPage]);

  const matchesSearch = (text: string) => {
    if (!searchQuery.trim()) return true;
    return text.toLowerCase().includes(searchQuery.toLowerCase());
  };

  const filtered = facts.filter((f) =>
    matchesSearch(`${f.subject} ${f.predicate} ${f.object} ${f.statement}`)
  );
  const totalPages = Math.ceil(factTotal / ITEMS_PER_PAGE);

  return (
    <>
      <div className="memory-filters">
        <div className="filter-group">
          <label>Category:</label>
          <select value={factCategory} onChange={(e) => setFactCategory(e.target.value)}>
            <option value="all">All Categories</option>
            {factCategories.map((cat) => (
              <option key={cat.value} value={cat.value}>
                {cat.value.charAt(0).toUpperCase() + cat.value.slice(1).replace(/_/g, ' ')} ({cat.count})
              </option>
            ))}
          </select>
        </div>
        <div className="brain-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
          <input type="text" placeholder="Search..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
        </div>
        <span className="filter-count">
          {factTotal} facts{factTotal > ITEMS_PER_PAGE ? ` (page ${factPage} of ${totalPages})` : ''}
        </span>
      </div>

      {loading.facts ? (
        <div className="brain-loading">Loading facts...</div>
      ) : filtered.length === 0 ? (
        <div className="brain-empty">No facts found</div>
      ) : (
        <div className="brain-card-grid">
          {filtered.map((fact) => (
            <div key={fact.id} className="brain-card" onClick={() => setSelectedFact(fact)}>
              <div className="brain-card-header">
                <span className="badge badge-purple">{fact.category || 'general'}</span>
                <span className={`metric-value ${fact.confidence >= 0.8 ? 'success-rate-high' : fact.confidence >= 0.5 ? 'success-rate-mid' : 'success-rate-low'}`}>
                  {(fact.confidence * 100).toFixed(0)}%
                </span>
              </div>
              <div className="brain-card-body">
                <div className="brain-card-triple">
                  <span className="triple-subject">{fact.subject}</span>
                  <span className="triple-arrow">{'\u2192'}</span>
                  <span className="triple-predicate">{fact.predicate}</span>
                  <span className="triple-arrow">{'\u2192'}</span>
                  <span className="triple-object">{fact.object}</span>
                </div>
              </div>
              <div className="brain-card-footer">
                <span className="date-cell">{formatDateShort(fact.createdAt)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {factTotal > ITEMS_PER_PAGE && (() => {
        const maxVisible = 7;
        let start = Math.max(1, factPage - 3);
        let end = Math.min(totalPages, start + maxVisible - 1);
        if (end - start < maxVisible - 1) start = Math.max(1, end - maxVisible + 1);
        const nums: number[] = [];
        for (let i = start; i <= end; i++) nums.push(i);
        return (
          <div className="brain-pagination">
            <button className="pagination-btn" disabled={factPage <= 1} onClick={() => setFactPage(factPage - 1)}>Prev</button>
            {nums.map(n => (
              <button key={n} className={`pagination-btn ${n === factPage ? 'active' : ''}`} onClick={() => setFactPage(n)}>{n}</button>
            ))}
            <button className="pagination-btn" disabled={factPage >= totalPages} onClick={() => setFactPage(factPage + 1)}>Next</button>
          </div>
        );
      })()}
    </>
  );
}
