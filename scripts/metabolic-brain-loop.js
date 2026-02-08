// METABOLIC BRAIN LOOP
// The complete 24x7 continuous learning system
// Integrates: Memory Systems + Feedback Loop + Brain Shards + Metabolic Cycles

module.paths.unshift('/app/node_modules');

const vm = require('vm');

// Global state
let pool = null;
let initialized = false;
const shardCache = {};

async function initialize() {
  if (initialized) return;

  console.log('Initializing systems...');

  // Database
  const { initializePool, query } = require('@substrate/database');
  initializePool({
    connectionString: process.env.DATABASE_URL ||
      'postgresql://substrate:caff003669dce684448cb89002333263a8684242f43db4e2@pgbouncer:5432/substrate'
  });

  // AI
  const { initializeAI } = require('@substrate/ai');
  initializeAI({
    openaiApiKey: process.env.OPENAI_API_KEY,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY
  });

  // Get pool reference
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL ||
      'postgresql://substrate:caff003669dce684448cb89002333263a8684242f43db4e2@pgbouncer:5432/substrate'
  });

  initialized = true;
  console.log('Systems initialized\n');
}

async function query(sql, params = []) {
  const result = await pool.query(sql, params);
  return result.rows;
}

function execShard(logic, input) {
  try {
    const sb = {
      input: typeof input === 'string' ? input : JSON.stringify(input),
      result: undefined,
      JSON, Object, Array, String, Number, Boolean, Math,
      parseInt, parseFloat, RegExp, Date,
      console: { log: () => {} }
    };
    vm.runInContext(
      logic + '\nif(typeof execute==="function"){result=execute(input);}',
      vm.createContext(sb),
      { timeout: 5000 }
    );
    if (sb.result === undefined) return null;
    return typeof sb.result === 'string' ? JSON.parse(sb.result) : sb.result;
  } catch (e) {
    return null;
  }
}

async function loadShards(category) {
  const rows = await query(
    `SELECT name, logic FROM procedural_shards WHERE category = $1 AND lifecycle IN ('testing', 'promoted')`,
    [category]
  );
  for (const row of rows) {
    shardCache[row.name] = row.logic;
  }
  return rows.length;
}

function think(shardName, input) {
  if (!shardCache[shardName]) return null;
  return execShard(shardCache[shardName], input);
}

// ============================================================
// PHASE 1: MEMORY HEALTH CHECK
// ============================================================
async function checkMemoryHealth() {
  console.log('--- Phase 1: Memory Health ---');

  const [stats] = await query(`
    SELECT
      (SELECT COUNT(*) FROM episodes WHERE created_at > NOW() - INTERVAL '1 hour') as episodes_1h,
      (SELECT COUNT(*) FROM working_contexts WHERE created_at > NOW() - INTERVAL '1 hour') as contexts_1h,
      (SELECT COUNT(*) FROM knowledge_facts WHERE created_at > NOW() - INTERVAL '1 hour') as facts_1h,
      (SELECT COUNT(*) FROM response_attributions WHERE created_at > NOW() - INTERVAL '1 hour') as attributions_1h,
      (SELECT COUNT(*) FROM user_feedback WHERE created_at > NOW() - INTERVAL '1 hour') as feedback_1h
  `);

  console.log(`  Episodes (1h): ${stats.episodes_1h}`);
  console.log(`  Contexts (1h): ${stats.contexts_1h}`);
  console.log(`  Facts (1h): ${stats.facts_1h}`);
  console.log(`  Attributions (1h): ${stats.attributions_1h}`);
  console.log(`  Feedback (1h): ${stats.feedback_1h}`);

  return stats;
}

// ============================================================
// PHASE 2: EXERCISE MEMORY SYSTEMS
// ============================================================
async function exerciseMemory() {
  console.log('\n--- Phase 2: Memory Exercise ---');

  const { episodic, semantic, working } = require('@substrate/memory');

  // Record a metabolic cycle episode
  try {
    await episodic.recordEpisode({
      type: 'metabolic_cycle',
      situation: { phase: 'brain_loop', timestamp: new Date().toISOString() },
      action: { performed: 'continuous_learning_cycle' },
      outcome: { status: 'running' },
      summary: 'Metabolic brain loop cycle executed',
      success: true,
      valence: 'positive',
      importance: 0.2,
      timestamp: new Date().toISOString()
    });
    console.log('  Episode recorded');
  } catch (e) {
    console.log('  Episode error:', e.message);
  }

  // Create a working context for cycle analysis
  try {
    await working.createContext({
      sessionId: 'metabolic-' + Date.now(),
      rawContent: 'Metabolic brain loop analyzing system state',
      contentType: 'system',
      originalTokens: 6,
      ttlSeconds: 3600
    });
    console.log('  Context created');
  } catch (e) {
    console.log('  Context error:', e.message);
  }

  // Cleanup expired contexts
  try {
    await working.cleanupExpiredContexts();
    console.log('  Expired contexts cleaned');
  } catch (e) {
    console.log('  Cleanup error:', e.message);
  }
}

// ============================================================
// PHASE 3: FEEDBACK LOOP PROCESSING
// ============================================================
async function processFeedbackLoop() {
  console.log('\n--- Phase 3: Feedback Loop ---');

  await loadShards('feedback');

  // Get recent unprocessed feedback
  const feedback = await query(`
    SELECT uf.id, uf.feedback_score, uf.message_id
    FROM user_feedback uf
    LEFT JOIN feedback_propagation fp ON uf.id = fp.feedback_id
    WHERE fp.id IS NULL
    AND uf.created_at > NOW() - INTERVAL '24 hours'
    LIMIT 10
  `);

  let propagated = 0;
  for (const fb of feedback) {
    // Get attributions for this message
    const attributions = await query(`
      SELECT ra.shard_id, ps.outcome_score
      FROM response_attributions ra
      JOIN procedural_shards ps ON ra.shard_id = ps.id
      WHERE ra.message_id = $1
    `, [fb.message_id]);

    if (attributions.length === 0) continue;

    const result = think('feedback-propagator', {
      feedback_id: fb.id,
      feedback_score: fb.feedback_score,
      attributions: attributions.map(a => ({
        shard_id: a.shard_id,
        current_outcome_score: a.outcome_score || 0.5
      }))
    });

    if (result?.propagated) {
      for (const prop of result.propagations || []) {
        await query(`
          UPDATE procedural_shards
          SET outcome_score = $1, outcome_count = outcome_count + 1, last_outcome_at = NOW()
          WHERE id = $2
        `, [prop.new_score, prop.shard_id]);

        await query(`
          INSERT INTO feedback_propagation (feedback_id, shard_id, previous_outcome_score, new_outcome_score, score_delta)
          VALUES ($1, $2, $3, $4, $5)
        `, [fb.id, prop.shard_id, prop.previous_score, prop.new_score, prop.delta]);
      }
      propagated++;
    }
  }

  console.log(`  Processed ${feedback.length} feedback items`);
  console.log(`  Propagated to shards: ${propagated}`);
}

// ============================================================
// PHASE 4: BRAIN SHARD ANALYSIS
// ============================================================
async function runBrainAnalysis() {
  console.log('\n--- Phase 4: Brain Analysis ---');

  await loadShards('brain');

  // 1. Salience scoring for testing shards
  const testingShards = await query(`
    SELECT name, execution_count, failure_count
    FROM procedural_shards
    WHERE lifecycle = 'testing'
    ORDER BY execution_count ASC
    LIMIT 10
  `);

  const priorities = [];
  for (const shard of testingShards) {
    const salience = think('salience-attention-scorer', {
      pattern: shard.name,
      frequency: shard.execution_count,
      recency_hours: 24,
      user_explicit: false
    });
    if (salience) {
      priorities.push({ name: shard.name, score: salience.salienceScore });
    }
  }
  console.log(`  Scored ${priorities.length} shards for priority`);

  // 2. Forgetting curve analysis
  const staleShards = await query(`
    SELECT name, execution_count, success_count, category,
           EXTRACT(DAYS FROM (NOW() - updated_at)) as days_stale
    FROM procedural_shards
    WHERE updated_at < NOW() - INTERVAL '14 days'
    AND lifecycle IN ('testing', 'promoted')
    LIMIT 20
  `);

  let archiveCandidates = 0;
  for (const shard of staleShards) {
    const rate = shard.execution_count > 0 ? shard.success_count / shard.execution_count : 0;
    const decay = think('forgetting-curve-manager', {
      last_used_days: shard.days_stale || 14,
      execution_count: shard.execution_count,
      success_rate: rate,
      category: shard.category
    });
    if (decay?.recommendation === 'SAFE_TO_ARCHIVE') {
      archiveCandidates++;
    }
  }
  console.log(`  Archive candidates: ${archiveCandidates}`);

  // 3. Metacognitive review
  const [systemStats] = await query(`
    SELECT
      (SELECT COUNT(*) FROM procedural_shards WHERE lifecycle = 'promoted') as promoted,
      (SELECT COUNT(*) FROM procedural_shards WHERE lifecycle = 'testing') as testing,
      (SELECT SUM(execution_count) FROM procedural_shards) as total_exec,
      (SELECT SUM(success_count) FROM procedural_shards) as total_success,
      (SELECT AVG(outcome_score) FROM procedural_shards WHERE outcome_count > 0) as avg_outcome
  `);

  const execRate = systemStats.total_exec > 0
    ? systemStats.total_success / systemStats.total_exec
    : 0;

  const meta = think('metacognitive-monitor', {
    steps: ['memory', 'feedback', 'salience', 'decay', 'analysis'],
    outcome: execRate > 0.9 ? 'success' : 'partial',
    duration_ms: Date.now() % 10000
  });

  console.log(`  System health: ${meta?.overall_score || 'unknown'}`);
  console.log(`  Promoted: ${systemStats.promoted}, Testing: ${systemStats.testing}`);
  console.log(`  Execution rate: ${(execRate * 100).toFixed(1)}%`);
  console.log(`  Avg outcome: ${parseFloat(systemStats.avg_outcome || 0.5).toFixed(3)}`);
}

// ============================================================
// PHASE 5: METABOLIC CYCLES
// ============================================================
async function runMetabolicCycles() {
  console.log('\n--- Phase 5: Metabolic Cycles ---');

  const { runCrystallizeCycle, runPromoteCycle, runDecayCycle } = require('@substrate/metabolic');

  try {
    const crystal = await runCrystallizeCycle();
    console.log(`  Crystallize: ${crystal?.crystallized || 0} shards created`);
  } catch (e) {
    console.log(`  Crystallize error: ${e.message}`);
  }

  try {
    const promote = await runPromoteCycle();
    console.log(`  Promote: ${promote?.promoted || 0} promoted, ${promote?.demoted || 0} demoted`);
  } catch (e) {
    console.log(`  Promote error: ${e.message}`);
  }

  try {
    const decay = await runDecayCycle();
    console.log(`  Decay: ${decay?.archived || 0} archived`);
  } catch (e) {
    console.log(`  Decay error: ${e.message}`);
  }
}

// ============================================================
// PHASE 6: REINFORCEMENT LEARNING
// ============================================================
async function runReinforcement() {
  console.log('\n--- Phase 6: Reinforcement ---');

  const shardsWithOutcomes = await query(`
    SELECT id, name, outcome_score, outcome_count,
           CASE WHEN execution_count > 0 THEN success_count::float / execution_count ELSE 1.0 END as exec_rate
    FROM procedural_shards
    WHERE outcome_count >= 5
    ORDER BY outcome_count DESC
    LIMIT 20
  `);

  const actions = { promote: 0, maintain: 0, review: 0, deprioritize: 0 };

  for (const shard of shardsWithOutcomes) {
    const result = think('reinforcement-learner', {
      shard_id: shard.id,
      shard_name: shard.name,
      outcome_score: shard.outcome_score,
      execution_success_rate: shard.exec_rate,
      outcome_count: shard.outcome_count,
      trend: 'stable'
    });

    if (result?.action) {
      actions[result.action] = (actions[result.action] || 0) + 1;
    }
  }

  console.log(`  Analyzed ${shardsWithOutcomes.length} shards with outcomes`);
  console.log(`  Actions: promote=${actions.promote}, maintain=${actions.maintain}, review=${actions.review}, deprioritize=${actions.deprioritize}`);
}

// ============================================================
// MAIN LOOP
// ============================================================
async function runMetabolicBrainLoop() {
  console.log('═'.repeat(60));
  console.log('METABOLIC BRAIN LOOP');
  console.log(new Date().toISOString());
  console.log('═'.repeat(60));

  await initialize();

  const memoryHealth = await checkMemoryHealth();
  await exerciseMemory();
  await processFeedbackLoop();
  await runBrainAnalysis();
  await runMetabolicCycles();
  await runReinforcement();

  // Final summary
  console.log('\n' + '═'.repeat(60));
  console.log('CYCLE COMPLETE');
  console.log('═'.repeat(60));

  const [final] = await query(`
    SELECT
      (SELECT COUNT(*) FROM procedural_shards WHERE lifecycle IN ('testing', 'promoted')) as active_shards,
      (SELECT COUNT(*) FROM procedural_shards WHERE outcome_count > 0) as shards_with_feedback,
      (SELECT ROUND(AVG(outcome_score)::numeric, 3) FROM procedural_shards WHERE outcome_count > 0) as avg_outcome,
      (SELECT COUNT(*) FROM episodes WHERE created_at > NOW() - INTERVAL '1 hour') as episodes_1h,
      (SELECT COUNT(*) FROM feedback_propagation WHERE created_at > NOW() - INTERVAL '1 hour') as propagations_1h
  `);

  console.log(`Active shards: ${final.active_shards}`);
  console.log(`Shards with feedback: ${final.shards_with_feedback}`);
  console.log(`Average outcome: ${final.avg_outcome}`);
  console.log(`Episodes (1h): ${final.episodes_1h}`);
  console.log(`Propagations (1h): ${final.propagations_1h}`);

  await pool.end();
}

runMetabolicBrainLoop().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
