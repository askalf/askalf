/**
 * Mobile Adapter (Android + iOS)
 *
 * Client-connecting adapter for mobile apps.
 * Mobile app connects via WebSocket with deviceType='android' or 'ios'.
 * Shared protocol with platform-specific capabilities.
 *
 * Protocol messages (server → client):
 *   mobile:screenshot     {}
 *   mobile:tap            { x, y }
 *   mobile:doubleTap      { x, y }
 *   mobile:swipe          { startX, startY, endX, endY, duration }
 *   mobile:type           { text }
 *   mobile:pressKey       { key }
 *   mobile:launchApp      { packageName/bundleId }
 *   mobile:notification   { title, body }
 *   mobile:clipboard      { action: 'get'|'set', text? }
 *   mobile:deviceInfo     {}
 *   mobile:batteryStatus  {}
 *   mobile:location       {}
 *
 * Android-specific:
 *   mobile:adb            { command }
 *   mobile:intent         { action, uri?, extras? }
 *
 * iOS-specific:
 *   mobile:shortcut       { name, input? }
 *   mobile:siri           { query }
 *
 * Protocol messages (client → server):
 *   mobile:result         { requestId, data, screenshot? }
 *   mobile:event          { type, data }
 */

import type { DeviceAdapter, DeviceType, TaskExecution, ConnectionConfig, DeviceCapabilities } from './device-adapter.js';
import { dispatchTaskToDevice, cancelDeviceTask } from '../agent-bridge.js';

export class MobileAdapter implements DeviceAdapter {
  readonly type: DeviceType;
  readonly category = 'mobile' as const;
  readonly protocol = 'websocket' as const;
  readonly maxConcurrency = 1;

  constructor(platform: 'android' | 'ios') {
    this.type = platform;
  }

  defaultCapabilities(): Partial<DeviceCapabilities> {
    const base: Partial<DeviceCapabilities> = { gui: true, camera: true };
    if (this.type === 'android') {
      return { ...base, adb: true, shell: true };
    }
    return { ...base, shortcuts: true };
  }

  canExecute(_task: TaskExecution, capabilities: Partial<DeviceCapabilities>): boolean {
    return capabilities.gui === true;
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
    const platform = this.type === 'android' ? 'Android' : 'iOS';
    return { ok: true, message: `${platform} devices connect via the AskAlf mobile app` };
  }

  async cleanup(): Promise<void> {}
}

export const MOBILE_MESSAGE_TYPES = [
  'mobile:screenshot',
  'mobile:tap',
  'mobile:doubleTap',
  'mobile:swipe',
  'mobile:type',
  'mobile:pressKey',
  'mobile:launchApp',
  'mobile:notification',
  'mobile:clipboard',
  'mobile:deviceInfo',
  'mobile:batteryStatus',
  'mobile:location',
  'mobile:adb',
  'mobile:intent',
  'mobile:shortcut',
  'mobile:siri',
  'mobile:result',
  'mobile:event',
] as const;
