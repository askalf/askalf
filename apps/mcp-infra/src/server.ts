#!/usr/bin/env node

/**
 * MCP Infrastructure Server (port 3012)
 *
 * Exposes infrastructure tools via MCP protocol:
 * - docker_api: list, inspect, logs, stats, exec, top containers
 * - deploy_ops: status, logs, restart, build (with intervention gating)
 * - security_scan: npm_audit, dependency_check, file_permissions, env_leak_check, docker_security
 * - code_analysis: typecheck, dead_code, import_analysis, complexity, todo_scan
 *
 * Requires Docker socket mount (/var/run/docker.sock) and workspace mount (/workspace).
 */

import express from 'express';
import cors from 'cors';
import http from 'node:http';
import { exec } from 'child_process';
import { readdir, readFile, stat } from 'fs/promises';
import { join, extname, relative } from 'path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
  getSubstratePool,
  generateId,
  closeAll,
} from '@substrate/db';

const PORT = parseInt(process.env['PORT'] ?? '3012', 10);
const DOCKER_SOCKET = '/var/run/docker.sock';
const REPO_ROOT = process.env['REPO_ROOT'] ?? '/workspace';
const log = (msg: string) => console.log(`[mcp-infra] ${new Date().toISOString()} ${msg}`);

// ============================================
// Express + MCP setup
// ============================================

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'healthy', service: 'mcp-infra' });
});

const transports = new Map<string, SSEServerTransport>();

app.get('/sse', async (_req, res) => {
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Content-Type', 'text/event-stream');

  const transport = new SSEServerTransport('/message', res);
  const sessionId = (transport as unknown as { _sessionId: string })._sessionId;
  transports.set(sessionId, transport);

  const heartbeat = setInterval(() => {
    try { res.write(`event: heartbeat\ndata: {"ts":${Date.now()}}\n\n`); } catch { clearInterval(heartbeat); }
  }, 10000);

  _req.on('close', () => { clearInterval(heartbeat); transports.delete(sessionId); });

  try {
    const server = createMCPServer();
    await server.connect(transport);
    log(`Session ${sessionId} connected`);
  } catch {
    clearInterval(heartbeat);
    transports.delete(sessionId);
    res.end();
  }
});

app.post('/message', async (req, res) => {
  const sessionId = req.query['sessionId'] as string;
  if (!sessionId) { res.status(400).json({ error: 'Missing sessionId' }); return; }
  const transport = transports.get(sessionId);
  if (!transport) { res.status(404).json({ error: 'Session not found' }); return; }
  await transport.handlePostMessage(req, res);
});

// Streamable HTTP transport (stateless, per-request)
app.post('/mcp', async (req, res) => {
  try {
    const server = createMCPServer();
    const transport = new StreamableHTTPServerTransport({});
    res.on('close', () => { transport.close().catch(() => {}); server.close().catch(() => {}); });
    await server.connect(transport as Parameters<typeof server.connect>[0]);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    log(`Streamable HTTP error: ${error}`);
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/mcp', (_req, res) => { res.status(405).json({ error: 'Use POST for streamable HTTP' }); });
app.delete('/mcp', (_req, res) => { res.status(405).json({ error: 'Session cleanup not supported in stateless mode' }); });

// ============================================
// Docker Helpers
// ============================================

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_SIZE = 512_000;

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
      headers: { 'Content-Type': 'application/json' },
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => {
        data += chunk.toString();
        if (data.length > MAX_RESPONSE_SIZE) res.destroy();
      });
      res.on('end', () => { clearTimeout(timer); resolve({ statusCode: res.statusCode ?? 500, data: data.slice(0, MAX_RESPONSE_SIZE) }); });
    });
    req.on('error', (err) => { clearTimeout(timer); reject(err); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ============================================
// Shell / File Helpers
// ============================================

function run(cmd: string, cwd: string, timeout = 60_000): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    exec(cmd, { cwd, timeout, maxBuffer: 2_048_000 }, (error, stdout, stderr) => {
      resolve({ exitCode: error ? (error.code ?? 1) : 0, stdout: stdout.slice(0, 8_000), stderr: stderr.slice(0, 8_000) });
    });
  });
}

const CODE_EXTENSIONS = new Set(['.ts', '.js', '.tsx', '.jsx']);
const SCAN_EXTENSIONS = new Set(['.ts', '.js', '.json', '.yml', '.yaml', '.env', '.sh', '.conf']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.next', 'build', 'coverage']);

async function walkFiles(dir: string, extensions: Set<string>, maxFiles = 500): Promise<string[]> {
  const results: string[] = [];
  async function walk(current: string): Promise<void> {
    if (results.length >= maxFiles) return;
    let entries;
    try { entries = await readdir(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (results.length >= maxFiles) break;
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) await walk(fullPath);
      } else if (extensions.has(extname(entry.name).toLowerCase())) {
        results.push(fullPath);
      }
    }
  }
  await walk(dir);
  return results;
}

const SECRET_PATTERNS = [
  /(?:api[_-]?key|secret|password|token|passwd|pwd)\s*[:=]\s*['"][^'"]{8,}/gi,
  /(?:sk-|pk_|rk_)[a-zA-Z0-9]{20,}/g,
  /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/g,
  /(?:ghp_|gho_|ghs_|ghr_)[a-zA-Z0-9]{30,}/g,
  /xox[bpoa]-[a-zA-Z0-9-]+/g,
];

// ============================================
// Tool Definitions
// ============================================

const TOOLS = [
  {
    name: 'docker_api',
    description: 'Docker container management: list, inspect, logs, stats, exec, top. Blocks destructive ops and exec into prod containers.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        action: { type: 'string', enum: ['list', 'inspect', 'logs', 'stats', 'exec', 'top'] },
        container: { type: 'string', description: 'Container name or ID' },
        command: { type: 'array', items: { type: 'string' }, description: 'Command for exec action' },
        tail: { type: 'number', description: 'Number of log lines (default: 100)' },
      },
      required: ['action'],
    },
  },
  {
    name: 'deploy_ops',
    description: 'Deployment operations: status, logs, restart, build. Restart/build require human intervention approval.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        action: { type: 'string', enum: ['status', 'logs', 'restart', 'build'] },
        service: { type: 'string', description: 'Service name: api, dashboard, forge, worker, scheduler, nginx, mcp, self' },
        tail: { type: 'number' },
        intervention_id: { type: 'string', description: 'Approved intervention ID for restart/build' },
        agent_name: { type: 'string' },
        agent_id: { type: 'string' },
      },
      required: ['action'],
    },
  },
  {
    name: 'security_scan',
    description: 'Security scanning: npm_audit, dependency_check, file_permissions, env_leak_check, docker_security.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        action: { type: 'string', enum: ['npm_audit', 'dependency_check', 'file_permissions', 'env_leak_check', 'docker_security'] },
        package_dir: { type: 'string', description: 'Package directory relative to workspace root' },
        scan_path: { type: 'string', description: 'Scan path relative to workspace root' },
        container: { type: 'string', description: 'Container filter for docker_security' },
      },
      required: ['action'],
    },
  },
  {
    name: 'code_analysis',
    description: 'Code analysis: typecheck, dead_code, import_analysis, complexity, todo_scan.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        action: { type: 'string', enum: ['typecheck', 'dead_code', 'import_analysis', 'complexity', 'todo_scan'] },
        package_dir: { type: 'string', description: 'Package dir relative to workspace root' },
        file_path: { type: 'string', description: 'File path relative to workspace root' },
        scan_path: { type: 'string', description: 'Scan path relative to workspace root' },
      },
      required: ['action'],
    },
  },
];

// ============================================
// Docker API Handler
// ============================================

const PROTECTED_CONTAINERS = [
  'substrate-prod-api', 'substrate-prod-dashboard', 'substrate-prod-forge',
  'substrate-prod-nginx', 'substrate-prod-postgres', 'substrate-prod-redis',
  'substrate-prod-pgbouncer', 'substrate-prod-cloudflared', 'substrate-prod-worker',
  'substrate-prod-scheduler', 'substrate-prod-mcp', 'substrate-prod-self',
];

async function handleDockerApi(args: Record<string, unknown>): Promise<string> {
  const action = args['action'] as string;

  switch (action) {
    case 'list': {
      const res = await dockerRequest('GET', '/v1.44/containers/json?all=true');
      const containers = JSON.parse(res.data) as Array<Record<string, unknown>>;
      const summary = containers.map((c) => ({
        id: (c['Id'] as string)?.slice(0, 12),
        name: ((c['Names'] as string[]) ?? ['/unknown'])[0]?.replace(/^\//, ''),
        image: c['Image'], state: c['State'], status: c['Status'],
      }));
      return JSON.stringify({ containers: summary, count: summary.length });
    }

    case 'inspect': {
      const container = args['container'] as string;
      if (!container) return JSON.stringify({ error: 'container is required for inspect' });
      const res = await dockerRequest('GET', `/v1.44/containers/${container}/json`);
      if (res.statusCode === 404) return JSON.stringify({ error: `Container not found: ${container}` });
      const info = JSON.parse(res.data) as Record<string, unknown>;
      return JSON.stringify({
        id: (info['Id'] as string)?.slice(0, 12),
        name: (info['Name'] as string)?.replace(/^\//, ''),
        state: info['State'],
        config: { image: (info['Config'] as Record<string, unknown>)?.['Image'] },
        restartCount: info['RestartCount'] ?? 0,
      });
    }

    case 'logs': {
      const container = args['container'] as string;
      if (!container) return JSON.stringify({ error: 'container is required for logs' });
      const tail = (args['tail'] as number) ?? 100;
      const res = await dockerRequest('GET', `/v1.44/containers/${container}/logs?stdout=true&stderr=true&tail=${tail}&timestamps=true`);
      if (res.statusCode === 404) return JSON.stringify({ error: `Container not found: ${container}` });
      return JSON.stringify({ container, tail, logs: res.data.replace(/[\x00-\x08]/g, '').trim() });
    }

    case 'stats': {
      const container = args['container'] as string;
      if (!container) return JSON.stringify({ error: 'container is required for stats' });
      const res = await dockerRequest('GET', `/v1.44/containers/${container}/stats?stream=false`);
      if (res.statusCode === 404) return JSON.stringify({ error: `Container not found: ${container}` });
      const stats = JSON.parse(res.data) as Record<string, unknown>;
      const memUsage = stats['memory_stats'] as Record<string, unknown> | undefined;
      return JSON.stringify({
        container,
        memory: { usage: memUsage?.['usage'], limit: memUsage?.['limit'] },
        pids: (stats['pids_stats'] as Record<string, unknown>)?.['current'],
      });
    }

    case 'exec': {
      const container = args['container'] as string;
      const command = args['command'] as string[];
      if (!container) return JSON.stringify({ error: 'container is required for exec' });
      if (!command?.length) return JSON.stringify({ error: 'command is required for exec' });

      if (PROTECTED_CONTAINERS.some((c) => container.toLowerCase().includes(c))) {
        return JSON.stringify({ error: `Blocked: exec into production container '${container}' is not allowed` });
      }

      const cmdStr = command.join(' ').toLowerCase();
      const blocked = ['rm -rf /', 'mkfs', 'dd if=/dev', 'shutdown', 'reboot', 'docker restart', 'docker stop', 'docker kill'];
      for (const b of blocked) {
        if (cmdStr.includes(b)) return JSON.stringify({ error: `Blocked: dangerous command pattern '${b}'` });
      }

      const createRes = await dockerRequest('POST', `/v1.44/containers/${container}/exec`, { AttachStdout: true, AttachStderr: true, Cmd: command });
      if (createRes.statusCode !== 201) return JSON.stringify({ error: `Failed to create exec: ${createRes.data}` });
      const execId = (JSON.parse(createRes.data) as { Id: string }).Id;
      const startRes = await dockerRequest('POST', `/v1.44/exec/${execId}/start`, { Detach: false, Tty: false });
      const inspectRes = await dockerRequest('GET', `/v1.44/exec/${execId}/json`);
      let exitCode = -1;
      try { exitCode = (JSON.parse(inspectRes.data) as { ExitCode: number }).ExitCode; } catch { /* ignore */ }
      return JSON.stringify({ container, command, exitCode, output: startRes.data.replace(/[\x00-\x08]/g, '').trim() });
    }

    case 'top': {
      const container = args['container'] as string;
      if (!container) return JSON.stringify({ error: 'container is required for top' });
      const res = await dockerRequest('GET', `/v1.44/containers/${container}/top`);
      if (res.statusCode === 404) return JSON.stringify({ error: `Container not found: ${container}` });
      return res.data;
    }

    default:
      return JSON.stringify({ error: `Unknown action: ${action}. Supported: list, inspect, logs, stats, exec, top` });
  }
}

// ============================================
// Deploy Ops Handler
// ============================================

const SERVICE_MAP: Record<string, string> = {
  api: 'substrate-prod-api', dashboard: 'substrate-prod-dashboard',
  forge: 'substrate-prod-forge', worker: 'substrate-prod-worker',
  scheduler: 'substrate-prod-scheduler', nginx: 'substrate-prod-nginx',
  mcp: 'substrate-prod-mcp', self: 'substrate-prod-self',
};
const PROTECTED_SERVICES = ['postgres', 'redis', 'pgbouncer', 'cloudflared'];

async function handleDeployOps(args: Record<string, unknown>): Promise<string> {
  const action = args['action'] as string;

  switch (action) {
    case 'status': {
      const res = await dockerRequest('GET', '/v1.44/containers/json?all=true');
      const containers = JSON.parse(res.data) as Array<Record<string, unknown>>;
      const prod = containers
        .filter((c) => ((c['Names'] as string[]) ?? [])[0]?.includes('substrate-prod-'))
        .map((c) => ({
          name: ((c['Names'] as string[]) ?? [])[0]?.replace(/^\//, ''),
          state: c['State'], status: c['Status'],
          health: (c['Status'] as string)?.match(/\((.*?)\)/)?.[1] ?? 'unknown',
        }));
      return JSON.stringify({ containers: prod, count: prod.length });
    }

    case 'logs': {
      const service = args['service'] as string;
      if (!service) return JSON.stringify({ error: 'service is required for logs' });
      const containerName = SERVICE_MAP[service.toLowerCase()];
      if (!containerName) return JSON.stringify({ error: `Unknown service: ${service}. Available: ${Object.keys(SERVICE_MAP).join(', ')}` });
      const tail = Math.min((args['tail'] as number) ?? 100, 200);
      const res = await dockerRequest('GET', `/v1.44/containers/${containerName}/logs?stdout=true&stderr=true&tail=${tail}&timestamps=true`);
      if (res.statusCode === 404) return JSON.stringify({ error: `Container not found: ${containerName}` });
      return JSON.stringify({ service, container: containerName, tail, logs: res.data.replace(/[\x00-\x08]/g, '').trim() });
    }

    case 'restart': {
      const service = args['service'] as string;
      const agentName = args['agent_name'] as string;
      if (!service) return JSON.stringify({ error: 'service is required for restart' });
      if (!agentName) return JSON.stringify({ error: 'agent_name is required for restart' });
      if (PROTECTED_SERVICES.includes(service.toLowerCase())) return JSON.stringify({ error: `Cannot restart protected service: ${service}` });
      const containerName = SERVICE_MAP[service.toLowerCase()];
      if (!containerName) return JSON.stringify({ error: `Unknown service: ${service}` });

      const p = getSubstratePool();
      const interventionId = args['intervention_id'] as string | undefined;

      if (!interventionId) {
        const id = generateId();
        await p.query(
          `INSERT INTO agent_interventions (id, agent_id, agent_name, agent_type, type, title, description, proposed_action, status)
           VALUES ($1, $2, $3, 'ops', 'approval', $4, $5, $6, 'pending')`,
          [id, (args['agent_id'] as string) ?? 'unknown', agentName, `Deploy: Restart ${service}`, `Agent ${agentName} requests restarting ${containerName}.`, `docker restart ${containerName}`],
        );
        return JSON.stringify({ approved: false, intervention_id: id, service, message: 'Restart request created. Awaiting human approval.' });
      }

      const check = await p.query(`SELECT status FROM agent_interventions WHERE id = $1`, [interventionId]);
      if (check.rows.length === 0) return JSON.stringify({ error: `Intervention not found: ${interventionId}` });
      if ((check.rows[0] as Record<string, unknown>)['status'] !== 'approved') return JSON.stringify({ approved: false, status: (check.rows[0] as Record<string, unknown>)['status'], message: 'Not yet approved' });

      const res = await dockerRequest('POST', `/v1.44/containers/${containerName}/restart?t=10`);
      return JSON.stringify({ success: res.statusCode === 204, service, container: containerName, intervention_id: interventionId });
    }

    case 'build': {
      const service = args['service'] as string;
      const agentName = args['agent_name'] as string;
      if (!service) return JSON.stringify({ error: 'service is required for build' });
      if (!agentName) return JSON.stringify({ error: 'agent_name is required for build' });

      const p = getSubstratePool();
      if (!args['intervention_id']) {
        const id = generateId();
        await p.query(
          `INSERT INTO agent_interventions (id, agent_id, agent_name, agent_type, type, title, description, proposed_action, status)
           VALUES ($1, $2, $3, 'ops', 'approval', $4, $5, $6, 'pending')`,
          [id, (args['agent_id'] as string) ?? 'unknown', agentName, `Deploy: Build ${service}`, `Agent ${agentName} requests building ${service}.`, `docker-compose build ${service}`],
        );
        return JSON.stringify({ approved: false, intervention_id: id, service, message: 'Build request created. Awaiting human approval.' });
      }

      const check = await p.query(`SELECT status FROM agent_interventions WHERE id = $1`, [args['intervention_id']]);
      if (check.rows.length === 0) return JSON.stringify({ error: `Intervention not found: ${args['intervention_id']}` });
      if ((check.rows[0] as Record<string, unknown>)['status'] !== 'approved') return JSON.stringify({ approved: false, message: 'Not yet approved' });
      return JSON.stringify({ approved: true, service, intervention_id: args['intervention_id'], message: `Build approved. Human operator should execute.` });
    }

    default:
      return JSON.stringify({ error: `Unknown action: ${action}. Supported: status, logs, restart, build` });
  }
}

// ============================================
// Security Scan Handler
// ============================================

async function handleSecurityScan(args: Record<string, unknown>): Promise<string> {
  const action = args['action'] as string;

  switch (action) {
    case 'npm_audit': {
      const pkgDir = args['package_dir'] ? join(REPO_ROOT, args['package_dir'] as string) : REPO_ROOT;
      const res = await run('npm audit --json 2>/dev/null || true', pkgDir);
      let summary: Record<string, unknown> = { raw: res.stdout };
      try {
        const audit = JSON.parse(res.stdout) as Record<string, unknown>;
        const metadata = audit['metadata'] as Record<string, unknown> | undefined;
        summary = {
          vulnerabilities: audit['vulnerabilities'] ? Object.keys(audit['vulnerabilities'] as object).length : 0,
          totalDependencies: metadata?.['totalDependencies'] ?? 'unknown',
          severities: metadata?.['vulnerabilities'] ?? {},
        };
      } catch { /* raw output */ }
      return JSON.stringify({ action: 'npm_audit', package_dir: pkgDir, summary });
    }

    case 'dependency_check': {
      const pkgDir = args['package_dir'] ? join(REPO_ROOT, args['package_dir'] as string) : REPO_ROOT;
      const res = await run('pnpm outdated --json 2>/dev/null || true', pkgDir);
      let outdated: unknown = res.stdout;
      try { outdated = JSON.parse(res.stdout); } catch { /* raw */ }
      return JSON.stringify({ action: 'dependency_check', package_dir: pkgDir, outdated });
    }

    case 'file_permissions': {
      const scanPath = args['scan_path'] ? join(REPO_ROOT, args['scan_path'] as string) : REPO_ROOT;
      const issues: Array<{ file: string; mode: string; issue: string }> = [];
      const files = await walkFiles(scanPath, new Set([...SCAN_EXTENSIONS, '.sh', '.bash']), 200);
      for (const file of files) {
        try {
          const stats = await stat(file);
          const mode = (stats.mode & 0o777).toString(8);
          if (stats.mode & 0o002) issues.push({ file: file.replace(REPO_ROOT, ''), mode, issue: 'world-writable' });
          if (stats.mode & 0o4000) issues.push({ file: file.replace(REPO_ROOT, ''), mode, issue: 'setuid bit set' });
          if (stats.mode & 0o2000) issues.push({ file: file.replace(REPO_ROOT, ''), mode, issue: 'setgid bit set' });
        } catch { /* skip */ }
      }
      return JSON.stringify({ action: 'file_permissions', scan_path: scanPath, issues, count: issues.length });
    }

    case 'env_leak_check': {
      const scanPath = args['scan_path'] ? join(REPO_ROOT, args['scan_path'] as string) : REPO_ROOT;
      const findings: Array<{ file: string; line: number; pattern: string; snippet: string }> = [];
      const files = await walkFiles(scanPath, SCAN_EXTENSIONS, 300);
      for (const file of files) {
        if (file.includes('pnpm-lock') || file.includes('package-lock')) continue;
        try {
          const content = await readFile(file, 'utf-8');
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i]!;
            for (const pattern of SECRET_PATTERNS) {
              pattern.lastIndex = 0;
              if (pattern.exec(line)) {
                const snippet = line.slice(0, 100).replace(/(['"])[^'"]{8,}(['"])/g, '$1***REDACTED***$2');
                findings.push({ file: file.replace(REPO_ROOT, ''), line: i + 1, pattern: pattern.source.slice(0, 40), snippet });
                break;
              }
            }
          }
        } catch { /* skip */ }
      }
      return JSON.stringify({ action: 'env_leak_check', scan_path: scanPath, findings: findings.slice(0, 50), total_findings: findings.length });
    }

    case 'docker_security': {
      const res = await dockerRequest('GET', '/v1.44/containers/json?all=true');
      const containers = JSON.parse(res.data) as Array<Record<string, unknown>>;
      const prodContainers = containers.filter((c) => ((c['Names'] as string[]) ?? [])[0]?.includes('substrate-prod-'));
      const report: Array<Record<string, unknown>> = [];
      for (const container of prodContainers) {
        const name = ((container['Names'] as string[]) ?? [])[0]?.replace(/^\//, '') ?? '';
        if (args['container'] && !name.includes(args['container'] as string)) continue;
        const inspectRes = await dockerRequest('GET', `/v1.44/containers/${name}/json`);
        if (inspectRes.statusCode !== 200) continue;
        const info = JSON.parse(inspectRes.data) as Record<string, unknown>;
        const hostConfig = info['HostConfig'] as Record<string, unknown> | undefined;
        report.push({
          name, readOnly: hostConfig?.['ReadonlyRootfs'] ?? false,
          privileged: hostConfig?.['Privileged'] ?? false,
          capDrop: hostConfig?.['CapDrop'] ?? [], capAdd: hostConfig?.['CapAdd'] ?? [],
        });
      }
      return JSON.stringify({ action: 'docker_security', containers: report, count: report.length });
    }

    default:
      return JSON.stringify({ error: `Unknown action: ${action}` });
  }
}

// ============================================
// Code Analysis Handler
// ============================================

async function handleCodeAnalysis(args: Record<string, unknown>): Promise<string> {
  const action = args['action'] as string;

  switch (action) {
    case 'typecheck': {
      const pkgDir = args['package_dir'] ? join(REPO_ROOT, args['package_dir'] as string) : REPO_ROOT;
      const res = await run('npx tsc --noEmit --pretty 2>&1 || true', pkgDir, 120_000);
      const errorLines = res.stdout.split('\n').filter((l) => l.includes('error TS'));
      return JSON.stringify({ action: 'typecheck', package_dir: pkgDir, errorCount: errorLines.length, errors: errorLines.slice(0, 30), exitCode: res.exitCode });
    }

    case 'dead_code': {
      const scanPath = args['scan_path'] ? join(REPO_ROOT, args['scan_path'] as string) : REPO_ROOT;
      const files = await walkFiles(scanPath, CODE_EXTENSIONS);
      const exports: Array<{ file: string; symbol: string; line: number }> = [];
      const importRefs = new Set<string>();

      for (const file of files) {
        try {
          const content = await readFile(file, 'utf-8');
          const lines = content.split('\n');
          const relPath = relative(REPO_ROOT, file);
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i]!;
            const exportMatch = line.match(/export\s+(?:async\s+)?(?:function|const|let|var|class|interface|type|enum)\s+(\w+)/);
            if (exportMatch?.[1]) exports.push({ file: relPath, symbol: exportMatch[1], line: i + 1 });
            const importMatch = line.match(/import\s+(?:\{([^}]+)\}|(\w+))\s+from/);
            if (importMatch) {
              const symbols = (importMatch[1] ?? importMatch[2] ?? '').split(',').map((s) => s.trim().split(' as ')[0]!.trim());
              for (const sym of symbols) { if (sym) importRefs.add(sym); }
            }
          }
        } catch { /* skip */ }
      }

      const dead = exports.filter((e) => !importRefs.has(e.symbol));
      return JSON.stringify({ action: 'dead_code', totalExports: exports.length, deadExports: dead.slice(0, 50), deadCount: dead.length, filesScanned: files.length });
    }

    case 'import_analysis': {
      const filePath = args['file_path'] as string;
      if (!filePath) return JSON.stringify({ error: 'file_path is required for import_analysis' });
      const targetFile = join(REPO_ROOT, filePath);
      let content: string;
      try { content = await readFile(targetFile, 'utf-8'); } catch { return JSON.stringify({ error: `Cannot read file: ${filePath}` }); }

      const imports: Array<{ module: string; symbols: string[] }> = [];
      const importRegex = /import\s+(?:\{([^}]+)\}|(\w+)|\*\s+as\s+(\w+))\s+from\s+['"]([^'"]+)['"]/g;
      let match;
      while ((match = importRegex.exec(content)) !== null) {
        const symbols = match[1] ? match[1].split(',').map((s) => s.trim()) : [match[2] ?? match[3] ?? 'default'];
        imports.push({ module: match[4]!, symbols });
      }
      return JSON.stringify({ action: 'import_analysis', file: filePath, imports, importCount: imports.length });
    }

    case 'complexity': {
      const scanPath = args['scan_path'] ? join(REPO_ROOT, args['scan_path'] as string) : args['file_path'] ? join(REPO_ROOT, args['file_path'] as string) : REPO_ROOT;
      const files = args['file_path'] ? [join(REPO_ROOT, args['file_path'] as string)] : await walkFiles(scanPath, CODE_EXTENSIONS, 200);
      const allFunctions: Array<{ file: string; name: string; line: number; length: number; maxDepth: number; branches: number }> = [];

      for (const file of files) {
        try {
          const content = await readFile(file, 'utf-8');
          const lines = content.split('\n');
          const relPath = relative(REPO_ROOT, file);
          let currentFunc: { name: string; line: number; startLine: number; depth: number; maxDepth: number; branches: number; braceCount: number } | null = null;

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i]!;
            const funcMatch = line.match(/(?:export\s+)?(?:async\s+)?function\s+(\w+)|(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?\(/);
            if (funcMatch && !currentFunc) {
              currentFunc = { name: funcMatch[1] ?? funcMatch[2] ?? 'anon', line: i + 1, startLine: i, depth: 0, maxDepth: 0, branches: 0, braceCount: 0 };
            }
            if (currentFunc) {
              for (const ch of line) {
                if (ch === '{') { currentFunc.braceCount++; currentFunc.depth++; if (currentFunc.depth > currentFunc.maxDepth) currentFunc.maxDepth = currentFunc.depth; }
                else if (ch === '}') { currentFunc.braceCount--; currentFunc.depth--; }
              }
              if (/\b(if|else if|switch|case|\?\?|&&|\|\||catch)\b/.test(line)) currentFunc.branches++;
              if (currentFunc.braceCount <= 0 && i > currentFunc.startLine) {
                const length = i - currentFunc.startLine + 1;
                if (length > 20 || currentFunc.maxDepth > 4 || currentFunc.branches > 5) {
                  allFunctions.push({ file: relPath, name: currentFunc.name, line: currentFunc.line, length, maxDepth: currentFunc.maxDepth, branches: currentFunc.branches });
                }
                currentFunc = null;
              }
            }
          }
        } catch { /* skip */ }
      }

      allFunctions.sort((a, b) => (b.length + b.maxDepth * 5 + b.branches * 3) - (a.length + a.maxDepth * 5 + a.branches * 3));
      return JSON.stringify({ action: 'complexity', filesScanned: files.length, complexFunctions: allFunctions.slice(0, 30), totalFlagged: allFunctions.length });
    }

    case 'todo_scan': {
      const scanPath = args['scan_path'] ? join(REPO_ROOT, args['scan_path'] as string) : REPO_ROOT;
      const files = await walkFiles(scanPath, CODE_EXTENSIONS, 500);
      const todos: Array<{ file: string; line: number; type: string; text: string }> = [];
      const todoPattern = /\b(TODO|FIXME|HACK|XXX|BUG|WARN)\b[:\s]*(.*)/i;
      for (const file of files) {
        try {
          const content = await readFile(file, 'utf-8');
          const lines = content.split('\n');
          const relPath = relative(REPO_ROOT, file);
          for (let i = 0; i < lines.length; i++) {
            const match = todoPattern.exec(lines[i]!);
            if (match) todos.push({ file: relPath, line: i + 1, type: match[1]!.toUpperCase(), text: match[2]!.trim().slice(0, 200) });
          }
        } catch { /* skip */ }
      }
      const byType: Record<string, number> = {};
      for (const todo of todos) byType[todo.type] = (byType[todo.type] ?? 0) + 1;
      return JSON.stringify({ action: 'todo_scan', todos: todos.slice(0, 50), totalCount: todos.length, byType, filesScanned: files.length });
    }

    default:
      return JSON.stringify({ error: `Unknown action: ${action}` });
  }
}

// ============================================
// Create MCP Server
// ============================================

function createMCPServer(): Server {
  const server = new Server(
    { name: 'mcp-infra', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: TOOLS };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    log(`Tool called: ${name}`);

    try {
      let result: string;
      switch (name) {
        case 'docker_api':
          result = await handleDockerApi(args as Record<string, unknown>);
          break;
        case 'deploy_ops':
          result = await handleDeployOps(args as Record<string, unknown>);
          break;
        case 'security_scan':
          result = await handleSecurityScan(args as Record<string, unknown>);
          break;
        case 'code_analysis':
          result = await handleCodeAnalysis(args as Record<string, unknown>);
          break;
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
      return { content: [{ type: 'text', text: result }] };
    } catch (error) {
      log(`Tool failed: ${name} - ${error}`);
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }) }],
        isError: true,
      };
    }
  });

  return server;
}

// ============================================
// Graceful shutdown + Start
// ============================================

process.on('SIGTERM', async () => {
  log('SIGTERM received, shutting down...');
  await closeAll();
  process.exit(0);
});

app.listen(PORT, '0.0.0.0', () => {
  log(`MCP Infrastructure server listening on port ${PORT}`);
  log(`  POST /mcp     - Streamable HTTP endpoint`);
});
