import { useEffect, useRef } from 'react';

/**
 * Reusable polling hook that calls a function at a given interval.
 * Waits for the previous call to complete before scheduling the next one,
 * preventing request pileup when endpoints are slow.
 * Automatically cleans up on unmount or when enabled changes.
 */
export function usePolling(
  callback: () => void | Promise<void>,
  intervalMs: number,
  enabled = true
) {
  const savedCallback = useRef(callback);

  // Update the saved callback if it changes
  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled || intervalMs <= 0) return;

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        await savedCallback.current();
      } catch {
        // swallow — individual fetches handle their own errors
      }
      if (!cancelled) {
        timeoutId = setTimeout(tick, intervalMs);
      }
    };

    // Fire immediately, then chain via setTimeout after completion
    tick();

    return () => {
      cancelled = true;
      if (timeoutId !== null) clearTimeout(timeoutId);
    };
  }, [intervalMs, enabled]);
}
