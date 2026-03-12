import { useEffect, useRef, useState, useCallback } from 'react';

export interface TerminalSessionStatus {
  status: 'running' | 'stopped' | 'restarting' | 'failed';
  pid: number | null;
  restartCount: number;
  bufferSize: number;
  cwd?: string;
}

export interface UseTerminalSessionReturn {
  connected: boolean;
  status: TerminalSessionStatus | null;
  send: (text: string) => void;
  sendSignal: (signal: string) => void;
  resize: (cols: number, rows: number) => void;
  restart: () => void;
  setCwd: (cwd: string) => void;
  onData: React.MutableRefObject<((data: string) => void) | null>;
  onHistory: React.MutableRefObject<((history: string[]) => void) | null>;
}

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;
const MAX_RECONNECT_ATTEMPTS = 50;
const HEARTBEAT_INTERVAL_MS = 25000;

export function useTerminalSession(wsPath: string): UseTerminalSessionReturn {
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<TerminalSessionStatus | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onData = useRef<((data: string) => void) | null>(null);
  const onHistory = useRef<((history: string[]) => void) | null>(null);
  const closingRef = useRef(false);

  const clearHeartbeat = useCallback(() => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    if (closingRef.current) return;

    if (reconnectAttemptRef.current >= MAX_RECONNECT_ATTEMPTS) {
      console.warn(`[TerminalSession:${wsPath}] Max reconnection attempts reached`);
      setStatus(s => s ? { ...s, status: 'failed' } : { status: 'failed', pid: null, restartCount: 0, bufferSize: 0 });
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const ws = new WebSocket(`${protocol}//${host}${wsPath}`);

    ws.onopen = () => {
      setConnected(true);
      reconnectAttemptRef.current = 0;

      clearHeartbeat();
      heartbeatRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          try { ws.send(JSON.stringify({ type: 'ping' })); } catch { /* ignore */ }
        }
      }, HEARTBEAT_INTERVAL_MS);
    };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        switch (msg.type) {
          case 'output':
            onData.current?.(msg.data);
            break;
          case 'history':
            onHistory.current?.(msg.data);
            break;
          case 'status':
            setStatus(msg.data);
            break;
          case 'pong':
            break;
        }
      } catch {
        // ignore malformed messages
      }
    };

    ws.onclose = () => {
      setConnected(false);
      wsRef.current = null;
      clearHeartbeat();

      if (closingRef.current) return;

      const base = RECONNECT_BASE_MS * Math.pow(2, reconnectAttemptRef.current);
      const jitter = Math.random() * 1000;
      const delay = Math.min(base + jitter, RECONNECT_MAX_MS);
      reconnectAttemptRef.current++;
      reconnectTimerRef.current = setTimeout(connect, delay);
    };

    ws.onerror = () => {
      // onclose will fire after this
    };

    wsRef.current = ws;
  }, [clearHeartbeat, wsPath]);

  useEffect(() => {
    closingRef.current = false;
    connect();
    return () => {
      closingRef.current = true;
      clearHeartbeat();
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
    };
  }, [connect, clearHeartbeat]);

  const send = useCallback((text: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'input', data: text }));
    }
  }, []);

  const sendSignal = useCallback((signal: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'signal', signal }));
    }
  }, []);

  const resize = useCallback((cols: number, rows: number) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'resize', cols, rows }));
    }
  }, []);

  const restart = useCallback(() => {
    reconnectAttemptRef.current = 0;
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'restart' }));
    }
  }, []);

  const setCwd = useCallback((cwd: string) => {
    reconnectAttemptRef.current = 0;
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'setCwd', cwd }));
    }
  }, []);

  return { connected, status, send, sendSignal, resize, restart, setCwd, onData, onHistory };
}
