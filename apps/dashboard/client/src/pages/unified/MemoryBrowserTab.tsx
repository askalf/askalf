import { useState, useEffect, useCallback, useRef } from 'react';
import './MemoryBrowserTab.css';

// ── Types ──

type MemoryType = 'all' | 'semantic' | 'episodic' | 'procedural';

interface MemoryStats {
  semantic: number;
  episodic: number;
  procedural: number;
  total: number;
}

// API returns a unified shape with a `tier` discriminator
interface ApiMemory {
  id: string;
  tier: 'semantic' | 'episodic' | 'procedural';
  agent_id: string;
  content?: string;
  preview?: string;
  score?: number;
  created_at: string;
  // semantic
  importance?: number;
  source?: string;
  // episodic
  situation?: string;
  action?: string;
  outcome?: string;
  outcome_quality?: number;
  // procedural
  trigger_pattern?: string;
  confidence?: number;
  // common
  access_count?: number;
  metadata?: Record<string, unknown>;
}

// ── Helpers ──

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

// ── Stats Bar ──

function StatsBar({ stats, loading }: { stats: MemoryStats | null; loading: boolean }) {
  const cards = [
    { label: 'Semantic', value: stats?.semantic ?? 0, color: 'violet' },
    { label: 'Episodic', value: stats?.episodic ?? 0, color: 'green' },
    { label: 'Procedural', value: stats?.procedural ?? 0, color: 'cyan' },
  ];

  return (
    <div className="membrowser-stats-grid">
      {cards.map((c) => (
        <div key={c.label} className="membrowser-stat-card">
          <div className={`membrowser-stat-value ${c.color}`}>
            {loading ? '\u2014' : c.value.toLocaleString()}
          </div>
          <div className="membrowser-stat-label">{c.label}</div>
        </div>
      ))}
      <div className="membrowser-stat-card membrowser-stat-total">
        <div className="membrowser-stat-value">
          {loading ? '\u2014' : (stats?.total ?? 0).toLocaleString()}
        </div>
        <div className="membrowser-stat-label">Total</div>
      </div>
    </div>
  );
}

// ── Score Bar ──

function ScoreBar({ value, label }: { value: number; label?: string }) {
  const pct = Math.round(value * 100);
  const hue = value > 0.7 ? 'high' : value > 0.4 ? 'mid' : 'low';

  return (
    <div className="membrowser-score">
      {label && <span className="membrowser-score-label">{label}</span>}
      <div className="membrowser-score-track">
        <div
          className={`membrowser-score-fill ${hue}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="membrowser-score-value">{pct}%</span>
    </div>
  );
}

// ── Memory Card ──

function MemoryCard({ memory }: { memory: ApiMemory }) {
  if (memory.tier === 'semantic') {
    return (
      <div className="membrowser-card">
        <div className="membrowser-card-header">
          <span className="membrowser-type-badge semantic">Semantic</span>
          <span className="membrowser-card-time">{relativeTime(memory.created_at)}</span>
        </div>
        <div className="membrowser-card-body">
          <p className="membrowser-card-content">{memory.content}</p>
          <ScoreBar value={memory.score ?? 0.5} label="Importance" />
        </div>
        <div className="membrowser-card-footer">
          <span className="membrowser-card-meta">Source: {memory.source || 'unknown'}</span>
          <span className="membrowser-card-meta">Agent: {memory.agent_id}</span>
        </div>
      </div>
    );
  }

  if (memory.tier === 'episodic') {
    return (
      <div className="membrowser-card">
        <div className="membrowser-card-header">
          <span className="membrowser-type-badge episodic">Episodic</span>
          <span className="membrowser-card-time">{relativeTime(memory.created_at)}</span>
        </div>
        <div className="membrowser-card-body">
          <div className="membrowser-field">
            <span className="membrowser-field-label">Situation</span>
            <p className="membrowser-field-value">{memory.situation}</p>
          </div>
          {memory.action && (
            <div className="membrowser-field">
              <span className="membrowser-field-label">Action</span>
              <p className="membrowser-field-value">{memory.action}</p>
            </div>
          )}
          {memory.outcome && (
            <div className="membrowser-field">
              <span className="membrowser-field-label">Outcome</span>
              <p className="membrowser-field-value">{memory.outcome}</p>
            </div>
          )}
          <ScoreBar value={memory.outcome_quality ?? 0.5} label="Quality" />
        </div>
        <div className="membrowser-card-footer">
          <span className="membrowser-card-meta">Agent: {memory.agent_id}</span>
        </div>
      </div>
    );
  }

  if (memory.tier === 'procedural') {
    return (
      <div className="membrowser-card">
        <div className="membrowser-card-header">
          <span className="membrowser-type-badge procedural">Procedural</span>
          <span className="membrowser-card-time">{relativeTime(memory.created_at)}</span>
        </div>
        <div className="membrowser-card-body">
          <div className="membrowser-field">
            <span className="membrowser-field-label">Trigger Pattern</span>
            <code className="membrowser-trigger">{memory.trigger_pattern}</code>
          </div>
          <ScoreBar value={memory.confidence ?? 0.5} label="Confidence" />
        </div>
        <div className="membrowser-card-footer">
          <span className="membrowser-card-meta">Agent: {memory.agent_id}</span>
        </div>
      </div>
    );
  }

  return null;
}

// ── Empty State ──

function EmptyState({ search, type }: { search: string; type: string }) {
  return (
    <div className="membrowser-empty">
      <div className="membrowser-empty-icon">&#x2205;</div>
      <div className="membrowser-empty-title">No memories found</div>
      <div className="membrowser-empty-desc">
        {search
          ? `No results for "${search}"${type !== 'all' ? ` in ${type} memories` : ''}.`
          : type !== 'all'
            ? `No ${type} memories recorded yet.`
            : 'No memories have been recorded yet.'}
      </div>
    </div>
  );
}

// ── Main Component ──

const PAGE_SIZE = 50;

export default function MemoryBrowserTab() {
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [memories, setMemories] = useState<ApiMemory[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeType, setActiveType] = useState<MemoryType>('all');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Fetch stats
  const fetchStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const res = await fetch('/api/v1/forge/fleet/stats', { credentials: 'include' });
      if (!res.ok) throw new Error(`Stats request failed: ${res.status}`);
      const data = await res.json();
      // API returns { tiers: { semantic, episodic, procedural }, total, recent24h }
      setStats({
        semantic: data.tiers?.semantic ?? data.semantic ?? 0,
        episodic: data.tiers?.episodic ?? data.episodic ?? 0,
        procedural: data.tiers?.procedural ?? data.procedural ?? 0,
        total: data.total ?? 0,
      });
    } catch (err) {
      console.error('Failed to fetch memory stats:', err);
    } finally {
      setStatsLoading(false);
    }
  }, []);

  // Fetch memories (browse or search)
  const fetchMemories = useCallback(async (
    type: MemoryType,
    query: string,
    pageOffset: number,
    append: boolean,
  ) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      let url: string;
      if (query) {
        const params = new URLSearchParams({ q: query, limit: '20' });
        if (type !== 'all') params.set('tier', type);
        url = `/api/v1/forge/fleet/search?${params}`;
      } else {
        const page = Math.floor(pageOffset / PAGE_SIZE) + 1;
        const params = new URLSearchParams({
          limit: String(PAGE_SIZE),
          page: String(page),
        });
        if (type !== 'all') params.set('tier', type);
        url = `/api/v1/forge/fleet/recent?${params}`;
      }

      const res = await fetch(url, {
        credentials: 'include',
        signal: controller.signal,
      });

      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      const data = await res.json();
      const items: ApiMemory[] = data.memories ?? [];

      if (append) {
        setMemories((prev) => [...prev, ...items]);
      } else {
        setMemories(items);
      }

      setHasMore(!query && items.length >= PAGE_SIZE);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  // Refetch when type or search changes
  useEffect(() => {
    setOffset(0);
    setHasMore(true);
    fetchMemories(activeType, search, 0, false);
  }, [activeType, search, fetchMemories]);

  // Search submit
  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearch(searchInput.trim());
  };

  // Clear search
  const handleClearSearch = () => {
    setSearchInput('');
    setSearch('');
  };

  // Load more
  const handleLoadMore = () => {
    const nextOffset = offset + PAGE_SIZE;
    setOffset(nextOffset);
    fetchMemories(activeType, search, nextOffset, true);
  };

  // Type tabs
  const typeTabs: { key: MemoryType; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'semantic', label: 'Semantic' },
    { key: 'episodic', label: 'Episodic' },
    { key: 'procedural', label: 'Procedural' },
  ];

  return (
    <div className="membrowser-tab">
      {/* Header */}
      <div className="membrowser-header">
        <div className="membrowser-title-row">
          <span className="membrowser-icon">&#x1F9E0;</span>
          <h2 className="membrowser-title">Memory Browser</h2>
        </div>
        <p className="membrowser-subtitle">Browse &middot; Search &middot; Inspect</p>
      </div>

      {/* Scrollable content */}
      <div className="membrowser-content-area">
        {/* Stats */}
        <StatsBar stats={stats} loading={statsLoading} />

        {/* Search bar */}
        <form className="membrowser-search-form" onSubmit={handleSearch}>
          <div className="membrowser-search-wrap">
            <input
              className="membrowser-search"
              type="search"
              placeholder="Search across all memory types..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              aria-label="Search memories"
            />
            {search && (
              <button
                type="button"
                className="membrowser-search-clear"
                onClick={handleClearSearch}
                aria-label="Clear search"
              >
                &times;
              </button>
            )}
          </div>
          <button type="submit" className="membrowser-btn primary" disabled={loading}>
            Search
          </button>
        </form>

        {/* Panel */}
        <div className="membrowser-panel">
          {/* Type tabs */}
          <div className="membrowser-type-tabs" role="tablist" aria-label="Memory type filter">
            {typeTabs.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={activeType === t.key}
                className={`membrowser-type-tab ${activeType === t.key ? 'active' : ''}`}
                onClick={() => setActiveType(t.key)}
              >
                {t.label}
                {stats && t.key !== 'all' && (
                  <span className="membrowser-tab-count">
                    {stats[t.key as keyof Omit<MemoryStats, 'total'>]}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Memory list */}
          <div className="membrowser-list">
            {error && (
              <div className="membrowser-error">
                Failed to load memories: {error}
              </div>
            )}

            {!loading && !error && memories.length === 0 && (
              <EmptyState search={search} type={activeType} />
            )}

            {memories.map((m) => (
              <MemoryCard key={m.id} memory={m} />
            ))}

            {loading && (
              <div className="membrowser-loading">
                <div className="membrowser-spinner" />
                <span>Loading memories...</span>
              </div>
            )}

            {!loading && hasMore && memories.length > 0 && !search && (
              <div className="membrowser-load-more-wrap">
                <button
                  className="membrowser-btn"
                  onClick={handleLoadMore}
                  disabled={loading}
                >
                  Load More
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
