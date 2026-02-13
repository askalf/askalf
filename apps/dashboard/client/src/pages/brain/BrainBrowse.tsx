import { useEffect } from 'react';
import { useBrainStore } from '../../stores/brain';
import {
  SHARDS_PER_PAGE,
  formatNumber,
  formatSlugName,
  tokensToDollars,
} from '../../hooks/useBrainApi';

export default function BrainBrowse() {
  const {
    shards, shardTotal, browsePage,
    searchQuery, setSearchQuery,
    category, setCategory,
    categories, sortBy, setSortBy,
    browseLoading,
    setBrowsePage,
    fetchCategories: loadCategories,
    fetchShards,
    fetchShardDetail,
  } = useBrainStore();

  useEffect(() => {
    loadCategories();
    fetchShards();
  }, []);

  // Client-side search filter
  const filteredShards = shards.filter((shard) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      shard.name.toLowerCase().includes(q) ||
      shard.description?.toLowerCase().includes(q) ||
      shard.category?.toLowerCase().includes(q) ||
      shard.knowledgeType?.toLowerCase().includes(q) ||
      shard.patterns?.some(p => p.toLowerCase().includes(q))
    );
  });

  // Pagination
  const totalPages = Math.ceil(shardTotal / SHARDS_PER_PAGE);
  const pageNumbers: number[] = [];
  const maxVisible = 7;
  let pageStart = Math.max(1, browsePage - 3);
  let pageEnd = Math.min(totalPages, pageStart + maxVisible - 1);
  if (pageEnd - pageStart < maxVisible - 1) pageStart = Math.max(1, pageEnd - maxVisible + 1);
  for (let i = pageStart; i <= pageEnd; i++) pageNumbers.push(i);

  return (
    <div className="brain-browse">
      {/* Controls */}
      <div className="brain-controls">
        <div className="brain-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            type="text"
            placeholder="Search knowledge patterns..."
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

        <div className="brain-filters">
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
      <div className="brain-results-info">
        <span>
          {shardTotal} pattern{shardTotal !== 1 ? 's' : ''}
          {shardTotal > SHARDS_PER_PAGE && ` (page ${browsePage} of ${totalPages})`}
        </span>
        {searchQuery && <span className="search-term">filtering &quot;{searchQuery}&quot;</span>}
      </div>

      {/* Shard List */}
      <div className="brain-content">
        {browseLoading ? (
          <div className="brain-loading">
            <div className="loading-spinner" />
            <p>Loading knowledge patterns...</p>
          </div>
        ) : filteredShards.length === 0 ? (
          <div className="brain-empty-browse">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <h3>No patterns found</h3>
            <p>{searchQuery ? 'Try a different search term' : 'No patterns match your filters'}</p>
          </div>
        ) : (
          <div className="brain-shard-list">
            {filteredShards.map((shard) => (
              <div
                key={shard.id}
                className="brain-shard-row"
                onClick={() => fetchShardDetail(shard.id)}
              >
                <div className="shard-main">
                  <h3 className="shard-name">{shard.name}</h3>
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
                    <span className="stat-val">Used {formatNumber(shard.executionCount)}x</span>
                  </div>
                  <div className="shard-stat">
                    <span className="stat-val">{(shard.successRate * 100).toFixed(0)}%</span>
                    <span className="stat-lbl">success</span>
                  </div>
                  {shard.tokensSaved ? (
                    <div className="shard-stat">
                      <span className="stat-val">{tokensToDollars(shard.tokensSaved)}</span>
                      <span className="stat-lbl">saved</span>
                    </div>
                  ) : null}
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
      {shardTotal > SHARDS_PER_PAGE && (
        <div className="brain-pagination">
          <button className="pagination-btn" disabled={browsePage <= 1} onClick={() => setBrowsePage(browsePage - 1)}>Prev</button>
          {pageNumbers.map(num => (
            <button
              key={num}
              className={`pagination-btn ${num === browsePage ? 'active' : ''}`}
              onClick={() => setBrowsePage(num)}
            >
              {num}
            </button>
          ))}
          <button className="pagination-btn" disabled={browsePage >= totalPages} onClick={() => setBrowsePage(browsePage + 1)}>Next</button>
        </div>
      )}
    </div>
  );
}
