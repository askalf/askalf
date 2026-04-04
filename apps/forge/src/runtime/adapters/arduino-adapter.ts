/**
 * Arduino/ESP32 MQTT Adapter
 *
 * IoT adapter for microcontrollers that communicate via MQTT.
 * Forge publishes tasks to device-specific MQTT topics.
 * Device publishes results back. Lightweight JSON protocol.
 *
 * MQTT Topics:
 *   askalf/devices/{deviceId}/tasks    — Server publishes task commands
 *   askalf/devices/{deviceId}/results  — Device publishes results
 *   askalf/devices/{deviceId}/status   — Device publishes heartbeats/status
 *   askalf/devices/{deviceId}/sensors  — Device publishes sensor data
 *
 * Task payload (published to .../tasks):
 *   { id, cmd, params }
 *   cmd: 'gpio:read' | 'gpio:write' | 'analog:read' | 'sensor:read' | 'ota:update' | 'exec'
 *
 * Result payload (published to .../results):
 *   { id, ok, data?, error? }
 *
 * Status payload (published to .../status):
 *   { uptime, freeHeap, wifiRssi, batteryPct? }
 */

import type { DeviceAdapter, TaskExecution, ConnectionConfig, DeviceCapabilities } from './device-adapter.js';
import { query } from '../../database.js';

/** Pending task callbacks waiting for MQTT results */
const pendingTasks = new Map<string, {
  resolve: (result: { ok: boolean; data?: unknown; error?: string }) => void;
  timer: ReturnType<typeof setTimeout>;
}>();

/** MQTT client instance — initialized by MqttBridge */
let mqttPublish: ((topic: string, payload: string) => void) | null = null;

/** Called by MqttBridge to set the publish function */
export function setMqttPublish(fn: (topic: string, payload: string) => void): void {
  mqttPublish = fn;
}

/** Called by MqttBridge when a result message arrives */
export function handleMqttResult(deviceId: string, payload: string): void {
  try {
    const result = JSON.parse(payload) as { id: string; ok: boolean; data?: unknown; error?: string };
    const pending = pendingTasks.get(result.id);
    if (pending) {
      clearTimeout(pending.timer);
      pendingTasks.delete(result.id);
      pending.resolve(result);
    }
  } catch {
    console.error(`[ArduinoAdapter] Invalid MQTT result from ${deviceId}`);
  }
}

const MQTT_TIMEOUT_MS = 30_000;

export class ArduinoAdapter implements DeviceAdapter {
  readonly type = 'arduino' as const;
  readonly category = 'iot' as const;
  readonly protocol = 'mqtt' as const;
  readonly maxConcurrency = 1;

  defaultCapabilities(): Partial<DeviceCapabilities> {
    return { gpio: true, sensors: true };
  }

  canExecute(_task: TaskExecution, capabilities: Partial<DeviceCapabilities>): boolean {
    return capabilities.gpio === true || capabilities.sensors === true;
  }

  async dispatch(deviceId: string, task: TaskExecution, config: ConnectionConfig): Promise<boolean> {
    if (!mqttPublish) {
      console.error('[ArduinoAdapter] MQTT not initialized');
      return false;
    }

    const topic = `askalf/devices/${deviceId}/tasks`;
    const payload = JSON.stringify({
      id: task.executionId,
      cmd: 'exec',
      params: { input: task.input },
    });

    mqttPublish(topic, payload);

    // Wait for result asynchronously
    void this.waitForResult(task.executionId).then(async (result) => {
      if (result.ok) {
        await this.recordResult(task.executionId, 'completed', JSON.stringify(result.data || ''));
      } else {
        await this.recordResult(task.executionId, 'failed', '', result.error || 'Device execution failed');
      }
    }).catch(async () => {
      await this.recordResult(task.executionId, 'failed', '', 'MQTT timeout');
    });

    return true;
  }

  private waitForResult(executionId: string): Promise<{ ok: boolean; data?: unknown; error?: string }> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingTasks.delete(executionId);
        reject(new Error('MQTT timeout'));
      }, MQTT_TIMEOUT_MS);

      pendingTasks.set(executionId, { resolve, timer });
    });
  }

  private async recordResult(executionId: string, status: string, output: string, error?: string): Promise<void> {
    await query(
      `UPDATE forge_executions SET status = $1, output = $2, error = $3, completed_at = NOW() WHERE id = $4`,
      [status, output, error ?? null, executionId],
    );
  }

  async cancel(deviceId: string, executionId: string): Promise<boolean> {
    if (!mqttPublish) return false;
    mqttPublish(`askalf/devices/${deviceId}/tasks`, JSON.stringify({ id: executionId, cmd: 'cancel' }));
    pendingTasks.delete(executionId);
    return true;
  }

  async testConnection(config: ConnectionConfig): Promise<{ ok: boolean; message: string }> {
    if (!mqttPublish) {
      return { ok: false, message: 'MQTT broker not configured. Set MQTT_BROKER_URL in environment.' };
    }
    return { ok: true, message: `MQTT connected — device topic: askalf/devices/*/tasks` };
  }

  async cleanup(deviceId: string): Promise<void> {
    // Clear any pending tasks for this device
    for (const [id, pending] of pendingTasks) {
      clearTimeout(pending.timer);
      pendingTasks.delete(id);
    }
  }
}
