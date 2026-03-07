/**
 * CodexSessionManager — Persistent OpenAI Codex CLI PTY session
 *
 * Spawns `codex --full-auto` via node-pty,
 * keeps a circular buffer for reconnection replay, and exposes
 * send/signal/resize methods for WebSocket consumers.
 *
 * Uses OPENAI_API_KEY from environment.
 */

import pty from 'node-pty';
import { mkdir, access, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const RING_BUFFER_SIZE = 5000;
const MAX_RESTART_RETRIES = 5;
const RESTART_BACKOFF_BASE_MS = 2000;
const MAX_RESIZE_COLS = 500;
const MAX_RESIZE_ROWS = 200;

const CODEX_HOME = process.env['CODEX_SESSION_HOME'] || '/home/substrate/.codex-session';

/** O(1) circular buffer — no shift() overhead */
class CircularBuffer {
  constructor(capacity) {
    this.capacity = capacity;
    this.buffer = new Array(capacity);
    this.head = 0;
    this.size = 0;
  }

  push(item) {
    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this.size < this.capacity) this.size++;
  }

  getAll() {
    if (this.size === 0) return [];
    if (this.size < this.capacity) {
      return this.buffer.slice(0, this.size);
    }
    return [
      ...this.buffer.slice(this.head),
      ...this.buffer.slice(0, this.head),
    ];
  }

  clear() {
    this.buffer = new Array(this.capacity);
    this.head = 0;
    this.size = 0;
  }
}

class CodexSessionManager {
  constructor() {
    this.pty = null;
    this.ringBuffer = new CircularBuffer(RING_BUFFER_SIZE);
    this.subscribers = new Set();
    this.restartCount = 0;
    this.status = 'stopped';
    this.cwd = process.env['CODEX_SESSION_CWD'] || process.env['WORKSPACE_DIR'] || '/workspace';
    this._startLock = null;
    this._restartTimer = null;
    this._stabilityTimer = null;
    this._hasRestarted = false;
  }

  /** Start (or restart) the Codex process */
  async start() {
    if (this._startLock) {
      console.log('[CodexSession] Start already in progress, waiting...');
      return this._startLock;
    }

    if (this.pty && this.status === 'running') {
      console.log('[CodexSession] Already running (pid=%d), ignoring start()', this.pty.pid);
      return;
    }

    if (this._restartTimer) {
      clearTimeout(this._restartTimer);
      this._restartTimer = null;
    }

    this._startLock = this._doStart();
    try {
      await this._startLock;
    } finally {
      this._startLock = null;
    }
  }

  async _doStart() {
    await mkdir(CODEX_HOME, { recursive: true });

    const apiKey = process.env['OPENAI_API_KEY'] || '';
    if (!apiKey) {
      console.warn('[CodexSession] No OPENAI_API_KEY set — codex will fail to authenticate');
    }

    const shell = 'codex';
    const args = ['--full-auto'];

    // Fetch dynamic platform context from forge and write instructions file
    const instructionsPath = join(CODEX_HOME, 'codex-instructions.md');
    try {
      const forgeUrl = process.env['FORGE_INTERNAL_URL'] || 'http://forge:3005';
      const internalSecret = process.env['INTERNAL_API_SECRET'] ?? '';
      const res = await fetch(
        `${forgeUrl}/api/v1/forge/intent/session-context?type=codex`,
        {
          headers: {
            Authorization: `Bearer ${internalSecret}`,
            'Content-Type': 'application/json',
          },
          signal: AbortSignal.timeout(5000),
        },
      );
      if (res.ok) {
        const { markdown } = await res.json();
        if (markdown) {
          await writeFile(instructionsPath, markdown);
          args.push('--instructions', instructionsPath);
          console.log('[CodexSession] Dynamic instructions written from platform context');
        }
      } else {
        console.warn(`[CodexSession] Context fetch failed: HTTP ${res.status}`);
      }
    } catch (err) {
      console.warn('[CodexSession] Could not fetch platform context:', err.message);
    }

    // Fall back to static instructions file if dynamic fetch failed
    if (!args.includes('--instructions')) {
      const __dirname = dirname(fileURLToPath(import.meta.url));
      const staticPath = join(__dirname, '..', 'codex-instructions.md');
      try {
        await access(staticPath);
        args.push('--instructions', staticPath);
        console.log('[CodexSession] Using static instructions fallback');
      } catch {
        // No instructions file — continue without
      }
    }

    const env = {
      ...process.env,
      HOME: CODEX_HOME,
      OPENAI_API_KEY: apiKey,
      TERM: 'xterm-256color',
    };

    try {
      this.pty = pty.spawn(shell, args, {
        name: 'xterm-256color',
        cols: 120,
        rows: 40,
        cwd: this.cwd,
        env,
      });

      this.status = 'running';

      // Clear previous stability timer
      if (this._stabilityTimer) {
        clearTimeout(this._stabilityTimer);
        this._stabilityTimer = null;
      }
      this._stabilityTimer = setTimeout(() => {
        if (this.status === 'running') {
          this.restartCount = 0;
        }
      }, 30_000);

      console.log(`[CodexSession] Started (pid=${this.pty.pid}, cwd=${this.cwd})`);
      this._broadcastStatus();

      this.pty.onData((data) => {
        this.ringBuffer.push(data);
        this._broadcastOutput(data);
      });

      this.pty.onExit(({ exitCode, signal }) => {
        console.log(`[CodexSession] Exited (code=${exitCode}, signal=${signal})`);
        this.pty = null;
        this.status = 'stopped';
        this._broadcastStatus();
        this._maybeRestart();
      });
    } catch (err) {
      console.error('[CodexSession] Failed to spawn:', err.message);
      this.pty = null;
      this.status = 'failed';
      this._broadcastStatus();
    }
  }

  /** Stop the PTY process */
  stop() {
    if (this._restartTimer) {
      clearTimeout(this._restartTimer);
      this._restartTimer = null;
    }
    if (this._stabilityTimer) {
      clearTimeout(this._stabilityTimer);
      this._stabilityTimer = null;
    }
    this.restartCount = MAX_RESTART_RETRIES;
    if (this.pty) {
      try {
        this.pty.kill('SIGTERM');
      } catch {
        // ignore — process may already be dead
      }
      this.pty = null;
    }
    this.status = 'stopped';
    this._broadcastStatus();
  }

  /** Full restart: stop, reset counters, start fresh */
  async restart() {
    console.log('[CodexSession] Manual restart requested');
    this.stop();
    this.restartCount = 0;
    await this.start();
  }

  /** Send text input to the PTY */
  sendInput(text) {
    if (this.pty) {
      this.pty.write(text);
    }
  }

  /** Send a signal (e.g. SIGINT) */
  sendSignal(signal) {
    if (this.pty) {
      this.pty.kill(signal);
    }
  }

  /** Resize the PTY with bounds checking */
  resize(cols, rows) {
    if (this.pty) {
      const c = Math.max(1, Math.min(cols, MAX_RESIZE_COLS));
      const r = Math.max(1, Math.min(rows, MAX_RESIZE_ROWS));
      try {
        this.pty.resize(c, r);
      } catch {
        // ignore resize errors on dead PTY
      }
    }
  }

  /** Register a WebSocket subscriber */
  addSubscriber(ws) {
    this.subscribers.add(ws);
  }

  /** Remove a WebSocket subscriber */
  removeSubscriber(ws) {
    this.subscribers.delete(ws);
  }

  /** Get circular buffer history for reconnection */
  getHistory() {
    return this.ringBuffer.getAll();
  }

  /** Get current status */
  getStatus() {
    return {
      status: this.status,
      pid: this.pty?.pid ?? null,
      restartCount: this.restartCount,
      bufferSize: this.ringBuffer.size,
    };
  }

  // ---- Internal ----

  _broadcastOutput(data) {
    const msg = JSON.stringify({ type: 'output', data });
    for (const ws of this.subscribers) {
      if (ws.readyState === 1) {
        try { ws.send(msg); } catch { /* dead socket, cleaned up on close */ }
      }
    }
  }

  _broadcastStatus() {
    const msg = JSON.stringify({ type: 'status', data: this.getStatus() });
    for (const ws of this.subscribers) {
      if (ws.readyState === 1) {
        try { ws.send(msg); } catch { /* dead socket, cleaned up on close */ }
      }
    }
  }

  _maybeRestart() {
    if (this.restartCount >= MAX_RESTART_RETRIES) {
      console.error(`[CodexSession] Max restarts (${MAX_RESTART_RETRIES}) reached — giving up`);
      this.status = 'failed';
      this._broadcastStatus();
      return;
    }

    this.restartCount++;
    this.status = 'restarting';
    this._broadcastStatus();

    // Exponential backoff with jitter
    const base = RESTART_BACKOFF_BASE_MS * Math.pow(2, this.restartCount - 1);
    const jitter = Math.random() * 1000;
    const delay = Math.min(base + jitter, 30_000);
    console.log(`[CodexSession] Restarting in ${Math.round(delay)}ms (attempt ${this.restartCount}/${MAX_RESTART_RETRIES})`);
    this._restartTimer = setTimeout(() => {
      this._restartTimer = null;
      this.start();
    }, delay);
  }
}

// Singleton
let instance = null;

export function getCodexSession() {
  if (!instance) {
    instance = new CodexSessionManager();
  }
  return instance;
}
