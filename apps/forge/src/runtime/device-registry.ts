/**
 * Device Registry
 *
 * CRUD operations for agent_devices table.
 * Tracks local machines running askalf-agent that are connected to the platform
 * via WebSocket for remote task execution.
 */

import { ulid } from 'ulid';
import { query, queryOne } from '../database.js';

// ============================================
// Types
// ============================================

export type DeviceType = 'cli' | 'docker' | 'ssh' | 'k8s' | 'browser' | 'desktop' | 'vscode' | 'android' | 'ios' | 'rpi' | 'arduino' | 'homeassistant';
export type DeviceCategory = 'compute' | 'browser' | 'mobile' | 'iot';
export type DeviceProtocol = 'websocket' | 'server-managed' | 'mqtt' | 'rest-poll';

export interface AgentDevice {
  id: string;
  user_id: string;
  tenant_id: string;
  api_key_id: string;
  device_name: string;
  hostname: string | null;
  os: string | null;
  platform_capabilities: Record<string, unknown>;
  status: 'online' | 'offline' | 'busy';
  last_seen_at: Date | null;
  created_at: Date;
  updated_at: Date;
  device_type: DeviceType;
  device_category: DeviceCategory;
  connection_config: Record<string, unknown>;
  max_concurrent_tasks: number;
  protocol: DeviceProtocol;
}

export interface RegisterDeviceInput {
  userId: string;
  tenantId: string;
  apiKeyId: string;
  deviceName: string;
  hostname?: string;
  os?: string;
  capabilities?: Record<string, unknown>;
  deviceType?: DeviceType;
  deviceCategory?: DeviceCategory;
  connectionConfig?: Record<string, unknown>;
  maxConcurrentTasks?: number;
  protocol?: DeviceProtocol;
}

// ============================================
// Operations
// ============================================

const MAX_DEVICES_PER_USER = 10;

/**
 * Register a new device or update existing one for the same API key.
 */
export async function registerDevice(input: RegisterDeviceInput): Promise<AgentDevice> {
  // Check device limit
  const countResult = await queryOne<{ count: string }>(
    `SELECT COUNT(*) as count FROM agent_devices WHERE user_id = $1`,
    [input.userId],
  );
  const currentCount = parseInt(countResult?.count ?? '0', 10);

  // Check if this API key already has a device (reconnect case)
  const existing = await queryOne<AgentDevice>(
    `SELECT * FROM agent_devices WHERE api_key_id = $1`,
    [input.apiKeyId],
  );

  if (existing) {
    // Update existing device
    const updated = await queryOne<AgentDevice>(
      `UPDATE agent_devices
       SET device_name = $1, hostname = $2, os = $3,
           platform_capabilities = $4, status = 'online',
           last_seen_at = NOW(), updated_at = NOW(),
           device_type = COALESCE($6, device_type),
           device_category = COALESCE($7, device_category),
           connection_config = COALESCE($8, connection_config),
           protocol = COALESCE($9, protocol)
       WHERE id = $5
       RETURNING *`,
      [
        input.deviceName,
        input.hostname ?? null,
        input.os ?? null,
        JSON.stringify(input.capabilities ?? {}),
        existing.id,
        input.deviceType ?? null,
        input.deviceCategory ?? null,
        input.connectionConfig ? JSON.stringify(input.connectionConfig) : null,
        input.protocol ?? null,
      ],
    );
    return updated!;
  }

  if (currentCount >= MAX_DEVICES_PER_USER) {
    throw new Error(`Device limit reached (max ${MAX_DEVICES_PER_USER} per user)`);
  }

  const id = `dev_${ulid()}`;
  const device = await queryOne<AgentDevice>(
    `INSERT INTO agent_devices (id, user_id, tenant_id, api_key_id, device_name, hostname, os, platform_capabilities, status, last_seen_at, device_type, device_category, connection_config, max_concurrent_tasks, protocol)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'online', NOW(), $9, $10, $11, $12, $13)
     RETURNING *`,
    [
      id,
      input.userId,
      input.tenantId,
      input.apiKeyId,
      input.deviceName,
      input.hostname ?? null,
      input.os ?? null,
      JSON.stringify(input.capabilities ?? {}),
      input.deviceType ?? 'cli',
      input.deviceCategory ?? 'compute',
      JSON.stringify(input.connectionConfig ?? {}),
      input.maxConcurrentTasks ?? 1,
      input.protocol ?? 'websocket',
    ],
  );

  return device!;
}

/**
 * Reconnect an existing device by ID.
 */
export async function reconnectDevice(deviceId: string, apiKeyId: string): Promise<AgentDevice | null> {
  const device = await queryOne<AgentDevice>(
    `UPDATE agent_devices
     SET status = 'online', last_seen_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND api_key_id = $2
     RETURNING *`,
    [deviceId, apiKeyId],
  );
  return device ?? null;
}

/**
 * Update device heartbeat.
 */
export async function updateHeartbeat(
  deviceId: string,
  load?: Record<string, unknown>,
  activeExecutions?: number,
): Promise<void> {
  const status = activeExecutions && activeExecutions > 0 ? 'busy' : 'online';
  await query(
    `UPDATE agent_devices
     SET last_seen_at = NOW(), status = $1, updated_at = NOW(),
         platform_capabilities = platform_capabilities || $2
     WHERE id = $3`,
    [status, JSON.stringify(load ? { last_load: load } : {}), deviceId],
  );
}

/**
 * Mark a device as offline.
 */
export async function markDeviceOffline(deviceId: string): Promise<void> {
  await query(
    `UPDATE agent_devices SET status = 'offline', updated_at = NOW() WHERE id = $1`,
    [deviceId],
  );
}

/**
 * Mark all devices for an API key as offline (key revocation).
 */
export async function markDevicesOfflineByApiKey(apiKeyId: string): Promise<number> {
  const rows = await query<{ id: string }>(
    `UPDATE agent_devices SET status = 'offline', updated_at = NOW()
     WHERE api_key_id = $1 AND status != 'offline'
     RETURNING id`,
    [apiKeyId],
  );
  return rows.length;
}

/**
 * Find an online device for a user.
 */
export async function findOnlineDevice(userId: string): Promise<AgentDevice | null> {
  const device = await queryOne<AgentDevice>(
    `SELECT * FROM agent_devices
     WHERE user_id = $1 AND status = 'online'
       AND last_seen_at > NOW() - INTERVAL '60 seconds'
     ORDER BY last_seen_at DESC
     LIMIT 1`,
    [userId],
  );
  return device ?? null;
}

/**
 * Find an online device of a specific type for a user.
 */
export async function findOnlineDeviceByType(userId: string, deviceType: DeviceType): Promise<AgentDevice | null> {
  const device = await queryOne<AgentDevice>(
    `SELECT * FROM agent_devices
     WHERE user_id = $1 AND device_type = $2 AND status = 'online'
       AND last_seen_at > NOW() - INTERVAL '60 seconds'
     ORDER BY last_seen_at DESC
     LIMIT 1`,
    [userId, deviceType],
  );
  return device ?? null;
}

/**
 * Register a server-managed device (Docker, SSH, K8s, HA) — no WebSocket needed.
 */
export async function registerServerDevice(input: RegisterDeviceInput): Promise<AgentDevice> {
  const countResult = await queryOne<{ count: string }>(
    `SELECT COUNT(*) as count FROM agent_devices WHERE user_id = $1`,
    [input.userId],
  );
  const currentCount = parseInt(countResult?.count ?? '0', 10);
  if (currentCount >= MAX_DEVICES_PER_USER) {
    throw new Error(`Device limit reached (max ${MAX_DEVICES_PER_USER} per user)`);
  }

  const id = `dev_${ulid()}`;
  const device = await queryOne<AgentDevice>(
    `INSERT INTO agent_devices (id, user_id, tenant_id, api_key_id, device_name, hostname, os, platform_capabilities, status, last_seen_at, device_type, device_category, connection_config, max_concurrent_tasks, protocol)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'online', NOW(), $9, $10, $11, $12, $13)
     RETURNING *`,
    [
      id,
      input.userId,
      input.tenantId,
      input.apiKeyId || 'server-managed',
      input.deviceName,
      input.hostname ?? null,
      input.os ?? null,
      JSON.stringify(input.capabilities ?? {}),
      input.deviceType ?? 'docker',
      input.deviceCategory ?? 'compute',
      JSON.stringify(input.connectionConfig ?? {}),
      input.maxConcurrentTasks ?? 1,
      input.protocol ?? 'server-managed',
    ],
  );
  return device!;
}

/**
 * Update device connection config.
 */
export async function updateDeviceConfig(deviceId: string, userId: string, config: Record<string, unknown>): Promise<AgentDevice | null> {
  const device = await queryOne<AgentDevice>(
    `UPDATE agent_devices SET connection_config = $1, updated_at = NOW()
     WHERE id = $2 AND user_id = $3
     RETURNING *`,
    [JSON.stringify(config), deviceId, userId],
  );
  return device ?? null;
}

/**
 * Get a device by ID.
 */
export async function getDevice(deviceId: string): Promise<AgentDevice | null> {
  const device = await queryOne<AgentDevice>(
    `SELECT * FROM agent_devices WHERE id = $1`,
    [deviceId],
  );
  return device ?? null;
}

/**
 * List devices for a user.
 */
export async function listUserDevices(userId: string): Promise<AgentDevice[]> {
  return query<AgentDevice>(
    `SELECT * FROM agent_devices WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId],
  );
}

/**
 * Delete a device.
 */
export async function deleteDevice(deviceId: string, userId: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `DELETE FROM agent_devices WHERE id = $1 AND user_id = $2 RETURNING id`,
    [deviceId, userId],
  );
  return rows.length > 0;
}

/**
 * Mark stale devices as offline (devices that haven't sent heartbeat in 90s).
 */
export async function cleanupStaleDevices(): Promise<number> {
  const rows = await query<{ id: string }>(
    `UPDATE agent_devices SET status = 'offline', updated_at = NOW()
     WHERE status IN ('online', 'busy')
       AND last_seen_at < NOW() - INTERVAL '90 seconds'
     RETURNING id`,
    [],
  );
  return rows.length;
}
