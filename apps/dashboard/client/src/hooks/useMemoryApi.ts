// Centralized API layer for Memory (Knowledge Layers) page

const API_BASE = window.location.hostname.includes('askalf.org')
  ? 'https://api.askalf.org'
  : 'http://localhost:3005';

async function apiFetch<T = unknown>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { credentials: 'include' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || res.statusText);
  }
  return res.json();
}

// ============================
// Types
// ============================

export interface Shard {
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

export interface ShardDetail extends Shard {
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

export interface Episode {
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

export interface EpisodeDetail extends Episode {
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

export interface Fact {
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

export interface WorkingContext {
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

export interface ContextDetail extends WorkingContext {
  rawContent: string;
  extractedFacts?: Record<string, unknown>[];
  extractedEntities?: string[];
  noiseRemoved?: string[];
  updatedAt?: string;
}

export interface Trace {
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

export interface TraceDetail extends Trace {
  intentHash?: string;
  templateHash?: string;
  embedding?: number[];
  metadata?: Record<string, unknown>;
}

export interface MemoryStats {
  shards: { total: number; promoted: number; testing: number };
  traces: number;
  episodes: number;
  facts: number;
  contexts: number;
}

export interface CategoryItem {
  value: string;
  count: number;
}

export type MemoryTier = 'procedural' | 'episodic' | 'semantic' | 'working';
export type LifecycleFilter = 'all' | 'promoted' | 'testing' | 'candidate' | 'shadow' | 'archived';
export type EpisodeFilter = 'all' | 'positive' | 'negative';
export type ContextFilterType = 'all' | 'raw' | 'liquidated' | 'promoted';

export const ITEMS_PER_PAGE = 50;

export const TIER_INFO: Record<MemoryTier, { name: string; icon: string; desc: string }> = {
  procedural: { name: 'Procedural', icon: '\u26A1', desc: 'Logic Shards & Reasoning Traces - Executable patterns and learning data' },
  episodic: { name: 'Episodic', icon: '\uD83D\uDCD6', desc: 'SAO Chains - Situation-Action-Outcome memories' },
  semantic: { name: 'Semantic', icon: '\uD83D\uDCDA', desc: 'Truth Store - Verified knowledge facts' },
  working: { name: 'Working', icon: '\uD83E\uDDE0', desc: 'Context Liquidation - Active session memory' },
};

// ============================
// API methods
// ============================

export const memoryApi = {
  getStats: async (): Promise<MemoryStats> => {
    const data = await apiFetch<Record<string, unknown>>('/api/v1/stats');
    const proc = data.procedural as Record<string, unknown> | undefined;
    const procShards = proc?.shards as Record<string, number> | undefined;
    const procTraces = proc?.traces as Record<string, number> | undefined;
    const ep = data.episodic as Record<string, number> | undefined;
    const sem = data.semantic as Record<string, number> | undefined;
    const wk = data.working as Record<string, number> | undefined;
    return {
      shards: {
        total: procShards?.total || 0,
        promoted: procShards?.promoted || 0,
        testing: procShards?.testing || 0,
      },
      traces: procTraces?.total || 0,
      episodes: ep?.total || 0,
      facts: sem?.facts || 0,
      contexts: wk?.total || 0,
    };
  },

  getShardCategories: () =>
    apiFetch<{ categories: CategoryItem[] }>('/api/v1/shards/categories'),

  getFactCategories: () =>
    apiFetch<{ categories: CategoryItem[] }>('/api/v1/facts/categories'),

  getShards: (lifecycle: string, limit: number, offset: number, category?: string) => {
    let url = `/api/v1/shards?lifecycle=${lifecycle}&limit=${limit}&offset=${offset}`;
    if (category && category !== 'all') url += `&category=${category}`;
    return apiFetch<{ shards: Shard[]; total: number }>(url);
  },

  getShardDetail: (id: string) =>
    apiFetch<{ shard: ShardDetail; executions: ShardDetail['recentExecutions'] }>(`/api/v1/shards/${id}`),

  getTraces: (limit: number, offset: number) =>
    apiFetch<{ traces: Trace[]; total: number }>(`/api/v1/traces?limit=${limit}&offset=${offset}`),

  getTraceDetail: (id: string) =>
    apiFetch<{ trace: TraceDetail }>(`/api/v1/traces/${id}`),

  getEpisodes: (limit: number, offset: number, valence?: string) => {
    let url = `/api/v1/episodes?limit=${limit}&offset=${offset}`;
    if (valence && valence !== 'all') url += `&valence=${valence}`;
    return apiFetch<{ episodes: Episode[]; total: number }>(url);
  },

  getEpisodeDetail: (id: string) =>
    apiFetch<{ episode: EpisodeDetail }>(`/api/v1/episodes/${id}`),

  getFacts: (limit: number, offset: number, category?: string) => {
    let url = `/api/v1/facts?limit=${limit}&offset=${offset}`;
    if (category && category !== 'all') url += `&category=${category}`;
    return apiFetch<{ facts: Fact[]; total: number }>(url);
  },

  getContexts: (limit: number, offset: number, status?: string) => {
    let url = `/api/v1/contexts?limit=${limit}&offset=${offset}`;
    if (status && status !== 'all') url += `&status=${status}`;
    return apiFetch<{ contexts: WorkingContext[]; total: number }>(url);
  },

  getContextDetail: (id: string) =>
    apiFetch<{ context: ContextDetail }>(`/api/v1/contexts/${id}`),
};

// ============================
// Helpers
// ============================

export const formatDate = (d: string) => (d ? new Date(d).toLocaleString() : '-');
export const formatDateShort = (d: string) => (d ? new Date(d).toLocaleDateString() : '-');

export const lifecycleBadgeClass = (l: string) => {
  switch (l) {
    case 'promoted': return 'badge-success';
    case 'candidate': return 'badge-blue';
    case 'testing': case 'shadow': return 'badge-purple';
    case 'archived': return 'badge-warning';
    default: return 'badge-purple';
  }
};
