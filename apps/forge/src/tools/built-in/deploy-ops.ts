/**
 * Built-in Tool: Deploy Operations
 * Provides deployment capabilities for agents: container status, logs, restart, build.
 * Critical actions (restart, build) require human approval via intervention gating.
 */

import http from 'node:http';
import crypto from 'crypto';
import { getPool as getSharedPool } from '../../database.js';
import type pg from 'pg';
import type { ToolResult } from '../registry.js';
import { checkServiceHealth } from '../../utils/health-check.js';

// ============================================
// Types
// ============================================

export interface DeployOpsInput {
  action: 'status' | 'logs' | 'restart' | 'build';
  service?: string;
  tail?: number;
  intervention_id?: string;
  agent_name?: string;
  agent_id?: string;
}

// ============================================
// Constants
// ============================================

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_SIZE = 512_000;

// Docker connection — uses DOCKER_HOST (tcp://host:port) when behind socket proxy, falls back to Unix socket
const DOCKER_CONN: Record<string, unknown> = (() => {
  const h = process.env['DOCKER_HOST'];
  if (h?.startsWith('tcp://')) {
    const u = new URL(h.replace('tcp://', 'http://'));
    return { hostname: u.hostname, port: Number(u.port) || 2375 };
  }
  return { socketPath: '/var/run/docker.sock' };
})();

const SERVICE_MAP: Record<string, string> = {
  api: 'sprayberry-labs-api',
  dashboard: 'sprayberry-labs-dashboard',
  forge: 'sprayberry-labs-forge',
  worker: 'sprayberry-labs-worker',
  scheduler: 'sprayberry-labs-scheduler',
  nginx: 'sprayberry-labs-nginx',
  mcp: 'sprayberry-labs-mcp',
  self: 'sprayberry-labs-self',
};

const PROTECTED_SERVICES = ['postgres', 'redis', 'pgbouncer', 'cloudflared'];

const HEALTH_ENDPOINTS: Record<string, string> = {
  dashboard: 'http://sprayberry-labs-dashboard:3001/health',
  forge: 'http://sprayberry-labs-forge:3005/health',
  'mcp-tools': 'http://sprayberry-labs-mcp-tools:3010/health',
  mcp: 'http://sprayberry-labs-mcp-tools:3010/health',
  nginx: 'http://sprayberry-labs-nginx:80/nginx-health',
};

const POST_DEPLOY_WAIT_MS = 10_000;
const POST_DEPLOY_RETRIES = 3;
const POST_DEPLOY_RETRY_DELAY_MS = 5_000;

// ============================================
// Helpers
// ============================================

function dockerRequest(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ statusCode: number; data: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Docker API request timed out')), REQUEST_TIMEOUT_MS);

    const options: http.RequestOptions = {
      ...DOCKER_CONN,
      path,
      method,
      headers: { 'Content-Type': 'application/json' },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => {
        data += chunk.toString();
        if (data.length > MAX_RESPONSE_SIZE) res.destroy();
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

    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function getPool(): pg.Pool {
  return getSharedPool();
}

function generateId(): string {
  const timestamp = Date.now().toString(36).padStart(10, '0');
  const random = crypto.randomBytes(10).toString('hex').slice(0, 16);
  return (timestamp + random).toUpperCase();
}

function resolveService(name: string): string | null {
  return SERVICE_MAP[name.toLowerCase()] ?? null;
}

// ============================================
// Implementation
// ============================================

export async function deployOps(input: DeployOpsInput): Promise<ToolResult> {
  const startTime = performance.now();

  try {
    switch (input.action) {
      case 'status': {
        const res = await dockerRequest('GET', '/v1.44/containers/json?all=true');
        const containers = JSON.parse(res.data) as Array<Record<string, unknown>>;
        const prodContainers = containers
          .filter((c) => {
            const name = ((c['Names'] as string[]) ?? [])[0]?.replace(/^\//, '') ?? '';
            return name.startsWith('sprayberry-labs-');
          })
          .map((c) => ({
            name: ((c['Names'] as string[]) ?? [])[0]?.replace(/^\//, ''),
            image: c['Image'],
            state: c['State'],
            status: c['Status'],
            health: (c['Status'] as string)?.match(/\((.*?)\)/)?.[1] ?? 'unknown',
          }));
        return {
          output: { containers: prodContainers, count: prodContainers.length },
          durationMs: Math.round(performance.now() - startTime),
        };
      }

      case 'logs': {
        if (!input.service) {
          return { output: null, error: 'service is required for logs', durationMs: 0 };
        }
        const containerName = resolveService(input.service);
        if (!containerName) {
          return {
            output: null,
            error: `Unknown service: ${input.service}. Available: ${Object.keys(SERVICE_MAP).join(', ')}`,
            durationMs: 0,
          };
        }
        const tail = Math.min(input.tail ?? 100, 200);
        const res = await dockerRequest(
          'GET',
          `/v1.44/containers/${containerName}/logs?stdout=true&stderr=true&tail=${tail}&timestamps=true`,
        );
        if (res.statusCode === 404) {
          return { output: null, error: `Container not found: ${containerName}`, durationMs: Math.round(performance.now() - startTime) };
        }
        const cleanLogs = res.data.replace(/[\x00-\x08]/g, '').trim();
        return {
          output: { service: input.service, container: containerName, tail, logs: cleanLogs },
          durationMs: Math.round(performance.now() - startTime),
        };
      }

      case 'restart': {
        if (!input.service) {
          return { output: null, error: 'service is required for restart', durationMs: 0 };
        }
        if (!input.agent_name) {
          return { output: null, error: 'agent_name is required for restart', durationMs: 0 };
        }

        // Block protected services
        if (PROTECTED_SERVICES.includes(input.service.toLowerCase())) {
          return {
            output: null,
            error: `Cannot restart protected service: ${input.service}. Protected: ${PROTECTED_SERVICES.join(', ')}`,
            durationMs: 0,
          };
        }

        const containerName = resolveService(input.service);
        if (!containerName) {
          return {
            output: null,
            error: `Unknown service: ${input.service}. Available: ${Object.keys(SERVICE_MAP).join(', ')}`,
            durationMs: 0,
          };
        }

        const p = getPool();

        // If no intervention_id — create one and return pending
        if (!input.intervention_id) {
          const id = generateId();
          await p.query(
            `INSERT INTO agent_interventions (id, agent_id, agent_name, agent_type, type, title, description, proposed_action, status)
             VALUES ($1, $2, $3, 'ops', 'approval', $4, $5, $6, 'pending')`,
            [
              id,
              input.agent_id ?? 'unknown',
              input.agent_name,
              `Deploy: Restart ${input.service}`,
              `Agent ${input.agent_name} requests restarting container ${containerName}.`,
              `docker restart ${containerName}`,
            ],
          );
          return {
            output: {
              approved: false,
              intervention_id: id,
              service: input.service,
              message: 'Restart request created. Awaiting human approval via intervention.',
            },
            durationMs: Math.round(performance.now() - startTime),
          };
        }

        // With intervention_id — verify approval
        const check = await p.query(
          `SELECT status FROM agent_interventions WHERE id = $1`,
          [input.intervention_id],
        );
        if (check.rows.length === 0) {
          return { output: null, error: `Intervention not found: ${input.intervention_id}`, durationMs: Math.round(performance.now() - startTime) };
        }
        if (check.rows[0].status !== 'approved') {
          return {
            output: { approved: false, status: check.rows[0].status, message: 'Intervention not yet approved' },
            durationMs: Math.round(performance.now() - startTime),
          };
        }

        // Approved — execute restart
        const restartRes = await dockerRequest('POST', `/v1.44/containers/${containerName}/restart?t=10`);
        const restartSuccess = restartRes.statusCode === 204;

        // Post-deploy health check: wait, then verify the service is healthy
        let healthResult: { healthy: boolean; latency?: number; error?: string; retries?: number } | undefined;
        const healthUrl = HEALTH_ENDPOINTS[input.service.toLowerCase()];

        if (restartSuccess && healthUrl) {
          // Wait for the container to start up before checking health
          await new Promise((r) => setTimeout(r, POST_DEPLOY_WAIT_MS));

          for (let attempt = 1; attempt <= POST_DEPLOY_RETRIES; attempt++) {
            const hc = await checkServiceHealth(input.service, healthUrl);
            if (hc.healthy) {
              healthResult = { healthy: true, latency: hc.latency, retries: attempt };
              break;
            }
            if (attempt < POST_DEPLOY_RETRIES) {
              await new Promise((r) => setTimeout(r, POST_DEPLOY_RETRY_DELAY_MS));
            } else {
              healthResult = { healthy: false, error: hc.error, latency: hc.latency, retries: attempt };
            }
          }
        }

        // Log deployment event and alert on health failure
        try {
          const deployStatus = !restartSuccess ? 'restart_failed' : healthResult?.healthy === false ? 'unhealthy' : 'healthy';
          // Log to agent_findings as deployment record
          await p.query(
            `INSERT INTO agent_findings (id, agent_id, agent_name, finding, severity, category, created_at)
             VALUES ($1, $2, $3, $4, $5, 'deployment', NOW())`,
            [
              generateId(),
              input.agent_id ?? 'unknown',
              input.agent_name ?? 'unknown',
              `Deploy ${input.service}: restart ${deployStatus}. Container: ${containerName}. ` +
                (healthResult ? `Health: ${healthResult.healthy ? 'OK' : 'FAILED'} (${healthResult.retries} attempts, ${healthResult.latency ?? '?'}ms). ${healthResult.error ?? ''}` : 'No health endpoint.'),
              deployStatus === 'healthy' ? 'info' : 'warning',
            ],
          );
        } catch {
          // Non-critical: don't fail the restart if logging fails
        }

        return {
          output: {
            success: restartSuccess,
            service: input.service,
            container: containerName,
            statusCode: restartRes.statusCode,
            intervention_id: input.intervention_id,
            healthCheck: healthResult ?? (restartSuccess ? { healthy: null, message: 'No health endpoint configured for this service' } : undefined),
          },
          durationMs: Math.round(performance.now() - startTime),
        };
      }

      case 'build': {
        if (!input.service) {
          return { output: null, error: 'service is required for build', durationMs: 0 };
        }
        if (!input.agent_name) {
          return { output: null, error: 'agent_name is required for build', durationMs: 0 };
        }

        const p = getPool();

        // Always gate behind intervention
        if (!input.intervention_id) {
          const id = generateId();
          await p.query(
            `INSERT INTO agent_interventions (id, agent_id, agent_name, agent_type, type, title, description, proposed_action, status)
             VALUES ($1, $2, $3, 'ops', 'approval', $4, $5, $6, 'pending')`,
            [
              id,
              input.agent_id ?? 'unknown',
              input.agent_name,
              `Deploy: Build ${input.service}`,
              `Agent ${input.agent_name} requests building Docker image for ${input.service}.`,
              `docker-compose build ${input.service}`,
            ],
          );
          return {
            output: {
              approved: false,
              intervention_id: id,
              service: input.service,
              message: 'Build request created. Awaiting human approval via intervention.',
            },
            durationMs: Math.round(performance.now() - startTime),
          };
        }

        // Verify approval
        const check = await p.query(
          `SELECT status FROM agent_interventions WHERE id = $1`,
          [input.intervention_id],
        );
        if (check.rows.length === 0) {
          return { output: null, error: `Intervention not found: ${input.intervention_id}`, durationMs: Math.round(performance.now() - startTime) };
        }
        if (check.rows[0].status !== 'approved') {
          return {
            output: { approved: false, status: check.rows[0].status, message: 'Intervention not yet approved' },
            durationMs: Math.round(performance.now() - startTime),
          };
        }

        // Build is a long operation — return acknowledgement
        // The actual build should be triggered by the human operator
        return {
          output: {
            approved: true,
            service: input.service,
            intervention_id: input.intervention_id,
            message: `Build approved for ${input.service}. The human operator should execute the build command.`,
          },
          durationMs: Math.round(performance.now() - startTime),
        };
      }

      default:
        return {
          output: null,
          error: `Unknown action: ${input.action}. Supported: status, logs, restart, build`,
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
