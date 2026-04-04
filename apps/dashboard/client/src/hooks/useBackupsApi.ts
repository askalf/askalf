// Centralized API layer for Backup Administration

const getApiBase = () => {
  if (window.location.hostname.includes('askalf.org')) return 'https://api.askalf.org';
  return '';
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

export interface BackupJob {
  id: string;
  type: 'full' | 'data-only' | 'incremental';
  trigger: 'scheduled' | 'manual' | 'restore' | 'startup';
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  filePath: string | null;
  fileSize: number | null;
  compressed: boolean;
  encrypted: boolean;
  manifest: BackupManifest;
  errorMessage: string | null;
  errorDetails: Record<string, unknown> | null;
  triggeredBy: string | null;
  createdAt: string;
}

export interface BackupManifest {
  databases?: string[];
  databaseSizes?: Record<string, number>;
  tableCount?: number;
  [key: string]: unknown;
}

export interface BackupStats {
  totalBackups: number;
  successfulBackups: number;
  failedBackups: number;
  totalSizeBytes: number;
  avgDurationMs: number | null;
  lastSuccessfulAt: string | null;
  lastFailedAt: string | null;
  serviceStatus: 'healthy' | 'unhealthy';
}

export interface BackupConfig {
  scheduleEnabled: boolean;
  scheduleCron: string;
  retentionDays: number;
  retentionWeeks: number;
  retentionMonths: number;
  compressionEnabled: boolean;
  encryptionEnabled: boolean;
  notifyOnFailure: boolean;
  notifyOnSuccess: boolean;
  notifyEmail: string | null;
}

export interface DatabaseInfo {
  name: string;
  sizeBytes: number;
}

export interface TableInfo {
  name: string;
  sizeBytes: number;
  rowEstimate: number;
}

export interface TriggerOptions {
  type: string;
  databases?: string[];
}

export interface RestoreOptions {
  dryRun: boolean;
  databases?: string[];
}

// ============================
// API methods
// ============================

export const backupsApi = {
  listJobs: (params: { status?: string; type?: string; limit: number; offset: number }) => {
    const q = buildParams(params);
    return apiFetch<{ jobs: BackupJob[]; total: number }>(`/api/admin/backups?${q}`);
  },

  getStats: () =>
    apiFetch<BackupStats>('/api/admin/backups/stats'),

  getConfig: () =>
    apiFetch<{ config: BackupConfig }>('/api/admin/backups/config'),

  getDatabases: () =>
    apiFetch<{ databases: DatabaseInfo[]; tables: TableInfo[] }>('/api/admin/backups/databases'),

  triggerBackup: (options: TriggerOptions) =>
    apiFetch<{ success: boolean; jobId?: string }>('/api/admin/backups/trigger', {
      method: 'POST',
      body: JSON.stringify(options),
    }),

  restoreBackup: (jobId: string, options: RestoreOptions) =>
    apiFetch<{ success: boolean; jobId?: string }>(`/api/admin/backups/${jobId}/restore`, {
      method: 'POST',
      body: JSON.stringify(options),
    }),

  saveConfig: (config: Partial<BackupConfig>) =>
    apiFetch<{ config: BackupConfig }>('/api/admin/backups/config', {
      method: 'PATCH',
      body: JSON.stringify(config),
    }),

  deleteJob: (jobId: string) =>
    apiFetch<void>(`/api/admin/backups/${jobId}`, { method: 'DELETE' }),
};

// ============================
// Helpers
// ============================

export function formatBytes(bytes: number | string | null | undefined): string {
  const n = Number(bytes);
  if (!n || n === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(n) / Math.log(k));
  return parseFloat((n / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export function formatDuration(ms: number | string | null | undefined): string {
  const n = Number(ms);
  if (!n) return '-';
  if (n < 1000) return `${n}ms`;
  if (n < 60000) return `${(n / 1000).toFixed(1)}s`;
  return `${Math.floor(n / 60000)}m ${Math.floor((n % 60000) / 1000)}s`;
}

export function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
}

export function timeAgo(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const hours = Math.floor(diff / (1000 * 60 * 60));
  if (hours < 1) return 'Just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
