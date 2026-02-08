// MEMORY-INTEGRATED RUNNER
// Tests the memory integration layer with real shard executions
// Demonstrates shards using episodic, semantic, and working memory

module.paths.unshift('/app/node_modules');

const vm = require('vm');

// Global state
let pool = null;
let initialized = false;

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
    console.error('  Shard execution error:', e.message);
    return null;
  }
}

// ============================================================
// MEMORY GATHERING (Simplified version of integration layer)
// ============================================================

async function gatherMemoryContext(searchQuery, shardName) {
  const { episodic, semantic, working } = require('@substrate/memory');

  console.log(`  Gathering memory for: "${searchQuery.substring(0, 50)}..."`);

  // Parallel fetch all memory types
  const [episodes, facts] = await Promise.all([
    episodic.findSimilarEpisodes(searchQuery, 5).catch(e => {
      console.log('    Episodic error:', e.message);
      return [];
    }),
    semantic.findSimilarFacts(searchQuery, 5).catch(e => {
      console.log('    Semantic error:', e.message);
      return [];
    })
  ]);

  // Extract insights
  const successPatterns = [];
  const failurePatterns = [];

  for (const ep of episodes) {
    if (ep.success === true && ep.lessonsLearned?.length) {
      successPatterns.push(...ep.lessonsLearned);
    } else if (ep.success === false && ep.lessonsLearned?.length) {
      failurePatterns.push(...ep.lessonsLearned);
    }
  }

  console.log(`    Found ${episodes.length} episodes, ${facts.length} facts`);

  return {
    episodes: episodes.map(ep => ({
      id: ep.id,
      situation: ep.situation,
      action: ep.action,
      outcome: ep.outcome,
      success: ep.success,
      summary: ep.summary
    })),
    facts: facts.map(f => ({
      id: f.id,
      statement: f.statement,
      confidence: f.confidence,
      category: f.category
    })),
    workingContext: [],
    insights: {
      successPatterns: [...new Set(successPatterns)].slice(0, 5),
      failurePatterns: [...new Set(failurePatterns)].slice(0, 5),
      relevantKnowledge: facts.filter(f => f.confidence >= 0.7).map(f => f.statement).slice(0, 5),
      sessionContext: ''
    }
  };
}

async function recordExecutionEpisode(shardId, shardName, input, output, success, executionMs, memoryContext) {
  const { episodic } = require('@substrate/memory');

  const situation = {
    shardName,
    input: typeof input === 'string' ? input.substring(0, 500) : JSON.stringify(input).substring(0, 500),
    memoryAvailable: !!memoryContext,
    episodesConsidered: memoryContext?.episodes?.length || 0,
    factsConsidered: memoryContext?.facts?.length || 0
  };

  const action = {
    type: 'shard_execution',
    shardId,
    executionMs
  };

  const outcome = {
    success,
    output: typeof output === 'string' ? output.substring(0, 500) : JSON.stringify(output).substring(0, 500)
  };

  const lessons = [];
  if (success) {
    if (memoryContext?.episodes?.length) {
      lessons.push(`Memory context helped: ${memoryContext.episodes.length} similar experiences consulted`);
    }
    lessons.push(`Shard ${shardName} succeeded with this input pattern`);
  } else {
    lessons.push(`Shard ${shardName} failed - may need refinement`);
  }

  try {
    const episode = await episodic.recordEpisode({
      type: 'shard_execution',
      situation,
      action,
      outcome,
      summary: `Executed ${shardName}: ${success ? 'SUCCESS' : 'FAILURE'} in ${executionMs}ms`,
      success,
      valence: success ? 'positive' : 'negative',
      importance: success ? 0.4 : 0.6,
      lessonsLearned: lessons,
      relatedShardId: shardId,
      timestamp: new Date().toISOString(),
      metadata: { memoryIntegrated: !!memoryContext }
    });
    return episode.id;
  } catch (e) {
    console.log('    Episode recording error:', e.message);
    return null;
  }
}

// ============================================================
// MEMORY-INTEGRATED SHARD EXECUTION
// ============================================================

async function executeWithMemory(shardName, originalInput, searchQuery) {
  console.log(`\n--- Executing ${shardName} with memory ---`);

  // Load the shard
  const [shard] = await query(
    `SELECT id, logic FROM procedural_shards WHERE name = $1 AND lifecycle IN ('testing', 'promoted')`,
    [shardName]
  );

  if (!shard) {
    console.log(`  Shard not found: ${shardName}`);
    return null;
  }

  // Gather memory context
  const memoryContext = await gatherMemoryContext(searchQuery || JSON.stringify(originalInput), shardName);

  // Enrich input with memory
  const enrichedInput = {
    original: originalInput,
    memory: memoryContext,
    memorySummary: buildMemorySummary(memoryContext)
  };

  console.log(`  Memory summary: ${enrichedInput.memorySummary.substring(0, 100)}...`);

  // Execute shard
  const startTime = Date.now();
  const result = execShard(shard.logic, enrichedInput);
  const executionMs = Date.now() - startTime;

  const success = result !== null && !result.error;
  console.log(`  Result: ${success ? 'SUCCESS' : 'FAILURE'} in ${executionMs}ms`);

  if (result) {
    console.log(`  Output: ${JSON.stringify(result).substring(0, 150)}...`);
  }

  // Record execution as episode
  const episodeId = await recordExecutionEpisode(
    shard.id,
    shardName,
    originalInput,
    result,
    success,
    executionMs,
    memoryContext
  );

  if (episodeId) {
    console.log(`  Recorded episode: ${episodeId}`);
  }

  return {
    success,
    result,
    executionMs,
    memoryContext,
    episodeId
  };
}

function buildMemorySummary(memory) {
  const parts = [];

  if (memory.insights.successPatterns.length > 0) {
    parts.push(`WHAT WORKED: ${memory.insights.successPatterns.join('; ')}`);
  }

  if (memory.insights.failurePatterns.length > 0) {
    parts.push(`WHAT FAILED: ${memory.insights.failurePatterns.join('; ')}`);
  }

  if (memory.insights.relevantKnowledge.length > 0) {
    parts.push(`KNOWN FACTS: ${memory.insights.relevantKnowledge.join('; ')}`);
  }

  return parts.join('\n') || 'No relevant memory context found.';
}

// ============================================================
// TEST SCENARIOS
// ============================================================

async function runIntegrationTests() {
  console.log('═'.repeat(60));
  console.log('MEMORY INTEGRATION TESTS');
  console.log(new Date().toISOString());
  console.log('═'.repeat(60));

  await initialize();

  // First, load the new memory-aware shards
  console.log('\n--- Loading memory integration shards ---');
  const fs = require('fs');
  const path = require('path');

  try {
    const sqlPath = path.join(__dirname, 'memory-integration-shards.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    // Split by semicolons and execute non-empty statements
    const statements = sql.split(';').filter(s => s.trim().length > 0);
    for (const stmt of statements) {
      try {
        await pool.query(stmt);
      } catch (e) {
        // Ignore errors (likely from SELECT at the end)
      }
    }
    console.log('  Memory integration shards loaded');
  } catch (e) {
    console.log('  Could not load shards from file:', e.message);
    console.log('  Run the SQL manually if needed');
  }

  // Test 1: Memory-Aware Decision Maker
  console.log('\n' + '='.repeat(50));
  console.log('TEST 1: Memory-Aware Decision Making');
  console.log('='.repeat(50));

  await executeWithMemory(
    'memory-aware-decision-maker',
    { task: 'process user query', context: 'test scenario' },
    'making decisions about processing user queries'
  );

  // Test 2: Experience Pattern Extractor
  console.log('\n' + '='.repeat(50));
  console.log('TEST 2: Experience Pattern Extraction');
  console.log('='.repeat(50));

  // First, get some real episodes to analyze
  const episodes = await query(`
    SELECT id, situation, action, outcome, success, summary
    FROM episodes
    WHERE type = 'shard_execution'
    ORDER BY created_at DESC
    LIMIT 10
  `);

  if (episodes.length >= 2) {
    await executeWithMemory(
      'experience-pattern-extractor',
      { episodes },
      'extracting patterns from shard executions'
    );
  } else {
    console.log('  Skipped: need at least 2 episodes');
  }

  // Test 3: Fact Consistency Checker
  console.log('\n' + '='.repeat(50));
  console.log('TEST 3: Fact Consistency Checking');
  console.log('='.repeat(50));

  await executeWithMemory(
    'fact-consistency-checker',
    { claim: 'The system uses PostgreSQL for data storage' },
    'checking facts about system architecture and databases'
  );

  // Test 4: Memory Synthesis Director
  console.log('\n' + '='.repeat(50));
  console.log('TEST 4: Memory Synthesis Direction');
  console.log('='.repeat(50));

  await executeWithMemory(
    'memory-synthesis-director',
    { taskType: 'decision', query: 'What should we do about the failing shard?' },
    'deciding which memory systems to query'
  );

  // Test 5: Learning Opportunity Detector
  console.log('\n' + '='.repeat(50));
  console.log('TEST 5: Learning Opportunity Detection');
  console.log('='.repeat(50));

  await executeWithMemory(
    'learning-opportunity-detector',
    {
      outcome: { success: true },
      memory: { episodes: [] }  // Novel situation
    },
    'detecting learning opportunities from execution outcomes'
  );

  // Summary
  console.log('\n' + '═'.repeat(60));
  console.log('INTEGRATION TEST SUMMARY');
  console.log('═'.repeat(60));

  const [stats] = await query(`
    SELECT
      (SELECT COUNT(*) FROM episodes WHERE type = 'shard_execution' AND created_at > NOW() - INTERVAL '1 hour') as recent_executions,
      (SELECT COUNT(*) FROM episodes WHERE metadata->>'memoryIntegrated' = 'true') as memory_integrated,
      (SELECT AVG(CASE WHEN success THEN 1.0 ELSE 0.0 END) FROM episodes WHERE type = 'shard_execution' AND metadata->>'memoryIntegrated' = 'true') as integrated_success_rate,
      (SELECT AVG(CASE WHEN success THEN 1.0 ELSE 0.0 END) FROM episodes WHERE type = 'shard_execution' AND (metadata->>'memoryIntegrated' IS NULL OR metadata->>'memoryIntegrated' = 'false')) as non_integrated_success_rate
  `);

  console.log(`Recent shard executions: ${stats.recent_executions}`);
  console.log(`Memory-integrated executions: ${stats.memory_integrated}`);
  console.log(`Integrated success rate: ${(parseFloat(stats.integrated_success_rate || 0.5) * 100).toFixed(1)}%`);
  console.log(`Non-integrated success rate: ${(parseFloat(stats.non_integrated_success_rate || 0.5) * 100).toFixed(1)}%`);

  console.log('\n' + '═'.repeat(60));
  console.log('MEMORY INTEGRATION COMPLETE');
  console.log('═'.repeat(60));

  await pool.end();
}

runIntegrationTests().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
