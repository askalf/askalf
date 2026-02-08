import { create } from 'zustand';
import * as activityApi from '../api/activity';
import type { ActivityType, Activity } from '../api/activity';

const PAGE_SIZE = 50;

interface ActivityState {
  activities: Activity[];
  total: number;
  isLoading: boolean;
  isLoadingMore: boolean;
  error: string | null;
  filter: ActivityType | null;

  fetchActivities: (type?: ActivityType | null) => Promise<void>;
  loadMore: () => Promise<void>;
  setFilter: (type: ActivityType | null) => void;
  addActivity: (activity: Activity) => void;
}

export const useActivityStore = create<ActivityState>((set, get) => ({
  activities: [],
  total: 0,
  isLoading: false,
  isLoadingMore: false,
  error: null,
  filter: null,

  fetchActivities: async (type) => {
    set({ isLoading: true, error: null });
    try {
      const filterType = type !== undefined ? type : get().filter;
      const data = await activityApi.getActivities({
        type: filterType || undefined,
        limit: PAGE_SIZE,
      });
      set({ activities: data.activities, total: data.total ?? data.activities.length, isLoading: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to load activity', isLoading: false });
    }
  },

  loadMore: async () => {
    const { activities, total, filter, isLoadingMore } = get();
    if (isLoadingMore || activities.length >= total) return;
    set({ isLoadingMore: true });
    try {
      const data = await activityApi.getActivities({
        type: filter || undefined,
        limit: PAGE_SIZE,
        offset: activities.length,
      });
      set((s) => ({
        activities: [...s.activities, ...data.activities],
        total: data.total ?? s.total,
        isLoadingMore: false,
      }));
    } catch (err) {
      set({ isLoadingMore: false, error: err instanceof Error ? err.message : 'Failed to load more' });
    }
  },

  setFilter: (type) => {
    set({ filter: type });
    get().fetchActivities(type);
  },

  addActivity: (activity) => {
    set((s) => ({
      activities: [activity, ...s.activities],
      total: s.total + 1,
    }));
  },
}));
