import { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import type { ProjectInfo } from '../../components/unified/TerminalSession';
import TabBar from '../../components/TabBar';
import './TerminalTab.css';

const MasterSession = lazy(() => import('../../components/unified/MasterSession'));
const CodexSession = lazy(() => import('../../components/unified/CodexSession'));

const getApiBase = () => {
  const host = window.location.hostname;
  if (host === 'askalf.org' || host === 'www.askalf.org' ) return '';
  if (host === 'localhost' || host === '127.0.0.1') return 'http://localhost:3001';
  return '';
};

type WorkspaceMode = 'claude' | 'codex' | 'files';

const MODE_TABS = [
  { key: 'claude', label: 'Claude Code' },
  { key: 'codex', label: 'Codex' },
  { key: 'files', label: 'Files' },
];

// ── Files Panel ──

interface RepoInfo {
  name: string;
  path: string;
  type: string;
}

interface RemoteRepo {
  id: string;
  provider: string;
  repo_full_name: string;
  clone_url: string | null;
  is_private: boolean;
  language: string | null;
}

function FilesPanel() {
  const [repos, setRepos] = useState<RepoInfo[]>([]);
  const [remoteRepos, setRemoteRepos] = useState<RemoteRepo[]>([]);
  const [loading, setLoading] = useState(true);
  const [cloneUrl, setCloneUrl] = useState('');
  const [cloneName, setCloneName] = useState('');
  const [cloning, setCloning] = useState(false);
  const [newRepoName, setNewRepoName] = useState('');
  const [newRepoDesc, setNewRepoDesc] = useState('');
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [projRes, repoRes] = await Promise.all([
        fetch(`${getApiBase()}/api/v1/admin/projects`, { credentials: 'include' }),
        fetch(`${getApiBase()}/api/v1/integrations/repos`, { credentials: 'include' }),
      ]);
      if (projRes.ok) {
        const data = await projRes.json() as { projects: RepoInfo[] };
        setRepos(data.projects || []);
      }
      if (repoRes.ok) {
        const data = await repoRes.json() as { repos: RemoteRepo[] };
        setRemoteRepos(data.repos || []);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleClone = async (url?: string, name?: string) => {
    const repoUrl = url || cloneUrl.trim();
    const repoName = name || cloneName.trim() || repoUrl.split('/').pop()?.replace('.git', '') || '';
    if (!repoUrl || !repoName) return;
    setCloning(true);
    setMessage(null);
    try {
      const res = await fetch(`${getApiBase()}/api/v1/admin/projects/clone`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: repoUrl, name: repoName }),
      });
      if (res.ok) {
        setMessage({ type: 'success', text: `Cloned ${repoName}` });
        setCloneUrl('');
        setCloneName('');
        fetchData();
      } else {
        const err = await res.json().catch(() => ({ error: 'Clone failed' })) as { error?: string };
        setMessage({ type: 'error', text: err.error || 'Clone failed' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Network error' });
    }
    setCloning(false);
  };

  const handleCreate = async () => {
    if (!newRepoName.trim()) return;
    setCreating(true);
    setMessage(null);
    try {
      const res = await fetch(`${getApiBase()}/api/v1/admin/projects/create`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newRepoName.trim(), description: newRepoDesc.trim() }),
      });
      if (res.ok) {
        setMessage({ type: 'success', text: `Created ${newRepoName.trim()}` });
        setNewRepoName('');
        setNewRepoDesc('');
        setShowCreate(false);
        fetchData();
      } else {
        const err = await res.json().catch(() => ({ error: 'Create failed' })) as { error?: string };
        setMessage({ type: 'error', text: err.error || 'Create failed' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Network error' });
    }
    setCreating(false);
  };

  if (loading) return <div style={{ padding: '2rem', color: 'var(--text-muted)', textAlign: 'center' }}>Loading...</div>;

  return (
    <div style={{ padding: '1.5rem', height: '100%', overflow: 'auto' }}>
      <h3 style={{ margin: '0 0 4px', fontSize: '1rem', fontWeight: 700, color: 'var(--text)' }}>Files & Repos</h3>
      <p style={{ margin: '0 0 16px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
        Clone repos, manage files, and browse worker outputs
      </p>

      {message && (
        <div style={{ padding: '8px 12px', marginBottom: 12, borderRadius: 8, fontSize: '0.8rem', fontWeight: 600, background: message.type === 'success' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)', color: message.type === 'success' ? '#22c55e' : '#ef4444', border: `1px solid ${message.type === 'success' ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}` }}>
          {message.text}
        </div>
      )}

      {/* Clone repo form */}
      <div style={{ padding: '14px 16px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, marginBottom: 16 }}>
        <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>Clone a Repository</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={cloneUrl} onChange={e => setCloneUrl(e.target.value)} placeholder="https://github.com/user/repo.git"
            style={{ flex: 2, padding: '8px 12px', background: 'var(--elevated)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', fontSize: '0.85rem', fontFamily: 'var(--font-mono)' }} />
          <input value={cloneName} onChange={e => setCloneName(e.target.value)} placeholder="repo name (optional)"
            style={{ flex: 1, padding: '8px 12px', background: 'var(--elevated)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', fontSize: '0.85rem' }} />
          <button onClick={() => handleClone()} disabled={cloning || !cloneUrl.trim()}
            style={{ padding: '8px 16px', background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer', opacity: !cloneUrl.trim() ? 0.4 : 1 }}>
            {cloning ? 'Cloning...' : 'Clone'}
          </button>
        </div>
      </div>

      {/* Create local repo */}
      <div style={{ padding: '14px 16px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: showCreate ? 8 : 0 }}>
          <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text)' }}>Create Local Repo</div>
          <button onClick={() => setShowCreate(!showCreate)}
            style={{ padding: '4px 12px', fontSize: '0.7rem', background: 'var(--elevated)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-muted)', cursor: 'pointer' }}>
            {showCreate ? 'Cancel' : 'New Repo'}
          </button>
        </div>
        {showCreate && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input value={newRepoName} onChange={e => setNewRepoName(e.target.value)} placeholder="my-project"
              onKeyDown={e => { if (e.key === 'Enter') handleCreate(); }}
              style={{ padding: '8px 12px', background: 'var(--elevated)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', fontSize: '0.85rem', fontFamily: 'var(--font-mono)' }} />
            <input value={newRepoDesc} onChange={e => setNewRepoDesc(e.target.value)} placeholder="Description (optional)"
              style={{ padding: '8px 12px', background: 'var(--elevated)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', fontSize: '0.85rem' }} />
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button onClick={handleCreate} disabled={creating || !newRepoName.trim()}
                style={{ padding: '8px 16px', background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer', opacity: !newRepoName.trim() ? 0.4 : 1 }}>
                {creating ? 'Creating...' : 'Create'}
              </button>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Initializes a git repo with README. Push to GitHub/GitLab from the terminal.</span>
            </div>
          </div>
        )}
      </div>

      {/* Connected repos from source control */}
      {remoteRepos.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Connected Repos</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {remoteRepos.map(r => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', minWidth: 20 }}>{r.provider === 'github' ? 'GH' : r.provider === 'gitlab' ? 'GL' : 'BB'}</span>
                <span style={{ flex: 1, fontSize: '0.85rem', color: 'var(--text)', fontWeight: 600 }}>{r.repo_full_name}</span>
                {r.is_private && <span style={{ fontSize: '0.6rem', padding: '1px 6px', borderRadius: 8, background: 'rgba(107,114,128,0.1)', color: '#6b7280' }}>private</span>}
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{r.language || ''}</span>
                <button onClick={() => handleClone(r.clone_url || '', r.repo_full_name.split('/').pop() || '')} disabled={cloning}
                  style={{ padding: '4px 10px', fontSize: '0.7rem', background: 'var(--elevated)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', cursor: 'pointer' }}>
                  Clone
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Local repos */}
      <div>
        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Local Repos</div>
        {repos.filter(r => r.type === 'repo').length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {repos.filter(r => r.type === 'repo').map(r => (
              <div key={r.path} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
                <span style={{ fontSize: '1rem' }}>{'\u{1F4C1}'}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text)' }}>{r.name}</div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{r.path}</div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            No repos cloned yet. Clone one above or connect source control in Settings &gt; Integrations.
          </div>
        )}
      </div>
    </div>
  );
}

// ── Component ──

export default function TerminalTab({ onNavigate: _onNavigate }: { onNavigate?: (tab: string) => void }) {
  const [mode, setMode] = useState<WorkspaceMode>('claude');
  const [projects, setProjects] = useState<ProjectInfo[]>([]);

  useEffect(() => {
    fetch(`${getApiBase()}/api/v1/admin/projects`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
      .then((data: { projects: ProjectInfo[] }) => setProjects(data.projects))
      .catch(() => setProjects([]));
  }, []);

  return (
    <div className="terminal-container" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TabBar tabs={MODE_TABS} active={mode} onChange={(k) => setMode(k as WorkspaceMode)} className="terminal-mode-bar" tabClassName="terminal-mode-btn" ariaLabel="Workspace mode selection" />
      <div style={{ flex: 1, minHeight: 0 }}>
        <Suspense fallback={<div style={{ padding: '1rem', color: '#71717a' }}>Loading...</div>}>
          {mode === 'claude' && <MasterSession projects={projects} />}
          {mode === 'codex' && <CodexSession projects={projects} />}
          {mode === 'files' && <FilesPanel />}
        </Suspense>
      </div>
    </div>
  );
}
