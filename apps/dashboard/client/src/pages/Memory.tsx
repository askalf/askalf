import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AdminAssistantPanel from '../components/admin/AdminAssistantPanel';
import './Memory.css';

// ============================================
// TYPES
// ============================================

interface Shard {
  id: string;
  name: string;
  description?: string;
  confidence: number;
  lifecycle: 'candidate' | 'testing' | 'shadow' | 'promoted' | 'archived' | 'resurrected';
  visibility: 'public' | 'private' | 'organization';
  executionCount: number;
  successRate: number;
  successCount: number;
  failureCount: number;
  isOwned: boolean;
  category?: string;
  shardType?: string;
  createdAt: string;
  updatedAt?: string;
  intentTemplate?: string;
  knowledgeType?: string;
  verificationStatus?: string;
  sourceTraceIds?: string[];
  sourceUrl?: string;
  sourceType?: string;
}

interface ShardDetail extends Shard {
  patterns: string[];
  patternHash: string;
  logic: string;
  synthesisMethod?: string;
  tokensSaved?: number;
  avgLatencyMs?: number;
  lastExecuted?: string;
  ownerId?: string;
  recentExecutions: Array<{
    id: string;
    success: boolean;
    executionMs: number;
    error?: string;
    createdAt: string;
  }>;
}

interface Episode {
  id: string;
  type: string;
  summary: string;
  success: boolean | null;
  valence: string;
  importance: number;
  timestamp: string;
  sessionId?: string;
  relatedShardId?: string;
}

interface EpisodeDetail extends Episode {
  situation: {
    context: string;
    entities: string[];
    state: Record<string, unknown>;
  };
  action: {
    type: string;
    description: string;
    parameters: Record<string, unknown>;
  };
  outcome: {
    result: string;
    success: boolean;
    effects: string[];
    metrics: Record<string, unknown>;
  };
  lessonsLearned: string[];
  metadata: Record<string, unknown>;
}

interface Fact {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  statement: string;
  confidence: number;
  category: string;
  source?: string;
  visibility?: string;
  createdAt: string;
  updatedAt?: string;
}

interface WorkingContext {
  id: string;
  sessionId: string;
  agentId?: string;
  contentType: string;
  status: 'raw' | 'processing' | 'liquidated' | 'promoted' | 'archived';
  rawContentPreview?: string;
  originalTokens: number;
  liquidatedTokens: number;
  compressionRatio: number;
  ttlSeconds?: number;
  createdAt: string;
  expiresAt: string | null;
}

interface ContextDetail extends WorkingContext {
  rawContent: string;
  extractedFacts?: Record<string, unknown>[];
  extractedEntities?: string[];
  noiseRemoved?: string[];
  updatedAt?: string;
}

interface Trace {
  id: string;
  input: string;
  output: string;
  intentTemplate: string;
  intentCategory: string;
  intentName: string;
  tokensUsed: number;
  model: string | null;
  sessionId: string | null;
  visibility: string;
  synthesized: boolean;
  timestamp: string;
}

interface TraceDetail extends Trace {
  intentHash?: string;
  templateHash?: string;
  embedding?: number[];
  metadata?: Record<string, unknown>;
}

interface Stats {
  shards: { total: number; promoted: number; testing: number };
  traces: number;
  episodes: number;
  facts: number;
  contexts: number;
}

const API_BASE = window.location.hostname.includes('askalf.org')
  ? 'https://api.askalf.org'
  : 'http://localhost:3000';

type MemoryTier = 'procedural' | 'episodic' | 'semantic' | 'working';
type LifecycleFilter = 'all' | 'promoted' | 'testing' | 'candidate' | 'shadow' | 'archived';

const TIER_INFO = {
  procedural: { name: 'Procedural', icon: '\u26A1', desc: 'Logic Shards & Reasoning Traces - Executable patterns and learning data' },
  episodic: { name: 'Episodic', icon: '\uD83D\uDCD6', desc: 'SAO Chains - Situation-Action-Outcome memories' },
  semantic: { name: 'Semantic', icon: '\uD83D\uDCDA', desc: 'Truth Store - Verified knowledge facts' },
  working: { name: 'Working', icon: '\uD83E\uDDE0', desc: 'Context Liquidation - Active session memory' },
};

// Categories loaded dynamically from API

export default function Memory() {
  const navigate = useNavigate();
  const [activeTier, setActiveTier] = useState<MemoryTier>('procedural');
  const [stats, setStats] = useState<Stats | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [assistantOpen, setAssistantOpen] = useState(false);

  // Procedural state
  const [shards, setShards] = useState<Shard[]>([]);
  const [shardsLoading, setShardsLoading] = useState(true);
  const [lifecycle, setLifecycle] = useState<LifecycleFilter>('all');
  const [selectedShard, setSelectedShard] = useState<ShardDetail | null>(null);
  const [shardPage, setShardPage] = useState(1);
  const [shardTotal, setShardTotal] = useState(0);
  const [shardCategory, setShardCategory] = useState('all');
  const [shardCategories, setShardCategories] = useState<Array<{ value: string; count: number }>>([]);
  const SHARDS_PER_PAGE = 50;

  // Traces state
  const [traces, setTraces] = useState<Trace[]>([]);
  const [tracesLoading, setTracesLoading] = useState(false);
  const [showTraces, setShowTraces] = useState(false);
  const [selectedTrace, setSelectedTrace] = useState<TraceDetail | null>(null);
  const [tracePage, setTracePage] = useState(1);
  const [traceTotal, setTraceTotal] = useState(0);
  const TRACES_PER_PAGE = 50;

  // Episodic state
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [episodesLoading, setEpisodesLoading] = useState(false);
  const [selectedEpisode, setSelectedEpisode] = useState<EpisodeDetail | null>(null);
  const [episodeFilter, setEpisodeFilter] = useState<'all' | 'positive' | 'negative'>('all');
  const [episodePage, setEpisodePage] = useState(1);
  const [episodeTotal, setEpisodeTotal] = useState(0);
  const EPISODES_PER_PAGE = 50;

  // Semantic state
  const [facts, setFacts] = useState<Fact[]>([]);
  const [factsLoading, setFactsLoading] = useState(false);
  const [selectedFact, setSelectedFact] = useState<Fact | null>(null);
  const [factCategory, setFactCategory] = useState('all');
  const [factCategories, setFactCategories] = useState<Array<{ value: string; count: number }>>([]);
  const [factPage, setFactPage] = useState(1);
  const [factTotal, setFactTotal] = useState(0);
  const FACTS_PER_PAGE = 50;

  // Working state
  const [contexts, setContexts] = useState<WorkingContext[]>([]);
  const [contextsLoading, setContextsLoading] = useState(false);
  const [selectedContext, setSelectedContext] = useState<ContextDetail | null>(null);
  const [contextFilter, setContextFilter] = useState<'all' | 'raw' | 'liquidated' | 'promoted'>('all');
  const [contextPage, setContextPage] = useState(1);
  const [contextTotal, setContextTotal] = useState(0);
  const CONTEXTS_PER_PAGE = 50;

  // Load stats + categories on mount
  useEffect(() => {
    fetchStats();
    fetch(`${API_BASE}/api/v1/facts/categories`, { credentials: 'include' })
      .then(res => res.json())
      .then(data => setFactCategories(data.categories || []))
      .catch(() => {});
    fetch(`${API_BASE}/api/v1/shards/categories`, { credentials: 'include' })
      .then(res => res.json())
      .then(data => setShardCategories(data.categories || []))
      .catch(() => {});
  }, []);

  // Reset pages when filters change
  useEffect(() => { setShardPage(1); }, [lifecycle, shardCategory]);
  useEffect(() => { setEpisodePage(1); }, [episodeFilter]);
  useEffect(() => { setFactPage(1); }, [factCategory]);
  useEffect(() => { setContextPage(1); }, [contextFilter]);

  // Load data when tier changes
  useEffect(() => {
    switch (activeTier) {
      case 'procedural':
        if (showTraces) fetchTraces();
        else fetchShards();
        break;
      case 'episodic':
        fetchEpisodes();
        break;
      case 'semantic':
        fetchFacts();
        break;
      case 'working':
        fetchContexts();
        break;
    }
  }, [activeTier, lifecycle, showTraces, episodeFilter, factCategory, contextFilter, shardPage, tracePage, episodePage, factPage, contextPage, shardCategory]);

  // ============================================
  // API CALLS (read-only)
  // ============================================

  const fetchStats = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/stats`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setStats({
          shards: {
            total: data.procedural?.shards?.total || 0,
            promoted: data.procedural?.shards?.promoted || 0,
            testing: data.procedural?.shards?.testing || 0,
          },
          traces: data.procedural?.traces?.total || 0,
          episodes: data.episodic?.total || 0,
          facts: data.semantic?.facts || 0,
          contexts: data.working?.total || 0,
        });
      }
    } catch (err) {
      console.error('Failed to fetch stats:', err);
    }
  };

  const fetchShards = async () => {
    setShardsLoading(true);
    try {
      const offset = (shardPage - 1) * SHARDS_PER_PAGE;
      let url = `${API_BASE}/api/v1/shards?lifecycle=${lifecycle}&limit=${SHARDS_PER_PAGE}&offset=${offset}`;
      if (shardCategory !== 'all') url += `&category=${shardCategory}`;
      const res = await fetch(url, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setShards(data.shards || []);
        setShardTotal(data.total || 0);
      }
    } catch (err) {
      console.error('Failed to fetch shards:', err);
    } finally {
      setShardsLoading(false);
    }
  };

  const fetchShardDetail = async (id: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/shards/${id}`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setSelectedShard({ ...data.shard, recentExecutions: data.executions || [] });
      }
    } catch (err) {
      console.error('Failed to fetch shard detail:', err);
    }
  };

  const fetchTraces = async () => {
    setTracesLoading(true);
    try {
      const traceOffset = (tracePage - 1) * TRACES_PER_PAGE;
      const res = await fetch(`${API_BASE}/api/v1/traces?limit=${TRACES_PER_PAGE}&offset=${traceOffset}`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setTraces(data.traces || []);
        setTraceTotal(data.total || 0);
      }
    } catch (err) {
      console.error('Failed to fetch traces:', err);
    } finally {
      setTracesLoading(false);
    }
  };

  const fetchTraceDetail = async (id: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/traces/${id}`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setSelectedTrace(data.trace);
      }
    } catch (err) {
      console.error('Failed to fetch trace detail:', err);
    }
  };

  const fetchEpisodes = async () => {
    setEpisodesLoading(true);
    try {
      const epOffset = (episodePage - 1) * EPISODES_PER_PAGE;
      let url = `${API_BASE}/api/v1/episodes?limit=${EPISODES_PER_PAGE}&offset=${epOffset}`;
      if (episodeFilter !== 'all') url += `&valence=${episodeFilter}`;
      const res = await fetch(url, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setEpisodes(data.episodes || []);
        setEpisodeTotal(data.total || 0);
      }
    } catch (err) {
      console.error('Failed to fetch episodes:', err);
    } finally {
      setEpisodesLoading(false);
    }
  };

  const fetchEpisodeDetail = async (id: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/episodes/${id}`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setSelectedEpisode(data.episode);
      }
    } catch (err) {
      console.error('Failed to fetch episode detail:', err);
    }
  };

  const fetchFacts = async () => {
    setFactsLoading(true);
    try {
      const fOffset = (factPage - 1) * FACTS_PER_PAGE;
      let url = `${API_BASE}/api/v1/facts?limit=${FACTS_PER_PAGE}&offset=${fOffset}`;
      if (factCategory !== 'all') url += `&category=${factCategory}`;
      const res = await fetch(url, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setFacts(data.facts || []);
        setFactTotal(data.total || 0);
      }
    } catch (err) {
      console.error('Failed to fetch facts:', err);
    } finally {
      setFactsLoading(false);
    }
  };

  const fetchContexts = async () => {
    setContextsLoading(true);
    try {
      const cOffset = (contextPage - 1) * CONTEXTS_PER_PAGE;
      let url = `${API_BASE}/api/v1/contexts?limit=${CONTEXTS_PER_PAGE}&offset=${cOffset}`;
      if (contextFilter !== 'all') url += `&status=${contextFilter}`;
      const res = await fetch(url, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setContexts(data.contexts || []);
        setContextTotal(data.total || 0);
      }
    } catch (err) {
      console.error('Failed to fetch contexts:', err);
    } finally {
      setContextsLoading(false);
    }
  };

  const fetchContextDetail = async (id: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/contexts/${id}`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setSelectedContext(data.context);
      }
    } catch (err) {
      console.error('Failed to fetch context detail:', err);
    }
  };

  // ============================================
  // HELPERS
  // ============================================

  const formatDate = (d: string) => (d ? new Date(d).toLocaleString() : '-');
  const formatDateShort = (d: string) => (d ? new Date(d).toLocaleDateString() : '-');

  const lifecycleBadgeClass = (l: string) => {
    switch (l) {
      case 'promoted': return 'badge-success';
      case 'candidate': return 'badge-blue';
      case 'testing': case 'shadow': return 'badge-purple';
      case 'archived': return 'badge-warning';
      default: return 'badge-purple';
    }
  };

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

  const filteredEpisodes = episodes.filter((e) =>
    matchesSearch(`${e.type} ${e.summary}`)
  );

  const filteredFacts = facts.filter((f) =>
    matchesSearch(`${f.subject} ${f.predicate} ${f.object} ${f.statement}`)
  );

  const filteredContexts = contexts.filter((c) =>
    matchesSearch(`${c.sessionId} ${c.contentType} ${c.status}`)
  );

  const refreshCurrentTier = () => {
    fetchStats();
    switch (activeTier) {
      case 'procedural': showTraces ? fetchTraces() : fetchShards(); break;
      case 'episodic': fetchEpisodes(); break;
      case 'semantic': fetchFacts(); break;
      case 'working': fetchContexts(); break;
    }
  };

  // ============================================
  // PAGINATION
  // ============================================

  const totalPages = Math.ceil(shardTotal / SHARDS_PER_PAGE);
  const pageNumbers: number[] = [];
  const maxVisible = 7;
  let pageStart = Math.max(1, shardPage - 3);
  let pageEnd = Math.min(totalPages, pageStart + maxVisible - 1);
  if (pageEnd - pageStart < maxVisible - 1) pageStart = Math.max(1, pageEnd - maxVisible + 1);
  for (let i = pageStart; i <= pageEnd; i++) pageNumbers.push(i);

  const traceTotalPages = Math.ceil(traceTotal / TRACES_PER_PAGE);
  const tracePageNumbers: number[] = [];
  let tracePageStart = Math.max(1, tracePage - 3);
  let tracePageEnd = Math.min(traceTotalPages, tracePageStart + maxVisible - 1);
  if (tracePageEnd - tracePageStart < maxVisible - 1) tracePageStart = Math.max(1, tracePageEnd - maxVisible + 1);
  for (let i = tracePageStart; i <= tracePageEnd; i++) tracePageNumbers.push(i);

  const episodeTotalPages = Math.ceil(episodeTotal / EPISODES_PER_PAGE);
  const episodePageNumbers: number[] = [];
  let epPageStart = Math.max(1, episodePage - 3);
  let epPageEnd = Math.min(episodeTotalPages, epPageStart + maxVisible - 1);
  if (epPageEnd - epPageStart < maxVisible - 1) epPageStart = Math.max(1, epPageEnd - maxVisible + 1);
  for (let i = epPageStart; i <= epPageEnd; i++) episodePageNumbers.push(i);

  const factTotalPages = Math.ceil(factTotal / FACTS_PER_PAGE);
  const factPageNumbers: number[] = [];
  let fPageStart = Math.max(1, factPage - 3);
  let fPageEnd = Math.min(factTotalPages, fPageStart + maxVisible - 1);
  if (fPageEnd - fPageStart < maxVisible - 1) fPageStart = Math.max(1, fPageEnd - maxVisible + 1);
  for (let i = fPageStart; i <= fPageEnd; i++) factPageNumbers.push(i);

  const contextTotalPages = Math.ceil(contextTotal / CONTEXTS_PER_PAGE);
  const contextPageNumbers: number[] = [];
  let cPageStart = Math.max(1, contextPage - 3);
  let cPageEnd = Math.min(contextTotalPages, cPageStart + maxVisible - 1);
  if (cPageEnd - cPageStart < maxVisible - 1) cPageStart = Math.max(1, cPageEnd - maxVisible + 1);
  for (let i = cPageStart; i <= cPageEnd; i++) contextPageNumbers.push(i);

  // ============================================
  // RENDER
  // ============================================

  return (
    <div className={`memory-page ${assistantOpen ? 'panel-open' : ''}`}>
     <div className="memory-main">
      {/* Header */}
      <div className="memory-header">
        <button className="memory-back-btn" onClick={() => navigate('/app/chat')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back
        </button>
        <div>
          <h1>{'\uD83E\uDDE0'} ALF Brain</h1>
          <p>4-Tier Cognitive Memory Architecture</p>
        </div>
        <button className="memory-refresh-btn" onClick={refreshCurrentTier}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M23 4v6h-6M1 20v-6h6" />
            <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
          </svg>
          Refresh
        </button>
        <button className={`admin-assistant-toggle ${assistantOpen ? 'active' : ''}`} onClick={() => setAssistantOpen(!assistantOpen)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2a3 3 0 0 0-3 3v1a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
            <path d="M19 10H5a2 2 0 0 0-2 2v1a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-1a2 2 0 0 0-2-2Z" />
            <path d="M12 15v4" />
            <path d="M8 19h8" />
          </svg>
          Assistant
        </button>
      </div>

      {/* Tier Tabs */}
      <div className="memory-tier-tabs">
        {(Object.keys(TIER_INFO) as MemoryTier[]).map((tier) => (
          <button
            key={tier}
            className={`tier-tab ${activeTier === tier ? 'active' : ''}`}
            onClick={() => { setActiveTier(tier); setShowTraces(false); setSearchQuery(''); }}
          >
            <span className="tier-icon">{TIER_INFO[tier].icon}</span>
            <span className="tier-name">{TIER_INFO[tier].name}</span>
          </button>
        ))}
      </div>

      {/* Tier Description */}
      <div className="tier-description">
        <span className="tier-desc-icon">{TIER_INFO[activeTier].icon}</span>
        <span>{TIER_INFO[activeTier].desc}</span>
      </div>

      {/* Stats Overview */}
      {stats && (
        <div className="memory-stats">
          <div className={`memory-stat ${activeTier === 'procedural' ? 'active' : ''}`} onClick={() => { setActiveTier('procedural'); setShowTraces(false); }}>
            <span className="stat-icon">{'\u26A1'}</span>
            <div className="stat-info">
              <span className="stat-value">{stats.shards.promoted}</span>
              <span className="stat-label">Shards ({stats.traces} traces)</span>
            </div>
          </div>
          <div className={`memory-stat ${activeTier === 'episodic' ? 'active' : ''}`} onClick={() => { setActiveTier('episodic'); setShowTraces(false); }}>
            <span className="stat-icon">{'\uD83D\uDCD6'}</span>
            <div className="stat-info">
              <span className="stat-value">{stats.episodes}</span>
              <span className="stat-label">Episodes</span>
            </div>
          </div>
          <div className={`memory-stat ${activeTier === 'semantic' ? 'active' : ''}`} onClick={() => { setActiveTier('semantic'); setShowTraces(false); }}>
            <span className="stat-icon">{'\uD83D\uDCDA'}</span>
            <div className="stat-info">
              <span className="stat-value">{stats.facts}</span>
              <span className="stat-label">Facts</span>
            </div>
          </div>
          <div className={`memory-stat ${activeTier === 'working' ? 'active' : ''}`} onClick={() => { setActiveTier('working'); setShowTraces(false); }}>
            <span className="stat-icon">{'\uD83E\uDDE0'}</span>
            <div className="stat-info">
              <span className="stat-value">{stats.contexts}</span>
              <span className="stat-label">Contexts</span>
            </div>
          </div>
        </div>
      )}

      {/* ============================================
          PROCEDURAL TIER
          ============================================ */}
      {activeTier === 'procedural' && (
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
                ? `${traceTotal} traces${traceTotal > TRACES_PER_PAGE ? ` (page ${tracePage} of ${traceTotalPages})` : ''}`
                : `${shardTotal} shards${shardTotal > SHARDS_PER_PAGE ? ` (page ${shardPage} of ${totalPages})` : ''}`
              }
            </span>
          </div>

          {/* Shards Card Grid */}
          {!showTraces && (
            shardsLoading ? (
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

          {/* Shard Pagination */}
          {!showTraces && shardTotal > SHARDS_PER_PAGE && (
            <div className="brain-pagination">
              <button
                className="pagination-btn"
                disabled={shardPage <= 1}
                onClick={() => setShardPage(p => p - 1)}
              >
                Prev
              </button>
              {pageNumbers.map(num => (
                <button
                  key={num}
                  className={`pagination-btn ${num === shardPage ? 'active' : ''}`}
                  onClick={() => setShardPage(num)}
                >
                  {num}
                </button>
              ))}
              <button
                className="pagination-btn"
                disabled={shardPage >= totalPages}
                onClick={() => setShardPage(p => p + 1)}
              >
                Next
              </button>
            </div>
          )}

          {/* Traces Card Grid */}
          {showTraces && (
            tracesLoading ? (
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

          {/* Trace Pagination */}
          {showTraces && traceTotal > TRACES_PER_PAGE && (
            <div className="brain-pagination">
              <button
                className="pagination-btn"
                disabled={tracePage <= 1}
                onClick={() => setTracePage(p => p - 1)}
              >
                Prev
              </button>
              {tracePageNumbers.map(num => (
                <button
                  key={num}
                  className={`pagination-btn ${num === tracePage ? 'active' : ''}`}
                  onClick={() => setTracePage(num)}
                >
                  {num}
                </button>
              ))}
              <button
                className="pagination-btn"
                disabled={tracePage >= traceTotalPages}
                onClick={() => setTracePage(p => p + 1)}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}

      {/* ============================================
          EPISODIC TIER
          ============================================ */}
      {activeTier === 'episodic' && (
        <>
          <div className="memory-filters">
            <div className="filter-group">
              <label>Valence:</label>
              <div className="filter-buttons">
                {(['all', 'positive', 'negative'] as const).map((v) => (
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
              {episodeTotal} episodes{episodeTotal > EPISODES_PER_PAGE ? ` (page ${episodePage} of ${episodeTotalPages})` : ''}
            </span>
          </div>

          {episodesLoading ? (
            <div className="brain-loading">Loading episodes...</div>
          ) : filteredEpisodes.length === 0 ? (
            <div className="brain-empty">No episodes found</div>
          ) : (
            <div className="brain-card-grid">
              {filteredEpisodes.map((ep) => (
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

          {episodeTotal > EPISODES_PER_PAGE && (
            <div className="brain-pagination">
              <button className="pagination-btn" disabled={episodePage <= 1} onClick={() => setEpisodePage(p => p - 1)}>Prev</button>
              {episodePageNumbers.map(num => (
                <button key={num} className={`pagination-btn ${num === episodePage ? 'active' : ''}`} onClick={() => setEpisodePage(num)}>{num}</button>
              ))}
              <button className="pagination-btn" disabled={episodePage >= episodeTotalPages} onClick={() => setEpisodePage(p => p + 1)}>Next</button>
            </div>
          )}
        </>
      )}

      {/* ============================================
          SEMANTIC TIER
          ============================================ */}
      {activeTier === 'semantic' && (
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
              {factTotal} facts{factTotal > FACTS_PER_PAGE ? ` (page ${factPage} of ${factTotalPages})` : ''}
            </span>
          </div>

          {factsLoading ? (
            <div className="brain-loading">Loading facts...</div>
          ) : filteredFacts.length === 0 ? (
            <div className="brain-empty">No facts found</div>
          ) : (
            <div className="brain-card-grid">
              {filteredFacts.map((fact) => (
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

          {factTotal > FACTS_PER_PAGE && (
            <div className="brain-pagination">
              <button className="pagination-btn" disabled={factPage <= 1} onClick={() => setFactPage(p => p - 1)}>Prev</button>
              {factPageNumbers.map(num => (
                <button key={num} className={`pagination-btn ${num === factPage ? 'active' : ''}`} onClick={() => setFactPage(num)}>{num}</button>
              ))}
              <button className="pagination-btn" disabled={factPage >= factTotalPages} onClick={() => setFactPage(p => p + 1)}>Next</button>
            </div>
          )}
        </>
      )}

      {/* ============================================
          WORKING TIER
          ============================================ */}
      {activeTier === 'working' && (
        <>
          <div className="memory-filters">
            <div className="filter-group">
              <label>Status:</label>
              <div className="filter-buttons">
                {(['all', 'raw', 'liquidated', 'promoted'] as const).map((s) => (
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
              {contextTotal} contexts{contextTotal > CONTEXTS_PER_PAGE ? ` (page ${contextPage} of ${contextTotalPages})` : ''}
            </span>
          </div>

          {contextsLoading ? (
            <div className="brain-loading">Loading contexts...</div>
          ) : filteredContexts.length === 0 ? (
            <div className="brain-empty">No active contexts found</div>
          ) : (
            <div className="brain-card-grid">
              {filteredContexts.map((ctx) => (
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

          {contextTotal > CONTEXTS_PER_PAGE && (
            <div className="brain-pagination">
              <button className="pagination-btn" disabled={contextPage <= 1} onClick={() => setContextPage(p => p - 1)}>Prev</button>
              {contextPageNumbers.map(num => (
                <button key={num} className={`pagination-btn ${num === contextPage ? 'active' : ''}`} onClick={() => setContextPage(num)}>{num}</button>
              ))}
              <button className="pagination-btn" disabled={contextPage >= contextTotalPages} onClick={() => setContextPage(p => p + 1)}>Next</button>
            </div>
          )}
        </>
      )}

      {/* ============================================
          SHARD DETAIL MODAL (read-only)
          ============================================ */}
      {selectedShard && (
        <div className="modal-overlay" onClick={() => setSelectedShard(null)}>
          <div className="modal-content large" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{'\u26A1'} {selectedShard.name}</h2>
              <button className="modal-close" onClick={() => setSelectedShard(null)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
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
      )}

      {/* ============================================
          TRACE DETAIL MODAL (read-only)
          ============================================ */}
      {selectedTrace && (
        <div className="modal-overlay" onClick={() => setSelectedTrace(null)}>
          <div className="modal-content large" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{'\uD83D\uDCCA'} Trace Detail</h2>
              <button className="modal-close" onClick={() => setSelectedTrace(null)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="modal-body">
              <div className="detail-grid">
                <div className="detail-item">
                  <span className="detail-label">ID</span>
                  <span className="detail-value mono">{selectedTrace.id}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Intent</span>
                  <span className="badge badge-purple">{selectedTrace.intentName || 'unknown'}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Category</span>
                  <span className="badge badge-blue">{selectedTrace.intentCategory || '-'}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Synthesized</span>
                  <span className={`badge ${selectedTrace.synthesized ? 'badge-success' : 'badge-warning'}`}>{selectedTrace.synthesized ? 'Yes' : 'No'}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Tokens Used</span>
                  <span className="detail-value">{selectedTrace.tokensUsed || '-'}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Model</span>
                  <span className="detail-value mono">{selectedTrace.model || '-'}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Session</span>
                  <span className="detail-value mono">{selectedTrace.sessionId || '-'}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Timestamp</span>
                  <span className="detail-value">{formatDate(selectedTrace.timestamp)}</span>
                </div>
              </div>

              <div className="detail-section">
                <h4>Intent Template</h4>
                <code className="code-block">{selectedTrace.intentTemplate || '-'}</code>
              </div>

            </div>
          </div>
        </div>
      )}

      {/* ============================================
          EPISODE DETAIL MODAL (read-only)
          ============================================ */}
      {selectedEpisode && (
        <div className="modal-overlay" onClick={() => setSelectedEpisode(null)}>
          <div className="modal-content large" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{'\uD83D\uDCD6'} Episode Detail</h2>
              <button className="modal-close" onClick={() => setSelectedEpisode(null)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="modal-body">
              <div className="detail-grid">
                <div className="detail-item">
                  <span className="detail-label">ID</span>
                  <span className="detail-value mono">{selectedEpisode.id}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Type</span>
                  <span className="badge badge-blue">{selectedEpisode.type}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Valence</span>
                  <span className={`badge ${selectedEpisode.valence === 'positive' ? 'badge-success' : selectedEpisode.valence === 'negative' ? 'badge-warning' : 'badge-purple'}`}>{selectedEpisode.valence}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Importance</span>
                  <span className="detail-value">{(selectedEpisode.importance * 100).toFixed(0)}%</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Success</span>
                  <span className="detail-value">{selectedEpisode.success === true ? '\u2713 Yes' : selectedEpisode.success === false ? '\u2717 No' : '-'}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Timestamp</span>
                  <span className="detail-value">{formatDate(selectedEpisode.timestamp)}</span>
                </div>
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
      )}

      {/* ============================================
          FACT DETAIL MODAL (read-only)
          ============================================ */}
      {selectedFact && (
        <div className="modal-overlay" onClick={() => setSelectedFact(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{'\uD83D\uDCDA'} Fact Detail</h2>
              <button className="modal-close" onClick={() => setSelectedFact(null)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
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
                <div className="detail-item">
                  <span className="detail-label">ID</span>
                  <span className="detail-value mono">{selectedFact.id}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Confidence</span>
                  <span className={`detail-value ${selectedFact.confidence >= 0.8 ? 'success-rate-high' : 'success-rate-mid'}`}>{(selectedFact.confidence * 100).toFixed(0)}%</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Category</span>
                  <span className="badge badge-purple">{selectedFact.category}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Created</span>
                  <span className="detail-value">{formatDate(selectedFact.createdAt)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============================================
          CONTEXT DETAIL MODAL (read-only)
          ============================================ */}
      {selectedContext && (
        <div className="modal-overlay" onClick={() => setSelectedContext(null)}>
          <div className="modal-content large" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{'\uD83E\uDDE0'} Context Detail</h2>
              <button className="modal-close" onClick={() => setSelectedContext(null)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="modal-body">
              <div className="detail-grid">
                <div className="detail-item">
                  <span className="detail-label">ID</span>
                  <span className="detail-value mono">{selectedContext.id}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Session</span>
                  <span className="detail-value mono">{selectedContext.sessionId}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Type</span>
                  <span className="badge badge-blue">{selectedContext.contentType}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Status</span>
                  <span className={`badge ${selectedContext.status === 'promoted' ? 'badge-success' : selectedContext.status === 'liquidated' ? 'badge-purple' : 'badge-warning'}`}>{selectedContext.status}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Original Tokens</span>
                  <span className="detail-value">{selectedContext.originalTokens}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Liquidated Tokens</span>
                  <span className="detail-value">{selectedContext.liquidatedTokens || '-'}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Compression</span>
                  <span className="detail-value">{selectedContext.compressionRatio ? `${(selectedContext.compressionRatio * 100).toFixed(0)}%` : '-'}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Expires</span>
                  <span className="detail-value">{selectedContext.expiresAt ? formatDate(selectedContext.expiresAt) : 'Never'}</span>
                </div>
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
      )}
     </div>

      <AdminAssistantPanel
        isOpen={assistantOpen}
        onToggle={() => setAssistantOpen(!assistantOpen)}
        activeTier={activeTier}
        selectedItemId={selectedShard?.id || selectedEpisode?.id || selectedFact?.id || selectedContext?.id}
        pageContext="memory"
      />
    </div>
  );
}
