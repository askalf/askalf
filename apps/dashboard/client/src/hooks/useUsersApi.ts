// Centralized API layer for User Administration

const getApiBase = () => {
  if (window.location.hostname.includes('askalf.org')) return '';
  return 'http://localhost:3001';
};

const API_BASE = getApiBase();

async function apiFetch<T = unknown>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || res.statusText);
  }
  return res.json();
}

function buildParams(obj: Record<string, string | number | boolean | undefined | null>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  }
  return params.toString();
}

// ============================
// Type definitions
// ============================

export interface User {
  id: string;
  email: string;
  name: string | null;
  role: 'user' | 'admin' | 'super_admin';
  status: 'active' | 'suspended' | 'deleted';
  emailVerified: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  tenantId: string;
  plan: string;
  planDisplayName: string;
}

export interface UserDetails extends User {
  failedLoginAttempts: number;
  lockedUntil: string | null;
  subscription: {
    planName: string;
    planDisplayName: string;
    status: string;
    currentPeriodEnd: string | null;
  } | null;
  stats: {
    shards: number;
    traces: number;
    executions: number;
  };
}

export interface Plan {
  id: string;
  name: string;
  display_name: string;
  price_monthly: number;
  price_yearly: number;
}

export interface AdminStats {
  users: {
    total: number;
    active: number;
    suspended: number;
    today: number;
  };
  content: {
    shards: number;
    traces: number;
    executions: number;
    executionsToday: number;
  };
}

export interface CreateUserPayload {
  email: string;
  display_name: string;
  password: string;
  role: string;
  plan: string;
}

export interface UpdateUserPayload {
  display_name?: string;
  status?: string;
  role?: string;
  plan?: string;
}

// ============================
// API methods
// ============================

export const usersApi = {
  list: (params: { search?: string; role?: string; status?: string; plan?: string; limit: number; offset: number }) => {
    const q = buildParams(params);
    return apiFetch<{ users: User[]; total: number }>(`/api/admin/users?${q}`);
  },

  getDetails: (userId: string) =>
    apiFetch<{ user: User; subscription: UserDetails['subscription']; stats: UserDetails['stats'] }>(`/api/admin/users/${userId}`),

  create: (payload: CreateUserPayload) =>
    apiFetch<{ user: User }>('/api/admin/users', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  update: (userId: string, payload: UpdateUserPayload) =>
    apiFetch<{ user: User }>(`/api/admin/users/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  delete: (userId: string) =>
    apiFetch<void>(`/api/admin/users/${userId}`, { method: 'DELETE' }),

  getPlans: () =>
    apiFetch<{ plans: Plan[] }>('/api/admin/plans'),

  getStats: () =>
    apiFetch<AdminStats>('/api/admin/stats'),
};

// ============================
// Helpers
// ============================

export function formatDate(date: string | null): string {
  if (!date) return 'Never';
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
