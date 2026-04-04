import { useState, useEffect, useRef, useCallback } from 'react';
import { useForgeEvents, type ForgeEvent } from '../../contexts/WebSocketContext';
import { usePolling } from '../../hooks/usePolling';
import { API_BASE } from '../../utils/api';

interface LiveExecution {
  id: string;
  agentId: string;
  agentName: string;
  status: string;
  input: string;
  output: string;
  cost: number;
  startedAt: string;
  completedAt?: string;
}

interface LogEntry {
  id: string;
  timestamp: string;
  agentName: string;
  type: 'start' | 'progress' | 'complete' | 'fail' | 'tool' | 'dispatch' | 'info';
  message: string;
  cost?: number;
}

export default function LiveTab({ wsEvents = [] }: { wsEvents?: ForgeEvent[] }) {
  const { connected } = useForgeEvents();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [activeExecutions, setActiveExecutions] = useState<LiveExecution[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [filter, setFilter] = useState('');
  const logEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Process WebSocket events into log entries
  useEffect(() => {
    if (wsEvents.length === 0) return;
    const event = wsEvents[0];
    if (!event) return;

    const entry: LogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      agentName: event.agentName || event.agentId || 'System',
      type: 'info',
      message: '',
    };

    if (event.category === 'execution') {
      const status = event.status as string || event.event as string || '';
      if (status === 'started' || status === 'running' || event.event === 'started') {
        entry.type = 'start';
        entry.message = `Execution started: ${(event.data as Record<string, unknown>)?.input?.toString().substring(0, 120) || event.executionId || ''}`;
      } else if (status === 'completed' || event.event === 'completed') {
        entry.type = 'complete';
        const data = event.data as Record<string, unknown> | undefined;
        entry.cost = Number(data?.cost || event.cost || 0);
        entry.message = `Completed ($${entry.cost?.toFixed(4) || '0'}) — ${(data?.output?.toString() || '').substring(0, 200)}`;
      } else if (status === 'failed' || event.event === 'failed') {
        entry.type = 'fail';
        entry.message = `Failed: ${(event.data as Record<string, unknown>)?.error || event.error || 'unknown'}`;
      } else if (event.event === 'progress') {
        entry.type = 'progress';
        entry.message = `Progress: ${JSON.stringify(event.data || {}).substring(0, 150)}`;
      } else if (event.event === 'tool_use') {
        entry.type = 'tool';
        const data = event.data as Record<string, unknown> | undefined;
        entry.message = `Tool: ${data?.tool || 'unknown'} ${data?.status || ''}`;
      } else {
        entry.type = 'info';
        entry.message = `${event.event || status}: ${JSON.stringify(event.data || {}).substring(0, 150)}`;
      }
    } else if (event.category === 'agent') {
      entry.type = 'dispatch';
      entry.message = `${event.event || 'status'}: ${event.status || JSON.stringify(event.data || {}).substring(0, 100)}`;
    } else if (event.category === 'coordination') {
      entry.type = 'info';
      entry.message = `Coordination: ${event.event || ''} ${JSON.stringify(event.data || {}).substring(0, 100)}`;
    } else {
      return; // Skip unknown categories
    }

    setLogs(prev => {
      const next = [...prev, entry];
      return next.length > 500 ? next.slice(-500) : next;
    });
  }, [wsEvents]);

  // Poll for active executions
  const fetchActive = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/admin/executions?limit=10&status=running`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json() as { executions: LiveExecution[] };
        setActiveExecutions(data.executions || []);
      }
    } catch { /* ignore */ }
  }, []);

  usePolling(fetchActive, 5000);

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  // Detect manual scroll
  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 50);
  };

  const filteredLogs = filter
    ? logs.filter(l => l.agentName.toLowerCase().includes(filter.toLowerCase()) || l.message.toLowerCase().includes(filter.toLowerCase()))
    : logs;

  const typeColors: Record<string, string> = {
    start: '#22c55e',
    complete: '#a78bfa',
    fail: '#ef4444',
    progress: '#3b82f6',
    tool: '#f59e0b',
    dispatch: '#06b6d4',
    info: 'rgba(255,255,255,0.4)',
  };

  const typeLabels: Record<string, string> = {
    start: 'START',
    complete: 'DONE',
    fail: 'FAIL',
    progress: 'PROG',
    tool: 'TOOL',
    dispatch: 'AGENT',
    info: 'INFO',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 0 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: connected ? '#22c55e' : '#ef4444', animation: connected ? 'pulse 2s infinite' : 'none' }} />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
            Live Stream
          </span>
          <span style={{ fontSize: '0.75rem', opacity: 0.4 }}>
            {activeExecutions.length} running · {logs.length} events
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Filter..."
            style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)', color: 'inherit', fontSize: '0.8rem', width: 150 }}
          />
          <button
            onClick={() => setLogs([])}
            style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: '0.75rem' }}
          >
            Clear
          </button>
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            style={{ padding: '4px 10px', borderRadius: 6, border: `1px solid ${autoScroll ? 'rgba(124,58,237,0.3)' : 'rgba(255,255,255,0.1)'}`, background: autoScroll ? 'rgba(124,58,237,0.1)' : 'transparent', color: autoScroll ? '#a78bfa' : 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: '0.75rem' }}
          >
            {autoScroll ? 'Auto-scroll ON' : 'Auto-scroll OFF'}
          </button>
        </div>
      </div>

      {/* Active Executions Bar */}
      {activeExecutions.length > 0 && (
        <div style={{ display: 'flex', gap: 8, padding: '8px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', overflowX: 'auto' }}>
          {activeExecutions.map(exec => (
            <div key={exec.id} style={{
              padding: '6px 12px', borderRadius: 8, background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)',
              fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
            }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', animation: 'pulse 1.5s infinite' }} />
              <span style={{ fontWeight: 600, color: '#22c55e' }}>{exec.agentName || 'Agent'}</span>
              <span style={{ opacity: 0.5 }}>{exec.input?.substring(0, 40)}...</span>
            </div>
          ))}
        </div>
      )}

      {/* Log Stream */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        style={{
          flex: 1, overflow: 'auto', padding: '8px 0', fontFamily: 'var(--font-mono)', fontSize: '0.78rem',
          background: 'rgba(0,0,0,0.2)', lineHeight: 1.7,
        }}
      >
        {filteredLogs.length === 0 && (
          <div style={{ padding: '40px 16px', textAlign: 'center', opacity: 0.3 }}>
            {connected ? 'Waiting for agent activity...' : 'WebSocket disconnected'}
          </div>
        )}
        {filteredLogs.map(log => (
          <div key={log.id} style={{ padding: '1px 16px', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <span style={{ color: 'rgba(255,255,255,0.2)', minWidth: 75, flexShrink: 0 }}>
              {new Date(log.timestamp).toLocaleTimeString()}
            </span>
            <span style={{
              color: typeColors[log.type] || '#888', minWidth: 42, flexShrink: 0, fontWeight: 700,
              fontSize: '0.7rem', letterSpacing: '0.03em',
            }}>
              {typeLabels[log.type] || 'INFO'}
            </span>
            <span style={{ color: 'rgba(165,168,255,0.7)', minWidth: 120, maxWidth: 160, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {log.agentName}
            </span>
            <span style={{ color: log.type === 'fail' ? '#ef4444' : 'rgba(255,255,255,0.7)', wordBreak: 'break-word' }}>
              {log.message}
            </span>
            {log.cost !== undefined && log.cost > 0 && (
              <span style={{ color: 'rgba(251,146,60,0.7)', flexShrink: 0, marginLeft: 'auto' }}>${log.cost.toFixed(4)}</span>
            )}
          </div>
        ))}
        <div ref={logEndRef} />
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
