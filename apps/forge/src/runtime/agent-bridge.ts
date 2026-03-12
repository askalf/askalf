/**
 * Agent Bridge
 *
 * WebSocket endpoint that allows remote askalf-agent CLI instances to connect
 * to the platform. Handles device registration, heartbeats, task forwarding,
 * and result ingestion.
 *
 * Protocol: JSON messages over WebSocket.
 * Auth: API key passed via Authorization header (preferred) or Sec-WebSocket-Protocol header.
 *       Legacy query param `token` is supported but deprecated (logs a warning).
 *
 * Architecture:
 *   User's Machine (agent daemon) --WSS--> Forge (this endpoint)
 *   Agent connects OUT (works behind NAT). Forge never connects to agent.
 */

import { pbkdf2Sync } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { WebSocket } from '@fastify/websocket';
import { query as dbQuery, queryOne } from '../database.js';
import { getEventBus } from '../orchestration/event-bus.js';
import {
  registerDevice,
  reconnectDevice,
  updateHeartbeat,
  markDeviceOffline,
  cleanupStaleDevices,
  type AgentDevice,
} from './device-registry.js';

// ============================================
// Types
// ============================================

/** Message from client → server */
interface ClientMessage {
  type: string;
  payload: Record<string, unknown>;
}

/** Active WebSocket session */
interface DeviceSession {
  ws: WebSocket;
  deviceId: string;
  userId: string;
  tenantId: string;
  apiKeyId: string;
  activeExecutions: Set<string>;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
  lastHeartbeat: number;
}

// ============================================
// Session Management
// ============================================

/** Map of deviceId → active session */
const sessions = new Map<string, DeviceSession>();

/** Map of userId → Set<deviceId> for quick user lookups */
const userDevices = new Map<string, Set<string>>();

let staleCleanupTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Get an online device session for a user, ready to receive tasks.
 */
export function getOnlineDeviceSession(userId: string): DeviceSession | null {
  const deviceIds = userDevices.get(userId);
  if (!deviceIds) return null;

  for (const deviceId of deviceIds) {
    const session = sessions.get(deviceId);
    if (session && session.ws.readyState === 1 /* OPEN */) {
      return session;
    }
  }
  return null;
}

/**
 * Dispatch a task to a connected device. Returns true if dispatched.
 */
export function dispatchTaskToDevice(
  deviceId: string,
  executionId: string,
  agentId: string,
  agentName: string,
  input: string,
  maxTurns?: number,
  maxBudget?: number,
): boolean {
  const session = sessions.get(deviceId);
  if (!session || session.ws.readyState !== 1) return false;

  // Max 1 concurrent execution per device
  if (session.activeExecutions.size >= 1) return false;

  session.activeExecutions.add(executionId);

  sendMessage(session.ws, 'task:dispatch', {
    executionId,
    agentId,
    agentName,
    input,
    maxTurns,
    maxBudget,
  });

  return true;
}

/**
 * Cancel a task on a connected device.
 */
export function cancelDeviceTask(deviceId: string, executionId: string): boolean {
  const session = sessions.get(deviceId);
  if (!session || session.ws.readyState !== 1) return false;

  sendMessage(session.ws, 'task:cancel', { executionId });
  return true;
}

// ============================================
// WebSocket Route Registration
// ============================================

/**
 * Extract the API token from the WebSocket upgrade request.
 *
 * Priority order:
 *   1. Authorization: Bearer <token>   — preferred for CLI/server clients
 *   2. Sec-WebSocket-Protocol: <token> — browser-compatible fallback
 *   3. ?token=<token> query param      — DEPRECATED, logs a warning
 */
function extractToken(request: FastifyRequest): { token: string | null; deprecated: boolean } {
  // 1. Authorization header
  const authHeader = request.headers['authorization'];
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) return { token, deprecated: false };
  }

  // 2. Sec-WebSocket-Protocol header (value must be a valid subprotocol string, so
  //    the client sends the raw key as the protocol value, e.g. "askalf-agent-bridge, <token>")
  const protocolHeader = request.headers['sec-websocket-protocol'];
  if (protocolHeader) {
    // Support both bare token and "askalf-agent-bridge, <token>" format
    const parts = protocolHeader.split(',').map((p) => p.trim());
    const tokenPart = parts.find((p) => p !== 'askalf-agent-bridge');
    if (tokenPart) return { token: tokenPart, deprecated: false };
  }

  // 3. Query param — deprecated
  const queryToken = (request.query as Record<string, string>)['token'];
  if (queryToken) return { token: queryToken, deprecated: true };

  return { token: null, deprecated: false };
}

export async function registerAgentBridge(app: FastifyInstance): Promise<void> {
  app.get('/ws/agent-bridge', { websocket: true }, async (socket: WebSocket, request: FastifyRequest) => {
    const { token, deprecated } = extractToken(request);

    if (!token) {
      sendMessage(socket, 'device:error', { code: 'AUTH_REQUIRED', message: 'Missing auth token. Use Authorization: Bearer <token> header.' });
      socket.close(4001, 'Missing token');
      return;
    }

    if (deprecated) {
      console.warn('[AgentBridge] DEPRECATED: token passed as query parameter. Use Authorization: Bearer <token> header instead. Query param auth will be removed after 2026-06-12.');
    }

    // Validate API key (inline — avoids @askalf/auth dependency)
    const apiKey = await validateBridgeToken(token);
    if (!apiKey) {
      sendMessage(socket, 'device:error', { code: 'AUTH_FAILED', message: 'Invalid or expired token' });
      socket.close(4001, 'Invalid token');
      return;
    }

    // Resolve user from API key
    const user = apiKey.user_id
      ? await queryOne<{ id: string; tenant_id: string }>(
          `SELECT id, tenant_id FROM users WHERE id = $1 AND status = 'active'`,
          [apiKey.user_id],
        )
      : null;

    if (!user) {
      sendMessage(socket, 'device:error', { code: 'USER_NOT_FOUND', message: 'API key not associated with an active user' });
      socket.close(4001, 'User not found');
      return;
    }

    const userId = user.id;
    const tenantId = user.tenant_id;
    const apiKeyId = apiKey.id;

    console.log(`[AgentBridge] Connection from user=${userId} key=${apiKey.key_prefix}`);

    // Partial session — will be completed on device:register or device:reconnect
    let session: DeviceSession | null = null;

    // Heartbeat timeout checker (close if no message in 90s)
    let heartbeatTimeout = setTimeout(() => {
      if (socket.readyState === 1) {
        console.log(`[AgentBridge] Heartbeat timeout for user=${userId}`);
        socket.close(4002, 'Heartbeat timeout');
      }
    }, 90_000);

    const resetHeartbeatTimeout = () => {
      clearTimeout(heartbeatTimeout);
      heartbeatTimeout = setTimeout(() => {
        if (socket.readyState === 1) {
          console.log(`[AgentBridge] Heartbeat timeout for device=${session?.deviceId ?? 'unknown'}`);
          socket.close(4002, 'Heartbeat timeout');
        }
      }, 90_000);
    };

    socket.on('message', (data: Buffer | string) => {
      resetHeartbeatTimeout();

      let msg: ClientMessage;
      try {
        msg = JSON.parse(typeof data === 'string' ? data : data.toString()) as ClientMessage;
      } catch {
        sendMessage(socket, 'device:error', { code: 'INVALID_JSON', message: 'Could not parse message' });
        return;
      }

      void handleClientMessage(msg, socket, userId, tenantId, apiKeyId, session, (s) => { session = s; }).catch((err) => {
        console.error(`[AgentBridge] Error handling message type=${msg.type}:`, err instanceof Error ? err.message : err);
        sendMessage(socket, 'device:error', { code: 'INTERNAL_ERROR', message: 'Server error processing message' });
      });
    });

    socket.on('close', () => {
      clearTimeout(heartbeatTimeout);
      if (session) {
        cleanupSession(session);
      }
    });

    socket.on('error', (err: Error) => {
      console.error(`[AgentBridge] WebSocket error for device=${session?.deviceId ?? 'unknown'}:`, err.message);
    });
  });

  // Periodic stale device cleanup (every 60s)
  staleCleanupTimer = setInterval(() => {
    void cleanupStaleDevices().catch(() => {});
  }, 60_000);

  console.log('[AgentBridge] WebSocket endpoint registered at /ws/agent-bridge');
}

// ============================================
// Message Handlers
// ============================================

async function handleClientMessage(
  msg: ClientMessage,
  ws: WebSocket,
  userId: string,
  tenantId: string,
  apiKeyId: string,
  session: DeviceSession | null,
  setSession: (s: DeviceSession) => void,
): Promise<void> {
  switch (msg.type) {
    case 'device:register': {
      if (session) {
        sendMessage(ws, 'device:error', { code: 'ALREADY_REGISTERED', message: 'Device already registered on this connection' });
        return;
      }

      const { hostname, os, capabilities, deviceName } = msg.payload as {
        hostname?: string; os?: string; capabilities?: Record<string, unknown>; deviceName?: string;
      };

      const device = await registerDevice({
        userId,
        tenantId,
        apiKeyId,
        deviceName: deviceName || hostname || 'Unknown Device',
        hostname,
        os,
        capabilities,
      });

      const newSession = createSession(ws, device, userId, tenantId, apiKeyId);
      setSession(newSession);

      sendMessage(ws, 'device:registered', { deviceId: device.id, userId });
      console.log(`[AgentBridge] Device registered: ${device.id} (${device.device_name}) for user=${userId}`);
      break;
    }

    case 'device:reconnect': {
      if (session) {
        sendMessage(ws, 'device:error', { code: 'ALREADY_REGISTERED', message: 'Device already registered on this connection' });
        return;
      }

      const { deviceId } = msg.payload as { deviceId?: string };
      if (!deviceId) {
        sendMessage(ws, 'device:error', { code: 'MISSING_DEVICE_ID', message: 'deviceId required for reconnect' });
        return;
      }

      const device = await reconnectDevice(deviceId, apiKeyId);
      if (!device) {
        sendMessage(ws, 'device:error', { code: 'DEVICE_NOT_FOUND', message: 'Device not found or not owned by this API key' });
        return;
      }

      const reconnectedSession = createSession(ws, device, userId, tenantId, apiKeyId);
      setSession(reconnectedSession);

      sendMessage(ws, 'device:registered', { deviceId: device.id, userId });
      console.log(`[AgentBridge] Device reconnected: ${device.id} for user=${userId}`);
      break;
    }

    case 'device:heartbeat': {
      if (!session) return;
      const { load, activeExecutions } = msg.payload as {
        load?: Record<string, unknown>; activeExecutions?: number;
      };
      session.lastHeartbeat = Date.now();
      await updateHeartbeat(session.deviceId, load, activeExecutions);
      break;
    }

    case 'execution:accepted': {
      if (!session) return;
      const { executionId } = msg.payload as { executionId: string };
      if (!executionId) return;

      await dbQuery(
        `UPDATE forge_executions SET status = 'running', started_at = NOW() WHERE id = $1 AND status = 'pending'`,
        [executionId],
      );

      const eventBus = getEventBus();
      void eventBus?.emitExecution('started', executionId, '', '').catch(() => {});
      console.log(`[AgentBridge] Execution ${executionId} accepted by device ${session.deviceId}`);
      break;
    }

    case 'execution:progress': {
      if (!session) return;
      const { executionId, progressType, data } = msg.payload as {
        executionId: string; progressType?: string; data?: unknown;
      };
      if (!executionId) return;

      // Forward progress to event bus for real-time dashboard streaming
      const eventBus = getEventBus();
      void eventBus?.emitExecution('progress', executionId, '', '', {
        output: typeof data === 'string' ? data : JSON.stringify(data ?? ''),
      }).catch(() => {});
      break;
    }

    case 'execution:complete': {
      if (!session) return;
      const { executionId, output, cost, inputTokens, outputTokens, turns } = msg.payload as {
        executionId: string; output?: string; cost?: number;
        inputTokens?: number; outputTokens?: number; turns?: number;
      };
      if (!executionId) return;

      session.activeExecutions.delete(executionId);

      await dbQuery(
        `UPDATE forge_executions
         SET status = 'completed', output = $1, completed_at = NOW(),
             total_cost = $2, input_tokens = $3, output_tokens = $4, iterations = $5
         WHERE id = $6`,
        [output ?? '', cost ?? 0, inputTokens ?? 0, outputTokens ?? 0, turns ?? 0, executionId],
      );

      // Publish result for TeamManager / FleetCoordinator
      const exec = await queryOne<{ agent_id: string; metadata: Record<string, unknown> | null }>(
        `SELECT agent_id, metadata FROM forge_executions WHERE id = $1`,
        [executionId],
      );

      if (exec) {
        const eventBus = getEventBus();
        void eventBus?.emitExecution('completed', executionId, exec.agent_id, exec.agent_id, {
          output: output ?? '',
          cost,
        }).catch(() => {});

        // Publish to agent results channel for fleet coordination
        const { getRedisPublisher } = await import('./task-dispatcher.js');
        const pub = getRedisPublisher();
        if (pub) {
          const meta = exec.metadata ?? {};
          await pub.publish(`agent:${exec.agent_id}:results`, JSON.stringify({
            executionId,
            agentId: exec.agent_id,
            status: 'completed',
            output: output ?? '',
            durationMs: 0,
            planId: meta['planId'],
            taskId: meta['taskId'],
          }));
        }
      }

      console.log(`[AgentBridge] Execution ${executionId} completed by device ${session.deviceId}`);
      break;
    }

    case 'execution:failed': {
      if (!session) return;
      const { executionId, error } = msg.payload as { executionId: string; error?: string };
      if (!executionId) return;

      session.activeExecutions.delete(executionId);

      await dbQuery(
        `UPDATE forge_executions SET status = 'failed', error = $1, completed_at = NOW() WHERE id = $2`,
        [error ?? 'Device execution failed', executionId],
      );

      const exec = await queryOne<{ agent_id: string }>(
        `SELECT agent_id FROM forge_executions WHERE id = $1`,
        [executionId],
      );

      if (exec) {
        const eventBus = getEventBus();
        void eventBus?.emitExecution('failed', executionId, exec.agent_id, exec.agent_id, {
          error: error ?? 'Device execution failed',
        }).catch(() => {});
      }

      console.log(`[AgentBridge] Execution ${executionId} failed on device ${session.deviceId}: ${error}`);
      break;
    }

    default:
      sendMessage(ws, 'device:error', { code: 'UNKNOWN_TYPE', message: `Unknown message type: ${msg.type}` });
  }
}

// ============================================
// Helpers
// ============================================

function createSession(
  ws: WebSocket,
  device: AgentDevice,
  userId: string,
  tenantId: string,
  apiKeyId: string,
): DeviceSession {
  // Close any existing session for this device (prevents duplicate connections)
  const existing = sessions.get(device.id);
  if (existing) {
    try { existing.ws.close(4003, 'Replaced by new connection'); } catch { /* ignore */ }
    cleanupSession(existing, false);
  }

  const session: DeviceSession = {
    ws,
    deviceId: device.id,
    userId,
    tenantId,
    apiKeyId,
    activeExecutions: new Set(),
    heartbeatTimer: null,
    lastHeartbeat: Date.now(),
  };

  sessions.set(device.id, session);

  // Track user → devices mapping
  if (!userDevices.has(userId)) {
    userDevices.set(userId, new Set());
  }
  userDevices.get(userId)!.add(device.id);

  return session;
}

function cleanupSession(session: DeviceSession, markOffline = true): void {
  if (session.heartbeatTimer) {
    clearInterval(session.heartbeatTimer);
  }

  sessions.delete(session.deviceId);

  const userDeviceSet = userDevices.get(session.userId);
  if (userDeviceSet) {
    userDeviceSet.delete(session.deviceId);
    if (userDeviceSet.size === 0) {
      userDevices.delete(session.userId);
    }
  }

  if (markOffline) {
    void markDeviceOffline(session.deviceId).catch(() => {});
  }

  // Fail any in-progress executions
  for (const execId of session.activeExecutions) {
    void dbQuery(
      `UPDATE forge_executions SET status = 'failed', error = 'Device disconnected', completed_at = NOW() WHERE id = $1 AND status IN ('pending', 'running')`,
      [execId],
    ).catch(() => {});
  }

  console.log(`[AgentBridge] Session cleaned up for device=${session.deviceId} (activeExecs=${session.activeExecutions.size})`);
}

function sendMessage(ws: WebSocket, type: string, payload: Record<string, unknown>): void {
  try {
    ws.send(JSON.stringify({ type, payload }));
  } catch {
    // Socket may already be closed
  }
}

/**
 * Validate an API key token against the api_keys table.
 * Inline implementation to avoid @askalf/auth dependency (which has Fastify cookie type issues in Docker).
 */
async function validateBridgeToken(key: string): Promise<{ id: string; user_id: string | null; tenant_id: string; key_prefix: string } | null> {
  const rows = await dbQuery<{ id: string; user_id: string | null; tenant_id: string; key_prefix: string; key_hash: string }>(
    `SELECT id, user_id, tenant_id, key_prefix, key_hash FROM api_keys
     WHERE status = 'active' AND (expires_at IS NULL OR expires_at > NOW())`,
    [],
  );

  for (const row of rows) {
    if (verifyKeyHash(key, row.key_hash)) {
      // Update usage stats
      void dbQuery(
        `UPDATE api_keys SET last_used_at = NOW(), usage_count = usage_count + 1 WHERE id = $1`,
        [row.id],
      ).catch(() => {});
      return { id: row.id, user_id: row.user_id, tenant_id: row.tenant_id, key_prefix: row.key_prefix };
    }
  }
  return null;
}

function verifyKeyHash(key: string, storedHash: string): boolean {
  try {
    if (!storedHash.includes('.')) return false;
    const [saltHex, hashHex] = storedHash.split('.');
    if (!saltHex || !hashHex) return false;
    const salt = Buffer.from(saltHex, 'hex');
    const derived = pbkdf2Sync(key, salt, 100_000, 32, 'sha256');
    return derived.toString('hex') === hashHex;
  } catch {
    return false;
  }
}

/**
 * Shut down the agent bridge (called during graceful shutdown).
 */
export function stopAgentBridge(): void {
  if (staleCleanupTimer) {
    clearInterval(staleCleanupTimer);
    staleCleanupTimer = null;
  }

  // Close all active sessions
  for (const session of sessions.values()) {
    try {
      sendMessage(session.ws, 'device:error', { code: 'SERVER_SHUTDOWN', message: 'Server shutting down' });
      session.ws.close(1001, 'Server shutting down');
    } catch { /* ignore */ }
  }

  sessions.clear();
  userDevices.clear();
}
