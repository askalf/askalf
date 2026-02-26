import { useCallback, useEffect, useState } from 'react';
import { useGitSpaceStore } from '../../stores/git-space';
import { usePolling } from '../../hooks/usePolling';
import BranchList from '../git-space/BranchList';
import DiffPanel from '../git-space/DiffPanel';
import ReviewChatPanel from '../git-space/ReviewChatPanel';
import DeployModal from '../git-space/DeployModal';
import '../GitSpace.css';

/* ─── Service Registry ─── */
const APP_SERVICES = [
  { id: 'dashboard',     label: 'Dashboard',     container: 'askalf-dashboard',     mem: '512M',  port: 3001 },
  { id: 'forge',         label: 'Forge',          container: 'askalf-forge',          mem: '2048M', port: 3005 },
  { id: 'mcp-tools',     label: 'MCP Tools',      container: 'askalf-mcp-tools',      mem: '384M',  port: 3010 },
  { id: 'admin-console', label: 'Admin Console',  container: 'askalf-admin-console',  mem: '512M',  port: 3002 },
  { id: 'nginx',         label: 'Nginx',           container: 'askalf-nginx',           mem: '128M',  port: 80 },
];

const INFRA_SERVICES = [
  { id: 'postgres',      label: 'PostgreSQL',     container: 'askalf-postgres',       port: 5432 },
  { id: 'redis',         label: 'Redis',           container: 'askalf-redis',           port: 6379 },
  { id: 'pgbouncer',     label: 'PgBouncer',      container: 'askalf-pgbouncer',       port: 5432 },
  { id: 'cloudflared',   label: 'Cloudflare',     container: 'askalf-cloudflared' },
  { id: 'docker-proxy',  label: 'Docker Proxy',   container: 'askalf-docker-proxy',    port: 2375 },
  { id: 'searxng',       label: 'SearXNG',        container: 'askalf-searxng',         port: 8080 },
  { id: 'autoheal',      label: 'Autoheal',       container: 'askalf-autoheal' },
  { id: 'backup',        label: 'Backup',          container: 'askalf-backup' },
];

const ALL_SERVICE_IDS = [...APP_SERVICES, ...INFRA_SERVICES].map(s => s.id);

type Tab = 'review' | 'services';

function formatDuration(start: string | null, end: string | null): string {
  if (!start) return '-';
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  const sec = Math.round((e - s) / 1000);
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const STATUS_STYLES: Record<string, { color: string; bg: string; label: string }> = {
  completed: { color: '#10b981', bg: 'rgba(16,185,129,0.12)', label: 'Completed' },
  failed:    { color: '#ef4444', bg: 'rgba(239,68,68,0.12)',  label: 'Failed' },
  running:   { color: '#3b82f6', bg: 'rgba(59,130,246,0.12)', label: 'Running' },
  scheduled: { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', label: 'Scheduled' },
  cancelled: { color: '#6b7280', bg: 'rgba(107,114,128,0.12)',label: 'Cancelled' },
};

export default function PushPanel() {
  const fetchBranches = useGitSpaceStore((s) => s.fetchBranches);
  const fetchDeployTasks = useGitSpaceStore((s) => s.fetchDeployTasks);
  const deployTasks = useGitSpaceStore((s) => s.deployTasks);
  const deploying = useGitSpaceStore((s) => s.deploying);
  const startDeploy = useGitSpaceStore((s) => s.startDeploy);
  const healthResults = useGitSpaceStore((s) => s.healthResults);
  const healthChecking = useGitSpaceStore((s) => s.healthChecking);
  const checkHealth = useGitSpaceStore((s) => s.checkHealth);

  const [tab, setTab] = useState<Tab>('review');
  const [deployOpen, setDeployOpen] = useState(false);
  const [expandedTask, setExpandedTask] = useState<string | null>(null);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  // Load branches on mount + when switching to review tab
  useEffect(() => {
    fetchBranches();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll deploy tasks + health on services tab
  const poll = useCallback(() => {
    fetchDeployTasks();
    if (tab === 'services') {
      checkHealth(ALL_SERVICE_IDS);
    }
  }, [fetchDeployTasks, checkHealth, tab]);
  usePolling(poll, 30000);

  // Initial health check when switching to services tab
  useEffect(() => {
    if (tab === 'services') {
      checkHealth(ALL_SERVICE_IDS);
      fetchDeployTasks();
    }
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleQuickAction = async (serviceId: string, action: 'rebuild' | 'restart') => {
    setActionInProgress(`${serviceId}-${action}`);
    await startDeploy([serviceId], action);
    setActionInProgress(null);
    setTimeout(() => checkHealth(ALL_SERVICE_IDS), 5000);
  };

  const recentTasks = deployTasks.slice(0, 10);
  const totalDeploys = deployTasks.length;
  const successCount = deployTasks.filter(t => t.status === 'completed').length;
  const failCount = deployTasks.filter(t => t.status === 'failed').length;
  const runningCount = deployTasks.filter(t => t.status === 'running').length;

  return (
    <div className="dep-container">
      {/* Header */}
      <div className="dep-header">
        <div className="dep-header-left">
          <div className="dep-tabs">
            <button className={`dep-tab ${tab === 'review' ? 'dep-tab--active' : ''}`} onClick={() => setTab('review')}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 3v12"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 01-9 9"/></svg>
              Code Review
            </button>
            <button className={`dep-tab ${tab === 'services' ? 'dep-tab--active' : ''}`} onClick={() => setTab('services')}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
              Services
            </button>
          </div>
        </div>
        <div className="dep-header-right">
          {healthChecking && <span className="dep-checking">Checking health...</span>}
          <button className="fo-action-btn fo-action-btn--primary" onClick={() => setDeployOpen(true)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
            Deploy Services...
          </button>
        </div>
      </div>

      {/* ═══════ Code Review Tab ═══════ */}
      {tab === 'review' && (
        <div className="dep-code-review">
          <div className="dep-code-review-sidebar">
            <BranchList />
          </div>
          <div className="dep-code-review-main">
            <DiffPanel />
          </div>
          <ReviewChatPanel />
        </div>
      )}

      {/* ═══════ Services Tab ═══════ */}
      {tab === 'services' && (
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.75rem', padding: '0.75rem 0' }}>
          {/* Stats Row */}
          <div className="dep-stats-row">
            <div className="dep-stat-card">
              <div className="dep-stat-value">{totalDeploys}</div>
              <div className="dep-stat-label">Total Deploys</div>
            </div>
            <div className="dep-stat-card dep-stat-card--success">
              <div className="dep-stat-value">{successCount}</div>
              <div className="dep-stat-label">Successful</div>
            </div>
            <div className="dep-stat-card dep-stat-card--danger">
              <div className="dep-stat-value">{failCount}</div>
              <div className="dep-stat-label">Failed</div>
            </div>
            <div className="dep-stat-card dep-stat-card--info">
              <div className="dep-stat-value">{runningCount}</div>
              <div className="dep-stat-label">In Progress</div>
            </div>
          </div>

          {/* App Service Status Grid */}
          <div className="fo-panel">
            <div className="fo-panel-header">
              <span className="fo-panel-title">App Services</span>
              <button className="dep-refresh-btn" onClick={() => checkHealth(ALL_SERVICE_IDS)} disabled={healthChecking}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
                {healthChecking ? 'Checking...' : 'Refresh'}
              </button>
            </div>
            <div className="dep-service-grid">
              {APP_SERVICES.map(svc => {
                const health = healthResults[svc.id];
                const isRunning = health?.running;
                const statusText = health ? (isRunning ? 'Running' : health.status || 'Down') : 'Unknown';
                const isActioning = actionInProgress?.startsWith(svc.id);

                return (
                  <div key={svc.id} className={`dep-service-card ${isRunning ? 'dep-service-card--ok' : health ? 'dep-service-card--down' : ''}`}>
                    <div className="dep-service-top">
                      <div className="dep-service-info">
                        <span className={`dep-health-dot ${isRunning ? 'dep-health-dot--ok' : health ? 'dep-health-dot--down' : 'dep-health-dot--unknown'}`} />
                        <div>
                          <div className="dep-service-name">{svc.label}</div>
                          <div className="dep-service-meta">{svc.container} · {svc.mem} · :{svc.port}</div>
                        </div>
                      </div>
                      <span className={`dep-status-badge ${isRunning ? 'dep-status-badge--ok' : health ? 'dep-status-badge--down' : 'dep-status-badge--unknown'}`}>
                        {statusText}
                      </span>
                    </div>
                    <div className="dep-service-actions">
                      <button
                        className="dep-quick-btn"
                        onClick={() => handleQuickAction(svc.id, 'rebuild')}
                        disabled={deploying || !!isActioning}
                      >
                        {isActioning && actionInProgress === `${svc.id}-rebuild` ? 'Building...' : 'Rebuild'}
                      </button>
                      <button
                        className="dep-quick-btn dep-quick-btn--secondary"
                        onClick={() => handleQuickAction(svc.id, 'restart')}
                        disabled={deploying || !!isActioning}
                      >
                        {isActioning && actionInProgress === `${svc.id}-restart` ? 'Restarting...' : 'Restart'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Infrastructure Status Grid */}
          <div className="fo-panel">
            <div className="fo-panel-header">
              <span className="fo-panel-title">Infrastructure</span>
              <span className="fo-panel-count">{INFRA_SERVICES.length} containers</span>
            </div>
            <div className="dep-infra-grid">
              {INFRA_SERVICES.map(svc => {
                const health = healthResults[svc.id];
                const isRunning = health?.running;
                const statusText = health ? (isRunning ? 'Running' : health.status || 'Down') : 'Unknown';

                return (
                  <div key={svc.id} className={`dep-infra-card ${isRunning ? 'dep-infra-card--ok' : health ? 'dep-infra-card--down' : ''}`}>
                    <span className={`dep-health-dot ${isRunning ? 'dep-health-dot--ok' : health ? 'dep-health-dot--down' : 'dep-health-dot--unknown'}`} />
                    <div className="dep-infra-info">
                      <span className="dep-infra-name">{svc.label}</span>
                      <span className="dep-infra-meta">{svc.container}{svc.port ? ` :${svc.port}` : ''}</span>
                    </div>
                    <span className={`dep-status-badge dep-status-badge--sm ${isRunning ? 'dep-status-badge--ok' : health ? 'dep-status-badge--down' : 'dep-status-badge--unknown'}`}>
                      {statusText}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Recent Deploys */}
          <div className="fo-panel">
            <div className="fo-panel-header">
              <span className="fo-panel-title">Recent Deploys</span>
              <span className="fo-panel-count">{deployTasks.length} total</span>
            </div>
            {recentTasks.length === 0 ? (
              <div className="dep-empty">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.3">
                  <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
                </svg>
                <p>No deploy history yet. Use the Deploy button to rebuild or restart services.</p>
              </div>
            ) : (
              <div className="dep-task-list">
                {recentTasks.map(task => {
                  const st = STATUS_STYLES[task.status] || STATUS_STYLES.cancelled;
                  const isExpanded = expandedTask === task.id;
                  return (
                    <div key={task.id} className="dep-task-row">
                      <button className="dep-task-header" onClick={() => setExpandedTask(isExpanded ? null : task.id)}>
                        <div className="dep-task-left">
                          <span className="dep-task-status" style={{ color: st.color, background: st.bg }}>{st.label}</span>
                          <span className="dep-task-action">{task.action}</span>
                          <span className="dep-task-services">{task.services.join(', ')}</span>
                        </div>
                        <div className="dep-task-right">
                          <span className="dep-task-duration">{formatDuration(task.started_at, task.completed_at)}</span>
                          <span className="dep-task-time">{relativeTime(task.created_at)}</span>
                          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
                            <path d="M4 6l4 4 4-4"/>
                          </svg>
                        </div>
                      </button>
                      {isExpanded && (
                        <div className="dep-task-detail">
                          <div className="dep-task-detail-row">
                            <span>Triggered by</span>
                            <span>{task.triggered_by || 'Manual'}</span>
                          </div>
                          {task.branch && (
                            <div className="dep-task-detail-row">
                              <span>Branch</span>
                              <span>{task.branch}</span>
                            </div>
                          )}
                          {task.exit_code !== null && task.exit_code !== undefined && (
                            <div className="dep-task-detail-row">
                              <span>Exit code</span>
                              <span style={{ color: task.exit_code === 0 ? '#10b981' : '#ef4444' }}>{task.exit_code}</span>
                            </div>
                          )}
                          {task.logs && (
                            <div className="dep-task-logs">
                              <pre>{task.logs}</pre>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {deployOpen && <DeployModal onClose={() => setDeployOpen(false)} />}
    </div>
  );
}
