import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import type { AgentLog } from '../../hooks/useHubApi';

// ANSI SGR color/style map
const ANSI_FG: Record<number, string> = {
  30: '#6b7280', 31: '#f87171', 32: '#4ade80', 33: '#fbbf24',
  34: '#60a5fa', 35: '#a78bfa', 36: '#34d399', 37: '#e4e4e7',
  90: '#9ca3af', 91: '#fb7185', 92: '#86efac', 93: '#fde68a',
  94: '#93c5fd', 95: '#c4b5fd', 96: '#6ee7b7', 97: '#f9fafb',
};
const ANSI_BG: Record<number, string> = {
  40: '#1a1a2e', 41: '#450a0a', 42: '#052e16', 43: '#422006',
  44: '#172554', 45: '#2e1065', 46: '#022c22', 47: '#3f3f46',
};

interface AnsiSpan { text: string; color?: string; bg?: string; bold?: boolean; underline?: boolean; }

function splitAnsi(text: string): AnsiSpan[] {
  const ANSI_RE = /\x1b\[(\d+(?:;\d+)*)m/g;
  const spans: AnsiSpan[] = [];
  let color: string | undefined;
  let bg: string | undefined;
  let bold = false;
  let underline = false;
  let lastIndex = 0;

  const flush = (chunk: string) => {
    if (chunk) spans.push({ text: chunk, color, bg, bold, underline });
  };

  let match: RegExpExecArray | null;
  ANSI_RE.lastIndex = 0;
  while ((match = ANSI_RE.exec(text)) !== null) {
    flush(text.slice(lastIndex, match.index));
    const codes = match[1].split(';').map(Number);
    for (const c of codes) {
      if (c === 0) { color = undefined; bg = undefined; bold = false; underline = false; }
      else if (c === 1) bold = true;
      else if (c === 22) bold = false;
      else if (c === 4) underline = true;
      else if (c === 24) underline = false;
      else if (ANSI_FG[c]) color = ANSI_FG[c];
      else if (ANSI_BG[c]) bg = ANSI_BG[c];
      else if (c === 39) color = undefined;
      else if (c === 49) bg = undefined;
    }
    lastIndex = match.index + match[0].length;
  }
  flush(text.slice(lastIndex));
  return spans;
}

function AnsiText({ text }: { text: string }) {
  // Fast path: no ANSI codes
  if (!text.includes('\x1b[')) return <>{text}</>;
  const spans = splitAnsi(text);
  return (
    <>
      {spans.map((s, i) => {
        const hasStyle = s.color || s.bg || s.bold || s.underline;
        if (!hasStyle) return <span key={i}>{s.text}</span>;
        const style: React.CSSProperties = {};
        if (s.color) style.color = s.color;
        if (s.bg) style.background = s.bg;
        if (s.bold) style.fontWeight = 'bold';
        if (s.underline) style.textDecoration = 'underline';
        return <span key={i} style={style}>{s.text}</span>;
      })}
    </>
  );
}

const formatTs = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
};

const LEVEL_OPTIONS = ['all', 'info', 'warn', 'error', 'debug'] as const;

interface Props {
  logs: AgentLog[];
  isLive?: boolean;
  maxHeight?: number;
}

export function ExecutionLogViewer({ logs, isLive = false, maxHeight = 400 }: Props) {
  const [search, setSearch] = useState('');
  const [levelFilter, setLevelFilter] = useState<string>('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const [showTs, setShowTs] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevLogCountRef = useRef(logs.length);

  // Auto-scroll when new logs arrive
  useEffect(() => {
    if (autoScroll && scrollRef.current && logs.length !== prevLogCountRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
    prevLogCountRef.current = logs.length;
  }, [logs, autoScroll]);

  // Scroll to bottom on mount
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const atBottom = scrollHeight - scrollTop - clientHeight < 30;
    if (!atBottom && autoScroll) setAutoScroll(false);
  }, [autoScroll]);

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    setAutoScroll(true);
  }, []);

  const filteredLogs = useMemo(() => {
    const q = search.toLowerCase();
    return logs.filter(log => {
      if (levelFilter !== 'all' && log.level !== levelFilter) return false;
      if (q && !log.message.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [logs, search, levelFilter]);

  const hasSearch = search !== '' || levelFilter !== 'all';

  return (
    <div className="elv">
      {/* Toolbar */}
      <div className="elv-toolbar">
        <div className="elv-toolbar-left">
          <div className="elv-search-wrap">
            <svg className="elv-search-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
            </svg>
            <input
              type="search"
              className="elv-search"
              placeholder="Filter logs..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              aria-label="Search log messages"
            />
            {search && (
              <button className="elv-search-clear" onClick={() => setSearch('')} aria-label="Clear search">×</button>
            )}
          </div>
          <select
            className="elv-level-select"
            value={levelFilter}
            onChange={e => setLevelFilter(e.target.value)}
            aria-label="Filter by log level"
          >
            {LEVEL_OPTIONS.map(l => (
              <option key={l} value={l}>{l === 'all' ? 'All levels' : l.toUpperCase()}</option>
            ))}
          </select>
        </div>
        <div className="elv-toolbar-right">
          {hasSearch && (
            <span className="elv-count">
              {filteredLogs.length} / {logs.length}
            </span>
          )}
          {!hasSearch && (
            <span className="elv-count">{logs.length} lines</span>
          )}
          <button
            className={`elv-ctrl-btn${showTs ? ' elv-ctrl-btn--on' : ''}`}
            onClick={() => setShowTs(v => !v)}
            title={showTs ? 'Hide timestamps' : 'Show timestamps'}
            aria-pressed={showTs}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
            </svg>
            TS
          </button>
          <button
            className={`elv-ctrl-btn${autoScroll ? ' elv-ctrl-btn--on' : ''}`}
            onClick={() => autoScroll ? setAutoScroll(false) : scrollToBottom()}
            title={autoScroll ? 'Auto-scroll on — click to disable' : 'Auto-scroll off — click to enable'}
            aria-pressed={autoScroll}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <polyline points="7 13 12 18 17 13"/><polyline points="7 6 12 11 17 6"/>
            </svg>
            {isLive && autoScroll && <span className="elv-live-dot" aria-label="live" />}
          </button>
        </div>
      </div>

      {/* Log scroll area */}
      <div
        className="elv-scroll"
        ref={scrollRef}
        onScroll={handleScroll}
        style={{ maxHeight: `${maxHeight}px` }}
        role="log"
        aria-live={isLive ? 'polite' : 'off'}
        aria-label="Execution log output"
        aria-atomic="false"
      >
        {filteredLogs.length === 0 ? (
          <div className="elv-empty">
            {logs.length === 0
              ? 'No log entries available'
              : 'No entries match your filter'}
          </div>
        ) : (
          filteredLogs.map(log => (
            <div key={log.id} className={`elv-line elv-line--${log.level}`}>
              {showTs && (
                <span className="elv-ts" title={log.created_at}>{formatTs(log.created_at)}</span>
              )}
              <span className={`elv-lvl elv-lvl--${log.level}`} aria-label={`level: ${log.level}`}>
                {log.level.toUpperCase()}
              </span>
              <span className="elv-msg">
                <AnsiText text={log.message} />
              </span>
              {log.metadata?.tool_calls && Array.isArray(log.metadata.tool_calls) ? (
                <div className="elv-tools" aria-label="Tool calls">
                  {(log.metadata.tool_calls as Array<{ name?: string; tool?: string }>).map((tc, i) => (
                    <span key={i} className="elv-tool-badge">{tc.name || tc.tool || 'tool'}</span>
                  ))}
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>

      {/* Scroll-to-bottom banner */}
      {!autoScroll && (
        <button className="elv-jump-btn" onClick={scrollToBottom} aria-label="Scroll to bottom">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
            <polyline points="7 13 12 18 17 13"/><polyline points="7 6 12 11 17 6"/>
          </svg>
          Scroll to bottom
        </button>
      )}
    </div>
  );
}
