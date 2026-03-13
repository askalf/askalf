/**
 * VS Code Extension Adapter
 *
 * Client-connecting adapter for VS Code extension integration.
 * Extension connects via WebSocket with deviceType='vscode'.
 * Supports file editing, terminal commands, diagnostics, workspace info.
 *
 * Protocol messages (server → client):
 *   vscode:openFile       { path, line?, column? }
 *   vscode:editFile       { path, edits: [{range, newText}] }
 *   vscode:readFile       { path }
 *   vscode:listFiles      { pattern }
 *   vscode:runTerminal    { command }
 *   vscode:diagnostics    {}
 *   vscode:workspace      {}
 *   vscode:search         { query, includePattern?, excludePattern? }
 *   vscode:gitStatus      {}
 *
 * Protocol messages (client → server):
 *   vscode:result         { requestId, data }
 *   vscode:fileChanged    { path, type: 'created'|'changed'|'deleted' }
 */

import type { DeviceAdapter, TaskExecution, ConnectionConfig, DeviceCapabilities } from './device-adapter.js';
import { dispatchTaskToDevice, cancelDeviceTask } from '../agent-bridge.js';

export class VscodeAdapter implements DeviceAdapter {
  readonly type = 'vscode' as const;
  readonly category = 'browser' as const;
  readonly protocol = 'websocket' as const;
  readonly maxConcurrency = 1;

  defaultCapabilities(): Partial<DeviceCapabilities> {
    return { editor: true, filesystem: true, git: true, shell: true };
  }

  canExecute(_task: TaskExecution, capabilities: Partial<DeviceCapabilities>): boolean {
    return capabilities.editor === true || capabilities.filesystem === true;
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
    return { ok: true, message: 'VS Code devices connect via the AskAlf VS Code extension' };
  }

  async cleanup(): Promise<void> {}
}

export const VSCODE_MESSAGE_TYPES = [
  'vscode:openFile',
  'vscode:editFile',
  'vscode:readFile',
  'vscode:listFiles',
  'vscode:runTerminal',
  'vscode:diagnostics',
  'vscode:workspace',
  'vscode:search',
  'vscode:gitStatus',
  'vscode:result',
  'vscode:fileChanged',
] as const;
