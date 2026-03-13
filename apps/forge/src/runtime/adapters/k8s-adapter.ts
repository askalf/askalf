/**
 * Kubernetes Adapter
 *
 * Server-managed adapter that executes tasks as Kubernetes Jobs.
 * Uses kubectl CLI (avoids @kubernetes/client-node dependency).
 * Jobs are created with task input, monitored for completion, logs extracted.
 */

import { spawn } from 'node:child_process';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DeviceAdapter, TaskExecution, ConnectionConfig, DeviceCapabilities } from './device-adapter.js';
import { query } from '../../database.js';

const EXECUTION_TIMEOUT_MS = 600_000; // 10 min for k8s jobs
const POLL_INTERVAL_MS = 5_000;
const activeJobs = new Map<string, string>(); // executionId → jobName

export class K8sAdapter implements DeviceAdapter {
  readonly type = 'k8s' as const;
  readonly category = 'compute' as const;
  readonly protocol = 'server-managed' as const;
  readonly maxConcurrency = 10;

  defaultCapabilities(): Partial<DeviceCapabilities> {
    return { shell: true, filesystem: true, docker: true, node: true };
  }

  canExecute(): boolean {
    return true;
  }

  async dispatch(deviceId: string, task: TaskExecution, config: ConnectionConfig): Promise<boolean> {
    const namespace = config.namespace || 'default';
    const image = config.image || 'node:22-alpine';
    const serviceAccount = config.serviceAccount || '';
    const jobName = `askalf-${task.executionId.toLowerCase().substring(0, 40)}`;

    try {
      const jobManifest = {
        apiVersion: 'batch/v1',
        kind: 'Job',
        metadata: {
          name: jobName,
          namespace,
          labels: {
            'askalf.io/execution': task.executionId,
            'askalf.io/agent': task.agentId,
            'askalf.io/device': deviceId,
          },
        },
        spec: {
          backoffLimit: 0,
          activeDeadlineSeconds: Math.floor(EXECUTION_TIMEOUT_MS / 1000),
          ttlSecondsAfterFinished: 300,
          template: {
            spec: {
              ...(serviceAccount ? { serviceAccountName: serviceAccount } : {}),
              containers: [{
                name: 'task',
                image,
                command: ['sh', '-c', task.input],
                env: [
                  { name: 'ASKALF_EXECUTION_ID', value: task.executionId },
                  { name: 'ASKALF_AGENT_ID', value: task.agentId },
                ],
                resources: config.resourceLimits ? {
                  limits: config.resourceLimits,
                } : {
                  limits: { memory: '512Mi', cpu: '500m' },
                },
              }],
              restartPolicy: 'Never',
            },
          },
        },
      };

      const kubeconfigFile = await this.writeKubeconfig(config, task.executionId);
      const kubeconfigArgs = kubeconfigFile ? ['--kubeconfig', kubeconfigFile] : [];

      // Apply the job
      const manifestPath = join(tmpdir(), `askalf-job-${task.executionId}.json`);
      await writeFile(manifestPath, JSON.stringify(jobManifest));

      await this.kubectl([...kubeconfigArgs, 'apply', '-f', manifestPath]);
      await unlink(manifestPath).catch(() => {});

      activeJobs.set(task.executionId, jobName);

      // Monitor completion
      void this.waitForJob(jobName, namespace, kubeconfigArgs, task, kubeconfigFile).catch((err) => {
        console.error(`[K8sAdapter] Error monitoring job ${jobName}:`, err);
      });

      return true;
    } catch (err) {
      console.error(`[K8sAdapter] Failed to create job for ${task.executionId}:`, err);
      return false;
    }
  }

  private async waitForJob(
    jobName: string,
    namespace: string,
    kubeconfigArgs: string[],
    task: TaskExecution,
    kubeconfigFile: string | null,
  ): Promise<void> {
    const startTime = Date.now();

    try {
      while (Date.now() - startTime < EXECUTION_TIMEOUT_MS) {
        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));

        const statusJson = await this.kubectl([
          ...kubeconfigArgs, 'get', 'job', jobName, '-n', namespace, '-o', 'json',
        ]);

        const status = JSON.parse(statusJson);
        const conditions = status.status?.conditions || [];
        const complete = conditions.find((c: Record<string, string>) => c['type'] === 'Complete' && c['status'] === 'True');
        const failed = conditions.find((c: Record<string, string>) => c['type'] === 'Failed' && c['status'] === 'True');

        if (complete || failed) {
          // Get pod logs
          const logs = await this.kubectl([
            ...kubeconfigArgs, 'logs', `job/${jobName}`, '-n', namespace,
          ]).catch(() => '');

          activeJobs.delete(task.executionId);

          if (complete) {
            await this.recordResult(task.executionId, 'completed', logs);
          } else {
            const reason = failed?.['reason'] || 'Job failed';
            await this.recordResult(task.executionId, 'failed', logs, reason);
          }
          return;
        }
      }

      // Timeout
      activeJobs.delete(task.executionId);
      await this.kubectl([...kubeconfigArgs, 'delete', 'job', jobName, '-n', namespace]).catch(() => {});
      await this.recordResult(task.executionId, 'failed', '', 'Kubernetes job timed out');
    } finally {
      if (kubeconfigFile) {
        await unlink(kubeconfigFile).catch(() => {});
      }
    }
  }

  private async writeKubeconfig(config: ConnectionConfig, executionId: string): Promise<string | null> {
    if (!config.kubeconfig) return null;
    const path = join(tmpdir(), `askalf-kubeconfig-${executionId}`);
    await writeFile(path, config.kubeconfig, { mode: 0o600 });
    return path;
  }

  private kubectl(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn('kubectl', args, { timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      proc.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      proc.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
      proc.on('close', (code) => {
        if (code === 0) resolve(stdout);
        else reject(new Error(`kubectl failed (${code}): ${stderr || stdout}`));
      });
      proc.on('error', reject);
    });
  }

  private async recordResult(executionId: string, status: string, output: string, error?: string): Promise<void> {
    await query(
      `UPDATE forge_executions SET status = $1, output = $2, error = $3, completed_at = NOW() WHERE id = $4`,
      [status, output, error ?? null, executionId],
    );
  }

  async cancel(_deviceId: string, executionId: string, config: ConnectionConfig): Promise<boolean> {
    const jobName = activeJobs.get(executionId);
    if (!jobName) return false;

    const namespace = config.namespace || 'default';
    await this.kubectl(['delete', 'job', jobName, '-n', namespace]).catch(() => {});
    activeJobs.delete(executionId);
    return true;
  }

  async testConnection(config: ConnectionConfig): Promise<{ ok: boolean; message: string }> {
    try {
      const kubeconfigFile = config.kubeconfig
        ? await this.writeKubeconfig(config, 'test')
        : null;
      const args = kubeconfigFile
        ? ['--kubeconfig', kubeconfigFile, 'cluster-info']
        : ['cluster-info'];

      const output = await this.kubectl(args);
      if (kubeconfigFile) await unlink(kubeconfigFile).catch(() => {});
      return { ok: true, message: output.split('\n')[0] || 'Kubernetes cluster connected' };
    } catch (err) {
      return { ok: false, message: `K8s error: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  async cleanup(deviceId: string, config: ConnectionConfig): Promise<void> {
    const namespace = config.namespace || 'default';
    await this.kubectl([
      'delete', 'jobs', '-n', namespace, '-l', `askalf.io/device=${deviceId}`,
    ]).catch(() => {});
  }
}
