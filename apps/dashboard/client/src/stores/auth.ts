import { create } from 'zustand';

// Determine API base URL based on environment or hostname
const getApiUrl = () => {
  // Allow environment override via Vite
  // @ts-expect-error - Vite injects import.meta.env at build time
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) {
    // @ts-expect-error - Vite injects import.meta.env at build time
    return import.meta.env.VITE_API_URL as string;
  }
  const host = window.location.hostname;
  if (host.includes('askalf.org')) return '';
  if (host.includes('integration.tax')) return '';
  if (host === 'localhost' || host === '127.0.0.1') return 'http://localhost:3005';
  return ''; // Fallback to relative URLs
};

const API_BASE = getApiUrl();

// Retry configuration
const MAX_RETRIES = 2;
const RETRY_DELAY = 1000; // ms

async function fetchWithRetry(url: string, options: RequestInit, retries = MAX_RETRIES): Promise<Response> {
  try {
    const res = await fetch(url, options);
    return res;
  } catch (err) {
    if (retries > 0) {
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      return fetchWithRetry(url, options, retries - 1);
    }
    throw err;
  }
}

export interface User {
  id: string;
  email: string;
  emailVerified?: boolean;
  displayName?: string;
  role: 'user' | 'admin' | 'super_admin';
}

interface AuthState {
  user: User | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  checkAuth: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName?: string, deploymentName?: string) => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: true,
  error: null,

  checkAuth: async () => {
    try {
      const res = await fetchWithRetry(`${API_BASE}/api/v1/auth/me`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        set({ user: data.user, isLoading: false, error: null });
      } else {
        set({ user: null, isLoading: false, error: null });
      }
    } catch (err) {
      // Log network errors but don't expose to user
      console.error('Auth check failed:', err instanceof Error ? err.message : 'Network error');
      set({ user: null, isLoading: false, error: 'Network error - please check your connection' });
    }
  },

  login: async (email: string, password: string) => {
    set({ isLoading: true, error: null });
    try {
      const res = await fetch(`${API_BASE}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Login failed');
      }

      // Login successful - now fetch complete user data (including plan)
      // The login response doesn't include plan data, so we call /auth/me
      await useAuthStore.getState().checkAuth();
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Login failed',
        isLoading: false,
      });
      throw err;
    }
  },

  register: async (email: string, password: string, displayName?: string, deploymentName?: string) => {
    set({ isLoading: true, error: null });
    try {
      const res = await fetch(`${API_BASE}/api/v1/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          email,
          password,
          display_name: displayName || undefined,
          tenant_name: deploymentName || undefined,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Registration failed');
      }

      // Auto-login after registration
      await useAuthStore.getState().login(email, password);
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Registration failed',
        isLoading: false,
      });
      throw err;
    }
  },

  logout: async () => {
    try {
      await fetch(`${API_BASE}/api/v1/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } finally {
      set({ user: null });
    }
  },

  clearError: () => set({ error: null }),
}));

// Check auth on app load
if (typeof window !== 'undefined') {
  useAuthStore.getState().checkAuth();
}
