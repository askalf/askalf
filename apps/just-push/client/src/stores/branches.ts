import { create } from 'zustand';

// Types (from git-space.ts)

export type ReviewStatus = 'pending_review' | 'reviewed' | 'approved' | 'rejected' | 'merged' | null;

export interface Branch {
  name: string;
  agent_slug: string;
  agent_name: string;
  agent_id: string | null;
  commits: number;
  files_changed: number;
  last_date: string | null;
  intervention_id: string | null;
  intervention_status: string | null;
  review_status: ReviewStatus;
}

export interface DiffStats {
  files: number;
  additions: number;
  deletions: number;
}

export interface CommitInfo {
  hash: string;
  subject: string;
  author: string;
  date: string;
}

export interface DiffFile {
  path: string;
  additions: number;
  deletions: number;
}

export interface ReviewMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface DeployTask {
  id: string;
  action: 'rebuild' | 'restart';
  services: string[];
  status: 'pending' | 'scheduled' | 'running' | 'completed' | 'failed' | 'cancelled';
  scheduled_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  builder_id: string | null;
  logs: string;
  exit_code: number | null;
  triggered_by: string | null;
  branch: string | null;
  created_at: string;
  live_status?: string;
}

// API helper

async function api<T = unknown>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || res.statusText);
  }
  return res.json();
}

// Diff cache

interface DiffCacheEntry {
  diffText: string;
  diffStats: DiffStats;
  diffFiles: DiffFile[];
  commits: CommitInfo[];
  diffTruncated: boolean;
  ts: number;
}

// Store

interface BranchStore {
  // Branches
  branches: Branch[];
  loading: boolean;
  fetchBranches: () => Promise<void>;

  // Selected branch + diff
  selectedBranch: string | null;
  selectBranch: (name: string | null) => void;
  diffText: string;
  diffStats: DiffStats;
  diffFiles: DiffFile[];
  commits: CommitInfo[];
  diffLoading: boolean;
  diffTruncated: boolean;
  diffCache: Map<string, DiffCacheEntry>;
  fetchDiff: (branch: string) => Promise<void>;

  // AI Review
  reviewMessages: ReviewMessage[];
  reviewLoading: boolean;
  reviewExecutionId: string | null;
  reviewCompleted: boolean;
  canMerge: boolean;
  requestAiReview: () => Promise<void>;
  sendReviewMessage: (msg: string) => Promise<void>;
  pollReviewResult: () => void;

  // Health
  healthResults: Record<string, { running: boolean; status: string }>;
  healthChecking: boolean;
  checkHealth: (services: string[]) => Promise<void>;

  // Merge
  merging: boolean;
  merged: boolean;
  mergeResult: { merge_commit?: string; message?: string } | null;
  mergeBranch: () => Promise<boolean>;

  // Deploy
  deploying: boolean;
  deployTasks: DeployTask[];
  activeDeployTask: DeployTask | null;
  startDeploy: (services: string[], action: 'rebuild' | 'restart', scheduledAt?: string) => Promise<string | null>;
  pollDeployTask: (taskId: string) => void;
  cancelDeployTask: (taskId: string) => Promise<boolean>;
  fetchDeployTasks: () => Promise<void>;

  // Reject
  rejecting: boolean;
  rejectBranch: (feedback: string) => Promise<boolean>;
}

export const useBranchStore = create<BranchStore>((set, get) => ({
  // Branches
  branches: [],
  loading: false,
  fetchBranches: async () => {
    set({ loading: true });
    try {
      const data = await api<{ branches: Branch[] }>('/api/branches');
      set({ branches: data.branches || [] });
    } catch (err) {
      console.error('[JustPush] fetch branches:', err);
    } finally {
      set({ loading: false });
    }
  },

  // Selected branch
  selectedBranch: null,
  selectBranch: (name) => {
    set({
      selectedBranch: name,
      diffText: '',
      diffStats: { files: 0, additions: 0, deletions: 0 },
      diffFiles: [],
      commits: [],
      diffTruncated: false,
      merged: false,
      mergeResult: null,
      reviewMessages: [],
      reviewExecutionId: null,
      reviewCompleted: false,
      canMerge: false,
      healthResults: {},
    });
    if (name) {
      get().fetchDiff(name);
      const b = get().branches.find((br) => br.name === name);
      if (b?.review_status === 'reviewed' || b?.review_status === 'approved') {
        set({ reviewCompleted: true, canMerge: true });
      }
    }
  },

  // Diff
  diffText: '',
  diffStats: { files: 0, additions: 0, deletions: 0 },
  diffFiles: [],
  commits: [],
  diffLoading: false,
  diffTruncated: false,
  diffCache: new Map(),
  fetchDiff: async (branch) => {
    const cache = get().diffCache;
    const cached = cache.get(branch);
    if (cached && Date.now() - cached.ts < 60_000) {
      set({
        diffText: cached.diffText,
        diffTruncated: cached.diffTruncated,
        diffStats: cached.diffStats,
        commits: cached.commits,
        diffFiles: cached.diffFiles,
        diffLoading: false,
      });
      return;
    }

    set({ diffLoading: true });
    try {
      const data = await api<{
        diff: string;
        truncated: boolean;
        stats: DiffStats;
        commits: CommitInfo[];
        files: DiffFile[];
      }>(`/api/diff/${encodeURIComponent(branch)}`);

      const entry: DiffCacheEntry = {
        diffText: data.diff,
        diffTruncated: data.truncated,
        diffStats: data.stats,
        commits: data.commits,
        diffFiles: data.files,
        ts: Date.now(),
      };
      cache.set(branch, entry);

      set({
        diffText: data.diff,
        diffTruncated: data.truncated,
        diffStats: data.stats,
        commits: data.commits,
        diffFiles: data.files,
      });
    } catch (err) {
      console.error('[JustPush] fetch diff:', err);
    } finally {
      set({ diffLoading: false });
    }
  },

  // AI Review
  reviewMessages: [],
  reviewLoading: false,
  reviewExecutionId: null,
  reviewCompleted: false,
  canMerge: false,

  pollReviewResult: () => {
    const { reviewExecutionId } = get();
    if (!reviewExecutionId) return;
    let attempts = 0;
    const interval = setInterval(async () => {
      attempts++;
      const { reviewExecutionId: currentId } = get();
      if (!currentId || attempts >= 120) {
        clearInterval(interval);
        if (attempts >= 120) {
          set((s) => ({
            reviewLoading: false,
            reviewExecutionId: null,
            reviewMessages: [...s.reviewMessages, { role: 'assistant' as const, content: 'Review timed out after 10 minutes.' }],
          }));
        }
        return;
      }
      try {
        const data = await api<{ status: string; output: string | null }>(`/api/review-result/${currentId}`);
        if (data.status === 'completed' && data.output) {
          clearInterval(interval);
          set((s) => ({
            reviewLoading: false,
            reviewCompleted: true,
            canMerge: true,
            reviewExecutionId: null,
            reviewMessages: [...s.reviewMessages, { role: 'assistant' as const, content: data.output || 'Review completed.' }],
          }));
        } else if (data.status === 'failed') {
          clearInterval(interval);
          set((s) => ({
            reviewLoading: false,
            reviewExecutionId: null,
            reviewMessages: [...s.reviewMessages, { role: 'assistant' as const, content: `Review failed: ${data.output || 'Unknown error'}` }],
          }));
        }
      } catch {
        clearInterval(interval);
        set({ reviewLoading: false, reviewExecutionId: null });
      }
    }, 5000);
  },

  requestAiReview: async () => {
    const { selectedBranch, diffText } = get();
    if (!selectedBranch || !diffText) return;
    set({ reviewLoading: true });
    try {
      const data = await api<{ execution_id: string; agent_name: string }>('/api/ai-review', {
        method: 'POST',
        body: JSON.stringify({ branch: selectedBranch, diff: diffText }),
      });
      set((s) => ({
        reviewExecutionId: data.execution_id,
        reviewMessages: [...s.reviewMessages, { role: 'assistant' as const, content: `Review started by ${data.agent_name}. Analyzing...` }],
      }));
      get().pollReviewResult();
    } catch (err) {
      set((s) => ({
        reviewLoading: false,
        reviewMessages: [...s.reviewMessages, { role: 'assistant' as const, content: `Review failed: ${err instanceof Error ? err.message : String(err)}` }],
      }));
    }
  },

  sendReviewMessage: async (msg) => {
    const { selectedBranch, diffText } = get();
    if (!selectedBranch) return;
    set((s) => ({
      reviewMessages: [...s.reviewMessages, { role: 'user' as const, content: msg }],
      reviewLoading: true,
    }));
    try {
      const data = await api<{ execution_id: string }>('/api/ai-review/chat', {
        method: 'POST',
        body: JSON.stringify({ branch: selectedBranch, diff: diffText, message: msg }),
      });
      set({ reviewExecutionId: data.execution_id });
      get().pollReviewResult();
    } catch (err) {
      set((s) => ({
        reviewLoading: false,
        reviewMessages: [...s.reviewMessages, { role: 'assistant' as const, content: `Error: ${err instanceof Error ? err.message : String(err)}` }],
      }));
    }
  },

  // Health
  healthResults: {},
  healthChecking: false,
  checkHealth: async (services) => {
    set({ healthChecking: true });
    const results: Record<string, { running: boolean; status: string }> = {};
    for (const svc of services) {
      try {
        const data = await api<{ running: boolean; status: string }>(`/api/health/${encodeURIComponent(svc)}`);
        results[svc] = data;
      } catch {
        results[svc] = { running: false, status: 'error' };
      }
    }
    set({ healthResults: results, healthChecking: false });
  },

  // Merge
  merging: false,
  merged: false,
  mergeResult: null,
  mergeBranch: async () => {
    const { selectedBranch } = get();
    if (!selectedBranch) return false;
    set({ merging: true });
    try {
      const data = await api<{ success: boolean; merge_commit: string; message: string }>('/api/merge', {
        method: 'POST',
        body: JSON.stringify({ branch: selectedBranch }),
      });
      if (data.success) {
        set({ merged: true, mergeResult: data });
        get().fetchBranches();
        return true;
      }
      return false;
    } catch (err) {
      console.error('[JustPush] merge:', err);
      return false;
    } finally {
      set({ merging: false });
    }
  },

  // Deploy
  deploying: false,
  deployTasks: [],
  activeDeployTask: null,
  startDeploy: async (services, action, scheduledAt) => {
    set({ deploying: true });
    try {
      const data = await api<{ task_id: string }>('/api/rebuild', {
        method: 'POST',
        body: JSON.stringify({
          services,
          action,
          scheduled_at: scheduledAt || undefined,
          branch: get().selectedBranch || undefined,
        }),
      });
      if (data.task_id && !scheduledAt) {
        get().pollDeployTask(data.task_id);
      }
      get().fetchDeployTasks();
      return data.task_id;
    } catch (err) {
      console.error('[JustPush] deploy:', err);
      return null;
    } finally {
      set({ deploying: false });
    }
  },

  pollDeployTask: (taskId) => {
    const poll = async () => {
      try {
        const data = await api<DeployTask>(`/api/rebuild/${taskId}`);
        set({ activeDeployTask: data });
        if (data.status === 'running' || data.live_status === 'running') {
          setTimeout(poll, 3000);
        } else {
          get().fetchDeployTasks();
        }
      } catch {
        set({ activeDeployTask: null });
      }
    };
    poll();
  },

  cancelDeployTask: async (taskId) => {
    try {
      await api(`/api/rebuild/${taskId}`, { method: 'DELETE' });
      get().fetchDeployTasks();
      return true;
    } catch {
      return false;
    }
  },

  fetchDeployTasks: async () => {
    try {
      const data = await api<{ tasks: DeployTask[] }>('/api/rebuild/tasks');
      set({ deployTasks: data.tasks || [] });
    } catch (err) {
      console.error('[JustPush] fetch tasks:', err);
    }
  },

  // Reject
  rejecting: false,
  rejectBranch: async (feedback) => {
    const { selectedBranch, branches } = get();
    if (!selectedBranch) return false;
    const branch = branches.find((b) => b.name === selectedBranch);
    if (!branch?.intervention_id) return false;
    set({ rejecting: true });
    try {
      await api(`/api/interventions/${branch.intervention_id}/respond`, {
        method: 'POST',
        body: JSON.stringify({ action: 'deny', feedback }),
      });
      get().fetchBranches();
      set({ selectedBranch: null });
      return true;
    } catch {
      return false;
    } finally {
      set({ rejecting: false });
    }
  },
}));
