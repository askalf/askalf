#!/usr/bin/env node
/**
 * SUBSTRATE v1 - Metabolic Cycle Test
 * Tests: Crystallize → Promote → Decay
 */

require('dotenv').config();
process.env.LOG_LEVEL = 'info';

const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function test() {
  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║        SUBSTRATE v1 - Metabolic Cycle Test                 ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  // Load modules dynamically (ESM)
  const { initializeAI, generateEmbedding } = await import('./packages/ai/dist/index.js');
  const { initializePool } = await import('./packages/database/dist/index.js');
  const { runCrystallizeCycle } = await import('./packages/metabolic/dist/index.js');
  const { ids, generatePatternHash } = await import('./packages/core/dist/index.js');
  const { execute } = await import('./packages/sandbox/dist/index.js');
  const { initializeEventBus } = await import('./packages/events/dist/index.js');

  // Initialize database for metabolic package
  initializePool({ connectionString: process.env.DATABASE_URL });

  // Initialize Redis event bus
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  initializeEventBus({ redisUrl });

  initializeAI({
    openaiApiKey: process.env.OPENAI_API_KEY,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  });

  // ========================================
  // PHASE 1: Seed Similar Traces
  // ========================================
  console.log('━━━ PHASE 1: Seeding Similar Traces ━━━\n');

  // Create 5+ similar traces for the same pattern (required for crystallization)
  const tracePattern = [
    { input: 'Convert 100 USD to EUR', output: '92.50 EUR', reasoning: 'Using exchange rate 0.925: 100 * 0.925 = 92.50' },
    { input: 'Convert 50 USD to EUR', output: '46.25 EUR', reasoning: 'Using exchange rate 0.925: 50 * 0.925 = 46.25' },
    { input: 'Convert 200 USD to EUR', output: '185 EUR', reasoning: 'Using exchange rate 0.925: 200 * 0.925 = 185' },
    { input: 'Convert 75 USD to EUR', output: '69.38 EUR', reasoning: 'Using exchange rate 0.925: 75 * 0.925 = 69.375' },
    { input: 'Convert 150 USD to EUR', output: '138.75 EUR', reasoning: 'Using exchange rate 0.925: 150 * 0.925 = 138.75' },
    { input: 'Convert 500 USD to EUR', output: '462.50 EUR', reasoning: 'Using exchange rate 0.925: 500 * 0.925 = 462.50' },
  ];

  // Use same pattern hash for all (simulates repeated pattern)
  const patternHash = generatePatternHash('Convert USD to EUR', 'EUR result');

  for (const trace of tracePattern) {
    const id = ids.trace();
    const embedding = await generateEmbedding(trace.input + ' ' + trace.output);
    const embStr = '[' + embedding.join(',') + ']';

    await pool.query(
      `INSERT INTO reasoning_traces
       (id, input, reasoning, output, pattern_hash, embedding, tokens_used, execution_ms, synthesized, source, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
       ON CONFLICT (id) DO NOTHING`,
      [id, trace.input, trace.reasoning, trace.output, patternHash, embStr, 50, 100, false, 'metabolic-test']
    );
    console.log(`  ✓ Seeded trace: ${trace.input.substring(0, 40)}...`);
  }

  // Check unsynthesized traces
  const unsynthCount = await pool.query(
    'SELECT COUNT(*) as c FROM reasoning_traces WHERE synthesized = false'
  );
  console.log(`\n  Total unsynthesized traces: ${unsynthCount.rows[0].c}`);

  // ========================================
  // PHASE 2: Run Crystallization
  // ========================================
  console.log('\n━━━ PHASE 2: Running Crystallization Cycle ━━━\n');

  try {
    const result = await runCrystallizeCycle({
      minTracesPerCluster: 5,
      maxClustersPerCycle: 5,
    });

    console.log(`  Shards created: ${result.shardsCreated}`);
    console.log(`  Traces processed: ${result.tracesProcessed}`);

    if (result.shardsCreated > 0) {
      console.log('  ✅ Crystallization successful!');
    } else {
      console.log('  ⚠️  No shards created (may need more similar traces or Anthropic API key)');
    }
  } catch (e) {
    console.log('  ❌ Crystallization failed:', e.message);
    if (e.message.includes('Anthropic')) {
      console.log('  (Crystallization requires Anthropic API for synthesis)');
    }
  }

  // ========================================
  // PHASE 3: Check Shard Lifecycle
  // ========================================
  console.log('\n━━━ PHASE 3: Shard Lifecycle Status ━━━\n');

  const shardStats = await pool.query(`
    SELECT lifecycle, COUNT(*) as count
    FROM procedural_shards
    GROUP BY lifecycle
    ORDER BY lifecycle
  `);

  for (const row of shardStats.rows) {
    console.log(`  ${row.lifecycle}: ${row.count}`);
  }

  // ========================================
  // PHASE 4: Test Shard Execution & Promotion
  // ========================================
  console.log('\n━━━ PHASE 4: Test Execution & Promotion ━━━\n');

  // Get a testing/candidate shard (prefer candidates so we can promote them to promoted)
  const testShard = await pool.query(`
    SELECT id, name, logic, lifecycle
    FROM procedural_shards
    WHERE lifecycle IN ('testing', 'candidate')
    ORDER BY
      CASE lifecycle WHEN 'candidate' THEN 1 WHEN 'testing' THEN 2 END,
      confidence DESC
    LIMIT 1
  `);

  if (testShard.rows.length > 0) {
    const shard = testShard.rows[0];
    console.log(`  Testing shard: ${shard.name} (${shard.lifecycle})`);

    // Execute it multiple times successfully (15 times to get from 0.5 to 0.8 confidence)
    for (let i = 0; i < 15; i++) {
      try {
        const result = await execute(shard.logic, '100');
        if (result.success) {
          await pool.query(`
            UPDATE procedural_shards
            SET execution_count = execution_count + 1,
                success_count = success_count + 1,
                confidence = LEAST(confidence + 0.02, 1.0)
            WHERE id = $1
          `, [shard.id]);
        }
      } catch (e) {
        // Ignore execution errors for this test
      }
    }

    // Check if it can be promoted (confidence > 0.7, success rate > 80%)
    const updated = await pool.query(`
      SELECT id, name, confidence, execution_count, success_count, lifecycle
      FROM procedural_shards WHERE id = $1
    `, [shard.id]);

    if (updated.rows.length > 0) {
      const s = updated.rows[0];
      const successRate = s.execution_count > 0 ? (s.success_count / s.execution_count) : 0;
      console.log(`  Confidence: ${(s.confidence * 100).toFixed(1)}%`);
      console.log(`  Success rate: ${(successRate * 100).toFixed(1)}%`);

      if (s.confidence >= 0.7 && successRate >= 0.8) {
        // Promote to candidate or promoted
        const newLifecycle = s.lifecycle === 'testing' ? 'candidate' : 'promoted';
        await pool.query(`
          UPDATE procedural_shards SET lifecycle = $1 WHERE id = $2
        `, [newLifecycle, s.id]);
        console.log(`  ✅ Promoted to: ${newLifecycle}`);
      }
    }
  } else {
    console.log('  No testing/candidate shards to test');
  }

  // ========================================
  // PHASE 5: Decay Check
  // ========================================
  console.log('\n━━━ PHASE 5: Decay Status ━━━\n');

  // Find shards that haven't been executed recently
  const staleShards = await pool.query(`
    SELECT id, name, lifecycle, last_executed, execution_count
    FROM procedural_shards
    WHERE last_executed < NOW() - INTERVAL '7 days'
       OR last_executed IS NULL
    LIMIT 5
  `);

  if (staleShards.rows.length > 0) {
    console.log('  Stale shards (candidates for decay):');
    for (const s of staleShards.rows) {
      console.log(`    - ${s.name} (${s.lifecycle}, ${s.execution_count} executions)`);
    }
  } else {
    console.log('  No stale shards found');
  }

  // ========================================
  // SUMMARY
  // ========================================
  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║                    METABOLIC SUMMARY                       ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  const finalStats = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM reasoning_traces WHERE synthesized = false) as pending_traces,
      (SELECT COUNT(*) FROM reasoning_traces WHERE synthesized = true) as synthesized_traces,
      (SELECT COUNT(*) FROM procedural_shards WHERE lifecycle = 'testing') as testing_shards,
      (SELECT COUNT(*) FROM procedural_shards WHERE lifecycle = 'candidate') as candidate_shards,
      (SELECT COUNT(*) FROM procedural_shards WHERE lifecycle = 'promoted') as promoted_shards,
      (SELECT COUNT(*) FROM procedural_shards WHERE lifecycle = 'deprecated') as deprecated_shards
  `);

  const stats = finalStats.rows[0];
  console.log('  Traces:');
  console.log(`    Pending: ${stats.pending_traces}`);
  console.log(`    Synthesized: ${stats.synthesized_traces}`);
  console.log('  Shards:');
  console.log(`    Testing: ${stats.testing_shards}`);
  console.log(`    Candidate: ${stats.candidate_shards}`);
  console.log(`    Promoted: ${stats.promoted_shards}`);
  console.log(`    Deprecated: ${stats.deprecated_shards}`);

  // Clean up
  const { closeEventBus } = await import('./packages/events/dist/index.js');
  await closeEventBus();
  await pool.end();
  console.log('\n✅ Metabolic cycle test complete!\n');
}

test().catch(e => {
  console.error('\n💥 Test failed:', e.message);
  console.error(e.stack);
  process.exit(1);
});
