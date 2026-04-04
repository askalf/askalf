/**
 * The Watcher — Learns user patterns and pre-runs tasks
 *
 * Observes when the user does things and predicts what they'll want next.
 * Pre-generates reports, runs checks, and prepares data before the user asks.
 *
 * How it learns:
 * 1. Tracks all manual dispatches (user-initiated executions)
 * 2. Records day-of-week + hour patterns
 * 3. After 1 week of data, starts predicting
 * 4. Pre-runs predicted tasks 30 minutes before expected request time
 *
 * Example patterns it detects:
 * - "User always checks GitHub traffic on Monday morning" → pre-run analytics
 * - "User does a release every Wednesday" → pre-generate changelog
 * - "User asks about cost after big execution days" → auto-generate cost report
 * - "User checks Discord every morning" → pre-pull Discord stats
 */

import { query, queryOne } from '../database.js';
import { ulid } from 'ulid';

interface UserAction {
  hour: number;
  day_of_week: number;  // 0=Sun, 6=Sat
  action_type: string;  // 'dispatch', 'view', 'search'
  detail: string;       // what they did
  count: number;
}

interface PredictedTask {
  action: string;
  confidence: number;
  next_expected: Date;
  pre_run_at: Date;
  agent_id: string | null;
  input: string;
}

/**
 * Record a user action for pattern learning.
 * Called whenever the user manually does something significant.
 */
export async function recordUserAction(
  userId: string,
  actionType: string,
  detail: string,
): Promise<void> {
  const now = new Date();
  const hour = now.getUTCHours();
  const dayOfWeek = now.getUTCDay();

  try {
    await query(
      `INSERT INTO forge_semantic_memories (id, agent_id, owner_id, tenant_id, content, source, importance, metadata)
       VALUES ($1, 'watcher', $2, 'selfhosted', $3, 'watcher', 0.7, $4)`,
      [
        ulid(),
        userId,
        `User action: ${actionType} — ${detail}`,
        JSON.stringify({
          type: 'user_action',
          action_type: actionType,
          detail,
          hour,
          day_of_week: dayOfWeek,
          timestamp: now.toISOString(),
        }),
      ],
    );
  } catch { /* ignore — non-critical */ }
}

/**
 * Analyze user patterns and generate predictions.
 */
export async function analyzePatterns(userId: string): Promise<PredictedTask[]> {
  // Load all user actions from the last 14 days
  const actions = await query<{
    content: string;
    metadata: { action_type: string; detail: string; hour: number; day_of_week: number; timestamp: string };
  }>(
    `SELECT content, metadata FROM forge_semantic_memories
     WHERE source = 'watcher' AND owner_id = $1 AND created_at > NOW() - INTERVAL '14 days'
     ORDER BY created_at DESC LIMIT 500`,
    [userId],
  );

  if (actions.length < 10) return []; // Not enough data to predict

  // Build frequency map: (day_of_week, hour, action_type) → count
  const freqMap = new Map<string, { count: number; details: string[] }>();

  for (const action of actions) {
    const meta = action.metadata;
    if (!meta?.hour && meta?.hour !== 0) continue;
    const key = `${meta.day_of_week}-${meta.hour}-${meta.action_type}`;
    const entry = freqMap.get(key) || { count: 0, details: [] };
    entry.count++;
    if (!entry.details.includes(meta.detail)) entry.details.push(meta.detail);
    freqMap.set(key, entry);
  }

  const predictions: PredictedTask[] = [];
  const now = new Date();
  const currentDay = now.getUTCDay();
  const currentHour = now.getUTCHours();

  for (const [key, entry] of freqMap) {
    if (entry.count < 2) continue; // Need at least 2 occurrences

    const [dayStr, hourStr, actionType] = key.split('-');
    const day = parseInt(dayStr!);
    const hour = parseInt(hourStr!);

    // Calculate confidence based on consistency
    // If user did this action at this time on this day 3/4 weeks → 75% confidence
    const weeksOfData = 2;
    const confidence = Math.min(entry.count / weeksOfData, 0.95);

    if (confidence < 0.5) continue;

    // Calculate when to pre-run (30 min before expected)
    let nextExpected = new Date(now);
    nextExpected.setUTCHours(hour, 0, 0, 0);

    // If it's for a future day this week
    let daysUntil = day - currentDay;
    if (daysUntil < 0) daysUntil += 7;
    if (daysUntil === 0 && hour <= currentHour) daysUntil = 7; // Already passed today
    nextExpected.setUTCDate(nextExpected.getUTCDate() + daysUntil);

    const preRunAt = new Date(nextExpected.getTime() - 30 * 60 * 1000); // 30 min before

    // Only predict for the next 24 hours
    if (preRunAt.getTime() - now.getTime() > 24 * 60 * 60 * 1000) continue;
    if (preRunAt.getTime() < now.getTime()) continue; // Already passed

    predictions.push({
      action: `${actionType}: ${entry.details[0] || 'unknown'}`,
      confidence,
      next_expected: nextExpected,
      pre_run_at: preRunAt,
      agent_id: null,
      input: mapActionToTask(actionType!, entry.details),
    });
  }

  return predictions.sort((a, b) => a.pre_run_at.getTime() - b.pre_run_at.getTime());
}

/**
 * Map a user action pattern to a pre-runnable task.
 */
function mapActionToTask(actionType: string, details: string[]): string {
  const detail = details[0] || '';

  if (detail.includes('traffic') || detail.includes('analytics') || detail.includes('github')) {
    return 'Generate a GitHub traffic and analytics report for askalf/askalf. Include views, clones, stars, top referrers, npm downloads, and Docker Hub pulls.';
  }
  if (detail.includes('cost') || detail.includes('budget') || detail.includes('spend')) {
    return 'Generate a cost report for the last 24 hours. Break down by agent, identify the top spenders, and flag any anomalies.';
  }
  if (detail.includes('discord') || detail.includes('community')) {
    return 'Check Discord for any unanswered messages or new members. Summarize community activity.';
  }
  if (detail.includes('release') || detail.includes('deploy') || detail.includes('version')) {
    return 'Prepare a release checklist: check for uncommitted changes, pending tickets, failing tests, and version consistency.';
  }
  if (detail.includes('ticket') || detail.includes('issue') || detail.includes('bug')) {
    return 'Summarize all open tickets, their age, and priority. Flag any that are overdue.';
  }

  return `Pre-run check for: ${detail}`;
}

/**
 * Execute predicted pre-run tasks.
 * Called from the dispatcher during the pre-run window.
 */
export async function executePreRuns(): Promise<number> {
  const predictions = await analyzePatterns('selfhosted-admin');
  const now = new Date();
  let executed = 0;

  for (const pred of predictions) {
    // Only execute if we're within the pre-run window (±5 min)
    const timeDiff = Math.abs(pred.pre_run_at.getTime() - now.getTime());
    if (timeDiff > 5 * 60 * 1000) continue;

    // Check if already pre-ran this prediction today
    const existing = await queryOne<{ id: string }>(
      `SELECT id FROM forge_executions
       WHERE metadata->>'watcher_prediction' = $1
       AND created_at > NOW() - INTERVAL '12 hours'
       LIMIT 1`,
      [pred.action],
    );
    if (existing) continue;

    // Find the best agent for this task
    const agentId = await findBestAgent(pred.input);
    if (!agentId) continue;

    // Create a pre-run execution
    const execId = ulid();
    await query(
      `INSERT INTO forge_executions (id, agent_id, owner_id, tenant_id, input, status, metadata, started_at)
       VALUES ($1, $2, 'selfhosted-admin', 'selfhosted', $3, 'pending', $4, NOW())`,
      [
        execId,
        agentId,
        `[PRE-RUN] ${pred.input}`,
        JSON.stringify({
          source: 'watcher',
          watcher_prediction: pred.action,
          confidence: pred.confidence,
          predicted_need_time: pred.next_expected.toISOString(),
        }),
      ],
    );

    console.log(`[Watcher] Pre-running: "${pred.action}" (${Math.round(pred.confidence * 100)}% confidence) → agent ${agentId}`);
    executed++;
  }

  return executed;
}

async function findBestAgent(input: string): Promise<string | null> {
  const lower = input.toLowerCase();

  // Route to the most appropriate agent
  if (lower.includes('github') || lower.includes('traffic') || lower.includes('analytics')) {
    return (await queryOne<{ id: string }>(`SELECT id FROM forge_agents WHERE name = 'Analytics Tracker' AND status = 'active'`))?.id || null;
  }
  if (lower.includes('cost') || lower.includes('budget') || lower.includes('spend')) {
    return (await queryOne<{ id: string }>(`SELECT id FROM forge_agents WHERE name = 'Cost Optimizer' AND status = 'active'`))?.id || null;
  }
  if (lower.includes('discord') || lower.includes('community')) {
    return (await queryOne<{ id: string }>(`SELECT id FROM forge_agents WHERE name = 'AskAlf Discord Manager' AND status = 'active'`))?.id || null;
  }
  if (lower.includes('ticket') || lower.includes('issue')) {
    return (await queryOne<{ id: string }>(`SELECT id FROM forge_agents WHERE name = 'Watchdog' AND status = 'active'`))?.id || null;
  }
  if (lower.includes('release') || lower.includes('deploy')) {
    return (await queryOne<{ id: string }>(`SELECT id FROM forge_agents WHERE name = 'Release Manager' AND status = 'active'`))?.id || null;
  }

  return null;
}

/**
 * Check if any pre-runs should execute. Called from dispatcher tick.
 */
let lastPreRunCheck = 0;

export async function checkPreRuns(): Promise<void> {
  const now = Date.now();
  // Only check every 5 minutes
  if (now - lastPreRunCheck < 5 * 60 * 1000) return;
  lastPreRunCheck = now;

  try {
    const count = await executePreRuns();
    if (count > 0) {
      console.log(`[Watcher] Executed ${count} pre-run task(s)`);
    }
  } catch (err) {
    console.warn(`[Watcher] Pre-run check failed: ${err instanceof Error ? err.message : err}`);
  }
}
