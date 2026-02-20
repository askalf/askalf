// Continuous Learning Loop - The 24x7 Metabolic Brain
// Integrates all brain shards into a unified learning system
module.paths.unshift('/app/node_modules');

const { Pool } = require('pg');
const vm = require('vm');

const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://substrate:caff003669dce684448cb89002333263a8684242f43db4e2@pgbouncer:5432/substrate' });

// Brain shard cache
const brainShards = {};

function exec(logic, input) {
  try {
    const sb = {
      input: typeof input === 'string' ? input : JSON.stringify(input),
      result: undefined,
      JSON, Object, Array, String, Number, Boolean, Math,
      parseInt, parseFloat, RegExp, Date,
      console: { log: () => {} }
    };
    vm.runInContext(logic + '\nif(typeof execute==="function"){result=execute(input);}', vm.createContext(sb), { timeout: 5000 });
    if (sb.result === undefined) return null;
    return typeof sb.result === 'string' ? JSON.parse(sb.result) : sb.result;
  } catch(e) {
    return null;
  }
}

async function loadBrainShards() {
  const { rows } = await pool.query(`
    SELECT name, logic FROM procedural_shards
    WHERE category = 'brain' AND lifecycle IN ('testing', 'promoted')
  `);
  for (const row of rows) {
    brainShards[row.name] = row.logic;
  }
  console.log(`Loaded ${Object.keys(brainShards).length} brain shards`);
}

// Run a brain shard
function think(shardName, input) {
  if (!brainShards[shardName]) return null;
  return exec(brainShards[shardName], input);
}

// ============================================================
// LEARNING CYCLE 1: Analyze Recent Failures (Prediction Error)
// ============================================================
async function analyzePredictionErrors() {
  console.log('\n--- CYCLE 1: Prediction Error Analysis ---');

  const { rows: failures } = await pool.query(`
    SELECT ps.name, ps.logic, ps.failure_count, ps.success_count
    FROM procedural_shards ps
    WHERE ps.failure_count > 0
    AND ps.lifecycle IN ('testing', 'promoted')
    ORDER BY ps.failure_count DESC
    LIMIT 10
  `);

  const learnings = [];
  for (const shard of failures) {
    const analysis = think('prediction-error-processor', {
      shard: shard.name,
      failures: shard.failure_count,
      successes: shard.success_count,
      error_type: 'execution_failure'
    });

    if (analysis) {
      learnings.push({
        shard: shard.name,
        diagnosis: analysis.diagnosis,
        suggestion: analysis.suggestedFix
      });
      console.log(`  ${shard.name}: ${analysis.diagnosis?.substring(0, 60) || 'analyzed'}`);
    }
  }

  return learnings;
}

// ============================================================
// LEARNING CYCLE 2: Salience Scoring (What to Learn Next)
// ============================================================
async function scoreSalience() {
  console.log('\n--- CYCLE 2: Salience Scoring ---');

  const { rows: candidates } = await pool.query(`
    SELECT name, execution_count, failure_count,
           EXTRACT(EPOCH FROM (NOW() - updated_at))/3600 as hours_since_update
    FROM procedural_shards
    WHERE lifecycle = 'testing'
    ORDER BY failure_count DESC, execution_count ASC
    LIMIT 20
  `);

  const scored = [];
  for (const shard of candidates) {
    const salience = think('salience-attention-scorer', {
      pattern: shard.name,
      frequency: shard.execution_count,
      recency_hours: shard.hours_since_update || 24,
      user_explicit: false
    });

    if (salience && salience.salienceScore) {
      scored.push({
        name: shard.name,
        score: parseFloat(salience.salienceScore),
        recommendation: salience.recommendation
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  console.log(`  Top priorities: ${scored.slice(0, 3).map(s => s.name).join(', ')}`);
  return scored;
}

// ============================================================
// LEARNING CYCLE 3: Memory Consolidation (Strengthen Good Patterns)
// ============================================================
async function consolidateMemories() {
  console.log('\n--- CYCLE 3: Memory Consolidation ---');

  const { rows: highPerformers } = await pool.query(`
    SELECT name, execution_count, success_count, category
    FROM procedural_shards
    WHERE success_count > 10
    AND (success_count::float / NULLIF(execution_count, 0)) > 0.9
    AND lifecycle = 'testing'
  `);

  const consolidation = think('memory-consolidation-processor', {
    phase: 'micro',
    candidates: highPerformers.map(s => s.name),
    criteria: 'high_success_rate'
  });

  if (consolidation) {
    console.log(`  Consolidation phase: ${consolidation.schedule?.micro?.substring(0, 50) || 'active'}`);
  }

  // Actually promote high performers
  for (const shard of highPerformers) {
    if (shard.execution_count >= 50) {
      await pool.query(`UPDATE procedural_shards SET lifecycle = 'promoted' WHERE name = $1 AND lifecycle = 'testing'`, [shard.name]);
      console.log(`  ✓ Promoted: ${shard.name}`);
    }
  }

  return highPerformers;
}

// ============================================================
// LEARNING CYCLE 4: Forgetting Curve (Prune Unused Shards)
// ============================================================
async function applyForgettingCurve() {
  console.log('\n--- CYCLE 4: Forgetting Curve ---');

  const { rows: staleShards } = await pool.query(`
    SELECT name, execution_count, success_count, category,
           EXTRACT(DAYS FROM (NOW() - updated_at)) as days_stale
    FROM procedural_shards
    WHERE updated_at < NOW() - INTERVAL '30 days'
    AND lifecycle IN ('testing', 'promoted')
  `);

  const archiveCandidates = [];
  for (const shard of staleShards) {
    const successRate = shard.execution_count > 0 ? shard.success_count / shard.execution_count : 0;
    const decay = think('forgetting-curve-manager', {
      last_used_days: shard.days_stale,
      execution_count: shard.execution_count,
      success_rate: successRate,
      category: shard.category
    });

    if (decay && decay.recommendation === 'SAFE_TO_ARCHIVE') {
      archiveCandidates.push(shard.name);
    }
  }

  if (archiveCandidates.length > 0) {
    console.log(`  Archive candidates: ${archiveCandidates.join(', ')}`);
  } else {
    console.log(`  No shards ready for archival`);
  }

  return archiveCandidates;
}

// ============================================================
// LEARNING CYCLE 5: Capability Gap Detection
// ============================================================
async function detectCapabilityGaps() {
  console.log('\n--- CYCLE 5: Capability Gap Detection ---');

  // Look at recent failed traces (queries we couldn't handle)
  const { rows: failedQueries } = await pool.query(`
    SELECT DISTINCT input_preview
    FROM crystallization_traces
    WHERE success = false
    AND created_at > NOW() - INTERVAL '24 hours'
    LIMIT 10
  `);

  const gaps = [];
  for (const trace of failedQueries) {
    if (!trace.input_preview) continue;

    const gapAnalysis = think('capability-gap-detector', trace.input_preview);
    if (gapAnalysis && gapAnalysis.gaps_detected > 0) {
      for (const gap of gapAnalysis.gaps || []) {
        if (gap.can_learn) {
          gaps.push(gap);
        }
      }
    }
  }

  if (gaps.length > 0) {
    console.log(`  Detected ${gaps.length} capability gaps: ${gaps.map(g => g.detected_need).join(', ')}`);
  } else {
    console.log(`  No new capability gaps detected`);
  }

  return gaps;
}

// ============================================================
// LEARNING CYCLE 6: Dream Generation (Synthetic Testing)
// ============================================================
async function generateDreams() {
  console.log('\n--- CYCLE 6: Dream Generation ---');

  const { rows: recentShards } = await pool.query(`
    SELECT name, category
    FROM procedural_shards
    WHERE lifecycle = 'testing'
    AND execution_count < 20
    LIMIT 5
  `);

  const dreams = [];
  for (const shard of recentShards) {
    const dreamResult = think('dream-generator', {
      name: shard.name,
      category: shard.category || 'general'
    });

    if (dreamResult && dreamResult.dreams) {
      dreams.push(...dreamResult.dreams.slice(0, 3));
    }
  }

  console.log(`  Generated ${dreams.length} synthetic test cases for ${recentShards.length} shards`);
  return dreams;
}

// ============================================================
// LEARNING CYCLE 7: Cognitive Load Balancing
// ============================================================
async function balanceCognitiveLoad() {
  console.log('\n--- CYCLE 7: Cognitive Load Balance ---');

  const { rows: queueStats } = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM crystallization_traces WHERE success IS NULL) as pending,
      (SELECT COUNT(*) FROM procedural_shards WHERE lifecycle = 'candidate') as candidates
  `);

  const loadResult = think('cognitive-load-balancer', {
    current_load: queueStats[0]?.pending || 0,
    max_capacity: 100,
    pending_tasks: [
      { name: 'crystallization', complexity: 0.5, urgent: false },
      { name: 'promotion', complexity: 0.3, urgent: false },
      { name: 'error_analysis', complexity: 0.7, urgent: true }
    ]
  });

  if (loadResult) {
    console.log(`  System load: ${loadResult.status} (${loadResult.load_percentage}%)`);
  }

  return loadResult;
}

// ============================================================
// LEARNING CYCLE 8: Metacognitive Monitoring
// ============================================================
async function metacognitiveReview() {
  console.log('\n--- CYCLE 8: Metacognitive Review ---');

  const { rows: systemStats } = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM procedural_shards WHERE lifecycle = 'promoted') as promoted,
      (SELECT COUNT(*) FROM procedural_shards WHERE lifecycle = 'testing') as testing,
      (SELECT SUM(execution_count) FROM procedural_shards) as total_executions,
      (SELECT SUM(success_count) FROM procedural_shards) as total_successes
  `);

  const stats = systemStats[0];
  const overallRate = stats.total_executions > 0 ? stats.total_successes / stats.total_executions : 0;

  const review = think('metacognitive-monitor', {
    steps: ['analyze_errors', 'score_salience', 'consolidate', 'decay', 'detect_gaps', 'dream', 'balance_load'],
    outcome: overallRate > 0.8 ? 'success' : 'partial',
    duration_ms: Date.now() % 10000
  });

  if (review) {
    console.log(`  System health score: ${review.overall_score}`);
    console.log(`  Promoted: ${stats.promoted}, Testing: ${stats.testing}`);
    console.log(`  Overall success rate: ${(overallRate * 100).toFixed(1)}%`);
  }

  return { stats, review };
}

// ============================================================
// MAIN LEARNING LOOP
// ============================================================
async function runLearningCycle() {
  console.log('\n' + '═'.repeat(60));
  console.log('CONTINUOUS LEARNING CYCLE - ' + new Date().toISOString());
  console.log('═'.repeat(60));

  await loadBrainShards();

  const results = {
    predictionErrors: await analyzePredictionErrors(),
    salience: await scoreSalience(),
    consolidated: await consolidateMemories(),
    archived: await applyForgettingCurve(),
    gaps: await detectCapabilityGaps(),
    dreams: await generateDreams(),
    load: await balanceCognitiveLoad(),
    meta: await metacognitiveReview()
  };

  console.log('\n' + '═'.repeat(60));
  console.log('LEARNING CYCLE COMPLETE');
  console.log('═'.repeat(60));

  return results;
}

// Run single cycle for testing
async function main() {
  try {
    const results = await runLearningCycle();

    console.log('\n--- CYCLE SUMMARY ---');
    console.log(`Errors analyzed: ${results.predictionErrors.length}`);
    console.log(`Salience scored: ${results.salience.length}`);
    console.log(`Memories consolidated: ${results.consolidated.length}`);
    console.log(`Archive candidates: ${results.archived.length}`);
    console.log(`Gaps detected: ${results.gaps.length}`);
    console.log(`Dreams generated: ${results.dreams.length}`);
    console.log(`Load status: ${results.load?.status || 'unknown'}`);

  } catch (e) {
    console.error('Learning cycle error:', e.message);
  } finally {
    await pool.end();
  }
}

main();
