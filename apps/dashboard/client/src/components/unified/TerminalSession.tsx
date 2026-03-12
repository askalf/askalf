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

  const handleProjectSelect = useCallback((path: string) => {
    setCwd(path);
    onSetCwd?.(path);
    setCwdOpen(false);
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
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
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
        {projects && projects.length > 0 && (
          <div className="ud-master-project-picker" style={{ position: 'relative' }}>
            <button
              className="ud-btn-sm ud-project-btn"
              onClick={() => setCwdOpen(o => !o)}
              title={status?.cwd || 'Select project'}
            >
              {status?.cwd ? status.cwd.split('/').pop() : 'Project'} ▾
            </button>
            {cwdOpen && (
              <div className="ud-project-dropdown">
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
              </div>
            )}
          </div>
        )}
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
