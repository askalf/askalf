import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/auth';
import AdminAssistantPanel from '../components/admin/AdminAssistantPanel';
import './Convergence.css';

// ============================================
// TYPES
// ============================================

interface DailyData {
  date: string;
  totalQueries: number;
  shardHits: number;
  shardHitRate: number;
  estimatedCostPerQuery: number;
}

interface KnowledgeTypeStat {
  type: string;
  count: number;
}

interface CategoryConvergence {
  category: string;
  convergenceScore: number;
  hitRate: number;
  avgConfidence: number;
  promotedShards: number;
  tokensSaved: number;
}

interface MaturityBreakdown {
  verification: { status: string; count: number }[];
  lifecycle: { stage: string; count: number }[];
}

interface FeedbackHealth {
  signals: { type: string; count: number }[];
  acceptanceRate: number;
  correctionRate: number;
  totalSignals: number;
}

interface ImpactMetrics {
  tokensSaved: number;
  avgShardLatencyMs: number;
  totalExecutions: number;
  environmental: {
    powerWhSaved: number;
    waterMlSaved: number;
    carbonGSaved: number;
  };
}

interface TopShard {
  id: string;
  name: string;
  category: string;
  confidence: number;
  hits: number;
  tokensSaved: number;
}

interface ConvergenceData {
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

interface CycleRun {
  id: string;
  event_type: string;
  analysis: Record<string, unknown> | null;
  success: boolean | null;
  processing_time_ms: number | null;
  created_at: string;
}

interface MetaStatus {
  status: string;
  events: { total: number; last24h: number; avgConfidence: number };
  metaShards: { total: number; reflection: number; strategy: number; learning: number; correction: number };
}

interface MetaInsights {
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

interface MetaEvent {
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

interface WorkerHealth {
  status: string;
  uptime?: number;
  jobs?: { processed: number; failed: number; active: number };
  queues?: Record<string, { active: number; waiting: number; completed: number; failed: number }>;
  circuitBreakers?: Record<string, { isOpen: boolean; failures: number }>;
  config?: Record<string, unknown>;
  error?: string;
}

// ============================================
// CONSTANTS
// ============================================

const getApiUrl = () => {
  const host = window.location.hostname;
  if (host.includes('askalf.org')) return 'https://api.askalf.org';
  if (host === 'localhost' || host === '127.0.0.1') return 'http://localhost:3000';
  return '';
};

const API_BASE = getApiUrl();

type TabKey = 'overview' | 'internals' | 'engine' | 'metacognition' | 'system';

const LIFECYCLE_STAGES = ['candidate', 'testing', 'shadow', 'promoted'];

const VERIFICATION_CHIP_CLASS: Record<string, string> = {
  verified: 'chip-verified',
  unverified: 'chip-unverified',
  challenged: 'chip-challenged',
  failed: 'chip-failed',
};

const FEEDBACK_FILL_CLASS: Record<string, string> = {
  acceptance: 'feedback-fill-acceptance',
  correction: 'feedback-fill-correction',
  rephrase: 'feedback-fill-rephrase',
};

interface CycleConfig {
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

const CYCLES: CycleConfig[] = [
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

// ============================================
// HELPERS
// ============================================

// Human-readable category names for consumers
const CATEGORY_DISPLAY_NAMES: Record<string, string> = {
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

// Get expertise level based on shard count and confidence
function getExpertiseLevel(shardCount: number, confidence: number): {
  level: 'expert' | 'proficient' | 'learning' | 'new';
  label: string;
  description: string;
} {
  // Combine shard count and confidence for expertise score
  // More shards + higher confidence = deeper expertise
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

function getCategoryDisplayName(category: string): string {
  return CATEGORY_DISPLAY_NAMES[category.toLowerCase()] ||
    category.charAt(0).toUpperCase() + category.slice(1).replace(/_/g, ' ');
}

function formatPower(wh: number): string {
  if (wh >= 1000) return `${(wh / 1000).toFixed(2)} kWh`;
  return `${wh.toFixed(1)} Wh`;
}

function formatWater(ml: number): string {
  if (ml >= 1000) return `${(ml / 1000).toFixed(2)} L`;
  return `${ml.toFixed(0)} mL`;
}

function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return '--';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatUptime(seconds: number | undefined): string {
  if (!seconds) return '--';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return `${h}h ${m}m`;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function cycleSummary(analysis: Record<string, unknown> | null): string {
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
    // Fallback: show first few keys
    const keys = Object.keys(analysis).filter(k => typeof analysis[k] === 'number').slice(0, 3);
    keys.forEach(k => parts.push(`${k}: ${analysis[k]}`));
  }
  return parts.join(', ');
}

// ============================================
// ANIMATED NUMBER COMPONENT
// ============================================

function AnimatedNumber({ value, decimals = 0, prefix = '', suffix = '' }: {
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
}) {
  const [display, setDisplay] = useState(0);
  const prevRef = useRef(0);

  useEffect(() => {
    const start = prevRef.current;
    const end = value;
    if (start === end) return;
    const duration = 800;
    const startTime = performance.now();

    const tick = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = start + (end - start) * eased;
      setDisplay(current);
      if (progress < 1) requestAnimationFrame(tick);
      else prevRef.current = end;
    };

    requestAnimationFrame(tick);
  }, [value]);

  if (decimals > 0) return <>{prefix}{display.toFixed(decimals)}{suffix}</>;
  return <>{prefix}{Math.round(display).toLocaleString()}{suffix}</>;
}

// ============================================
// CONVERGENCE RING
// ============================================

function ConvergenceRing({ percent }: { percent: number }) {
  const radius = 50;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percent / 100) * circumference;

  return (
    <div className="convergence-ring-container">
      <svg className="convergence-ring-svg" viewBox="0 0 120 120" width="120" height="120">
        <defs>
          <linearGradient id="convergenceRingGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#10b981" />
            <stop offset="100%" stopColor="#34d399" />
          </linearGradient>
        </defs>
        <circle className="convergence-ring-bg" cx="60" cy="60" r={radius} />
        <circle
          className="convergence-ring-progress"
          cx="60" cy="60" r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="convergence-ring-value">
        <div className="convergence-ring-percent">
          <AnimatedNumber value={Math.round(percent)} />
        </div>
        <div className="convergence-ring-unit">%</div>
      </div>
    </div>
  );
}

// ============================================
// SVG ICONS
// ============================================

const CardIcon = ({ type }: { type: string }) => {
  const icons: Record<string, JSX.Element> = {
    bolt: (
      <svg viewBox="0 0 20 20" fill="currentColor">
        <path d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" />
      </svg>
    ),
    dollar: (
      <svg viewBox="0 0 20 20" fill="currentColor">
        <path d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.736 6.979C9.208 6.193 9.696 6 10 6c.304 0 .792.193 1.264.979a1 1 0 001.715-1.029C12.279 4.784 11.232 4 10 4s-2.279.784-2.979 1.95c-.285.475-.507 1-.67 1.55H6a1 1 0 000 2h.013a9.358 9.358 0 000 1H6a1 1 0 100 2h.351c.163.55.385 1.075.67 1.55C7.721 15.216 8.768 16 10 16s2.279-.784 2.979-1.95a1 1 0 10-1.715-1.029C10.792 13.807 10.304 14 10 14c-.304 0-.792-.193-1.264-.979a5.372 5.372 0 01-.422-.89H10a1 1 0 100-2H8.006a7.39 7.39 0 010-1H10a1 1 0 100-2H8.314c.135-.328.282-.633.422-.89z" />
      </svg>
    ),
    water: (
      <svg viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M10 2a1 1 0 01.78.375l4 5A1 1 0 0115 8v2a5 5 0 01-10 0V8a1 1 0 01.22-.625l4-5A1 1 0 0110 2zm-3 6.22V10a3 3 0 006 0V8.22l-3-3.75-3 3.75z" clipRule="evenodd" />
      </svg>
    ),
    power: (
      <svg viewBox="0 0 20 20" fill="currentColor">
        <path d="M11 3a1 1 0 10-2 0v1a1 1 0 102 0V3zM15.657 5.757a1 1 0 00-1.414-1.414l-.707.707a1 1 0 001.414 1.414l.707-.707zM18 10a1 1 0 01-1 1h-1a1 1 0 110-2h1a1 1 0 011 1zM5.05 6.464A1 1 0 106.464 5.05l-.707-.707a1 1 0 00-1.414 1.414l.707.707zM5 10a1 1 0 01-1 1H3a1 1 0 110-2h1a1 1 0 011 1zM8 16v-1h4v1a2 2 0 11-4 0zM12 14c.015-.34.208-.646.477-.859a4 4 0 10-4.954 0c.27.213.462.519.476.859h4.002z" />
      </svg>
    ),
    token: (
      <svg viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
      </svg>
    ),
    brain: (
      <svg viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M6.672 1.911a1 1 0 10-1.932.518l.259.966a1 1 0 001.932-.518l-.26-.966zM2.429 4.74a1 1 0 10-.517 1.932l.966.259a1 1 0 00.517-1.932l-.966-.26zm8.814-.569a1 1 0 00-1.415-1.414l-.707.707a1 1 0 101.415 1.415l.707-.708zm-7.071 7.072l.707-.707A1 1 0 003.465 9.12l-.708.707a1 1 0 001.415 1.415zm3.2-5.171a1 1 0 00-1.3 1.3l4 10a1 1 0 001.823.075l1.38-2.759 3.018 3.02a1 1 0 001.414-1.415l-3.019-3.02 2.76-1.379a1 1 0 00-.076-1.822l-10-4z" clipRule="evenodd" />
      </svg>
    ),
    clock: (
      <svg viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
      </svg>
    ),
    refresh: (
      <svg viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
      </svg>
    ),
  };
  return <div className={`convergence-card-icon-wrap icon-${type}`}>{icons[type] || null}</div>;
};

const TabIcon = ({ tab }: { tab: TabKey }) => {
  const icons: Record<TabKey, JSX.Element> = {
    overview: (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="2" y="2" width="5" height="5" rx="1" />
        <rect x="9" y="2" width="5" height="5" rx="1" />
        <rect x="2" y="9" width="5" height="5" rx="1" />
        <rect x="9" y="9" width="5" height="5" rx="1" />
      </svg>
    ),
    internals: (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M2 4h12M2 8h12M2 12h12" />
        <circle cx="5" cy="4" r="1" fill="currentColor" />
        <circle cx="10" cy="8" r="1" fill="currentColor" />
        <circle cx="7" cy="12" r="1" fill="currentColor" />
      </svg>
    ),
    engine: (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="8" cy="8" r="3" />
        <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" />
      </svg>
    ),
    metacognition: (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="8" cy="6" r="4" />
        <path d="M5 14c0-1.657 1.343-3 3-3s3 1.343 3 3" />
        <path d="M8 4v4M6 6h4" />
      </svg>
    ),
    system: (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="2" y="3" width="12" height="8" rx="1" />
        <path d="M6 14h4M8 11v3" />
        <circle cx="8" cy="7" r="1" fill="currentColor" />
      </svg>
    ),
  };
  return <span className="convergence-tab-icon">{icons[tab]}</span>;
};

// ============================================
// COMPONENT
// ============================================

export default function Convergence() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';

  useEffect(() => { document.title = 'Convergence — Ask ALF'; }, []);

  // Core state
  const [data, setData] = useState<ConvergenceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Tab state
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const refreshRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);

  // Category pagination
  const [categoryPage, setCategoryPage] = useState(1);
  const [internalsCategoryPage, setInternalsCategoryPage] = useState(1);
  const CATEGORIES_PER_PAGE = 8;

  // Metabolic engine state
  const [cycleRunning, setCycleRunning] = useState<string | null>(null);
  const [cycleResult, setCycleResult] = useState<{ cycle: string; result: unknown; success: boolean; timestamp: Date } | null>(null);
  const [cycleHistory, setCycleHistory] = useState<CycleRun[]>([]);

  // Metacognition state
  const [metaStatus, setMetaStatus] = useState<MetaStatus | null>(null);
  const [metaInsights, setMetaInsights] = useState<MetaInsights | null>(null);
  const [metaEvents, setMetaEvents] = useState<MetaEvent[]>([]);
  const [metaEventFilter, setMetaEventFilter] = useState<string>('');

  // System state
  const [workerHealth, setWorkerHealth] = useState<WorkerHealth | null>(null);

  // Timestamps
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // ============================================
  // FETCH FUNCTIONS
  // ============================================

  const fetchConvergence = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/convergence`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch convergence data');
      const json = await res.json();
      setData(json);
      setError(null);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    }
  }, []);

  const fetchCycleHistory = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/admin/cycle-history?limit=20`, { credentials: 'include' });
      if (res.ok) {
        const json = await res.json();
        setCycleHistory(json.runs || []);
      }
    } catch { /* silent */ }
  }, []);

  const fetchMetaStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/meta/status`, { credentials: 'include' });
      if (res.ok) setMetaStatus(await res.json());
    } catch { /* silent */ }
  }, []);

  const fetchMetaInsights = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/meta/insights`, { credentials: 'include' });
      if (res.ok) setMetaInsights(await res.json());
    } catch { /* silent */ }
  }, []);

  const fetchMetaEvents = useCallback(async () => {
    try {
      const url = metaEventFilter
        ? `${API_BASE}/api/v1/meta/events?limit=50&type=${metaEventFilter}`
        : `${API_BASE}/api/v1/meta/events?limit=50`;
      const res = await fetch(url, { credentials: 'include' });
      if (res.ok) {
        const json = await res.json();
        setMetaEvents(json.events || []);
      }
    } catch { /* silent */ }
  }, [metaEventFilter]);

  const fetchWorkerHealth = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/admin/worker-health`, { credentials: 'include' });
      if (res.ok) setWorkerHealth(await res.json());
      else setWorkerHealth({ status: 'unreachable', error: 'Failed to reach worker' });
    } catch {
      setWorkerHealth({ status: 'unreachable', error: 'Network error' });
    }
  }, []);

  // ============================================
  // EFFECTS
  // ============================================

  useEffect(() => {
    if (!user) { navigate('/login'); return; }
    setLoading(true);
    fetchConvergence().finally(() => setLoading(false));
  }, [user, navigate, fetchConvergence]);

  // Load tab-specific data on tab switch
  useEffect(() => {
    if (!isAdmin) return;
    if (activeTab === 'engine') fetchCycleHistory();
    if (activeTab === 'metacognition') { fetchMetaStatus(); fetchMetaInsights(); fetchMetaEvents(); }
    if (activeTab === 'system') fetchWorkerHealth();
  }, [activeTab, isAdmin, fetchCycleHistory, fetchMetaStatus, fetchMetaInsights, fetchMetaEvents, fetchWorkerHealth]);

  // Re-fetch meta events when filter changes
  useEffect(() => {
    if (activeTab === 'metacognition' && isAdmin) fetchMetaEvents();
  }, [metaEventFilter, activeTab, isAdmin, fetchMetaEvents]);

  // Auto-refresh
  useEffect(() => {
    if (refreshRef.current) clearInterval(refreshRef.current);
    if (!autoRefresh) return;
    const interval = activeTab === 'system' ? 30000 : 15000;
    refreshRef.current = setInterval(() => {
      if (activeTab === 'overview' || activeTab === 'internals') fetchConvergence();
      if (activeTab === 'engine') fetchCycleHistory();
      if (activeTab === 'system') fetchWorkerHealth();
    }, interval);
    return () => { if (refreshRef.current) clearInterval(refreshRef.current); };
  }, [autoRefresh, activeTab, fetchConvergence, fetchCycleHistory, fetchWorkerHealth]);

  // ============================================
  // CYCLE TRIGGER
  // ============================================

  const triggerCycle = async (cycle: CycleConfig) => {
    // Confirmation for warning/danger
    if (cycle.danger === 'warning' || cycle.danger === 'moderate') {
      if (!window.confirm(cycle.confirmMessage || `Run ${cycle.name}?`)) return;
    }
    if (cycle.danger === 'danger') {
      if (!window.confirm(cycle.confirmMessage || `Run ${cycle.name}?`)) return;
      const typed = window.prompt('Type RESEED_CONFIRMED to proceed:');
      if (typed !== cycle.requireTypedConfirm) {
        alert('Confirmation did not match. Aborted.');
        return;
      }
    }

    setCycleRunning(cycle.key);
    setCycleResult(null);
    try {
      const res = await fetch(`${API_BASE}${cycle.endpoint}`, {
        method: cycle.method,
        credentials: 'include',
        headers: cycle.body ? { 'Content-Type': 'application/json' } : undefined,
        body: cycle.body ? JSON.stringify(cycle.body) : undefined,
      });
      const result = await res.json();
      setCycleResult({ cycle: cycle.key, result, success: res.ok, timestamp: new Date() });
      fetchCycleHistory();
    } catch (err) {
      setCycleResult({ cycle: cycle.key, result: { error: err instanceof Error ? err.message : 'Failed' }, success: false, timestamp: new Date() });
    } finally {
      setCycleRunning(null);
    }
  };

  // ============================================
  // LOADING / ERROR STATES
  // ============================================

  if (loading) {
    return (
      <div className="convergence-page">
        <div className="convergence-skeleton">
          <div className="convergence-skeleton-hero" />
          <div className="convergence-skeleton-cards">
            <div className="convergence-skeleton-card" />
            <div className="convergence-skeleton-card" />
            <div className="convergence-skeleton-card" />
            <div className="convergence-skeleton-card" />
          </div>
          <div className="convergence-skeleton-chart" />
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="convergence-page">
        <div className="convergence-error">
          <p>{error}</p>
          <button onClick={() => { setLoading(true); fetchConvergence().finally(() => setLoading(false)); }}>Try Again</button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  // ============================================
  // COMPUTED VALUES
  // ============================================

  const hasData = data.daily.length > 0;

  const tabLabels: { key: TabKey; label: string; adminOnly?: boolean }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'internals', label: 'Internals', adminOnly: true },
    { key: 'engine', label: 'Metabolic Engine', adminOnly: true },
    { key: 'metacognition', label: 'Metacognition', adminOnly: true },
    { key: 'system', label: 'System Status', adminOnly: true },
  ];

  const visibleTabs = tabLabels.filter(t => !t.adminOnly || isAdmin);

  // ============================================
  // RENDER: OVERVIEW TAB
  // ============================================

  const renderOverviewTab = () => (
    <>
      {!hasData ? (
        <div className="convergence-empty">
          <div className="convergence-empty-icon">👽</div>
          <h2>No Data Yet</h2>
          <p>
            Start chatting with ALF to see how it learns from your conversations.
            The more you use it, the more free answers you get.
          </p>
        </div>
      ) : (
        <>
          {/* Hero Stat: Convergence Ring */}
          <div className="convergence-hero">
            <ConvergenceRing percent={data.summary.currentHitRate * 100} />
            <div className="convergence-hero-content">
              <h2 className="convergence-hero-title">
                Your questions answered for free
              </h2>
              <p className="convergence-hero-label">
                ALF has learned enough to answer {Math.round(data.summary.currentHitRate * 100)}% of your queries
                without calling an external AI. The more you use it, the smarter it gets.
              </p>
              <span className={`convergence-hero-trend ${data.summary.trend}`}>
                {data.summary.trend === 'improving' ? (
                  <span className="convergence-trend-arrow">
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" width="14" height="14">
                      <path d="M8 12V4M4 8l4-4 4 4" />
                    </svg>
                  </span>
                ) : data.summary.trend === 'declining' ? (
                  <span className="convergence-trend-arrow">
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" width="14" height="14">
                      <path d="M8 4v8M4 8l4 4 4-4" />
                    </svg>
                  </span>
                ) : null}
                {data.summary.trend === 'improving' ? 'Getting smarter' : data.summary.trend === 'declining' ? 'Exploring new topics' : 'Stable'} this week
              </span>
            </div>
          </div>

          {/* Impact Cards — user-friendly metrics only */}
          <div className="convergence-cards">
            <div className="convergence-card">
              <CardIcon type="bolt" />
              <div className="convergence-card-content">
                <div className="convergence-card-value">
                  <AnimatedNumber value={data.summary.totalFreeAnswers} />
                </div>
                <div className="convergence-card-label">Free Answers This Month</div>
              </div>
            </div>
            <div className="convergence-card">
              <CardIcon type="dollar" />
              <div className="convergence-card-content">
                <div className="convergence-card-value">
                  <AnimatedNumber value={data.summary.estimatedMonthlySavings} prefix="$" decimals={2} />
                </div>
                <div className="convergence-card-label">Credits Saved</div>
              </div>
            </div>
            <div className="convergence-card">
              <CardIcon type="water" />
              <div className="convergence-card-content">
                <div className="convergence-card-value">
                  {data.impact ? formatWater(data.impact.environmental.waterMlSaved) : '0 mL'}
                </div>
                <div className="convergence-card-label">Water Saved</div>
              </div>
            </div>
            <div className="convergence-card">
              <CardIcon type="power" />
              <div className="convergence-card-content">
                <div className="convergence-card-value">
                  {data.impact ? formatPower(data.impact.environmental.powerWhSaved) : '0 Wh'}
                </div>
                <div className="convergence-card-label">Power Saved</div>
              </div>
            </div>
          </div>

          {/* Free Answer Rate Chart */}
          <div className="convergence-charts">
            <div className="convergence-chart-card" style={{ maxWidth: '100%' }}>
              <h3 className="convergence-chart-title">Free Answer Rate (the higher, the smarter ALF gets)</h3>
              <div className="convergence-bar-chart">
                {data.daily.map((day) => {
                  const hitPercent = day.shardHitRate * 100;
                  return (
                    <div key={day.date} className="convergence-bar">
                      <div className="convergence-bar-tooltip">
                        {new Date(day.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}: {hitPercent.toFixed(1)}% free
                      </div>
                      <div
                        className="convergence-bar-fill hit-rate"
                        style={{ height: `${Math.max(2, hitPercent)}%` }}
                      />
                      <span className="convergence-bar-label">
                        {new Date(day.date).getDate()}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* ALF's Expertise — consumer-friendly display */}
          {data.categories && data.categories.length > 0 && (() => {
            const totalCatPages = Math.ceil(data.categories.length / CATEGORIES_PER_PAGE);
            const pagedCategories = data.categories.slice(
              (categoryPage - 1) * CATEGORIES_PER_PAGE,
              categoryPage * CATEGORIES_PER_PAGE
            );
            return (
              <div className="convergence-expertise-section">
                <h3 className="convergence-section-title">Areas ALF Has Learned</h3>
                <p className="convergence-expertise-subtitle">
                  These are the topics where ALF has built knowledge from your conversations
                </p>
                <div className="convergence-expertise-grid">
                  {pagedCategories.map((cat) => {
                    const expertise = getExpertiseLevel(cat.promotedShards, cat.avgConfidence);
                    return (
                      <div key={cat.category} className={`convergence-expertise-card expertise-${expertise.level}`}>
                        <div className="convergence-expertise-header">
                          <span className="convergence-expertise-name">
                            {getCategoryDisplayName(cat.category)}
                          </span>
                          <span className={`convergence-expertise-badge badge-${expertise.level}`}>
                            {expertise.label}
                          </span>
                        </div>
                        <div className="convergence-expertise-stats">
                          <span className="convergence-expertise-count">
                            {cat.promotedShards} {cat.promotedShards === 1 ? 'pattern' : 'patterns'} learned
                          </span>
                        </div>
                        <div className="convergence-expertise-indicator">
                          <div className="convergence-expertise-dots">
                            <span className={`expertise-dot ${expertise.level === 'expert' || expertise.level === 'proficient' || expertise.level === 'learning' || expertise.level === 'new' ? 'active' : ''}`} />
                            <span className={`expertise-dot ${expertise.level === 'expert' || expertise.level === 'proficient' || expertise.level === 'learning' ? 'active' : ''}`} />
                            <span className={`expertise-dot ${expertise.level === 'expert' || expertise.level === 'proficient' ? 'active' : ''}`} />
                            <span className={`expertise-dot ${expertise.level === 'expert' ? 'active' : ''}`} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {totalCatPages > 1 && (
                  <div className="convergence-pagination">
                    <button
                      className="convergence-page-btn"
                      disabled={categoryPage <= 1}
                      onClick={() => setCategoryPage(p => p - 1)}
                    >
                      Prev
                    </button>
                    <span className="convergence-page-info">
                      {categoryPage} / {totalCatPages}
                    </span>
                    <button
                      className="convergence-page-btn"
                      disabled={categoryPage >= totalCatPages}
                      onClick={() => setCategoryPage(p => p + 1)}
                    >
                      Next
                    </button>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Explainer */}
          <div className="convergence-explainer">
            <p>
              Every other AI tool is a meter that runs. ALF is a brain that learns.
              The more you use it, the less it costs, the faster it gets, and the knowledge stays yours.
            </p>
          </div>
        </>
      )}
    </>
  );

  // ============================================
  // RENDER: INTERNALS TAB (admin only)
  // ============================================

  const renderInternalsTab = () => (
    <>
      {!hasData ? (
        <p className="convergence-no-data">No data available yet.</p>
      ) : (
        <>
          {/* Cost Per Query Chart */}
          <div className="convergence-charts">
            <div className="convergence-chart-card">
              <h3 className="convergence-chart-title">Cost Per Query</h3>
              <div className="convergence-bar-chart">
                {data.daily.map((day) => {
                  const maxCost = Math.max(...data.daily.map(d => d.estimatedCostPerQuery));
                  const height = maxCost > 0 ? (day.estimatedCostPerQuery / maxCost) * 100 : 0;
                  return (
                    <div key={day.date} className="convergence-bar">
                      <div className="convergence-bar-tooltip">
                        {new Date(day.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}: ${day.estimatedCostPerQuery.toFixed(5)}
                      </div>
                      <div
                        className="convergence-bar-fill cost"
                        style={{ height: `${Math.max(2, height)}%` }}
                      />
                      <span className="convergence-bar-label">
                        {new Date(day.date).getDate()}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="convergence-chart-card">
              <h3 className="convergence-chart-title">Shard Hit Rate %</h3>
              <div className="convergence-bar-chart">
                {data.daily.map((day) => {
                  const hitPercent = day.shardHitRate * 100;
                  return (
                    <div key={day.date} className="convergence-bar">
                      <div className="convergence-bar-tooltip">
                        {new Date(day.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}: {hitPercent.toFixed(1)}%
                      </div>
                      <div
                        className="convergence-bar-fill hit-rate"
                        style={{ height: `${Math.max(2, hitPercent)}%` }}
                      />
                      <span className="convergence-bar-label">
                        {new Date(day.date).getDate()}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Detailed Impact Metrics */}
          <div className="convergence-cards">
            <div className="convergence-card">
              <CardIcon type="token" />
              <div className="convergence-card-content">
                <div className="convergence-card-value">
                  <AnimatedNumber value={data.impact ? data.impact.tokensSaved : 0} />
                </div>
                <div className="convergence-card-label">Tokens Saved</div>
              </div>
            </div>
            <div className="convergence-card">
              <CardIcon type="brain" />
              <div className="convergence-card-content">
                <div className="convergence-card-value">
                  <AnimatedNumber value={data.summary.activeShards} />
                </div>
                <div className="convergence-card-label">Active Shards</div>
              </div>
            </div>
            <div className="convergence-card">
              <CardIcon type="clock" />
              <div className="convergence-card-content">
                <div className="convergence-card-value">
                  {data.impact ? `${data.impact.avgShardLatencyMs}ms` : '--'}
                </div>
                <div className="convergence-card-label">Avg Shard Latency</div>
              </div>
            </div>
            <div className="convergence-card">
              <CardIcon type="refresh" />
              <div className="convergence-card-content">
                <div className="convergence-card-value">
                  <AnimatedNumber value={data.impact ? data.impact.totalExecutions : 0} />
                </div>
                <div className="convergence-card-label">Total Executions</div>
              </div>
            </div>
          </div>

          {/* Per-Domain Convergence (full detail) */}
          {data.categories && data.categories.length > 0 && (() => {
            const totalIntCatPages = Math.ceil(data.categories.length / CATEGORIES_PER_PAGE);
            const pagedIntCategories = data.categories.slice(
              (internalsCategoryPage - 1) * CATEGORIES_PER_PAGE,
              internalsCategoryPage * CATEGORIES_PER_PAGE
            );
            return (
              <div className="convergence-domain-section">
                <h3 className="convergence-section-title">Per-Domain Convergence</h3>
                <div className="convergence-domain-list">
                  {pagedIntCategories.map((cat) => (
                    <div key={cat.category} className="convergence-domain-item">
                      <div className="convergence-domain-header">
                        <span className="convergence-domain-name">{cat.category}</span>
                        <span className="convergence-domain-score">{cat.convergenceScore}%</span>
                      </div>
                      <div className="convergence-domain-bar">
                        <div
                          className="convergence-domain-bar-fill"
                          style={{ width: `${cat.convergenceScore}%` }}
                        />
                      </div>
                      <div className="convergence-domain-meta">
                        <span>Hit rate: {Math.round(cat.hitRate * 100)}%</span>
                        <span>Confidence: {Math.round(cat.avgConfidence * 100)}%</span>
                        <span>Shards: {cat.promotedShards}</span>
                        <span>Tokens saved: {cat.tokensSaved.toLocaleString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
                {totalIntCatPages > 1 && (
                  <div className="convergence-pagination">
                    <button
                      className="convergence-page-btn"
                      disabled={internalsCategoryPage <= 1}
                      onClick={() => setInternalsCategoryPage(p => p - 1)}
                    >
                      Prev
                    </button>
                    <span className="convergence-page-info">
                      {internalsCategoryPage} / {totalIntCatPages}
                    </span>
                    <button
                      className="convergence-page-btn"
                      disabled={internalsCategoryPage >= totalIntCatPages}
                      onClick={() => setInternalsCategoryPage(p => p + 1)}
                    >
                      Next
                    </button>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Knowledge Architecture */}
          {data.knowledgeTypes && data.knowledgeTypes.length > 0 && (
            <div className="convergence-kt-section">
              <h3 className="convergence-kt-title">Knowledge Architecture</h3>
              <div className="convergence-kt-grid">
                {data.knowledgeTypes.map((kt) => {
                  const total = data.knowledgeTypes!.reduce((s, k) => s + k.count, 0);
                  const pct = total > 0 ? Math.round((kt.count / total) * 100) : 0;
                  return (
                    <div key={kt.type} className={`convergence-kt-item kt-${kt.type}`}>
                      <div className="convergence-kt-bar">
                        <div
                          className={`convergence-kt-bar-fill kt-fill-${kt.type}`}
                          style={{ width: `${Math.max(4, pct)}%` }}
                        />
                      </div>
                      <div className="convergence-kt-meta">
                        <span className="convergence-kt-name">{kt.type}</span>
                        <span className="convergence-kt-value">{kt.count} ({pct}%)</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Verification Chips */}
              {data.maturity && data.maturity.verification.length > 0 && (
                <div className="convergence-verification">
                  {data.maturity.verification.map((v) => (
                    <span
                      key={v.status}
                      className={`convergence-verification-chip ${VERIFICATION_CHIP_CLASS[v.status] || 'chip-unverified'}`}
                    >
                      {v.status}: {v.count}
                    </span>
                  ))}
                </div>
              )}

              {/* Lifecycle Pipeline */}
              {data.maturity && data.maturity.lifecycle.length > 0 && (
                <div className="convergence-lifecycle">
                  <div className="convergence-lifecycle-label">Lifecycle Pipeline</div>
                  <div className="convergence-pipeline">
                    {LIFECYCLE_STAGES.map((stage) => {
                      const entry = data.maturity!.lifecycle.find(l => l.stage === stage);
                      const count = entry ? entry.count : 0;
                      return (
                        <div
                          key={stage}
                          className={`convergence-pipeline-stage ${stage === 'promoted' ? 'stage-promoted' : ''}`}
                        >
                          <span className="convergence-pipeline-count">{count}</span>
                          <span className="convergence-pipeline-name">{stage}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Feedback Health */}
          {data.feedback && data.feedback.totalSignals > 0 && (
            <div className="convergence-feedback-section">
              <h3 className="convergence-section-title">Feedback Health</h3>
              <div className="convergence-feedback-bars">
                {data.feedback.signals.map((sig) => {
                  const pct = data.feedback!.totalSignals > 0
                    ? Math.round((sig.count / data.feedback!.totalSignals) * 100)
                    : 0;
                  return (
                    <div key={sig.type} className="convergence-feedback-row">
                      <span className="convergence-feedback-label">{sig.type}</span>
                      <div className="convergence-feedback-track">
                        <div
                          className={`convergence-feedback-fill ${FEEDBACK_FILL_CLASS[sig.type] || 'feedback-fill-default'}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="convergence-feedback-rate">{pct}%</span>
                    </div>
                  );
                })}
                <div className="convergence-feedback-summary">
                  <span>Acceptance rate: {Math.round(data.feedback.acceptanceRate * 100)}%</span>
                  <span>Correction rate: {Math.round(data.feedback.correctionRate * 100)}%</span>
                  <span>Total signals: {data.feedback.totalSignals}</span>
                </div>
              </div>
            </div>
          )}

          {/* Top Performing Shards */}
          {data.topShards && data.topShards.length > 0 && (
            <div className="convergence-topshards-section">
              <h3 className="convergence-section-title">Top Performing Shards</h3>
              <table className="convergence-topshards-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Category</th>
                    <th>Hits</th>
                    <th>Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topShards.map((shard) => (
                    <tr key={shard.id}>
                      <td className="convergence-topshards-name">{shard.name}</td>
                      <td>
                        <span className="convergence-topshards-category">{shard.category}</span>
                      </td>
                      <td>{shard.hits}</td>
                      <td className="convergence-topshards-confidence">
                        {Math.round(shard.confidence * 100)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

        </>
      )}
    </>
  );

  // ============================================
  // RENDER: METABOLIC ENGINE TAB
  // ============================================

  const renderEngineTab = () => {
    const lastCrystallize = cycleHistory.find(r => r.event_type === 'crystallize');
    const promotedToday = data.maturity?.lifecycle.find(l => l.stage === 'promoted')?.count ?? 0;
    const lifecycleCounts = LIFECYCLE_STAGES.map(s => ({
      stage: s,
      count: data.maturity?.lifecycle.find(l => l.stage === s)?.count ?? 0,
    }));
    const decayRuns = cycleHistory.filter(r => r.event_type === 'decay');

    return (
      <>
        {/* KPI Strip */}
        <div className="convergence-engine-kpi">
          <div className="convergence-kpi-card">
            <div className="convergence-kpi-value">{lastCrystallize ? timeAgo(lastCrystallize.created_at) : '--'}</div>
            <div className="convergence-kpi-label">Last Crystallize</div>
          </div>
          <div className="convergence-kpi-card">
            <div className="convergence-kpi-value">{promotedToday}</div>
            <div className="convergence-kpi-label">Promoted Shards</div>
          </div>
          <div className="convergence-kpi-card">
            <div className="convergence-kpi-value">
              {lifecycleCounts.map(l => l.count).join(' / ')}
            </div>
            <div className="convergence-kpi-label">
              {lifecycleCounts.map(l => l.stage.charAt(0).toUpperCase()).join(' / ')}
            </div>
          </div>
          <div className="convergence-kpi-card">
            <div className="convergence-kpi-value">{decayRuns.length}</div>
            <div className="convergence-kpi-label">Decay Runs</div>
          </div>
        </div>

        {/* Cycle Control Grid */}
        <h3 className="convergence-section-title">Cycle Controls</h3>
        <div className="convergence-cycle-grid">
          {CYCLES.map((cycle) => {
            const isRunning = cycleRunning === cycle.key;
            const lastResult = cycleResult?.cycle === cycle.key ? cycleResult : null;
            const lastRun = cycleHistory.find(r =>
              r.event_type === cycle.key ||
              r.event_type === cycle.name.toLowerCase() ||
              r.event_type.includes(cycle.key.replace('-', '_'))
            );

            return (
              <div key={cycle.key} className={`convergence-cycle-card cycle-${cycle.danger}`}>
                <div className="convergence-cycle-header">
                  <span className="convergence-cycle-name">{cycle.name}</span>
                  {cycle.danger !== 'safe' && (
                    <span className={`convergence-cycle-badge badge-${cycle.danger}`}>
                      {cycle.danger}
                    </span>
                  )}
                </div>
                <p className="convergence-cycle-desc">{cycle.description}</p>
                {lastRun && (
                  <div className="convergence-cycle-last-run">
                    Last: {timeAgo(lastRun.created_at)}
                  </div>
                )}
                <button
                  className={`convergence-cycle-trigger trigger-${cycle.danger}`}
                  onClick={() => triggerCycle(cycle)}
                  disabled={cycleRunning !== null}
                >
                  {isRunning ? (
                    <><span className="cycle-spinner" /> Running...</>
                  ) : (
                    `Run ${cycle.name}`
                  )}
                </button>
                {lastResult && (
                  <div className={`convergence-cycle-result ${lastResult.success ? 'result-success' : 'result-failure'}`}>
                    {lastResult.success ? 'Success' : 'Failed'}
                    {lastResult.result != null && typeof lastResult.result === 'object' ? (
                      <span className="convergence-cycle-result-detail">
                        {cycleSummary(lastResult.result as Record<string, unknown>)}
                      </span>
                    ) : null}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Recent History */}
        <h3 className="convergence-section-title" style={{ marginTop: 32 }}>Recent Cycle History</h3>
        {cycleHistory.length === 0 ? (
          <p className="convergence-no-data">No cycle runs recorded yet.</p>
        ) : (
          <div className="convergence-history-scroll">
            <table className="convergence-topshards-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Cycle</th>
                  <th>Duration</th>
                  <th>Status</th>
                  <th>Summary</th>
                </tr>
              </thead>
              <tbody>
                {cycleHistory.map((run) => (
                  <tr key={run.id}>
                    <td>{timeAgo(run.created_at)}</td>
                    <td><span className="convergence-topshards-category">{run.event_type}</span></td>
                    <td>{formatDuration(run.processing_time_ms)}</td>
                    <td>
                      <span className={`convergence-status-chip ${run.success ? 'status-success' : run.success === false ? 'status-failure' : 'status-unknown'}`}>
                        {run.success ? 'OK' : run.success === false ? 'FAIL' : '--'}
                      </span>
                    </td>
                    <td className="convergence-history-summary">{cycleSummary(run.analysis)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </>
    );
  };

  // ============================================
  // RENDER: METACOGNITION TAB
  // ============================================

  const renderMetacognitionTab = () => (
    <>
      {/* Status Section */}
      <h3 className="convergence-section-title">System Status</h3>
      {metaStatus ? (
        <div className="convergence-meta-status">
          <div className="convergence-kpi-card">
            <div className="convergence-kpi-value">{metaStatus.events.total.toLocaleString()}</div>
            <div className="convergence-kpi-label">Total Events</div>
          </div>
          <div className="convergence-kpi-card">
            <div className="convergence-kpi-value">{metaStatus.events.last24h}</div>
            <div className="convergence-kpi-label">Last 24h</div>
          </div>
          <div className="convergence-kpi-card">
            <div className="convergence-kpi-value">{(metaStatus.events.avgConfidence * 100).toFixed(1)}%</div>
            <div className="convergence-kpi-label">Avg Confidence</div>
          </div>
          <div className="convergence-kpi-card">
            <div className="convergence-kpi-value">{metaStatus.metaShards.total}</div>
            <div className="convergence-kpi-label">Meta Shards</div>
          </div>
        </div>
      ) : (
        <p className="convergence-no-data">Loading status...</p>
      )}

      {/* Meta Shard Breakdown */}
      {metaStatus && metaStatus.metaShards.total > 0 && (
        <div className="convergence-meta-breakdown">
          <div className="convergence-meta-shard-row">
            <span className="convergence-meta-shard-count">{metaStatus.metaShards.reflection}</span>
            <span className="convergence-meta-shard-type">Reflection</span>
          </div>
          <div className="convergence-meta-shard-row">
            <span className="convergence-meta-shard-count">{metaStatus.metaShards.strategy}</span>
            <span className="convergence-meta-shard-type">Strategy</span>
          </div>
          <div className="convergence-meta-shard-row">
            <span className="convergence-meta-shard-count">{metaStatus.metaShards.learning}</span>
            <span className="convergence-meta-shard-type">Learning</span>
          </div>
          <div className="convergence-meta-shard-row">
            <span className="convergence-meta-shard-count">{metaStatus.metaShards.correction}</span>
            <span className="convergence-meta-shard-type">Correction</span>
          </div>
        </div>
      )}

      {/* Insights Panel */}
      {metaInsights && (
        <>
          <h3 className="convergence-section-title" style={{ marginTop: 32 }}>Insights</h3>

          {/* Error Rate */}
          <div className="convergence-meta-error-rate">
            <span>Error Rate (24h):</span>
            <strong>
              {metaInsights.insights.errorRate.total > 0
                ? `${(metaInsights.insights.errorRate.rate * 100).toFixed(1)}%`
                : 'No data'}
            </strong>
            <span className="convergence-meta-error-detail">
              ({metaInsights.insights.errorRate.errors}/{metaInsights.insights.errorRate.total} traces)
            </span>
          </div>

          {/* Trending Intents */}
          {metaInsights.insights.trendingIntents.length > 0 && (
            <div className="convergence-meta-trending">
              <h4>Trending Intents</h4>
              <div className="convergence-meta-trending-list">
                {metaInsights.insights.trendingIntents.map((t) => (
                  <div key={t.intent} className="convergence-meta-trending-item">
                    <span className="convergence-meta-trending-name">{t.intent || 'uncategorized'}</span>
                    <span className="convergence-meta-trending-count">{t.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Low Confidence Shards */}
          {metaInsights.insights.lowConfidenceShards.length > 0 && (
            <div className="convergence-meta-low-conf">
              <h4>Low Confidence Shards</h4>
              <table className="convergence-topshards-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Confidence</th>
                    <th>Executions</th>
                    <th>Success Rate</th>
                    <th>Recommendation</th>
                  </tr>
                </thead>
                <tbody>
                  {metaInsights.insights.lowConfidenceShards.map((s) => (
                    <tr key={s.id}>
                      <td className="convergence-topshards-name">{s.name}</td>
                      <td className="convergence-low-conf-value">{Math.round(s.confidence * 100)}%</td>
                      <td>{s.executions}</td>
                      <td>{s.successRate != null ? `${Math.round(s.successRate * 100)}%` : '--'}</td>
                      <td className="convergence-recommendation">{s.recommendation}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Event Log */}
      <h3 className="convergence-section-title" style={{ marginTop: 32 }}>Event Log</h3>
      <div className="convergence-meta-filter">
        <select
          value={metaEventFilter}
          onChange={(e) => setMetaEventFilter(e.target.value)}
          className="convergence-meta-filter-select"
        >
          <option value="">All types</option>
          <option value="reflection">Reflection</option>
          <option value="strategy">Strategy</option>
          <option value="learning_proposal">Learning</option>
          <option value="correction">Correction</option>
          <option value="crystallize">Crystallize</option>
          <option value="decay">Decay</option>
          <option value="promote">Promote</option>
        </select>
      </div>
      {metaEvents.length === 0 ? (
        <p className="convergence-no-data">No events found.</p>
      ) : (
        <div className="convergence-event-log-scroll">
          <table className="convergence-topshards-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Type</th>
                <th>Confidence</th>
                <th>Action</th>
                <th>Outcome</th>
                <th>Success</th>
              </tr>
            </thead>
            <tbody>
              {metaEvents.map((evt) => (
                <tr key={evt.id}>
                  <td>{timeAgo(evt.createdAt)}</td>
                  <td><span className="convergence-topshards-category">{evt.type}</span></td>
                  <td>{evt.confidence != null ? `${Math.round(evt.confidence * 100)}%` : '--'}</td>
                  <td>{evt.action || '--'}</td>
                  <td className="convergence-history-summary">{evt.outcome || '--'}</td>
                  <td>
                    <span className={`convergence-status-chip ${evt.success ? 'status-success' : evt.success === false ? 'status-failure' : 'status-unknown'}`}>
                      {evt.success ? 'OK' : evt.success === false ? 'FAIL' : '--'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );

  // ============================================
  // RENDER: SYSTEM STATUS TAB
  // ============================================

  const renderSystemTab = () => (
    <>
      {/* Worker Health */}
      <h3 className="convergence-section-title">Worker Health</h3>
      {workerHealth ? (
        <div className="convergence-worker-card">
          <div className="convergence-worker-status">
            <span className={`convergence-status-dot ${workerHealth.status === 'healthy' || workerHealth.status === 'ok' ? 'dot-healthy' : 'dot-unhealthy'}`} />
            <span className="convergence-worker-status-text">
              {workerHealth.status === 'healthy' || workerHealth.status === 'ok' ? 'Healthy' : workerHealth.status}
            </span>
          </div>
          {workerHealth.uptime != null && (
            <div className="convergence-worker-metric">
              <span className="convergence-worker-metric-label">Uptime</span>
              <span className="convergence-worker-metric-value">{formatUptime(workerHealth.uptime)}</span>
            </div>
          )}
          {workerHealth.jobs && (
            <div className="convergence-worker-metrics-grid">
              <div className="convergence-worker-metric">
                <span className="convergence-worker-metric-value">{workerHealth.jobs.processed}</span>
                <span className="convergence-worker-metric-label">Processed</span>
              </div>
              <div className="convergence-worker-metric">
                <span className="convergence-worker-metric-value">{workerHealth.jobs.failed}</span>
                <span className="convergence-worker-metric-label">Failed</span>
              </div>
              <div className="convergence-worker-metric">
                <span className="convergence-worker-metric-value">{workerHealth.jobs.active}</span>
                <span className="convergence-worker-metric-label">Active</span>
              </div>
            </div>
          )}
          {workerHealth.error && (
            <div className="convergence-worker-error">{workerHealth.error}</div>
          )}
        </div>
      ) : (
        <p className="convergence-no-data">Loading worker health...</p>
      )}

      {/* Queue Status */}
      {workerHealth?.queues && Object.keys(workerHealth.queues).length > 0 && (
        <>
          <h3 className="convergence-section-title" style={{ marginTop: 32 }}>Queue Status</h3>
          <div className="convergence-queue-grid">
            {Object.entries(workerHealth.queues).map(([name, q]) => (
              <div key={name} className="convergence-queue-card">
                <div className="convergence-queue-name">{name}</div>
                <div className="convergence-queue-metrics">
                  <span className="convergence-queue-metric">
                    <span className="convergence-queue-metric-value">{q.active}</span> active
                  </span>
                  <span className="convergence-queue-metric">
                    <span className="convergence-queue-metric-value">{q.waiting}</span> waiting
                  </span>
                  <span className="convergence-queue-metric">
                    <span className="convergence-queue-metric-value">{q.completed}</span> done
                  </span>
                  <span className="convergence-queue-metric">
                    <span className="convergence-queue-metric-value convergence-queue-failed">{q.failed}</span> failed
                  </span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Circuit Breakers */}
      {workerHealth?.circuitBreakers && Object.keys(workerHealth.circuitBreakers).length > 0 && (
        <>
          <h3 className="convergence-section-title" style={{ marginTop: 32 }}>Circuit Breakers</h3>
          <div className="convergence-breaker-grid">
            {Object.entries(workerHealth.circuitBreakers).map(([name, cb]) => (
              <div key={name} className={`convergence-breaker-chip ${cb.isOpen ? 'breaker-open' : 'breaker-closed'}`}>
                <span className={`convergence-status-dot ${cb.isOpen ? 'dot-unhealthy' : 'dot-healthy'}`} />
                <span className="convergence-breaker-name">{name}</span>
                <span className="convergence-breaker-state">{cb.isOpen ? 'open' : 'closed'}</span>
                {cb.failures > 0 && <span className="convergence-breaker-failures">({cb.failures} failures)</span>}
              </div>
            ))}
          </div>
        </>
      )}

      {/* Config Display */}
      {workerHealth?.config && Object.keys(workerHealth.config).length > 0 && (
        <>
          <h3 className="convergence-section-title" style={{ marginTop: 32 }}>Configuration</h3>
          <div className="convergence-config-card">
            {Object.entries(workerHealth.config).map(([key, value]) => (
              <div key={key} className="convergence-config-row">
                <span className="convergence-config-key">{key}</span>
                <span className="convergence-config-value">{JSON.stringify(value)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );

  // ============================================
  // MAIN RENDER
  // ============================================

  return (
    <div className={`convergence-page ${assistantOpen ? 'panel-open' : ''}`}>
     <div className="convergence-main">
      <div className="convergence-header">
        <div className="convergence-header-left">
          <h1>Convergence Dashboard</h1>
          <p className="convergence-subtitle">
            {autoRefresh && <span className="convergence-live-dot" />}
            Unlike every other AI tool, ALF's cost goes down the more you use it.
            {lastUpdated && (
              <span className="convergence-last-updated">
                Updated {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </p>
        </div>
        <div className="convergence-header-right">
          <label className="convergence-refresh-toggle">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            Auto-refresh
          </label>
          <button className="convergence-refresh-btn" onClick={() => {
            if (activeTab === 'overview' || activeTab === 'internals') fetchConvergence();
            if (activeTab === 'engine') fetchCycleHistory();
            if (activeTab === 'metacognition') { fetchMetaStatus(); fetchMetaInsights(); fetchMetaEvents(); }
            if (activeTab === 'system') fetchWorkerHealth();
          }}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
              <path d="M14 8A6 6 0 1 1 8 2" />
              <path d="M14 2v6h-6" />
            </svg>
          </button>
          <button className={`admin-assistant-toggle ${assistantOpen ? 'active' : ''}`} onClick={() => setAssistantOpen(!assistantOpen)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2a3 3 0 0 0-3 3v1a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
              <path d="M19 10H5a2 2 0 0 0-2 2v1a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-1a2 2 0 0 0-2-2Z" />
              <path d="M12 15v4" />
              <path d="M8 19h8" />
            </svg>
            Assistant
          </button>
        </div>
      </div>

      {/* Tab Navigation */}
      <nav className="convergence-tab-nav">
        {visibleTabs.map(({ key, label }) => (
          <button
            key={key}
            className={`convergence-tab-btn${activeTab === key ? ' active' : ''}`}
            onClick={() => setActiveTab(key)}
          >
            <TabIcon tab={key} />
            {label}
          </button>
        ))}
      </nav>

      {/* Tab Panel */}
      <div className="convergence-tab-panel" key={activeTab}>
        {activeTab === 'overview' && renderOverviewTab()}
        {activeTab === 'internals' && isAdmin && renderInternalsTab()}
        {activeTab === 'engine' && isAdmin && renderEngineTab()}
        {activeTab === 'metacognition' && isAdmin && renderMetacognitionTab()}
        {activeTab === 'system' && isAdmin && renderSystemTab()}
      </div>
     </div>

      <AdminAssistantPanel
        isOpen={assistantOpen}
        onToggle={() => setAssistantOpen(!assistantOpen)}
        activeTier="procedural"
        pageContext="convergence"
      />
    </div>
  );
}
