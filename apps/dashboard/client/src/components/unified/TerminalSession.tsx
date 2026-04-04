import { useEffect, useRef, useState, useCallback } from 'react';
import { useTerminalSession } from '../../hooks/useTerminalSession';
import '@xterm/xterm/css/xterm.css';

let Terminal: typeof import('@xterm/xterm').Terminal | null = null;
let FitAddon: typeof import('@xterm/addon-fit').FitAddon | null = null;
let WebLinksAddon: typeof import('@xterm/addon-web-links').WebLinksAddon | null = null;

export interface ProjectInfo {
  path: string;
  name: string;
  type: string;
  branch?: string;
}

export interface TerminalSessionConfig {
  wsPath: string;
  cursorColor: string;
  selectionBackground: string;
  extraClassName?: string;
  ariaLabel: string;
  restartLabel: string;
}

interface RemoteRepo {
  id: string;
  provider: string;
  repo_full_name: string;
  clone_url: string | null;
  default_branch: string;
  is_private: boolean;
  language: string | null;
}

const getApiBase = () => {
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') return 'http://localhost:3001';
  return '';
};

export default function TerminalSession({
  config,
  projects,
  onSetCwd,
}: {
  config: TerminalSessionConfig;
  projects?: ProjectInfo[];
  onSetCwd?: (cwd: string) => void;
}) {
  const termRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<InstanceType<typeof import('@xterm/xterm').Terminal> | null>(null);
  const fitAddonRef = useRef<InstanceType<typeof import('@xterm/addon-fit').FitAddon> | null>(null);
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const { connected, status, send, sendSignal, resize, restart, setCwd, onData, onHistory } = useTerminalSession(config.wsPath);
  const [cwdOpen, setCwdOpen] = useState(false);
  const [remoteRepos, setRemoteRepos] = useState<RemoteRepo[]>([]);
  const [cloning, setCloning] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${getApiBase()}/api/v1/integrations/repos`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : { repos: [] })
      .then((data: { repos: RemoteRepo[] }) => setRemoteRepos(data.repos || []))
      .catch(() => {});
  }, []);

  const handleProjectSelect = useCallback((path: string) => {
    setCwd(path);
    onSetCwd?.(path);
    setCwdOpen(false);
  }, [setCwd, onSetCwd]);

  const handleCloneRepo = useCallback(async (repo: RemoteRepo) => {
    if (!repo.clone_url) return;
    setCloning(repo.repo_full_name);
    try {
      const res = await fetch(`${getApiBase()}/api/v1/admin/projects/clone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ url: repo.clone_url, name: repo.repo_full_name.split('/').pop() }),
      });
      if (res.ok) {
        const data = await res.json() as { path: string };
        setCwd(data.path);
        onSetCwd?.(data.path);
        setCwdOpen(false);
      }
    } catch { /* ignore */ }
    setCloning(null);
  }, [setCwd, onSetCwd]);

  const debouncedResize = useCallback((cols: number, rows: number) => {
    if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current);
    resizeTimerRef.current = setTimeout(() => {
      resize(cols, rows);
    }, 150);
  }, [resize]);

  useEffect(() => {
    Promise.all([
      import('@xterm/xterm'),
      import('@xterm/addon-fit'),
      import('@xterm/addon-web-links'),
    ]).then(([xtermModule, fitModule, linksModule]) => {
      Terminal = xtermModule.Terminal;
      FitAddon = fitModule.FitAddon;
      WebLinksAddon = linksModule.WebLinksAddon;
      setLoaded(true);
    }).catch(() => {
      setLoadError(true);
    });
  }, []);

  useEffect(() => {
    if (!loaded || !termRef.current || !Terminal || !FitAddon || !WebLinksAddon) return;
    if (terminalRef.current) return;

    const term = new Terminal({
      theme: {
        background: '#0a0a0f',
        foreground: '#e4e4e7',
        cursor: config.cursorColor,
        cursorAccent: '#0a0a0f',
        selectionBackground: config.selectionBackground,
        black: '#18181b',
        red: '#ef4444',
        green: '#22c55e',
        yellow: '#eab308',
        blue: '#3b82f6',
        magenta: '#a78bfa',
        cyan: '#06b6d4',
        white: '#e4e4e7',
        brightBlack: '#52525b',
        brightRed: '#f87171',
        brightGreen: '#4ade80',
        brightYellow: '#facc15',
        brightBlue: '#60a5fa',
        brightMagenta: '#c4b5fd',
        brightCyan: '#22d3ee',
        brightWhite: '#fafafa',
      },
      fontFamily: 'var(--font-mono)',
      fontSize: 13,
      lineHeight: 1.4,
      scrollback: 10000,
      cursorBlink: true,
      cursorStyle: 'block',
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());

    term.open(termRef.current);
    fitAddon.fit();

    terminalRef.current = term;
    fitAddonRef.current = fitAddon;

    term.onData((data) => {
      send(data);
    });

    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit();
        debouncedResize(term.cols, term.rows);
      } catch {
        // terminal may be disposed during resize
      }
    });
    resizeObserver.observe(termRef.current);

    return () => {
      resizeObserver.disconnect();
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current);
      term.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [loaded, send, debouncedResize, config.cursorColor, config.selectionBackground]);

  useEffect(() => {
    onData.current = (data: string) => {
      terminalRef.current?.write(data);
    };
    onHistory.current = (history: string[]) => {
      if (terminalRef.current) {
        terminalRef.current.clear();
        for (const chunk of history) {
          terminalRef.current.write(chunk);
        }
      }
    };
  }, [onData, onHistory]);

  const rootClass = `ud-master-session${config.extraClassName ? ` ${config.extraClassName}` : ''}`;

  if (loadError) {
    return (
      <div className={rootClass}>
        <div className="ud-master-overlay">
          <span>Failed to load terminal</span>
        </div>
      </div>
    );
  }

  const statusLabel = status?.status || 'connecting';
  const statusColor = connected
    ? status?.status === 'running' ? '#22c55e' : '#eab308'
    : '#ef4444';

  const isFailed = status?.status === 'failed';

  return (
    <div className={rootClass} role="region" aria-label={config.ariaLabel}>
      <div className="ud-master-toolbar">
        <div className="ud-master-status">
          <span
            className="ud-health-dot"
            style={{ background: statusColor }}
            role="status"
            aria-label={`Session status: ${statusLabel}`}
          />
          <span>{statusLabel}</span>
          {status?.pid && <span className="ud-master-pid">PID {status.pid}</span>}
        </div>
        <div className="ud-master-project-picker" style={{ position: 'relative' }}>
          <button
            className="ud-btn-sm ud-project-btn"
            onClick={() => setCwdOpen(o => !o)}
            title={status?.cwd || 'Select workspace'}
          >
            {status?.cwd ? status.cwd.split('/').pop() : 'Workspace'} ▾
          </button>
          {cwdOpen && (
            <div className="ud-project-dropdown" style={{ maxHeight: '400px', overflowY: 'auto', minWidth: '280px' }}>
              {projects && projects.length > 0 && (
                <>
                  <div style={{ padding: '4px 10px', fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(255,255,255,0.25)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>Local Projects</div>
                  {projects.map(p => (
                    <button
                      key={p.path}
                      className={`ud-project-item ${status?.cwd === p.path ? 'active' : ''}`}
                      onClick={() => handleProjectSelect(p.path)}
                    >
                      <span className="ud-project-name">{p.name}</span>
                      <span className="ud-project-type">{p.branch || p.type}</span>
                    </button>
                  ))}
                </>
              )}
              {remoteRepos.length > 0 && (
                <>
                  <div style={{ padding: '4px 10px', fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(255,255,255,0.25)', borderBottom: '1px solid rgba(255,255,255,0.06)', marginTop: projects && projects.length > 0 ? '4px' : '0' }}>Connected Repos</div>
                  {remoteRepos.map(r => (
                    <button
                      key={r.id}
                      className="ud-project-item"
                      onClick={() => handleCloneRepo(r)}
                      disabled={cloning === r.repo_full_name}
                    >
                      <span className="ud-project-name" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span style={{ fontSize: '10px', opacity: 0.5 }}>{r.provider === 'github' ? 'GH' : r.provider === 'gitlab' ? 'GL' : 'BB'}</span>
                        {r.repo_full_name}
                        {r.is_private && <span style={{ fontSize: '8px', padding: '0 4px', background: 'rgba(255,255,255,0.06)', borderRadius: '3px', color: 'rgba(255,255,255,0.3)' }}>private</span>}
                      </span>
                      <span className="ud-project-type">
                        {cloning === r.repo_full_name ? 'cloning...' : r.language || r.default_branch}
                      </span>
                    </button>
                  ))}
                </>
              )}
              {(!projects || projects.length === 0) && remoteRepos.length === 0 && (
                <div style={{ padding: '12px', fontSize: '12px', color: 'rgba(255,255,255,0.3)', textAlign: 'center' }}>
                  No projects or repos. Connect a source control integration in Settings.
                </div>
              )}
            </div>
          )}
        </div>
        <div className="ud-master-actions">
          <button
            className="ud-btn-sm"
            onClick={() => sendSignal('SIGINT')}
            title="Send Ctrl+C (interrupt)"
            aria-label="Send interrupt signal"
            disabled={!connected}
          >
            Ctrl+C
          </button>
          <button
            className="ud-btn-sm"
            onClick={restart}
            title={config.restartLabel}
            aria-label="Restart session"
          >
            Restart
          </button>
        </div>
      </div>
      <div className="ud-master-terminal" ref={termRef} role="log" aria-label="Terminal output" />
      {(!connected || isFailed) && (
        <div className="ud-master-overlay">
          <span>{isFailed ? 'Session failed — click Restart' : 'Reconnecting...'}</span>
        </div>
      )}
    </div>
  );
}
