/**
 * Docker Host Adapter
 *
 * Server-managed adapter that executes tasks inside Docker containers.
 * Uses the Docker Engine API directly (HTTP over Unix socket or TCP).
 * No client app needed — Forge manages containers directly.
 */

import http from 'node:http';
import type { DeviceAdapter, TaskExecution, ConnectionConfig, DeviceCapabilities } from './device-adapter.js';
import { query } from '../../database.js';

const DEFAULT_IMAGE = 'node:22-alpine';
const DEFAULT_MEMORY = '512m';
const DEFAULT_CPU = '1.0';
const EXECUTION_TIMEOUT_MS = 300_000; // 5 minutes

/** Track running containers for cancellation */
const runningContainers = new Map<string, string>(); // executionId → containerId

export class DockerAdapter implements DeviceAdapter {
  readonly type = 'docker' as const;
  readonly category = 'compute' as const;
  readonly protocol = 'server-managed' as const;
  readonly maxConcurrency = 5;

  defaultCapabilities(): Partial<DeviceCapabilities> {
    return { shell: true, filesystem: true, docker: true, node: true };
  }

  canExecute(_task: TaskExecution, capabilities: Partial<DeviceCapabilities>): boolean {
    return capabilities.docker === true || capabilities.shell === true;
  }

  async dispatch(deviceId: string, task: TaskExecution, config: ConnectionConfig): Promise<boolean> {
    const image = config.defaultImage || DEFAULT_IMAGE;
    const memoryLimit = config.memoryLimit || DEFAULT_MEMORY;
    const socketPath = config.socketPath || '/var/run/docker.sock';

    try {
      // Create container
      const createBody = {
        Image: image,
        Cmd: ['sh', '-c', task.input],
        HostConfig: {
          Memory: parseMemory(memoryLimit),
          NanoCpus: parseCpu(config.cpuLimit || DEFAULT_CPU),
          AutoRemove: false,
        },
        Env: [
          `ASKALF_EXECUTION_ID=${task.executionId}`,
          `ASKALF_AGENT_ID=${task.agentId}`,
          `ASKALF_AGENT_NAME=${task.agentName}`,
        ],
        Labels: {
          'askalf.execution': task.executionId,
          'askalf.agent': task.agentId,
          'askalf.device': deviceId,
        },
      };

      const containerId = await dockerApiPost(socketPath, '/containers/create', createBody);
      if (!containerId) return false;

      runningContainers.set(task.executionId, containerId);

      // Start container
      await dockerApiPostRaw(socketPath, `/containers/${containerId}/start`, null);

      // Wait for completion (non-blocking)
      void this.waitForCompletion(socketPath, containerId, task, deviceId).catch((err) => {
        console.error(`[DockerAdapter] Error waiting for container ${containerId}:`, err);
      });

      return true;
    } catch (err) {
      console.error(`[DockerAdapter] Failed to dispatch task ${task.executionId}:`, err);
      return false;
    }
  }

  private async waitForCompletion(
    socketPath: string,
    containerId: string,
    task: TaskExecution,
    deviceId: string,
  ): Promise<void> {
    const timeout = setTimeout(async () => {
      // Kill container on timeout
      await dockerApiPostRaw(socketPath, `/containers/${containerId}/kill`, null).catch(() => {});
      await this.recordResult(task.executionId, 'failed', '', 'Execution timed out');
    }, EXECUTION_TIMEOUT_MS);

    try {
      // Wait for container to stop
      const waitResult = await dockerApiPostRaw(socketPath, `/containers/${containerId}/wait`, null);
      clearTimeout(timeout);

      const exitCode = waitResult?.['StatusCode'] as number ?? -1;

      // Get logs
      const logs = await dockerApiGet(socketPath, `/containers/${containerId}/logs?stdout=true&stderr=true`);

      // Clean up container
      await dockerApiDelete(socketPath, `/containers/${containerId}`).catch(() => {});
      runningContainers.delete(task.executionId);

      if (exitCode === 0) {
        await this.recordResult(task.executionId, 'completed', logs);
      } else {
        await this.recordResult(task.executionId, 'failed', logs, `Exit code: ${exitCode}`);
      }
    } catch (err) {
      clearTimeout(timeout);
      runningContainers.delete(task.executionId);
      await this.recordResult(task.executionId, 'failed', '', err instanceof Error ? err.message : String(err));
    }
  }

  private async recordResult(executionId: string, status: string, output: string, error?: string): Promise<void> {
    await query(
      `UPDATE forge_executions SET status = $1, output = $2, error = $3, completed_at = NOW() WHERE id = $4`,
      [status, output, error ?? null, executionId],
    );
  }

  async cancel(_deviceId: string, executionId: string, config: ConnectionConfig): Promise<boolean> {
    const containerId = runningContainers.get(executionId);
    if (!containerId) return false;

    const socketPath = config.socketPath || '/var/run/docker.sock';
    await dockerApiPostRaw(socketPath, `/containers/${containerId}/kill`, null).catch(() => {});
    runningContainers.delete(executionId);
    return true;
  }

  async testConnection(config: ConnectionConfig): Promise<{ ok: boolean; message: string }> {
    const socketPath = config.socketPath || '/var/run/docker.sock';
    try {
      const info = await dockerApiGet(socketPath, '/info');
      const parsed = JSON.parse(info);
      return { ok: true, message: `Docker ${parsed.ServerVersion || 'connected'} — ${parsed.Containers || 0} containers` };
    } catch (err) {
      return { ok: false, message: `Cannot connect to Docker: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  async cleanup(deviceId: string, config: ConnectionConfig): Promise<void> {
    // Kill any containers labeled with this device
    const socketPath = config.socketPath || '/var/run/docker.sock';
    try {
      const containers = await dockerApiGet(socketPath, `/containers/json?filters={"label":["askalf.device=${deviceId}"]}`);
      const parsed = JSON.parse(containers) as Array<{ Id: string }>;
      for (const c of parsed) {
        await dockerApiPostRaw(socketPath, `/containers/${c.Id}/kill`, null).catch(() => {});
        await dockerApiDelete(socketPath, `/containers/${c.Id}`).catch(() => {});
      }
    } catch {
      // Best effort
    }
  }
}

// Docker Engine API helpers (HTTP over Unix socket)
function dockerApiRequest(socketPath: string, method: string, path: string, body?: unknown): Promise<string> {
  return new Promise((resolve, reject) => {
    const options: http.RequestOptions = {
      socketPath,
      path,
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 400) {
          resolve(data);
        } else {
          reject(new Error(`Docker API ${method} ${path}: ${res.statusCode} ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(EXECUTION_TIMEOUT_MS + 10_000, () => {
      req.destroy(new Error('Docker API request timeout'));
    });

    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function dockerApiPost(socketPath: string, path: string, body: unknown): Promise<string | null> {
  const result = await dockerApiRequest(socketPath, 'POST', path, body);
  try {
    const parsed = JSON.parse(result);
    return parsed.Id || null;
  } catch {
    return null;
  }
}

async function dockerApiPostRaw(socketPath: string, path: string, body: unknown): Promise<Record<string, unknown> | null> {
  const result = await dockerApiRequest(socketPath, 'POST', path, body);
  try {
    return JSON.parse(result);
  } catch {
    return null;
  }
}

async function dockerApiGet(socketPath: string, path: string): Promise<string> {
  return dockerApiRequest(socketPath, 'GET', path);
}

async function dockerApiDelete(socketPath: string, path: string): Promise<void> {
  await dockerApiRequest(socketPath, 'DELETE', path);
}

function parseMemory(mem: string): number {
  const match = mem.match(/^(\d+)([kmg]?)$/i);
  if (!match) return 512 * 1024 * 1024;
  const val = parseInt(match[1]!);
  const unit = (match[2] || 'm').toLowerCase();
  if (unit === 'k') return val * 1024;
  if (unit === 'm') return val * 1024 * 1024;
  if (unit === 'g') return val * 1024 * 1024 * 1024;
  return val;
}

function parseCpu(cpu: string): number {
  return Math.round(parseFloat(cpu) * 1e9);
}
