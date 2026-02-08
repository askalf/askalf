import { useEffect, useRef } from 'react';
import { API_BASE } from '../api/client';

interface UseSSEOptions {
  url: string;
  onMessage: (data: unknown) => void;
  onError?: (err: Event) => void;
  enabled?: boolean;
}

export function useSSE({ url, onMessage, onError, enabled = true }: UseSSEOptions) {
  const sourceRef = useRef<EventSource | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();
  const reconnectDelay = useRef(1000);

  useEffect(() => {
    if (!enabled) return;

    function connect() {
      const fullUrl = `${API_BASE}${url}`;
      const source = new EventSource(fullUrl, { withCredentials: true });
      sourceRef.current = source;

      source.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          onMessage(data);
          // Reset reconnect delay on successful message
          reconnectDelay.current = 1000;
        } catch {
          // Non-JSON messages are fine (keepalive, etc.)
        }
      };

      source.onerror = (err) => {
        source.close();
        onError?.(err);
        // Reconnect with exponential backoff
        reconnectTimer.current = setTimeout(() => {
          reconnectDelay.current = Math.min(reconnectDelay.current * 2, 30000);
          connect();
        }, reconnectDelay.current);
      };

      source.onopen = () => {
        reconnectDelay.current = 1000;
      };
    }

    connect();

    return () => {
      sourceRef.current?.close();
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
      }
    };
  }, [url, enabled]); // eslint-disable-line react-hooks/exhaustive-deps
}
