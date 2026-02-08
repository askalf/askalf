/**
 * Human-in-the-Loop Checkpoints
 * Creates, responds to, and waits for human checkpoints in workflow runs.
 * All state is persisted in the forge_checkpoints table.
 */

import { ulid } from 'ulid';
import { query, queryOne } from '../database.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CheckpointRow {
  id: string;
  workflow_run_id: string | null;
  execution_id: string | null;
  owner_id: string;
  type: 'approval' | 'review' | 'input' | 'confirmation';
  title: string;
  description: string | null;
  context: Record<string, unknown>;
  response: Record<string, unknown> | null;
  status: 'pending' | 'approved' | 'rejected' | 'responded' | 'timeout';
  timeout_at: string | null;
  responded_at: string | null;
  created_at: string;
}

export interface CreateCheckpointOptions {
  workflowRunId?: string | undefined;
  executionId?: string | undefined;
  ownerId: string;
  type: 'approval' | 'review' | 'input' | 'confirmation';
  title: string;
  description?: string | undefined;
  context?: Record<string, unknown> | undefined;
  timeoutMinutes?: number | undefined;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Insert a new checkpoint record and return its ID.
 * If `timeoutMinutes` is supplied the `timeout_at` column is set accordingly.
 */
export async function createCheckpoint(opts: CreateCheckpointOptions): Promise<string> {
  const id = ulid();

  const timeoutAt = opts.timeoutMinutes !== undefined
    ? new Date(Date.now() + opts.timeoutMinutes * 60_000).toISOString()
    : null;

  await query(
    `INSERT INTO forge_checkpoints
       (id, workflow_run_id, execution_id, owner_id, type, title, description, context, status, timeout_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9)`,
    [
      id,
      opts.workflowRunId ?? null,
      opts.executionId ?? null,
      opts.ownerId,
      opts.type,
      opts.title,
      opts.description ?? null,
      JSON.stringify(opts.context ?? {}),
      timeoutAt,
    ],
  );

  return id;
}

/**
 * Record a human response against a checkpoint.
 * The status is set to 'responded' and `responded_at` is populated.
 */
export async function respondToCheckpoint(
  checkpointId: string,
  response: Record<string, unknown>,
): Promise<void> {
  const result = await query(
    `UPDATE forge_checkpoints
        SET response = $1,
            status = 'responded',
            responded_at = NOW()
      WHERE id = $2
        AND status = 'pending'`,
    [JSON.stringify(response), checkpointId],
  );

  if ((result as unknown[]).length === 0) {
    // The query helper returns rows; for UPDATE we check via a follow-up
    // to ensure the row was actually updated.
    const row = await queryOne<CheckpointRow>(
      `SELECT id, status FROM forge_checkpoints WHERE id = $1`,
      [checkpointId],
    );
    if (!row) {
      throw new Error(`Checkpoint not found: ${checkpointId}`);
    }
    if (row.status !== 'responded') {
      throw new Error(
        `Checkpoint ${checkpointId} is not in a respondable state (current: ${row.status})`,
      );
    }
  }
}

/**
 * Poll the database until a checkpoint is responded to or times out.
 *
 * @param checkpointId  - The checkpoint to wait for.
 * @param pollIntervalMs - How often to poll (default 1 000 ms).
 * @param timeoutMs      - Maximum time to wait before throwing (default 300 000 ms / 5 min).
 * @returns The checkpoint row once it is no longer pending.
 */
export async function waitForCheckpoint(
  checkpointId: string,
  pollIntervalMs: number = 1_000,
  timeoutMs: number = 300_000,
): Promise<CheckpointRow> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const row = await queryOne<CheckpointRow>(
      `SELECT * FROM forge_checkpoints WHERE id = $1`,
      [checkpointId],
    );

    if (!row) {
      throw new Error(`Checkpoint not found: ${checkpointId}`);
    }

    // If the checkpoint has a timeout_at and we've passed it, expire it
    if (row.status === 'pending' && row.timeout_at) {
      const timeoutDate = new Date(row.timeout_at);
      if (Date.now() >= timeoutDate.getTime()) {
        await query(
          `UPDATE forge_checkpoints SET status = 'timeout' WHERE id = $1 AND status = 'pending'`,
          [checkpointId],
        );
        const updated = await queryOne<CheckpointRow>(
          `SELECT * FROM forge_checkpoints WHERE id = $1`,
          [checkpointId],
        );
        if (!updated) {
          throw new Error(`Checkpoint disappeared: ${checkpointId}`);
        }
        return updated;
      }
    }

    // Terminal states
    if (row.status !== 'pending') {
      return row;
    }

    // Wait before next poll
    await sleep(pollIntervalMs);
  }

  // Polling timeout reached
  await query(
    `UPDATE forge_checkpoints SET status = 'timeout' WHERE id = $1 AND status = 'pending'`,
    [checkpointId],
  );

  const final = await queryOne<CheckpointRow>(
    `SELECT * FROM forge_checkpoints WHERE id = $1`,
    [checkpointId],
  );

  if (!final) {
    throw new Error(`Checkpoint not found: ${checkpointId}`);
  }

  return final;
}

/**
 * Return all pending (active) checkpoints for a given owner.
 */
export async function getActiveCheckpoints(ownerId: string): Promise<CheckpointRow[]> {
  return query<CheckpointRow>(
    `SELECT *
       FROM forge_checkpoints
      WHERE owner_id = $1
        AND status = 'pending'
      ORDER BY created_at DESC`,
    [ownerId],
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
