import { create } from 'zustand';

// ============================================
// Types
// ============================================

export type ReviewStatus = 'pending_review' | 'reviewed' | 'approved' | 'rejected' | 'merged' | null;

export interface GitSpaceBranch {
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

// ============================================
// API helpers
// ============================================

async function apiFetch<T = unknown>(path: string, options?: RequestInit): Promise<T> {
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

// ============================================
// Store
// ============================================

interface DiffCacheEntry {
  diffText: string;
  diffStats: DiffStats;
  diffFiles: DiffFile[];
  commits: CommitInfo[];
  diffTruncated: boolean;
  ts: number;
}

interface GitSpaceState {
  // Branch list
  branches: GitSpaceBranch[];
  branchesLoading: boolean;
  fetchBranches: () => Promise<void>;

  // Selected branch + diff
  selectedBranch: string | null;
  setSelectedBranch: (branch: string | null) => void;
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
  reviewOpen: boolean;
  setReviewOpen: (open: boolean) => void;
  reviewLoading: boolean;
  reviewExecutionId: string | null;
  reviewCompleted: boolean;
  requestAiReview: () => Promise<void>;
  sendReviewMessage: (msg: string) => Promise<void>;
  pollReviewResult: () => void;
  canMerge: boolean;

  // Health check
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
  deployServices: (services: string[]) => Promise<boolean>;

  // Deploy tasks (rebuild/restart with scheduling)
  deployTasks: DeployTask[];
  activeDeployTask: DeployTask | null;
  deployTasksLoading: boolean;
  startDeploy: (services: string[], action: 'rebuild' | 'restart', scheduledAt?: string) => Promise<string | null>;
  pollDeployTask: (taskId: string) => void;
  cancelDeployTask: (taskId: string) => Promise<boolean>;
  fetchDeployTasks: () => Promise<void>;

  // Reject
  rejecting: boolean;
  rejectBranch: (feedback: string) => Promise<boolean>;
}

export const useGitSpaceStore = create<GitSpaceState>((set, get) => ({
  // Branch list
  branches: [],
  branchesLoading: false,
  fetchBranches: async () => {
    set({ branchesLoading: true });
    try {
      const data = await apiFetch<{ branches: GitSpaceBranch[] }>('/api/v1/admin/git-space/branches');
      set({ branches: data.branches || [] });
    } catch (err) {
      console.error('[GitSpace] Failed to fetch branches:', err);
    } finally {
      set({ branchesLoading: false });
    }
  },

  // Selected branch
  selectedBranch: null,
  setSelectedBranch: (branch) => {
    set({
      selectedBranch: branch,
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
      healthChecking: false,
    });
    if (branch) {
      get().fetchDiff(branch);
      // Check if branch already has a completed review (from review_status)
      const branchData = get().branches.find(b => b.name === branch);
      if (branchData?.review_status === 'reviewed' || branchData?.review_status === 'approved') {
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
    // Check cache first (60s TTL) — makes branch switching instant
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
      const data = await apiFetch<{
        diff: string;
        truncated: boolean;
        stats: DiffStats;
        commits: CommitInfo[];
        files: DiffFile[];
      }>(`/api/v1/admin/git-space/diff/${encodeURIComponent(branch)}`);

      const entry: DiffCacheEntry = {
        diffText: data.diff,
        diffTruncated: data.truncated,
        diffStats: data.stats || { files: 0, additions: 0, deletions: 0 },
        commits: data.commits || [],
        diffFiles: data.files || [],
        ts: Date.now(),
      };
      cache.set(branch, entry);

      set({
        diffText: data.diff,
        diffTruncated: data.truncated,
        diffStats: data.stats || { files: 0, additions: 0, deletions: 0 },
        commits: data.commits || [],
        diffFiles: data.files || [],
      });
    } catch (err) {
      console.error('[GitSpace] Failed to fetch diff:', err);
    } finally {
      set({ diffLoading: false });
    }
  },

  // AI Review
  reviewMessages: [],
  reviewOpen: false,
  setReviewOpen: (open) => set({ reviewOpen: open }),
  reviewLoading: false,
  reviewExecutionId: null,
  reviewCompleted: false,
  canMerge: false,

  // Health check
  healthResults: {},
  healthChecking: false,
  checkHealth: async (services) => {
    set({ healthChecking: true });
    const results: Record<string, { running: boolean; status: string }> = {};
    for (const svc of services) {
      try {
        const data = await apiFetch<{ running: boolean; status: string }>(
          `/api/v1/admin/git-space/health/${encodeURIComponent(svc)}`,
        );
        results[svc] = { running: data.running, status: data.status };
      } catch {
        results[svc] = { running: false, status: 'error' };
      }
    }
    set({ healthResults: results, healthChecking: false });
  },

  pollReviewResult: () => {
    const { reviewExecutionId } = get();
    if (!reviewExecutionId) return;

    let attempts = 0;
    const MAX_ATTEMPTS = 120; // 10 minutes max (120 × 5s)

    const interval = setInterval(async () => {
      const { reviewExecutionId: currentId } = get();
      attempts++;

      // Stop if executionId cleared or max attempts reached
      if (!currentId || attempts >= MAX_ATTEMPTS) {
        clearInterval(interval);
        if (attempts >= MAX_ATTEMPTS) {
          set((s) => ({
            reviewLoading: false,
            reviewExecutionId: null,
            reviewMessages: [
              ...s.reviewMessages,
              { role: 'assistant' as const, content: 'Review timed out after 10 minutes.' },
            ],
          }));
        }
        return;
      }

      try {
        const data = await apiFetch<{
          status: string;
          summary?: string;
          issues?: Array<{ severity: string; file?: string; line?: number; message: string }>;
          suggestions?: Array<{ file?: string; message: string }>;
          approved?: boolean;
          error?: string;
          output?: string;
        }>(
          `/api/v1/admin/git-space/review-result/${currentId}`,
        );

        if (data.status === 'completed') {
          clearInterval(interval);
          // Format structured review into readable message
          let content = data.summary || 'Review complete.';
          if (data.issues && data.issues.length > 0) {
            content += '\n\n**Issues:**\n' + data.issues.map(i =>
              `- [${i.severity}] ${i.file ? `${i.file}${i.line ? `:${i.line}` : ''}: ` : ''}${i.message}`
            ).join('\n');
          }
          if (data.suggestions && data.suggestions.length > 0) {
            content += '\n\n**Suggestions:**\n' + data.suggestions.map(s =>
              `- ${s.file ? `${s.file}: ` : ''}${s.message}`
            ).join('\n');
          }
          content += `\n\n**Verdict:** ${data.approved ? 'Approved' : 'Changes Requested'}`;

          set((s) => ({
            reviewLoading: false,
            reviewCompleted: true,
            canMerge: data.approved !== false,
            reviewExecutionId: null,
            reviewMessages: [
              ...s.reviewMessages,
              { role: 'assistant' as const, content },
            ],
          }));
        } else if (data.status === 'failed') {
          clearInterval(interval);
          set((s) => ({
            reviewLoading: false,
            reviewExecutionId: null,
            reviewMessages: [
              ...s.reviewMessages,
              { role: 'assistant' as const, content: `Review failed: ${data.error || data.output || 'Unknown error'}` },
            ],
          }));
        }
        // else still running, keep polling
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
      const data = await apiFetch<{ review_id?: string; execution_id?: string; agent_name?: string }>(
        '/api/v1/admin/git-space/ai-review',
        { method: 'POST', body: JSON.stringify({ branch: selectedBranch, diff: diffText }) },
      );

      const reviewId = data.review_id || data.execution_id || '';
      set((s) => ({
        reviewExecutionId: reviewId,
        reviewMessages: [
          ...s.reviewMessages,
          { role: 'assistant' as const, content: `Review started by ${data.agent_name || 'AI Reviewer'}. Waiting for results...` },
        ],
      }));

      // Start polling for results
      get().pollReviewResult();
    } catch (err) {
      set((s) => ({
        reviewLoading: false,
        reviewMessages: [
          ...s.reviewMessages,
          { role: 'assistant' as const, content: `Review failed: ${err instanceof Error ? err.message : String(err)}` },
        ],
      }));
    }
  },

  sendReviewMessage: async (msg) => {
    const { reviewExecutionId } = get();
    if (!reviewExecutionId) return;

    set((s) => ({
      reviewMessages: [...s.reviewMessages, { role: 'user' as const, content: msg }],
      reviewLoading: true,
    }));

    try {
      const data = await apiFetch<{ response?: string; execution_id?: string }>(
        '/api/v1/admin/git-space/ai-review/chat',
        { method: 'POST', body: JSON.stringify({ review_id: reviewExecutionId, message: msg }) },
      );

      // Chat returns immediate text response, not a new execution
      if (data.response) {
        set((s) => ({
          reviewLoading: false,
          reviewMessages: [
            ...s.reviewMessages,
            { role: 'assistant' as const, content: data.response as string },
          ],
        }));
      } else if (data.execution_id) {
        // Fallback: new execution to poll
        set({ reviewExecutionId: data.execution_id });
        get().pollReviewResult();
      } else {
        set({ reviewLoading: false });
      }
    } catch (err) {
      set((s) => ({
        reviewLoading: false,
        reviewMessages: [
          ...s.reviewMessages,
          { role: 'assistant' as const, content: `Error: ${err instanceof Error ? err.message : String(err)}` },
        ],
      }));
    }
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
      const data = await apiFetch<{ success: boolean; merge_commit: string; message: string }>(
        '/api/v1/admin/git-space/merge',
        { method: 'POST', body: JSON.stringify({ branch: selectedBranch }) },
      );
      if (data.success) {
        set({ merged: true, mergeResult: data });
        // Refresh branch list
        get().fetchBranches();
        return true;
      }
      return false;
    } catch (err) {
      console.error('[GitSpace] Merge failed:', err);
      return false;
    } finally {
      set({ merging: false });
    }
  },

  // Deploy
  deploying: false,
  deployServices: async (services) => {
    set({ deploying: true });
    try {
      await apiFetch('/api/v1/admin/git-space/deploy', {
        method: 'POST',
        body: JSON.stringify({ services }),
      });
      return true;
    } catch (err) {
      console.error('[GitSpace] Deploy failed:', err);
      return false;
    } finally {
      set({ deploying: false });
    }
  },

  // Deploy tasks (rebuild/restart with scheduling)
  deployTasks: [],
  activeDeployTask: null,
  deployTasksLoading: false,

  startDeploy: async (services, action, scheduledAt) => {
    set({ deploying: true });
    try {
      const data = await apiFetch<{ task_id: string }>('/api/v1/admin/git-space/rebuild', {
        method: 'POST',
        body: JSON.stringify({
          services,
          action,
          scheduled_at: scheduledAt || undefined,
          branch: get().selectedBranch || undefined,
        }),
      });
      if (data.task_id && !scheduledAt) {
        // Start polling for immediate tasks
        get().pollDeployTask(data.task_id);
      }
      // Refresh task list
      get().fetchDeployTasks();
      return data.task_id;
    } catch (err) {
      console.error('[GitSpace] Deploy failed:', err);
      return null;
    } finally {
      set({ deploying: false });
    }
  },

  pollDeployTask: (taskId) => {
    const poll = async () => {
      try {
        const data = await apiFetch<DeployTask>(`/api/v1/admin/git-space/rebuild/${taskId}`);
        set({ activeDeployTask: data });
        if (data.status === 'running' || data.live_status === 'running') {
          setTimeout(poll, 3000);
        } else {
          // Refresh task list when done
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
      await apiFetch(`/api/v1/admin/git-space/rebuild/${taskId}`, { method: 'DELETE' });
      get().fetchDeployTasks();
      return true;
    } catch (err) {
      console.error('[GitSpace] Cancel failed:', err);
      return false;
    }
  },

  fetchDeployTasks: async () => {
    set({ deployTasksLoading: true });
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = await apiFetch<{ tasks: any[] }>('/api/v1/admin/git-space/rebuild/tasks');
      const tasks: DeployTask[] = (data.tasks || []).map((t) => ({
        id: t.id || t.task_id || t.builder_id || '',
        action: t.action || 'rebuild',
        services: t.services || [],
        status: t.status || 'unknown',
        scheduled_at: t.scheduled_at || null,
        started_at: t.started_at || t.created_at || null,
        completed_at: t.completed_at || null,
        builder_id: t.builder_id || null,
        logs: t.logs || '',
        exit_code: t.exit_code ?? null,
        triggered_by: t.triggered_by || null,
        branch: t.branch || null,
        created_at: t.created_at || new Date().toISOString(),
      }));
      set({ deployTasks: tasks });
    } catch (err) {
      console.error('[GitSpace] Failed to fetch deploy tasks:', err);
    } finally {
      set({ deployTasksLoading: false });
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
      await apiFetch(`/api/v1/admin/interventions/${branch.intervention_id}/respond`, {
        method: 'POST',
        body: JSON.stringify({ action: 'deny', feedback }),
      });
      get().fetchBranches();
      set({ selectedBranch: null });
      return true;
    } catch (err) {
      console.error('[GitSpace] Reject failed:', err);
      return false;
    } finally {
      set({ rejecting: false });
    }
  },
}));
