// SUBSTRATE v1: Usage Tracking
// Metering, usage records, and limit checking

import { ulid } from 'ulid';
import { query, queryOne } from '@askalf/database';
import { getTenantLimits } from './subscriptions.js';
import type { PlanLimits } from './plans.js';

/**
 * Usage record for a tenant on a specific day
 */
export interface UsageRecord {
  id: string;
  tenant_id: string;
  date: Date;
  executions: number;
  traces_ingested: number;
  api_requests: number;
  mcp_requests: number;
  tokens_saved: number;
  storage_used_mb: number;
  executions_limit_hit: boolean;
  api_limit_hit: boolean;
  created_at: Date;
  updated_at: Date;
}

/**
 * Usage summary for display
 */
export interface UsageSummary {
  executions: { used: number; limit: number; percentage: number };
  traces: { used: number; limit: number; percentage: number };
  api_requests: { used: number; limit: number; percentage: number };
  mcp_requests: { used: number; limit: number; percentage: number };
  storage_mb: { used: number; limit: number; percentage: number };
}

/**
 * Usage types that can be incremented
 */
export type UsageType =
  | 'executions'
  | 'traces_ingested'
  | 'api_requests'
  | 'mcp_requests'
  | 'tokens_saved';

/**
 * Convert database row to UsageRecord
 */
function rowToUsageRecord(row: Record<string, unknown>): UsageRecord {
  return {
    id: row['id'] as string,
    tenant_id: row['tenant_id'] as string,
    date: new Date(row['date'] as string),
    executions: (row['executions'] as number) ?? 0,
    traces_ingested: (row['traces_ingested'] as number) ?? 0,
    api_requests: (row['api_requests'] as number) ?? 0,
    mcp_requests: (row['mcp_requests'] as number) ?? 0,
    tokens_saved: (row['tokens_saved'] as number) ?? 0,
    storage_used_mb: parseFloat((row['storage_used_mb'] as string) ?? '0'),
    executions_limit_hit: row['executions_limit_hit'] as boolean,
    api_limit_hit: row['api_limit_hit'] as boolean,
    created_at: new Date(row['created_at'] as string),
    updated_at: new Date(row['updated_at'] as string),
  };
}

/**
 * Get today's date in YYYY-MM-DD format
 */
function getTodayDate(): string {
  return new Date().toISOString().split('T')[0] ?? '';
}

/**
 * Get or create today's usage record for a tenant
 */
export async function getOrCreateTodayUsage(tenantId: string): Promise<UsageRecord> {
  const today = getTodayDate();
  const id = `usage_${tenantId}_${today}`;

  // Try to get existing record
  let row = await queryOne<Record<string, unknown>>(
    'SELECT * FROM usage_records WHERE tenant_id = $1 AND date = $2',
    [tenantId, today]
  );

  if (!row) {
    // Create new record
    await query(
      `INSERT INTO usage_records (id, tenant_id, date, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT (tenant_id, date) DO NOTHING`,
      [id, tenantId, today]
    );

    row = await queryOne<Record<string, unknown>>(
      'SELECT * FROM usage_records WHERE tenant_id = $1 AND date = $2',
      [tenantId, today]
    );
  }

  if (!row) {
    throw new Error('Failed to get or create usage record');
  }

  return rowToUsageRecord(row);
}

/**
 * Increment usage using database function
 */
export async function incrementUsage(
  tenantId: string,
  usageType: UsageType,
  amount: number = 1
): Promise<void> {
  await query('SELECT increment_usage($1, $2, $3)', [tenantId, usageType, amount]);
}

/**
 * Check if tenant can perform action (within limits)
 */
export async function checkUsageLimit(
  tenantId: string,
  usageType: UsageType
): Promise<{ allowed: boolean; current: number; limit: number; remaining: number }> {
  const usage = await getOrCreateTodayUsage(tenantId);
  const limits = await getTenantLimits(tenantId);

  // Map usage type to limit key and get the limit value
  let limit: number;
  switch (usageType) {
    case 'executions':
      limit = limits.executions_per_day;
      break;
    case 'traces_ingested':
      limit = limits.traces_per_day;
      break;
    case 'api_requests':
      limit = limits.api_requests_per_day;
      break;
    case 'mcp_requests':
      limit = limits.mcp_requests_per_minute; // Note: This is per minute, not day
      break;
    case 'tokens_saved':
      limit = limits.storage_mb; // Different unit, handled specially
      break;
  }
  const current = usage[usageType === 'tokens_saved' ? 'tokens_saved' : usageType];

  // -1 means unlimited
  if (limit === -1) {
    return {
      allowed: true,
      current,
      limit: -1,
      remaining: -1,
    };
  }

  const remaining = Math.max(0, limit - current);

  return {
    allowed: current < limit,
    current,
    limit,
    remaining,
  };
}

/**
 * Increment usage and check limits in one operation
 * Returns false if limit would be exceeded
 */
export async function tryIncrementUsage(
  tenantId: string,
  usageType: UsageType,
  amount: number = 1
): Promise<{ success: boolean; current: number; limit: number }> {
  const check = await checkUsageLimit(tenantId, usageType);

  if (!check.allowed) {
    return {
      success: false,
      current: check.current,
      limit: check.limit,
    };
  }

  await incrementUsage(tenantId, usageType, amount);

  return {
    success: true,
    current: check.current + amount,
    limit: check.limit,
  };
}

/**
 * Get usage for a specific date range
 */
export async function getUsageForRange(
  tenantId: string,
  startDate: Date,
  endDate: Date
): Promise<UsageRecord[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM usage_records
     WHERE tenant_id = $1 AND date >= $2 AND date <= $3
     ORDER BY date ASC`,
    [tenantId, startDate.toISOString().split('T')[0], endDate.toISOString().split('T')[0]]
  );
  return rows.map(rowToUsageRecord);
}

/**
 * Get usage summary for current billing period
 */
export async function getUsageSummary(tenantId: string): Promise<UsageSummary> {
  const usage = await getOrCreateTodayUsage(tenantId);
  const limits = await getTenantLimits(tenantId);

  const calcPercentage = (used: number, limit: number): number => {
    if (limit === -1) return 0; // Unlimited
    if (limit === 0) return used > 0 ? 100 : 0;
    return Math.min(100, Math.round((used / limit) * 100));
  };

  return {
    executions: {
      used: usage.executions,
      limit: limits.executions_per_day,
      percentage: calcPercentage(usage.executions, limits.executions_per_day),
    },
    traces: {
      used: usage.traces_ingested,
      limit: limits.traces_per_day,
      percentage: calcPercentage(usage.traces_ingested, limits.traces_per_day),
    },
    api_requests: {
      used: usage.api_requests,
      limit: limits.api_requests_per_day,
      percentage: calcPercentage(usage.api_requests, limits.api_requests_per_day),
    },
    mcp_requests: {
      used: usage.mcp_requests,
      limit: limits.mcp_requests_per_minute,
      percentage: calcPercentage(usage.mcp_requests, limits.mcp_requests_per_minute),
    },
    storage_mb: {
      used: usage.storage_used_mb,
      limit: limits.storage_mb,
      percentage: calcPercentage(usage.storage_used_mb, limits.storage_mb),
    },
  };
}

/**
 * Get aggregated usage for a time period
 */
export async function getAggregatedUsage(
  tenantId: string,
  days: number
): Promise<{
  total_executions: number;
  total_traces: number;
  total_api_requests: number;
  total_mcp_requests: number;
  total_tokens_saved: number;
  avg_daily_executions: number;
  avg_daily_api_requests: number;
}> {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const row = await queryOne<Record<string, unknown>>(
    `SELECT
      COALESCE(SUM(executions), 0) as total_executions,
      COALESCE(SUM(traces_ingested), 0) as total_traces,
      COALESCE(SUM(api_requests), 0) as total_api_requests,
      COALESCE(SUM(mcp_requests), 0) as total_mcp_requests,
      COALESCE(SUM(tokens_saved), 0) as total_tokens_saved,
      COALESCE(AVG(executions), 0) as avg_daily_executions,
      COALESCE(AVG(api_requests), 0) as avg_daily_api_requests
     FROM usage_records
     WHERE tenant_id = $1 AND date >= $2`,
    [tenantId, startDate.toISOString().split('T')[0]]
  );

  return {
    total_executions: parseInt(String(row?.['total_executions'] ?? 0), 10),
    total_traces: parseInt(String(row?.['total_traces'] ?? 0), 10),
    total_api_requests: parseInt(String(row?.['total_api_requests'] ?? 0), 10),
    total_mcp_requests: parseInt(String(row?.['total_mcp_requests'] ?? 0), 10),
    total_tokens_saved: parseInt(String(row?.['total_tokens_saved'] ?? 0), 10),
    avg_daily_executions: parseFloat(String(row?.['avg_daily_executions'] ?? 0)),
    avg_daily_api_requests: parseFloat(String(row?.['avg_daily_api_requests'] ?? 0)),
  };
}

/**
 * Update storage usage for a tenant
 */
export async function updateStorageUsage(
  tenantId: string,
  storageMb: number
): Promise<void> {
  const today = getTodayDate();
  const id = `usage_${tenantId}_${today}`;

  await query(
    `INSERT INTO usage_records (id, tenant_id, date, storage_used_mb, created_at, updated_at)
     VALUES ($1, $2, $3, $4, NOW(), NOW())
     ON CONFLICT (tenant_id, date)
     DO UPDATE SET storage_used_mb = $4, updated_at = NOW()`,
    [id, tenantId, today, storageMb]
  );
}

/**
 * Mark that a limit was hit for a tenant today
 */
export async function markLimitHit(
  tenantId: string,
  limitType: 'executions' | 'api'
): Promise<void> {
  const today = getTodayDate();
  const column = limitType === 'executions' ? 'executions_limit_hit' : 'api_limit_hit';

  await query(
    `UPDATE usage_records SET ${column} = true, updated_at = NOW()
     WHERE tenant_id = $1 AND date = $2`,
    [tenantId, today]
  );
}

/**
 * Get tenants approaching their limits (for alerts)
 */
export async function getTenantsNearLimits(
  threshold: number = 80
): Promise<Array<{ tenant_id: string; limit_type: string; percentage: number }>> {
  const today = getTodayDate();

  // This is a simplified version - in production, would join with subscriptions/plans
  const rows = await query<Record<string, unknown>>(
    `SELECT
      u.tenant_id,
      'executions' as limit_type,
      CASE WHEN p.limits->>'executions_per_day' != '-1'
        THEN (u.executions::float / (p.limits->>'executions_per_day')::float * 100)
        ELSE 0
      END as percentage
     FROM usage_records u
     JOIN subscriptions s ON u.tenant_id = s.tenant_id AND s.status IN ('active', 'trialing')
     JOIN plans p ON s.plan_id = p.id
     WHERE u.date = $1
       AND (p.limits->>'executions_per_day')::int != -1
       AND u.executions >= ((p.limits->>'executions_per_day')::float * $2 / 100)`,
    [today, threshold]
  );

  return rows.map((row) => ({
    tenant_id: row['tenant_id'] as string,
    limit_type: row['limit_type'] as string,
    percentage: parseFloat(String(row['percentage'] ?? 0)),
  }));
}

/**
 * Clean up old usage records (keep last 90 days)
 */
export async function cleanupOldUsageRecords(): Promise<number> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 90);

  const result = await query<{ id: string }>(
    'DELETE FROM usage_records WHERE date < $1 RETURNING id',
    [cutoffDate.toISOString().split('T')[0]]
  );

  return result.length;
}
