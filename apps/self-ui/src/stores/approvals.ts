import { create } from 'zustand';
import * as approvalsApi from '../api/approvals';
import type { Approval } from '../api/approvals';

const PAGE_SIZE = 20;

interface ApprovalsState {
  approvals: Approval[];
  total: number;
  pendingCount: number;
  isLoading: boolean;
  isLoadingMore: boolean;
  error: string | null;
  statusFilter: 'pending' | 'approved' | 'rejected' | 'all';

  fetchApprovals: () => Promise<void>;
  loadMore: () => Promise<void>;
  setStatusFilter: (status: ApprovalsState['statusFilter']) => void;
  approve: (id: string) => Promise<void>;
  reject: (id: string, reason?: string) => Promise<void>;
}

export const useApprovalsStore = create<ApprovalsState>((set, get) => ({
  approvals: [],
  total: 0,
  pendingCount: 0,
  isLoading: false,
  isLoadingMore: false,
  error: null,
  statusFilter: 'pending',

  fetchApprovals: async () => {
    set({ isLoading: true, error: null });
    try {
      const filter = get().statusFilter;
      const data = await approvalsApi.getApprovals({
        status: filter === 'all' ? undefined : filter,
        limit: PAGE_SIZE,
      });
      set({
        approvals: data.approvals,
        total: data.total ?? data.approvals.length,
        pendingCount: data.pendingCount,
        isLoading: false,
      });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to load approvals', isLoading: false });
    }
  },

  loadMore: async () => {
    const { approvals, total, statusFilter, isLoadingMore } = get();
    if (isLoadingMore || approvals.length >= total) return;
    set({ isLoadingMore: true });
    try {
      const data = await approvalsApi.getApprovals({
        status: statusFilter === 'all' ? undefined : statusFilter,
        limit: PAGE_SIZE,
        offset: approvals.length,
      });
      set((s) => ({
        approvals: [...s.approvals, ...data.approvals],
        total: data.total ?? s.total,
        pendingCount: data.pendingCount,
        isLoadingMore: false,
      }));
    } catch (err) {
      set({ isLoadingMore: false, error: err instanceof Error ? err.message : 'Failed to load more' });
    }
  },

  setStatusFilter: (status) => {
    set({ statusFilter: status });
    get().fetchApprovals();
  },

  approve: async (id: string) => {
    try {
      const data = await approvalsApi.approveAction(id);
      set((s) => ({
        approvals: s.approvals.map((a) => (a.id === id ? data.approval : a)),
        pendingCount: Math.max(0, s.pendingCount - 1),
      }));
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to approve' });
    }
  },

  reject: async (id: string, reason?: string) => {
    try {
      const data = await approvalsApi.rejectAction(id, reason);
      set((s) => ({
        approvals: s.approvals.map((a) => (a.id === id ? data.approval : a)),
        pendingCount: Math.max(0, s.pendingCount - 1),
      }));
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to reject' });
    }
  },
}));
