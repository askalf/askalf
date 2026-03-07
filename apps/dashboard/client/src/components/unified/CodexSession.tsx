import { useEffect, useRef, useState, useCallback } from 'react';
import { useCodexSession } from '../../hooks/useCodexSession';
import '@xterm/xterm/css/xterm.css';

// Dynamic imports for xterm (loaded client-side only)
let Terminal: typeof import('@xterm/xterm').Terminal | null = null;
let FitAddon: typeof import('@xterm/addon-fit').FitAddon | null = null;
let WebLinksAddon: typeof import('@xterm/addon-web-links').WebLinksAddon | null = null;

export default function CodexSession() {
  const termRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<InstanceType<typeof import('@xterm/xterm').Terminal> | null>(null);
  const fitAddonRef = useRef<InstanceType<typeof import('@xterm/addon-fit').FitAddon> | null>(null);
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const { connected, status, send, sendSignal, resize, restart, onData, onHistory } = useCodexSession();

  const debouncedResize = useCallback((cols: number, rows: number) => {
    if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current);
    resizeTimerRef.current = setTimeout(() => {
      resize(cols, rows);
    }, 150);
  }, [resize]);

  // Load xterm dynamically
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

  // Initialize terminal once loaded
  useEffect(() => {
    if (!loaded || !termRef.current || !Terminal || !FitAddon || !WebLinksAddon) return;
    if (terminalRef.current) return; // already init

    const term = new Terminal({
      theme: {
        background: '#0a0a0f',
        foreground: '#e4e4e7',
        cursor: '#10b981',
        cursorAccent: '#0a0a0f',
        selectionBackground: 'rgba(16, 185, 129, 0.3)',
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

    // Forward user input to backend
    term.onData((data) => {
      send(data);
    });

    // Handle resize with debounce
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
  }, [loaded, send, debouncedResize]);

  // Wire up data/history callbacks
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

  if (loadError) {
    return (
      <div className="ud-master-session ud-codex-session">
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
    <div className="ud-master-session ud-codex-session" role="region" aria-label="Codex terminal">
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
            title="Restart Codex session"
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
