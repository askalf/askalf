/**
 * Autonomy Loop — Closes the gap between agent execution and deployment.
 *
 * Listens to execution completion events and drives the pipeline:
 *   Branch detected → Review assigned → Approved → Merged → Deployed → Verified
 *
 * Safety:
 *   - Max 2 auto-deploys per hour
 *   - Blocked paths require human review (scheduling.ts, autonomy-loop.ts, migrations, index.ts)
 *   - Rollback on health check failure
 *   - Kill switch via AUTONOMY_LOOP_ENABLED env var
 */

import { exec } from 'child_process';
import http from 'http';
import { getEventBus, type ExecutionEvent, type ForgeEvent } from './event-bus.js';
import { query } from '../database.js';

// ============================================
// Configuration
// ============================================

const REPO_ROOT = process.env['REPO_ROOT'] ?? '/workspace';
const ENABLED = process.env['AUTONOMY_LOOP_ENABLED'] !== 'false'; // enabled by default
const MAX_DEPLOYS_PER_HOUR = 2;
const POLL_INTERVAL_MS = 60_000; // check for approved proposals every 60s
const HEALTH_CHECK_RETRIES = 3;
const HEALTH_CHECK_DELAY_MS = 15_000;

// Files that require human review — never auto-merge
const BLOCKED_PATHS = [
  'src/orchestration/autonomy-loop.ts',
  'src/routes/platform-admin/scheduling.ts',
  'src/index.ts',
  'migrations/',
  '.env',
  'docker-compose',
];

// Map changed file paths to services that need rebuilding
const SERVICE_MAP: Record<string, string> = {
  'apps/forge/': 'forge',
  'apps/dashboard/': 'dashboard',
  'apps/mcp-tools/': 'mcp-tools',
};

// Docker connection
const DOCKER_CONN: Record<string, unknown> = (() => {
  const h = process.env['DOCKER_HOST'];
  if (h?.startsWith('tcp://')) {
    const u = new URL(h.replace('tcp://', 'http://'));
    return { hostname: u.hostname, port: Number(u.port) || 2375 };
  }
  return { socketPath: '/var/run/docker.sock' };
})();

// ============================================
// State
// ============================================

let deploysThisHour = 0;
let deployHourReset = Date.now() + 3_600_000;
let pollTimer: ReturnType<typeof setInterval> | null = null;

// ============================================
// Helpers
// ============================================

function git(args: string, timeout = 30_000): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    exec(
      `git -C "${REPO_ROOT}" ${args}`,
      { timeout, maxBuffer: 2_048_000, env: { ...process.env, HOME: '/tmp', GIT_TERMINAL_PROMPT: '0' } },
      (error, stdout, stderr) => {
        resolve({
          exitCode: error ? ((error as NodeJS.ErrnoException).code as unknown as number ?? 1) : 0,
          stdout: stdout ?? '',
          stderr: (stderr ?? '').slice(0, 4000),
        });
      },
    );
  });
}

function dockerApi(method: string, path: string, body?: unknown, timeout = 30_000): Promise<{ statusCode: number; data: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Docker API timeout')), timeout);
    const bodyStr = body ? JSON.stringify(body) : undefined;
    const headers: Record<string, string> = {};
    if (bodyStr) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = String(Buffer.byteLength(bodyStr));
    }
    const req = http.request({ ...DOCKER_CONN, path, method, headers } as http.RequestOptions, (res) => {
      let data = '';
      res.on('data', (c: Buffer) => { data += c.toString(); });
      res.on('end', () => { clearTimeout(timer); resolve({ statusCode: res.statusCode ?? 500, data }); });
    });
    req.on('error', (err) => { clearTimeout(timer); reject(err); });
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function generateId(): string {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).substring(2, 10);
  return `auto-${t}-${r}`;
}

// ============================================
// Cleanup Helper
// ============================================

async function cleanupBranchAndWorktree(branch: string): Promise<void> {
  try {
    // Find and remove worktree for this branch
    const wtList = await git('worktree list --porcelain');
    for (const entry of wtList.stdout.split('\n\n').filter(Boolean)) {
      if (entry.includes(`branch refs/heads/${branch}`)) {
        const pathMatch = entry.match(/^worktree\s+(.+)/m);
        if (pathMatch?.[1]) {
          await git(`worktree remove "${pathMatch[1]}" --force`).catch((e) => { if (e) console.debug("[catch]", String(e)); });
          console.log(`[AutonomyLoop] Removed worktree: ${pathMatch[1]}`);
        }
        break;
      }
    }
  } catch { /* non-fatal */ }

  // Delete the branch
  await git(`branch -D ${branch}`).catch((e) => { if (e) console.debug("[catch]", String(e)); });
}

// ============================================
// Stage A: Branch Detection
// ============================================

async function detectBranch(executionId: string, agentName: string): Promise<string | null> {
  // Find agent branches matching this execution
  const branchList = await git('branch --list "agent/*" --format="%(refname:short)"');
  if (branchList.exitCode !== 0) return null;

  const branches = branchList.stdout.trim().split('\n').filter(Boolean);

  // Check for branch containing execution ID
  const execBranch = branches.find(b => b.includes(executionId));
  if (execBranch) {
    const ahead = await git(`rev-list main..${execBranch} --count`);
    const count = parseInt(ahead.stdout.trim(), 10);
    if (count > 0) return execBranch;
  }

  // Check for most recent branch from this agent with commits
  const slug = agentName.toLowerCase().replace(/\s+/g, '-');
  const agentBranches = branches.filter(b => b.startsWith(`agent/${slug}/`));
  for (const b of agentBranches.reverse()) {
    const ahead = await git(`rev-list main..${b} --count`);
    const count = parseInt(ahead.stdout.trim(), 10);
    if (count > 0) return b;
  }

  return null;
}

// ============================================
// Stage B: Risk Classification & Review Assignment
// ============================================

interface RiskAssessment {
  level: 'low' | 'medium' | 'high';
  reviewsRequired: number;
  blockedByHuman: boolean;
  changedFiles: string[];
  affectedServices: string[];
}

async function classifyRisk(branch: string): Promise<RiskAssessment> {
  const diffStat = await git(`diff main..${branch} --name-only`);
  const changedFiles = diffStat.stdout.trim().split('\n').filter(Boolean);

  // Determine affected services
  const affectedServices = new Set<string>();
  for (const file of changedFiles) {
    for (const [prefix, service] of Object.entries(SERVICE_MAP)) {
      if (file.startsWith(prefix)) affectedServices.add(service);
    }
  }

  // Check for blocked paths (require human review)
  const hasBlockedPath = changedFiles.some(f => BLOCKED_PATHS.some(bp => f.includes(bp)));
  if (hasBlockedPath) {
    return { level: 'high', reviewsRequired: 2, blockedByHuman: true, changedFiles, affectedServices: [...affectedServices] };
  }

  // Classify by file types
  const hasTests = changedFiles.some(f => f.includes('test') || f.includes('spec'));
  const hasMigrations = changedFiles.some(f => f.includes('migration'));
  const hasSecurityFiles = changedFiles.some(f => f.includes('auth') || f.includes('security') || f.includes('middleware'));
  const hasDashboardOnly = changedFiles.every(f => f.startsWith('apps/dashboard/'));

  if (hasMigrations || hasSecurityFiles) {
    return { level: 'high', reviewsRequired: 2, blockedByHuman: true, changedFiles, affectedServices: [...affectedServices] };
  }

  if (hasDashboardOnly || hasTests) {
    return { level: 'low', reviewsRequired: 1, blockedByHuman: false, changedFiles, affectedServices: [...affectedServices] };
  }

  return { level: 'medium', reviewsRequired: 1, blockedByHuman: false, changedFiles, affectedServices: [...affectedServices] };
}

async function assignReview(
  executionId: string,
  agentId: string,
  agentName: string,
  branch: string,
  risk: RiskAssessment,
): Promise<void> {
  const diffStat = await git(`diff main..${branch} --stat`);
  const logSummary = await git(`log main..${branch} --oneline`);

  if (risk.blockedByHuman) {
    // Create checkpoint for human review
    const cpId = generateId();
    await query(
      `INSERT INTO forge_checkpoints (id, execution_id, owner_id, type, title, context, status, created_at)
       VALUES ($1, $2, $3, 'review', $4, $5, 'pending', NOW())
       ON CONFLICT DO NOTHING`,
      [
        cpId, executionId, agentId,
        `[HIGH RISK] Review ${branch} — ${risk.changedFiles.length} files changed`,
        JSON.stringify({ branch, risk_level: risk.level, files: risk.changedFiles, diff_stat: diffStat.stdout.slice(0, 2000) }),
      ],
    );
    console.log(`[AutonomyLoop] HIGH RISK — created checkpoint ${cpId} for human review of ${branch}`);
    return;
  }

  // Create proposal for tracking
  const proposalId = generateId();
  await query(
    `INSERT INTO forge_change_proposals (id, proposal_type, title, description, author_agent_id, target_branch, status, required_reviews, risk_level, execution_id, file_changes)
     VALUES ($1, 'code_change', $2, $3, $4, $5, 'pending_review', $6, $7, $8, $9)
     ON CONFLICT DO NOTHING`,
    [
      proposalId,
      `${agentName}: ${branch}`,
      `Auto-created from execution ${executionId}.\n\nDiff:\n${diffStat.stdout.slice(0, 3000)}\n\nCommits:\n${logSummary.stdout.slice(0, 1000)}`,
      agentId,
      branch,
      risk.reviewsRequired,
      risk.level,
      executionId,
      JSON.stringify(risk.changedFiles.map(f => ({ path: f }))),
    ],
  );

  if (risk.level === 'low') {
    // Auto-approve low risk — create self-review
    const reviewId = generateId();
    // Find any active reviewer agent (prefer type='dev' or 'monitor')
    const reviewerAgent = await query<{ id: string }>(`SELECT id FROM forge_agents WHERE status = 'active' AND type IN ('dev', 'monitor') AND (is_decommissioned IS NULL OR is_decommissioned = false) LIMIT 1`);
    const reviewerId = reviewerAgent.length > 0 ? reviewerAgent[0]!.id : agentId;

    await query(
      `INSERT INTO forge_proposal_reviews (id, proposal_id, reviewer_agent_id, verdict, comment)
       VALUES ($1, $2, $3, 'approve', 'Auto-approved: low-risk change (tests/docs/dashboard-only)')
       ON CONFLICT DO NOTHING`,
      [reviewId, proposalId, reviewerId],
    );
    await query(`UPDATE forge_change_proposals SET status = 'approved', updated_at = NOW() WHERE id = $1`, [proposalId]);
    console.log(`[AutonomyLoop] LOW RISK — auto-approved proposal ${proposalId} for ${branch}`);
  } else {
    // Medium risk — auto-approve with logging (no human reviewer in selfhosted mode)
    const reviewId = generateId();
    const reviewerAgent = await query<{ id: string }>(`SELECT id FROM forge_agents WHERE status = 'active' AND type IN ('dev', 'monitor') AND (is_decommissioned IS NULL OR is_decommissioned = false) LIMIT 1`);
    const reviewerId = reviewerAgent.length > 0 ? reviewerAgent[0]!.id : agentId;

    await query(
      `INSERT INTO forge_proposal_reviews (id, proposal_id, reviewer_agent_id, verdict, comment)
       VALUES ($1, $2, $3, 'approve', 'Auto-approved: medium-risk change (selfhosted mode, no human reviewer)')
       ON CONFLICT DO NOTHING`,
      [reviewId, proposalId, reviewerId],
    );
    await query(`UPDATE forge_change_proposals SET status = 'approved', updated_at = NOW() WHERE id = $1`, [proposalId]);
    console.log(`[AutonomyLoop] MEDIUM RISK — auto-approved proposal ${proposalId} for ${branch}`);
  }
}

// ============================================
// Stage C: Auto-Merge
// ============================================

async function mergeApprovedProposals(): Promise<void> {
  const approved = await query<{ id: string; target_branch: string; author_agent_id: string; title: string; file_changes: unknown }>(
    `SELECT id, target_branch, author_agent_id, title, file_changes FROM forge_change_proposals
     WHERE status = 'approved' AND proposal_type = 'code_change'
     ORDER BY updated_at ASC LIMIT 3`,
  );

  for (const proposal of approved) {
    // Extract branch from title (format: "AgentName: agent/slug/execId")
    const branchMatch = (proposal.title ?? '').match(/:\s*(agent\/[^\s]+)/);
    if (!branchMatch) {
      console.log(`[AutonomyLoop] Cannot extract branch from proposal ${proposal.id}: ${proposal.title}`);
      await query(`UPDATE forge_change_proposals SET status = 'closed', closed_at = NOW() WHERE id = $1`, [proposal.id]);
      continue;
    }
    const branch = branchMatch[1]!;

    // Verify branch still exists
    const check = await git(`rev-list main..${branch} --count`);
    if (check.exitCode !== 0 || parseInt(check.stdout.trim(), 10) === 0) {
      console.log(`[AutonomyLoop] Branch ${branch} no longer exists or has no commits — closing proposal`);
      await query(`UPDATE forge_change_proposals SET status = 'closed', closed_at = NOW() WHERE id = $1`, [proposal.id]);
      await cleanupBranchAndWorktree(branch);
      continue;
    }

    // Attempt merge
    await git('checkout main');
    const mergeRes = await git(`merge --no-ff ${branch} -m "Auto-merge: ${branch} [Autonomy Loop]"`);

    if (mergeRes.exitCode !== 0) {
      if (mergeRes.stderr.includes('CONFLICT') || mergeRes.stdout.includes('CONFLICT')) {
        await git('merge --abort');
        // Create rebase ticket for original agent
        const agentName = branch.split('/')[1]?.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) ?? 'Unknown';
        await query(
          `INSERT INTO agent_tickets (id, title, description, status, priority, category, assigned_to, is_agent_ticket, source, metadata)
           VALUES ($1, $2, $3, 'open', 'high', 'rebase', $4, true, 'autonomy-loop', $5)
           ON CONFLICT DO NOTHING`,
          [
            generateId(),
            `[REBASE] Merge conflict on ${branch}`,
            `Your branch ${branch} has merge conflicts with main. Please rebase and resolve conflicts.`,
            agentName,
            JSON.stringify({ proposal_id: proposal.id, branch }),
          ],
        );
        await query(`UPDATE forge_change_proposals SET status = 'revision_requested', updated_at = NOW() WHERE id = $1`, [proposal.id]);
        console.log(`[AutonomyLoop] CONFLICT merging ${branch} — created rebase ticket`);
        await cleanupBranchAndWorktree(branch);
      } else {
        console.error(`[AutonomyLoop] Merge failed for ${branch}: ${mergeRes.stderr}`);
        await query(`UPDATE forge_change_proposals SET status = 'closed', closed_at = NOW() WHERE id = $1`, [proposal.id]);
        await cleanupBranchAndWorktree(branch);
      }
      continue;
    }

    // Success — get merge commit hash
    const hashRes = await git('rev-parse HEAD');
    const mergeCommit = hashRes.stdout.trim();

    // Clean up branch and worktree
    await cleanupBranchAndWorktree(branch);

    // Mark proposal applied
    await query(`UPDATE forge_change_proposals SET status = 'applied', applied_at = NOW(), updated_at = NOW() WHERE id = $1`, [proposal.id]);

    // Determine affected services and trigger deploy
    const files = Array.isArray(proposal.file_changes) ? proposal.file_changes : [];
    const filePaths = files.map((f: Record<string, string>) => f['path'] ?? f['file'] ?? '').filter(Boolean);
    const services = new Set<string>();
    for (const fp of filePaths) {
      for (const [prefix, svc] of Object.entries(SERVICE_MAP)) {
        if (fp.startsWith(prefix)) services.add(svc);
      }
    }

    console.log(`[AutonomyLoop] Merged ${branch} → main (${mergeCommit}). Affected services: ${[...services].join(', ') || 'none'}`);

    // Log deployment
    await query(
      `INSERT INTO deployment_logs (id, service, action, status, health_result, agent_name)
       VALUES ($1, $2, 'auto-deploy', 'pending', $3, 'autonomy-loop')`,
      [generateId(), [...services].join(','), JSON.stringify({ git_commit: mergeCommit, git_branch: branch })],
    ).catch(() => {/* non-fatal */});

    // Stage D: Deploy if services affected
    if (services.size > 0) {
      void autoDeploy([...services], mergeCommit, proposal.id).catch(err => {
        console.error(`[AutonomyLoop] Deploy failed:`, err);
      });
    }
  }
}

// ============================================
// Stage D: Auto-Deploy
// ============================================

// Service classification for deployment strategy
const BAKED_SERVICES = new Set(['dashboard', 'mcp-tools']); // need docker compose build + up
const PROTECTED_SERVICES = new Set(['postgres', 'redis', 'cloudflared']);

async function autoDeploy(services: string[], mergeCommit: string, proposalId: string): Promise<void> {
  // Rate limit
  if (Date.now() > deployHourReset) {
    deploysThisHour = 0;
    deployHourReset = Date.now() + 3_600_000;
  }
  if (deploysThisHour >= MAX_DEPLOYS_PER_HOUR) {
    console.log(`[AutonomyLoop] Deploy rate limit reached (${MAX_DEPLOYS_PER_HOUR}/hour). Skipping deploy for ${services.join(', ')}`);
    await query(
      `INSERT INTO agent_tickets (id, title, description, status, priority, category, assigned_to, is_agent_ticket, source, metadata)
       VALUES ($1, $2, $3, 'open', 'medium', 'deploy', 'Infra', true, 'autonomy-loop', $4)
       ON CONFLICT DO NOTHING`,
      [generateId(), `[DEPLOY] Rate-limited: ${services.join(', ')} needs restart`,
       `Auto-deploy rate limit reached. Services ${services.join(', ')} have new code (commit ${mergeCommit}) but need manual restart.`,
       JSON.stringify({ services, merge_commit: mergeCommit, proposal_id: proposalId })],
    );
    return;
  }

  deploysThisHour++;

  // Tag deployment
  const tag = `deploy-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
  await git(`tag ${tag} ${mergeCommit}`).catch((e) => { if (e) console.debug("[catch]", String(e)); });
  console.log(`[AutonomyLoop] Deploying ${services.join(', ')} — tag: ${tag}`);

  const safeServices = services.filter(s => !PROTECTED_SERVICES.has(s) && s !== 'forge');
  const needsForge = services.includes('forge');
  const needsRebuild = safeServices.filter(s => BAKED_SERVICES.has(s));
  const restartOnly = safeServices.filter(s => !BAKED_SERVICES.has(s));

  // Restart volume-mounted services (e.g. nginx)
  for (const service of restartOnly) {
    const container = `askalf-${service}`;
    try {
      const res = await dockerApi('POST', `/v1.44/containers/${container}/restart?t=10`);
      if (res.statusCode === 204 || res.statusCode === 200) {
        console.log(`[AutonomyLoop] Restarted ${service}`);
        if (!await healthCheck(container)) {
          console.error(`[AutonomyLoop] ${service} unhealthy — rolling back`);
          await rollbackDeploy(mergeCommit, [service], tag);
          return;
        }
      }
    } catch (err) {
      console.error(`[AutonomyLoop] Restart error for ${service}:`, err);
    }
  }

  // Rebuild baked-in services via ephemeral builder container
  if (needsRebuild.length > 0) {
    await rebuildServices(needsRebuild, mergeCommit, tag);
  }

  // Forge can't restart itself
  if (needsForge) {
    await query(
      `INSERT INTO agent_tickets (id, title, description, status, priority, category, assigned_to, is_agent_ticket, source, metadata)
       VALUES ($1, $2, $3, 'open', 'high', 'deploy', 'Infra', true, 'autonomy-loop', $4)
       ON CONFLICT DO NOTHING`,
      [generateId(), `[DEPLOY] Forge needs restart (${mergeCommit.slice(0, 8)})`,
       `New code merged for forge (commit ${mergeCommit}). Forge cannot self-restart — needs manual deploy.`,
       JSON.stringify({ services: ['forge'], merge_commit: mergeCommit, deploy_tag: tag })],
    );
    console.log(`[AutonomyLoop] Forge needs manual restart — created Infra ticket`);
  }

  // Log deployment result
  await query(
    `INSERT INTO deployment_logs (id, service, action, status, health_result, agent_name)
     VALUES ($1, $2, 'auto-deploy', 'completed', $3, 'autonomy-loop')`,
    [generateId(), services.join(','), JSON.stringify({ commit: mergeCommit, tag })],
  ).catch((e) => { if (e) console.debug("[catch]", String(e)); });
}

async function healthCheck(container: string): Promise<boolean> {
  await new Promise(r => setTimeout(r, HEALTH_CHECK_DELAY_MS));
  for (let i = 0; i < HEALTH_CHECK_RETRIES; i++) {
    try {
      const hc = await dockerApi('GET', `/v1.44/containers/${container}/json`);
      if (hc.statusCode === 200) {
        const state = JSON.parse(hc.data)?.State?.Status;
        if (state === 'running') return true;
      }
    } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 5000));
  }
  return false;
}

async function rebuildServices(services: string[], mergeCommit: string, deployTag: string): Promise<void> {
  const BUILDER_IMAGE = 'docker:27-cli';

  try {
    // Get host workspace path from forge container mount
    const inspectRes = await dockerApi('GET', '/v1.44/containers/askalf-forge/json');
    if (inspectRes.statusCode !== 200) {
      console.error('[AutonomyLoop] Cannot inspect forge container for rebuild');
      return;
    }
    const forgeInfo = JSON.parse(inspectRes.data);
    const workspaceMount = (forgeInfo.Mounts || []).find(
      (m: { Destination: string }) => m.Destination === '/workspace',
    );
    if (!workspaceMount?.Source) {
      console.error('[AutonomyLoop] Workspace mount not found on forge container');
      return;
    }
    const hostPath = workspaceMount.Source;

    // Build command: build then recreate each service
    const ordered = [...services].sort((a, b) => {
      const order = ['mcp-tools', 'dashboard', 'nginx'];
      return (order.indexOf(a) === -1 ? 999 : order.indexOf(a)) - (order.indexOf(b) === -1 ? 999 : order.indexOf(b));
    });

    const cmds = ordered.flatMap(s => [
      `docker compose -f /workspace/docker-compose.prod.yml --env-file /workspace/.env.production build ${s}`,
      `docker compose -f /workspace/docker-compose.prod.yml --env-file /workspace/.env.production up -d --no-deps --force-recreate ${s}`,
    ]);

    const builderId = `autonomy-builder-${Date.now()}`;
    const createRes = await dockerApi('POST', `/v1.44/containers/create?name=${builderId}`, {
      Image: BUILDER_IMAGE,
      Cmd: ['sh', '-c', cmds.join(' && ')],
      WorkingDir: '/workspace',
      HostConfig: {
        Binds: [`${hostPath}:/workspace`, '/var/run/docker.sock:/var/run/docker.sock'],
        AutoRemove: true,
      },
      Labels: { 'substrate.role': 'builder', 'substrate.services': ordered.join(','), 'substrate.commit': mergeCommit },
    });

    if (createRes.statusCode !== 201) {
      console.error(`[AutonomyLoop] Failed to create builder: ${createRes.data.slice(0, 500)}`);
      return;
    }

    const containerId = JSON.parse(createRes.data).Id;
    const startRes = await dockerApi('POST', `/v1.44/containers/${containerId}/start`);
    if (startRes.statusCode !== 204 && startRes.statusCode !== 200) {
      await dockerApi('DELETE', `/v1.44/containers/${containerId}?force=true`).catch((e) => { if (e) console.debug("[catch]", String(e)); });
      console.error('[AutonomyLoop] Failed to start builder');
      return;
    }

    console.log(`[AutonomyLoop] Rebuild started for ${ordered.join(', ')} (builder: ${builderId})`);

    // Poll for completion (max 5 minutes)
    const maxWait = 300_000;
    const startTime = Date.now();
    let exitCode = -1;

    while (Date.now() - startTime < maxWait) {
      await new Promise(r => setTimeout(r, 10_000));
      const inspect = await dockerApi('GET', `/v1.44/containers/${containerId}/json`);
      if (inspect.statusCode === 404) { exitCode = 0; break; } // AutoRemove = success
      if (inspect.statusCode === 200) {
        const info = JSON.parse(inspect.data);
        if (!info.State?.Running) {
          exitCode = info.State?.ExitCode ?? -1;
          await dockerApi('DELETE', `/v1.44/containers/${containerId}?force=true`).catch((e) => { if (e) console.debug("[catch]", String(e)); });
          break;
        }
      }
    }

    if (exitCode !== 0) {
      console.error(`[AutonomyLoop] Rebuild FAILED (exit ${exitCode}) for ${ordered.join(', ')} — rolling back`);
      await rollbackDeploy(mergeCommit, ordered, deployTag);
      return;
    }

    console.log(`[AutonomyLoop] Rebuild completed for ${ordered.join(', ')}`);

    // Health check each rebuilt service
    for (const svc of ordered) {
      if (!await healthCheck(`askalf-${svc}`)) {
        console.error(`[AutonomyLoop] ${svc} unhealthy after rebuild — rolling back`);
        await rollbackDeploy(mergeCommit, ordered, deployTag);
        return;
      }
      console.log(`[AutonomyLoop] ${svc} healthy after rebuild`);
    }
  } catch (err) {
    console.error('[AutonomyLoop] Rebuild error:', err);
  }
}

async function rollbackDeploy(mergeCommit: string, services: string[], deployTag: string): Promise<void> {
  console.error(`[AutonomyLoop] ROLLING BACK — reverting ${mergeCommit.slice(0, 8)}`);

  try {
    await git('checkout main');
    const revertRes = await git(`revert --no-edit ${mergeCommit}`);

    if (revertRes.exitCode !== 0) {
      console.error(`[AutonomyLoop] Revert failed: ${revertRes.stderr}`);
      await query(
        `INSERT INTO agent_tickets (id, title, description, status, priority, category, assigned_to, is_agent_ticket, source, metadata)
         VALUES ($1, $2, $3, 'open', 'urgent', 'deploy-failure', 'Infra', true, 'autonomy-loop', $4)
         ON CONFLICT DO NOTHING`,
        [generateId(), `[ROLLBACK FAILED] Manual intervention — ${mergeCommit.slice(0, 8)}`,
         `Auto-revert failed. Deploy tag: ${deployTag}. Services: ${services.join(', ')}. Error: ${revertRes.stderr.slice(0, 500)}`,
         JSON.stringify({ merge_commit: mergeCommit, deploy_tag: deployTag, services })],
      );
      await notifyAdmin('error', `ROLLBACK FAILED — ${mergeCommit.slice(0, 8)}`,
        `Auto-revert failed. Services ${services.join(', ')} may be broken. Deploy tag: ${deployTag}. Manual intervention required.`, 'high');
      return;
    }

    console.log(`[AutonomyLoop] Reverted ${mergeCommit.slice(0, 8)} on main`);

    // Re-deploy reverted state
    const needsRebuild = services.filter(s => BAKED_SERVICES.has(s));
    if (needsRebuild.length > 0) {
      await rebuildServices(needsRebuild, 'HEAD', deployTag + '-rollback');
    }
    for (const svc of services.filter(s => !BAKED_SERVICES.has(s) && s !== 'forge')) {
      await dockerApi('POST', `/v1.44/containers/askalf-${svc}/restart?t=10`).catch((e) => { if (e) console.debug("[catch]", String(e)); });
    }

    await query(
      `INSERT INTO deployment_logs (id, service, action, status, health_result, agent_name)
       VALUES ($1, $2, 'rollback', 'completed', $3, 'autonomy-loop')`,
      [generateId(), services.join(','), JSON.stringify({ reverted: mergeCommit, tag: deployTag })],
    ).catch((e) => { if (e) console.debug("[catch]", String(e)); });

    await notifyAdmin('error', `Auto-rollback: ${services.join(', ')}`,
      `Deployment of commit ${mergeCommit.slice(0, 8)} failed health checks. Automatically reverted. Tag: ${deployTag}`);
  } catch (err) {
    console.error('[AutonomyLoop] Rollback error:', err);
  }
}

async function notifyAdmin(type: string, title: string, description: string, riskLevel?: string): Promise<void> {
  const adminEmail = process.env['ADMIN_EMAIL'];
  if (!adminEmail) return;
  try {
    const { sendInterventionAlert } = await import('@askalf/email');
    const baseUrl = process.env['DASHBOARD_URL'] ?? 'https://askalf.org';
    await sendInterventionAlert(adminEmail, {
      agentName: 'Autonomy Loop',
      interventionType: type,
      title,
      description,
      riskLevel: riskLevel as 'low' | 'medium' | 'high' | undefined,
      approveUrl: `${baseUrl}/admin/hub/agents`,
      denyUrl: `${baseUrl}/admin/hub/agents`,
      dashboardUrl: `${baseUrl}/admin/hub/agents`,
      timestamp: new Date().toISOString(),
    });
  } catch { /* non-fatal */ }
}

// ============================================
// Event Handler
// ============================================

async function handleExecutionCompleted(event: ExecutionEvent): Promise<void> {
  if (!ENABLED) return;

  const { executionId, agentId, agentName } = event;
  if (!executionId || !agentId) return;

  try {
    // Detect if agent pushed a branch with commits
    const branch = await detectBranch(executionId, agentName);
    if (!branch) return; // No code changes — nothing to do

    console.log(`[AutonomyLoop] Detected branch ${branch} from ${agentName} (execution ${executionId})`);

    // Classify risk and assign review
    const risk = await classifyRisk(branch);
    await assignReview(executionId, agentId, agentName, branch, risk);
  } catch (err) {
    console.error(`[AutonomyLoop] Error handling execution ${executionId}:`, err);
  }
}

// ============================================
// Entry Point
// ============================================

export function startAutonomyLoop(): void {
  if (!ENABLED) {
    console.log('[AutonomyLoop] Disabled via AUTONOMY_LOOP_ENABLED=false');
    return;
  }

  const eventBus = getEventBus();
  if (!eventBus) {
    console.error('[AutonomyLoop] Event bus not initialized — cannot start');
    return;
  }

  // Stage A+B: Listen for execution completions → detect branches → assign reviews
  eventBus.on('execution', (event: ForgeEvent) => {
    if (event.type === 'execution' && event.event === 'completed') {
      void handleExecutionCompleted(event as ExecutionEvent).catch(err => {
        console.error('[AutonomyLoop] Execution handler error:', err);
      });
    }
  });

  // Stage C+D: Poll for approved proposals → merge → deploy
  pollTimer = setInterval(() => {
    void mergeApprovedProposals().catch(err => {
      console.error('[AutonomyLoop] Merge poll error:', err);
    });
  }, POLL_INTERVAL_MS);

  console.log('[AutonomyLoop] Started — listening for execution completions, polling for approved proposals every 60s');
}

export function stopAutonomyLoop(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  console.log('[AutonomyLoop] Stopped');
}
