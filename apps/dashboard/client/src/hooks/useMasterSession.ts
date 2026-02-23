import { useEffect, useRef, useState, useCallback } from 'react';

interface MasterSessionStatus {
  status: 'running' | 'stopped' | 'restarting' | 'failed';
  pid: number | null;
  restartCount: number;
  bufferSize: number;
}

interface UseMasterSessionReturn {
  connected: boolean;
  status: MasterSessionStatus | null;
  send: (text: string) => void;
  sendSignal: (signal: string) => void;
  resize: (cols: number, rows: number) => void;
  restart: () => void;
  onData: React.MutableRefObject<((data: string) => void) | null>;
  onHistory: React.MutableRefObject<((history: string[]) => void) | null>;
}

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 15000;

export function useMasterSession(): UseMasterSessionReturn {
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<MasterSessionStatus | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onData = useRef<((data: string) => void) | null>(null);
  const onHistory = useRef<((history: string[]) => void) | null>(null);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const ws = new WebSocket(`${protocol}//${host}/ws/master`);

    ws.onopen = () => {
      setConnected(true);
      reconnectAttemptRef.current = 0;
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
        }
      } catch {
        // ignore
      }
    };

    ws.onclose = () => {
      setConnected(false);
      wsRef.current = null;
      const delay = Math.min(
        RECONNECT_BASE_MS * Math.pow(2, reconnectAttemptRef.current),
        RECONNECT_MAX_MS
      );
      reconnectAttemptRef.current++;
      reconnectTimerRef.current = setTimeout(connect, delay);
    };

    ws.onerror = () => {
      ws.close();
    };

    wsRef.current = ws;
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const send = useCallback((text: string) => {
    wsRef.current?.send(JSON.stringify({ type: 'input', data: text }));
  }, []);

  const sendSignal = useCallback((signal: string) => {
    wsRef.current?.send(JSON.stringify({ type: 'signal', signal }));
  }, []);

  const resize = useCallback((cols: number, rows: number) => {
    wsRef.current?.send(JSON.stringify({ type: 'resize', cols, rows }));
  }, []);

  const restart = useCallback(() => {
    wsRef.current?.send(JSON.stringify({ type: 'restart' }));
  }, []);

  return { connected, status, send, sendSignal, resize, restart, onData, onHistory };
}
