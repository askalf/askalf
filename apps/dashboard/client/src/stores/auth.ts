import { create } from 'zustand';

const getApiUrl = () => {
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) {
    return import.meta.env.VITE_API_URL as string;
  }
  const host = window.location.hostname;
  if (host.includes('askalf.org') || host.includes('amnesia.tax')) return '';
  if (host === 'localhost' || host === '127.0.0.1') return 'http://localhost:3001';
  return '';
};

const API_BASE = getApiUrl();

export interface User {
  id: string;
  email: string;
  name?: string;
  displayName?: string;
  role: 'user' | 'admin' | 'super_admin';
  tenantName?: string | null;
  themePreference?: string | null;
  onboardingCompleted?: boolean;
}

interface AuthState {
  user: User | null;
  isLoading: boolean;
  onboardingCompleted: boolean;
  checkAuth: () => Promise<void>;
  setOnboardingCompleted: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: true,
  onboardingCompleted: true, // assume true until we know otherwise

  checkAuth: async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/auth/me`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        set({
          user: data.user,
          isLoading: false,
          onboardingCompleted: data.user?.onboardingCompleted ?? true,
        });
        if (data.user?.themePreference) {
          try {
            const stored = localStorage.getItem('askalf-theme');
            if (!stored) {
              const { useThemeStore } = await import('./theme');
              useThemeStore.getState().setTheme(data.user.themePreference);
            }
          } catch { /* ignore */ }
        }
      } else {
        set({ user: null, isLoading: false, onboardingCompleted: true });
      }
    } catch {
      set({ user: null, isLoading: false, onboardingCompleted: true });
    }
  },

  setOnboardingCompleted: () => set({ onboardingCompleted: true }),
}));

if (typeof window !== 'undefined') {
  useAuthStore.getState().checkAuth();
}
