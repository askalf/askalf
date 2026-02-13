import { useCallback, useEffect, useState } from 'react';
import { useHubStore, type MemorySubView } from '../../stores/hub';
import { usePolling } from '../../hooks/usePolling';
import type { FleetMemoryItem, FleetRecallEvent } from '../../hooks/useHubApi';
import TicketSystem from './TicketSystem';

const TIER_LABELS: Record<string, { label: string; icon: string; color: string }> = {
  semantic: { label: 'Knowledge', icon: '\u{1F4A1}', color: 'var(--water)' },
  episodic: { label: 'Experience', icon: '\u{1F4D6}', color: 'var(--synapse)' },
  procedural: { label: 'Pattern', icon: '\u{1F504}', color: 'var(--crystal)' },
};

const SOURCE_LABELS: Record<string, { label: string; icon: string }> = {
  execution: { label: 'Execution', icon: '\u{26A1}' },
  finding: { label: 'Finding', icon: '\u{1F50D}' },
  ticket: { label: 'Ticket', icon: '\u{1F3AB}' },
  agent_store: { label: 'Agent Stored', icon: '\u{1F4BE}' },
};

const SUB_VIEWS: { key: MemorySubView; label: string; icon: string }[] = [
  { key: 'timeline', label: 'Activity', icon: '\u{1F4CB}' },
  { key: 'semantic', label: 'Knowledge', icon: '\u{1F4A1}' },
  { key: 'episodic', label: 'Experience', icon: '\u{1F4D6}' },
  { key: 'procedural', label: 'Patterns', icon: '\u{1F504}' },
  { key: 'workqueue', label: 'Work Queue', icon: '\u{1F3AB}' },
];

const relativeTime = (iso: string) => {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
};

function TierBadge({ tier }: { tier: string }) {
  const info = TIER_LABELS[tier] || { label: tier, icon: '', color: 'var(--text-muted)' };
  return (
    <span className="fm-tier-badge" style={{ '--tier-color': info.color } as React.CSSProperties}>
      <span>{info.icon}</span> {info.label}
    </span>
  );
}

function SourceBadge({ sourceType }: { sourceType?: string }) {
  if (!sourceType) return null;
  const info = SOURCE_LABELS[sourceType] || { label: sourceType, icon: '' };
  return (
    <span className="fm-source-badge">
      <span>{info.icon}</span> {info.label}
    </span>
  );
}

function ScoreBar({ score, label }: { score: number; label?: string }) {
  const pct = Math.round(score * 100);
  const color = pct >= 80 ? 'var(--crystal)' : pct >= 50 ? 'var(--warning)' : 'var(--text-muted)';
  return (
    <div className="fm-score-bar">
      <div className="fm-score-bar-fill" style={{ width: `${pct}%`, background: color }} />
      <span className="fm-score-bar-label">{label || `${pct}%`}</span>
    </div>
  );
}

function MemoryCard({ item, expanded, onToggle }: { item: FleetMemoryItem; expanded: boolean; onToggle: () => void }) {
  const sourceType = item.metadata?.source_type;
  const isEpisodic = item.tier === 'episodic' && item.situation;
  const isProcedural = item.tier === 'procedural' && item.trigger_pattern;

  return (
    <div className={`fm-memory-card ${item.tier}`} onClick={onToggle}>
      <div className="fm-memory-header">
        <TierBadge tier={item.tier} />
        <SourceBadge sourceType={sourceType} />
        <span className="fm-memory-agent">{item.agent_name || item.agent_id.slice(0, 8)}</span>
        <span className="fm-memory-time">{relativeTime(item.created_at)}</span>
      </div>

      {isEpisodic && expanded ? (
        <div className="fm-sao-display">
          <div className="fm-sao-row">
            <span className="fm-sao-label">Context</span>
            <span className="fm-sao-text">{item.situation}</span>
          </div>
          <div className="fm-sao-row">
            <span className="fm-sao-label">What Happened</span>
            <span className="fm-sao-text">{item.action}</span>
          </div>
          <div className="fm-sao-row">
            <span className="fm-sao-label">Result</span>
            <span className="fm-sao-text">{item.outcome}</span>
          </div>
        </div>
      ) : isProcedural && expanded ? (
        <div className="fm-procedural-display">
          <div className="fm-sao-row">
            <span className="fm-sao-label">Trigger</span>
            <span className="fm-sao-text">{item.trigger_pattern}</span>
          </div>
          {item.tool_sequence && Array.isArray(item.tool_sequence) && (
            <div className="fm-sao-row">
              <span className="fm-sao-label">Tools</span>
              <span className="fm-sao-text">
                {item.tool_sequence.map((s: unknown) => {
                  const step = s as { tool?: string };
                  return step?.tool || '?';
                }).join(' \u2192 ')}
              </span>
            </div>
          )}
        </div>
      ) : (
        <div className="fm-memory-content">
          {expanded
            ? (item.content || item.preview || '')
            : (item.content || item.preview || '').slice(0, 200) + ((item.content || item.preview || '').length > 200 ? '...' : '')}
        </div>
      )}

      <div className="fm-memory-footer">
        <ScoreBar
          score={item.tier === 'episodic' ? (item.outcome_quality ?? item.score) : item.score}
          label={item.tier === 'episodic' ? `Quality: ${Math.round((item.outcome_quality ?? item.score) * 100)}%` : undefined}
        />
        {item.metadata?.tokens_used && (
          <span className="fm-memory-meta">{(item.metadata.tokens_used as number).toLocaleString()} tokens</span>
        )}
        {item.metadata?.cost != null && (
          <span className="fm-memory-meta">${(item.metadata.cost as number).toFixed(4)}</span>
        )}
      </div>
    </div>
  );
}

function Pagination({ pagination, onPageChange }: { pagination: { total: number; page: number; totalPages: number } | null; onPageChange: (p: number) => void }) {
  if (!pagination || pagination.totalPages <= 1) return null;
  return (
    <div className="fm-pagination">
      <button
        className="hub-btn hub-btn--ghost"
        disabled={pagination.page <= 1}
        onClick={() => onPageChange(pagination.page - 1)}
      >
        Prev
      </button>
      <span className="fm-pagination-info">
        Page {pagination.page} of {pagination.totalPages} ({pagination.total} total)
      </span>
      <button
        className="hub-btn hub-btn--ghost"
        disabled={pagination.page >= pagination.totalPages}
        onClick={() => onPageChange(pagination.page + 1)}
      >
        Next
      </button>
    </div>
  );
}

// =========================================
// Sub-view: Timeline (default)
// =========================================
function TimelineView() {
  const memoryRecentItems = useHubStore((s) => s.memoryRecentItems);
  const memorySearchResults = useHubStore((s) => s.memorySearchResults);
  const memorySearchQuery = useHubStore((s) => s.memorySearchQuery);
  const memoryRecalls = useHubStore((s) => s.memoryRecalls);
  const memoryPagination = useHubStore((s) => s.memoryPagination);
  const loading = useHubStore((s) => s.loading);
  const setMemoryPage = useHubStore((s) => s.setMemoryPage);
  const fetchMemoryRecent = useHubStore((s) => s.fetchMemoryRecent);
  const fetchMemoryRecalls = useHubStore((s) => s.fetchMemoryRecalls);
  const searchMemory = useHubStore((s) => s.searchMemory);

  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => { fetchMemoryRecalls(); }, [fetchMemoryRecalls]);

  const isSearchMode = memorySearchQuery.trim().length > 0;
  const displayItems = isSearchMode ? memorySearchResults : memoryRecentItems;

  const handlePageChange = (p: number) => {
    setMemoryPage(p);
    if (isSearchMode) searchMemory(memorySearchQuery);
    else fetchMemoryRecent();
  };

  if ((loading.memorySearch || loading.memoryRecent) && displayItems.length === 0) {
    return <div className="hub-loading">Loading...</div>;
  }

  if (displayItems.length === 0 && memoryRecalls.length === 0) {
    return (
      <div className="hub-empty">
        <div className="hub-empty__icon">{isSearchMode ? '\u{1F50D}' : '\u{1F4CB}'}</div>
        <div className="hub-empty__title">{isSearchMode ? 'No matching memories' : 'No activity yet'}</div>
        <div className="hub-empty__message">
          {isSearchMode
            ? 'Try a different search term or broaden your filters'
            : 'Agent activity will appear here as they run and learn'}
        </div>
      </div>
    );
  }

  // Show recent lookups at top of activity feed (non-search mode only)
  const recentRecalls = isSearchMode ? [] : memoryRecalls.slice(0, 3);

  return (
    <>
      {recentRecalls.length > 0 && (
        <div className="fm-recall-summary">
          <div className="fm-recall-summary-label">Recent Lookups</div>
          <div className="fm-recall-summary-items">
            {recentRecalls.map((recall: FleetRecallEvent, i: number) => (
              <div key={`${recall.executionId}-${i}`} className="fm-recall-chip">
                <span className="fm-recall-chip-agent">{recall.agentName}</span>
                <span className="fm-recall-chip-count">{recall.memoriesCount} recalled</span>
                <span className="fm-recall-chip-time">{relativeTime(recall.timestamp)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="fm-memory-list">
        {displayItems.map((item) => (
          <MemoryCard
            key={item.id}
            item={item}
            expanded={expandedId === item.id}
            onToggle={() => setExpandedId(expandedId === item.id ? null : item.id)}
          />
        ))}
      </div>
      <Pagination pagination={memoryPagination} onPageChange={handlePageChange} />
    </>
  );
}

// =========================================
// Sub-view: Episodic
// =========================================
function EpisodicView() {
  const memoryRecentItems = useHubStore((s) => s.memoryRecentItems);
  const memoryPagination = useHubStore((s) => s.memoryPagination);
  const loading = useHubStore((s) => s.loading);
  const setMemoryPage = useHubStore((s) => s.setMemoryPage);
  const fetchMemoryRecent = useHubStore((s) => s.fetchMemoryRecent);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [qualityFilter, setQualityFilter] = useState('');

  let items = memoryRecentItems;
  if (qualityFilter === 'high') items = items.filter(i => (i.outcome_quality ?? i.score) >= 0.7);
  else if (qualityFilter === 'low') items = items.filter(i => (i.outcome_quality ?? i.score) < 0.3);

  const handlePageChange = (p: number) => {
    setMemoryPage(p);
    fetchMemoryRecent();
  };

  if (loading.memoryRecent && items.length === 0) {
    return <div className="hub-loading">Loading experiences...</div>;
  }

  return (
    <>
      <div className="fm-subview-filters">
        <select value={qualityFilter} onChange={(e) => setQualityFilter(e.target.value)}>
          <option value="">All Quality</option>
          <option value="high">High (&ge;70%)</option>
          <option value="low">Low (&lt;30%)</option>
        </select>
      </div>
      {items.length === 0 ? (
        <div className="hub-empty">
          <div className="hub-empty__icon">{'\u{1F4D6}'}</div>
          <div className="hub-empty__title">No experiences yet</div>
          <div className="hub-empty__message">Agent experiences are recorded as they complete tasks and resolve tickets</div>
        </div>
      ) : (
        <div className="fm-memory-list">
          {items.map((item) => (
            <MemoryCard
              key={item.id}
              item={item}
              expanded={expandedId === item.id}
              onToggle={() => setExpandedId(expandedId === item.id ? null : item.id)}
            />
          ))}
        </div>
      )}
      <Pagination pagination={memoryPagination} onPageChange={handlePageChange} />
    </>
  );
}

// =========================================
// Sub-view: Semantic
// =========================================
function SemanticView() {
  const memoryRecentItems = useHubStore((s) => s.memoryRecentItems);
  const memoryPagination = useHubStore((s) => s.memoryPagination);
  const loading = useHubStore((s) => s.loading);
  const setMemoryPage = useHubStore((s) => s.setMemoryPage);
  const fetchMemoryRecent = useHubStore((s) => s.fetchMemoryRecent);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [importanceFilter, setImportanceFilter] = useState('');

  let items = memoryRecentItems;
  if (importanceFilter === 'high') items = items.filter(i => i.score >= 0.7);
  else if (importanceFilter === 'medium') items = items.filter(i => i.score >= 0.3 && i.score < 0.7);
  else if (importanceFilter === 'low') items = items.filter(i => i.score < 0.3);

  const handlePageChange = (p: number) => {
    setMemoryPage(p);
    fetchMemoryRecent();
  };

  if (loading.memoryRecent && items.length === 0) {
    return <div className="hub-loading">Loading knowledge...</div>;
  }

  return (
    <>
      <div className="fm-subview-filters">
        <select value={importanceFilter} onChange={(e) => setImportanceFilter(e.target.value)}>
          <option value="">All Importance</option>
          <option value="high">High (&ge;70%)</option>
          <option value="medium">Medium</option>
          <option value="low">Low (&lt;30%)</option>
        </select>
      </div>
      {items.length === 0 ? (
        <div className="hub-empty">
          <div className="hub-empty__icon">{'\u{1F4A1}'}</div>
          <div className="hub-empty__title">No knowledge stored yet</div>
          <div className="hub-empty__message">Agents store knowledge and findings here as they discover useful information</div>
        </div>
      ) : (
        <div className="fm-memory-list">
          {items.map((item) => (
            <MemoryCard
              key={item.id}
              item={item}
              expanded={expandedId === item.id}
              onToggle={() => setExpandedId(expandedId === item.id ? null : item.id)}
            />
          ))}
        </div>
      )}
      <Pagination pagination={memoryPagination} onPageChange={handlePageChange} />
    </>
  );
}

// =========================================
// Sub-view: Procedural
// =========================================
function ProceduralView() {
  const memoryRecentItems = useHubStore((s) => s.memoryRecentItems);
  const memoryPagination = useHubStore((s) => s.memoryPagination);
  const loading = useHubStore((s) => s.loading);
  const setMemoryPage = useHubStore((s) => s.setMemoryPage);
  const fetchMemoryRecent = useHubStore((s) => s.fetchMemoryRecent);

  const [expandedId, setExpandedId] = useState<string | null>(null);

  const handlePageChange = (p: number) => {
    setMemoryPage(p);
    fetchMemoryRecent();
  };

  if (loading.memoryRecent && memoryRecentItems.length === 0) {
    return <div className="hub-loading">Loading patterns...</div>;
  }

  return (
    <>
      {memoryRecentItems.length === 0 ? (
        <div className="hub-empty">
          <div className="hub-empty__icon">{'\u{1F504}'}</div>
          <div className="hub-empty__title">No patterns learned yet</div>
          <div className="hub-empty__message">Agents learn patterns as they figure out which tools and workflows work best</div>
        </div>
      ) : (
        <div className="fm-memory-list">
          {memoryRecentItems.map((item) => (
            <MemoryCard
              key={item.id}
              item={item}
              expanded={expandedId === item.id}
              onToggle={() => setExpandedId(expandedId === item.id ? null : item.id)}
            />
          ))}
        </div>
      )}
      <Pagination pagination={memoryPagination} onPageChange={handlePageChange} />
    </>
  );
}

// =========================================
// Main FleetMemory component
// =========================================
export default function FleetMemory() {
  const memoryStats = useHubStore((s) => s.memoryStats);
  const memorySearchQuery = useHubStore((s) => s.memorySearchQuery);
  const memoryTierFilter = useHubStore((s) => s.memoryTierFilter);
  const memoryAgentFilter = useHubStore((s) => s.memoryAgentFilter);
  const memorySubView = useHubStore((s) => s.memorySubView);
  const memorySourceFilter = useHubStore((s) => s.memorySourceFilter);
  const contentAgents = useHubStore((s) => s.contentAgents);

  const setMemorySearchQuery = useHubStore((s) => s.setMemorySearchQuery);
  const setMemoryTierFilter = useHubStore((s) => s.setMemoryTierFilter);
  const setMemoryAgentFilter = useHubStore((s) => s.setMemoryAgentFilter);
  const setMemorySubView = useHubStore((s) => s.setMemorySubView);
  const setMemorySourceFilter = useHubStore((s) => s.setMemorySourceFilter);
  const fetchMemoryStats = useHubStore((s) => s.fetchMemoryStats);
  const searchMemory = useHubStore((s) => s.searchMemory);
  const fetchMemoryRecent = useHubStore((s) => s.fetchMemoryRecent);
  const fetchContentAgents = useHubStore((s) => s.fetchContentAgents);

  const [searchInput, setSearchInput] = useState('');

  // Load on mount
  useEffect(() => {
    fetchMemoryStats();
    fetchMemoryRecent();
    if (contentAgents.length === 0) fetchContentAgents();
  }, [fetchMemoryStats, fetchMemoryRecent, fetchContentAgents, contentAgents.length]);

  // Refresh when sub-view changes
  useEffect(() => {
    if (memorySubView === 'workqueue') return;
    // Set tier filter based on sub-view
    if (memorySubView === 'episodic') setMemoryTierFilter('episodic');
    else if (memorySubView === 'semantic') setMemoryTierFilter('semantic');
    else if (memorySubView === 'procedural') setMemoryTierFilter('procedural');
    else setMemoryTierFilter('');
    fetchMemoryRecent();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memorySubView]);

  // Refresh recent when filters change
  useEffect(() => {
    if (memorySubView === 'workqueue') return;
    fetchMemoryRecent();
  }, [memoryAgentFilter, memorySourceFilter, fetchMemoryRecent, memorySubView]);

  // Poll stats every 30s
  const poll = useCallback(() => {
    fetchMemoryStats();
    if (memorySubView !== 'workqueue') fetchMemoryRecent();
  }, [fetchMemoryStats, fetchMemoryRecent, memorySubView]);
  usePolling(poll, 30000);

  const handleSearch = () => {
    if (searchInput.trim()) {
      setMemorySearchQuery(searchInput);
      searchMemory(searchInput);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
  };

  const clearSearch = () => {
    setSearchInput('');
    setMemorySearchQuery('');
    searchMemory('');
  };

  const isSearchMode = memorySearchQuery.trim().length > 0;
  const showFilters = memorySubView !== 'workqueue';

  return (
    <>
      {/* Stats Cards */}
      <div className="fm-stats-grid">
        <div className="fm-stat-card">
          <div className="fm-stat-value">{memoryStats?.total ?? '-'}</div>
          <div className="fm-stat-label">Total</div>
        </div>
        <div className="fm-stat-card semantic">
          <div className="fm-stat-value">{memoryStats?.tiers.semantic ?? '-'}</div>
          <div className="fm-stat-label">Knowledge</div>
          {(memoryStats?.recent24h.semantic ?? 0) > 0 && (
            <div className="fm-stat-recent">+{memoryStats!.recent24h.semantic} today</div>
          )}
        </div>
        <div className="fm-stat-card episodic">
          <div className="fm-stat-value">{memoryStats?.tiers.episodic ?? '-'}</div>
          <div className="fm-stat-label">Experience</div>
          {(memoryStats?.recent24h.episodic ?? 0) > 0 && (
            <div className="fm-stat-recent">+{memoryStats!.recent24h.episodic} today</div>
          )}
        </div>
        <div className="fm-stat-card procedural">
          <div className="fm-stat-value">{memoryStats?.tiers.procedural ?? '-'}</div>
          <div className="fm-stat-label">Patterns</div>
          {(memoryStats?.recent24h.procedural ?? 0) > 0 && (
            <div className="fm-stat-recent">+{memoryStats!.recent24h.procedural} today</div>
          )}
        </div>
        <div className="fm-stat-card recalls">
          <div className="fm-stat-value">{memoryStats?.recalls24h ?? '-'}</div>
          <div className="fm-stat-label">Lookups (24h)</div>
        </div>
      </div>

      {/* Sub-view Navigation */}
      <div className="fm-subview-nav">
        {SUB_VIEWS.map((sv) => (
          <button
            key={sv.key}
            className={`fm-subview-tab ${memorySubView === sv.key ? 'active' : ''}`}
            onClick={() => setMemorySubView(sv.key)}
          >
            <span className="fm-subview-icon">{sv.icon}</span>
            {sv.label}
          </button>
        ))}
      </div>

      {/* Search + Filters (hide for Work Queue) */}
      {showFilters && (
        <div className="fm-search-section">
          <div className="fm-search-bar">
            <div className="fm-search-input-wrap">
              <svg className="fm-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.3-4.3" />
              </svg>
              <input
                className="fm-search-input"
                type="text"
                placeholder="Search agent memories..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={handleKeyDown}
              />
              {searchInput && (
                <button className="fm-search-clear" onClick={clearSearch} aria-label="Clear search">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
            <button className="hub-btn hub-btn--primary" onClick={handleSearch} disabled={!searchInput.trim()}>
              Search
            </button>
          </div>

          <div className="fm-filter-row">
            {memorySubView === 'timeline' && (
              <select value={memoryTierFilter} onChange={(e) => { setMemoryTierFilter(e.target.value); if (isSearchMode) searchMemory(memorySearchQuery); }}>
                <option value="">All Types</option>
                <option value="semantic">Knowledge</option>
                <option value="episodic">Experience</option>
                <option value="procedural">Patterns</option>
              </select>
            )}
            <select value={memorySourceFilter} onChange={(e) => { setMemorySourceFilter(e.target.value); if (isSearchMode) searchMemory(memorySearchQuery); }}>
              <option value="">All Sources</option>
              <option value="execution">Executions</option>
              <option value="finding">Findings</option>
              <option value="ticket">Tickets</option>
              <option value="agent_store">Agent Stored</option>
            </select>
            <select value={memoryAgentFilter} onChange={(e) => { setMemoryAgentFilter(e.target.value); if (isSearchMode) searchMemory(memorySearchQuery); }}>
              <option value="">All Agents</option>
              {contentAgents.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Section Header */}
      {showFilters && (
        <div className="fm-section-header">
          <h3>
            {isSearchMode
              ? 'Search Results'
              : memorySubView === 'timeline' ? 'Recent Activity'
              : memorySubView === 'episodic' ? 'Agent Experiences'
              : memorySubView === 'semantic' ? 'Stored Knowledge'
              : 'Learned Patterns'}
          </h3>
          {isSearchMode && (
            <button className="hub-btn hub-btn--ghost" onClick={clearSearch}>
              Clear Search
            </button>
          )}
        </div>
      )}

      {/* Sub-view Content */}
      {memorySubView === 'timeline' && <TimelineView />}
      {memorySubView === 'episodic' && <EpisodicView />}
      {memorySubView === 'semantic' && <SemanticView />}
      {memorySubView === 'procedural' && <ProceduralView />}
      {memorySubView === 'workqueue' && <TicketSystem />}
    </>
  );
}
