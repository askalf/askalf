import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type ViewMode = 'admin' | 'user';

interface ViewModeState {
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  toggleViewMode: () => void;
  isViewingAsUser: () => boolean;
}

export const useViewModeStore = create<ViewModeState>()(
  persist(
    (set, get) => ({
      viewMode: 'admin',

      setViewMode: (mode: ViewMode) => set({ viewMode: mode }),

      toggleViewMode: () => {
        const current = get().viewMode;
        set({ viewMode: current === 'admin' ? 'user' : 'admin' });
      },

      isViewingAsUser: () => get().viewMode === 'user',
    }),
    {
      name: 'substrate-view-mode',
    }
  )
);
