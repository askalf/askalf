import { create } from 'zustand';
import { API_BASE } from '../api/client';

export type SelfStatus = 'active' | 'paused' | 'error' | 'onboarding';

export interface SelfInstance {
  id: string;
  name: string;
  status: SelfStatus;
  autonomyLevel: number; // 1-5
  createdAt: string;
  stats?: {
    actionsToday: number;
    totalActions: number;
    pendingApprovals: number;
  };
}

interface SelfState {
  self: SelfInstance | null;
  exists: boolean;
  isLoading: boolean;
  error: string | null;
  fetchSelf: () => Promise<void>;
  setSelf: (self: SelfInstance) => void;
}

export const useSelfStore = create<SelfState>((set) => ({
  self: null,
  exists: false,
  isLoading: true,
  error: null,

  fetchSelf: async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/self`, { credentials: 'include' });

      if (res.status === 401) {
        // Auth store handles redirecting to /login
        set({ self: null, exists: false, isLoading: false, error: null });
        return;
      }

      if (res.status === 404) {
        // No SELF instance — user needs onboarding
        set({ self: null, exists: false, isLoading: false, error: null });
        return;
      }

      if (res.ok) {
        const data = await res.json();
        if (data.self) {
          set({ self: data.self, exists: true, isLoading: false, error: null });
        } else {
          set({ self: null, exists: false, isLoading: false, error: null });
        }
      } else {
        set({ self: null, exists: false, isLoading: false, error: 'Unexpected error loading SELF' });
      }
    } catch (err) {
      console.error('Failed to fetch SELF:', err);
      set({ self: null, exists: false, isLoading: false, error: 'Network error' });
    }
  },

  setSelf: (self) => set({ self, exists: true }),
}));
