import { useState, useEffect } from 'react';
import { useBranchStore, type DiffFile } from '../stores/branches';

const SERVICES = [
  { id: 'api', label: 'API Server' },
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'forge', label: 'Forge' },
  { id: 'self', label: 'Self' },
  { id: 'askalf', label: 'Ask Alf' },
  { id: 'just-push', label: 'Just Push' },
  { id: 'nginx', label: 'Nginx' },
  { id: 'mcp-tools', label: 'MCP Tools' },
];

const SERVICE_PATH_MAP: Record<string, string[]> = {
  'apps/api/': ['api'],
  'apps/dashboard/': ['dashboard'],
  'apps/forge/': ['forge'],
  'apps/self/': ['self'],
  'apps/askalf/': ['askalf'],
  'apps/just-push/': ['just-push'],
  'apps/mcp-tools/': ['mcp-tools'],
  'packages/': ['api', 'dashboard', 'forge', 'self', 'askalf', 'mcp-tools'],
  'infrastructure/nginx/': ['nginx'],
};

function detectAffected(files: DiffFile[]): Set<string> {
  const affected = new Set<string>();
  for (const file of files) {
    for (const [prefix, services] of Object.entries(SERVICE_PATH_MAP)) {
      if (file.path.startsWith(prefix)) services.forEach((s) => affected.add(s));
    }
  }
  return affected;
}

interface DeployPanelProps {
  diffFiles: DiffFile[];
  onClose?: () => void;
}

export default function DeployPanel({ diffFiles, onClose }: DeployPanelProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const [action, setAction] = useState<'rebuild' | 'restart'>('rebuild');
  const [step, setStep] = useState<'select' | 'progress'>('select');

  const deploying = useBranchStore((s) => s.deploying);
  const startDeploy = useBranchStore((s) => s.startDeploy);
  const activeDeployTask = useBranchStore((s) => s.activeDeployTask);
  const healthResults = useBranchStore((s) => s.healthResults);
  const healthChecking = useBranchStore((s) => s.healthChecking);
  const checkHealth = useBranchStore((s) => s.checkHealth);

  const affected = detectAffected(diffFiles);

  useEffect(() => {
    if (affected.size > 0 && selected.length === 0) {
      setSelected(Array.from(affected));
    }
  }, []); // eslint-disable-line

  useEffect(() => {
    if (activeDeployTask?.status === 'completed') {
      const timer = setTimeout(() => checkHealth(activeDeployTask.services), 3000);
      return () => clearTimeout(timer);
    }
  }, [activeDeployTask?.status]); // eslint-disable-line

  const toggle = (id: string) => {
    setSelected((prev) => prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]);
  };

  const handleDeploy = async () => {
    if (selected.length === 0) return;
    setStep('progress');
    await startDeploy(selected, action);
  };

  if (step === 'progress') {
    return (
      <div className="jp-deploy">
        <h3 className="jp-deploy-title">Deploy Progress</h3>
        {activeDeployTask ? (
          <>
            <div className={`jp-deploy-status ${activeDeployTask.status === 'failed' ? 'jp-deploy-status--fail' : activeDeployTask.status === 'completed' ? 'jp-deploy-status--ok' : ''}`}>
              {activeDeployTask.status === 'running' && 'Deploying...'}
              {activeDeployTask.status === 'completed' && 'Deploy completed!'}
              {activeDeployTask.status === 'failed' && `Deploy failed (exit ${activeDeployTask.exit_code ?? '?'})`}
            </div>
            {activeDeployTask.logs && <pre className="jp-deploy-logs">{activeDeployTask.logs}</pre>}
            {activeDeployTask.status === 'completed' && (
              <div className="jp-deploy-health">
                <p className="jp-deploy-health-title">Service Health {healthChecking && '(checking...)'}</p>
                {selected.map((id) => {
                  const svc = SERVICES.find((s) => s.id === id);
                  const h = healthResults[id];
                  return (
                    <div key={id} className="jp-deploy-health-row">
                      <span>{svc?.label || id}</span>
                      <span className={`jp-health-dot ${h?.running ? 'jp-health--ok' : 'jp-health--down'}`}>
                        {h ? (h.running ? 'Running' : h.status) : 'Waiting...'}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        ) : (
          <div className="jp-deploy-status">{deploying ? 'Initiating...' : 'Deploy task created.'}</div>
        )}
        {onClose && <button className="jp-btn jp-btn--primary" onClick={onClose}>Close</button>}
      </div>
    );
  }

  return (
    <div className="jp-deploy">
      <h3 className="jp-deploy-title">Deploy Services</h3>

      {affected.size > 0 && (
        <p className="jp-deploy-detected">
          {affected.size} affected service{affected.size !== 1 ? 's' : ''} detected from changes
        </p>
      )}

      <div className="jp-deploy-grid">
        {SERVICES.map((svc) => (
          <label key={svc.id} className={`jp-deploy-item ${selected.includes(svc.id) ? 'jp-deploy-item--selected' : ''}`}>
            <input type="checkbox" checked={selected.includes(svc.id)} onChange={() => toggle(svc.id)} />
            <span>{svc.label}</span>
            {affected.has(svc.id) && <span className="jp-deploy-badge">Changed</span>}
          </label>
        ))}
      </div>

      <div className="jp-deploy-actions">
        <label className={`jp-deploy-action ${action === 'rebuild' ? 'jp-deploy-action--active' : ''}`}>
          <input type="radio" name="action" checked={action === 'rebuild'} onChange={() => setAction('rebuild')} />
          Rebuild & Deploy
        </label>
        <label className={`jp-deploy-action ${action === 'restart' ? 'jp-deploy-action--active' : ''}`}>
          <input type="radio" name="action" checked={action === 'restart'} onChange={() => setAction('restart')} />
          Restart Only
        </label>
      </div>

      <div className="jp-deploy-footer">
        {onClose && <button className="jp-btn jp-btn--secondary" onClick={onClose}>Cancel</button>}
        <button className="jp-btn jp-btn--primary" onClick={handleDeploy} disabled={selected.length === 0 || deploying}>
          {deploying ? 'Starting...' : `Deploy ${selected.length} service${selected.length !== 1 ? 's' : ''}`}
        </button>
      </div>
    </div>
  );
}
