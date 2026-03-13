/**
 * SSH Remote Adapter
 *
 * Server-managed adapter that executes tasks on remote machines via SSH.
 * Uses Node's child_process to spawn ssh commands (avoids ssh2 dependency).
 * Credentials resolved from connection_config.
 */

import { spawn } from 'node:child_process';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DeviceAdapter, TaskExecution, ConnectionConfig, DeviceCapabilities } from './device-adapter.js';
import { query } from '../../database.js';

const EXECUTION_TIMEOUT_MS = 300_000;
const activeProcesses = new Map<string, ReturnType<typeof spawn>>();

export class SshAdapter implements DeviceAdapter {
  readonly type = 'ssh' as const;
  readonly category = 'compute' as const;
  readonly protocol = 'server-managed' as const;
  readonly maxConcurrency = 3;

  defaultCapabilities(): Partial<DeviceCapabilities> {
    return { shell: true, filesystem: true, git: true };
  }

  canExecute(_task: TaskExecution, capabilities: Partial<DeviceCapabilities>): boolean {
    return capabilities.shell === true;
  }

  async dispatch(deviceId: string, task: TaskExecution, config: ConnectionConfig): Promise<boolean> {
    const host = config.host;
    const port = config.port || 22;
    const username = config.username || 'root';
    const privateKey = config.privateKey;

    if (!host) {
      console.error('[SshAdapter] Missing host in connection config');
      return false;
    }

    void this.executeRemote(deviceId, task, host, port, username, privateKey).catch((err) => {
      console.error(`[SshAdapter] Execution error:`, err);
    });

    return true;
  }

  private async executeRemote(
    deviceId: string,
    task: TaskExecution,
    host: string,
    port: number,
    username: string,
    privateKey?: string,
  ): Promise<void> {
    let keyFile: string | null = null;

    try {
      const sshArgs = [
        '-o', 'StrictHostKeyChecking=no',
        '-o', 'ConnectTimeout=10',
        '-o', 'BatchMode=yes',
        '-p', String(port),
      ];

      if (privateKey) {
        keyFile = join(tmpdir(), `askalf-ssh-${task.executionId}.key`);
        await writeFile(keyFile, privateKey, { mode: 0o600 });
        sshArgs.push('-i', keyFile);
      }

      sshArgs.push(`${username}@${host}`);
      sshArgs.push(task.input);

      const proc = spawn('ssh', sshArgs, {
        timeout: EXECUTION_TIMEOUT_MS,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      activeProcesses.set(task.executionId, proc);

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      proc.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

      const exitCode = await new Promise<number>((resolve) => {
        proc.on('close', (code) => resolve(code ?? -1));
        proc.on('error', () => resolve(-1));
      });

      activeProcesses.delete(task.executionId);

      const output = stdout || stderr;
      if (exitCode === 0) {
        await this.recordResult(task.executionId, 'completed', output);
      } else {
        await this.recordResult(task.executionId, 'failed', output, `SSH exit code: ${exitCode}`);
      }
    } finally {
      if (keyFile) {
        await unlink(keyFile).catch(() => {});
      }
    }
  }

  private async recordResult(executionId: string, status: string, output: string, error?: string): Promise<void> {
    await query(
      `UPDATE forge_executions SET status = $1, output = $2, error = $3, completed_at = NOW() WHERE id = $4`,
      [status, output, error ?? null, executionId],
    );
  }

  async cancel(_deviceId: string, executionId: string): Promise<boolean> {
    const proc = activeProcesses.get(executionId);
    if (!proc) return false;
    proc.kill('SIGTERM');
    activeProcesses.delete(executionId);
    return true;
  }

  async testConnection(config: ConnectionConfig): Promise<{ ok: boolean; message: string }> {
    const host = config.host;
    if (!host) return { ok: false, message: 'No host configured' };

    return new Promise((resolve) => {
      const args = [
        '-o', 'StrictHostKeyChecking=no',
        '-o', 'ConnectTimeout=5',
        '-o', 'BatchMode=yes',
        '-p', String(config.port || 22),
        `${config.username || 'root'}@${host}`,
        'echo "askalf-ssh-ok" && uname -a',
      ];

      const proc = spawn('ssh', args, { timeout: 10_000, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '';
      proc.stdout?.on('data', (chunk: Buffer) => { output += chunk.toString(); });
      proc.stderr?.on('data', (chunk: Buffer) => { output += chunk.toString(); });

      proc.on('close', (code) => {
        if (code === 0 && output.includes('askalf-ssh-ok')) {
          const uname = output.split('\n').find(l => !l.includes('askalf-ssh-ok'))?.trim() || '';
          resolve({ ok: true, message: `Connected — ${uname}` });
        } else {
          resolve({ ok: false, message: `SSH failed (code ${code}): ${output.trim().substring(0, 200)}` });
        }
      });

      proc.on('error', (err) => {
        resolve({ ok: false, message: `SSH error: ${err.message}` });
      });
    });
  }

  async cleanup(): Promise<void> {
    // Kill any active SSH processes for this device
  }
}
