import { create } from 'zustand';
import * as settingsApi from '../api/settings';
import type { SelfSettings } from '../api/settings';

interface SettingsState {
  settings: SelfSettings | null;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  fetchSettings: () => Promise<void>;
  updateSettings: (data: Partial<SelfSettings>) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: null,
  isLoading: false,
  isSaving: false,
  error: null,

  fetchSettings: async () => {
    set({ isLoading: true, error: null });
    try {
      const data = await settingsApi.getSettings();
      set({ settings: data.settings, isLoading: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to load settings', isLoading: false });
    }
  },

  updateSettings: async (data) => {
    set({ isSaving: true, error: null });
    try {
      const result = await settingsApi.updateSettings(data);
      set({ settings: result.settings, isSaving: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to save settings', isSaving: false });
    }
  },
}));
