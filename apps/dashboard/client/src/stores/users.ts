import { create } from 'zustand';
import { usersApi, type User, type UserDetails, type Plan, type AdminStats } from '../hooks/useUsersApi';

type SortColumn = 'name' | 'role' | 'status' | 'plan' | 'createdAt' | 'lastLoginAt';
type SortDirection = 'asc' | 'desc';

interface ConfirmAction {
  type: 'delete' | 'plan-change' | 'bulk-delete' | 'bulk-suspend' | 'bulk-activate';
  userId?: string;
  label: string;
  onConfirm: () => void;
}

interface UsersState {
  // Data
  users: User[];
  plans: Plan[];
  stats: AdminStats | null;
  total: number;

  // Filters
  search: string;
  roleFilter: string;
  statusFilter: string;
  planFilter: string;
  sortColumn: SortColumn;
  sortDirection: SortDirection;
  setSearch: (s: string) => void;
  setRoleFilter: (s: string) => void;
  setStatusFilter: (s: string) => void;
  setPlanFilter: (s: string) => void;
  toggleSort: (col: SortColumn) => void;

  // Pagination
  page: number;
  limit: number;
  setPage: (p: number) => void;

  // Selection
  selectedUser: UserDetails | null;
  setSelectedUser: (u: UserDetails | null) => void;
  selectedIds: Set<string>;
  toggleSelection: (id: string) => void;
  toggleSelectAll: () => void;
  clearSelection: () => void;

  // Modals
  editingUser: User | null;
  setEditingUser: (u: User | null) => void;
  showCreateModal: boolean;
  setShowCreateModal: (v: boolean) => void;
  confirmAction: ConfirmAction | null;
  setConfirmAction: (a: ConfirmAction | null) => void;

  // Messages
  error: string | null;
  successMsg: string | null;
  setError: (e: string | null) => void;
  setSuccessMsg: (m: string | null) => void;

  // Loading
  loading: Record<string, boolean>;

  // Actions
  fetchUsers: () => Promise<void>;
  fetchPlans: () => Promise<void>;
  fetchStats: () => Promise<void>;
  fetchUserDetails: (userId: string) => Promise<void>;
  createUser: (form: { email: string; display_name: string; password: string; role: string; plan: string }) => Promise<boolean>;
  updateUser: (userId: string, payload: Record<string, string>) => Promise<boolean>;
  deleteUser: (userId: string) => Promise<void>;
  bulkUpdateStatus: (status: string) => Promise<void>;
  bulkDelete: () => Promise<void>;
}

export const useUsersStore = create<UsersState>((set, get) => ({
  // Data
  users: [],
  plans: [],
  stats: null,
  total: 0,

  // Filters
  search: '',
  roleFilter: '',
  statusFilter: '',
  planFilter: '',
  sortColumn: 'createdAt',
  sortDirection: 'desc',
  setSearch: (s) => set({ search: s }),
  setRoleFilter: (s) => { set({ roleFilter: s, page: 0 }); },
  setStatusFilter: (s) => { set({ statusFilter: s, page: 0 }); },
  setPlanFilter: (s) => { set({ planFilter: s, page: 0 }); },
  toggleSort: (col) => {
    const { sortColumn, sortDirection } = get();
    if (sortColumn === col) {
      set({ sortDirection: sortDirection === 'asc' ? 'desc' : 'asc' });
    } else {
      set({ sortColumn: col, sortDirection: 'asc' });
    }
  },

  // Pagination
  page: 0,
  limit: 25,
  setPage: (p) => { set({ page: p }); get().fetchUsers(); },

  // Selection
  selectedUser: null,
  setSelectedUser: (u) => set({ selectedUser: u }),
  selectedIds: new Set(),
  toggleSelection: (id) => {
    const { selectedIds } = get();
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    set({ selectedIds: next });
  },
  toggleSelectAll: () => {
    const { users, selectedIds } = get();
    const allSelected = users.every((u) => selectedIds.has(u.id));
    if (allSelected) {
      set({ selectedIds: new Set() });
    } else {
      set({ selectedIds: new Set(users.map((u) => u.id)) });
    }
  },
  clearSelection: () => set({ selectedIds: new Set() }),

  // Modals
  editingUser: null,
  setEditingUser: (u) => set({ editingUser: u }),
  showCreateModal: false,
  setShowCreateModal: (v) => set({ showCreateModal: v }),
  confirmAction: null,
  setConfirmAction: (a) => set({ confirmAction: a }),

  // Messages
  error: null,
  successMsg: null,
  setError: (e) => set({ error: e }),
  setSuccessMsg: (m) => set({ successMsg: m }),

  // Loading
  loading: {},

  // Actions
  fetchUsers: async () => {
    const { search, roleFilter, statusFilter, planFilter, page, limit } = get();
    set((s) => ({ loading: { ...s.loading, users: true } }));
    try {
      const data = await usersApi.list({
        search: search || undefined,
        role: roleFilter || undefined,
        status: statusFilter || undefined,
        plan: planFilter || undefined,
        limit,
        offset: page * limit,
      });
      set({ users: data.users, total: data.total });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to load users' });
    } finally {
      set((s) => ({ loading: { ...s.loading, users: false } }));
    }
  },

  fetchPlans: async () => {
    try {
      const data = await usersApi.getPlans();
      set({ plans: data.plans });
    } catch {
      // Plans are optional
    }
  },

  fetchStats: async () => {
    try {
      const data = await usersApi.getStats();
      set({ stats: data });
    } catch {
      // Stats are optional
    }
  },

  fetchUserDetails: async (userId: string) => {
    set((s) => ({ loading: { ...s.loading, detail: true } }));
    try {
      const data = await usersApi.getDetails(userId);
      set({
        selectedUser: {
          ...data.user,
          subscription: data.subscription,
          stats: data.stats,
        } as UserDetails,
      });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to load user details' });
    } finally {
      set((s) => ({ loading: { ...s.loading, detail: false } }));
    }
  },

  createUser: async (form) => {
    set((s) => ({ loading: { ...s.loading, create: true } }));
    try {
      await usersApi.create(form);
      set({ successMsg: `Created user ${form.email}`, showCreateModal: false });
      get().fetchUsers();
      get().fetchStats();
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to create user' });
      return false;
    } finally {
      set((s) => ({ loading: { ...s.loading, create: false } }));
    }
  },

  updateUser: async (userId, payload) => {
    set((s) => ({ loading: { ...s.loading, save: true } }));
    try {
      await usersApi.update(userId, payload);
      const user = get().users.find((u) => u.id === userId);
      set({ successMsg: `Updated ${user?.email || 'user'}`, editingUser: null });
      get().fetchUsers();
      if (get().selectedUser?.id === userId) get().fetchUserDetails(userId);
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to update user' });
      return false;
    } finally {
      set((s) => ({ loading: { ...s.loading, save: false } }));
    }
  },

  deleteUser: async (userId: string) => {
    set((s) => ({ loading: { ...s.loading, [`delete-${userId}`]: true } }));
    try {
      await usersApi.delete(userId);
      set({ successMsg: 'User deleted', confirmAction: null });
      if (get().selectedUser?.id === userId) set({ selectedUser: null });
      get().fetchUsers();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to delete user' });
    } finally {
      set((s) => ({ loading: { ...s.loading, [`delete-${userId}`]: false } }));
    }
  },

  bulkUpdateStatus: async (status: string) => {
    const { selectedIds } = get();
    set((s) => ({ loading: { ...s.loading, bulk: true } }));
    try {
      await Promise.all(
        Array.from(selectedIds).map((id) => usersApi.update(id, { status }))
      );
      set({ successMsg: `Updated ${selectedIds.size} users`, selectedIds: new Set(), confirmAction: null });
      get().fetchUsers();
      get().fetchStats();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Bulk update failed' });
    } finally {
      set((s) => ({ loading: { ...s.loading, bulk: false } }));
    }
  },

  bulkDelete: async () => {
    const { selectedIds } = get();
    set((s) => ({ loading: { ...s.loading, bulk: true } }));
    try {
      await Promise.all(
        Array.from(selectedIds).map((id) => usersApi.delete(id))
      );
      set({ successMsg: `Deleted ${selectedIds.size} users`, selectedIds: new Set(), confirmAction: null });
      get().fetchUsers();
      get().fetchStats();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Bulk delete failed' });
    } finally {
      set((s) => ({ loading: { ...s.loading, bulk: false } }));
    }
  },
}));
