import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/auth';
import './BackupAdmin.css';

interface BackupJob {
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
  manifest: Record<string, unknown>;
  errorMessage: string | null;
  errorDetails: Record<string, unknown> | null;
  triggeredBy: string | null;
  createdAt: string;
}

interface BackupStats {
  totalBackups: number;
  successfulBackups: number;
  failedBackups: number;
  totalSizeBytes: number;
  avgDurationMs: number | null;
  lastSuccessfulAt: string | null;
  lastFailedAt: string | null;
  serviceStatus: 'healthy' | 'unhealthy';
}

interface BackupConfig {
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

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
}

function timeAgo(dateStr: string | null): string {
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

export default function BackupAdmin() {
  const navigate = useNavigate();
  const { user: currentUser } = useAuthStore();

  // State
  const [jobs, setJobs] = useState<BackupJob[]>([]);
  const [stats, setStats] = useState<BackupStats | null>(null);
  const [config, setConfig] = useState<BackupConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  // Pagination
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const limit = 25;

  // Selected job for detail view
  const [selectedJob, setSelectedJob] = useState<BackupJob | null>(null);

  // Modals
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [showRestoreModal, setShowRestoreModal] = useState(false);
  const [restoreJobId, setRestoreJobId] = useState<string | null>(null);
  const [isDryRun, setIsDryRun] = useState(true);

  // Action states
  const [triggering, setTriggering] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);

  // Config form
  const [configForm, setConfigForm] = useState<Partial<BackupConfig>>({});

  const fetchJobs = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.append('status', statusFilter);
      if (typeFilter) params.append('type', typeFilter);
      params.append('limit', limit.toString());
      params.append('offset', (page * limit).toString());

      const response = await fetch(`/api/v1/admin/backups?${params}`, {
        credentials: 'include',
      });

      if (!response.ok) throw new Error('Failed to fetch backups');

      const data = await response.json();
      setJobs(data.jobs);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load backups');
    }
  }, [statusFilter, typeFilter, page]);

  const fetchStats = useCallback(async () => {
    try {
      const response = await fetch(`/api/v1/admin/backups/stats`, {
        credentials: 'include',
      });
      if (!response.ok) return;
      const data = await response.json();
      setStats(data);
    } catch {
      // Stats are optional
    }
  }, []);

  const fetchConfig = useCallback(async () => {
    try {
      const response = await fetch(`/api/v1/admin/backups/config`, {
        credentials: 'include',
      });
      if (!response.ok) return;
      const data = await response.json();
      setConfig(data.config);
      setConfigForm(data.config);
    } catch {
      // Config is optional
    }
  }, []);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      await Promise.all([fetchJobs(), fetchStats(), fetchConfig()]);
      setLoading(false);
    };
    loadData();
  }, [fetchJobs, fetchStats, fetchConfig]);

  // Refresh on filter change
  useEffect(() => {
    setPage(0);
    fetchJobs();
  }, [statusFilter, typeFilter, fetchJobs]);

  const handleTriggerBackup = async (type: string = 'full') => {
    setTriggering(true);
    try {
      const response = await fetch(`/api/v1/admin/backups/trigger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ type }),
      });

      if (!response.ok) throw new Error('Failed to trigger backup');

      // Refresh jobs list
      await fetchJobs();
      await fetchStats();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to trigger backup');
    } finally {
      setTriggering(false);
    }
  };

  const handleRestore = async () => {
    if (!restoreJobId) return;
    setRestoring(true);
    try {
      const response = await fetch(`/api/v1/admin/backups/${restoreJobId}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ dryRun: isDryRun }),
      });

      if (!response.ok) throw new Error('Failed to start restore');

      setShowRestoreModal(false);
      setRestoreJobId(null);
      await fetchJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start restore');
    } finally {
      setRestoring(false);
    }
  };

  const handleSaveConfig = async () => {
    setSavingConfig(true);
    try {
      const response = await fetch(`/api/v1/admin/backups/config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(configForm),
      });

      if (!response.ok) throw new Error('Failed to save configuration');

      setShowConfigModal(false);
      await fetchConfig();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save configuration');
    } finally {
      setSavingConfig(false);
    }
  };

  const handleDeleteJob = async (jobId: string) => {
    if (!confirm('Are you sure you want to delete this backup record?')) return;

    try {
      const response = await fetch(`/api/v1/admin/backups/${jobId}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (!response.ok) throw new Error('Failed to delete backup');

      setSelectedJob(null);
      await fetchJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete backup');
    }
  };

  const openRestoreModal = (jobId: string) => {
    setRestoreJobId(jobId);
    setIsDryRun(true);
    setShowRestoreModal(true);
  };

  // Check admin access
  if (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'super_admin')) {
    return (
      <div className="admin-page">
        <div className="admin-error">
          <span>Access denied. Admin privileges required.</span>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="admin-page">
        <div className="admin-loading">
          <span className="loading-spinner">↻</span>
          <span>Loading backup data...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-page backup-admin">
     <div className="admin-main">
      {/* Header */}
      <div className="admin-header">
        <button className="admin-back-btn" onClick={() => navigate('/command-center')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back
        </button>
        <div className="admin-title-group">
          <h1>Backup Administration</h1>
          <p>Manage database backups and restore operations</p>
        </div>
        <button
          className="admin-refresh-btn"
          onClick={() => {
            fetchJobs();
            fetchStats();
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 4v5h5M20 20v-5h-5M4.9 15.5A8 8 0 1 0 5 9" />
          </svg>
          Refresh
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="admin-error">
          <span>{error}</span>
          <button onClick={() => setError(null)}>&times;</button>
        </div>
      )}

      {/* Stats Cards */}
      {stats && (
        <div className="admin-stats">
          <div className="stat-card">
            <div className={`stat-icon service ${stats.serviceStatus}`}>
              {stats.serviceStatus === 'healthy' ? '✓' : '✗'}
            </div>
            <div>
              <div className="stat-value">{stats.serviceStatus === 'healthy' ? 'Online' : 'Offline'}</div>
              <div className="stat-label">Service Status</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon backups">💾</div>
            <div>
              <div className="stat-value">{stats.totalBackups}</div>
              <div className="stat-label">Total Backups</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon success">✓</div>
            <div>
              <div className="stat-value">{stats.successfulBackups}</div>
              <div className="stat-label">Successful</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon failed">✗</div>
            <div>
              <div className="stat-value">{stats.failedBackups}</div>
              <div className="stat-label">Failed</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon size">📁</div>
            <div>
              <div className="stat-value">{formatBytes(stats.totalSizeBytes)}</div>
              <div className="stat-label">Total Size</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon time">⏱</div>
            <div>
              <div className="stat-value">{timeAgo(stats.lastSuccessfulAt)}</div>
              <div className="stat-label">Last Backup</div>
            </div>
          </div>
        </div>
      )}

      {/* Action Bar */}
      <div className="backup-actions">
        <button
          className="btn-primary"
          onClick={() => handleTriggerBackup('full')}
          disabled={triggering}
        >
          {triggering ? 'Starting...' : 'Trigger Full Backup'}
        </button>
        <button
          className="btn-secondary"
          onClick={() => handleTriggerBackup('data-only')}
          disabled={triggering}
        >
          Data-Only Backup
        </button>
        <button className="btn-config" onClick={() => setShowConfigModal(true)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" />
          </svg>
          Settings
        </button>
      </div>

      {/* Filters */}
      <div className="admin-filters">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All Statuses</option>
          <option value="completed">Completed</option>
          <option value="running">Running</option>
          <option value="failed">Failed</option>
          <option value="pending">Pending</option>
        </select>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="">All Types</option>
          <option value="full">Full</option>
          <option value="data-only">Data Only</option>
          <option value="incremental">Incremental</option>
        </select>
      </div>

      {/* Main Content */}
      <div className="admin-content">
        {/* Table */}
        <div className="admin-table-container">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Type</th>
                <th>Trigger</th>
                <th>Started</th>
                <th>Duration</th>
                <th>Size</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr
                  key={job.id}
                  className={selectedJob?.id === job.id ? 'selected' : ''}
                  onClick={() => setSelectedJob(job)}
                >
                  <td>
                    <span className={`status-badge badge-${job.status}`}>
                      {job.status === 'running' && <span className="spinner">↻</span>}
                      {job.status}
                    </span>
                  </td>
                  <td>{job.type}</td>
                  <td>{job.trigger}</td>
                  <td className="date-cell">{formatDate(job.startedAt || job.createdAt)}</td>
                  <td>{job.durationMs ? formatDuration(job.durationMs) : '-'}</td>
                  <td>{job.fileSize ? formatBytes(job.fileSize) : '-'}</td>
                  <td>
                    <div className="action-buttons">
                      {job.status === 'completed' && (
                        <button
                          className="action-btn restore"
                          title="Restore"
                          onClick={(e) => {
                            e.stopPropagation();
                            openRestoreModal(job.id);
                          }}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                            <path d="M3 3v5h5" />
                          </svg>
                        </button>
                      )}
                      <button
                        className="action-btn delete"
                        title="Delete"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteJob(job.id);
                        }}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {jobs.length === 0 && (
                <tr>
                  <td colSpan={7} className="empty-state">
                    No backup jobs found
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {/* Pagination */}
          <div className="admin-pagination">
            <span className="pagination-info">
              Showing {page * limit + 1}-{Math.min((page + 1) * limit, total)} of {total}
            </span>
            <div className="pagination-buttons">
              <button onClick={() => setPage(page - 1)} disabled={page === 0}>
                Previous
              </button>
              <button onClick={() => setPage(page + 1)} disabled={(page + 1) * limit >= total}>
                Next
              </button>
            </div>
          </div>
        </div>

        {/* Detail Panel */}
        {selectedJob && (
          <div className="admin-detail-panel">
            <div className="detail-header">
              <h2>Backup Details</h2>
              <button className="detail-close" onClick={() => setSelectedJob(null)}>
                &times;
              </button>
            </div>
            <div className="detail-content">
              <div className="detail-badges">
                <span className={`status-badge badge-${selectedJob.status}`}>{selectedJob.status}</span>
                <span className="type-badge">{selectedJob.type}</span>
                {selectedJob.encrypted && <span className="badge-encrypted">Encrypted</span>}
                {selectedJob.compressed && <span className="badge-compressed">Compressed</span>}
              </div>

              <div className="detail-section">
                <h4>Timing</h4>
                <div className="detail-row">
                  <span>Created</span>
                  <span>{formatDate(selectedJob.createdAt)}</span>
                </div>
                <div className="detail-row">
                  <span>Started</span>
                  <span>{formatDate(selectedJob.startedAt)}</span>
                </div>
                <div className="detail-row">
                  <span>Completed</span>
                  <span>{formatDate(selectedJob.completedAt)}</span>
                </div>
                <div className="detail-row">
                  <span>Duration</span>
                  <span>{selectedJob.durationMs ? formatDuration(selectedJob.durationMs) : '-'}</span>
                </div>
              </div>

              <div className="detail-section">
                <h4>File Info</h4>
                <div className="detail-row">
                  <span>Size</span>
                  <span>{selectedJob.fileSize ? formatBytes(selectedJob.fileSize) : '-'}</span>
                </div>
                <div className="detail-row">
                  <span>Path</span>
                  <span className="file-path">{selectedJob.filePath || '-'}</span>
                </div>
              </div>

              {selectedJob.manifest && Object.keys(selectedJob.manifest).length > 0 && (
                <div className="detail-section">
                  <h4>Manifest</h4>
                  <div className="manifest-viewer">
                    <pre>{JSON.stringify(selectedJob.manifest, null, 2)}</pre>
                  </div>
                </div>
              )}

              {selectedJob.errorMessage && (
                <div className="detail-section error-section">
                  <h4>Error</h4>
                  <div className="error-message">{selectedJob.errorMessage}</div>
                  {selectedJob.errorDetails && (
                    <div className="error-details">
                      <pre>{JSON.stringify(selectedJob.errorDetails, null, 2)}</pre>
                    </div>
                  )}
                </div>
              )}

              {selectedJob.status === 'completed' && (
                <div className="detail-actions">
                  <button className="btn-restore" onClick={() => openRestoreModal(selectedJob.id)}>
                    Restore from this Backup
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Config Modal */}
      {showConfigModal && (
        <div className="admin-modal-overlay" onClick={() => setShowConfigModal(false)}>
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Backup Settings</h2>
              <button className="modal-close" onClick={() => setShowConfigModal(false)}>
                &times;
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>
                  <input
                    type="checkbox"
                    checked={configForm.scheduleEnabled ?? config?.scheduleEnabled ?? true}
                    onChange={(e) => setConfigForm({ ...configForm, scheduleEnabled: e.target.checked })}
                  />
                  Enable Scheduled Backups
                </label>
              </div>
              <div className="form-group">
                <label>Schedule (Cron)</label>
                <input
                  type="text"
                  value={configForm.scheduleCron ?? config?.scheduleCron ?? '0 4 * * *'}
                  onChange={(e) => setConfigForm({ ...configForm, scheduleCron: e.target.value })}
                  placeholder="0 4 * * *"
                />
                <span className="form-hint">Default: Daily at 4 AM</span>
              </div>
              <div className="form-group">
                <label>Retention (Days)</label>
                <input
                  type="number"
                  value={configForm.retentionDays ?? config?.retentionDays ?? 30}
                  onChange={(e) => setConfigForm({ ...configForm, retentionDays: parseInt(e.target.value) })}
                />
              </div>
              <div className="form-group">
                <label>
                  <input
                    type="checkbox"
                    checked={configForm.compressionEnabled ?? config?.compressionEnabled ?? true}
                    onChange={(e) => setConfigForm({ ...configForm, compressionEnabled: e.target.checked })}
                  />
                  Enable Compression
                </label>
              </div>
              <div className="form-group">
                <label>
                  <input
                    type="checkbox"
                    checked={configForm.notifyOnFailure ?? config?.notifyOnFailure ?? true}
                    onChange={(e) => setConfigForm({ ...configForm, notifyOnFailure: e.target.checked })}
                  />
                  Notify on Failure
                </label>
              </div>
              <div className="form-group">
                <label>Notification Email</label>
                <input
                  type="email"
                  value={configForm.notifyEmail ?? config?.notifyEmail ?? ''}
                  onChange={(e) => setConfigForm({ ...configForm, notifyEmail: e.target.value })}
                  placeholder="admin@example.com"
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-cancel" onClick={() => setShowConfigModal(false)}>
                Cancel
              </button>
              <button className="btn-save" onClick={handleSaveConfig} disabled={savingConfig}>
                {savingConfig ? 'Saving...' : 'Save Settings'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Restore Modal */}
      {showRestoreModal && (
        <div className="admin-modal-overlay" onClick={() => setShowRestoreModal(false)}>
          <div className="admin-modal restore-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Restore Backup</h2>
              <button className="modal-close" onClick={() => setShowRestoreModal(false)}>
                &times;
              </button>
            </div>
            <div className="modal-body">
              <div className="restore-warning">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                <div>
                  <strong>Warning:</strong> Restoring a backup will overwrite existing data.
                  <br />
                  Run a dry-run first to preview changes.
                </div>
              </div>
              <div className="form-group">
                <label>
                  <input
                    type="checkbox"
                    checked={isDryRun}
                    onChange={(e) => setIsDryRun(e.target.checked)}
                  />
                  Dry Run (Preview only, no changes)
                </label>
              </div>
              {!isDryRun && (
                <div className="restore-confirm">
                  <strong>This will modify the database. Are you absolutely sure?</strong>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn-cancel" onClick={() => setShowRestoreModal(false)}>
                Cancel
              </button>
              <button
                className={isDryRun ? 'btn-save' : 'btn-danger'}
                onClick={handleRestore}
                disabled={restoring}
              >
                {restoring ? 'Starting...' : isDryRun ? 'Start Dry Run' : 'Restore Now'}
              </button>
            </div>
          </div>
        </div>
      )}
     </div>
    </div>
  );
}
