/**
 * Built-in Tool: Docker API
 * Accesses the Docker Engine API via Unix socket to manage containers.
 * Supports: list, inspect, logs, stats, exec.
 * Blocks destructive operations (remove, prune, kill).
 */

import http from 'node:http';
import type { ToolResult } from '../registry.js';

// ============================================
// Types
// ============================================

export interface DockerApiInput {
  action: 'list' | 'inspect' | 'logs' | 'stats' | 'exec' | 'top';
  container?: string | undefined;
  command?: string[] | undefined;
  tail?: number | undefined;
}

// ============================================
// Implementation
// ============================================

const DOCKER_SOCKET = '/var/run/docker.sock';
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_SIZE = 512_000;

/**
 * Make an HTTP request to the Docker Engine API via Unix socket.
 */
function dockerRequest(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ statusCode: number; data: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Docker API request timed out')), REQUEST_TIMEOUT_MS);

    const options: http.RequestOptions = {
      socketPath: DOCKER_SOCKET,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => {
        data += chunk.toString();
        if (data.length > MAX_RESPONSE_SIZE) {
          res.destroy();
        }
      });
      res.on('end', () => {
        clearTimeout(timer);
        resolve({ statusCode: res.statusCode ?? 500, data: data.slice(0, MAX_RESPONSE_SIZE) });
      });
    });

    req.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    if (body) {
      req.write(JSON.stringify(body));
    }

    req.end();
  });
}

/**
 * Interact with the Docker Engine API.
 *
 * Actions:
 * - `list`: List all containers (running and stopped)
 * - `inspect`: Get detailed info about a specific container
 * - `logs`: Get recent logs from a container (default: last 100 lines)
 * - `stats`: Get CPU/memory/network stats for a container
 * - `exec`: Execute a command inside a running container
 * - `top`: List processes running in a container
 */
export async function dockerApi(input: DockerApiInput): Promise<ToolResult> {
  const startTime = performance.now();

  try {
    switch (input.action) {
      case 'list': {
        const res = await dockerRequest('GET', '/v1.44/containers/json?all=true');
        const containers = JSON.parse(res.data) as Array<Record<string, unknown>>;
        const summary = containers.map((c) => ({
          id: (c['Id'] as string)?.slice(0, 12),
          name: ((c['Names'] as string[]) ?? ['/unknown'])[0]?.replace(/^\//, ''),
          image: c['Image'],
          state: c['State'],
          status: c['Status'],
          ports: c['Ports'],
        }));
        return {
          output: { containers: summary, count: summary.length },
          durationMs: Math.round(performance.now() - startTime),
        };
      }

      case 'inspect': {
        if (!input.container) {
          return { output: null, error: 'container name or ID is required for inspect', durationMs: 0 };
        }
        const res = await dockerRequest('GET', `/v1.44/containers/${input.container}/json`);
        if (res.statusCode === 404) {
          return { output: null, error: `Container not found: ${input.container}`, durationMs: Math.round(performance.now() - startTime) };
        }
        const info = JSON.parse(res.data) as Record<string, unknown>;
        return {
          output: {
            id: (info['Id'] as string)?.slice(0, 12),
            name: (info['Name'] as string)?.replace(/^\//, ''),
            state: info['State'],
            config: {
              image: (info['Config'] as Record<string, unknown>)?.['Image'],
              env: (info['Config'] as Record<string, unknown>)?.['Env'],
              cmd: (info['Config'] as Record<string, unknown>)?.['Cmd'],
            },
            networkSettings: info['NetworkSettings'],
            mounts: info['Mounts'],
            restartCount: (info['RestartCount'] as number) ?? 0,
            created: info['Created'],
          },
          durationMs: Math.round(performance.now() - startTime),
        };
      }

      case 'logs': {
        if (!input.container) {
          return { output: null, error: 'container name or ID is required for logs', durationMs: 0 };
        }
        const tail = input.tail ?? 100;
        const res = await dockerRequest(
          'GET',
          `/v1.44/containers/${input.container}/logs?stdout=true&stderr=true&tail=${tail}&timestamps=true`,
        );
        if (res.statusCode === 404) {
          return { output: null, error: `Container not found: ${input.container}`, durationMs: Math.round(performance.now() - startTime) };
        }
        // Docker logs stream includes 8-byte header per line; strip them
        const cleanLogs = res.data.replace(/[\x00-\x08]/g, '').trim();
        return {
          output: { container: input.container, tail, logs: cleanLogs },
          durationMs: Math.round(performance.now() - startTime),
        };
      }

      case 'stats': {
        if (!input.container) {
          return { output: null, error: 'container name or ID is required for stats', durationMs: 0 };
        }
        const res = await dockerRequest(
          'GET',
          `/v1.44/containers/${input.container}/stats?stream=false`,
        );
        if (res.statusCode === 404) {
          return { output: null, error: `Container not found: ${input.container}`, durationMs: Math.round(performance.now() - startTime) };
        }
        const stats = JSON.parse(res.data) as Record<string, unknown>;
        const memUsage = stats['memory_stats'] as Record<string, unknown> | undefined;
        const cpuStats = stats['cpu_stats'] as Record<string, unknown> | undefined;
        return {
          output: {
            container: input.container,
            memory: {
              usage: memUsage?.['usage'],
              limit: memUsage?.['limit'],
              usagePercent: memUsage?.['usage'] && memUsage?.['limit']
                ? ((memUsage['usage'] as number) / (memUsage['limit'] as number) * 100).toFixed(2) + '%'
                : null,
            },
            cpu: {
              totalUsage: (cpuStats?.['cpu_usage'] as Record<string, unknown>)?.['total_usage'],
              systemUsage: cpuStats?.['system_cpu_usage'],
              onlineCpus: cpuStats?.['online_cpus'],
            },
            network: stats['networks'],
            pids: (stats['pids_stats'] as Record<string, unknown>)?.['current'],
          },
          durationMs: Math.round(performance.now() - startTime),
        };
      }

      case 'exec': {
        if (!input.container) {
          return { output: null, error: 'container name or ID is required for exec', durationMs: 0 };
        }
        if (!input.command || input.command.length === 0) {
          return { output: null, error: 'command array is required for exec', durationMs: 0 };
        }

        // Block dangerous commands
        const cmdStr = input.command.join(' ').toLowerCase();
        const blocked = ['rm -rf /', 'mkfs', 'dd if=/dev', 'shutdown', 'reboot', 'halt'];
        for (const b of blocked) {
          if (cmdStr.includes(b)) {
            return { output: null, error: `Blocked: dangerous command pattern '${b}'`, durationMs: 0 };
          }
        }

        // Step 1: Create exec instance
        const createRes = await dockerRequest(
          'POST',
          `/v1.44/containers/${input.container}/exec`,
          {
            AttachStdout: true,
            AttachStderr: true,
            Cmd: input.command,
          },
        );

        if (createRes.statusCode !== 201) {
          return {
            output: null,
            error: `Failed to create exec: ${createRes.data}`,
            durationMs: Math.round(performance.now() - startTime),
          };
        }

        const execId = (JSON.parse(createRes.data) as { Id: string }).Id;

        // Step 2: Start exec and capture output
        const startRes = await dockerRequest(
          'POST',
          `/v1.44/exec/${execId}/start`,
          { Detach: false, Tty: false },
        );

        // Clean docker stream headers
        const output = startRes.data.replace(/[\x00-\x08]/g, '').trim();

        // Step 3: Inspect exec for exit code
        const inspectRes = await dockerRequest('GET', `/v1.44/exec/${execId}/json`);
        let exitCode = -1;
        try {
          exitCode = (JSON.parse(inspectRes.data) as { ExitCode: number }).ExitCode;
        } catch { /* ignore */ }

        return {
          output: {
            container: input.container,
            command: input.command,
            exitCode,
            output,
          },
          durationMs: Math.round(performance.now() - startTime),
        };
      }

      case 'top': {
        if (!input.container) {
          return { output: null, error: 'container name or ID is required for top', durationMs: 0 };
        }
        const res = await dockerRequest('GET', `/v1.44/containers/${input.container}/top`);
        if (res.statusCode === 404) {
          return { output: null, error: `Container not found: ${input.container}`, durationMs: Math.round(performance.now() - startTime) };
        }
        return {
          output: JSON.parse(res.data),
          durationMs: Math.round(performance.now() - startTime),
        };
      }

      default:
        return {
          output: null,
          error: `Unknown action: ${input.action}. Supported: list, inspect, logs, stats, exec, top`,
          durationMs: Math.round(performance.now() - startTime),
        };
    }
  } catch (err) {
    return {
      output: null,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Math.round(performance.now() - startTime),
    };
  }
}
