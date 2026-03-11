import { useState, useEffect, lazy, Suspense } from 'react';
import type { ProjectInfo } from '../../components/unified/MasterSession';
import './TerminalTab.css';

const MasterSession = lazy(() => import('../../components/unified/MasterSession'));
const CodexSession = lazy(() => import('../../components/unified/CodexSession'));

// ── API helper ──

const getApiBase = () => {
  const host = window.location.hostname;
  if (host.includes('askalf.org') || host.includes('amnesia.tax')) return '';
  if (host === 'localhost' || host === '127.0.0.1') return 'http://localhost:3001';
  return '';
};

// ── Mode Toggle ──

type CodeMode = 'claude' | 'codex';

const MODE_LABELS: { key: CodeMode; label: string }[] = [
  { key: 'codex', label: 'Codex' },
  { key: 'claude', label: 'Claude Code' },
];

function ModeBar({ mode, setMode }: { mode: CodeMode; setMode: (m: CodeMode) => void }) {
  return (
    <div className="terminal-mode-bar" role="tablist" aria-label="Code mode selection">
      {MODE_LABELS.map(({ key, label }) => (
        <button
          key={key}
          role="tab"
          aria-selected={mode === key}
          className={`terminal-mode-btn ${mode === key ? 'active' : ''}`}
          onClick={() => setMode(key)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// ── Component ──

export default function TerminalTab({ onNavigate: _onNavigate }: { onNavigate?: (tab: string) => void }) {
  const [mode, setMode] = useState<CodeMode>('claude');
  const [projects, setProjects] = useState<ProjectInfo[]>([]);

  useEffect(() => {
    fetch(`${getApiBase()}/api/v1/admin/projects`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
      .then((data: { projects: ProjectInfo[] }) => setProjects(data.projects))
      .catch(() => setProjects([]));
  }, []);

  return (
    <div className="terminal-container" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <ModeBar mode={mode} setMode={setMode} />
      <div style={{ flex: 1, minHeight: 0 }}>
        <Suspense fallback={<div style={{ padding: '1rem', color: '#71717a' }}>Loading terminal...</div>}>
          {mode === 'claude'
            ? <MasterSession projects={projects} />
            : <CodexSession projects={projects} />
          }
        </Suspense>
      </div>
    </div>
  );
}
