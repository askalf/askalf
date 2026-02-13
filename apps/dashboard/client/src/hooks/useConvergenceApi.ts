// Centralized API layer for Convergence Dashboard

const API_BASE = window.location.hostname.includes('askalf.org')
  ? 'https://api.askalf.org'
  : 'http://localhost:3000';

async function apiFetch<T = unknown>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    ...options,
    headers: {
      ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
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
// Types
// ============================

export interface DailyData {
  date: string;
  totalQueries: number;
  shardHits: number;
  shardHitRate: number;
  estimatedCostPerQuery: number;
}

export interface KnowledgeTypeStat {
  type: string;
  count: number;
}

export interface CategoryConvergence {
  category: string;
  convergenceScore: number;
  hitRate: number;
  avgConfidence: number;
  promotedShards: number;
  tokensSaved: number;
}

export interface MaturityBreakdown {
  verification: { status: string; count: number }[];
  lifecycle: { stage: string; count: number }[];
}

export interface FeedbackHealth {
  signals: { type: string; count: number }[];
  acceptanceRate: number;
  correctionRate: number;
  totalSignals: number;
}

export interface ImpactMetrics {
  tokensSaved: number;
  avgShardLatencyMs: number;
  totalExecutions: number;
  environmental: {
    powerWhSaved: number;
    waterMlSaved: number;
    carbonGSaved: number;
  };
}

export interface TopShard {
  id: string;
  name: string;
  category: string;
  confidence: number;
  hits: number;
  tokensSaved: number;
}

export interface ConvergenceData {
  daily: DailyData[];
  summary: {
    currentHitRate: number;
    previousHitRate: number;
    trend: 'improving' | 'declining' | 'stable';
    totalFreeAnswers: number;
    estimatedMonthlySavings: number;
    activeShards: number;
  };
  knowledgeTypes?: KnowledgeTypeStat[];
  categories?: CategoryConvergence[];
  maturity?: MaturityBreakdown;
  feedback?: FeedbackHealth;
  impact?: ImpactMetrics;
  topShards?: TopShard[];
}

export interface CycleRun {
  id: string;
  event_type: string;
  analysis: Record<string, unknown> | null;
  success: boolean | null;
  processing_time_ms: number | null;
  created_at: string;
}

export interface MetaStatus {
  status: string;
  events: { total: number; last24h: number; avgConfidence: number };
  metaShards: { total: number; reflection: number; strategy: number; learning: number; correction: number };
}

export interface MetaInsights {
  insights: {
    lowConfidenceShards: {
      id: string;
      name: string;
      confidence: number;
      executions: number;
      successRate: number | null;
      recommendation: string;
    }[];
    trendingIntents: { intent: string; count: number }[];
    errorRate: { total: number; errors: number; rate: number };
  };
}

export interface MetaEvent {
  id: string;
  type: string;
  analysis: Record<string, unknown>;
  confidence: number | null;
  action: string | null;
  outcome: string | null;
  success: boolean | null;
  processingMs: number | null;
  createdAt: string;
}

export interface WorkerHealth {
  status: string;
  uptime?: number;
  jobs?: { processed: number; failed: number; active: number };
  queues?: Record<string, { active: number; waiting: number; completed: number; failed: number }>;
  circuitBreakers?: Record<string, { isOpen: boolean; failures: number }>;
  config?: Record<string, unknown>;
  error?: string;
}

export interface CycleConfig {
  key: string;
  name: string;
  description: string;
  endpoint: string;
  method: 'POST' | 'GET';
  danger: 'safe' | 'moderate' | 'warning' | 'danger';
  confirmMessage?: string;
  requireTypedConfirm?: string;
  body?: Record<string, unknown>;
}

export type TabKey = 'overview' | 'internals' | 'engine' | 'metacognition' | 'system';

// ============================
// Constants
// ============================

export const CYCLES: CycleConfig[] = [
  { key: 'crystallize', name: 'Crystallize', description: 'Convert trace clusters into shards', endpoint: '/api/v1/metabolic/crystallize', method: 'POST', danger: 'safe' },
  { key: 'promote', name: 'Promote', description: 'Elevate qualified shards', endpoint: '/api/v1/metabolic/promote', method: 'POST', danger: 'safe' },
  { key: 'decay', name: 'Decay', description: 'Reduce failing shard confidence', endpoint: '/api/v1/metabolic/decay', method: 'POST', danger: 'safe' },
  { key: 'evolve', name: 'Evolve', description: 'Improve shard patterns', endpoint: '/api/v1/metabolic/evolve', method: 'POST', danger: 'safe' },
  { key: 'lessons', name: 'Lessons', description: 'Extract lessons from episodes', endpoint: '/api/v1/metabolic/lessons', method: 'POST', danger: 'safe' },
  { key: 'recluster', name: 'Re-cluster', description: 'Regroup traces', endpoint: '/api/v1/metabolic/recluster', method: 'POST', danger: 'safe' },
  { key: 'migrate-hybrid', name: 'Migrate Hybrid', description: 'Convert to hybrid synthesis', endpoint: '/api/v1/metabolic/migrate-hybrid', method: 'POST', danger: 'moderate' },
  { key: 'reseed-soft', name: 'Soft Reseed', description: 'Reset low-confidence shards', endpoint: '/api/v1/metabolic/reseed/soft', method: 'POST', danger: 'warning', confirmMessage: 'This will reset low-confidence shards. Continue?' },
  { key: 'reseed-full', name: 'Full Reseed', description: 'Wipe procedural memory', endpoint: '/api/v1/metabolic/reseed/full', method: 'POST', danger: 'danger', confirmMessage: 'DANGER: This will wipe procedural memory!', requireTypedConfirm: 'RESEED_CONFIRMED', body: { confirm: 'RESEED_CONFIRMED' } },
];

export const LIFECYCLE_STAGES = ['candidate', 'testing', 'shadow', 'promoted'];

export const CATEGORIES_PER_PAGE = 8;

export const CATEGORY_DISPLAY_NAMES: Record<string, string> = {
  general: 'General Knowledge',
  communication: 'Communication Style',
  scheduling: 'Scheduling & Time',
  coding: 'Code & Development',
  writing: 'Writing & Content',
  research: 'Research & Analysis',
  data: 'Data & Numbers',
  creative: 'Creative Work',
  productivity: 'Productivity',
  personal: 'Personal Preferences',
  work: 'Work & Professional',
  learning: 'Learning & Education',
  health: 'Health & Wellness',
  finance: 'Finance & Money',
  travel: 'Travel & Places',
  food: 'Food & Recipes',
  entertainment: 'Entertainment',
  social: 'Social & Relationships',
  technical: 'Technical Knowledge',
  business: 'Business & Strategy',
};

export const VERIFICATION_CHIP_CLASS: Record<string, string> = {
  verified: 'chip-verified',
  unverified: 'chip-unverified',
  challenged: 'chip-challenged',
  failed: 'chip-failed',
};

export const FEEDBACK_FILL_CLASS: Record<string, string> = {
  acceptance: 'feedback-fill-acceptance',
  correction: 'feedback-fill-correction',
  rephrase: 'feedback-fill-rephrase',
};

// ============================
// API methods
// ============================

export const convergenceApi = {
  getConvergence: () =>
    apiFetch<ConvergenceData>('/api/v1/convergence'),

  getCycleHistory: () =>
    apiFetch<{ runs: CycleRun[] }>('/api/v1/admin/cycle-history?limit=20'),

  getMetaStatus: () =>
    apiFetch<MetaStatus>('/api/v1/meta/status'),

  getMetaInsights: () =>
    apiFetch<MetaInsights>('/api/v1/meta/insights'),

  getMetaEvents: (filter?: string) => {
    const url = filter
      ? `/api/v1/meta/events?limit=50&type=${filter}`
      : '/api/v1/meta/events?limit=50';
    return apiFetch<{ events: MetaEvent[] }>(url);
  },

  getWorkerHealth: () =>
    apiFetch<WorkerHealth>('/api/v1/admin/worker-health'),

  triggerCycle: (cycle: CycleConfig) =>
    apiFetch<unknown>(cycle.endpoint, {
      method: cycle.method,
      body: cycle.body ? JSON.stringify(cycle.body) : undefined,
    }),
};

// ============================
// Helpers
// ============================

export function getExpertiseLevel(shardCount: number, confidence: number): {
  level: 'expert' | 'proficient' | 'learning' | 'new';
  label: string;
  description: string;
} {
  const score = (shardCount * 0.6) + (confidence * 40);
  if (score >= 30 || (shardCount >= 20 && confidence >= 0.8)) {
    return { level: 'expert', label: 'Expert', description: 'Deep knowledge in this area' };
  } else if (score >= 15 || (shardCount >= 10 && confidence >= 0.7)) {
    return { level: 'proficient', label: 'Proficient', description: 'Strong understanding' };
  } else if (score >= 5 || shardCount >= 3) {
    return { level: 'learning', label: 'Learning', description: 'Building knowledge' };
  }
  return { level: 'new', label: 'New', description: 'Just started learning' };
}

export function getCategoryDisplayName(category: string): string {
  return CATEGORY_DISPLAY_NAMES[category.toLowerCase()] ||
    category.charAt(0).toUpperCase() + category.slice(1).replace(/_/g, ' ');
}

export function formatPower(wh: number): string {
  if (wh >= 1000) return `${(wh / 1000).toFixed(2)} kWh`;
  return `${wh.toFixed(1)} Wh`;
}

export function formatWater(ml: number): string {
  if (ml >= 1000) return `${(ml / 1000).toFixed(2)} L`;
  return `${ml.toFixed(0)} mL`;
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return '--';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function formatUptime(seconds: number | undefined): string {
  if (!seconds) return '--';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return `${h}h ${m}m`;
}

export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function cycleSummary(analysis: Record<string, unknown> | null): string {
  if (!analysis) return '';
  const parts: string[] = [];
  if (typeof analysis.shardsCreated === 'number') parts.push(`${analysis.shardsCreated} created`);
  if (typeof analysis.promoted === 'number') parts.push(`${analysis.promoted} promoted`);
  if (typeof analysis.decayed === 'number') parts.push(`${analysis.decayed} decayed`);
  if (typeof analysis.evolved === 'number') parts.push(`${analysis.evolved} evolved`);
  if (typeof analysis.lessons === 'number') parts.push(`${analysis.lessons} lessons`);
  if (typeof analysis.clustersFormed === 'number') parts.push(`${analysis.clustersFormed} clusters`);
  if (typeof analysis.migrated === 'number') parts.push(`${analysis.migrated} migrated`);
  if (typeof analysis.reset === 'number') parts.push(`${analysis.reset} reset`);
  if (parts.length === 0) {
    const keys = Object.keys(analysis).filter(k => typeof analysis[k] === 'number').slice(0, 3);
    keys.forEach(k => parts.push(`${k}: ${analysis[k]}`));
  }
  return parts.join(', ');
}
