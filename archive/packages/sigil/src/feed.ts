import type { SigilMessage, SigilBridgeClientOptions } from './index.js';
import { SigilBridgeClient } from './index.js';

export interface SigilFeedOptions extends SigilBridgeClientOptions {
  intervalMs?: number; // polling interval
  limit?: number;
}

export type SigilFeedHandler = (messages: SigilMessage[]) => void;

/**
 * Simple polling feed for SIGIL bridge (fallback when SSE/WS not available).
 * Caller can stop by calling the returned stop function.
 */
export function createSigilFeedPoller(
  opts: SigilFeedOptions,
  onMessages: SigilFeedHandler
): () => void {
  const client = new SigilBridgeClient(opts);
  const interval = opts.intervalMs ?? 3000;
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;

  async function tick() {
    try {
      const feed = await client.getFeed(opts.limit ?? 20);
      onMessages(feed);
    } catch (e) {
      // Swallow errors to keep polling; surface via console
      // eslint-disable-next-line no-console
      console.error('[SIGIL feed] poll error', e);
    } finally {
      if (!stopped) timer = setTimeout(tick, interval);
    }
  }

  timer = setTimeout(tick, interval);

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}