/**
 * SELF Activity Logger
 * Writes activity events to self_activities and publishes via Redis for SSE
 */

import { ulid } from 'ulid';
import { query } from '../database.js';
import type { ActivityType } from '@substrate/self-core';

export interface LogActivityParams {
  selfId: string;
  userId: string;
  type: ActivityType;
  title: string;
  body?: string;
  metadata?: Record<string, unknown>;
  executionId?: string;
  integrationId?: string;
  approvalId?: string;
  parentId?: string;
  visibleToUser?: boolean;
  importance?: number;
  costUsd?: number;
  tokensUsed?: number;
}

interface ActivityRow {
  id: string;
  self_id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  metadata: Record<string, unknown>;
  execution_id: string | null;
  integration_id: string | null;
  approval_id: string | null;
  parent_id: string | null;
  visible_to_user: boolean;
  importance: number;
  cost_usd: string;
  tokens_used: number;
  created_at: string;
}

/**
 * Log an activity event to the feed
 */
export async function logActivity(params: LogActivityParams): Promise<string> {
  const id = ulid();
  const {
    selfId,
    userId,
    type,
    title,
    body,
    metadata,
    executionId,
    integrationId,
    approvalId,
    parentId,
    visibleToUser = true,
    importance = 5,
    costUsd = 0,
    tokensUsed = 0,
  } = params;

  await query(
    `INSERT INTO self_activities
     (id, self_id, user_id, type, title, body, metadata, execution_id,
      integration_id, approval_id, parent_id, visible_to_user, importance,
      cost_usd, tokens_used)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
    [
      id, selfId, userId, type, title, body ?? null,
      JSON.stringify(metadata ?? {}),
      executionId ?? null, integrationId ?? null, approvalId ?? null,
      parentId ?? null, visibleToUser, importance, costUsd, tokensUsed,
    ],
  );

  return id;
}

/**
 * Fetch activity feed with pagination and filtering
 */
export async function getActivityFeed(params: {
  selfId: string;
  type?: string;
  integrationId?: string;
  minImportance?: number;
  limit?: number;
  offset?: number;
}): Promise<ActivityRow[]> {
  const { selfId, type, integrationId, minImportance, limit = 50, offset = 0 } = params;

  const conditions: string[] = ['self_id = $1', 'visible_to_user = true'];
  const values: unknown[] = [selfId];
  let paramIdx = 2;

  if (type) {
    conditions.push(`type = $${paramIdx}`);
    values.push(type);
    paramIdx++;
  }

  if (integrationId) {
    conditions.push(`integration_id = $${paramIdx}`);
    values.push(integrationId);
    paramIdx++;
  }

  if (minImportance !== undefined) {
    conditions.push(`importance >= $${paramIdx}`);
    values.push(minImportance);
    paramIdx++;
  }

  conditions.push(`TRUE`);
  values.push(limit);
  paramIdx++;
  values.push(offset);

  const where = conditions.join(' AND ');

  return query<ActivityRow>(
    `SELECT id, self_id, user_id, type, title, body, metadata,
            execution_id, integration_id, approval_id, parent_id,
            visible_to_user, importance, cost_usd, tokens_used, created_at
     FROM self_activities
     WHERE ${where}
     ORDER BY created_at DESC
     LIMIT $${paramIdx - 1} OFFSET $${paramIdx}`,
    values,
  );
}

/**
 * Count activity feed items (for pagination)
 */
export async function getActivityCount(params: {
  selfId: string;
  type?: string;
  integrationId?: string;
  minImportance?: number;
}): Promise<number> {
  const { selfId, type, integrationId, minImportance } = params;

  const conditions: string[] = ['self_id = $1', 'visible_to_user = true'];
  const values: unknown[] = [selfId];
  let paramIdx = 2;

  if (type) {
    conditions.push(`type = $${paramIdx}`);
    values.push(type);
    paramIdx++;
  }

  if (integrationId) {
    conditions.push(`integration_id = $${paramIdx}`);
    values.push(integrationId);
    paramIdx++;
  }

  if (minImportance !== undefined) {
    conditions.push(`importance >= $${paramIdx}`);
    values.push(minImportance);
    paramIdx++;
  }

  const where = conditions.join(' AND ');
  const rows = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM self_activities WHERE ${where}`,
    values,
  );
  return parseInt(rows[0]?.count ?? '0', 10);
}

/**
 * Get a single activity by ID
 */
export async function getActivityById(activityId: string, selfId: string): Promise<ActivityRow | null> {
  const rows = await query<ActivityRow>(
    `SELECT id, self_id, user_id, type, title, body, metadata,
            execution_id, integration_id, approval_id, parent_id,
            visible_to_user, importance, cost_usd, tokens_used, created_at
     FROM self_activities
     WHERE id = $1 AND self_id = $2`,
    [activityId, selfId],
  );
  return rows[0] ?? null;
}
