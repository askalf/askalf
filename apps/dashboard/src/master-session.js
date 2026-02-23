/**
 * MasterSessionManager — Persistent Claude Code PTY session
 *
 * Spawns `claude --dangerously-skip-permissions` via node-pty,
 * keeps a ring buffer for reconnection replay, and exposes
 * send/signal/resize methods for WebSocket consumers.
 *
 * Uses OAuth credentials (same method as forge agents):
 * - Copies /tmp/claude-credentials.json → ~/.claude/.credentials.json
 * - Sets ANTHROPIC_API_KEY='' to force OAuth subscription
 * - Periodic token refresh (1h interval, 8h TTL)
 */

import pty from 'node-pty';
import { readFile, writeFile, copyFile, mkdir, access } from 'fs/promises';

const RING_BUFFER_SIZE = 5000;
const MAX_RESTART_RETRIES = 5;
const RESTART_BACKOFF_MS = 3000;

// OAuth config (matches forge worker.ts)
const CLAUDE_HOME = '/tmp/master-claude-home';
const CLAUDE_DIR = `${CLAUDE_HOME}/.claude`;
const CREDENTIALS_MOUNT = '/tmp/claude-credentials.json';
const CREDENTIALS_PATH = `${CLAUDE_DIR}/.credentials.json`;
const OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const OAUTH_TOKEN_URL = 'https://console.anthropic.com/v1/oauth/token';
const TOKEN_REFRESH_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const TOKEN_REFRESH_BUFFER_MS = 60 * 60 * 1000;   // Refresh if <1h remaining

class RingBuffer {
  constructor(capacity) {
    this.capacity = capacity;
    this.buffer = [];
  }

  push(line) {
    this.buffer.push(line);
    if (this.buffer.length > this.capacity) {
      this.buffer.shift();
    }
  }

  getAll() {
    return this.buffer.slice();
  }

  clear() {
    this.buffer = [];
  }
}

/** Set up Claude CLI environment with OAuth credentials */
async function setupCliEnvironment() {
  // Create directory structure
  await mkdir(CLAUDE_DIR, { recursive: true });
  await mkdir(`${CLAUDE_DIR}/.mcp-cache`, { recursive: true });

  // Copy OAuth credentials from host mount
  try {
    await access(CREDENTIALS_MOUNT);
    await copyFile(CREDENTIALS_MOUNT, CREDENTIALS_PATH);
    console.log('[MasterSession] OAuth credentials installed');
  } catch {
    console.warn('[MasterSession] No OAuth credentials found at', CREDENTIALS_MOUNT);
  }

  // Write settings.json (auto-accept permissions, onboarding done)
  const settings = {
    permissions: {
      allow: [
        'Bash(*)', 'Read(*)', 'Write(*)', 'Edit(*)',
        'Glob(*)', 'Grep(*)', 'WebFetch(*)', 'WebSearch(*)',
        'NotebookEdit(*)', 'Task(*)',
      ],
      deny: [],
    },
    hasCompletedOnboarding: true,
  };
  await writeFile(`${CLAUDE_DIR}/settings.json`, JSON.stringify(settings, null, 2));

  // Pre-populate .claude.json to skip trust dialog and onboarding prompts
  // Only write if it doesn't exist yet (preserve existing state across restarts)
  const claudeJsonPath = `${CLAUDE_HOME}/.claude.json`;
  try {
    await access(claudeJsonPath);
    // Already exists — read it and ensure trust dialog is accepted
    const existing = JSON.parse(await readFile(claudeJsonPath, 'utf8'));
    const projects = existing.projects || {};
    const workspaceProject = projects['/workspace'] || {};
    if (!workspaceProject.hasTrustDialogAccepted) {
      workspaceProject.hasTrustDialogAccepted = true;
      workspaceProject.hasClaudeMdExternalIncludesApproved = true;
      projects['/workspace'] = workspaceProject;
      existing.projects = projects;
      existing.hasCompletedOnboarding = true;
      await writeFile(claudeJsonPath, JSON.stringify(existing, null, 2));
      console.log('[MasterSession] Updated .claude.json — trust dialog accepted');
    }
  } catch {
    // Doesn't exist yet — create with all onboarding/trust pre-accepted
    const claudeJson = {
      numStartups: 5,
      firstStartTime: new Date().toISOString(),
      hasCompletedOnboarding: true,
      lastOnboardingVersion: '2.1.50',
      opusProMigrationComplete: true,
      sonnet1m45MigrationComplete: true,
      hasShownOpus46Notice: {},
      effortCalloutDismissed: true,
      theme: 'dark',
      projects: {
        '/workspace': {
          allowedTools: [],
          mcpContextUris: [],
          mcpServers: {},
          enabledMcpjsonServers: [],
          disabledMcpjsonServers: [],
          hasTrustDialogAccepted: true,
          hasClaudeMdExternalIncludesApproved: true,
          hasClaudeMdExternalIncludesWarningShown: true,
          projectOnboardingSeenCount: 5,
          exampleFiles: [],
        },
      },
    };
    await writeFile(claudeJsonPath, JSON.stringify(claudeJson, null, 2));
    console.log('[MasterSession] Created .claude.json with trust pre-accepted');
  }

  // Write MCP config if mcp-tools is available
  const mcpConfig = {
    mcpServers: {
      'mcp-tools': {
        type: 'http',
        url: 'http://mcp-tools:3010/mcp',
      },
    },
  };
  await writeFile(`${CLAUDE_HOME}/mcp.json`, JSON.stringify(mcpConfig, null, 2));

  console.log('[MasterSession] CLI environment ready');
}

/** Refresh OAuth credentials if expiring */
async function refreshCredentials() {
  try {
    // First try to get fresher token from mount
    try {
      await access(CREDENTIALS_MOUNT);
      const mountRaw = await readFile(CREDENTIALS_MOUNT, 'utf8');
      const mountCreds = JSON.parse(mountRaw);

      let currentExpiry = 0;
      try {
        const currentRaw = await readFile(CREDENTIALS_PATH, 'utf8');
        const currentCreds = JSON.parse(currentRaw);
        currentExpiry = currentCreds.claudeAiOauth?.expiresAt || 0;
      } catch { /* no current creds yet */ }

      if ((mountCreds.claudeAiOauth?.expiresAt || 0) > currentExpiry) {
        await copyFile(CREDENTIALS_MOUNT, CREDENTIALS_PATH);
        console.log('[MasterSession] Refreshed credentials from mount');
      }
    } catch { /* mount not available */ }

    // Read current credentials
    let raw;
    try {
      raw = await readFile(CREDENTIALS_PATH, 'utf8');
    } catch {
      return; // No credentials at all
    }

    const creds = JSON.parse(raw);
    const oauth = creds.claudeAiOauth;
    if (!oauth?.refreshToken) return;

    const expiresAt = oauth.expiresAt || 0;
    const now = Date.now();

    // Still valid for >1 hour — skip
    if (expiresAt > now + TOKEN_REFRESH_BUFFER_MS) {
      return;
    }

    console.log('[MasterSession] Token expiring soon, refreshing...');

    const res = await fetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: oauth.refreshToken,
        client_id: OAUTH_CLIENT_ID,
      }),
    });

    if (!res.ok) {
      console.error(`[MasterSession] Token refresh failed: HTTP ${res.status}`);
      return;
    }

    const data = await res.json();
    const updated = {
      claudeAiOauth: {
        ...oauth,
        accessToken: data.access_token,
        refreshToken: data.refresh_token, // Single-use, must store new one
        expiresAt: now + data.expires_in * 1000,
      },
    };

    const updatedJson = JSON.stringify(updated, null, 2);
    await writeFile(CREDENTIALS_PATH, updatedJson);
    console.log(`[MasterSession] OAuth token refreshed — expires ${new Date(updated.claudeAiOauth.expiresAt).toISOString()}`);

    // Persist back to host mount for container restart survival
    try {
      await writeFile(CREDENTIALS_MOUNT, updatedJson);
      console.log('[MasterSession] Persisted refreshed token to host mount');
    } catch (writeErr) {
      console.warn('[MasterSession] Could not persist to mount:', writeErr.message);
    }
  } catch (err) {
    console.error('[MasterSession] Credential refresh error:', err.message);
  }
}

class MasterSessionManager {
  constructor() {
    this.pty = null;
    this.ringBuffer = new RingBuffer(RING_BUFFER_SIZE);
    this.subscribers = new Set();
    this.restartCount = 0;
    this.status = 'stopped';
    this.cwd = process.env['MASTER_SESSION_CWD'] || process.env['WORKSPACE_DIR'] || '/workspace';
    this.refreshTimer = null;
    this._startLock = null; // Prevents concurrent start() calls
    this._restartTimer = null; // Track restart timer for cancellation
    this._hasRestarted = false; // First boot vs restart (for --continue flag)
  }

  /** Start (or restart) the Claude Code process */
  async start() {
    // Prevent concurrent starts — if a start is in progress, wait for it
    if (this._startLock) {
      console.log('[MasterSession] Start already in progress, waiting...');
      return this._startLock;
    }

    // Already running — no-op
    if (this.pty && this.status === 'running') {
      console.log('[MasterSession] Already running (pid=%d), ignoring start()', this.pty.pid);
      return;
    }

    // Cancel any pending restart timer
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
    // Set up CLI environment with OAuth credentials
    try {
      await setupCliEnvironment();
      await refreshCredentials();
    } catch (err) {
      console.error('[MasterSession] Environment setup failed:', err.message);
    }

    // Start periodic token refresh
    if (!this.refreshTimer) {
      this.refreshTimer = setInterval(() => refreshCredentials(), TOKEN_REFRESH_INTERVAL_MS);
    }

    const shell = 'claude';
    const args = [
      '--dangerously-skip-permissions',
      '--mcp-config', `${CLAUDE_HOME}/mcp.json`,
    ];

    // Resume last conversation if one exists (persistent volume)
    if (this._hasRestarted) {
      args.push('--continue');
    }
    this._hasRestarted = true;

    const env = {
      ...process.env,
      HOME: CLAUDE_HOME,           // Point claude to our .claude dir
      ANTHROPIC_API_KEY: '',       // Force OAuth subscription, not API key
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
      this.restartCount = 0;
      this._setupComplete = false;
      this._outputBuffer = '';
      console.log(`[MasterSession] Started (pid=${this.pty.pid}, cwd=${this.cwd}, auth=oauth)`);
      this._broadcastStatus();

      this.pty.onData((data) => {
        this.ringBuffer.push(data);
        this._broadcastOutput(data);

        // Auto-navigate through interactive startup prompts
        if (!this._setupComplete) {
          this._outputBuffer += data;
          this._handleStartupPrompts();
        }
      });

      this.pty.onExit(({ exitCode, signal }) => {
        console.log(`[MasterSession] Exited (code=${exitCode}, signal=${signal})`);
        this.pty = null;
        this.status = 'stopped';
        this._broadcastStatus();
        this._maybeRestart();
      });
    } catch (err) {
      console.error('[MasterSession] Failed to spawn:', err.message);
      this.pty = null;
      this.status = 'failed';
      this._broadcastStatus();
    }
  }

  /** Stop the PTY process */
  stop() {
    // Cancel any pending restart
    if (this._restartTimer) {
      clearTimeout(this._restartTimer);
      this._restartTimer = null;
    }
    this.restartCount = MAX_RESTART_RETRIES; // Prevent auto-restart
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
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
    console.log('[MasterSession] Manual restart requested');
    this.stop();
    this.restartCount = 0; // Reset so auto-restart works after manual restart
    await this.start();
  }

  /** Auto-navigate through Claude Code's interactive startup prompts */
  _handleStartupPrompts() {
    if (!this.pty || this._setupComplete) return;

    // Strip ANSI escape codes for matching
    const clean = this._outputBuffer
      .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
      .replace(/\x1b\][^\x07]*\x07/g, '')
      .replace(/\x1b[()][AB012]/g, '')
      .toLowerCase();

    // 1. Theme chooser — "choose the text style" / "looks best"
    if ((clean.includes('choose') && (clean.includes('theme') || clean.includes('style'))) ||
        clean.includes('text style') || clean.includes('looks best')) {
      console.log('[MasterSession] Auto-selecting theme (Enter for default)');
      setTimeout(() => {
        if (this.pty) this.pty.write('\r');
      }, 500);
      this._outputBuffer = '';
      return;
    }

    // 2. Permissions bypass warning — select menu with:
    //    ❯ 1. No, exit
    //      2. Yes, I accept
    //    Need: down arrow to select option 2, then Enter to confirm
    //    Match the actual select menu, NOT the status bar ("bypass permissions on")
    if (clean.includes('no,exit') && clean.includes('yes,iaccept')) {
      console.log('[MasterSession] Auto-accepting permissions bypass (arrow down + enter)');
      setTimeout(() => {
        if (this.pty) {
          // Down arrow to move from "No, exit" to "Yes, I accept"
          this.pty.write('\x1b[B');
          setTimeout(() => {
            if (this.pty) this.pty.write('\r');
          }, 300);
        }
      }, 500);
      this._outputBuffer = '';
      this._setupComplete = true;
      return;
    }

    // 3. Any "yes/no" or "y/n" confirmation prompt
    if (clean.includes('(y/n)') || clean.includes('(yes/no)')) {
      console.log('[MasterSession] Auto-accepting y/n prompt');
      setTimeout(() => {
        if (this.pty) this.pty.write('y\r');
      }, 300);
      this._outputBuffer = '';
      return;
    }

    // 4. Status bar or main prompt — indicates we're past all startup prompts
    //    Status bar shows "bypass permissions on" or we see the input prompt
    if (clean.includes('bypass permissions on') || clean.includes('shift+tab to cycle')) {
      console.log('[MasterSession] Status bar detected — setup complete');
      this._setupComplete = true;
      this._outputBuffer = '';
      return;
    }

    // Also detect the main input prompt ">" at start of line (not in select menu)
    if (!clean.includes('no,exit') && !clean.includes('entertoconfirm')) {
      if (clean.includes('\n>') || clean.includes('\n❯')) {
        console.log('[MasterSession] Interactive prompt detected — setup complete');
        this._setupComplete = true;
        this._outputBuffer = '';
        return;
      }
    }

    // Keep buffer from growing too large
    if (this._outputBuffer.length > 10000) {
      this._outputBuffer = this._outputBuffer.slice(-5000);
    }
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

  /** Resize the PTY */
  resize(cols, rows) {
    if (this.pty) {
      try {
        this.pty.resize(Math.max(1, cols), Math.max(1, rows));
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

  /** Get ring buffer history for reconnection */
  getHistory() {
    return this.ringBuffer.getAll();
  }

  /** Get current status */
  getStatus() {
    return {
      status: this.status,
      pid: this.pty?.pid ?? null,
      restartCount: this.restartCount,
      bufferSize: this.ringBuffer.buffer.length,
    };
  }

  // ---- Internal ----

  _broadcastOutput(data) {
    const msg = JSON.stringify({ type: 'output', data });
    for (const ws of this.subscribers) {
      if (ws.readyState === 1) {
        try { ws.send(msg); } catch { /* ignore */ }
      }
    }
  }

  _broadcastStatus() {
    const msg = JSON.stringify({ type: 'status', data: this.getStatus() });
    for (const ws of this.subscribers) {
      if (ws.readyState === 1) {
        try { ws.send(msg); } catch { /* ignore */ }
      }
    }
  }

  _maybeRestart() {
    if (this.restartCount >= MAX_RESTART_RETRIES) {
      console.error(`[MasterSession] Max restarts (${MAX_RESTART_RETRIES}) reached — giving up`);
      this.status = 'failed';
      this._broadcastStatus();
      return;
    }

    this.restartCount++;
    this.status = 'restarting';
    this._broadcastStatus();

    const delay = RESTART_BACKOFF_MS * this.restartCount;
    console.log(`[MasterSession] Restarting in ${delay}ms (attempt ${this.restartCount}/${MAX_RESTART_RETRIES})`);
    this._restartTimer = setTimeout(() => {
      this._restartTimer = null;
      this.start();
    }, delay);
  }
}

// Singleton
let instance = null;

export function getMasterSession() {
  if (!instance) {
    instance = new MasterSessionManager();
  }
  return instance;
}
