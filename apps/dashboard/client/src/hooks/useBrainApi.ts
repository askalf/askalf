// Centralized API layer for "My Brain" page
// Types, API methods, helpers for all 3 tabs (Dashboard, Browse, Packs)

const getApiUrl = () => {
  const host = window.location.hostname;
  if (host.includes('askalf.org')) return 'https://api.askalf.org';
  if (host === 'localhost' || host === '127.0.0.1') return 'http://localhost:3005';
  return '';
};

const API_BASE = getApiUrl();

// ============================================
// CONSTANTS
// ============================================

export const TOKEN_PRICE_PER_1K = 0.003; // Anthropic Sonnet baseline
export const SHARDS_PER_PAGE = 50;
export const STATS_SHARDS_PER_PAGE = 10;
export const STATS_CATS_PER_PAGE = 8;

// ============================================
// TYPES
// ============================================

export interface Shard {
  id: string;
  name: string;
  description?: string;
  confidence: number;
  executionCount: number;
  successRate: number;
  successCount: number;
  failureCount: number;
  category?: string;
  visibility: 'public' | 'private' | 'organization';
  lifecycle: string;
  shardType: string;
  patterns: string[];
  patternHash?: string;
  logic: string;
  synthesisMethod?: string;
  tokensSaved?: number;
  avgLatencyMs?: number;
  createdAt: string;
  updatedAt: string;
  lastExecuted?: string;
  intentTemplate?: string;
  knowledgeType?: string;
  verificationStatus?: string;
  sourceTraceIds?: string[];
  sourceUrl?: string;
  sourceType?: string;
  recentExecutions?: Array<{
    id: string;
    success: boolean;
    executionMs: number;
    error?: string;
    createdAt: string;
  }>;
}

export interface ShardPack {
  id: string;
  name: string;
  slug: string;
  description: string;
  category: string;
  version: number;
  shardCount: number;
  totalEstimatedTokens: number;
  author: string;
  isFeatured: boolean;
  createdAt: string;
  isInstalled?: boolean;
  installedAt?: string;
}

export interface PackShard {
  id: string;
  name: string;
  description?: string;
}

export interface ShardStat {
  id: string;
  name: string;
  category: string;
  knowledgeType: string;
  verificationStatus: string;
  hits: number;
  tokensSaved: number;
  avgExecutionMs: number;
  firstHit: string;
  lastHit: string;
}

export interface DailyStat {
  date: string;
  hits: number;
  tokensSaved: number;
}

export interface CategoryStat {
  category: string;
  hits: number;
  tokensSaved: number;
}

export interface KnowledgeTypeStat {
  type: string;
  count: number;
}

export interface ShardStatsData {
  totals: {
    shardHits: number;
    tokensSaved: number;
    uniqueShards: number;
    firstHit: string | null;
    lastHit: string | null;
    estimatedPowerSavedWh: number;
  };
  shards: ShardStat[];
  daily: DailyStat[];
  categories: CategoryStat[];
  knowledgeTypes: KnowledgeTypeStat[];
}

export interface CategoryOption {
  value: string;
  count: number;
}

// ============================================
// HELPERS
// ============================================

export function tokensToDollars(tokens: number): string {
  const dollars = (tokens / 1000) * TOKEN_PRICE_PER_1K;
  if (dollars < 0.01) return '<$0.01';
  if (dollars >= 1000) return `$${(dollars / 1000).toFixed(1)}K`;
  return `$${dollars.toFixed(2)}`;
}

export function formatNumber(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toString();
}

export function formatDate(d: string): string {
  const date = new Date(d);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatSlugName(name: string): string {
  return name
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function getCategoryIcon(category: string): string {
  const icons: Record<string, string> = {
    science: '🔬',
    technology: '💻',
    math: '🔢',
    geography: '🌍',
    health: '🏥',
    language: '📝',
    history: '📜',
    finance: '💰',
    general: '📦',
  };
  return icons[category] || '📦';
}

// ============================================
// API METHODS
// ============================================

export async function fetchCategories(): Promise<CategoryOption[]> {
  const res = await fetch(`${API_BASE}/api/v1/shards/categories`, { credentials: 'include' });
  if (!res.ok) return [];
  const data = await res.json();
  return data.categories || [];
}

export async function fetchShardsList(params: {
  limit: number;
  offset: number;
  category?: string;
}): Promise<{ shards: Shard[]; total: number }> {
  const qp = new URLSearchParams({
    limit: String(params.limit),
    offset: String(params.offset),
  });
  if (params.category && params.category !== 'all') qp.append('category', params.category);

  const res = await fetch(`${API_BASE}/api/v1/shards?${qp}`, { credentials: 'include' });
  if (!res.ok) return { shards: [], total: 0 };
  const data = await res.json();
  return { shards: data.shards || [], total: data.total || 0 };
}

export async function fetchShardDetail(id: string): Promise<Shard | null> {
  const res = await fetch(`${API_BASE}/api/v1/shards/${id}`, { credentials: 'include' });
  if (!res.ok) return null;
  const data = await res.json();
  return { ...data.shard, recentExecutions: data.executions || [] };
}

export async function fetchPacksList(): Promise<ShardPack[]> {
  const res = await fetch(`${API_BASE}/api/v1/packs`, { credentials: 'include' });
  if (!res.ok) return [];
  const data = await res.json();
  return data.packs || [];
}

export async function fetchInstalledPacks(): Promise<string[]> {
  const res = await fetch(`${API_BASE}/api/v1/packs/installed`, { credentials: 'include' });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.packs || []).map((p: ShardPack) => p.slug);
}

export async function fetchPackDetail(slug: string): Promise<{ pack: ShardPack | null; shards: PackShard[] }> {
  const res = await fetch(`${API_BASE}/api/v1/packs/${slug}`, { credentials: 'include' });
  if (!res.ok) return { pack: null, shards: [] };
  const data = await res.json();
  return { pack: data.pack, shards: data.shards || [] };
}

export async function installPackApi(slug: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${API_BASE}/api/v1/packs/${slug}/install`, {
    method: 'POST',
    credentials: 'include',
  });
  if (res.ok) return { ok: true };
  const data = await res.json().catch(() => ({}));
  return { ok: false, error: data.error || 'Failed to install pack' };
}

export async function fetchDetailedStats(): Promise<ShardStatsData> {
  const res = await fetch(`${API_BASE}/api/user/shard-stats/detailed`, { credentials: 'include' });
  if (!res.ok) throw new Error('Failed to fetch statistics');
  return res.json();
}
