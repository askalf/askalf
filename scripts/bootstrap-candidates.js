/**
 * Bootstrap candidate shards by executing them against their source traces.
 * This proves they can run without crashing and activates them (candidate → testing).
 * Then runs the promotion cycle.
 */

const { initializePool, query } = require('@substrate/database');
const { initializeAI } = require('@substrate/ai');
const { procedural } = require('@substrate/memory');
const { execute: sandboxExecute } = require('@substrate/sandbox');

async function main() {
  // Initialize database
  const url = new URL(process.env.DATABASE_URL);
  await initializePool({
    host: url.hostname,
    port: parseInt(url.port || '5432'),
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
    max: 5,
  });

  // Initialize AI
  initializeAI({
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    openaiApiKey: process.env.OPENAI_API_KEY,
  });

  // Get candidate shards with one source trace each
  const rows = await query(
    `SELECT DISTINCT ON (ps.id)
       ps.id, ps.name, ps.logic,
       rt.input as trace_input, rt.output as trace_output
     FROM procedural_shards ps
     JOIN reasoning_traces rt ON rt.attracted_to_shard = ps.id
     WHERE ps.lifecycle = 'candidate'
     ORDER BY ps.id, rt.id`
  );

  console.log('Found ' + rows.length + ' candidate shards to bootstrap\n');

  let activated = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      const result = await sandboxExecute(row.logic, row.trace_input);
      const success = result.success;
      const executionMs = result.executionMs || 5;

      // Record the execution (tenantId=undefined for public bootstrap)
      await procedural.recordExecution(
        row.id,
        success,
        executionMs,
        success ? 50 : 0,
        undefined,          // executorTenantId - no tenant for bootstrap
        row.trace_input,    // inputText
        'bootstrap'         // matchMethod
      );

      if (success) {
        activated++;
        console.log('OK: ' + row.name + ' -> ' + String(result.output).substring(0, 60));
      } else {
        failed++;
        console.log('FAIL: ' + row.name + ' -> ' + (result.error || 'unknown error'));
      }
    } catch (e) {
      failed++;
      console.log('ERROR: ' + row.name + ' -> ' + e.message);
    }
  }

  console.log('\nBootstrap: ' + activated + ' succeeded, ' + failed + ' failed');

  // Run promotion cycle to move candidate → testing
  const { runPromoteCycle } = require('@substrate/metabolic/dist/cycles/promote.js');
  const promoResult = await runPromoteCycle();
  console.log('\nPromotion: ' + JSON.stringify(promoResult, null, 2));

  process.exit(0);
}

main().catch(e => {
  console.error('FATAL: ' + e.message);
  process.exit(1);
});
