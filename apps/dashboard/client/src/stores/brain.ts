import { create } from 'zustand';
import type {
  Shard,
  ShardPack,
  PackShard,
  ShardStatsData,
  CategoryOption,
} from '../hooks/useBrainApi';
import {
  SHARDS_PER_PAGE,
  fetchCategories,
  fetchShardsList,
  fetchShardDetail as fetchShardDetailApi,
  fetchPacksList,
  fetchInstalledPacks,
  fetchPackDetail as fetchPackDetailApi,
  installPackApi,
  fetchDetailedStats,
} from '../hooks/useBrainApi';

export type BrainTab = 'dashboard' | 'browse' | 'packs';
type SortBy = 'popular' | 'recent' | 'success' | 'confidence';

interface BrainState {
  activeTab: BrainTab;

  // Dashboard
  stats: ShardStatsData | null;
  statsLoading: boolean;
  statsError: string | null;
  shardPage: number;
  catPage: number;

  // Browse
  shards: Shard[];
  shardTotal: number;
  browsePage: number;
  searchQuery: string;
  category: string;
  categories: CategoryOption[];
  sortBy: SortBy;
  selectedShard: Shard | null;
  detailLoading: boolean;
  browseLoading: boolean;

  // Packs
  packs: ShardPack[];
  installedSlugs: Set<string>;
  packsLoading: boolean;
  installingSlug: string | null;
  packsError: string | null;
  selectedPack: ShardPack | null;
  packShards: PackShard[];
  packDetailLoading: boolean;

  // Actions
  setActiveTab: (tab: BrainTab) => void;
  setSearchQuery: (q: string) => void;
  setCategory: (c: string) => void;
  setSortBy: (s: SortBy) => void;
  setBrowsePage: (p: number) => void;
  setShardPage: (p: number) => void;
  setCatPage: (p: number) => void;
  setSelectedShard: (s: Shard | null) => void;
  setSelectedPack: (p: ShardPack | null) => void;

  fetchStats: () => Promise<void>;
  fetchCategories: () => Promise<void>;
  fetchShards: () => Promise<void>;
  fetchShardDetail: (id: string) => Promise<void>;
  fetchPacks: () => Promise<void>;
  fetchInstalledPacks: () => Promise<void>;
  fetchPackDetail: (slug: string) => Promise<void>;
  installPack: (slug: string) => Promise<void>;
  refreshCurrentTab: () => Promise<void>;
}

export const useBrainStore = create<BrainState>((set, get) => ({
  activeTab: 'dashboard',

  // Dashboard
  stats: null,
  statsLoading: false,
  statsError: null,
  shardPage: 1,
  catPage: 1,

  // Browse
  shards: [],
  shardTotal: 0,
  browsePage: 1,
  searchQuery: '',
  category: 'all',
  categories: [],
  sortBy: 'popular',
  selectedShard: null,
  detailLoading: false,
  browseLoading: false,

  // Packs
  packs: [],
  installedSlugs: new Set(),
  packsLoading: false,
  installingSlug: null,
  packsError: null,
  selectedPack: null,
  packShards: [],
  packDetailLoading: false,

  // ---- Setters ----
  setActiveTab: (tab) => set({ activeTab: tab }),

  setSearchQuery: (q) => set({ searchQuery: q }),

  setCategory: (c) => {
    set({ category: c, browsePage: 1 });
    get().fetchShards();
  },

  setSortBy: (s) => {
    set({ sortBy: s, browsePage: 1 });
    get().fetchShards();
  },

  setBrowsePage: (p) => {
    set({ browsePage: p });
    get().fetchShards();
  },

  setShardPage: (p) => set({ shardPage: p }),
  setCatPage: (p) => set({ catPage: p }),
  setSelectedShard: (s) => set({ selectedShard: s }),
  setSelectedPack: (p) => set({ selectedPack: p, packShards: [] }),

  // ---- Dashboard ----
  fetchStats: async () => {
    set({ statsLoading: true, statsError: null });
    try {
      const data = await fetchDetailedStats();
      set({ stats: data });
    } catch (err) {
      set({ statsError: err instanceof Error ? err.message : 'Failed to load statistics' });
    } finally {
      set({ statsLoading: false });
    }
  },

  // ---- Browse ----
  fetchCategories: async () => {
    const cats = await fetchCategories();
    set({ categories: cats });
  },

  fetchShards: async () => {
    const { browsePage, category, sortBy } = get();
    set({ browseLoading: true });
    try {
      const offset = (browsePage - 1) * SHARDS_PER_PAGE;
      const { shards, total } = await fetchShardsList({ limit: SHARDS_PER_PAGE, offset, category });

      // Client-side sort
      if (sortBy === 'popular') shards.sort((a, b) => b.executionCount - a.executionCount);
      else if (sortBy === 'recent') shards.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      else if (sortBy === 'success') shards.sort((a, b) => b.successRate - a.successRate);
      else if (sortBy === 'confidence') shards.sort((a, b) => b.confidence - a.confidence);

      set({ shards, shardTotal: total });
    } catch (err) {
      console.error('Failed to fetch shards:', err);
    } finally {
      set({ browseLoading: false });
    }
  },

  fetchShardDetail: async (id) => {
    set({ detailLoading: true });
    try {
      const shard = await fetchShardDetailApi(id);
      if (shard) set({ selectedShard: shard });
    } catch (err) {
      console.error('Failed to fetch shard detail:', err);
    } finally {
      set({ detailLoading: false });
    }
  },

  // ---- Packs ----
  fetchPacks: async () => {
    set({ packsLoading: true });
    try {
      const packs = await fetchPacksList();
      set({ packs });
    } catch (err) {
      console.error('Failed to fetch packs:', err);
    } finally {
      set({ packsLoading: false });
    }
  },

  fetchInstalledPacks: async () => {
    try {
      const slugs = await fetchInstalledPacks();
      set({ installedSlugs: new Set(slugs) });
    } catch {
      // User might not be logged in
    }
  },

  fetchPackDetail: async (slug) => {
    set({ packDetailLoading: true });
    try {
      const { pack, shards } = await fetchPackDetailApi(slug);
      if (pack) set({ selectedPack: pack, packShards: shards });
    } catch (err) {
      console.error('Failed to fetch pack detail:', err);
    } finally {
      set({ packDetailLoading: false });
    }
  },

  installPack: async (slug) => {
    set({ installingSlug: slug, packsError: null });
    try {
      const result = await installPackApi(slug);
      if (result.ok) {
        set((s) => ({ installedSlugs: new Set([...s.installedSlugs, slug]) }));
      } else {
        set({ packsError: result.error || 'Failed to install pack' });
      }
    } catch {
      set({ packsError: 'Failed to install pack' });
    } finally {
      set({ installingSlug: null });
    }
  },

  refreshCurrentTab: async () => {
    const { activeTab } = get();
    if (activeTab === 'dashboard') await get().fetchStats();
    else if (activeTab === 'browse') {
      await get().fetchCategories();
      await get().fetchShards();
    } else if (activeTab === 'packs') {
      await get().fetchPacks();
      await get().fetchInstalledPacks();
    }
  },
}));
