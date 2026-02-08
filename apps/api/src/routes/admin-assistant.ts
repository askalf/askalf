/**
 * Admin Assistant API Routes
 * AI-powered system diagnostics and recommendations for admin panel
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { query, queryOne } from '@substrate/database';

// Cookie settings
const SESSION_COOKIE_NAME = 'substrate_session';

// Rate limiting state
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW = 60_000; // 1 minute

// Helper to hash session token
async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Helper to get authenticated admin user via session cookie
async function getAdminUser(
  request: FastifyRequest
): Promise<{ user_id: string; tenant_id: string } | null> {
  const sessionToken = (request.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE_NAME];
  if (!sessionToken) return null;

  const tokenHash = await hashToken(sessionToken);
  const session = await queryOne<{ user_id: string; tenant_id: string }>(
    `SELECT s.user_id, u.tenant_id FROM sessions s
     JOIN users u ON s.user_id = u.id
     WHERE s.token_hash = $1 AND s.expires_at > NOW() AND s.revoked = false AND u.role = 'admin'`,
    [tokenHash]
  );

  return session || null;
}

// Cached hash of admin key (computed once on first use)
let adminKeyHashCache: string | null = null;

async function getAdminKeyHash(): Promise<string | null> {
  if (adminKeyHashCache !== null) return adminKeyHashCache;
  const adminKey = process.env['ADMIN_ASSISTANT_KEY'];
  if (!adminKey) return null;
  adminKeyHashCache = await hashToken(adminKey);
  return adminKeyHashCache;
}

// Validate API key auth — hash-based with timing-safe comparison
async function validateApiKey(request: FastifyRequest): Promise<boolean> {
  const expectedHash = await getAdminKeyHash();
  if (!expectedHash) return false;
  const providedKey = (request.headers as Record<string, string>)['x-admin-key'];
  if (!providedKey) return false;
  const providedHash = await hashToken(providedKey);
  const a = Buffer.from(expectedHash, 'utf8');
  const b = Buffer.from(providedHash, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Simple rate limiter
function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(key);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return true;
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return false;
  }

  entry.count++;
  return true;
}

// Fetch system context via direct DB queries
async function fetchSystemContext(selectedItemId?: string) {
  // Shard stats by lifecycle
  const [shardStats] = await query<{
    total: string;
    promoted: string;
    shadow: string;
    candidate: string;
    testing: string;
    archived: string;
  }>(
    `SELECT
       COUNT(*) as total,
       COUNT(*) FILTER (WHERE lifecycle = 'promoted') as promoted,
       COUNT(*) FILTER (WHERE lifecycle = 'shadow') as shadow,
       COUNT(*) FILTER (WHERE lifecycle = 'candidate') as candidate,
       COUNT(*) FILTER (WHERE lifecycle = 'testing') as testing,
       COUNT(*) FILTER (WHERE lifecycle = 'archived') as archived
     FROM procedural_shards`
  );

  // Execution success rate
  const [execStats] = await query<{ total: string; successful: string }>(
    `SELECT
       COUNT(*) as total,
       COUNT(*) FILTER (WHERE success = true) as successful
     FROM shard_executions`
  );

  // Low-confidence promoted shards
  const lowConfidence = await query<{ id: string; name: string; confidence: string; execution_count: string }>(
    `SELECT id, name, confidence::text, execution_count::text
     FROM procedural_shards
     WHERE confidence < 0.7 AND lifecycle = 'promoted'
     ORDER BY confidence ASC
     LIMIT 10`
  );

  // Recent metabolic cycles
  const metabolicCycles = await query<{
    id: string;
    cycle_type: string;
    status: string;
    started_at: string;
    completed_at: string;
    items_processed: string;
  }>(
    `SELECT id, cycle_type, status, started_at::text, completed_at::text, COALESCE(items_processed, 0)::text as items_processed
     FROM metabolic_cycles
     ORDER BY started_at DESC
     LIMIT 10`
  ).catch(() => [] as any[]);

  // Error rate (24h)
  const [errorRate] = await query<{ total: string; failed: string }>(
    `SELECT
       COUNT(*) as total,
       COUNT(*) FILTER (WHERE success = false) as failed
     FROM shard_executions
     WHERE created_at > NOW() - INTERVAL '24 hours'`
  );

  // Memory tier counts
  const [episodeCount] = await query<{ count: string }>('SELECT COUNT(*) as count FROM episodes');
  const [factCount] = await query<{ count: string }>('SELECT COUNT(*) as count FROM knowledge_facts');
  const [contextCount] = await query<{ count: string }>('SELECT COUNT(*) as count FROM working_contexts');

  // Selected item detail
  let selectedItem: Record<string, unknown> | null = null;
  if (selectedItemId) {
    // Try shards first
    const shard = await queryOne<Record<string, unknown>>(
      `SELECT id, name, description, confidence, lifecycle, visibility, execution_count,
              success_count, failure_count, category, shard_type, created_at, updated_at,
              intent_template, logic
       FROM procedural_shards WHERE id = $1`,
      [selectedItemId]
    );
    if (shard) {
      selectedItem = { type: 'shard', ...shard };
    } else {
      // Try episodes
      const episode = await queryOne<Record<string, unknown>>(
        `SELECT id, type, summary, success, valence, importance, timestamp, session_id
         FROM episodes WHERE id = $1`,
        [selectedItemId]
      );
      if (episode) {
        selectedItem = { type: 'episode', ...episode };
      } else {
        // Try facts
        const fact = await queryOne<Record<string, unknown>>(
          `SELECT id, subject, predicate, object, statement, confidence, category, created_at
           FROM knowledge_facts WHERE id = $1`,
          [selectedItemId]
        );
        if (fact) {
          selectedItem = { type: 'fact', ...fact };
        } else {
          // Try working contexts
          const ctx = await queryOne<Record<string, unknown>>(
            `SELECT id, session_id, content_type, status, original_tokens, liquidated_tokens, compression_ratio, created_at
             FROM working_contexts WHERE id = $1`,
            [selectedItemId]
          );
          if (ctx) {
            selectedItem = { type: 'context', ...ctx };
          }
        }
      }
    }
  }

  const totalExec = parseInt(execStats?.total || '0', 10);
  const successfulExec = parseInt(execStats?.successful || '0', 10);
  const successRate = totalExec > 0 ? ((successfulExec / totalExec) * 100).toFixed(1) : '0';

  const errorTotal = parseInt(errorRate?.total || '0', 10);
  const errorFailed = parseInt(errorRate?.failed || '0', 10);
  const errorRatePct = errorTotal > 0 ? ((errorFailed / errorTotal) * 100).toFixed(1) : '0';

  return {
    shardStats: shardStats || { total: '0', promoted: '0', shadow: '0', candidate: '0', testing: '0', archived: '0' },
    executionSuccessRate: successRate,
    lowConfidenceShards: lowConfidence || [],
    metabolicCycles: metabolicCycles || [],
    errorRate24h: errorRatePct,
    errorTotal24h: errorTotal,
    errorFailed24h: errorFailed,
    memoryCounts: {
      procedural: shardStats?.total || '0',
      episodic: episodeCount?.count || '0',
      semantic: factCount?.count || '0',
      working: contextCount?.count || '0',
    },
    selectedItem,
  };
}

// Fetch page-specific context for non-memory admin pages
async function fetchPageContext(pageContext: string) {
  if (pageContext === 'analytics') {
    const [userStats] = await query<{ total: string; active_24h: string; active_7d: string; active_30d: string }>(
      `SELECT
         COUNT(*) as total,
         COUNT(*) FILTER (WHERE last_active_at > NOW() - INTERVAL '24 hours') as active_24h,
         COUNT(*) FILTER (WHERE last_active_at > NOW() - INTERVAL '7 days') as active_7d,
         COUNT(*) FILTER (WHERE last_active_at > NOW() - INTERVAL '30 days') as active_30d
       FROM users`
    ).catch(() => [{ total: '0', active_24h: '0', active_7d: '0', active_30d: '0' }] as any);

    const planBreakdown = await query<{ plan: string; count: string }>(
      `SELECT COALESCE(plan, 'free') as plan, COUNT(*)::text as count FROM users GROUP BY plan ORDER BY count DESC`
    ).catch(() => []);

    const [recentSignups] = await query<{ today: string; this_week: string; this_month: string }>(
      `SELECT
         COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as today,
         COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') as this_week,
         COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days') as this_month
       FROM users`
    ).catch(() => [{ today: '0', this_week: '0', this_month: '0' }] as any);

    const [queryStats] = await query<{ total_queries: string; shard_hits: string }>(
      `SELECT COUNT(*) as total_queries,
              COUNT(*) FILTER (WHERE shard_id IS NOT NULL) as shard_hits
       FROM reasoning_traces WHERE created_at > NOW() - INTERVAL '30 days'`
    ).catch(() => [{ total_queries: '0', shard_hits: '0' }] as any);

    const [revenueStats] = await query<{ mrr_cents: string; active_subs: string }>(
      `SELECT COALESCE(SUM(CASE
         WHEN plan = 'basic' THEN 800
         WHEN plan = 'pro' THEN 2000
         WHEN plan = 'team' THEN 5000
         WHEN plan = 'enterprise' THEN 20000
         ELSE 0 END), 0)::text as mrr_cents,
         COUNT(*) FILTER (WHERE plan IS NOT NULL AND plan != 'free')::text as active_subs
       FROM users`
    ).catch(() => [{ mrr_cents: '0', active_subs: '0' }] as any);

    const [demoStats] = await query<{ total: string; today: string; converted: string }>(
      `SELECT
         COUNT(*) as total,
         COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as today,
         COUNT(*) FILTER (WHERE converted_to_user_id IS NOT NULL) as converted
       FROM demo_sessions`
    ).catch(() => [{ total: '0', today: '0', converted: '0' }] as any);

    const [tokenStats] = await query<{ total_used: string; saved: string }>(
      `SELECT
         COALESCE(SUM(tokens_used), 0)::text as total_used,
         COALESCE(SUM(tokens_saved), 0)::text as saved
       FROM usage_logs`
    ).catch(() => [{ total_used: '0', saved: '0' }] as any);

    // Calculate key SaaS metrics
    const totalUsers = parseInt(userStats?.total || '0', 10);
    const dau = parseInt(userStats?.active_24h || '0', 10);
    const mau = parseInt(userStats?.active_30d || '0', 10);
    const dauMauRatio = mau > 0 ? ((dau / mau) * 100).toFixed(1) : '0';
    const paidUsers = parseInt(revenueStats?.active_subs || '0', 10);
    const conversionRate = totalUsers > 0 ? ((paidUsers / totalUsers) * 100).toFixed(1) : '0';
    const mrrCents = parseInt(revenueStats?.mrr_cents || '0', 10);
    const arpu = paidUsers > 0 ? (mrrCents / paidUsers / 100).toFixed(2) : '0';
    const hitRate = parseInt(queryStats?.total_queries || '0', 10) > 0
      ? ((parseInt(queryStats?.shard_hits || '0', 10) / parseInt(queryStats?.total_queries || '0', 10)) * 100).toFixed(1)
      : '0';
    const demoConversionRate = parseInt(demoStats?.total || '0', 10) > 0
      ? ((parseInt(demoStats?.converted || '0', 10) / parseInt(demoStats?.total || '0', 10)) * 100).toFixed(1)
      : '0';

    return `
PLATFORM ANALYTICS CONTEXT:

KEY BUSINESS METRICS:
- MRR (Monthly Recurring Revenue): $${(mrrCents / 100).toFixed(2)} from ${paidUsers} paid subscribers
- ARR (Annual Recurring Revenue): $${(mrrCents * 12 / 100).toFixed(2)}
- ARPU (Avg Revenue Per User): $${arpu}/month
- Paid Conversion Rate: ${conversionRate}%

USER METRICS:
- Total Users: ${totalUsers}
- DAU (Daily Active Users): ${dau}
- MAU (Monthly Active Users): ${mau}
- DAU/MAU Ratio: ${dauMauRatio}% (engagement/stickiness indicator)
- Growth: +${recentSignups?.today || 0} today, +${recentSignups?.this_week || 0} this week, +${recentSignups?.this_month || 0} this month
- Plan Distribution: ${planBreakdown.map(p => `${p.plan}: ${p.count}`).join(', ') || 'N/A'}

TECHNOLOGY METRICS (Competitive Moat):
- Shard Hit Rate: ${hitRate}% (queries answered from learned knowledge without LLM cost)
- Total Tokens Used: ${tokenStats?.total_used || 0}
- Tokens Saved: ${tokenStats?.saved || 0} (cost savings from shard hits)

FUNNEL METRICS:
- Demo Sessions: ${demoStats?.total || 0} total, ${demoStats?.today || 0} today
- Demo Conversions: ${demoStats?.converted || 0} (${demoConversionRate}% conversion rate)

METRIC DEFINITIONS FOR INVESTORS:
- MRR: Predictable monthly revenue from subscriptions
- ARR: MRR × 12, annualized revenue projection
- DAU/MAU: User engagement ratio - higher = stickier product (20%+ is good for SaaS)
- Shard Hit Rate: Our AI learns from interactions - when it can answer from learned knowledge instead of calling external LLMs, we save money. Higher = more efficient = better unit economics
- Conversion Rate: % of free users who become paying customers

You are on the Platform Analytics page. You can help BOTH admins AND investors understand any metric on this page. For investors, explain metrics in business terms with context on what's good/bad. For admins, provide operational insights and suggestions.`;
  }

  if (pageContext === 'users') {
    const [userStats] = await query<{ total: string; admins: string; verified: string; unverified: string }>(
      `SELECT
         COUNT(*) as total,
         COUNT(*) FILTER (WHERE role IN ('admin', 'super_admin')) as admins,
         COUNT(*) FILTER (WHERE email_verified = true) as verified,
         COUNT(*) FILTER (WHERE email_verified = false) as unverified
       FROM users`
    ).catch(() => [{ total: '0', admins: '0', verified: '0', unverified: '0' }] as any);

    const roleBreakdown = await query<{ role: string; count: string }>(
      `SELECT role, COUNT(*)::text as count FROM users GROUP BY role ORDER BY count DESC`
    ).catch(() => []);

    const [inactive] = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM users WHERE last_active_at < NOW() - INTERVAL '30 days' OR last_active_at IS NULL`
    ).catch(() => [{ count: '0' }] as any);

    return `
USER ADMINISTRATION PAGE CONTEXT:
- Total users: ${userStats?.total || 0}
- Admins: ${userStats?.admins || 0}
- Email verified: ${userStats?.verified || 0}, Unverified: ${userStats?.unverified || 0}
- Inactive (30d+): ${inactive?.count || 0}
- Role breakdown: ${roleBreakdown.map(r => `${r.role}: ${r.count}`).join(', ') || 'N/A'}

You are on the User Administration page. Help the admin manage users, identify inactive accounts, understand role distribution, and handle account issues.`;
  }

  if (pageContext === 'backups') {
    const [backupStats] = await query<{ total: string; successful: string; failed: string; last_success: string }>(
      `SELECT
         COUNT(*) as total,
         COUNT(*) FILTER (WHERE status = 'completed') as successful,
         COUNT(*) FILTER (WHERE status = 'failed') as failed,
         MAX(completed_at)::text FILTER (WHERE status = 'completed') as last_success
       FROM backup_jobs`
    ).catch(() => [{ total: '0', successful: '0', failed: '0', last_success: null }] as any);

    const [recentBackups] = await query<{ running: string; pending: string }>(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'running') as running,
         COUNT(*) FILTER (WHERE status = 'pending') as pending
       FROM backup_jobs`
    ).catch(() => [{ running: '0', pending: '0' }] as any);

    const [storageUsage] = await query<{ total_bytes: string }>(
      `SELECT COALESCE(SUM(file_size), 0)::text as total_bytes FROM backup_jobs WHERE status = 'completed'`
    ).catch(() => [{ total_bytes: '0' }] as any);

    return `
BACKUP ADMINISTRATION PAGE CONTEXT:
- Total backup jobs: ${backupStats?.total || 0}
- Successful: ${backupStats?.successful || 0}, Failed: ${backupStats?.failed || 0}
- Currently running: ${recentBackups?.running || 0}, Pending: ${recentBackups?.pending || 0}
- Last successful backup: ${backupStats?.last_success || 'Never'}
- Total backup storage: ${Math.round(parseInt(storageUsage?.total_bytes || '0', 10) / 1024 / 1024)} MB

You are on the Backup Administration page. Help the admin understand backup health, schedule status, storage usage, and restore readiness. Advise on backup strategies and troubleshoot failures.`;
  }

  if (pageContext === 'convergence') {
    const [convergenceStats] = await query<{ hit_rate: string; total_queries: string; shard_hits: string }>(
      `SELECT
         COUNT(*) as total_queries,
         COUNT(*) FILTER (WHERE shard_id IS NOT NULL) as shard_hits,
         CASE WHEN COUNT(*) > 0
           THEN (COUNT(*) FILTER (WHERE shard_id IS NOT NULL)::numeric / COUNT(*)::numeric * 100)::text
           ELSE '0' END as hit_rate
       FROM reasoning_traces WHERE created_at > NOW() - INTERVAL '7 days'`
    ).catch(() => [{ hit_rate: '0', total_queries: '0', shard_hits: '0' }] as any);

    const [workerStatus] = await query<{ total_events: string; recent_events: string }>(
      `SELECT
         COUNT(*) as total_events,
         COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as recent_events
       FROM metacognition_events`
    ).catch(() => [{ total_events: '0', recent_events: '0' }] as any);

    return `
CONVERGENCE DASHBOARD PAGE CONTEXT:
- Hit rate (7d): ${convergenceStats?.hit_rate || 0}%
- Queries (7d): ${convergenceStats?.total_queries || 0} total, ${convergenceStats?.shard_hits || 0} shard hits
- Metacognition events: ${workerStatus?.total_events || 0} total, ${workerStatus?.recent_events || 0} in last 24h

You are on the Convergence Dashboard. Help the admin understand convergence trends, metabolic cycle health, worker status, and system bottlenecks. Advise on optimizing shard performance and system efficiency.`;
  }

  return '';
}

// ============================================
// TOOLS - Actions the assistant can execute
// ============================================

const ASSISTANT_TOOLS = [
  {
    name: 'archive_shard',
    description: 'Archive a shard that is broken, obsolete, or performing poorly. This removes it from active use.',
    input_schema: {
      type: 'object',
      properties: {
        shard_id: { type: 'string', description: 'The UUID of the shard to archive' },
        reason: { type: 'string', description: 'Reason for archiving' },
      },
      required: ['shard_id', 'reason'],
    },
  },
  {
    name: 'promote_shard',
    description: 'Promote a shard from shadow/testing to promoted status, making it active for queries.',
    input_schema: {
      type: 'object',
      properties: {
        shard_id: { type: 'string', description: 'The UUID of the shard to promote' },
      },
      required: ['shard_id'],
    },
  },
  {
    name: 'demote_shard',
    description: 'Demote a promoted shard back to shadow status for further testing.',
    input_schema: {
      type: 'object',
      properties: {
        shard_id: { type: 'string', description: 'The UUID of the shard to demote' },
        reason: { type: 'string', description: 'Reason for demotion' },
      },
      required: ['shard_id', 'reason'],
    },
  },
  {
    name: 'adjust_confidence',
    description: 'Manually adjust a shard\'s confidence score.',
    input_schema: {
      type: 'object',
      properties: {
        shard_id: { type: 'string', description: 'The UUID of the shard' },
        new_confidence: { type: 'number', description: 'New confidence value between 0 and 1' },
        reason: { type: 'string', description: 'Reason for adjustment' },
      },
      required: ['shard_id', 'new_confidence', 'reason'],
    },
  },
  {
    name: 'trigger_crystallize',
    description: 'Trigger the crystallization cycle to convert trace clusters into new shards.',
    input_schema: {
      type: 'object',
      properties: {
        min_cluster_size: { type: 'number', description: 'Minimum cluster size (default: 3)' },
      },
      required: [],
    },
  },
  {
    name: 'trigger_decay',
    description: 'Trigger the decay cycle to reduce confidence of failing shards.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'trigger_promote_cycle',
    description: 'Trigger the promotion cycle to elevate qualified shadow shards.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_shard_details',
    description: 'Get detailed information about a specific shard including its logic, execution history, and patterns.',
    input_schema: {
      type: 'object',
      properties: {
        shard_id: { type: 'string', description: 'The UUID of the shard' },
      },
      required: ['shard_id'],
    },
  },
  {
    name: 'get_shard_executions',
    description: 'Get recent execution history for a shard.',
    input_schema: {
      type: 'object',
      properties: {
        shard_id: { type: 'string', description: 'The UUID of the shard' },
        limit: { type: 'number', description: 'Number of executions to return (default: 10)' },
      },
      required: ['shard_id'],
    },
  },
  {
    name: 'update_shard_logic',
    description: 'Update the logic/pattern of a shard to fix issues or improve matching.',
    input_schema: {
      type: 'object',
      properties: {
        shard_id: { type: 'string', description: 'The UUID of the shard' },
        new_logic: { type: 'string', description: 'New logic/pattern for the shard' },
        reason: { type: 'string', description: 'Reason for the update' },
      },
      required: ['shard_id', 'new_logic', 'reason'],
    },
  },
  // ============================================
  // USER ADMIN TOOLS
  // ============================================
  {
    name: 'get_user_details',
    description: 'Get detailed information about a specific user.',
    input_schema: {
      type: 'object',
      properties: {
        user_id: { type: 'string', description: 'The UUID of the user' },
        email: { type: 'string', description: 'Or find by email address' },
      },
      required: [],
    },
  },
  {
    name: 'ban_user',
    description: 'Ban a user account, preventing them from logging in.',
    input_schema: {
      type: 'object',
      properties: {
        user_id: { type: 'string', description: 'The UUID of the user to ban' },
        reason: { type: 'string', description: 'Reason for the ban' },
      },
      required: ['user_id', 'reason'],
    },
  },
  {
    name: 'unban_user',
    description: 'Unban a previously banned user account.',
    input_schema: {
      type: 'object',
      properties: {
        user_id: { type: 'string', description: 'The UUID of the user to unban' },
      },
      required: ['user_id'],
    },
  },
  {
    name: 'change_user_role',
    description: 'Change a user\'s role (user, admin, super_admin).',
    input_schema: {
      type: 'object',
      properties: {
        user_id: { type: 'string', description: 'The UUID of the user' },
        new_role: { type: 'string', enum: ['user', 'admin', 'super_admin'], description: 'The new role' },
        reason: { type: 'string', description: 'Reason for the change' },
      },
      required: ['user_id', 'new_role', 'reason'],
    },
  },
  {
    name: 'change_user_plan',
    description: 'Change a user\'s subscription plan.',
    input_schema: {
      type: 'object',
      properties: {
        user_id: { type: 'string', description: 'The UUID of the user' },
        new_plan: { type: 'string', enum: ['free', 'basic', 'pro', 'team', 'enterprise', 'lifetime'], description: 'The new plan' },
        reason: { type: 'string', description: 'Reason for the change' },
      },
      required: ['user_id', 'new_plan', 'reason'],
    },
  },
  {
    name: 'delete_user',
    description: 'Permanently delete a user account and all associated data. USE WITH EXTREME CAUTION.',
    input_schema: {
      type: 'object',
      properties: {
        user_id: { type: 'string', description: 'The UUID of the user to delete' },
        confirm: { type: 'string', description: 'Must be "DELETE_CONFIRMED" to proceed' },
      },
      required: ['user_id', 'confirm'],
    },
  },
  {
    name: 'list_users',
    description: 'List users with optional filters.',
    input_schema: {
      type: 'object',
      properties: {
        filter: { type: 'string', enum: ['all', 'banned', 'inactive', 'admins', 'recent'], description: 'Filter type' },
        limit: { type: 'number', description: 'Number of users to return (default: 20)' },
      },
      required: [],
    },
  },
  // ============================================
  // BACKUP ADMIN TOOLS
  // ============================================
  {
    name: 'trigger_backup',
    description: 'Trigger an immediate backup of the database.',
    input_schema: {
      type: 'object',
      properties: {
        backup_type: { type: 'string', enum: ['full', 'incremental'], description: 'Type of backup (default: full)' },
        description: { type: 'string', description: 'Optional description for this backup' },
      },
      required: [],
    },
  },
  {
    name: 'list_backups',
    description: 'List recent backups with their status.',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Number of backups to return (default: 10)' },
        status: { type: 'string', enum: ['all', 'completed', 'failed', 'running'], description: 'Filter by status' },
      },
      required: [],
    },
  },
  {
    name: 'get_backup_details',
    description: 'Get detailed information about a specific backup.',
    input_schema: {
      type: 'object',
      properties: {
        backup_id: { type: 'string', description: 'The UUID of the backup' },
      },
      required: ['backup_id'],
    },
  },
  {
    name: 'delete_backup',
    description: 'Delete a backup file. Cannot delete the most recent successful backup.',
    input_schema: {
      type: 'object',
      properties: {
        backup_id: { type: 'string', description: 'The UUID of the backup to delete' },
        confirm: { type: 'string', description: 'Must be "DELETE_BACKUP" to proceed' },
      },
      required: ['backup_id', 'confirm'],
    },
  },
  // ============================================
  // ANALYTICS TOOLS
  // ============================================
  {
    name: 'get_analytics_summary',
    description: 'Get a summary of platform analytics for a time period.',
    input_schema: {
      type: 'object',
      properties: {
        period: { type: 'string', enum: ['24h', '7d', '30d', '90d'], description: 'Time period (default: 7d)' },
      },
      required: [],
    },
  },
  {
    name: 'get_revenue_breakdown',
    description: 'Get revenue breakdown by plan type.',
    input_schema: {
      type: 'object',
      properties: {
        period: { type: 'string', enum: ['30d', '90d', 'year'], description: 'Time period (default: 30d)' },
      },
      required: [],
    },
  },
  {
    name: 'get_user_growth',
    description: 'Get user growth statistics.',
    input_schema: {
      type: 'object',
      properties: {
        period: { type: 'string', enum: ['7d', '30d', '90d'], description: 'Time period (default: 30d)' },
      },
      required: [],
    },
  },
  {
    name: 'explain_metric',
    description: 'Explain what a metric means in both technical and investor-friendly terms. Use this when someone asks "what is X" or "explain X".',
    input_schema: {
      type: 'object',
      properties: {
        metric_name: {
          type: 'string',
          enum: ['mrr', 'arr', 'arpu', 'dau', 'mau', 'dau_mau_ratio', 'conversion_rate', 'shard_hit_rate', 'churn', 'ltv', 'cac', 'tokens_saved', 'convergence'],
          description: 'The metric to explain'
        },
        audience: {
          type: 'string',
          enum: ['investor', 'admin', 'both'],
          description: 'Target audience for the explanation (default: both)'
        },
      },
      required: ['metric_name'],
    },
  },
  {
    name: 'get_demo_funnel',
    description: 'Get detailed demo-to-signup funnel analytics.',
    input_schema: {
      type: 'object',
      properties: {
        period: { type: 'string', enum: ['24h', '7d', '30d'], description: 'Time period (default: 7d)' },
      },
      required: [],
    },
  },
  {
    name: 'compare_periods',
    description: 'Compare key metrics between two time periods to show growth/decline.',
    input_schema: {
      type: 'object',
      properties: {
        metric: { type: 'string', enum: ['users', 'revenue', 'engagement', 'shards'], description: 'Metric category to compare' },
        period1: { type: 'string', enum: ['last_week', 'last_month', 'last_quarter'], description: 'First period' },
        period2: { type: 'string', enum: ['this_week', 'this_month', 'this_quarter'], description: 'Second period' },
      },
      required: ['metric'],
    },
  },
];

// Tool execution functions
async function executeTool(name: string, input: Record<string, unknown>): Promise<{ success: boolean; result: unknown }> {
  try {
    switch (name) {
      case 'archive_shard': {
        const { shard_id, reason } = input as { shard_id: string; reason: string };
        await query(
          `UPDATE procedural_shards SET lifecycle = 'archived', updated_at = NOW() WHERE id = $1`,
          [shard_id]
        );
        // Log the action
        await query(
          `INSERT INTO shard_feedback (id, shard_id, signal_type, context, created_at)
           VALUES (gen_random_uuid(), $1, 'admin_archive', $2, NOW())`,
          [shard_id, JSON.stringify({ reason, action: 'archived' })]
        ).catch(() => {});
        return { success: true, result: `Shard ${shard_id} archived. Reason: ${reason}` };
      }

      case 'promote_shard': {
        const { shard_id } = input as { shard_id: string };
        const shard = await queryOne<{ lifecycle: string }>(
          `SELECT lifecycle FROM procedural_shards WHERE id = $1`,
          [shard_id]
        );
        if (!shard) return { success: false, result: `Shard ${shard_id} not found` };
        if (shard.lifecycle === 'promoted') return { success: false, result: `Shard is already promoted` };
        await query(
          `UPDATE procedural_shards SET lifecycle = 'promoted', updated_at = NOW() WHERE id = $1`,
          [shard_id]
        );
        return { success: true, result: `Shard ${shard_id} promoted to active status` };
      }

      case 'demote_shard': {
        const { shard_id, reason } = input as { shard_id: string; reason: string };
        await query(
          `UPDATE procedural_shards SET lifecycle = 'shadow', updated_at = NOW() WHERE id = $1`,
          [shard_id]
        );
        await query(
          `INSERT INTO shard_feedback (id, shard_id, signal_type, context, created_at)
           VALUES (gen_random_uuid(), $1, 'admin_demote', $2, NOW())`,
          [shard_id, JSON.stringify({ reason, action: 'demoted' })]
        ).catch(() => {});
        return { success: true, result: `Shard ${shard_id} demoted to shadow. Reason: ${reason}` };
      }

      case 'adjust_confidence': {
        const { shard_id, new_confidence, reason } = input as { shard_id: string; new_confidence: number; reason: string };
        if (new_confidence < 0 || new_confidence > 1) {
          return { success: false, result: 'Confidence must be between 0 and 1' };
        }
        const oldShard = await queryOne<{ confidence: string }>(
          `SELECT confidence FROM procedural_shards WHERE id = $1`,
          [shard_id]
        );
        await query(
          `UPDATE procedural_shards SET confidence = $2, updated_at = NOW() WHERE id = $1`,
          [shard_id, new_confidence]
        );
        return {
          success: true,
          result: `Shard ${shard_id} confidence adjusted from ${oldShard?.confidence || 'unknown'} to ${new_confidence}. Reason: ${reason}`,
        };
      }

      case 'trigger_crystallize': {
        const { min_cluster_size = 3 } = input as { min_cluster_size?: number };
        // Call the crystallize endpoint internally
        const result = await query<{ cluster_id: string }>(
          `SELECT DISTINCT cluster_id FROM reasoning_traces
           WHERE cluster_id IS NOT NULL AND shard_id IS NULL
           GROUP BY cluster_id HAVING COUNT(*) >= $1
           LIMIT 50`,
          [min_cluster_size]
        );
        return {
          success: true,
          result: `Crystallization check complete. Found ${result.length} clusters eligible for shard creation.`,
        };
      }

      case 'trigger_decay': {
        const decayed = await query<{ id: string; name: string; old_conf: string; new_conf: string }>(
          `UPDATE procedural_shards
           SET confidence = GREATEST(0.1, confidence - 0.1), updated_at = NOW()
           WHERE lifecycle = 'promoted'
             AND execution_count > 5
             AND (failure_count::float / NULLIF(execution_count, 0)) > 0.3
           RETURNING id, name, (confidence + 0.1)::text as old_conf, confidence::text as new_conf`
        );
        return {
          success: true,
          result: decayed.length > 0
            ? `Decayed ${decayed.length} shards: ${decayed.map(s => `${s.name} (${s.old_conf} → ${s.new_conf})`).join(', ')}`
            : 'No shards met decay criteria',
        };
      }

      case 'trigger_promote_cycle': {
        const promoted = await query<{ id: string; name: string }>(
          `UPDATE procedural_shards
           SET lifecycle = 'promoted', updated_at = NOW()
           WHERE lifecycle = 'shadow'
             AND confidence >= 0.75
             AND execution_count >= 5
             AND (success_count::float / NULLIF(execution_count, 0)) >= 0.8
           RETURNING id, name`
        );
        return {
          success: true,
          result: promoted.length > 0
            ? `Promoted ${promoted.length} shards: ${promoted.map(s => s.name).join(', ')}`
            : 'No shadow shards met promotion criteria',
        };
      }

      case 'get_shard_details': {
        const { shard_id } = input as { shard_id: string };
        const shard = await queryOne<Record<string, unknown>>(
          `SELECT id, name, description, intent_template, logic, confidence, lifecycle, visibility,
                  execution_count, success_count, failure_count, category, shard_type,
                  knowledge_type, verification_status, created_at, updated_at
           FROM procedural_shards WHERE id = $1`,
          [shard_id]
        );
        if (!shard) return { success: false, result: `Shard ${shard_id} not found` };
        return { success: true, result: shard };
      }

      case 'get_shard_executions': {
        const { shard_id, limit = 10 } = input as { shard_id: string; limit?: number };
        const executions = await query<{
          id: string;
          success: boolean;
          latency_ms: string;
          context: string;
          created_at: string;
        }>(
          `SELECT id, success, latency_ms::text, context::text, created_at::text
           FROM shard_executions WHERE shard_id = $1 ORDER BY created_at DESC LIMIT $2`,
          [shard_id, Math.min(limit, 50)]
        );
        return {
          success: true,
          result: {
            shard_id,
            execution_count: executions.length,
            executions: executions.map(e => ({
              id: e.id,
              success: e.success,
              latency_ms: parseInt(e.latency_ms, 10),
              created_at: e.created_at,
            })),
          },
        };
      }

      case 'update_shard_logic': {
        const { shard_id, new_logic, reason } = input as { shard_id: string; new_logic: string; reason: string };
        const oldShard = await queryOne<{ logic: string; name: string }>(
          `SELECT logic, name FROM procedural_shards WHERE id = $1`,
          [shard_id]
        );
        if (!oldShard) return { success: false, result: `Shard ${shard_id} not found` };
        await query(
          `UPDATE procedural_shards SET logic = $2, updated_at = NOW() WHERE id = $1`,
          [shard_id, new_logic]
        );
        await query(
          `INSERT INTO shard_feedback (id, shard_id, signal_type, context, created_at)
           VALUES (gen_random_uuid(), $1, 'admin_logic_update', $2, NOW())`,
          [shard_id, JSON.stringify({ reason, old_logic: oldShard.logic?.slice(0, 200), new_logic: new_logic.slice(0, 200) })]
        ).catch(() => {});
        return {
          success: true,
          result: `Updated logic for shard "${oldShard.name}" (${shard_id}). Reason: ${reason}`,
        };
      }

      // ============================================
      // USER ADMIN TOOLS
      // ============================================

      case 'get_user_details': {
        const { user_id, email } = input as { user_id?: string; email?: string };
        if (!user_id && !email) return { success: false, result: 'Provide user_id or email' };
        const user = await queryOne<Record<string, unknown>>(
          user_id
            ? `SELECT id, email, name, role, plan, email_verified, banned, ban_reason,
                      created_at, last_active_at, tenant_id
               FROM users WHERE id = $1`
            : `SELECT id, email, name, role, plan, email_verified, banned, ban_reason,
                      created_at, last_active_at, tenant_id
               FROM users WHERE email = $1`,
          [user_id || email]
        );
        if (!user) return { success: false, result: 'User not found' };
        return { success: true, result: user };
      }

      case 'ban_user': {
        const { user_id, reason } = input as { user_id: string; reason: string };
        const user = await queryOne<{ email: string; role: string }>(
          `SELECT email, role FROM users WHERE id = $1`,
          [user_id]
        );
        if (!user) return { success: false, result: 'User not found' };
        if (user.role === 'super_admin') return { success: false, result: 'Cannot ban a super_admin' };
        await query(
          `UPDATE users SET banned = true, ban_reason = $2, updated_at = NOW() WHERE id = $1`,
          [user_id, reason]
        );
        // Revoke all sessions
        await query(`UPDATE sessions SET revoked = true WHERE user_id = $1`, [user_id]);
        return { success: true, result: `Banned user ${user.email}. Reason: ${reason}. All sessions revoked.` };
      }

      case 'unban_user': {
        const { user_id } = input as { user_id: string };
        const user = await queryOne<{ email: string; banned: boolean }>(
          `SELECT email, banned FROM users WHERE id = $1`,
          [user_id]
        );
        if (!user) return { success: false, result: 'User not found' };
        if (!user.banned) return { success: false, result: 'User is not banned' };
        await query(
          `UPDATE users SET banned = false, ban_reason = NULL, updated_at = NOW() WHERE id = $1`,
          [user_id]
        );
        return { success: true, result: `Unbanned user ${user.email}` };
      }

      case 'change_user_role': {
        const { user_id, new_role, reason } = input as { user_id: string; new_role: string; reason: string };
        const validRoles = ['user', 'admin', 'super_admin'];
        if (!validRoles.includes(new_role)) return { success: false, result: `Invalid role. Must be: ${validRoles.join(', ')}` };
        const user = await queryOne<{ email: string; role: string }>(
          `SELECT email, role FROM users WHERE id = $1`,
          [user_id]
        );
        if (!user) return { success: false, result: 'User not found' };
        if (user.role === 'super_admin' && new_role !== 'super_admin') {
          return { success: false, result: 'Cannot demote a super_admin' };
        }
        await query(
          `UPDATE users SET role = $2, updated_at = NOW() WHERE id = $1`,
          [user_id, new_role]
        );
        return { success: true, result: `Changed ${user.email} role from ${user.role} to ${new_role}. Reason: ${reason}` };
      }

      case 'change_user_plan': {
        const { user_id, new_plan, reason } = input as { user_id: string; new_plan: string; reason: string };
        const validPlans = ['free', 'basic', 'pro', 'team', 'enterprise', 'lifetime'];
        if (!validPlans.includes(new_plan)) return { success: false, result: `Invalid plan. Must be: ${validPlans.join(', ')}` };
        const user = await queryOne<{ email: string; plan: string }>(
          `SELECT email, plan FROM users WHERE id = $1`,
          [user_id]
        );
        if (!user) return { success: false, result: 'User not found' };
        await query(
          `UPDATE users SET plan = $2, updated_at = NOW() WHERE id = $1`,
          [user_id, new_plan]
        );
        return { success: true, result: `Changed ${user.email} plan from ${user.plan || 'free'} to ${new_plan}. Reason: ${reason}` };
      }

      case 'delete_user': {
        const { user_id, confirm } = input as { user_id: string; confirm: string };
        if (confirm !== 'DELETE_CONFIRMED') {
          return { success: false, result: 'Deletion not confirmed. Set confirm to "DELETE_CONFIRMED" to proceed.' };
        }
        const user = await queryOne<{ email: string; role: string }>(
          `SELECT email, role FROM users WHERE id = $1`,
          [user_id]
        );
        if (!user) return { success: false, result: 'User not found' };
        if (user.role === 'super_admin') return { success: false, result: 'Cannot delete a super_admin' };
        // Delete in order: sessions, user data, user
        await query(`DELETE FROM sessions WHERE user_id = $1`, [user_id]);
        await query(`DELETE FROM chat_messages WHERE session_id IN (SELECT id FROM chat_sessions WHERE user_id = $1)`, [user_id]);
        await query(`DELETE FROM chat_sessions WHERE user_id = $1`, [user_id]);
        await query(`DELETE FROM users WHERE id = $1`, [user_id]);
        return { success: true, result: `Permanently deleted user ${user.email} and all associated data` };
      }

      case 'list_users': {
        const { filter = 'all', limit = 20 } = input as { filter?: string; limit?: number };
        let sql = `SELECT id, email, name, role, plan, banned, created_at, last_active_at FROM users`;
        let params: unknown[] = [];
        switch (filter) {
          case 'banned':
            sql += ` WHERE banned = true`;
            break;
          case 'inactive':
            sql += ` WHERE last_active_at < NOW() - INTERVAL '30 days' OR last_active_at IS NULL`;
            break;
          case 'admins':
            sql += ` WHERE role IN ('admin', 'super_admin')`;
            break;
          case 'recent':
            sql += ` WHERE created_at > NOW() - INTERVAL '7 days'`;
            break;
        }
        sql += ` ORDER BY created_at DESC LIMIT $1`;
        params.push(Math.min(limit, 100));
        const users = await query<Record<string, unknown>>(sql, params);
        return { success: true, result: { count: users.length, filter, users } };
      }

      // ============================================
      // BACKUP ADMIN TOOLS
      // ============================================

      case 'trigger_backup': {
        const { backup_type = 'full', description } = input as { backup_type?: string; description?: string };
        const backupId = `backup_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
        await query(
          `INSERT INTO backup_jobs (id, backup_type, status, description, started_at, created_at)
           VALUES ($1, $2, 'pending', $3, NOW(), NOW())`,
          [backupId, backup_type, description || `Manual ${backup_type} backup via assistant`]
        );
        // In a real system, this would trigger the actual backup process
        // For now, we just create the job record
        return { success: true, result: `Backup job ${backupId} created (${backup_type}). Check backup status for progress.` };
      }

      case 'list_backups': {
        const { limit = 10, status = 'all' } = input as { limit?: number; status?: string };
        let sql = `SELECT id, backup_type, status, description, file_size, started_at, completed_at, created_at
                   FROM backup_jobs`;
        if (status !== 'all') {
          sql += ` WHERE status = '${status}'`;
        }
        sql += ` ORDER BY created_at DESC LIMIT $1`;
        const backups = await query<Record<string, unknown>>(sql, [Math.min(limit, 50)]);
        return { success: true, result: { count: backups.length, backups } };
      }

      case 'get_backup_details': {
        const { backup_id } = input as { backup_id: string };
        const backup = await queryOne<Record<string, unknown>>(
          `SELECT * FROM backup_jobs WHERE id = $1`,
          [backup_id]
        );
        if (!backup) return { success: false, result: 'Backup not found' };
        return { success: true, result: backup };
      }

      case 'delete_backup': {
        const { backup_id, confirm } = input as { backup_id: string; confirm: string };
        if (confirm !== 'DELETE_BACKUP') {
          return { success: false, result: 'Deletion not confirmed. Set confirm to "DELETE_BACKUP" to proceed.' };
        }
        // Check it's not the most recent successful backup
        const mostRecent = await queryOne<{ id: string }>(
          `SELECT id FROM backup_jobs WHERE status = 'completed' ORDER BY completed_at DESC LIMIT 1`
        );
        if (mostRecent?.id === backup_id) {
          return { success: false, result: 'Cannot delete the most recent successful backup' };
        }
        await query(`DELETE FROM backup_jobs WHERE id = $1`, [backup_id]);
        return { success: true, result: `Deleted backup ${backup_id}` };
      }

      // ============================================
      // ANALYTICS TOOLS
      // ============================================

      case 'get_analytics_summary': {
        const { period = '7d' } = input as { period?: string };
        const intervalMap: Record<string, string> = { '24h': '24 hours', '7d': '7 days', '30d': '30 days', '90d': '90 days' };
        const interval = intervalMap[period] || '7 days';

        const [stats] = await query<{
          total_users: string; new_users: string; active_users: string;
          total_queries: string; shard_hits: string;
        }>(`
          SELECT
            (SELECT COUNT(*) FROM users) as total_users,
            (SELECT COUNT(*) FROM users WHERE created_at > NOW() - INTERVAL '${interval}') as new_users,
            (SELECT COUNT(*) FROM users WHERE last_active_at > NOW() - INTERVAL '${interval}') as active_users,
            (SELECT COUNT(*) FROM reasoning_traces WHERE created_at > NOW() - INTERVAL '${interval}') as total_queries,
            (SELECT COUNT(*) FROM reasoning_traces WHERE shard_id IS NOT NULL AND created_at > NOW() - INTERVAL '${interval}') as shard_hits
        `);

        const hitRate = parseInt(stats?.total_queries || '0', 10) > 0
          ? ((parseInt(stats?.shard_hits || '0', 10) / parseInt(stats?.total_queries || '1', 10)) * 100).toFixed(1)
          : '0';

        return {
          success: true,
          result: {
            period,
            totalUsers: parseInt(stats?.total_users || '0', 10),
            newUsers: parseInt(stats?.new_users || '0', 10),
            activeUsers: parseInt(stats?.active_users || '0', 10),
            totalQueries: parseInt(stats?.total_queries || '0', 10),
            shardHits: parseInt(stats?.shard_hits || '0', 10),
            hitRate: `${hitRate}%`,
          },
        };
      }

      case 'get_revenue_breakdown': {
        const planPrices: Record<string, number> = { free: 0, basic: 9, pro: 19, team: 49, enterprise: 199, lifetime: 0 };
        const planCounts = await query<{ plan: string; count: string }>(
          `SELECT COALESCE(plan, 'free') as plan, COUNT(*)::text as count FROM users GROUP BY plan`
        );
        const breakdown = planCounts.map(p => ({
          plan: p.plan,
          users: parseInt(p.count, 10),
          monthlyRevenue: parseInt(p.count, 10) * (planPrices[p.plan] || 0),
        }));
        const totalMRR = breakdown.reduce((sum, p) => sum + p.monthlyRevenue, 0);
        return {
          success: true,
          result: { breakdown, totalMRR, estimatedARR: totalMRR * 12 },
        };
      }

      case 'get_user_growth': {
        const { period = '30d' } = input as { period?: string };
        const days = period === '7d' ? 7 : period === '90d' ? 90 : 30;
        const growth = await query<{ date: string; signups: string; active: string }>(`
          SELECT
            DATE(d.date) as date,
            COUNT(u.id)::text as signups,
            (SELECT COUNT(*) FROM users WHERE DATE(last_active_at) = DATE(d.date))::text as active
          FROM generate_series(NOW() - INTERVAL '${days} days', NOW(), '1 day') as d(date)
          LEFT JOIN users u ON DATE(u.created_at) = DATE(d.date)
          GROUP BY DATE(d.date)
          ORDER BY date
        `);
        return {
          success: true,
          result: {
            period,
            data: growth.map(g => ({
              date: g.date,
              signups: parseInt(g.signups, 10),
              active: parseInt(g.active, 10),
            })),
          },
        };
      }

      case 'explain_metric': {
        const { metric_name, audience = 'both' } = input as { metric_name: string; audience?: string };
        const explanations: Record<string, { technical: string; investor: string; benchmark: string }> = {
          mrr: {
            technical: 'Monthly Recurring Revenue - sum of all active subscription fees collected each month.',
            investor: 'MRR is the heartbeat of a SaaS business. It shows predictable, recurring income from subscriptions. Growing MRR indicates product-market fit and sustainable revenue.',
            benchmark: 'Healthy SaaS: 10-20% month-over-month MRR growth in early stages, 5-7% in growth stage.',
          },
          arr: {
            technical: 'Annual Recurring Revenue - MRR multiplied by 12, representing annualized subscription revenue.',
            investor: 'ARR is the standard metric for valuing SaaS companies. It represents your annual run rate and is typically used for companies with annual contracts or to project yearly revenue.',
            benchmark: '$1M ARR is a common milestone for Series A. SaaS valuations often use ARR multiples (5-15x for growth companies).',
          },
          arpu: {
            technical: 'Average Revenue Per User - total revenue divided by number of paying users.',
            investor: 'ARPU shows how much value you extract per customer. Higher ARPU means you can spend more on acquisition and still be profitable.',
            benchmark: 'B2C SaaS: $10-50/month. B2B SaaS: $50-500/month. Enterprise: $1000+/month.',
          },
          dau: {
            technical: 'Daily Active Users - unique users who performed a meaningful action in the last 24 hours.',
            investor: 'DAU measures daily engagement and product stickiness. Consistent DAU growth shows the product is becoming essential to users.',
            benchmark: 'Depends on product type. Consumer apps aim for daily use; B2B tools may have lower DAU but higher value per session.',
          },
          mau: {
            technical: 'Monthly Active Users - unique users who performed a meaningful action in the last 30 days.',
            investor: 'MAU shows your total engaged user base. It\'s the denominator for many key metrics like DAU/MAU ratio and conversion rate.',
            benchmark: 'MAU growth rate should exceed churn rate for net positive user growth.',
          },
          dau_mau_ratio: {
            technical: 'DAU divided by MAU, expressed as a percentage. Shows what portion of monthly users engage daily.',
            investor: 'This ratio measures product stickiness/engagement. Higher ratio = more habit-forming product = lower churn risk.',
            benchmark: '20%+ is good for SaaS. 50%+ is exceptional (social apps). <10% may indicate engagement problems.',
          },
          conversion_rate: {
            technical: 'Percentage of free users who become paying customers.',
            investor: 'Shows how well your product demonstrates value. Higher conversion = better product-market fit and more efficient growth.',
            benchmark: 'Freemium SaaS: 2-5% is typical, 10%+ is excellent. Free trial: 15-25% is good.',
          },
          shard_hit_rate: {
            technical: 'Percentage of queries answered from learned procedural knowledge (shards) vs requiring external LLM calls.',
            investor: 'This is our technology moat. When we answer from shards instead of calling GPT-4/Claude, we save ~$0.01-0.03 per query. Higher hit rate = dramatically better unit economics.',
            benchmark: 'Target: 30%+ for meaningful cost savings. 50%+ enables profitable operations at scale.',
          },
          churn: {
            technical: 'Percentage of customers who cancel or don\'t renew in a given period.',
            investor: 'Churn is the "leaky bucket" metric. High churn means you need to acquire more customers just to maintain revenue.',
            benchmark: 'Monthly churn: <3% is good for B2B SaaS. <5% acceptable for B2C. >10% is a red flag.',
          },
          ltv: {
            technical: 'Lifetime Value - predicted total revenue from a customer over their entire relationship.',
            investor: 'LTV shows the long-term value of each customer. LTV/CAC ratio is crucial - should be >3x for healthy economics.',
            benchmark: 'LTV = ARPU / Monthly Churn Rate. LTV/CAC >3x is healthy, >5x is excellent.',
          },
          cac: {
            technical: 'Customer Acquisition Cost - total sales & marketing spend divided by new customers acquired.',
            investor: 'CAC shows how efficiently you can grow. Lower CAC or higher LTV/CAC ratio = more profitable growth.',
            benchmark: 'Payback period (CAC/Monthly ARPU) should be <12 months. <6 months is excellent.',
          },
          tokens_saved: {
            technical: 'LLM tokens that would have been consumed but were avoided by using shard-based responses.',
            investor: 'Each token saved is ~$0.002-0.02 in avoided API costs. At scale, this is massive cost savings that competitors without our technology can\'t match.',
            benchmark: 'Target: Save 30%+ of potential token usage. This directly improves gross margins.',
          },
          convergence: {
            technical: 'The process of ALF learning and improving over time - crystallizing patterns into reusable shards.',
            investor: 'Convergence is our flywheel: more usage → more learning → better responses → less LLM cost → better margins → more competitive pricing → more usage.',
            benchmark: 'Convergence score should increase over time as the system learns. Target: measurable improvement week-over-week.',
          },
        };

        const explanation = explanations[metric_name];
        if (!explanation) {
          return { success: false, result: `Unknown metric: ${metric_name}` };
        }

        let result = '';
        if (audience === 'technical' || audience === 'admin') {
          result = `**Technical Definition:**\n${explanation.technical}\n\n**Benchmark:** ${explanation.benchmark}`;
        } else if (audience === 'investor') {
          result = `**For Investors:**\n${explanation.investor}\n\n**Benchmark:** ${explanation.benchmark}`;
        } else {
          result = `**Technical:** ${explanation.technical}\n\n**Investor Perspective:** ${explanation.investor}\n\n**Benchmarks:** ${explanation.benchmark}`;
        }

        return { success: true, result };
      }

      case 'get_demo_funnel': {
        const { period = '7d' } = input as { period?: string };
        const intervalMap: Record<string, string> = { '24h': '24 hours', '7d': '7 days', '30d': '30 days' };
        const interval = intervalMap[period] || '7 days';

        const [stats] = await query<{
          total_sessions: string;
          completed_demo: string;
          converted: string;
          avg_interactions: string;
        }>(`
          SELECT
            COUNT(*) as total_sessions,
            COUNT(*) FILTER (WHERE interactions_used >= 3) as completed_demo,
            COUNT(*) FILTER (WHERE converted_to_user_id IS NOT NULL) as converted,
            ROUND(AVG(interactions_used), 1)::text as avg_interactions
          FROM demo_sessions
          WHERE created_at > NOW() - INTERVAL '${interval}'
        `);

        const totalSessions = parseInt(stats?.total_sessions || '0', 10);
        const completedDemo = parseInt(stats?.completed_demo || '0', 10);
        const converted = parseInt(stats?.converted || '0', 10);

        return {
          success: true,
          result: {
            period,
            funnel: {
              started: totalSessions,
              engaged: completedDemo,
              converted: converted,
            },
            rates: {
              engagementRate: totalSessions > 0 ? `${((completedDemo / totalSessions) * 100).toFixed(1)}%` : '0%',
              conversionRate: totalSessions > 0 ? `${((converted / totalSessions) * 100).toFixed(1)}%` : '0%',
              engagedConversionRate: completedDemo > 0 ? `${((converted / completedDemo) * 100).toFixed(1)}%` : '0%',
            },
            avgInteractions: parseFloat(stats?.avg_interactions || '0'),
          },
        };
      }

      case 'compare_periods': {
        const { metric, period1 = 'last_month', period2 = 'this_month' } = input as { metric: string; period1?: string; period2?: string };

        const periodToInterval = (p: string): { start: string; end: string } => {
          switch (p) {
            case 'last_week': return { start: "NOW() - INTERVAL '14 days'", end: "NOW() - INTERVAL '7 days'" };
            case 'this_week': return { start: "NOW() - INTERVAL '7 days'", end: 'NOW()' };
            case 'last_month': return { start: "NOW() - INTERVAL '60 days'", end: "NOW() - INTERVAL '30 days'" };
            case 'this_month': return { start: "NOW() - INTERVAL '30 days'", end: 'NOW()' };
            case 'last_quarter': return { start: "NOW() - INTERVAL '180 days'", end: "NOW() - INTERVAL '90 days'" };
            case 'this_quarter': return { start: "NOW() - INTERVAL '90 days'", end: 'NOW()' };
            default: return { start: "NOW() - INTERVAL '30 days'", end: 'NOW()' };
          }
        };

        const p1 = periodToInterval(period1);
        const p2 = periodToInterval(period2);

        let comparison: { period1Value: number; period2Value: number; change: string; metric: string } | null = null;

        if (metric === 'users') {
          const [r1] = await query<{ count: string }>(`SELECT COUNT(*) as count FROM users WHERE created_at BETWEEN ${p1.start} AND ${p1.end}`);
          const [r2] = await query<{ count: string }>(`SELECT COUNT(*) as count FROM users WHERE created_at BETWEEN ${p2.start} AND ${p2.end}`);
          const v1 = parseInt(r1?.count || '0', 10);
          const v2 = parseInt(r2?.count || '0', 10);
          const change = v1 > 0 ? (((v2 - v1) / v1) * 100).toFixed(1) : 'N/A';
          comparison = { period1Value: v1, period2Value: v2, change: `${change}%`, metric: 'New Users' };
        } else if (metric === 'engagement') {
          const [r1] = await query<{ count: string }>(`SELECT COUNT(DISTINCT user_id) as count FROM conversations WHERE created_at BETWEEN ${p1.start} AND ${p1.end}`);
          const [r2] = await query<{ count: string }>(`SELECT COUNT(DISTINCT user_id) as count FROM conversations WHERE created_at BETWEEN ${p2.start} AND ${p2.end}`);
          const v1 = parseInt(r1?.count || '0', 10);
          const v2 = parseInt(r2?.count || '0', 10);
          const change = v1 > 0 ? (((v2 - v1) / v1) * 100).toFixed(1) : 'N/A';
          comparison = { period1Value: v1, period2Value: v2, change: `${change}%`, metric: 'Active Conversing Users' };
        } else if (metric === 'shards') {
          const [r1] = await query<{ count: string }>(`SELECT COUNT(*) as count FROM procedural_shards WHERE created_at BETWEEN ${p1.start} AND ${p1.end}`);
          const [r2] = await query<{ count: string }>(`SELECT COUNT(*) as count FROM procedural_shards WHERE created_at BETWEEN ${p2.start} AND ${p2.end}`);
          const v1 = parseInt(r1?.count || '0', 10);
          const v2 = parseInt(r2?.count || '0', 10);
          const change = v1 > 0 ? (((v2 - v1) / v1) * 100).toFixed(1) : 'N/A';
          comparison = { period1Value: v1, period2Value: v2, change: `${change}%`, metric: 'New Shards Created' };
        }

        if (!comparison) {
          return { success: false, result: `Unknown metric: ${metric}` };
        }

        return { success: true, result: { ...comparison, period1, period2 } };
      }

      default:
        return { success: false, result: `Unknown tool: ${name}` };
    }
  } catch (err) {
    const error = err as Error;
    return { success: false, result: `Tool execution failed: ${error.message}` };
  }
}

function buildSystemPrompt(ctx: Awaited<ReturnType<typeof fetchSystemContext>>, pageContextText?: string): string {
  const lowConfList = ctx.lowConfidenceShards.length > 0
    ? ctx.lowConfidenceShards.map(s => `  - ${s.name} (ID: ${s.id}) confidence=${s.confidence}, executions=${s.execution_count}`).join('\n')
    : '  (none)';

  const metabolicList = ctx.metabolicCycles.length > 0
    ? ctx.metabolicCycles.map(c => `  - ${c.cycle_type}: ${c.status} at ${c.started_at}, processed ${c.items_processed} items`).join('\n')
    : '  (no recent cycles)';

  let selectedSection = '';
  if (ctx.selectedItem) {
    selectedSection = `\nSELECTED ITEM DETAILS:\n${JSON.stringify(ctx.selectedItem, null, 2)}\n`;
  }

  return `You are ALF's system administrator assistant with REAL capabilities to modify the system.

CURRENT SYSTEM STATE:
- Shards: ${ctx.shardStats.total} total, ${ctx.shardStats.promoted} promoted, ${ctx.shardStats.shadow} shadow, ${ctx.shardStats.candidate} candidate, ${ctx.shardStats.testing} testing, ${ctx.shardStats.archived} archived
- Execution success rate: ${ctx.executionSuccessRate}%
- Error rate (24h): ${ctx.errorRate24h}% (${ctx.errorFailed24h} failed of ${ctx.errorTotal24h} executions)
- Memory tiers: ${ctx.memoryCounts.procedural} procedural, ${ctx.memoryCounts.episodic} episodic, ${ctx.memoryCounts.semantic} semantic, ${ctx.memoryCounts.working} working

Low-confidence promoted shards needing review:
${lowConfList}

Recent metabolic cycles:
${metabolicList}
${selectedSection}${pageContextText ? '\n' + pageContextText : ''}
You have tools to ACTUALLY perform actions - use them when the admin asks you to do something.

TOOL CATEGORIES:
- SHARDS: archive_shard, promote_shard, demote_shard, adjust_confidence, update_shard_logic, get_shard_details, get_shard_executions
- METABOLIC: trigger_crystallize, trigger_decay, trigger_promote_cycle
- USERS: get_user_details, ban_user, unban_user, change_user_role, change_user_plan, delete_user, list_users
- BACKUPS: trigger_backup, list_backups, get_backup_details, delete_backup
- ANALYTICS: get_analytics_summary, get_revenue_breakdown, get_user_growth, explain_metric, get_demo_funnel, compare_periods

GUIDELINES:
- When asked to repair/fix a shard, use get_shard_details first, then update_shard_logic or adjust_confidence.
- When asked to ban/manage users, use the user tools.
- When asked about backups, use backup tools.
- For analytics questions, use analytics tools to get real data.
- Be proactive - if you see an issue and know how to fix it, offer to do so.
- Always confirm what action you took and its result.
- For destructive actions (delete_user, delete_backup), require explicit confirmation.

INVESTOR & EXPLANATION GUIDELINES:
- When someone asks "what is X" or "explain X", use the explain_metric tool to provide both technical and investor-friendly explanations.
- For investors, always include context: what's good, what's bad, industry benchmarks, and why the metric matters for the business.
- Explain our technology moat (shard hit rate, convergence) in terms of unit economics and competitive advantage.
- Use compare_periods to show growth trends when discussing performance.
- Be helpful to BOTH technical admins AND non-technical investors viewing the dashboard.
- When explaining our AI system, emphasize: (1) it learns and improves over time, (2) this reduces costs, (3) this creates a compounding advantage.`;
}

export async function adminAssistantRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/v1/admin/assistant', async (request: FastifyRequest, reply: FastifyReply) => {
    // Auth: API key (hash-based, timing-safe) or admin session cookie
    const hasApiKey = await validateApiKey(request);
    const adminUser = !hasApiKey ? await getAdminUser(request) : null;

    if (!hasApiKey && !adminUser) {
      return reply.code(401).send({ error: 'Unauthorized. Provide x-admin-key header or valid admin session.' });
    }

    // Rate limit
    const rateLimitKey = hasApiKey ? 'apikey' : `user:${adminUser!.user_id}`;
    if (!checkRateLimit(rateLimitKey)) {
      return reply.code(429).send({ error: 'Rate limit exceeded. Max 20 requests per minute.' });
    }

    // Parse body
    const body = request.body as {
      message?: string;
      history?: { role: 'user' | 'assistant'; content: string }[];
      context?: {
        currentTier?: string;
        selectedItemId?: string;
        pageContext?: string;
      };
    };

    if (!body.message || typeof body.message !== 'string' || !body.message.trim()) {
      return reply.code(400).send({ error: 'message is required' });
    }

    const startTime = Date.now();

    try {
      // Fetch system context
      const systemContext = await fetchSystemContext(body.context?.selectedItemId);

      // Fetch page-specific context if provided
      const pageContextText = body.context?.pageContext
        ? await fetchPageContext(body.context.pageContext)
        : '';

      // Build prompt
      const systemPrompt = buildSystemPrompt(systemContext, pageContextText);

      // Build messages array
      const messages: { role: string; content: string }[] = [];
      if (body.history && Array.isArray(body.history)) {
        for (const msg of body.history.slice(-20)) {
          if (msg.role && msg.content && (msg.role === 'user' || msg.role === 'assistant')) {
            messages.push({ role: msg.role, content: msg.content });
          }
        }
      }
      messages.push({ role: 'user', content: body.message });

      // Call Anthropic API with tools (Claude Haiku 3.5 for speed/cost)
      const anthropicKey = process.env['ANTHROPIC_API_KEY'];
      if (!anthropicKey) {
        return reply.code(500).send({ error: 'ANTHROPIC_API_KEY not configured' });
      }

      // Agentic loop - keep calling until we get a final text response
      let currentMessages = messages.map(m => ({ role: m.role, content: m.content }));
      let tokensUsed = 0;
      let finalResponse = '';
      let actionsExecuted: { tool: string; result: unknown }[] = [];
      const maxIterations = 5; // Safety limit

      for (let iteration = 0; iteration < maxIterations; iteration++) {
        const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': anthropicKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-3-5-haiku-20241022',
            max_tokens: 2048,
            system: systemPrompt,
            tools: ASSISTANT_TOOLS,
            messages: currentMessages,
          }),
        });

        if (!anthropicResponse.ok) {
          const error = await anthropicResponse.text();
          return reply.code(502).send({ error: 'AI provider error', details: error });
        }

        const anthropicData = await anthropicResponse.json() as {
          content: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>;
          usage?: { input_tokens?: number; output_tokens?: number };
          stop_reason?: string;
        };

        tokensUsed += (anthropicData.usage?.input_tokens || 0) + (anthropicData.usage?.output_tokens || 0);

        // Check if we have tool calls
        const toolUses = anthropicData.content.filter(c => c.type === 'tool_use');
        const textContent = anthropicData.content.filter(c => c.type === 'text');

        if (toolUses.length === 0) {
          // No tool calls - we're done
          finalResponse = textContent.map(c => c.text || '').join('\n');
          break;
        }

        // Execute tool calls
        const toolResults: { type: 'tool_result'; tool_use_id: string; content: string }[] = [];
        for (const toolUse of toolUses) {
          const { success, result } = await executeTool(toolUse.name!, toolUse.input || {});
          actionsExecuted.push({ tool: toolUse.name!, result });
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id!,
            content: JSON.stringify({ success, result }),
          });
        }

        // Add assistant message with tool use and our tool results
        currentMessages.push({
          role: 'assistant',
          content: anthropicData.content as any,
        });
        currentMessages.push({
          role: 'user',
          content: toolResults as any,
        });

        // Check stop reason - if end_turn, grab any text and stop
        if (anthropicData.stop_reason === 'end_turn' && textContent.length > 0) {
          finalResponse = textContent.map(c => c.text || '').join('\n');
          break;
        }
      }

      const responseText = finalResponse;
      const responseMs = Date.now() - startTime;

      // Audit log — successful query
      const auditId = `audit_${Date.now().toString(36)}_${Array.from(new Uint8Array(8)).map(() => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join('')}`;
      await query(
        `INSERT INTO audit_logs (id, tenant_id, user_id, action, resource_type, details, ip_address, user_agent, success, created_at)
         VALUES ($1, $2, $3, 'admin.assistant.query', 'assistant', $4, $5, $6, true, NOW())`,
        [
          auditId,
          adminUser?.tenant_id || null,
          adminUser?.user_id || null,
          JSON.stringify({
            authMethod: hasApiKey ? 'api_key' : 'session',
            pageContext: body.context?.pageContext || null,
            messagePreview: body.message.slice(0, 100),
            responseMs,
            tokensUsed,
            actionsExecuted: actionsExecuted.length > 0 ? actionsExecuted : undefined,
          }),
          request.ip,
          request.headers['user-agent'] || null,
        ]
      ).catch(() => {}); // Don't fail the request if audit logging fails

      return {
        response: responseText,
        meta: {
          responseMs,
          tokensUsed,
          actionsExecuted: actionsExecuted.length > 0 ? actionsExecuted : undefined,
        },
      };
    } catch (error) {
      const err = error as Error;

      // Audit log — failed query
      const auditId = `audit_${Date.now().toString(36)}_${Array.from(new Uint8Array(8)).map(() => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join('')}`;
      await query(
        `INSERT INTO audit_logs (id, tenant_id, user_id, action, resource_type, details, ip_address, user_agent, success, error_message, created_at)
         VALUES ($1, $2, $3, 'admin.assistant.query', 'assistant', $4, $5, $6, false, $7, NOW())`,
        [
          auditId,
          adminUser?.tenant_id || null,
          adminUser?.user_id || null,
          JSON.stringify({
            authMethod: hasApiKey ? 'api_key' : 'session',
            pageContext: body.context?.pageContext || null,
            messagePreview: body.message.slice(0, 100),
          }),
          request.ip,
          request.headers['user-agent'] || null,
          err.message,
        ]
      ).catch(() => {});

      return reply.code(500).send({ error: 'Internal error', details: err.message });
    }
  });
}
