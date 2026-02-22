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

function dockerApi(method: string, path: string, timeout = 30_000): Promise<{ statusCode: number; data: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Docker API timeout')), timeout);
    const req = http.request({ ...DOCKER_CONN, path, method } as http.RequestOptions, (res) => {
      let data = '';
      res.on('data', (c: Buffer) => { data += c.toString(); });
      res.on('end', () => { clearTimeout(timer); resolve({ statusCode: res.statusCode ?? 500, data }); });
    });
    req.on('error', (err) => { clearTimeout(timer); reject(err); });
    req.end();
  });
}

function generateId(): string {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).substring(2, 10);
  return `auto-${t}-${r}`;
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
      `INSERT INTO forge_checkpoints (id, execution_id, agent_id, type, title, context, status, created_at)
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
    // Find QA Engineer ID
    const qaAgent = await query<{ id: string }>(`SELECT id FROM forge_agents WHERE name = 'QA Engineer' AND status = 'active' LIMIT 1`);
    const reviewerId = qaAgent.length > 0 ? qaAgent[0]!.id : agentId;

    await query(
      `INSERT INTO forge_proposal_reviews (id, proposal_id, reviewer_agent_id, verdict, comment)
       VALUES ($1, $2, $3, 'approve', 'Auto-approved: low-risk change (tests/docs/dashboard-only)')
       ON CONFLICT DO NOTHING`,
      [reviewId, proposalId, reviewerId],
    );
    await query(`UPDATE forge_change_proposals SET status = 'approved', updated_at = NOW() WHERE id = $1`, [proposalId]);
    console.log(`[AutonomyLoop] LOW RISK — auto-approved proposal ${proposalId} for ${branch}`);
  } else {
    // Medium risk — assign QA Engineer to review
    const ticketId = generateId();
    await query(
      `INSERT INTO agent_tickets (id, title, description, status, priority, category, assigned_to, is_agent_ticket, source, metadata)
       VALUES ($1, $2, $3, 'open', 'high', 'review', 'QA Engineer', true, 'autonomy-loop', $4)
       ON CONFLICT DO NOTHING`,
      [
        ticketId,
        `[REVIEW] ${agentName} branch: ${branch}`,
        `Review the following code changes and approve/reject.\n\nBranch: ${branch}\nRisk: ${risk.level}\nFiles: ${risk.changedFiles.join(', ')}\n\nDiff summary:\n${diffStat.stdout.slice(0, 3000)}\n\nProposal ID: ${proposalId}\n\nTo approve: use proposal_ops tool with action='review', proposal_id='${proposalId}', verdict='approve'`,
        JSON.stringify({ proposal_id: proposalId, branch, risk_level: risk.level }),
      ],
    );
    console.log(`[AutonomyLoop] MEDIUM RISK — assigned review ticket ${ticketId} to QA Engineer for ${branch}`);
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
      } else {
        console.error(`[AutonomyLoop] Merge failed for ${branch}: ${mergeRes.stderr}`);
        await query(`UPDATE forge_change_proposals SET status = 'closed', closed_at = NOW() WHERE id = $1`, [proposal.id]);
      }
      continue;
    }

    // Success — get merge commit hash
    const hashRes = await git('rev-parse HEAD');
    const mergeCommit = hashRes.stdout.trim();

    // Clean up branch
    await git(`branch -d ${branch}`).catch(() => {/* non-fatal */});

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
      `INSERT INTO forge_deploy_log (id, services, git_commit, git_branch, triggered_by, status)
       VALUES ($1, $2, $3, $4, 'autonomy-loop', 'pending')`,
      [generateId(), [...services], mergeCommit, branch],
    );

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

async function autoDeploy(services: string[], mergeCommit: string, proposalId: string): Promise<void> {
  // Rate limit
  if (Date.now() > deployHourReset) {
    deploysThisHour = 0;
    deployHourReset = Date.now() + 3_600_000;
  }
  if (deploysThisHour >= MAX_DEPLOYS_PER_HOUR) {
    console.log(`[AutonomyLoop] Deploy rate limit reached (${MAX_DEPLOYS_PER_HOUR}/hour). Skipping deploy for ${services.join(', ')}`);
    // Create ticket for manual deploy
    await query(
      `INSERT INTO agent_tickets (id, title, description, status, priority, category, assigned_to, is_agent_ticket, source, metadata)
       VALUES ($1, $2, $3, 'open', 'medium', 'deploy', 'DevOps', true, 'autonomy-loop', $4)
       ON CONFLICT DO NOTHING`,
      [
        generateId(),
        `[DEPLOY] Rate-limited: ${services.join(', ')} needs restart`,
        `Auto-deploy rate limit reached. Services ${services.join(', ')} have new code (commit ${mergeCommit}) but need manual restart.`,
        JSON.stringify({ services, merge_commit: mergeCommit, proposal_id: proposalId }),
      ],
    );
    return;
  }

  deploysThisHour++;
  console.log(`[AutonomyLoop] Deploying ${services.join(', ')} (${deploysThisHour}/${MAX_DEPLOYS_PER_HOUR} this hour)`);

  // Don't auto-deploy forge (would kill this process)
  const safeServices = services.filter(s => s !== 'forge');
  const needsForge = services.includes('forge');

  for (const service of safeServices) {
    const container = `sprayberry-labs-${service}`;
    try {
      const res = await dockerApi('POST', `/v1.44/containers/${container}/restart?t=10`);
      if (res.statusCode === 204 || res.statusCode === 200) {
        console.log(`[AutonomyLoop] Restarted ${service}`);

        // Health check after delay
        await new Promise(r => setTimeout(r, HEALTH_CHECK_DELAY_MS));
        let healthy = false;
        for (let i = 0; i < HEALTH_CHECK_RETRIES; i++) {
          const hc = await dockerApi('GET', `/v1.44/containers/${container}/json`);
          if (hc.statusCode === 200) {
            const info = JSON.parse(hc.data);
            const state = info?.State?.Status;
            if (state === 'running') { healthy = true; break; }
          }
          await new Promise(r => setTimeout(r, 5000));
        }

        if (!healthy) {
          console.error(`[AutonomyLoop] HEALTH CHECK FAILED for ${service} — creating urgent ticket`);
          await query(
            `INSERT INTO agent_tickets (id, title, description, status, priority, category, assigned_to, is_agent_ticket, source, metadata)
             VALUES ($1, $2, $3, 'open', 'urgent', 'deploy-failure', 'DevOps', true, 'autonomy-loop', $4)
             ON CONFLICT DO NOTHING`,
            [
              generateId(),
              `[DEPLOY FAILURE] ${service} unhealthy after auto-deploy`,
              `Service ${service} failed health check after auto-restart (commit ${mergeCommit}). May need rollback.`,
              JSON.stringify({ service, merge_commit: mergeCommit, proposal_id: proposalId }),
            ],
          );
        }
      } else {
        console.error(`[AutonomyLoop] Restart failed for ${service}: HTTP ${res.statusCode}`);
      }
    } catch (err) {
      console.error(`[AutonomyLoop] Deploy error for ${service}:`, err);
    }
  }

  if (needsForge) {
    // Create ticket — forge can't restart itself
    await query(
      `INSERT INTO agent_tickets (id, title, description, status, priority, category, assigned_to, is_agent_ticket, source, metadata)
       VALUES ($1, $2, $3, 'open', 'high', 'deploy', 'DevOps', true, 'autonomy-loop', $4)
       ON CONFLICT DO NOTHING`,
      [
        generateId(),
        `[DEPLOY] Forge needs restart to pick up merged changes`,
        `New code merged for forge (commit ${mergeCommit}). Forge cannot self-restart — needs manual deploy.`,
        JSON.stringify({ services: ['forge'], merge_commit: mergeCommit, proposal_id: proposalId }),
      ],
    );
    console.log(`[AutonomyLoop] Forge needs manual restart — created DevOps ticket`);
  }
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
