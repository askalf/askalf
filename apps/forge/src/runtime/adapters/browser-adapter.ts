/**
 * Browser Bridge Adapter
 *
 * Client-connecting adapter for browser extensions.
 * Extension connects via WebSocket to /ws/agent-bridge with deviceType='browser'.
 * Supports navigation, screenshots, DOM extraction, JS evaluation.
 *
 * Protocol messages (server → client):
 *   browser:navigate   { url }
 *   browser:screenshot  {}
 *   browser:click       { selector, x, y }
 *   browser:type        { selector, text }
 *   browser:evaluate    { script }
 *   browser:extractDOM  { selector }
 *
 * Protocol messages (client → server):
 *   browser:result      { requestId, data, screenshot? }
 */

import type { DeviceAdapter, TaskExecution, ConnectionConfig, DeviceCapabilities } from './device-adapter.js';
import { dispatchTaskToDevice, cancelDeviceTask } from '../agent-bridge.js';

export class BrowserAdapter implements DeviceAdapter {
  readonly type = 'browser' as const;
  readonly category = 'browser' as const;
  readonly protocol = 'websocket' as const;
  readonly maxConcurrency = 1;

  defaultCapabilities(): Partial<DeviceCapabilities> {
    return { browser: true, gui: true };
  }

  canExecute(_task: TaskExecution, capabilities: Partial<DeviceCapabilities>): boolean {
    return capabilities.browser === true;
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
    return { ok: true, message: 'Browser devices connect via the AskAlf browser extension' };
  }

  async cleanup(): Promise<void> {}
}

/** Browser-specific message types the bridge routes to connected extensions */
export const BROWSER_MESSAGE_TYPES = [
  'browser:navigate',
  'browser:screenshot',
  'browser:click',
  'browser:type',
  'browser:evaluate',
  'browser:extractDOM',
  'browser:result',
] as const;
