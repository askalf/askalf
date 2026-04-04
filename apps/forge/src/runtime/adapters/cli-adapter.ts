/**
 * CLI Agent Adapter
 *
 * Wraps the existing WebSocket-based CLI agent execution.
 * Client runs `askalf-agent connect` and connects via WS.
 * Tasks are dispatched through the agent-bridge WebSocket protocol.
 */

import type { DeviceAdapter, TaskExecution, ConnectionConfig, DeviceCapabilities } from './device-adapter.js';
import { dispatchTaskToDevice, cancelDeviceTask } from '../agent-bridge.js';

export class CliAdapter implements DeviceAdapter {
  readonly type = 'cli' as const;
  readonly category = 'compute' as const;
  readonly protocol = 'websocket' as const;
  readonly maxConcurrency = 1;

  defaultCapabilities(): Partial<DeviceCapabilities> {
    return { shell: true, filesystem: true, git: true, node: true, python: true };
  }

  canExecute(task: TaskExecution, capabilities: Partial<DeviceCapabilities>): boolean {
    return capabilities.shell === true;
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
    return { ok: true, message: 'CLI devices connect via WebSocket — test by running askalf-agent connect' };
  }

  async cleanup(): Promise<void> {
    // WebSocket cleanup handled by agent-bridge
  }
}
