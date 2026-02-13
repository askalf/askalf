// Centralized API layer for Platform Analytics

const API_BASE = window.location.hostname.includes('askalf.org')
  ? 'https://api.askalf.org'
  : 'http://localhost:3000';

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

// ============================
// Type definitions
// ============================

export interface PlatformMetrics {
  users: {
    total: number;
    byTier: Record<string, number>;
    growth: { today: number; thisWeek: number; thisMonth: number };
    active: { last24h: number; last7d: number; last30d: number };
  };
  waitlist: { total: number; today: number; converted: number; conversionRate: number };
  conversations: {
    total: number; today: number; totalMessages: number;
    messagesToday: number; avgMessagesPerConvo: number;
  };
  shards: {
    total: number; public: number; private: number; createdToday: number;
    executions: { total: number; today: number };
    hitRate: number;
  };
  tokens: {
    totalUsed: number; usedToday: number; saved: number;
    byokUsage: number; bundleUsage: number;
    usageByTier: Array<{ tier: string; totalUsed: number; userCount: number }>;
  };
  byok: {
    totalKeys: number; openaiKeys: number; anthropicKeys: number;
    googleKeys: number; xaiKeys: number; ollamaKeys: number; usersWithByok: number;
  };
  revenue: {
    bundlesSold: number; bundlesToday: number; bundleRevenueCents: number;
    activeBundleUsers: number; totalSubscriptions: number;
    activeSubscriptions: number; mrrCents: number;
  };
  environmental: {
    tokensSaved: number; waterMlSaved: number;
    powerWhSaved: number; carbonGSaved: number;
  };
  demo: {
    totalSessions: number; sessionsToday: number; activeSessions: number;
    conversions: number;
    llm: { callsThisHour: number; callsToday: number; maxPerHour: number; maxPerDay: number; shardOnlyMode: boolean };
  };
  systemHealth: {
    apiLatencyP50Ms: number; apiLatencyP95Ms: number; apiLatencyP99Ms: number;
    errorRate: number; uptime: number;
  };
  linkClicks: Record<string, number>;
  timestamp: string;
}

export interface MemoryStats {
  procedural: {
    shards: { total: number; promoted: number; shadow: number; candidate: number; testing: number; archived: number; public: number; private: number };
    traces: { total: number; synthesized: number };
    executions: { total: number; successful: number; successRate: number };
  };
  episodic: { total: number; positive: number; negative: number };
  semantic: { facts: number; highConfidence: number; avgConfidence: number; categories: number };
  working: { total: number; raw: number; liquidated: number; promoted: number; avgCompression: number };
}

export interface WaitlistEntry {
  id: number; email: string; source: string | null;
  created_at: string; welcome_email_sent_at: string | null;
}

// ============================
// API methods
// ============================

export const analyticsApi = {
  getMetrics: () =>
    apiFetch<PlatformMetrics>('/api/v1/admin/metrics'),

  getMemoryStats: () =>
    apiFetch<MemoryStats>('/api/v1/stats'),

  getWaitlist: () =>
    apiFetch<{ entries: WaitlistEntry[] }>('/api/v1/admin/waitlist'),

  sendWaitlistAction: (entryId: number, action: 'welcome' | 'beta-invite') =>
    apiFetch<void>(`/api/v1/admin/waitlist/${entryId}/send-${action}`, { method: 'POST' }),
};

// ============================
// Helpers
// ============================

export const fmt = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
};

export const fmtCurrency = (cents: number) =>
  `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

export const fmtCurrencyFull = (cents: number) =>
  `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const fmtPercent = (n: number) => `${n.toFixed(1)}%`;

export const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
