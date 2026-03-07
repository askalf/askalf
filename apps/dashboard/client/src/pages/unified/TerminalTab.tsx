import { useState, lazy, Suspense } from 'react';
import './TerminalTab.css';

const MasterSession = lazy(() => import('../../components/unified/MasterSession'));
const CodexSession = lazy(() => import('../../components/unified/CodexSession'));

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

  return (
    <div className="terminal-container" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <ModeBar mode={mode} setMode={setMode} />
      <div style={{ flex: 1, minHeight: 0 }}>
        <Suspense fallback={<div style={{ padding: '1rem', color: '#71717a' }}>Loading terminal...</div>}>
          {mode === 'claude' ? <MasterSession /> : <CodexSession />}
        </Suspense>
      </div>
    </div>
  );
}
