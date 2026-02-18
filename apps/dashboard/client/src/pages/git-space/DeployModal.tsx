import { useState, useEffect } from 'react';
import { useGitSpaceStore } from '../../stores/git-space';

// ============================================
// Service definitions + groups
// ============================================

const SERVICES = [
  { id: 'api', label: 'API Server', desc: 'sprayberry-labs-api' },
  { id: 'dashboard', label: 'Dashboard', desc: 'sprayberry-labs-dashboard' },
  { id: 'forge', label: 'Orcastr8r', desc: 'sprayberry-labs-forge' },
  { id: 'nginx', label: 'Nginx', desc: 'sprayberry-labs-nginx' },
  { id: 'mcp', label: 'MCP', desc: 'sprayberry-labs-mcp' },
  { id: 'mcp-tools', label: 'MCP Tools', desc: 'sprayberry-labs-mcp-tools' },
  { id: 'scheduler', label: 'Scheduler', desc: 'sprayberry-labs-scheduler' },
  { id: 'worker', label: 'Worker', desc: 'sprayberry-labs-worker' },
];

const SERVICE_GROUPS = [
  { id: 'frontend', label: 'Frontend', services: ['dashboard', 'nginx'] },
  { id: 'backend', label: 'Backend', services: ['api', 'forge'] },
  { id: 'mcp', label: 'MCP Servers', services: ['mcp', 'mcp-tools'] },
  { id: 'workers', label: 'Workers', services: ['scheduler', 'worker'] },
  { id: 'all', label: 'All', services: SERVICES.map((s) => s.id) },
];

// File path → affected services mapping
const SERVICE_PATH_MAP: Record<string, string[]> = {
  'apps/api/': ['api'],
  'apps/dashboard/': ['dashboard'],
  'apps/forge/': ['forge'],
  'apps/mcp/': ['mcp'],
  'apps/mcp-tools/': ['mcp-tools'],
  'apps/worker/': ['scheduler', 'worker'],
  'packages/': ['api', 'dashboard', 'forge', 'mcp', 'mcp-tools'],
  'infrastructure/nginx/': ['nginx'],
};

function detectAffectedServices(files: { path: string }[]): Set<string> {
  const affected = new Set<string>();
  for (const file of files) {
    for (const [prefix, services] of Object.entries(SERVICE_PATH_MAP)) {
      if (file.path.startsWith(prefix)) {
        services.forEach((s) => affected.add(s));
      }
    }
  }
  return affected;
}

// ============================================
// Component
// ============================================

interface DeployModalProps {
  onClose: () => void;
}

type Tab = 'deploy' | 'schedule' | 'history';

function formatDuration(start: string | null, end: string | null): string {
  if (!start) return '-';
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  const sec = Math.round((e - s) / 1000);
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

function statusColor(status: string): string {
  if (status === 'completed') return 'cr-dtask--ok';
  if (status === 'failed') return 'cr-dtask--fail';
  if (status === 'running') return 'cr-dtask--running';
  if (status === 'cancelled') return 'cr-dtask--cancelled';
  if (status === 'scheduled') return 'cr-dtask--scheduled';
  return '';
}

export default function DeployModal({ onClose }: DeployModalProps) {
  const [tab, setTab] = useState<Tab>('deploy');
  const [selected, setSelected] = useState<string[]>([]);
  const [action, setAction] = useState<'rebuild' | 'restart'>('rebuild');
  const [step, setStep] = useState<'select' | 'confirm' | 'progress'>('select');
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('');
  const [expandedTask, setExpandedTask] = useState<string | null>(null);

  const diffFiles = useGitSpaceStore((s) => s.diffFiles);
  const deploying = useGitSpaceStore((s) => s.deploying);
  const startDeploy = useGitSpaceStore((s) => s.startDeploy);
  const activeDeployTask = useGitSpaceStore((s) => s.activeDeployTask);
  const deployTasks = useGitSpaceStore((s) => s.deployTasks);
  const fetchDeployTasks = useGitSpaceStore((s) => s.fetchDeployTasks);
  const cancelDeployTask = useGitSpaceStore((s) => s.cancelDeployTask);
  const healthResults = useGitSpaceStore((s) => s.healthResults);
  const healthChecking = useGitSpaceStore((s) => s.healthChecking);
  const checkHealth = useGitSpaceStore((s) => s.checkHealth);

  // Detect affected services from diff files
  const affectedServices = detectAffectedServices(diffFiles);
  const needsRebuild = affectedServices.size > 0;

  // Pre-select affected services on mount
  useEffect(() => {
    if (affectedServices.size > 0 && selected.length === 0) {
      setSelected(Array.from(affectedServices));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load task history
  useEffect(() => {
    fetchDeployTasks();
  }, [fetchDeployTasks]);

  // Health check after deploy completes
  useEffect(() => {
    if (activeDeployTask && (activeDeployTask.status === 'completed' || activeDeployTask.status === 'failed')) {
      if (activeDeployTask.status === 'completed') {
        const timer = setTimeout(() => checkHealth(activeDeployTask.services), 3000);
        return () => clearTimeout(timer);
      }
    }
  }, [activeDeployTask?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id: string) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id],
    );
  };

  const toggleGroup = (groupId: string) => {
    const group = SERVICE_GROUPS.find((g) => g.id === groupId);
    if (!group) return;
    const allSelected = group.services.every((s) => selected.includes(s));
    if (allSelected) {
      setSelected((prev) => prev.filter((s) => !group.services.includes(s)));
    } else {
      setSelected((prev) => [...new Set([...prev, ...group.services])]);
    }
  };

  const handleDeploy = async () => {
    if (selected.length === 0) return;
    setStep('progress');
    await startDeploy(selected, action);
  };

  const handleSchedule = async () => {
    if (selected.length === 0 || !scheduleDate || !scheduleTime) return;
    const scheduledAt = new Date(`${scheduleDate}T${scheduleTime}`).toISOString();
    await startDeploy(selected, action, scheduledAt);
    setTab('history');
    setScheduleDate('');
    setScheduleTime('');
  };

  return (
    <div className="cr-modal-overlay" onClick={onClose}>
      <div className="cr-modal cr-modal--deploy" onClick={(e) => e.stopPropagation()}>
        <div className="cr-deploy-header-row">
          <h3>Deploy Services</h3>
          <button className="cr-review-close" onClick={onClose} aria-label="Close deploy modal">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="cr-deploy-tabs">
          <button className={`cr-deploy-tab ${tab === 'deploy' ? 'active' : ''}`} onClick={() => { setTab('deploy'); setStep('select'); }}>
            Deploy Now
          </button>
          <button className={`cr-deploy-tab ${tab === 'schedule' ? 'active' : ''}`} onClick={() => setTab('schedule')}>
            Schedule
          </button>
          <button className={`cr-deploy-tab ${tab === 'history' ? 'active' : ''}`} onClick={() => { setTab('history'); fetchDeployTasks(); }}>
            History
          </button>
        </div>

        {/* ======== Deploy Now Tab ======== */}
        {tab === 'deploy' && step === 'select' && (
          <>
            {needsRebuild && (
              <div className="cr-deploy-detection">
                Detected {affectedServices.size} affected service{affectedServices.size !== 1 ? 's' : ''} from code changes
              </div>
            )}

            {/* Service groups */}
            <div className="cr-service-groups">
              {SERVICE_GROUPS.map((g) => {
                const allIn = g.services.every((s) => selected.includes(s));
                return (
                  <button
                    key={g.id}
                    className={`cr-service-group-chip ${allIn ? 'active' : ''}`}
                    onClick={() => toggleGroup(g.id)}
                  >
                    {g.label}
                  </button>
                );
              })}
            </div>

            {/* Service grid */}
            <div className="cr-deploy-grid">
              {SERVICES.map((svc) => {
                const isAffected = affectedServices.has(svc.id);
                return (
                  <label key={svc.id} className={`cr-deploy-item ${selected.includes(svc.id) ? 'selected' : ''}`}>
                    <input
                      type="checkbox"
                      checked={selected.includes(svc.id)}
                      onChange={() => toggle(svc.id)}
                    />
                    <div>
                      <span className="cr-deploy-name">
                        {svc.label}
                        {isAffected && <span className="cr-service-badge cr-service-badge--rebuild">Rebuild</span>}
                      </span>
                      <span className="cr-deploy-desc">{svc.desc}</span>
                    </div>
                  </label>
                );
              })}
            </div>

            {/* Action selection */}
            <div className="cr-deploy-action-row">
              <label className={`cr-deploy-action ${action === 'rebuild' ? 'active' : ''}`}>
                <input type="radio" name="action" checked={action === 'rebuild'} onChange={() => setAction('rebuild')} />
                Rebuild & Deploy
                <span className="cr-deploy-action-hint">Build new images + recreate</span>
              </label>
              <label className={`cr-deploy-action ${action === 'restart' ? 'active' : ''}`}>
                <input type="radio" name="action" checked={action === 'restart'} onChange={() => setAction('restart')} />
                Restart Only
                <span className="cr-deploy-action-hint">Restart existing containers</span>
              </label>
            </div>

            <div className="cr-modal-actions">
              <button className="cr-btn" onClick={onClose}>Cancel</button>
              <button
                className="cr-btn cr-btn--primary"
                onClick={() => setStep('confirm')}
                disabled={selected.length === 0}
              >
                Next: Confirm ({selected.length})
              </button>
            </div>
          </>
        )}

        {tab === 'deploy' && step === 'confirm' && (
          <>
            <div className="cr-deploy-warning">
              This will {action === 'rebuild' ? 'rebuild and recreate' : 'restart'} {selected.length} production service{selected.length !== 1 ? 's' : ''}. Users may experience brief downtime.
            </div>
            <div className="cr-deploy-confirm-list">
              {selected.map((id) => {
                const svc = SERVICES.find((s) => s.id === id);
                const isAffected = affectedServices.has(id);
                return (
                  <div key={id} className="cr-deploy-confirm-item">
                    <span className="cr-deploy-name">{svc?.label || id}</span>
                    <span className={`cr-service-badge ${isAffected ? 'cr-service-badge--rebuild' : 'cr-service-badge--restart'}`}>
                      {isAffected ? 'Rebuild' : action === 'rebuild' ? 'Rebuild' : 'Restart'}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="cr-modal-actions">
              <button className="cr-btn" onClick={() => setStep('select')}>Back</button>
              <button
                className="cr-btn cr-btn--danger"
                onClick={handleDeploy}
                disabled={deploying}
              >
                {deploying ? 'Starting...' : `Yes, ${action === 'rebuild' ? 'Rebuild' : 'Restart'} ${selected.length} Service${selected.length !== 1 ? 's' : ''}`}
              </button>
            </div>
          </>
        )}

        {tab === 'deploy' && step === 'progress' && (
          <>
            {activeDeployTask ? (
              <>
                <div className={`cr-deploy-result ${activeDeployTask.status === 'failed' ? 'cr-deploy-result--fail' : ''}`}>
                  {activeDeployTask.status === 'running' && 'Deploy in progress...'}
                  {activeDeployTask.status === 'completed' && 'Deploy completed successfully.'}
                  {activeDeployTask.status === 'failed' && `Deploy failed (exit code: ${activeDeployTask.exit_code ?? '?'}).`}
                </div>

                {/* Build logs */}
                {activeDeployTask.logs && (
                  <div className="cr-build-log">
                    <pre>{activeDeployTask.logs}</pre>
                  </div>
                )}

                {/* Health check after completion */}
                {activeDeployTask.status === 'completed' && (
                  <div className="cr-health-section">
                    <div className="cr-health-title">
                      Service Health {healthChecking && <span className="cr-review-typing">(checking...)</span>}
                    </div>
                    {selected.map((id) => {
                      const svc = SERVICES.find((s) => s.id === id);
                      const health = healthResults[id];
                      return (
                        <div key={id} className="cr-health-row">
                          <span className="cr-deploy-name">{svc?.label || id}</span>
                          {health ? (
                            <span className={`cr-health-dot ${health.running ? 'cr-health--ok' : 'cr-health--down'}`}>
                              {health.running ? 'Running' : health.status}
                            </span>
                          ) : (
                            <span className="cr-health-dot cr-health--pending">Waiting...</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            ) : (
              <div className="cr-deploy-result">
                {deploying ? 'Initiating deploy...' : 'Deploy task created.'}
              </div>
            )}
            <div className="cr-modal-actions">
              <button className="cr-btn cr-btn--primary" onClick={onClose}>Close</button>
            </div>
          </>
        )}

        {/* ======== Schedule Tab ======== */}
        {tab === 'schedule' && (
          <>
            {/* Reuse service groups + grid */}
            <div className="cr-service-groups">
              {SERVICE_GROUPS.map((g) => {
                const allIn = g.services.every((s) => selected.includes(s));
                return (
                  <button
                    key={g.id}
                    className={`cr-service-group-chip ${allIn ? 'active' : ''}`}
                    onClick={() => toggleGroup(g.id)}
                  >
                    {g.label}
                  </button>
                );
              })}
            </div>

            <div className="cr-deploy-grid cr-deploy-grid--compact">
              {SERVICES.map((svc) => (
                <label key={svc.id} className={`cr-deploy-item ${selected.includes(svc.id) ? 'selected' : ''}`}>
                  <input
                    type="checkbox"
                    checked={selected.includes(svc.id)}
                    onChange={() => toggle(svc.id)}
                  />
                  <span className="cr-deploy-name">{svc.label}</span>
                </label>
              ))}
            </div>

            <div className="cr-deploy-action-row">
              <label className={`cr-deploy-action ${action === 'rebuild' ? 'active' : ''}`}>
                <input type="radio" name="sched-action" checked={action === 'rebuild'} onChange={() => setAction('rebuild')} />
                Rebuild
              </label>
              <label className={`cr-deploy-action ${action === 'restart' ? 'active' : ''}`}>
                <input type="radio" name="sched-action" checked={action === 'restart'} onChange={() => setAction('restart')} />
                Restart
              </label>
            </div>

            <div className="cr-schedule-picker">
              <label>
                Date
                <input type="date" value={scheduleDate} onChange={(e) => setScheduleDate(e.target.value)} />
              </label>
              <label>
                Time
                <input type="time" value={scheduleTime} onChange={(e) => setScheduleTime(e.target.value)} />
              </label>
            </div>

            <div className="cr-modal-actions">
              <button className="cr-btn" onClick={onClose}>Cancel</button>
              <button
                className="cr-btn cr-btn--crystal"
                onClick={handleSchedule}
                disabled={selected.length === 0 || !scheduleDate || !scheduleTime}
              >
                Schedule Deploy
              </button>
            </div>

            {/* Upcoming scheduled tasks */}
            {deployTasks.filter((t) => t.status === 'scheduled').length > 0 && (
              <div className="cr-deploy-scheduled-list">
                <div className="cr-health-title">Upcoming Scheduled Deploys</div>
                {deployTasks
                  .filter((t) => t.status === 'scheduled')
                  .map((task) => (
                    <div key={task.id} className="cr-deploy-task-row">
                      <div className="cr-dtask-info">
                        <span className={`cr-dtask-status ${statusColor(task.status)}`}>{task.status}</span>
                        <span className="cr-dtask-action">{task.action}</span>
                        <span className="cr-dtask-services">{task.services.join(', ')}</span>
                      </div>
                      <div className="cr-dtask-meta">
                        <span>{task.scheduled_at ? new Date(task.scheduled_at).toLocaleString() : '-'}</span>
                        <button className="cr-btn cr-btn--danger-outline cr-btn--xs" onClick={() => cancelDeployTask(task.id)}>Cancel</button>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </>
        )}

        {/* ======== History Tab ======== */}
        {tab === 'history' && (
          <div className="cr-deploy-history">
            {deployTasks.length === 0 ? (
              <div className="cr-deploy-history-empty">No deploy tasks yet.</div>
            ) : (
              deployTasks.map((task) => (
                <div key={task.id} className="cr-deploy-task-row">
                  <button
                    className="cr-dtask-header"
                    onClick={() => setExpandedTask(expandedTask === task.id ? null : task.id)}
                  >
                    <div className="cr-dtask-info">
                      <span className={`cr-dtask-status ${statusColor(task.status)}`}>{task.status}</span>
                      <span className="cr-dtask-action">{task.action}</span>
                      <span className="cr-dtask-services">{task.services.join(', ')}</span>
                    </div>
                    <div className="cr-dtask-meta">
                      <span>{formatDuration(task.started_at, task.completed_at)}</span>
                      <span>{new Date(task.created_at).toLocaleDateString()}</span>
                    </div>
                  </button>
                  {expandedTask === task.id && (
                    <div className="cr-dtask-detail">
                      <div className="cr-dtask-detail-row">
                        <span>Triggered by:</span> <span>{task.triggered_by || '-'}</span>
                      </div>
                      <div className="cr-dtask-detail-row">
                        <span>Branch:</span> <span>{task.branch || '-'}</span>
                      </div>
                      {task.exit_code !== null && (
                        <div className="cr-dtask-detail-row">
                          <span>Exit code:</span> <span>{task.exit_code}</span>
                        </div>
                      )}
                      {task.logs && (
                        <div className="cr-build-log">
                          <pre>{task.logs}</pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
