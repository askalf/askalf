import { create } from 'zustand';
import { backupsApi, type BackupJob, type BackupStats, type BackupConfig, type DatabaseInfo, type TableInfo } from '../hooks/useBackupsApi';

interface ConfirmAction {
  type: 'delete' | 'restore';
  jobId: string;
  label: string;
}

interface BackupsState {
  // Data
  jobs: BackupJob[];
  stats: BackupStats | null;
  config: BackupConfig | null;
  databases: DatabaseInfo[];
  tables: TableInfo[];
  total: number;

  // Filters
  statusFilter: string;
  typeFilter: string;
  setStatusFilter: (s: string) => void;
  setTypeFilter: (s: string) => void;

  // Pagination
  page: number;
  limit: number;
  setPage: (p: number) => void;

  // Selection & panels
  selectedJob: BackupJob | null;
  setSelectedJob: (job: BackupJob | null) => void;
  configPanelOpen: boolean;
  setConfigPanelOpen: (v: boolean) => void;
  configForm: Partial<BackupConfig>;
  setConfigForm: (f: Partial<BackupConfig>) => void;

  // Create backup panel
  createPanelOpen: boolean;
  setCreatePanelOpen: (v: boolean) => void;
  createType: string;
  setCreateType: (t: string) => void;
  createDatabases: string[];
  setCreateDatabases: (dbs: string[]) => void;
  toggleCreateDatabase: (db: string) => void;

  // Confirm modal
  confirmAction: ConfirmAction | null;
  setConfirmAction: (a: ConfirmAction | null) => void;

  // Restore modal
  showRestoreModal: boolean;
  restoreJobId: string | null;
  isDryRun: boolean;
  restoreDatabases: string[];
  setShowRestoreModal: (v: boolean) => void;
  setRestoreJobId: (id: string | null) => void;
  setIsDryRun: (v: boolean) => void;
  setRestoreDatabases: (dbs: string[]) => void;
  toggleRestoreDatabase: (db: string) => void;

  // Loading
  loading: Record<string, boolean>;

  // Error / success
  error: string | null;
  setError: (e: string | null) => void;

  // Actions
  fetchJobs: () => Promise<void>;
  fetchStats: () => Promise<void>;
  fetchConfig: () => Promise<void>;
  fetchDatabases: () => Promise<void>;
  triggerBackup: () => Promise<void>;
  restoreBackup: () => Promise<void>;
  saveConfig: () => Promise<void>;
  deleteJob: (jobId: string) => Promise<void>;
}

export const useBackupsStore = create<BackupsState>((set, get) => ({
  // Data
  jobs: [],
  stats: null,
  config: null,
  databases: [],
  tables: [],
  total: 0,

  // Filters
  statusFilter: '',
  typeFilter: '',
  setStatusFilter: (s) => { set({ statusFilter: s, page: 0 }); get().fetchJobs(); },
  setTypeFilter: (s) => { set({ typeFilter: s, page: 0 }); get().fetchJobs(); },

  // Pagination
  page: 0,
  limit: 25,
  setPage: (p) => { set({ page: p }); get().fetchJobs(); },

  // Selection
  selectedJob: null,
  setSelectedJob: (job) => set({ selectedJob: job }),
  configPanelOpen: false,
  setConfigPanelOpen: (v) => set({ configPanelOpen: v }),
  configForm: {},
  setConfigForm: (f) => set({ configForm: f }),

  // Create backup
  createPanelOpen: false,
  setCreatePanelOpen: (v) => {
    set({ createPanelOpen: v });
    if (v) get().fetchDatabases();
  },
  createType: 'full',
  setCreateType: (t) => set({ createType: t }),
  createDatabases: [],
  setCreateDatabases: (dbs) => set({ createDatabases: dbs }),
  toggleCreateDatabase: (db) => {
    const current = get().createDatabases;
    set({
      createDatabases: current.includes(db)
        ? current.filter(d => d !== db)
        : [...current, db],
    });
  },

  // Confirm
  confirmAction: null,
  setConfirmAction: (a) => set({ confirmAction: a }),

  // Restore
  showRestoreModal: false,
  restoreJobId: null,
  isDryRun: true,
  restoreDatabases: [],
  setShowRestoreModal: (v) => set({ showRestoreModal: v }),
  setRestoreJobId: (id) => set({ restoreJobId: id }),
  setIsDryRun: (v) => set({ isDryRun: v }),
  setRestoreDatabases: (dbs) => set({ restoreDatabases: dbs }),
  toggleRestoreDatabase: (db) => {
    const current = get().restoreDatabases;
    set({
      restoreDatabases: current.includes(db)
        ? current.filter(d => d !== db)
        : [...current, db],
    });
  },

  // Loading
  loading: {},

  // Error
  error: null,
  setError: (e) => set({ error: e }),

  // Actions
  fetchJobs: async () => {
    const { statusFilter, typeFilter, page, limit } = get();
    set((s) => ({ loading: { ...s.loading, jobs: true } }));
    try {
      const data = await backupsApi.listJobs({
        status: statusFilter || undefined,
        type: typeFilter || undefined,
        limit,
        offset: page * limit,
      });
      set({ jobs: data.jobs, total: data.total });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to load backups' });
    } finally {
      set((s) => ({ loading: { ...s.loading, jobs: false } }));
    }
  },

  fetchStats: async () => {
    set((s) => ({ loading: { ...s.loading, stats: true } }));
    try {
      const data = await backupsApi.getStats();
      set({ stats: data });
    } catch {
      // Stats are optional
    } finally {
      set((s) => ({ loading: { ...s.loading, stats: false } }));
    }
  },

  fetchConfig: async () => {
    set((s) => ({ loading: { ...s.loading, config: true } }));
    try {
      const data = await backupsApi.getConfig();
      set({ config: data.config, configForm: data.config });
    } catch {
      // Config is optional
    } finally {
      set((s) => ({ loading: { ...s.loading, config: false } }));
    }
  },

  fetchDatabases: async () => {
    set((s) => ({ loading: { ...s.loading, databases: true } }));
    try {
      const data = await backupsApi.getDatabases();
      set({ databases: data.databases, tables: data.tables });
    } catch {
      // Databases info is optional
    } finally {
      set((s) => ({ loading: { ...s.loading, databases: false } }));
    }
  },

  triggerBackup: async () => {
    const { createType, createDatabases } = get();
    set((s) => ({ loading: { ...s.loading, trigger: true } }));
    try {
      await backupsApi.triggerBackup({
        type: createType,
        databases: createDatabases.length > 0 ? createDatabases : undefined,
      });
      set({ createPanelOpen: false, createDatabases: [], createType: 'full' });
      await get().fetchJobs();
      await get().fetchStats();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to trigger backup' });
    } finally {
      set((s) => ({ loading: { ...s.loading, trigger: false } }));
    }
  },

  restoreBackup: async () => {
    const { restoreJobId, isDryRun, restoreDatabases } = get();
    if (!restoreJobId) return;
    set((s) => ({ loading: { ...s.loading, restore: true } }));
    try {
      await backupsApi.restoreBackup(restoreJobId, {
        dryRun: isDryRun,
        databases: restoreDatabases.length > 0 ? restoreDatabases : undefined,
      });
      set({ showRestoreModal: false, restoreJobId: null, restoreDatabases: [] });
      await get().fetchJobs();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to start restore' });
    } finally {
      set((s) => ({ loading: { ...s.loading, restore: false } }));
    }
  },

  saveConfig: async () => {
    const { configForm } = get();
    set((s) => ({ loading: { ...s.loading, saveConfig: true } }));
    try {
      await backupsApi.saveConfig(configForm);
      set({ configPanelOpen: false });
      await get().fetchConfig();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to save configuration' });
    } finally {
      set((s) => ({ loading: { ...s.loading, saveConfig: false } }));
    }
  },

  deleteJob: async (jobId: string) => {
    set((s) => ({ loading: { ...s.loading, [`delete-${jobId}`]: true } }));
    try {
      await backupsApi.deleteJob(jobId);
      set({ selectedJob: null, confirmAction: null });
      await get().fetchJobs();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to delete backup' });
    } finally {
      set((s) => ({ loading: { ...s.loading, [`delete-${jobId}`]: false } }));
    }
  },
}));
