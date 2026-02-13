import { useEffect } from 'react';
import { useMemoryStore } from '../../stores/memory';
import { ITEMS_PER_PAGE, formatDateShort, type EpisodeFilter } from '../../hooks/useMemoryApi';

export default function EpisodicTier() {
  const {
    episodes, episodeTotal, episodePage, episodeFilter, searchQuery, loading,
    setEpisodeFilter, setEpisodePage, setSearchQuery, fetchEpisodes, fetchEpisodeDetail,
  } = useMemoryStore();

  useEffect(() => {
    fetchEpisodes();
  }, [episodeFilter, episodePage]);

  const matchesSearch = (text: string) => {
    if (!searchQuery.trim()) return true;
    return text.toLowerCase().includes(searchQuery.toLowerCase());
  };

  const filtered = episodes.filter((e) => matchesSearch(`${e.type} ${e.summary}`));
  const totalPages = Math.ceil(episodeTotal / ITEMS_PER_PAGE);

  return (
    <>
      <div className="memory-filters">
        <div className="filter-group">
          <label>Valence:</label>
          <div className="filter-buttons">
            {(['all', 'positive', 'negative'] as EpisodeFilter[]).map((v) => (
              <button key={v} className={`filter-btn ${episodeFilter === v ? 'active' : ''}`} onClick={() => setEpisodeFilter(v)}>
                {v.charAt(0).toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <div className="brain-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
          <input type="text" placeholder="Search..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
        </div>
        <span className="filter-count">
          {episodeTotal} episodes{episodeTotal > ITEMS_PER_PAGE ? ` (page ${episodePage} of ${totalPages})` : ''}
        </span>
      </div>

      {loading.episodes ? (
        <div className="brain-loading">Loading episodes...</div>
      ) : filtered.length === 0 ? (
        <div className="brain-empty">No episodes found</div>
      ) : (
        <div className="brain-card-grid">
          {filtered.map((ep) => (
            <div key={ep.id} className="brain-card" onClick={() => fetchEpisodeDetail(ep.id)}>
              <div className="brain-card-header">
                <span className="badge badge-blue">{ep.type}</span>
                <span className={`badge ${ep.valence === 'positive' ? 'badge-success' : ep.valence === 'negative' ? 'badge-warning' : 'badge-purple'}`}>
                  {ep.valence || 'neutral'}
                </span>
              </div>
              <div className="brain-card-body">
                <div className="brain-card-text">{ep.summary}</div>
              </div>
              <div className="brain-card-body">
                <div className="brain-card-metric">
                  <span className="metric-value">{(ep.importance * 100).toFixed(0)}%</span>
                  <span className="metric-label">Importance</span>
                </div>
                <div className="brain-card-metric">
                  <span className="metric-value">{ep.success === true ? '\u2713' : ep.success === false ? '\u2717' : '-'}</span>
                  <span className="metric-label">Success</span>
                </div>
              </div>
              <div className="brain-card-footer">
                <span className="date-cell">{formatDateShort(ep.timestamp)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {episodeTotal > ITEMS_PER_PAGE && (() => {
        const maxVisible = 7;
        let start = Math.max(1, episodePage - 3);
        let end = Math.min(totalPages, start + maxVisible - 1);
        if (end - start < maxVisible - 1) start = Math.max(1, end - maxVisible + 1);
        const nums: number[] = [];
        for (let i = start; i <= end; i++) nums.push(i);
        return (
          <div className="brain-pagination">
            <button className="pagination-btn" disabled={episodePage <= 1} onClick={() => setEpisodePage(episodePage - 1)}>Prev</button>
            {nums.map(n => (
              <button key={n} className={`pagination-btn ${n === episodePage ? 'active' : ''}`} onClick={() => setEpisodePage(n)}>{n}</button>
            ))}
            <button className="pagination-btn" disabled={episodePage >= totalPages} onClick={() => setEpisodePage(episodePage + 1)}>Next</button>
          </div>
        );
      })()}
    </>
  );
}
