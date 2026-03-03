/**
 * Bridge Client
 *
 * WebSocket client that connects the local askalf-agent to the platform (Forge).
 * Handles auto-reconnect with exponential backoff, heartbeat, device registration,
 * and task dispatch/result forwarding.
 */

import WebSocket from 'ws';
import { hostname, platform } from 'node:os';
import { loadConfig, saveConfig, type AgentConfig } from './util/config.js';
import * as output from './util/output.js';
import { executeBridgeTask, cancelBridgeTask, type BridgeTaskResult } from './bridge-executor.js';

// ============================================
// Types
// ============================================

interface ServerMessage {
  type: string;
  payload: Record<string, unknown>;
}

export interface BridgeOptions {
  /** Platform WebSocket URL (wss://askalf.org/ws/agent-bridge) */
  platformUrl: string;
  /** API key / device token for authentication */
  token: string;
  /** Existing device ID for reconnection */
  deviceId?: string;
  /** Run in daemon mode (keep alive indefinitely) */
  daemon?: boolean;
}

// ============================================
// Bridge Client
// ============================================

let ws: WebSocket | null = null;
let reconnectAttempts = 0;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
let shuttingDown = false;
let currentDeviceId: string | null = null;

const MAX_RECONNECT_DELAY_MS = 60_000;
const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Connect to the platform and start the bridge.
 */
export async function startBridge(opts: BridgeOptions): Promise<void> {
  shuttingDown = false;
  const url = `${opts.platformUrl}?token=${encodeURIComponent(opts.token)}`;

  return new Promise((resolve, reject) => {
    const connect = () => {
      output.info(`Connecting to ${opts.platformUrl}...`);

      ws = new WebSocket(url);

      ws.on('open', () => {
        reconnectAttempts = 0;
        output.success('Connected to platform');

        // Register or reconnect device
        if (opts.deviceId || currentDeviceId) {
          sendMessage('device:reconnect', {
            deviceId: opts.deviceId ?? currentDeviceId,
          });
        } else {
          sendMessage('device:register', {
            hostname: hostname(),
            os: `${platform()} ${process.arch}`,
            deviceName: hostname(),
            capabilities: {
              computerUse: true,
              shell: true,
              browser: true,
              screenshot: true,
              keyboard: true,
              mouse: true,
            },
          });
        }

        // Start heartbeat
        startHeartbeat();
      });

      ws.on('message', (data: WebSocket.Data) => {
        let msg: ServerMessage;
        try {
          msg = JSON.parse(data.toString()) as ServerMessage;
        } catch {
          output.warn('Received unparseable message from platform');
          return;
        }

        void handleServerMessage(msg, opts).catch((err) => {
          output.error(`Error handling message: ${err instanceof Error ? err.message : String(err)}`);
        });
      });

      ws.on('close', (code, reason) => {
        stopHeartbeat();
        const reasonStr = reason?.toString() || 'unknown';

        if (shuttingDown) {
          output.info('Disconnected from platform');
          resolve();
          return;
        }

        if (code === 4001) {
          // Auth failure — don't reconnect
          output.error(`Authentication failed: ${reasonStr}`);
          reject(new Error(`Authentication failed: ${reasonStr}`));
          return;
        }

        output.warn(`Connection closed (code=${code}): ${reasonStr}`);

        if (opts.daemon) {
          scheduleReconnect(connect);
        } else {
          resolve();
        }
      });

      ws.on('error', (err) => {
        output.error(`WebSocket error: ${err.message}`);
        // 'close' event will fire after this — reconnect handled there
      });
    };

    connect();
  });
}

/**
 * Disconnect from the platform.
 */
export function stopBridge(): void {
  shuttingDown = true;
  stopHeartbeat();

  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.close(1000, 'Client disconnect');
  }
  ws = null;
}

// ============================================
// Message Handlers
// ============================================

async function handleServerMessage(msg: ServerMessage, opts: BridgeOptions): Promise<void> {
  switch (msg.type) {
    case 'device:registered': {
      const { deviceId, userId } = msg.payload as { deviceId: string; userId: string };
      currentDeviceId = deviceId;
      output.success(`Device registered: ${deviceId}`);

      // Persist device ID for future reconnects
      await saveConfig({ deviceId, platformUrl: opts.platformUrl } as Partial<AgentConfig>);
      break;
    }

    case 'device:error': {
      const { code, message } = msg.payload as { code: string; message: string };
      output.error(`Platform error [${code}]: ${message}`);

      if (code === 'AUTH_FAILED' || code === 'AUTH_REQUIRED' || code === 'USER_NOT_FOUND') {
        stopBridge();
      }
      break;
    }

    case 'task:dispatch': {
      const { executionId, agentId, agentName, input, maxTurns, maxBudget } = msg.payload as {
        executionId: string; agentId: string; agentName: string;
        input: string; maxTurns?: number; maxBudget?: number;
      };

      output.header(`Task received: ${agentName}`);
      output.info(`Execution: ${executionId}`);
      console.log(input.substring(0, 200) + (input.length > 200 ? '...' : ''));

      // Accept the task
      sendMessage('execution:accepted', { executionId });

      // Execute in background
      void executeTask(executionId, agentId, agentName, input, maxTurns, maxBudget);
      break;
    }

    case 'task:cancel': {
      const { executionId } = msg.payload as { executionId: string };
      output.warn(`Task cancelled: ${executionId}`);
      cancelBridgeTask(executionId);
      break;
    }

    default:
      output.warn(`Unknown message type: ${msg.type}`);
  }
}

async function executeTask(
  executionId: string,
  agentId: string,
  agentName: string,
  input: string,
  maxTurns?: number,
  maxBudget?: number,
): Promise<void> {
  try {
    const config = await loadConfig();

    // Stream progress callback
    const onProgress = (progressType: string, data: unknown) => {
      sendMessage('execution:progress', { executionId, progressType, data });
    };

    const result = await executeBridgeTask({
      executionId,
      input,
      config,
      maxTurns,
      maxBudget,
      onProgress,
    });

    sendMessage('execution:complete', {
      executionId,
      output: result.text,
      cost: result.costUsd,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      turns: result.turns,
    });

    output.success(`Task completed: ${executionId}`);
    output.cost(
      { input: result.inputTokens, output: result.outputTokens },
      result.costUsd,
      result.turns,
    );
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    sendMessage('execution:failed', { executionId, error: errorMsg });
    output.error(`Task failed: ${errorMsg}`);
  }
}

// ============================================
// Helpers
// ============================================

function sendMessage(type: string, payload: Record<string, unknown>): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify({ type, payload }));
  } catch {
    // Socket may already be closing
  }
}

function startHeartbeat(): void {
  stopHeartbeat();
  heartbeatInterval = setInterval(() => {
    sendMessage('device:heartbeat', {
      load: { uptime: process.uptime() },
      activeExecutions: 0, // TODO: track from bridge-executor
    });
  }, HEARTBEAT_INTERVAL_MS);
}

function stopHeartbeat(): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

function scheduleReconnect(connectFn: () => void): void {
  const delay = Math.min(
    1000 * Math.pow(2, reconnectAttempts),
    MAX_RECONNECT_DELAY_MS,
  );
  reconnectAttempts++;
  output.info(`Reconnecting in ${Math.round(delay / 1000)}s (attempt ${reconnectAttempts})...`);
  reconnectTimeout = setTimeout(connectFn, delay);
}
