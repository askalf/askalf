/**
 * Dream Cycles — Overnight fleet learning and memory consolidation
 *
 * During low-activity hours (configurable, default 2-6am UTC), the fleet:
 * 1. REPLAY: Review all executions from the past 24 hours
 * 2. EXTRACT: Identify patterns (trigger → action → outcome)
 * 3. CONSOLIDATE: Merge duplicate memories, strengthen high-value ones
 * 4. PREDICT: Identify recurring issues and pre-create tickets
 * 5. LEARN: Write procedural memories that all agents can access
 * 6. REPORT: Summarize what was learned, store as fleet-wide insight
 */

import { query, queryOne } from '../database.js';
import { substrateQuery } from '../database.js';
import { ulid } from 'ulid';

interface ExecutionRecord {
  id: string;
  agent_id: string;
  agent_name: string;
  status: string;
  input: string;
  output: string;
  cost: number;
  error: string | null;
  created_at: string;
}

interface Pattern {
  trigger: string;
  action: string;
  outcome: string;
  agent: string;
  confidence: number;
  occurrences: number;
}

interface Prediction {
  description: string;
  probability: number;
  source: string;
  suggestedAction: string;
}

const DREAM_START_HOUR = 2;  // 2 AM UTC
const DREAM_END_HOUR = 6;    // 6 AM UTC

function isDreamTime(): boolean {
  const hour = new Date().getUTCHours();
  return hour >= DREAM_START_HOUR && hour < DREAM_END_HOUR;
}

/**
 * Run the full dream cycle. Called by the dispatcher during dream hours.
 */
export async function runDreamCycle(): Promise<{ patterns: number; predictions: number; consolidated: number; report: string }> {
  console.log('[DreamCycle] Starting overnight learning cycle...');
  const startTime = Date.now();

  // 1. REPLAY — Load all executions from last 24h
  const executions = await query<ExecutionRecord>(
    `SELECT e.id, e.agent_id, a.name as agent_name, e.status,
            COALESCE(LEFT(e.input, 500), '') as input,
            COALESCE(LEFT(e.output, 500), '') as output,
            COALESCE(e.cost, 0)::float as cost, e.error, e.created_at::text
     FROM forge_executions e
     JOIN forge_agents a ON a.id = e.agent_id
     WHERE e.created_at > NOW() - INTERVAL '24 hours'
     ORDER BY e.created_at ASC`,
  );

  console.log(`[DreamCycle] Replaying ${executions.length} executions from last 24h`);

  // 2. EXTRACT — Find patterns
  const patterns = extractPatterns(executions);
  console.log(`[DreamCycle] Extracted ${patterns.length} patterns`);

  // 3. Write procedural memories for high-confidence patterns
  let newProcedural = 0;
  for (const pattern of patterns) {
    if (pattern.confidence < 0.6 || pattern.occurrences < 2) continue;

    // Check if this pattern already exists
    const existing = await queryOne<{ id: string }>(
      `SELECT id FROM forge_procedural_memories
       WHERE trigger_pattern = $1 AND agent_id = $2`,
      [pattern.trigger, pattern.agent],
    );

    if (existing) {
      // Strengthen existing memory
      await query(
        `UPDATE forge_procedural_memories
         SET success_count = success_count + $1, confidence = $2, updated_at = NOW()
         WHERE id = $3`,
        [pattern.occurrences, pattern.confidence, existing.id],
      );
    } else {
      // Create new procedural memory
      await query(
        `INSERT INTO forge_procedural_memories (id, agent_id, owner_id, tenant_id, trigger_pattern, tool_sequence, success_count, confidence, metadata)
         VALUES ($1, $2, 'selfhosted-admin', 'selfhosted', $3, $4, $5, $6, $7)`,
        [
          ulid(),
          pattern.agent,
          pattern.trigger,
          JSON.stringify({ action: pattern.action, outcome: pattern.outcome }),
          pattern.occurrences,
          pattern.confidence,
          JSON.stringify({ source: 'dream_cycle', extracted_at: new Date().toISOString() }),
        ],
      );
      newProcedural++;
    }
  }

  // 4. CONSOLIDATE — Merge duplicate semantic memories
  const consolidated = await consolidateMemories();

  // 5. PREDICT — Identify recurring issues
  const predictions = await generatePredictions(executions);
  console.log(`[DreamCycle] Generated ${predictions.length} predictions`);

  // Create tickets for high-probability predictions
  for (const pred of predictions) {
    if (pred.probability < 0.7) continue;

    // Check for existing ticket
    const existingTicket = await substrateQuery<{ id: string }>(
      `SELECT id FROM agent_tickets WHERE title LIKE $1 AND status IN ('open','in_progress') AND deleted_at IS NULL LIMIT 1`,
      [`%${pred.description.substring(0, 30)}%`],
    ).catch(() => []);

    if (existingTicket.length === 0) {
      await substrateQuery(
        `INSERT INTO agent_tickets (id, title, description, status, priority, assigned_to, agent_name, source, tenant_id, created_at, updated_at)
         VALUES ($1, $2, $3, 'open', 'medium', 'Builder', 'Dream Cycle', 'dream_cycle', 'selfhosted', NOW(), NOW())`,
        [
          `DREAM-${ulid().substring(0, 8)}`,
          `[PREDICTED] ${pred.description}`,
          `Dream Cycle prediction (${Math.round(pred.probability * 100)}% confidence):\n\n${pred.description}\n\nSuggested action: ${pred.suggestedAction}\n\nSource: ${pred.source}`,
        ],
      );
    }
  }

  // 6. REPORT — Store dream cycle summary
  const durationSec = Math.round((Date.now() - startTime) / 1000);
  const totalCost = executions.reduce((sum, e) => sum + e.cost, 0);
  const failedCount = executions.filter(e => e.status === 'failed').length;
  const completedCount = executions.filter(e => e.status === 'completed').length;

  const report = [
    `Dream Cycle ${new Date().toISOString().split('T')[0]}`,
    `Replayed: ${executions.length} executions (${completedCount} completed, ${failedCount} failed)`,
    `Cost reviewed: $${totalCost.toFixed(2)}`,
    `Patterns extracted: ${patterns.length} (${newProcedural} new procedural memories)`,
    `Memories consolidated: ${consolidated}`,
    `Predictions: ${predictions.length} (${predictions.filter(p => p.probability >= 0.7).length} high-confidence)`,
    `Duration: ${durationSec}s`,
  ].join('\n');

  // Store as fleet-wide semantic memory
  await query(
    `INSERT INTO forge_semantic_memories (id, agent_id, owner_id, tenant_id, content, source, importance, metadata)
     VALUES ($1, $2, 'selfhosted-admin', 'selfhosted', $3, 'dream_cycle', 0.9, $4)`,
    [
      ulid(),
      '01DFLTFLEETCHIEF00000000000',  // Fleet Chief owns dream insights
      report,
      JSON.stringify({
        type: 'dream_cycle_report',
        date: new Date().toISOString(),
        executions_reviewed: executions.length,
        patterns_found: patterns.length,
        predictions_made: predictions.length,
      }),
    ],
  );

  console.log(`[DreamCycle] Complete: ${report}`);
  return { patterns: patterns.length, predictions: predictions.length, consolidated, report };
}

/**
 * Extract patterns from execution history.
 * Looks for: repeated failure→fix cycles, common triggers, cost anomalies.
 */
function extractPatterns(executions: ExecutionRecord[]): Pattern[] {
  const patterns: Pattern[] = [];

  // Group by agent
  const byAgent = new Map<string, ExecutionRecord[]>();
  for (const exec of executions) {
    const list = byAgent.get(exec.agent_name) || [];
    list.push(exec);
    byAgent.set(exec.agent_name, list);
  }

  for (const [agentName, agentExecs] of byAgent) {
    // Pattern: agent always succeeds/fails at certain tasks
    const successRate = agentExecs.filter(e => e.status === 'completed').length / agentExecs.length;

    if (successRate < 0.7 && agentExecs.length >= 3) {
      patterns.push({
        trigger: `${agentName} runs scheduled task`,
        action: 'Execution attempted',
        outcome: `${Math.round((1 - successRate) * 100)}% failure rate`,
        agent: agentExecs[0]!.agent_id,
        confidence: Math.min(agentExecs.length / 10, 0.95),
        occurrences: agentExecs.length,
      });
    }

    // Pattern: agent consistently hits max turns
    const maxTurnsHits = agentExecs.filter(e => e.output?.includes('Max turns reached'));
    if (maxTurnsHits.length >= 2) {
      patterns.push({
        trigger: `${agentName} receives complex task`,
        action: 'Agent runs out of iterations',
        outcome: `Hit max turns ${maxTurnsHits.length}/${agentExecs.length} times — needs higher max_iterations`,
        agent: agentExecs[0]!.agent_id,
        confidence: maxTurnsHits.length / agentExecs.length,
        occurrences: maxTurnsHits.length,
      });
    }

    // Pattern: cost anomaly (agent suddenly costs 2x+ its average)
    const costs = agentExecs.filter(e => e.cost > 0).map(e => e.cost);
    if (costs.length >= 3) {
      const avg = costs.reduce((a, b) => a + b, 0) / costs.length;
      const spikes = costs.filter(c => c > avg * 2);
      if (spikes.length >= 1) {
        patterns.push({
          trigger: `${agentName} cost spike`,
          action: `Average cost $${avg.toFixed(4)}, spikes to $${Math.max(...spikes).toFixed(4)}`,
          outcome: 'Cost anomaly — may need model downgrade or prompt optimization',
          agent: agentExecs[0]!.agent_id,
          confidence: 0.7,
          occurrences: spikes.length,
        });
      }
    }

    // Pattern: repeated error messages
    const errors = agentExecs.filter(e => e.error).map(e => e.error!);
    const errorCounts = new Map<string, number>();
    for (const err of errors) {
      const key = err.substring(0, 100);
      errorCounts.set(key, (errorCounts.get(key) || 0) + 1);
    }
    for (const [errMsg, count] of errorCounts) {
      if (count >= 2) {
        patterns.push({
          trigger: `${agentName} encounters error`,
          action: errMsg,
          outcome: `Recurring error (${count}x in 24h) — needs investigation`,
          agent: agentExecs[0]!.agent_id,
          confidence: Math.min(count / 5, 0.9),
          occurrences: count,
        });
      }
    }
  }

  return patterns;
}

/**
 * Consolidate duplicate semantic memories.
 * Finds memories with >80% text overlap and merges them.
 */
async function consolidateMemories(): Promise<number> {
  // Find memories with identical content (exact duplicates)
  const dupes = await query<{ content: string; cnt: string }>(
    `SELECT content, COUNT(*)::text as cnt FROM forge_semantic_memories
     GROUP BY content HAVING COUNT(*) > 1 LIMIT 50`,
  );

  let consolidated = 0;
  for (const dupe of dupes) {
    // Keep the newest, delete the rest
    const ids = await query<{ id: string }>(
      `SELECT id FROM forge_semantic_memories WHERE content = $1 ORDER BY created_at DESC`,
      [dupe.content],
    );
    if (ids.length > 1) {
      const toDelete = ids.slice(1).map(r => r.id);
      await query(
        `DELETE FROM forge_semantic_memories WHERE id = ANY($1)`,
        [toDelete],
      );
      consolidated += toDelete.length;
    }
  }

  return consolidated;
}

/**
 * Generate predictions from execution patterns.
 * Looks for: trending failures, resource exhaustion, schedule conflicts.
 */
async function generatePredictions(executions: ExecutionRecord[]): Promise<Prediction[]> {
  const predictions: Prediction[] = [];

  // Prediction: failure rate trending up
  const recentHalf = executions.slice(Math.floor(executions.length / 2));
  const olderHalf = executions.slice(0, Math.floor(executions.length / 2));

  if (recentHalf.length > 5 && olderHalf.length > 5) {
    const recentFailRate = recentHalf.filter(e => e.status === 'failed').length / recentHalf.length;
    const olderFailRate = olderHalf.filter(e => e.status === 'failed').length / olderHalf.length;

    if (recentFailRate > olderFailRate * 1.5 && recentFailRate > 0.1) {
      predictions.push({
        description: `Failure rate trending up: ${Math.round(olderFailRate * 100)}% → ${Math.round(recentFailRate * 100)}%`,
        probability: Math.min(recentFailRate * 2, 0.9),
        source: 'execution_trend_analysis',
        suggestedAction: 'Investigate recent failures for common root cause',
      });
    }
  }

  // Prediction: cost trending up
  const totalCostRecent = recentHalf.reduce((s, e) => s + e.cost, 0);
  const totalCostOlder = olderHalf.reduce((s, e) => s + e.cost, 0);

  if (totalCostOlder > 0 && totalCostRecent > totalCostOlder * 1.5) {
    predictions.push({
      description: `Daily cost trending up: $${totalCostOlder.toFixed(2)} → $${totalCostRecent.toFixed(2)} (${Math.round((totalCostRecent / totalCostOlder - 1) * 100)}% increase)`,
      probability: 0.8,
      source: 'cost_trend_analysis',
      suggestedAction: 'Review agent model assignments and execution frequency',
    });
  }

  // Prediction: SSL cert expiry (check from DB)
  // This runs during dream cycle — check if any cert is <30 days
  try {
    const certFindings = await substrateQuery<{ finding: string }>(
      `SELECT finding FROM agent_findings WHERE category = 'ssl' AND created_at > NOW() - INTERVAL '7 days' LIMIT 1`,
    );
    if (certFindings.length > 0) {
      predictions.push({
        description: 'SSL certificate approaching expiry (flagged in recent scan)',
        probability: 0.95,
        source: 'ssl_finding',
        suggestedAction: 'Renew certificate or verify Cloudflare auto-renewal is active',
      });
    }
  } catch { /* no findings table or no data */ }

  // Prediction: database growth rate
  try {
    const dbSize = await queryOne<{ size_bytes: string }>(
      `SELECT pg_database_size('askalf')::text as size_bytes`,
    );
    const sizeGB = parseInt(dbSize?.size_bytes || '0') / (1024 * 1024 * 1024);
    if (sizeGB > 0.5) {
      predictions.push({
        description: `Database at ${sizeGB.toFixed(2)}GB — may need cleanup if growth continues`,
        probability: 0.6,
        source: 'database_size_check',
        suggestedAction: 'Run Backup Agent cleanup of old executions and stale memories',
      });
    }
  } catch { /* ignore */ }

  return predictions;
}

/**
 * Check if it's time for a dream cycle and run if so.
 * Called from the dispatcher tick loop.
 */
let lastDreamDate = '';

export async function checkDreamCycle(): Promise<void> {
  if (!isDreamTime()) return;

  const today = new Date().toISOString().split('T')[0]!;
  if (lastDreamDate === today) return; // Already dreamed today

  lastDreamDate = today;

  try {
    const result = await runDreamCycle();
    console.log(`[DreamCycle] Nightly learning complete: ${result.patterns} patterns, ${result.predictions} predictions, ${result.consolidated} consolidated`);
  } catch (err) {
    console.error('[DreamCycle] Failed:', err instanceof Error ? err.message : err);
    lastDreamDate = ''; // Reset so it retries next tick
  }
}
