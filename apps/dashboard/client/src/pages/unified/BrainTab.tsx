import { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import TabBar from '../../components/TabBar';
import './BrainTab.css';

const MemoryBrowserTab = lazy(() => import('./MemoryBrowserTab'));
const GraphTab = lazy(() => import('./GraphTab'));

// ── Types ──

type SubTab = 'search' | 'teach' | 'browse' | 'graph' | 'analytics';

interface BrainCycle {
  cycle: string;
  intervalHours: number;
  lastRun: string | null;
  lastDurationMs: number;
  runCount: number;
  lastError: string | null;
  status: 'healthy' | 'stale' | 'failed' | 'unknown';
}

interface HotMemory {
  id: string;
  content: string;
  access_count: number;
  importance: number;
  agent_id: string;
}

interface BrainActivityData {
  cycles: BrainCycle[];
  memory: { semantic: number; episodic: number; procedural: number };
  activity: {
    created_last_24h: { semantic: number; episodic: number; procedural: number };
    hot_memories: HotMemory[];
    growth_trend: { hour: string; count: number }[];
    cross_agent_transfers: number;
  };
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

interface FleetStats {
  total: number;
  semantic: number;
  episodic: number;
  procedural: number;
  recent24h?: number;
}

interface LeaderboardEntry {
  agentId: string;
  name?: string;
  memoryCount: number;
}

// ── BrainActivityPanel sub-component ──

const CYCLE_STATUS_COLOR: Record<BrainCycle['status'], string> = {
  healthy: 'var(--status-healthy, #10b981)',
  stale: '#f59e0b',
  failed: 'var(--status-error, #ef4444)',
  unknown: 'var(--text-muted, #52525b)',
};

function BrainActivityPanel() {
  const [data, setData] = useState<BrainActivityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/admin/memory/brain-activity', { credentials: 'include' });
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      setData(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load brain activity');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) return <div className="brain-activity-loading">Loading brain activity...</div>;
  if (error) return (
    <div className="brain-activity-error">
      <span>{error}</span>
      <button className="brain-retry-btn" onClick={fetchData}>Retry</button>
    </div>
  );
  if (!data) return null;

  const hotMemories = (data.activity?.hot_memories ?? []).slice(0, 5);

  return (
    <div className="brain-activity-panel">
      {/* Cycle status */}
      <div className="brain-section">
        <h3 className="brain-section-title">Consolidation Cycles</h3>
        <div className="brain-cycles">
          {data.cycles.map((c) => (
            <div key={c.cycle} className="brain-cycle-row">
              <span
                className="brain-cycle-dot"
                style={{ background: CYCLE_STATUS_COLOR[c.status] }}
                title={c.status}
              />
              <span className="brain-cycle-name">{c.cycle}</span>
              <span className="brain-cycle-last">
                {timeAgo(c.lastRun)}
                {c.lastDurationMs > 0 && ` · ${c.lastDurationMs}ms`}
              </span>
              <span className="brain-cycle-count">{c.runCount}×</span>
              {c.lastError && (
                <span className="brain-cycle-error" title={c.lastError}>!</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Hot memories */}
      {hotMemories.length > 0 && (
        <div className="brain-section">
          <h3 className="brain-section-title">Hot Memories</h3>
          <div className="brain-hot-memories">
            {hotMemories.map((m) => (
              <div key={m.id} className="brain-hot-row">
                <span className="brain-hot-count">{m.access_count}×</span>
                <span className="brain-hot-content" title={m.content}>
                  {m.content.length > 120 ? m.content.slice(0, 120) + '…' : m.content}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── BrainAnalytics sub-component ──

function BrainAnalytics() {
  const [stats, setStats] = useState<FleetStats | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [statsRes, lbRes] = await Promise.all([
        fetch('/api/v1/forge/fleet/stats', { credentials: 'include' }),
        fetch('/api/v1/admin/fleet/leaderboard', { credentials: 'include' }),
      ]);

      if (!statsRes.ok) throw new Error(`Stats request failed: ${statsRes.status}`);
      if (!lbRes.ok) throw new Error(`Leaderboard request failed: ${lbRes.status}`);

      const statsData = await statsRes.json();
      const lbData = await lbRes.json();

      // API returns { tiers: { semantic, episodic, procedural }, total, recent24h: { semantic, episodic, procedural } }
      const tiers = statsData.tiers ?? statsData;
      const r24 = statsData.recent24h ?? {};
      const recent24hTotal = typeof r24 === 'number' ? r24 : ((r24.semantic ?? 0) + (r24.episodic ?? 0) + (r24.procedural ?? 0));
      setStats({
        total: statsData.total ?? 0,
        semantic: tiers.semantic ?? 0,
        episodic: tiers.episodic ?? 0,
        procedural: tiers.procedural ?? 0,
        recent24h: recent24hTotal,
      });

      const entries: LeaderboardEntry[] = (Array.isArray(lbData) ? lbData : lbData.agents ?? [])
        .map((a: Record<string, unknown>) => ({
          agentId: (a.agentId ?? a.agent_id ?? a.id ?? 'unknown') as string,
          name: (a.agentName ?? a.name ?? a.agentId ?? a.agent_id ?? 'unknown') as string,
          memoryCount: (a.memoryCount ?? a.memory_count ?? 0) as number,
        }))
        .sort((a: LeaderboardEntry, b: LeaderboardEntry) => b.memoryCount - a.memoryCount)
        .slice(0, 10);

      setLeaderboard(entries);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return <div className="brain-loading">Loading analytics...</div>;
  }

  if (error) {
    return (
      <div className="brain-analytics-error">
        <p>{error}</p>
        <button className="brain-retry-btn" onClick={fetchData}>Retry</button>
      </div>
    );
  }

  if (!stats) return null;

  const growthRate = stats.recent24h ?? 0;
  const tierTotal = stats.semantic + stats.episodic + stats.procedural;
  const semanticPct = tierTotal > 0 ? (stats.semantic / tierTotal) * 100 : 0;
  const episodicPct = tierTotal > 0 ? (stats.episodic / tierTotal) * 100 : 0;
  const proceduralPct = tierTotal > 0 ? (stats.procedural / tierTotal) * 100 : 0;

  const maxMemoryCount = leaderboard.length > 0
    ? Math.max(...leaderboard.map((e) => e.memoryCount))
    : 1;

  return (
    <div className="brain-analytics">
      {/* Summary cards */}
      <div className="brain-analytics-cards">
        <div className="brain-card">
          <span className="brain-card-label">Total Memories</span>
          <span className="brain-card-value">{stats.total.toLocaleString()}</span>
        </div>
        <div className="brain-card">
          <span className="brain-card-label">Last 24h</span>
          <span className="brain-card-value brain-card-growth">
            +{growthRate.toLocaleString()}
          </span>
        </div>
        <div className="brain-card">
          <span className="brain-card-label">Facts</span>
          <span className="brain-card-value">{stats.semantic.toLocaleString()}</span>
        </div>
        <div className="brain-card">
          <span className="brain-card-label">Experiences</span>
          <span className="brain-card-value">{stats.episodic.toLocaleString()}</span>
        </div>
        <div className="brain-card">
          <span className="brain-card-label">Patterns</span>
          <span className="brain-card-value">{stats.procedural.toLocaleString()}</span>
        </div>
      </div>

      {/* Tier breakdown bar */}
      <div className="brain-section">
        <h3 className="brain-section-title">Tier Breakdown</h3>
        <div className="brain-stacked-bar">
          {semanticPct > 0 && (
            <div
              className="brain-bar-segment brain-bar-semantic"
              style={{ width: `${semanticPct}%` }}
              title={`Semantic: ${stats.semantic.toLocaleString()} (${semanticPct.toFixed(1)}%)`}
            />
          )}
          {episodicPct > 0 && (
            <div
              className="brain-bar-segment brain-bar-episodic"
              style={{ width: `${episodicPct}%` }}
              title={`Episodic: ${stats.episodic.toLocaleString()} (${episodicPct.toFixed(1)}%)`}
            />
          )}
          {proceduralPct > 0 && (
            <div
              className="brain-bar-segment brain-bar-procedural"
              style={{ width: `${proceduralPct}%` }}
              title={`Procedural: ${stats.procedural.toLocaleString()} (${proceduralPct.toFixed(1)}%)`}
            />
          )}
        </div>
        <div className="brain-bar-legend">
          <span className="brain-legend-item"><span className="brain-legend-dot brain-bar-semantic" /> Facts</span>
          <span className="brain-legend-item"><span className="brain-legend-dot brain-bar-episodic" /> Experiences</span>
          <span className="brain-legend-item"><span className="brain-legend-dot brain-bar-procedural" /> Patterns</span>
        </div>
      </div>

      {/* Top memory sources */}
      {leaderboard.length > 0 && (
        <div className="brain-section">
          <h3 className="brain-section-title">Top Memory Sources</h3>
          <div className="brain-leaderboard">
            {leaderboard.map((entry) => (
              <div key={entry.agentId} className="brain-lb-row">
                <span className="brain-lb-name" title={entry.agentId}>
                  {entry.name || entry.agentId}
                </span>
                <div className="brain-lb-bar-track">
                  <div
                    className="brain-lb-bar-fill"
                    style={{ width: `${(entry.memoryCount / maxMemoryCount) * 100}%` }}
                  />
                </div>
                <span className="brain-lb-count">{entry.memoryCount.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Brain activity — cycles + hot memories */}
      <BrainActivityPanel />
    </div>
  );
}

// ── Ask Alf's Memory ──

function MemorySearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Array<{ content: string; similarity: number; tier: string }>>([]);
  const [searching, setSearching] = useState(false);
  const [stats, setStats] = useState<{ total: number; semantic: number; episodic: number; procedural: number } | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  // Load memory stats on mount
  useEffect(() => {
    fetch('/api/v1/forge/memory/stats', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setStats(data); })
      .catch(() => {});
  }, []);

  const handleSearch = useCallback(async () => {
    if (!query.trim()) return;
    setSearching(true);
    setHasSearched(true);
    try {
      const res = await fetch('/api/v1/forge/memory/search', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim(), limit: 20 }),
      });
      if (res.ok) {
        const data = await res.json() as { results?: Array<{ content: string; similarity: number; tier: string }> };
        setResults(data.results ?? []);
      }
    } catch { /* ignore */ }
    setSearching(false);
  }, [query]);

  const tierLabel = (t: string) => t === 'semantic' ? 'Fact' : t === 'episodic' ? 'Experience' : t === 'procedural' ? 'Pattern' : t;
  const tierColor = (t: string) => t === 'semantic' ? '#7c3aed' : t === 'episodic' ? '#3b82f6' : t === 'procedural' ? '#10b981' : '#6b7280';

  const suggestions = [
    'What do you know about our competitors?',
    'What patterns have you learned?',
    'What went wrong recently?',
    'What are our team preferences?',
    'Show me everything about security',
  ];

  return (
    <div style={{ padding: '1.5rem' }}>
      {/* Stats bar */}
      {stats && (
        <div style={{ display: 'flex', gap: '16px', marginBottom: '20px', padding: '14px 18px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text)' }}>{stats.total.toLocaleString()}</div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Total Memories</div>
          </div>
          {[
            { label: 'Facts', count: stats.semantic, color: '#7c3aed' },
            { label: 'Experiences', count: stats.episodic, color: '#3b82f6' },
            { label: 'Patterns', count: stats.procedural, color: '#10b981' },
          ].map(s => (
            <div key={s.label} style={{ flex: 1, borderLeft: '1px solid var(--border)', paddingLeft: '16px' }}>
              <div style={{ fontSize: '1.1rem', fontWeight: 700, color: s.color }}>{s.count.toLocaleString()}</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{s.label}</div>
            </div>
          ))}
        </div>
      )}

      <h3 style={{ margin: '0 0 4px', fontSize: '1rem', fontWeight: 700, color: 'var(--text)' }}>What does Alf know?</h3>
      <p style={{ margin: '0 0 16px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>Search Alf's memory using natural language — powered by semantic vector search</p>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSearch(); }}
          placeholder="Ask Alf anything..."
          style={{ flex: 1, padding: '12px 16px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px', color: 'var(--text)', fontSize: '0.9rem' }}
        />
        <button onClick={handleSearch} disabled={searching || !query.trim()}
          style={{ padding: '12px 24px', background: searching ? '#6d28d9' : '#7c3aed', color: '#fff', border: 'none', borderRadius: '10px', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer', transition: 'all 0.2s', opacity: !query.trim() ? 0.5 : 1 }}>
          {searching ? 'Searching...' : 'Search'}
        </button>
      </div>

      {/* Suggestion chips when no search yet */}
      {!hasSearched && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '16px' }}>
          {suggestions.map(s => (
            <button key={s} onClick={() => { setQuery(s); }}
              style={{ padding: '6px 12px', fontSize: '0.75rem', background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.2)', borderRadius: '16px', color: '#a78bfa', cursor: 'pointer', transition: 'all 0.15s' }}>
              {s}
            </button>
          ))}
        </div>
      )}

      {results.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '4px' }}>{results.length} memories found</div>
          {results.map((r, i) => (
            <div key={i} style={{ padding: '12px 16px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px', borderLeft: `3px solid ${tierColor(r.tier)}`, transition: 'border-color 0.2s' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                <span style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: tierColor(r.tier) }}>{tierLabel(r.tier)}</span>
                <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{(r.similarity * 100).toFixed(0)}% match</span>
              </div>
              <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text)', lineHeight: 1.6 }}>{r.content}</p>
            </div>
          ))}
        </div>
      ) : hasSearched && !searching ? (
        <div style={{ textAlign: 'center', padding: '3rem 1rem' }}>
          <div style={{ fontSize: '2rem', marginBottom: '8px', opacity: 0.4 }}>?</div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>No memories match that query</p>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', margin: '4px 0 0', opacity: 0.7 }}>Try different keywords or teach Alf something new</p>
        </div>
      ) : null}
    </div>
  );
}

// ── Teach Alf ──

function TeachAlf() {
  const [category, setCategory] = useState('fact');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [recentlyTaught, setRecentlyTaught] = useState<Array<{ content: string; category: string; time: string }>>([]);

  const categories = [
    { id: 'fact', label: 'Fact', icon: '\u{1F4D6}', desc: 'Things true about you or your business', color: '#7c3aed',
      examples: ['Our company name is Acme Corp', 'We use Stripe for payments', 'Our main competitor is WidgetCo', 'Support hours are 9-5 EST'] },
    { id: 'preference', label: 'Preference', icon: '\u{2728}', desc: 'How you like things done', color: '#3b82f6',
      examples: ['Use formal language in client emails', 'I prefer bullet points over paragraphs', 'Always include timestamps in reports', 'Use metric units'] },
    { id: 'pattern', label: 'Rule', icon: '\u{1F6E1}\u{FE0F}', desc: 'Rules to always follow', color: '#10b981',
      examples: ['Never contact clients on weekends', 'Always include pricing in proposals', 'Escalate billing issues to finance team', 'Back up data before any migration'] },
  ];

  const activeCategory = categories.find(c => c.id === category) || categories[0];

  const handleSave = useCallback(async () => {
    if (!content.trim()) return;
    setSaving(true);
    try {
      const tier = category === 'fact' ? 'semantic' : category === 'pattern' ? 'procedural' : 'semantic';
      const res = await fetch('/api/v1/forge/memory/store', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: content.trim(), tier, importance: 0.8, source: 'user_taught' }),
      });
      if (res.ok) {
        setMessage('Saved! Alf will remember this.');
        setRecentlyTaught(prev => [{ content: content.trim(), category, time: new Date().toLocaleTimeString() }, ...prev].slice(0, 5));
        setContent('');
        setTimeout(() => setMessage(null), 3000);
      }
    } catch { /* ignore */ }
    setSaving(false);
  }, [content, category]);

  return (
    <div style={{ padding: '1.5rem' }}>
      <h3 style={{ margin: '0 0 4px', fontSize: '1rem', fontWeight: 700, color: 'var(--text)' }}>Teach Alf</h3>
      <p style={{ margin: '0 0 20px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
        Add knowledge directly. Everything you teach here is embedded into Alf's memory and available to all workers.
      </p>

      {/* Category cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginBottom: '20px' }}>
        {categories.map(c => (
          <button key={c.id} onClick={() => setCategory(c.id)}
            style={{
              padding: '14px 16px', borderRadius: '10px', cursor: 'pointer', textAlign: 'left', transition: 'all 0.2s',
              border: category === c.id ? `1px solid ${c.color}40` : '1px solid var(--border)',
              background: category === c.id ? `${c.color}12` : 'var(--surface)',
            }}>
            <div style={{ fontSize: '1.1rem', marginBottom: '4px' }}>{c.icon}</div>
            <div style={{ fontSize: '0.85rem', fontWeight: 700, color: category === c.id ? c.color : 'var(--text)', marginBottom: '2px' }}>{c.label}</div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>{c.desc}</div>
          </button>
        ))}
      </div>

      {/* Input area */}
      <textarea
        value={content}
        onChange={e => setContent(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSave(); }}
        placeholder={`Type a ${activeCategory.label.toLowerCase()} to teach Alf...`}
        rows={3}
        style={{ width: '100%', padding: '12px 16px', background: 'var(--surface)', border: `1px solid ${content ? activeCategory.color + '40' : 'var(--border)'}`, borderRadius: '10px', color: 'var(--text)', fontSize: '0.85rem', resize: 'vertical', fontFamily: 'inherit', transition: 'border-color 0.2s' }}
      />

      {/* Quick examples */}
      {!content && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' }}>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginRight: '4px', lineHeight: '26px' }}>Try:</span>
          {activeCategory.examples.map(ex => (
            <button key={ex} onClick={() => setContent(ex)}
              style={{ padding: '4px 10px', fontSize: '0.72rem', background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.15)', borderRadius: '14px', color: '#a78bfa', cursor: 'pointer' }}>
              {ex}
            </button>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '14px' }}>
        <button onClick={handleSave} disabled={saving || !content.trim()}
          style={{ padding: '10px 24px', background: !content.trim() ? '#4c1d95' : '#7c3aed', color: '#fff', border: 'none', borderRadius: '10px', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer', opacity: !content.trim() ? 0.4 : 1, transition: 'all 0.2s' }}>
          {saving ? 'Saving...' : 'Teach Alf'}
        </button>
        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Ctrl+Enter to save</span>
        {message && <span style={{ fontSize: '0.82rem', color: '#10b981', fontWeight: 600 }}>{message}</span>}
      </div>

      {/* Recently taught */}
      {recentlyTaught.length > 0 && (
        <div style={{ marginTop: '24px' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>Recently Taught</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {recentlyTaught.map((item, i) => {
              const cat = categories.find(c => c.id === item.category);
              return (
                <div key={i} style={{ padding: '8px 12px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px', borderLeft: `3px solid ${cat?.color || '#7c3aed'}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text)' }}>{item.content.length > 80 ? item.content.slice(0, 80) + '...' : item.content}</span>
                  <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', marginLeft: '12px' }}>{item.time}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main BrainTab ──

export default function BrainTab() {
  const [subTab, setSubTab] = useState<SubTab>('search');

  return (
    <div className="ud-composite-tab brain-container">
      <TabBar
        tabs={[
          { key: 'search', label: 'Ask' },
          { key: 'teach', label: 'Teach Alf' },
          { key: 'browse', label: 'Browse' },
          { key: 'graph', label: 'Graph' },
          { key: 'analytics', label: 'Analytics' },
        ]}
        active={subTab}
        onChange={(k) => setSubTab(k as SubTab)}
        className="ud-sub-tabs"
        ariaLabel="Memory sections"
      />
      <div className="ud-sub-content brain-content">
        <Suspense fallback={<div className="brain-loading">Loading...</div>}>
          {subTab === 'search' && <MemorySearch />}
          {subTab === 'teach' && <TeachAlf />}
          {subTab === 'browse' && <MemoryBrowserTab />}
          {subTab === 'graph' && <GraphTab />}
          {subTab === 'analytics' && <BrainAnalytics />}
        </Suspense>
      </div>
    </div>
  );
}
