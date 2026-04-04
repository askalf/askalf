import { create } from 'zustand';
import { analyticsApi, type PlatformMetrics, type MemoryStats, type WaitlistEntry } from '../hooks/useAnalyticsApi';

type ViewMode = 'admin' | 'investor';
type DateRange = '24h' | '7d' | '30d';

interface AnalyticsState {
  // Data
  metrics: PlatformMetrics | null;
  memoryStats: MemoryStats | null;
  waitlistEntries: WaitlistEntry[];

  // UI
  viewMode: ViewMode;
  dateRange: DateRange;
  autoRefresh: boolean;
  waitlistOpen: boolean;
  waitlistFilter: string;
  setViewMode: (m: ViewMode) => void;
  setDateRange: (r: DateRange) => void;
  setAutoRefresh: (v: boolean) => void;
  setWaitlistOpen: (v: boolean) => void;
  setWaitlistFilter: (f: string) => void;

  // Loading
  loading: Record<string, boolean>;

  // Error
  error: string | null;
  setError: (e: string | null) => void;

  // Actions
  fetchMetrics: () => Promise<void>;
  fetchWaitlist: () => Promise<void>;
  sendWaitlistAction: (entryId: number, action: 'welcome' | 'beta-invite') => Promise<void>;
}

export const useAnalyticsStore = create<AnalyticsState>((set, get) => ({
  // Data
  metrics: null,
  memoryStats: null,
  waitlistEntries: [],

  // UI
  viewMode: 'admin',
  dateRange: '24h',
  autoRefresh: true,
  waitlistOpen: false,
  waitlistFilter: '',
  setViewMode: (m) => set({ viewMode: m }),
  setDateRange: (r) => set({ dateRange: r }),
  setAutoRefresh: (v) => set({ autoRefresh: v }),
  setWaitlistOpen: (v) => {
    set({ waitlistOpen: v });
    if (v && get().waitlistEntries.length === 0) get().fetchWaitlist();
  },
  setWaitlistFilter: (f) => set({ waitlistFilter: f }),

  // Loading
  loading: {},

  // Error
  error: null,
  setError: (e) => set({ error: e }),

  // Actions
  fetchMetrics: async () => {
    set((s) => ({ loading: { ...s.loading, metrics: true } }));
    try {
      const [metrics, memoryStats] = await Promise.all([
        analyticsApi.getMetrics(),
        analyticsApi.getMemoryStats().catch(() => null),
      ]);
      set({ metrics, memoryStats, error: null });
    } catch (err) {
      if (err instanceof Error && err.message.includes('401')) {
        set({ error: 'Authentication required. Please log in.' });
      } else {
        set({ error: err instanceof Error ? err.message : 'Failed to load metrics' });
      }
    } finally {
      set((s) => ({ loading: { ...s.loading, metrics: false } }));
    }
  },

  fetchWaitlist: async () => {
    set((s) => ({ loading: { ...s.loading, waitlist: true } }));
    try {
      const data = await analyticsApi.getWaitlist();
      set({ waitlistEntries: data.entries || [] });
    } catch {
      // Silent
    } finally {
      set((s) => ({ loading: { ...s.loading, waitlist: false } }));
    }
  },

  sendWaitlistAction: async (entryId, action) => {
    set((s) => ({ loading: { ...s.loading, [`waitlist-${action}-${entryId}`]: true } }));
    try {
      await analyticsApi.sendWaitlistAction(entryId, action);
      if (action === 'welcome') get().fetchWaitlist();
    } catch {
      // Silent
    } finally {
      set((s) => ({ loading: { ...s.loading, [`waitlist-${action}-${entryId}`]: false } }));
    }
  },
}));
