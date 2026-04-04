/**
 * Auth store for self-hosted mode.
 * No login/register — single user, always authenticated.
 * Provides onboarding state and a stub user for components that expect it.
 */

import { create } from 'zustand';
import { API_BASE } from '../utils/api';

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
}

interface AuthState {
  user: User | null;
  onboardingCompleted: boolean;
  isLoading: boolean;
  error: string | null;

  checkAuth: () => Promise<void>;
  checkOnboarding: () => Promise<void>;
  setOnboardingCompleted: (val: boolean) => void;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: { id: 'admin', email: 'admin@localhost', name: 'Admin', role: 'admin' },
  onboardingCompleted: true,
  isLoading: true,
  error: null,

  checkAuth: async () => {
    // Self-hosted: always authenticated
    set({ user: { id: 'admin', email: 'admin@localhost', name: 'Admin', role: 'admin' }, isLoading: false });
  },

  checkOnboarding: async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/onboarding/status`);
      if (res.ok) {
        const data = await res.json() as { completed: boolean };
        set({ onboardingCompleted: data.completed, isLoading: false });
      } else {
        set({ onboardingCompleted: true, isLoading: false });
      }
    } catch {
      set({ onboardingCompleted: true, isLoading: false });
    }
  },

  setOnboardingCompleted: (val: boolean) => set({ onboardingCompleted: val }),
  clearError: () => set({ error: null }),
}));
