/**
 * Home Assistant Adapter
 *
 * Server-managed adapter that controls smart home devices via the HA REST API.
 * Forge calls HA directly — no client app needed on the HA side.
 *
 * Supported operations (mapped from task input):
 *   light.turn_on / light.turn_off    — Control lights
 *   switch.turn_on / switch.turn_off  — Control switches
 *   scene.turn_on                     — Activate scenes
 *   automation.trigger                — Trigger automations
 *   climate.set_temperature           — Control thermostats
 *   media_player.play_media           — Control media
 *   script.turn_on                    — Run scripts
 *   sensor.read                       — Read sensor state
 *   states                            — Get all entity states
 *
 * Task input format:
 *   JSON: { "service": "light.turn_on", "entity_id": "light.living_room", "data": {} }
 *   or natural language (agent interprets and calls the right service)
 */

import type { DeviceAdapter, TaskExecution, ConnectionConfig, DeviceCapabilities } from './device-adapter.js';
import { query } from '../../database.js';

export class HomeAssistantAdapter implements DeviceAdapter {
  readonly type = 'homeassistant' as const;
  readonly category = 'iot' as const;
  readonly protocol = 'rest-poll' as const;
  readonly maxConcurrency = 5;

  defaultCapabilities(): Partial<DeviceCapabilities> {
    return { homeautomation: true, sensors: true };
  }

  canExecute(_task: TaskExecution, capabilities: Partial<DeviceCapabilities>): boolean {
    return capabilities.homeautomation === true;
  }

  async dispatch(deviceId: string, task: TaskExecution, config: ConnectionConfig): Promise<boolean> {
    const haUrl = config.haUrl;
    const haToken = config.haToken;

    if (!haUrl || !haToken) {
      console.error('[HomeAssistantAdapter] Missing HA URL or token');
      return false;
    }

    void this.executeCommand(task, haUrl, haToken, config.entityPrefix).catch((err) => {
      console.error('[HomeAssistantAdapter] Execution error:', err);
    });

    return true;
  }

  private async executeCommand(
    task: TaskExecution,
    haUrl: string,
    haToken: string,
    entityPrefix?: string,
  ): Promise<void> {
    try {
      let command: { service?: string; entity_id?: string; data?: Record<string, unknown>; action?: string };

      try {
        command = JSON.parse(task.input);
      } catch {
        // Natural language — wrap as a states query
        command = { action: 'states' };
      }

      let result: string;

      if (command.action === 'states') {
        // Get all entity states
        const states = await this.haGet(haUrl, haToken, '/api/states');
        const filtered = entityPrefix
          ? (states as Array<Record<string, unknown>>).filter((s) =>
              String(s['entity_id'] || '').startsWith(entityPrefix))
          : states;
        result = JSON.stringify(filtered, null, 2);
      } else if (command.service) {
        // Call a service
        const [domain, service] = command.service.split('.');
        if (!domain || !service) {
          await this.recordResult(task.executionId, 'failed', '', `Invalid service: ${command.service}`);
          return;
        }

        const body: Record<string, unknown> = { ...command.data };
        if (command.entity_id) {
          body['entity_id'] = command.entity_id;
        }

        const response = await this.haPost(haUrl, haToken, `/api/services/${domain}/${service}`, body);
        result = JSON.stringify(response, null, 2);
      } else {
        await this.recordResult(task.executionId, 'failed', '', 'Unknown command format. Use {service, entity_id, data} or {action: "states"}');
        return;
      }

      await this.recordResult(task.executionId, 'completed', result);
    } catch (err) {
      await this.recordResult(task.executionId, 'failed', '', err instanceof Error ? err.message : String(err));
    }
  }

  private async haGet(baseUrl: string, token: string, path: string): Promise<unknown> {
    const res = await fetch(`${baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    if (!res.ok) throw new Error(`HA API ${path}: ${res.status} ${await res.text()}`);
    return res.json();
  }

  private async haPost(baseUrl: string, token: string, path: string, body: Record<string, unknown>): Promise<unknown> {
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HA API ${path}: ${res.status} ${await res.text()}`);
    return res.json();
  }

  private async recordResult(executionId: string, status: string, output: string, error?: string): Promise<void> {
    await query(
      `UPDATE forge_executions SET status = $1, output = $2, error = $3, completed_at = NOW() WHERE id = $4`,
      [status, output, error ?? null, executionId],
    );
  }

  async cancel(): Promise<boolean> {
    // HA commands are fire-and-forget, can't cancel
    return false;
  }

  async testConnection(config: ConnectionConfig): Promise<{ ok: boolean; message: string }> {
    const haUrl = config.haUrl;
    const haToken = config.haToken;

    if (!haUrl || !haToken) {
      return { ok: false, message: 'Missing Home Assistant URL or long-lived access token' };
    }

    try {
      const res = await fetch(`${haUrl}/api/`, {
        headers: { Authorization: `Bearer ${haToken}` },
      });
      if (!res.ok) return { ok: false, message: `HA API returned ${res.status}` };
      const data = await res.json() as { message?: string };
      return { ok: true, message: `Home Assistant connected — ${data.message || 'API OK'}` };
    } catch (err) {
      return { ok: false, message: `Cannot reach HA: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  async cleanup(): Promise<void> {}
}
