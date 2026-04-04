/**
 * Forge Audit Trail
 * Structured audit logging for all forge operations
 */

import { ulid } from 'ulid';
import { query, queryOne } from '../database.js';

interface LogAuditOptions {
  ownerId: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

interface GetAuditLogOptions {
  action?: string | undefined;
  resourceType?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

interface AuditLogRow {
  id: string;
  owner_id: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  details: Record<string, unknown>;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

interface AuditCountRow {
  total: string;
}

/**
 * Write an audit log entry.
 */
export async function logAudit(opts: LogAuditOptions): Promise<string> {
  const id = ulid();

  await query(
    `INSERT INTO forge_audit_log (id, owner_id, action, resource_type, resource_id, details, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      id,
      opts.ownerId,
      opts.action,
      opts.resourceType,
      opts.resourceId ?? null,
      JSON.stringify(opts.details ?? {}),
      opts.ipAddress ?? null,
      opts.userAgent ?? null,
    ],
  );

  return id;
}

/**
 * Query audit log entries for an owner.
 */
export async function getAuditLog(
  ownerId: string,
  opts?: GetAuditLogOptions,
): Promise<{
  entries: AuditLogRow[];
  total: number;
}> {
  const conditions: string[] = ['owner_id = $1'];
  const params: unknown[] = [ownerId];
  let paramIndex = 2;

  if (opts?.action) {
    conditions.push(`action = $${paramIndex}`);
    params.push(opts.action);
    paramIndex++;
  }

  if (opts?.resourceType) {
    conditions.push(`resource_type = $${paramIndex}`);
    params.push(opts.resourceType);
    paramIndex++;
  }

  const whereClause = conditions.join(' AND ');
  const limit = opts?.limit ?? 50;
  const offset = opts?.offset ?? 0;

  const [entries, countResult] = await Promise.all([
    query<AuditLogRow>(
      `SELECT id, owner_id, action, resource_type, resource_id, details, ip_address, user_agent, created_at
       FROM forge_audit_log
       WHERE ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset],
    ),
    queryOne<AuditCountRow>(
      `SELECT COUNT(*) AS total FROM forge_audit_log WHERE ${whereClause}`,
      params,
    ),
  ]);

  return {
    entries,
    total: countResult ? parseInt(countResult.total, 10) : 0,
  };
}
