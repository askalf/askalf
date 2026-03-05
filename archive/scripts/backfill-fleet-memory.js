#!/usr/bin/env node
/**
 * Backfill Fleet Memory — One-time migration script
 *
 * Migrates existing operational data into fleet memory:
 *   1. Completed executions → Episodic memories
 *   2. Findings → Semantic memories
 *   3. Resolved tickets → Episodic memories
 *
 * Usage: Run inside the forge container or a container with access to forge API
 *   docker exec sprayberry-labs-forge node /tmp/backfill-fleet-memory.js
 *   — or —
 *   Copy to forge container: docker cp scripts/backfill-fleet-memory.js sprayberry-labs-forge:/tmp/
 */

const FORGE_URL = process.env.FORGE_URL || 'http://forge:3005';
const FORGE_API_KEY = process.env.FORGE_API_KEY;
const ADMIN_HUB_URL = process.env.ADMIN_HUB_URL || 'http://dashboard:3001';
const RATE_LIMIT_MS = 100; // 10/sec

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function callForge(path, options = {}) {
  const url = `${FORGE_URL}/api/v1/forge${path}`;
  try {
    const res = await fetch(url, {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(FORGE_API_KEY ? { 'Authorization': `Bearer ${FORGE_API_KEY}` } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { error: true, status: res.status, message: text || res.statusText };
    }
    return await res.json();
  } catch (err) {
    return { error: true, status: 503, message: err.message };
  }
}

// Direct DB access (if running inside forge container which has pg)
let pg;
let forgePool;
let substratePool;

async function initDb() {
  try {
    pg = await import('pg');
    const Pool = pg.default?.Pool || pg.Pool;

    forgePool = new Pool({
      connectionString: process.env.FORGE_DATABASE_URL || process.env.DATABASE_URL || 'postgresql://substrate:substrate@postgres:5432/forge',
    });

    substratePool = new Pool({
      connectionString: process.env.SUBSTRATE_DATABASE_URL || 'postgresql://substrate:substrate@postgres:5432/substrate',
    });

    // Test connections
    await forgePool.query('SELECT 1');
    await substratePool.query('SELECT 1');
    console.log('[DB] Connected to both forge and substrate databases');
    return true;
  } catch (err) {
    console.warn('[DB] Could not connect to databases directly:', err.message);
    console.warn('[DB] Will use API endpoints instead (slower)');
    return false;
  }
}

async function backfillExecutions() {
  console.log('\n=== Phase 1: Backfill Completed Executions → Episodic ===');

  if (!forgePool) {
    console.log('[Skip] No direct DB access for executions');
    return { ingested: 0, skipped: 0, errors: 0 };
  }

  // Find completed executions not yet ingested
  const { rows } = await forgePool.query(`
    SELECT e.id, e.agent_id, e.input, e.output, e.tool_calls, e.iterations,
           e.input_tokens, e.output_tokens, e.cost, e.duration_ms
    FROM forge_executions e
    WHERE e.status = 'completed'
      AND e.output IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM forge_episodic_memories em
        WHERE em.execution_id = e.id
      )
    ORDER BY e.created_at ASC
  `);

  console.log(`[Executions] Found ${rows.length} completed executions to backfill`);
  let ingested = 0, skipped = 0, errors = 0;

  for (const exec of rows) {
    try {
      const situation = (exec.input || '').slice(0, 500);
      if (!situation.trim()) { skipped++; continue; }

      // Summarize tool calls
      let toolCalls = [];
      try { toolCalls = JSON.parse(exec.tool_calls || '[]'); } catch { /* ignore */ }
      const toolNames = [...new Set(toolCalls.map(tc => tc.name || tc.tool || 'unknown'))];
      const action = toolNames.length > 0
        ? `Used tools: ${toolNames.join(', ')} (${toolCalls.length} calls)`
        : 'No tools used';

      const outcome = (exec.output || '').slice(0, 500);

      const result = await callForge('/memory/fleet/store', {
        method: 'POST',
        body: {
          type: 'episodic',
          agentId: exec.agent_id,
          situation,
          action,
          outcome,
          quality: 1.0,
          executionId: exec.id,
          metadata: {
            source_type: 'execution',
            source_id: exec.id,
            tokens_used: (exec.input_tokens || 0) + (exec.output_tokens || 0),
            cost: parseFloat(exec.cost) || 0,
            iterations: exec.iterations || 0,
            duration_ms: exec.duration_ms || 0,
          },
        },
      });

      if (result.error) {
        console.warn(`  [Error] Execution ${exec.id}: ${result.message}`);
        errors++;
      } else {
        ingested++;
      }

      await sleep(RATE_LIMIT_MS);
    } catch (err) {
      console.warn(`  [Error] Execution ${exec.id}: ${err.message}`);
      errors++;
    }
  }

  console.log(`[Executions] Done: ${ingested} ingested, ${skipped} skipped, ${errors} errors`);
  return { ingested, skipped, errors };
}

async function backfillFindings() {
  console.log('\n=== Phase 2: Backfill Findings → Semantic ===');

  if (!substratePool) {
    console.log('[Skip] No direct DB access for findings');
    return { ingested: 0, skipped: 0, errors: 0 };
  }

  const { rows } = await substratePool.query(`
    SELECT id, agent_id, agent_name, finding, severity, category, metadata, created_at
    FROM agent_findings
    ORDER BY created_at ASC
  `);

  console.log(`[Findings] Found ${rows.length} findings to backfill`);
  let ingested = 0, skipped = 0, errors = 0;

  const importanceMap = { critical: 1.0, warning: 0.7, info: 0.4 };

  for (const finding of rows) {
    try {
      if (!finding.finding || !finding.finding.trim()) { skipped++; continue; }
      if (!finding.agent_id) { skipped++; continue; }

      // Verify agent exists in forge
      const agentCheck = await callForge(`/agents/${finding.agent_id}`);
      if (agentCheck.error) {
        // Agent may not exist - try to find by name
        skipped++;
        continue;
      }

      const result = await callForge('/memory/fleet/store', {
        method: 'POST',
        body: {
          type: 'semantic',
          agentId: finding.agent_id,
          content: finding.finding,
          source: 'finding',
          importance: importanceMap[finding.severity] || 0.4,
          metadata: {
            source_type: 'finding',
            source_id: finding.id,
            category: finding.category || 'general',
            severity: finding.severity || 'info',
            agent_name: finding.agent_name,
          },
        },
      });

      if (result.error) {
        console.warn(`  [Error] Finding ${finding.id}: ${result.message}`);
        errors++;
      } else {
        ingested++;
      }

      await sleep(RATE_LIMIT_MS);
    } catch (err) {
      console.warn(`  [Error] Finding ${finding.id}: ${err.message}`);
      errors++;
    }
  }

  console.log(`[Findings] Done: ${ingested} ingested, ${skipped} skipped, ${errors} errors`);
  return { ingested, skipped, errors };
}

async function backfillTickets() {
  console.log('\n=== Phase 3: Backfill Resolved Tickets → Episodic ===');

  if (!substratePool) {
    console.log('[Skip] No direct DB access for tickets');
    return { ingested: 0, skipped: 0, errors: 0 };
  }

  const { rows } = await substratePool.query(`
    SELECT id, title, description, resolution, assigned_to, agent_id, agent_name,
           category, priority, created_at
    FROM agent_tickets
    WHERE status IN ('resolved', 'closed')
      AND resolution IS NOT NULL
      AND agent_id IS NOT NULL
    ORDER BY created_at ASC
  `);

  console.log(`[Tickets] Found ${rows.length} resolved tickets to backfill`);
  let ingested = 0, skipped = 0, errors = 0;

  for (const ticket of rows) {
    try {
      // Get ticket notes for the action narrative
      let actionNarrative = `Resolved by ${ticket.assigned_to || 'human'}`;
      try {
        const notesResult = await substratePool.query(
          `SELECT note FROM agent_ticket_notes WHERE ticket_id = $1 ORDER BY created_at ASC LIMIT 10`,
          [ticket.id]
        );
        if (notesResult.rows.length > 0) {
          actionNarrative = notesResult.rows.map(n => n.note).join(' → ');
        }
      } catch { /* notes table may not exist */ }

      const situation = `[Ticket] ${ticket.title}${ticket.description ? ': ' + ticket.description.slice(0, 300) : ''}`;

      const result = await callForge('/memory/fleet/store', {
        method: 'POST',
        body: {
          type: 'episodic',
          agentId: ticket.agent_id,
          situation: situation.slice(0, 500),
          action: actionNarrative.slice(0, 500),
          outcome: (ticket.resolution || '').slice(0, 500),
          quality: 1.0,
          metadata: {
            source_type: 'ticket',
            source_id: ticket.id,
            category: ticket.category,
            priority: ticket.priority,
            assigned_to: ticket.assigned_to,
          },
        },
      });

      if (result.error) {
        console.warn(`  [Error] Ticket ${ticket.id}: ${result.message}`);
        errors++;
      } else {
        ingested++;
      }

      await sleep(RATE_LIMIT_MS);
    } catch (err) {
      console.warn(`  [Error] Ticket ${ticket.id}: ${err.message}`);
      errors++;
    }
  }

  console.log(`[Tickets] Done: ${ingested} ingested, ${skipped} skipped, ${errors} errors`);
  return { ingested, skipped, errors };
}

async function main() {
  console.log('='.repeat(60));
  console.log('Fleet Memory Backfill Migration');
  console.log('='.repeat(60));
  console.log(`Forge URL: ${FORGE_URL}`);
  console.log(`Timestamp: ${new Date().toISOString()}`);

  // Test forge connectivity
  const statsResult = await callForge('/memory/fleet/stats');
  if (statsResult.error) {
    console.error(`[Fatal] Cannot reach Forge at ${FORGE_URL}: ${statsResult.message}`);
    process.exit(1);
  }
  console.log(`\n[Pre-backfill] Memory counts: semantic=${statsResult.tiers?.semantic}, episodic=${statsResult.tiers?.episodic}, procedural=${statsResult.tiers?.procedural}, total=${statsResult.total}`);

  // Initialize DB connections
  await initDb();

  // Run backfills
  const execResult = await backfillExecutions();
  const findingResult = await backfillFindings();
  const ticketResult = await backfillTickets();

  // Post-backfill stats
  const postStats = await callForge('/memory/fleet/stats');
  console.log('\n' + '='.repeat(60));
  console.log('BACKFILL COMPLETE');
  console.log('='.repeat(60));
  console.log(`Executions: ${execResult.ingested} ingested, ${execResult.errors} errors`);
  console.log(`Findings:   ${findingResult.ingested} ingested, ${findingResult.errors} errors`);
  console.log(`Tickets:    ${ticketResult.ingested} ingested, ${ticketResult.errors} errors`);
  if (!postStats.error) {
    console.log(`\n[Post-backfill] Memory counts: semantic=${postStats.tiers?.semantic}, episodic=${postStats.tiers?.episodic}, procedural=${postStats.tiers?.procedural}, total=${postStats.total}`);
  }

  // Cleanup DB connections
  if (forgePool) await forgePool.end().catch(() => {});
  if (substratePool) await substratePool.end().catch(() => {});
}

main().catch(err => {
  console.error('[Fatal]', err);
  process.exit(1);
});
