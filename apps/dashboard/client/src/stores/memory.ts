import { create } from 'zustand';
import {
  memoryApi, ITEMS_PER_PAGE,
  type MemoryTier, type LifecycleFilter, type EpisodeFilter, type ContextFilterType,
  type MemoryStats, type Shard, type ShardDetail, type Trace, type TraceDetail,
  type Episode, type EpisodeDetail, type Fact, type WorkingContext, type ContextDetail,
  type CategoryItem,
} from '../hooks/useMemoryApi';

interface MemoryState {
  // Core
  stats: MemoryStats | null;
  activeTier: MemoryTier;
  searchQuery: string;

  // Procedural - Shards
  shards: Shard[];
  shardTotal: number;
  shardPage: number;
  lifecycle: LifecycleFilter;
  shardCategory: string;
  shardCategories: CategoryItem[];
  selectedShard: ShardDetail | null;

  // Procedural - Traces
  showTraces: boolean;
  traces: Trace[];
  traceTotal: number;
  tracePage: number;
  selectedTrace: TraceDetail | null;

  // Episodic
  episodes: Episode[];
  episodeTotal: number;
  episodePage: number;
  episodeFilter: EpisodeFilter;
  selectedEpisode: EpisodeDetail | null;

  // Semantic
  facts: Fact[];
  factTotal: number;
  factPage: number;
  factCategory: string;
  factCategories: CategoryItem[];
  selectedFact: Fact | null;

  // Working
  contexts: WorkingContext[];
  contextTotal: number;
  contextPage: number;
  contextFilter: ContextFilterType;
  selectedContext: ContextDetail | null;

  // Loading
  loading: Record<string, boolean>;

  // Setters
  setActiveTier: (tier: MemoryTier) => void;
  setSearchQuery: (q: string) => void;
  setLifecycle: (l: LifecycleFilter) => void;
  setShardCategory: (c: string) => void;
  setShowTraces: (v: boolean) => void;
  setShardPage: (p: number) => void;
  setTracePage: (p: number) => void;
  setEpisodeFilter: (f: EpisodeFilter) => void;
  setEpisodePage: (p: number) => void;
  setFactCategory: (c: string) => void;
  setFactPage: (p: number) => void;
  setContextFilter: (f: ContextFilterType) => void;
  setContextPage: (p: number) => void;
  setSelectedShard: (s: ShardDetail | null) => void;
  setSelectedTrace: (t: TraceDetail | null) => void;
  setSelectedEpisode: (e: EpisodeDetail | null) => void;
  setSelectedFact: (f: Fact | null) => void;
  setSelectedContext: (c: ContextDetail | null) => void;

  // Fetches
  fetchStats: () => Promise<void>;
  fetchCategories: () => Promise<void>;
  fetchShards: () => Promise<void>;
  fetchShardDetail: (id: string) => Promise<void>;
  fetchTraces: () => Promise<void>;
  fetchTraceDetail: (id: string) => Promise<void>;
  fetchEpisodes: () => Promise<void>;
  fetchEpisodeDetail: (id: string) => Promise<void>;
  fetchFacts: () => Promise<void>;
  fetchContexts: () => Promise<void>;
  fetchContextDetail: (id: string) => Promise<void>;
  refreshCurrentTier: () => void;
}

export const useMemoryStore = create<MemoryState>((set, get) => ({
  // Core
  stats: null,
  activeTier: 'procedural',
  searchQuery: '',

  // Procedural - Shards
  shards: [],
  shardTotal: 0,
  shardPage: 1,
  lifecycle: 'all',
  shardCategory: 'all',
  shardCategories: [],
  selectedShard: null,

  // Procedural - Traces
  showTraces: false,
  traces: [],
  traceTotal: 0,
  tracePage: 1,
  selectedTrace: null,

  // Episodic
  episodes: [],
  episodeTotal: 0,
  episodePage: 1,
  episodeFilter: 'all',
  selectedEpisode: null,

  // Semantic
  facts: [],
  factTotal: 0,
  factPage: 1,
  factCategory: 'all',
  factCategories: [],
  selectedFact: null,

  // Working
  contexts: [],
  contextTotal: 0,
  contextPage: 1,
  contextFilter: 'all',
  selectedContext: null,

  // Loading
  loading: {},

  // Setters
  setActiveTier: (tier) => set({ activeTier: tier, showTraces: false, searchQuery: '' }),
  setSearchQuery: (q) => set({ searchQuery: q }),
  setLifecycle: (l) => set({ lifecycle: l, shardPage: 1 }),
  setShardCategory: (c) => set({ shardCategory: c, shardPage: 1 }),
  setShowTraces: (v) => set({ showTraces: v }),
  setShardPage: (p) => set({ shardPage: p }),
  setTracePage: (p) => set({ tracePage: p }),
  setEpisodeFilter: (f) => set({ episodeFilter: f, episodePage: 1 }),
  setEpisodePage: (p) => set({ episodePage: p }),
  setFactCategory: (c) => set({ factCategory: c, factPage: 1 }),
  setFactPage: (p) => set({ factPage: p }),
  setContextFilter: (f) => set({ contextFilter: f, contextPage: 1 }),
  setContextPage: (p) => set({ contextPage: p }),
  setSelectedShard: (s) => set({ selectedShard: s }),
  setSelectedTrace: (t) => set({ selectedTrace: t }),
  setSelectedEpisode: (e) => set({ selectedEpisode: e }),
  setSelectedFact: (f) => set({ selectedFact: f }),
  setSelectedContext: (c) => set({ selectedContext: c }),

  // Fetches
  fetchStats: async () => {
    try {
      const stats = await memoryApi.getStats();
      set({ stats });
    } catch (err) {
      console.error('Failed to fetch stats:', err);
    }
  },

  fetchCategories: async () => {
    try {
      const [shardRes, factRes] = await Promise.all([
        memoryApi.getShardCategories().catch(() => ({ categories: [] })),
        memoryApi.getFactCategories().catch(() => ({ categories: [] })),
      ]);
      set({ shardCategories: shardRes.categories || [], factCategories: factRes.categories || [] });
    } catch { /* silent */ }
  },

  fetchShards: async () => {
    const { lifecycle, shardPage, shardCategory } = get();
    set((s) => ({ loading: { ...s.loading, shards: true } }));
    try {
      const offset = (shardPage - 1) * ITEMS_PER_PAGE;
      const data = await memoryApi.getShards(lifecycle, ITEMS_PER_PAGE, offset, shardCategory);
      set({ shards: data.shards || [], shardTotal: data.total || 0 });
    } catch (err) {
      console.error('Failed to fetch shards:', err);
    } finally {
      set((s) => ({ loading: { ...s.loading, shards: false } }));
    }
  },

  fetchShardDetail: async (id) => {
    try {
      const data = await memoryApi.getShardDetail(id);
      set({ selectedShard: { ...data.shard, recentExecutions: data.executions || [] } });
    } catch (err) {
      console.error('Failed to fetch shard detail:', err);
    }
  },

  fetchTraces: async () => {
    const { tracePage } = get();
    set((s) => ({ loading: { ...s.loading, traces: true } }));
    try {
      const offset = (tracePage - 1) * ITEMS_PER_PAGE;
      const data = await memoryApi.getTraces(ITEMS_PER_PAGE, offset);
      set({ traces: data.traces || [], traceTotal: data.total || 0 });
    } catch (err) {
      console.error('Failed to fetch traces:', err);
    } finally {
      set((s) => ({ loading: { ...s.loading, traces: false } }));
    }
  },

  fetchTraceDetail: async (id) => {
    try {
      const data = await memoryApi.getTraceDetail(id);
      set({ selectedTrace: data.trace });
    } catch (err) {
      console.error('Failed to fetch trace detail:', err);
    }
  },

  fetchEpisodes: async () => {
    const { episodePage, episodeFilter } = get();
    set((s) => ({ loading: { ...s.loading, episodes: true } }));
    try {
      const offset = (episodePage - 1) * ITEMS_PER_PAGE;
      const data = await memoryApi.getEpisodes(ITEMS_PER_PAGE, offset, episodeFilter);
      set({ episodes: data.episodes || [], episodeTotal: data.total || 0 });
    } catch (err) {
      console.error('Failed to fetch episodes:', err);
    } finally {
      set((s) => ({ loading: { ...s.loading, episodes: false } }));
    }
  },

  fetchEpisodeDetail: async (id) => {
    try {
      const data = await memoryApi.getEpisodeDetail(id);
      set({ selectedEpisode: data.episode });
    } catch (err) {
      console.error('Failed to fetch episode detail:', err);
    }
  },

  fetchFacts: async () => {
    const { factPage, factCategory } = get();
    set((s) => ({ loading: { ...s.loading, facts: true } }));
    try {
      const offset = (factPage - 1) * ITEMS_PER_PAGE;
      const data = await memoryApi.getFacts(ITEMS_PER_PAGE, offset, factCategory);
      set({ facts: data.facts || [], factTotal: data.total || 0 });
    } catch (err) {
      console.error('Failed to fetch facts:', err);
    } finally {
      set((s) => ({ loading: { ...s.loading, facts: false } }));
    }
  },

  fetchContexts: async () => {
    const { contextPage, contextFilter } = get();
    set((s) => ({ loading: { ...s.loading, contexts: true } }));
    try {
      const offset = (contextPage - 1) * ITEMS_PER_PAGE;
      const data = await memoryApi.getContexts(ITEMS_PER_PAGE, offset, contextFilter);
      set({ contexts: data.contexts || [], contextTotal: data.total || 0 });
    } catch (err) {
      console.error('Failed to fetch contexts:', err);
    } finally {
      set((s) => ({ loading: { ...s.loading, contexts: false } }));
    }
  },

  fetchContextDetail: async (id) => {
    try {
      const data = await memoryApi.getContextDetail(id);
      set({ selectedContext: data.context });
    } catch (err) {
      console.error('Failed to fetch context detail:', err);
    }
  },

  refreshCurrentTier: () => {
    const { activeTier, showTraces, fetchStats, fetchShards, fetchTraces, fetchEpisodes, fetchFacts, fetchContexts } = get();
    fetchStats();
    switch (activeTier) {
      case 'procedural': showTraces ? fetchTraces() : fetchShards(); break;
      case 'episodic': fetchEpisodes(); break;
      case 'semantic': fetchFacts(); break;
      case 'working': fetchContexts(); break;
    }
  },
}));
