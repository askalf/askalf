import { create } from 'zustand';
import {
  login as apiLogin,
  register as apiRegister,
  logout as apiLogout,
  getMe,
  type AuthUser,
} from '../api/auth';

export interface User {
  id: string;
  email: string;
  displayName?: string;
  role: 'user' | 'admin' | 'super_admin';
  preferredName?: string;
}

interface AuthState {
  user: User | null;
  isLoading: boolean;
  error: string | null;
  checkAuth: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName?: string) => Promise<void>;
  logout: () => Promise<void>;
}

function toUser(u: AuthUser): User {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    preferredName: u.preferredName,
    role: (u.role as User['role']) || 'user',
  };
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: true,
  error: null,

  checkAuth: async () => {
    try {
      const authUser = await getMe();
      if (authUser) {
        set({ user: toUser(authUser), isLoading: false, error: null });
      } else {
        set({ user: null, isLoading: false, error: null });
      }
    } catch {
      set({ user: null, isLoading: false, error: null });
    }
  },

  login: async (email: string, password: string) => {
    const authUser = await apiLogin(email, password);
    set({ user: toUser(authUser), isLoading: false, error: null });
  },

  register: async (email: string, password: string, displayName?: string) => {
    const authUser = await apiRegister(email, password, displayName);
    set({ user: toUser(authUser), isLoading: false, error: null });
  },

  logout: async () => {
    await apiLogout();
    set({ user: null, isLoading: false, error: null });
  },
}));
