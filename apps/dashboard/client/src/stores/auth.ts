import { create } from 'zustand';

// Determine API base URL based on environment or hostname
const getApiUrl = () => {
  // Allow environment override via Vite
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) {
    return import.meta.env.VITE_API_URL as string;
  }
  const host = window.location.hostname;
  if (host.includes('askalf.org') || host.includes('integration.tax') || host.includes('amnesia.tax')) return '';
  if (host === 'localhost' || host === '127.0.0.1') return 'http://localhost:3001';
  return ''; // Fallback to relative URLs
};

const API_BASE = getApiUrl();

// Retry configuration
const MAX_ATTEMPTS = 3; // 3 total attempts: delays of 1s, 2s, 4s between them
const RETRY_BASE_DELAY = 1000; // ms — doubles each attempt (exponential backoff)
const RETRYABLE_STATUS = new Set([429, 503]);

async function fetchWithRetry(url: string, options: RequestInit, attempt = 0): Promise<Response> {
  try {
    const res = await fetch(url, options);
    if (RETRYABLE_STATUS.has(res.status) && attempt < MAX_ATTEMPTS - 1) {
      const delay = RETRY_BASE_DELAY * Math.pow(2, attempt); // 1s → 2s → 4s
      await new Promise(resolve => setTimeout(resolve, delay));
      return fetchWithRetry(url, options, attempt + 1);
    }
    return res;
  } catch (err) {
    if (attempt < MAX_ATTEMPTS - 1) {
      const delay = RETRY_BASE_DELAY * Math.pow(2, attempt); // 1s → 2s → 4s
      await new Promise(resolve => setTimeout(resolve, delay));
      return fetchWithRetry(url, options, attempt + 1);
    }
    throw err;
  }
}

function getErrorMessage(res: Response, fallback: string): string {
  if (res.status === 429) return 'Too many attempts. Please wait a moment before trying again.';
  if (res.status === 503) return 'Service temporarily unavailable. Please try again shortly.';
  if (res.status === 401 || res.status === 403) return 'Invalid email or password.';
  return fallback;
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
    } catch {
      set({ user: null, isLoading: false, error: 'Network error — please check your connection.' });
    }
  },

  login: async (email: string, password: string) => {
    set({ isLoading: true, error: null });
    try {
      const res = await fetchWithRetry(`${API_BASE}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        let message = getErrorMessage(res, 'Login failed');
        try {
          const data = await res.json();
          if (data.error && res.status !== 429 && res.status !== 503) message = data.error;
        } catch { /* ignore parse errors */ }
        throw new Error(message);
      }

      // Login successful - now fetch complete user data (including plan)
      // The login response doesn't include plan data, so we call /auth/me
      await useAuthStore.getState().checkAuth();
    } catch (err) {
      const isNetworkError = err instanceof TypeError && err.message.includes('fetch');
      set({
        error: isNetworkError
          ? 'Network error — please check your connection.'
          : err instanceof Error ? err.message : 'Login failed',
        isLoading: false,
      });
      throw err;
    }
  },

  register: async (email: string, password: string, displayName?: string, deploymentName?: string) => {
    set({ isLoading: true, error: null });
    try {
      const res = await fetchWithRetry(`${API_BASE}/api/v1/auth/register`, {
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
        let message = getErrorMessage(res, 'Registration failed');
        try {
          const data = await res.json();
          if (data.error && res.status !== 429 && res.status !== 503) message = data.error;
        } catch { /* ignore parse errors */ }
        throw new Error(message);
      }

      // Auto-login after registration
      await useAuthStore.getState().login(email, password);
    } catch (err) {
      const isNetworkError = err instanceof TypeError && err.message.includes('fetch');
      set({
        error: isNetworkError
          ? 'Network error — please check your connection.'
          : err instanceof Error ? err.message : 'Registration failed',
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
