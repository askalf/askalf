/**
 * Git Review Routes
 * Read-only git operations + merge for the Git Space admin page.
 * All commands run against /workspace where the repo is mounted.
 */

import { exec, execFile } from 'child_process';
import http from 'http';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware } from '../middleware/auth.js';
import { query } from '../database.js';

const REPO_ROOT = process.env['REPO_ROOT'] ?? '/workspace';
const EXEC_TIMEOUT_MS = 30_000;
const MAX_DIFF_SIZE = 100_000; // 100KB max diff
const BUILDER_IMAGE = 'docker:27-cli';

// Docker connection — uses DOCKER_HOST (tcp://host:port) when behind socket proxy, falls back to Unix socket
const DOCKER_CONN: Record<string, unknown> = (() => {
  const h = process.env['DOCKER_HOST'];
  if (h?.startsWith('tcp://')) {
    const u = new URL(h.replace('tcp://', 'http://'));
    return { hostname: u.hostname, port: Number(u.port) || 2375 };
  }
  return { socketPath: '/var/run/docker.sock' };
})();

// Service dependency order for recreating containers
const RECREATE_ORDER = [
  'mcp', 'mcp-tools',                                              // MCP servers first
  'api', 'forge',                                                  // Backend depends on MCP
  'dashboard',                                                     // Frontend depends on API
  'nginx',                                                         // Reverse proxy last
  'scheduler', 'worker',                                           // Workers independent
];

function dockerApi(method: string, path: string, body?: unknown, timeout = 30_000): Promise<{ statusCode: number; data: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Docker API timeout')), timeout);
    const opts: http.RequestOptions = {
      ...DOCKER_CONN,
      path,
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (c: Buffer) => { data += c.toString(); });
      res.on('end', () => { clearTimeout(timer); resolve({ statusCode: res.statusCode ?? 500, data }); });
    });
    req.on('error', (err) => { clearTimeout(timer); reject(err); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function git(args: string[], timeout = EXEC_TIMEOUT_MS): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['-C', REPO_ROOT, ...args],
      { timeout, maxBuffer: 2_048_000, env: { ...process.env, HOME: '/tmp', GIT_TERMINAL_PROMPT: '0' } },
      (error, stdout, stderr) => {
        resolve({
          exitCode: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
          stdout,
          stderr: stderr?.slice(0, 4000) ?? '',
        });
      },
    );
  });
}

// Strict branch name validation — prevents command injection via shell metacharacters
const SAFE_BRANCH_RE = /^agent\/[a-zA-Z0-9._\-/]+$/;
function validateBranch(branch: string, reply: FastifyReply): boolean {
  if (!branch.startsWith('agent/')) {
    reply.status(400).send({ error: 'Only agent/* branches can be reviewed' });
    return false;
  }
  if (!SAFE_BRANCH_RE.test(branch)) {
    reply.status(400).send({ error: 'Invalid branch name — only alphanumeric, hyphens, underscores, dots, and slashes allowed' });
    return false;
  }
  return true;
}

// Branch cache — git on Docker Desktop 9P is slow (~1s per subprocess)
let branchCache: { data: unknown; ts: number } | null = null;
const BRANCH_CACHE_TTL = 30_000; // 30 second TTL

export async function gitReviewRoutes(app: FastifyInstance): Promise<void> {

  /**
   * GET /api/v1/forge/git/branches
   * List agent/* branches with metadata (cached 30s)
   */
  app.get(
    '/api/v1/forge/git/branches',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Check query param for cache bust
      const { refresh } = request.query as { refresh?: string };

      if (branchCache && !refresh && Date.now() - branchCache.ts < BRANCH_CACHE_TTL) {
        return reply.send(branchCache.data);
      }

      const branchRes = await git(['branch', '--list', 'agent/*', '--no-merged', 'main', '--format=%(refname:short)|%(committerdate:iso8601)|%(committername)']);
      if (branchRes.exitCode !== 0) {
        return reply.status(500).send({ error: 'Failed to list branches', detail: branchRes.stderr });
      }

      const lines = branchRes.stdout.trim().split('\n').filter(Boolean);

      // Build branch list first, then batch git calls
      const branchMeta = lines.map(line => {
        const parts = line.split('|');
        const name = parts[0] ?? '';
        const date = parts[1] ?? '';
        const author = parts[2] ?? '';
        const branchParts = name.split('/');
        const agentSlug = branchParts.length >= 2 ? (branchParts[1] ?? 'unknown') : 'unknown';
        return { name, date: date.trim() || null, author: author.trim() || null, agentSlug };
      }).filter(b => b.name);

      // Fetch stats for all branches in parallel (safe: array-based git calls)
      const branchNames = branchMeta.map(b => b.name);
      if (branchNames.length === 0) {
        const response = { branches: [] };
        branchCache = { data: response, ts: Date.now() };
        return reply.send(response);
      }

      // Parallel stats fetch using safe execFile calls (no shell injection risk)
      const statsResults = await Promise.all(
        branchNames.map(async (n) => {
          const countRes = await git(['rev-list', '--count', `main..${n}`], 30_000).catch(() => ({ exitCode: 1, stdout: '0', stderr: '' }));
          const statRes = await git(['diff', '--shortstat', `main...${n}`], 30_000).catch(() => ({ exitCode: 0, stdout: '', stderr: '' }));
          const count = countRes.exitCode === 0 ? countRes.stdout.trim() : '0';
          const stats = statRes.exitCode === 0 ? statRes.stdout.trim() : '';
          return `${n}|${count}|${stats}`;
        })
      );
      const batchRes = { exitCode: 0, stdout: statsResults.join('\n'), stderr: '' };

      // Parse batch results into a map
      const statsMap = new Map<string, { commits: number; filesChanged: number }>();
      if (batchRes.exitCode === 0) {
        for (const line of batchRes.stdout.trim().split('\n').filter(Boolean)) {
          const [name, countStr, ...statParts] = line.split('|');
          if (!name) continue;
          const statsText = statParts.join('|');
          const filesMatch = statsText.match(/(\d+)\s+files?\s+changed/);
          statsMap.set(name, {
            commits: parseInt(countStr ?? '0', 10) || 0,
            filesChanged: filesMatch ? parseInt(filesMatch[1] ?? '0', 10) : 0,
          });
        }
      }

      // Look up agent names from DB
      const agents = await query<{ id: string; name: string }>(
        'SELECT id, name FROM forge_agents',
      ).catch(() => []);
      const agentNameMap = new Map<string, { id: string; name: string }>();
      for (const a of agents) {
        agentNameMap.set(a.name.toLowerCase().replace(/\s+/g, '-'), a);
        agentNameMap.set(a.name.toLowerCase().replace(/\s+/g, '_'), a);
        agentNameMap.set(a.name.toLowerCase().replace(/\s+/g, ''), a);
        agentNameMap.set(a.name.toLowerCase(), a);
      }

      const branches = branchMeta.map(b => {
        const stats = statsMap.get(b.name) ?? { commits: 0, filesChanged: 0 };
        const agentMatch = agentNameMap.get(b.agentSlug.toLowerCase());
        return {
          name: b.name,
          agent_slug: b.agentSlug,
          agent_name: agentMatch?.name ?? b.agentSlug.charAt(0).toUpperCase() + b.agentSlug.slice(1),
          agent_id: agentMatch?.id ?? null,
          commits: stats.commits,
          files_changed: stats.filesChanged,
          last_date: b.date,
          author: b.author,
          review_status: null,
          intervention_id: null,
          intervention_status: null,
        };
      });

      const response = { branches };
      branchCache = { data: response, ts: Date.now() };
      return reply.send(response);
    },
  );

  /**
   * GET /api/v1/forge/git/diff/:branch
   * Full unified diff of main..<branch>
   */
  app.get(
    '/api/v1/forge/git/diff/:branch',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { branch: rawBranch } = request.params as { branch: string };
      const branch = decodeURIComponent(rawBranch);
      if (!validateBranch(branch, reply)) return;

      // Parallel: get diff and stats simultaneously (safe: array args)
      const [diffRes, statRes] = await Promise.all([
        git(['diff', '--unified=5', `main...${branch}`]),
        git(['diff', '--shortstat', `main...${branch}`]),
      ]);
      if (diffRes.exitCode !== 0) {
        return reply.status(500).send({ error: 'Failed to get diff', detail: diffRes.stderr });
      }

      let diff = diffRes.stdout;
      let truncated = false;
      if (diff.length > MAX_DIFF_SIZE) {
        diff = diff.substring(0, MAX_DIFF_SIZE);
        truncated = true;
      }

      const statsText = statRes.stdout.trim();
      const addMatch = statsText.match(/(\d+)\s+insertion/);
      const delMatch = statsText.match(/(\d+)\s+deletion/);
      const fileMatch = statsText.match(/(\d+)\s+files?\s+changed/);

      return reply.send({
        branch,
        diff,
        truncated,
        stats: {
          files: fileMatch ? parseInt(fileMatch[1] ?? '0', 10) : 0,
          additions: addMatch ? parseInt(addMatch[1] ?? '0', 10) : 0,
          deletions: delMatch ? parseInt(delMatch[1] ?? '0', 10) : 0,
        },
      });
    },
  );

  /**
   * GET /api/v1/forge/git/log/:branch
   * Commit log for a branch (diverged from main)
   */
  app.get(
    '/api/v1/forge/git/log/:branch',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { branch: rawBranch } = request.params as { branch: string };
      const branch = decodeURIComponent(rawBranch);
      if (!validateBranch(branch, reply)) return;

      const logRes = await git(['log', `main..${branch}`, '--format=%H|%s|%an|%aI', '-n', '50']);
      if (logRes.exitCode !== 0) {
        return reply.status(500).send({ error: 'Failed to get log', detail: logRes.stderr });
      }

      const commits = logRes.stdout.trim().split('\n').filter(Boolean).map((line: string) => {
        const p = line.split('|');
        return { hash: p[0] ?? '', subject: p[1] ?? '', author: p[2] ?? '', date: p[3] ?? '' };
      });

      return reply.send({ branch, commits });
    },
  );

  /**
   * GET /api/v1/forge/git/files/:branch
   * List changed files with stats
   */
  app.get(
    '/api/v1/forge/git/files/:branch',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { branch: rawBranch } = request.params as { branch: string };
      const branch = decodeURIComponent(rawBranch);
      if (!validateBranch(branch, reply)) return;

      const numstatRes = await git(['diff', '--numstat', `main...${branch}`]);
      if (numstatRes.exitCode !== 0) {
        return reply.status(500).send({ error: 'Failed to get file stats', detail: numstatRes.stderr });
      }

      const files = numstatRes.stdout.trim().split('\n').filter(Boolean).map((line: string) => {
        const p = line.split('\t');
        return {
          path: p[2] ?? '',
          additions: parseInt(p[0] ?? '0', 10) || 0,
          deletions: parseInt(p[1] ?? '0', 10) || 0,
        };
      });

      return reply.send({ branch, files });
    },
  );

  /**
   * POST /api/v1/forge/git/merge
   * Merge an agent branch into main (requires auth)
   */
  app.post(
    '/api/v1/forge/git/merge',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { branch } = request.body as { branch: string };
      if (!branch || !validateBranch(branch, reply)) return;

      // Ensure we're on main and up to date
      const checkoutRes = await git(['checkout', 'main']);
      if (checkoutRes.exitCode !== 0) {
        return reply.status(500).send({ error: 'Failed to checkout main', detail: checkoutRes.stderr });
      }

      // Merge with no-ff to preserve merge commit (safe: array args prevent shell injection)
      const mergeRes = await git(['merge', '--no-ff', branch, '-m', `Merge ${branch} [Git Space Approved]`]);
      if (mergeRes.exitCode !== 0) {
        // Check for conflicts
        if (mergeRes.stderr.includes('CONFLICT') || mergeRes.stdout.includes('CONFLICT')) {
          await git(['merge', '--abort']);
          return reply.status(409).send({
            error: 'Merge conflict',
            detail: mergeRes.stdout.substring(0, 4000),
            message: 'Merge conflicts detected. The agent branch needs to be rebased or conflicts resolved manually.',
          });
        }
        return reply.status(500).send({ error: 'Merge failed', detail: mergeRes.stderr });
      }

      // Get the merge commit hash
      const hashRes = await git(['rev-parse', 'HEAD']);
      const mergeCommit = hashRes.stdout.trim();

      // Clean up the branch
      await git(['branch', '-d', branch]);

      // Invalidate branch cache after merge
      branchCache = null;

      return reply.send({
        success: true,
        merge_commit: mergeCommit,
        message: `Merged ${branch} into main`,
      });
    },
  );

  /**
   * GET /api/v1/forge/git/health/:service
   * Get health status of a Docker container
   */
  app.get(
    '/api/v1/forge/git/health/:service',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { service } = request.params as { service: string };

      // Sanitize service name
      if (!/^[a-zA-Z0-9_-]+$/.test(service)) {
        return reply.status(400).send({ error: 'Invalid service name' });
      }

      const container = `askalf-${service}`;

      try {
        const data = await new Promise<string>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Timeout')), 10_000);
          const req = http.request(
            { ...DOCKER_CONN, path: `/v1.44/containers/${container}/json`, method: 'GET' },
            (res) => {
              clearTimeout(timer);
              let body = '';
              res.on('data', (c: Buffer) => { body += c.toString(); });
              res.on('end', () => {
                if (res.statusCode === 200) resolve(body);
                else reject(new Error(`HTTP ${res.statusCode}: ${body.substring(0, 500)}`));
              });
            },
          );
          req.on('error', (err) => { clearTimeout(timer); reject(err); });
          req.end();
        });

        const info = JSON.parse(data);
        return reply.send({
          service,
          container,
          running: info.State?.Running ?? false,
          status: info.State?.Status ?? 'unknown',
          started_at: info.State?.StartedAt ?? null,
          health: info.State?.Health?.Status ?? null,
        });
      } catch (err) {
        return reply.send({
          service,
          container,
          running: false,
          status: 'unreachable',
          started_at: null,
          health: null,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  );

  /**
   * POST /api/v1/forge/git/deploy
   * Restart Docker containers via Docker Engine API (socket)
   */
  app.post(
    '/api/v1/forge/git/deploy',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { services } = request.body as { services: string[] };

      if (!services || !Array.isArray(services) || services.length === 0) {
        return reply.status(400).send({ error: 'services array is required' });
      }

      const PROTECTED = ['postgres', 'redis', 'pgbouncer', 'cloudflared'];
      const blocked = services.filter(s => PROTECTED.includes(s));
      if (blocked.length > 0) {
        return reply.status(400).send({ error: `Protected services cannot be restarted: ${blocked.join(', ')}` });
      }

      const results: Array<{ service: string; status: string; error?: string }> = [];

      for (const service of services) {
        const container = `askalf-${service}`;
        try {
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Timeout')), 60_000);
            const req = http.request(
              { ...DOCKER_CONN, path: `/v1.44/containers/${container}/restart?t=10`, method: 'POST' },
              (res) => {
                clearTimeout(timer);
                let body = '';
                res.on('data', (c: Buffer) => { body += c.toString(); });
                res.on('end', () => {
                  if (res.statusCode === 204 || res.statusCode === 200) resolve();
                  else reject(new Error(`HTTP ${res.statusCode}: ${body}`));
                });
              },
            );
            req.on('error', (err) => { clearTimeout(timer); reject(err); });
            req.end();
          });
          results.push({ service, status: 'restarted' });
        } catch (err) {
          results.push({ service, status: 'failed', error: err instanceof Error ? err.message : String(err) });
        }
      }

      return reply.send({ success: true, results });
    },
  );

  /**
   * POST /api/v1/forge/git/rebuild
   * Start a rebuild or restart via ephemeral builder container.
   * For rebuilds: spins up docker:27-cli container to run docker compose build + up.
   * For restarts: uses Docker API restart directly.
   */
  app.post(
    '/api/v1/forge/git/rebuild',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { services, action, task_id } = request.body as {
        services: string[];
        action: 'rebuild' | 'restart';
        task_id?: string;
      };

      if (!services || !Array.isArray(services) || services.length === 0) {
        return reply.status(400).send({ error: 'services array is required' });
      }

      const PROTECTED = ['postgres', 'redis', 'pgbouncer', 'cloudflared'];
      const blocked = services.filter(s => PROTECTED.includes(s));
      if (blocked.length > 0) {
        return reply.status(400).send({ error: `Protected services: ${blocked.join(', ')}` });
      }

      // For restart-only, use Docker API directly
      if (action === 'restart') {
        const results: Array<{ service: string; status: string; error?: string }> = [];
        // Order services by dependency
        const ordered = services.sort((a, b) => {
          const ai = RECREATE_ORDER.indexOf(a);
          const bi = RECREATE_ORDER.indexOf(b);
          return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
        });

        for (const service of ordered) {
          try {
            const res = await dockerApi('POST', `/v1.44/containers/askalf-${service}/restart?t=10`);
            if (res.statusCode === 204 || res.statusCode === 200) {
              results.push({ service, status: 'restarted' });
            } else {
              results.push({ service, status: 'failed', error: `HTTP ${res.statusCode}` });
            }
          } catch (err) {
            results.push({ service, status: 'failed', error: err instanceof Error ? err.message : String(err) });
          }
        }
        return reply.send({ action: 'restart', results, task_id: task_id || null });
      }

      // For rebuild: use ephemeral builder container
      try {
        // 1. Get host workspace path by inspecting our own container
        const inspectRes = await dockerApi('GET', '/v1.44/containers/askalf-forge/json');
        if (inspectRes.statusCode !== 200) {
          return reply.status(500).send({ error: 'Failed to inspect forge container' });
        }
        const forgeInfo = JSON.parse(inspectRes.data);
        const workspaceMount = (forgeInfo.Mounts || []).find(
          (m: { Destination: string }) => m.Destination === '/workspace',
        );
        if (!workspaceMount) {
          return reply.status(500).send({ error: 'Workspace mount not found on forge container' });
        }
        const hostWorkspacePath = workspaceMount.Source;

        // 2. Ensure builder image exists
        const imageCheck = await dockerApi('GET', `/v1.44/images/${encodeURIComponent(BUILDER_IMAGE)}/json`);
        if (imageCheck.statusCode === 404) {
          // Pull the image
          await dockerApi('POST', `/v1.44/images/create?fromImage=docker&tag=27-cli`, undefined, 120_000);
        }

        // 3. Order services by dependency and build compose command
        const ordered = services.sort((a, b) => {
          const ai = RECREATE_ORDER.indexOf(a);
          const bi = RECREATE_ORDER.indexOf(b);
          return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
        });

        const buildCmd = ordered.map(s => `docker compose -f /workspace/docker-compose.prod.yml --env-file /workspace/.env.production build ${s}`).join(' && ');
        const upCmd = ordered.map(s => `docker compose -f /workspace/docker-compose.prod.yml --env-file /workspace/.env.production up -d --force-recreate ${s}`).join(' && ');
        const fullCmd = `${buildCmd} && ${upCmd}`;

        // 4. Create ephemeral builder container
        const createRes = await dockerApi('POST', '/v1.44/containers/create?name=substrate-builder-' + Date.now(), {
          Image: BUILDER_IMAGE,
          Cmd: ['sh', '-c', fullCmd],
          WorkingDir: '/workspace',
          HostConfig: {
            Binds: [
              `${hostWorkspacePath}:/workspace`,
              '/var/run/docker.sock:/var/run/docker.sock',
            ],
            AutoRemove: false,
          },
          Labels: {
            'substrate.role': 'builder',
            'substrate.services': ordered.join(','),
            'substrate.task_id': task_id || '',
          },
        });

        if (createRes.statusCode !== 201) {
          return reply.status(500).send({ error: 'Failed to create builder container', detail: createRes.data.substring(0, 500) });
        }

        const builder = JSON.parse(createRes.data);
        const builderId = builder.Id;

        // 5. Start the builder
        const startRes = await dockerApi('POST', `/v1.44/containers/${builderId}/start`);
        if (startRes.statusCode !== 204 && startRes.statusCode !== 200) {
          // Cleanup failed container
          await dockerApi('DELETE', `/v1.44/containers/${builderId}?force=true`).catch(() => {});
          return reply.status(500).send({ error: 'Failed to start builder', detail: startRes.data.substring(0, 500) });
        }

        return reply.send({
          action: 'rebuild',
          builder_id: builderId,
          services: ordered,
          task_id: task_id || null,
          message: `Rebuilding ${ordered.length} service(s): ${ordered.join(', ')}`,
        });
      } catch (err) {
        return reply.status(500).send({ error: 'Rebuild failed', detail: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  /**
   * GET /api/v1/forge/git/rebuild/:builderId
   * Poll the status of a builder container + get logs.
   */
  app.get(
    '/api/v1/forge/git/rebuild/:builderId',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { builderId } = request.params as { builderId: string };

      try {
        const inspectRes = await dockerApi('GET', `/v1.44/containers/${builderId}/json`);
        if (inspectRes.statusCode === 404) {
          return reply.send({ status: 'completed', exit_code: 0, logs: 'Builder container already cleaned up.' });
        }
        if (inspectRes.statusCode !== 200) {
          return reply.status(500).send({ error: 'Failed to inspect builder' });
        }

        const info = JSON.parse(inspectRes.data);
        const running = info.State?.Running ?? false;
        const exitCode = info.State?.ExitCode ?? null;

        // Get last 100 lines of logs
        const logsRes = await dockerApi('GET', `/v1.44/containers/${builderId}/logs?stdout=true&stderr=true&tail=100&timestamps=false`);
        // Docker log stream has 8-byte header per line, strip it
        const rawLogs = logsRes.data || '';
        const logs = rawLogs.split('\n').map((line: string) => line.length > 8 ? line.substring(8) : line).join('\n').trim();

        if (!running) {
          // Container finished — clean up
          await dockerApi('DELETE', `/v1.44/containers/${builderId}?force=true`).catch(() => {});
          return reply.send({
            status: exitCode === 0 ? 'completed' : 'failed',
            exit_code: exitCode,
            logs,
          });
        }

        return reply.send({
          status: 'running',
          exit_code: null,
          logs,
        });
      } catch (err) {
        return reply.status(500).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  /**
   * DELETE /api/v1/forge/git/rebuild/:builderId
   * Cancel a running rebuild by force-removing the builder container.
   */
  app.delete(
    '/api/v1/forge/git/rebuild/:builderId',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { builderId } = request.params as { builderId: string };

      try {
        // Check if container exists first
        const inspectRes = await dockerApi('GET', `/v1.44/containers/${builderId}/json`);
        if (inspectRes.statusCode === 404) {
          return reply.status(404).send({ error: 'Builder container not found' });
        }

        // Force remove (stops if running + removes)
        const deleteRes = await dockerApi('DELETE', `/v1.44/containers/${builderId}?force=true`);
        if (deleteRes.statusCode === 204 || deleteRes.statusCode === 200) {
          return reply.send({ status: 'cancelled', builder_id: builderId });
        }

        return reply.status(500).send({ error: `Failed to cancel: HTTP ${deleteRes.statusCode}` });
      } catch (err) {
        return reply.status(500).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  /**
   * GET /api/v1/forge/git/rebuild/tasks
   * List all builder containers (running + recently stopped).
   */
  app.get(
    '/api/v1/forge/git/rebuild/tasks',
    { preHandler: [authMiddleware] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        const filters = encodeURIComponent(JSON.stringify({ label: ['substrate.role=builder'] }));
        const listRes = await dockerApi('GET', `/v1.44/containers/json?all=true&filters=${filters}`);
        if (listRes.statusCode !== 200) {
          return reply.send({ tasks: [] });
        }

        const containers = JSON.parse(listRes.data) as Array<{
          Id: string;
          State: string;
          Status: string;
          Created: number;
          Labels: Record<string, string>;
        }>;

        const tasks = containers.map((c) => {
          let status: string;
          if (c.State === 'running') {
            status = 'running';
          } else if (c.Status?.includes('Exited (0)')) {
            status = 'completed';
          } else {
            status = 'failed';
          }

          return {
            task_id: c.Labels['substrate.task_id'] || null,
            builder_id: c.Id,
            services: (c.Labels['substrate.services'] || '').split(',').filter(Boolean),
            status,
            created_at: new Date(c.Created * 1000).toISOString(),
          };
        });

        return reply.send({ tasks });
      } catch (err) {
        return reply.status(500).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );
}
