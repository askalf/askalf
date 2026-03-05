import { createContext, useContext, useEffect, useRef, useState, useCallback, type ReactNode } from 'react';

export interface ForgeEvent {
  category: string;
  type: string;
  event?: string;
  data?: unknown;
  receivedAt: number;
  agentId?: string;
  agentName?: string;
  [key: string]: unknown;
}

interface WebSocketContextValue {
  connected: boolean;
  lastEvent: ForgeEvent | null;
  events: ForgeEvent[];
  stats: Record<string, unknown> | null;
}

const WebSocketContext = createContext<WebSocketContextValue>({
  connected: false,
  lastEvent: null,
  events: [],
  stats: null,
});

const MAX_EVENTS = 100;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<ForgeEvent | null>(null);
  const [events, setEvents] = useState<ForgeEvent[]>([]);
  const [stats, setStats] = useState<Record<string, unknown> | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const ws = new WebSocket(`${protocol}//${host}/ws`);

    ws.onopen = () => {
      setConnected(true);
      reconnectAttemptRef.current = 0;
    };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data as string);
        if (msg.type === 'stats') {
          setStats(msg.data as Record<string, unknown>);
        } else if (msg.type === 'forge_event') {
          const event = msg.data as ForgeEvent;
          setLastEvent(event);
          setEvents((prev) => {
            const next = [event, ...prev];
            return next.length > MAX_EVENTS ? next.slice(0, MAX_EVENTS) : next;
          });
        }
      } catch {
        // ignore malformed messages
      }
    };

    ws.onclose = () => {
      setConnected(false);
      wsRef.current = null;
      const delay = Math.min(
        RECONNECT_BASE_MS * Math.pow(2, reconnectAttemptRef.current),
        RECONNECT_MAX_MS,
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

  return (
    <WebSocketContext.Provider value={{ connected, lastEvent, events, stats }}>
      {children}
    </WebSocketContext.Provider>
  );
}

/** Hook to access the shared WebSocket connection and forge event stream. */
export function useForgeEvents(): WebSocketContextValue {
  return useContext(WebSocketContext);
}
