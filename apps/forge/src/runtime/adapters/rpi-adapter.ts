/**
 * Raspberry Pi Adapter
 *
 * Client-connecting adapter for Raspberry Pi edge devices.
 * Same WebSocket protocol as CLI but with GPIO/sensor/camera capabilities.
 * RPi runs askalf-agent with additional hardware access.
 *
 * Protocol messages (server → client, in addition to standard task:dispatch):
 *   rpi:gpio:read       { pin }
 *   rpi:gpio:write      { pin, value }
 *   rpi:gpio:pwm        { pin, dutyCycle, frequency }
 *   rpi:sensor:read     { sensorId, type }
 *   rpi:camera:capture  { resolution?, format? }
 *   rpi:i2c:read        { address, register, length }
 *   rpi:i2c:write       { address, register, data }
 *   rpi:spi:transfer    { channel, data }
 *
 * Protocol messages (client → server):
 *   rpi:result          { requestId, data }
 *   rpi:sensor:event    { sensorId, type, value, timestamp }
 */

import type { DeviceAdapter, TaskExecution, ConnectionConfig, DeviceCapabilities } from './device-adapter.js';
import { dispatchTaskToDevice, cancelDeviceTask } from '../agent-bridge.js';

export class RpiAdapter implements DeviceAdapter {
  readonly type = 'rpi' as const;
  readonly category = 'iot' as const;
  readonly protocol = 'websocket' as const;
  readonly maxConcurrency = 1;

  defaultCapabilities(): Partial<DeviceCapabilities> {
    return { shell: true, filesystem: true, git: true, gpio: true, camera: true, sensors: true, python: true };
  }

  canExecute(_task: TaskExecution, capabilities: Partial<DeviceCapabilities>): boolean {
    return capabilities.shell === true || capabilities.gpio === true;
  }

  async dispatch(deviceId: string, task: TaskExecution): Promise<boolean> {
    return dispatchTaskToDevice(
      deviceId,
      task.executionId,
      task.agentId,
      task.agentName,
      task.input,
      task.maxTurns,
      task.maxBudget,
    );
  }

  async cancel(deviceId: string, executionId: string): Promise<boolean> {
    return cancelDeviceTask(deviceId, executionId);
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    return { ok: true, message: 'Raspberry Pi connects via askalf-agent (ARM build)' };
  }

  async cleanup(): Promise<void> {}
}

export const RPI_MESSAGE_TYPES = [
  'rpi:gpio:read',
  'rpi:gpio:write',
  'rpi:gpio:pwm',
  'rpi:sensor:read',
  'rpi:camera:capture',
  'rpi:i2c:read',
  'rpi:i2c:write',
  'rpi:spi:transfer',
  'rpi:result',
  'rpi:sensor:event',
] as const;
