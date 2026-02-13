import { create } from 'zustand';
import {
  convergenceApi,
  type TabKey, type ConvergenceData, type CycleRun, type CycleConfig,
  type MetaStatus, type MetaInsights, type MetaEvent, type WorkerHealth,
} from '../hooks/useConvergenceApi';

interface CycleResult {
  cycle: string;
  result: unknown;
  success: boolean;
  timestamp: Date;
}

interface ConfirmAction {
  cycle: CycleConfig;
  variant: 'warning' | 'danger';
}

interface TypedConfirmAction {
  cycle: CycleConfig;
}

interface ConvergenceState {
  // Core
  data: ConvergenceData | null;
  loading: boolean;
  error: string | null;

  // Tab
  activeTab: TabKey;
  autoRefresh: boolean;
  lastUpdated: Date | null;

  // Category pagination
  categoryPage: number;
  internalsCategoryPage: number;

  // Engine
  cycleRunning: string | null;
  cycleResult: CycleResult | null;
  cycleHistory: CycleRun[];

  // Metacognition
  metaStatus: MetaStatus | null;
  metaInsights: MetaInsights | null;
  metaEvents: MetaEvent[];
  metaEventFilter: string;

  // System
  workerHealth: WorkerHealth | null;

  // Modals
  confirmAction: ConfirmAction | null;
  typedConfirmAction: TypedConfirmAction | null;

  // Setters
  setActiveTab: (tab: TabKey) => void;
  setAutoRefresh: (v: boolean) => void;
  setCategoryPage: (p: number) => void;
  setInternalsCategoryPage: (p: number) => void;
  setMetaEventFilter: (f: string) => void;
  setConfirmAction: (a: ConfirmAction | null) => void;
  setTypedConfirmAction: (a: TypedConfirmAction | null) => void;

  // Fetches
  fetchConvergence: () => Promise<void>;
  fetchCycleHistory: () => Promise<void>;
  fetchMetaStatus: () => Promise<void>;
  fetchMetaInsights: () => Promise<void>;
  fetchMetaEvents: () => Promise<void>;
  fetchWorkerHealth: () => Promise<void>;
  triggerCycle: (cycle: CycleConfig) => Promise<void>;
}

export const useConvergenceStore = create<ConvergenceState>((set, get) => ({
  // Core
  data: null,
  loading: true,
  error: null,

  // Tab
  activeTab: 'overview',
  autoRefresh: true,
  lastUpdated: null,

  // Category pagination
  categoryPage: 1,
  internalsCategoryPage: 1,

  // Engine
  cycleRunning: null,
  cycleResult: null,
  cycleHistory: [],

  // Metacognition
  metaStatus: null,
  metaInsights: null,
  metaEvents: [],
  metaEventFilter: '',

  // System
  workerHealth: null,

  // Modals
  confirmAction: null,
  typedConfirmAction: null,

  // Setters
  setActiveTab: (tab) => set({ activeTab: tab }),
  setAutoRefresh: (v) => set({ autoRefresh: v }),
  setCategoryPage: (p) => set({ categoryPage: p }),
  setInternalsCategoryPage: (p) => set({ internalsCategoryPage: p }),
  setMetaEventFilter: (f) => set({ metaEventFilter: f }),
  setConfirmAction: (a) => set({ confirmAction: a }),
  setTypedConfirmAction: (a) => set({ typedConfirmAction: a }),

  // Fetches
  fetchConvergence: async () => {
    try {
      const data = await convergenceApi.getConvergence();
      set({ data, error: null, lastUpdated: new Date() });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to load data' });
    }
  },

  fetchCycleHistory: async () => {
    try {
      const json = await convergenceApi.getCycleHistory();
      set({ cycleHistory: json.runs || [] });
    } catch { /* silent */ }
  },

  fetchMetaStatus: async () => {
    try {
      const data = await convergenceApi.getMetaStatus();
      set({ metaStatus: data });
    } catch { /* silent */ }
  },

  fetchMetaInsights: async () => {
    try {
      const data = await convergenceApi.getMetaInsights();
      set({ metaInsights: data });
    } catch { /* silent */ }
  },

  fetchMetaEvents: async () => {
    const { metaEventFilter } = get();
    try {
      const json = await convergenceApi.getMetaEvents(metaEventFilter || undefined);
      set({ metaEvents: json.events || [] });
    } catch { /* silent */ }
  },

  fetchWorkerHealth: async () => {
    try {
      const data = await convergenceApi.getWorkerHealth();
      set({ workerHealth: data });
    } catch {
      set({ workerHealth: { status: 'unreachable', error: 'Network error' } });
    }
  },

  triggerCycle: async (cycle) => {
    set({ cycleRunning: cycle.key, cycleResult: null });
    try {
      const result = await convergenceApi.triggerCycle(cycle);
      set({ cycleResult: { cycle: cycle.key, result, success: true, timestamp: new Date() } });
      get().fetchCycleHistory();
    } catch (err) {
      set({
        cycleResult: {
          cycle: cycle.key,
          result: { error: err instanceof Error ? err.message : 'Failed' },
          success: false,
          timestamp: new Date(),
        },
      });
    } finally {
      set({ cycleRunning: null });
    }
  },
}));
