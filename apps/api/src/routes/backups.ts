/**
 * SUBSTRATE v1: Backup Administration Routes
 *
 * Admin-only endpoints for backup management, monitoring, and restore operations.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { query, queryOne } from '@substrate/database';

// Types for database results
interface BackupJobRow {
  id: string;
  type: string;
  trigger: string;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  filePath: string | null;
  fileSize: number | null;
  compressed: boolean;
  encrypted: boolean;
  manifest: Record<string, unknown>;
  errorMessage: string | null;
  errorDetails: Record<string, unknown> | null;
  triggeredBy: string | null;
  createdAt: string;
}

interface BackupStatsRow {
  total_backups: string;
  successful_backups: string;
  failed_backups: string;
  total_size_bytes: string;
  avg_duration_ms: string | null;
  last_successful_at: string | null;
  last_failed_at: string | null;
}

interface BackupConfigRow {
  scheduleEnabled: boolean;
  scheduleCron: string;
  retentionDays: number;
  retentionWeeks: number;
  retentionMonths: number;
  compressionEnabled: boolean;
  encryptionEnabled: boolean;
  notifyOnFailure: boolean;
  notifyOnSuccess: boolean;
  notifyEmail: string | null;
  updatedAt: string;
  updatedBy: string | null;
}

interface BackupConfig {
  scheduleEnabled?: boolean;
  scheduleCron?: string;
  retentionDays?: number;
  retentionWeeks?: number;
  retentionMonths?: number;
  compressionEnabled?: boolean;
  encryptionEnabled?: boolean;
  notifyOnFailure?: boolean;
  notifyOnSuccess?: boolean;
  notifyEmail?: string | null;
}

// Backup container HTTP API base URL
const BACKUP_API_URL = process.env['BACKUP_API_URL'] || 'http://backup:8080';

/**
 * Call backup container API
 */
async function callBackupApi(
  path: string,
  method: 'GET' | 'POST' = 'GET',
  body?: Record<string, unknown>
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  try {
    const fetchOptions: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (body) {
      fetchOptions.body = JSON.stringify(body);
    }
    const response = await fetch(`${BACKUP_API_URL}${path}`, fetchOptions);

    const data = await response.json();
    return { ok: response.ok, data };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Backup service unavailable',
    };
  }
}

/**
 * Require admin authentication - checks session and returns admin info
 */
async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<{ user_id: string; tenant_id: string } | null> {
  const cookies = request.cookies as Record<string, string> | undefined;
  const sessionToken = cookies?.['substrate_session'];

  if (!sessionToken) {
    reply.code(401).send({ error: 'Not authenticated' });
    return null;
  }

  // Hash the token for lookup
  const encoder = new TextEncoder();
  const data = encoder.encode(sessionToken);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const tokenHash = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

  const session = await queryOne<{ user_id: string }>(
    'SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > NOW() AND revoked = false',
    [tokenHash]
  );

  if (!session) {
    reply.code(401).send({ error: 'Not authenticated' });
    return null;
  }

  const user = await queryOne<{ id: string; tenant_id: string; role: string }>(
    'SELECT id, tenant_id, role FROM users WHERE id = $1',
    [session.user_id]
  );

  if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) {
    reply.code(403).send({ error: 'Admin access required' });
    return null;
  }

  return { user_id: user.id, tenant_id: user.tenant_id };
}

/**
 * Register backup routes
 */
export async function backupRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/admin/backups - List backup jobs
   */
  app.get('/api/admin/backups', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return;

    const { status, type, trigger, limit = '50', offset = '0' } = request.query as Record<string, string>;

    let sql = `
      SELECT
        id,
        type,
        trigger,
        status,
        started_at as "startedAt",
        completed_at as "completedAt",
        duration_ms as "durationMs",
        file_path as "filePath",
        file_size as "fileSize",
        compressed,
        encrypted,
        manifest,
        error_message as "errorMessage",
        triggered_by as "triggeredBy",
        created_at as "createdAt"
      FROM backup_jobs
      WHERE deleted_at IS NULL
    `;

    const params: unknown[] = [];
    let paramIndex = 1;

    if (status) {
      sql += ` AND status = $${paramIndex++}`;
      params.push(status);
    }

    if (type) {
      sql += ` AND type = $${paramIndex++}`;
      params.push(type);
    }

    if (trigger) {
      sql += ` AND trigger = $${paramIndex++}`;
      params.push(trigger);
    }

    sql += ` ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(parseInt(limit, 10), parseInt(offset, 10));

    const jobs = await query<BackupJobRow>(sql, params);

    // Get total count
    let countSql = 'SELECT COUNT(*) as count FROM backup_jobs WHERE deleted_at IS NULL';
    const countParams: unknown[] = [];
    let countIndex = 1;

    if (status) {
      countSql += ` AND status = $${countIndex++}`;
      countParams.push(status);
    }
    if (type) {
      countSql += ` AND type = $${countIndex++}`;
      countParams.push(type);
    }
    if (trigger) {
      countSql += ` AND trigger = $${countIndex++}`;
      countParams.push(trigger);
    }

    const countResult = await queryOne<{ count: string }>(countSql, countParams);

    return {
      jobs,
      total: parseInt(countResult?.count || '0', 10),
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10),
    };
  });

  /**
   * GET /api/admin/backups/stats - Get backup statistics
   */
  app.get('/api/admin/backups/stats', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return;

    const { days = '30' } = request.query as Record<string, string>;

    const stats = await queryOne<BackupStatsRow>(
      `SELECT * FROM get_backup_stats($1)`,
      [parseInt(days, 10)]
    );

    // Get active backup status from container
    const activeStatus = await callBackupApi('/health');

    return {
      totalBackups: parseInt(stats?.total_backups || '0', 10),
      successfulBackups: parseInt(stats?.successful_backups || '0', 10),
      failedBackups: parseInt(stats?.failed_backups || '0', 10),
      totalSizeBytes: parseInt(stats?.total_size_bytes || '0', 10),
      avgDurationMs: stats?.avg_duration_ms ? parseFloat(stats.avg_duration_ms) : null,
      lastSuccessfulAt: stats?.last_successful_at || null,
      lastFailedAt: stats?.last_failed_at || null,
      serviceStatus: activeStatus.ok ? 'healthy' : 'unhealthy',
    };
  });

  /**
   * GET /api/admin/backups/:id - Get backup job details
   */
  app.get('/api/admin/backups/:id', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return;

    const { id } = request.params as { id: string };

    const job = await queryOne<BackupJobRow & { errorDetails: Record<string, unknown> | null }>(
      `SELECT
        id,
        type,
        trigger,
        status,
        started_at as "startedAt",
        completed_at as "completedAt",
        duration_ms as "durationMs",
        file_path as "filePath",
        file_size as "fileSize",
        compressed,
        encrypted,
        manifest,
        error_message as "errorMessage",
        error_details as "errorDetails",
        triggered_by as "triggeredBy",
        created_at as "createdAt"
      FROM backup_jobs
      WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );

    if (!job) {
      return reply.status(404).send({ error: 'Backup job not found' });
    }

    return { job };
  });

  /**
   * POST /api/admin/backups/trigger - Trigger manual backup
   */
  app.post('/api/admin/backups/trigger', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return;

    const { type = 'full' } = request.body as { type?: string };

    // Call backup container API
    const result = await callBackupApi('/backup', 'POST', {
      type,
      trigger: 'manual',
      triggeredBy: admin.user_id,
    });

    if (!result.ok) {
      return reply.status(503).send({
        error: 'Failed to trigger backup',
        details: result.error,
      });
    }

    // Log to audit
    await query(
      `INSERT INTO audit_logs (user_id, tenant_id, action, resource_type, resource_id, details)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        admin.user_id,
        admin.tenant_id,
        'backup.trigger',
        'backup_job',
        (result.data as { jobId?: string })?.jobId,
        JSON.stringify({ type }),
      ]
    );

    return {
      success: true,
      jobId: (result.data as { jobId?: string })?.jobId,
      message: 'Backup started',
    };
  });

  /**
   * POST /api/admin/backups/:id/restore - Restore from backup
   */
  app.post('/api/admin/backups/:id/restore', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return;

    const { id } = request.params as { id: string };
    const { dryRun = true } = request.body as { dryRun?: boolean };

    // Get backup job to find file path
    const job = await queryOne<{ filePath: string }>(
      `SELECT file_path as "filePath" FROM backup_jobs WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );

    if (!job || !job.filePath) {
      return reply.status(404).send({ error: 'Backup not found or no file path' });
    }

    // Call backup container API
    const result = await callBackupApi('/restore', 'POST', {
      backupPath: job.filePath,
      dryRun,
      triggeredBy: admin.user_id,
    });

    if (!result.ok) {
      return reply.status(503).send({
        error: 'Failed to start restore',
        details: result.error,
      });
    }

    // Log to audit
    await query(
      `INSERT INTO audit_logs (user_id, tenant_id, action, resource_type, resource_id, details)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        admin.user_id,
        admin.tenant_id,
        dryRun ? 'backup.restore_dryrun' : 'backup.restore',
        'backup_job',
        id,
        JSON.stringify({ backupPath: job.filePath, dryRun }),
      ]
    );

    return {
      success: true,
      jobId: (result.data as { jobId?: string })?.jobId,
      message: dryRun ? 'Dry-run restore started' : 'Restore started',
      warning: dryRun ? null : 'This will overwrite existing data!',
    };
  });

  /**
   * GET /api/admin/backups/:id/download - Download backup file
   */
  app.get('/api/admin/backups/:id/download', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return;

    const { id } = request.params as { id: string };

    const job = await queryOne<{ filePath: string; type: string; createdAt: string }>(
      `SELECT file_path as "filePath", type, created_at as "createdAt"
       FROM backup_jobs
       WHERE id = $1 AND deleted_at IS NULL AND status = 'completed'`,
      [id]
    );

    if (!job || !job.filePath) {
      return reply.status(404).send({ error: 'Backup not found or not completed' });
    }

    // For security, we don't serve files directly from the API
    // Instead, return the file path for the admin to access via the backup container
    return {
      filePath: job.filePath,
      type: job.type,
      createdAt: job.createdAt,
      message:
        'Access this file from the backup container: docker exec sprayberry-labs-backup cat ' +
        job.filePath,
    };
  });

  /**
   * DELETE /api/admin/backups/:id - Soft delete backup job
   */
  app.delete('/api/admin/backups/:id', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return;

    const { id } = request.params as { id: string };

    const result = await query(
      `UPDATE backup_jobs SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
      [id]
    );

    if (result.length === 0) {
      return reply.status(404).send({ error: 'Backup job not found' });
    }

    // Log to audit
    await query(
      `INSERT INTO audit_logs (user_id, tenant_id, action, resource_type, resource_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [admin.user_id, admin.tenant_id, 'backup.delete', 'backup_job', id]
    );

    return { success: true };
  });

  /**
   * GET /api/admin/backups/config - Get backup configuration
   */
  app.get('/api/admin/backups/config', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return;

    const config = await queryOne<BackupConfigRow>(
      `SELECT
        schedule_enabled as "scheduleEnabled",
        schedule_cron as "scheduleCron",
        retention_days as "retentionDays",
        retention_weeks as "retentionWeeks",
        retention_months as "retentionMonths",
        compression_enabled as "compressionEnabled",
        encryption_enabled as "encryptionEnabled",
        notify_on_failure as "notifyOnFailure",
        notify_on_success as "notifyOnSuccess",
        notify_email as "notifyEmail",
        updated_at as "updatedAt",
        updated_by as "updatedBy"
      FROM backup_config
      WHERE id = 'default'`
    );

    return { config: config || {} };
  });

  /**
   * PATCH /api/admin/backups/config - Update backup configuration
   */
  app.patch('/api/admin/backups/config', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return;

    const updates = request.body as Partial<BackupConfig>;

    // Build dynamic update query
    const setClauses: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (updates.scheduleEnabled !== undefined) {
      setClauses.push(`schedule_enabled = $${paramIndex++}`);
      params.push(updates.scheduleEnabled);
    }
    if (updates.scheduleCron !== undefined) {
      setClauses.push(`schedule_cron = $${paramIndex++}`);
      params.push(updates.scheduleCron);
    }
    if (updates.retentionDays !== undefined) {
      setClauses.push(`retention_days = $${paramIndex++}`);
      params.push(updates.retentionDays);
    }
    if (updates.retentionWeeks !== undefined) {
      setClauses.push(`retention_weeks = $${paramIndex++}`);
      params.push(updates.retentionWeeks);
    }
    if (updates.retentionMonths !== undefined) {
      setClauses.push(`retention_months = $${paramIndex++}`);
      params.push(updates.retentionMonths);
    }
    if (updates.compressionEnabled !== undefined) {
      setClauses.push(`compression_enabled = $${paramIndex++}`);
      params.push(updates.compressionEnabled);
    }
    if (updates.encryptionEnabled !== undefined) {
      setClauses.push(`encryption_enabled = $${paramIndex++}`);
      params.push(updates.encryptionEnabled);
    }
    if (updates.notifyOnFailure !== undefined) {
      setClauses.push(`notify_on_failure = $${paramIndex++}`);
      params.push(updates.notifyOnFailure);
    }
    if (updates.notifyOnSuccess !== undefined) {
      setClauses.push(`notify_on_success = $${paramIndex++}`);
      params.push(updates.notifyOnSuccess);
    }
    if (updates.notifyEmail !== undefined) {
      setClauses.push(`notify_email = $${paramIndex++}`);
      params.push(updates.notifyEmail);
    }

    if (setClauses.length === 0) {
      return reply.status(400).send({ error: 'No valid fields to update' });
    }

    setClauses.push(`updated_at = NOW()`);
    setClauses.push(`updated_by = $${paramIndex++}`);
    params.push(admin.user_id);

    const sql = `
      UPDATE backup_config
      SET ${setClauses.join(', ')}
      WHERE id = 'default'
      RETURNING *
    `;

    await query(sql, params);

    // Log to audit
    await query(
      `INSERT INTO audit_logs (user_id, tenant_id, action, resource_type, resource_id, details)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [admin.user_id, admin.tenant_id, 'backup.config_update', 'backup_config', 'default', JSON.stringify(updates)]
    );

    return { success: true };
  });
}
