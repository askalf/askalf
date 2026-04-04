/**
 * Desktop Control Adapter
 *
 * Client-connecting adapter for desktop automation apps.
 * Desktop agent (Electron or native) connects via WebSocket with deviceType='desktop'.
 * Supports screenshots, mouse/keyboard control, file operations, command execution.
 *
 * Protocol messages (server → client):
 *   desktop:screenshot   {}
 *   desktop:click        { x, y, button }
 *   desktop:doubleClick  { x, y }
 *   desktop:type         { text }
 *   desktop:keyPress     { keys }
 *   desktop:moveMouse    { x, y }
 *   desktop:scroll       { x, y, direction, amount }
 *   desktop:runCommand   { command }
 *   desktop:readFile     { path }
 *   desktop:writeFile    { path, content }
 *   desktop:listDir      { path }
 *
 * Protocol messages (client → server):
 *   desktop:result       { requestId, data, screenshot? }
 */

import type { DeviceAdapter, TaskExecution, ConnectionConfig, DeviceCapabilities } from './device-adapter.js';
import { dispatchTaskToDevice, cancelDeviceTask } from '../agent-bridge.js';

export class DesktopAdapter implements DeviceAdapter {
  readonly type = 'desktop' as const;
  readonly category = 'browser' as const;
  readonly protocol = 'websocket' as const;
  readonly maxConcurrency = 1;

  defaultCapabilities(): Partial<DeviceCapabilities> {
    return { gui: true, shell: true, filesystem: true };
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
    return { ok: true, message: 'Desktop devices connect via the AskAlf desktop agent' };
  }

  async cleanup(): Promise<void> {}
}

export const DESKTOP_MESSAGE_TYPES = [
  'desktop:screenshot',
  'desktop:click',
  'desktop:doubleClick',
  'desktop:type',
  'desktop:keyPress',
  'desktop:moveMouse',
  'desktop:scroll',
  'desktop:runCommand',
  'desktop:readFile',
  'desktop:writeFile',
  'desktop:listDir',
  'desktop:result',
] as const;
