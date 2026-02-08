#!/usr/bin/env node
/**
 * SUBSTRATE v1 - Production Test Suite
 * Comprehensive testing of all components
 */

process.env.LOG_LEVEL = 'silent';

require('dotenv').config();

const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Load packages
const { initializeAI, generateEmbedding, complete } = require('./packages/ai/dist/index.js');
const { execute, validateLogic } = require('./packages/sandbox/dist/index.js');
const { ids, generatePatternHash } = require('./packages/core/dist/index.js');

initializeAI({
  openaiApiKey: process.env.OPENAI_API_KEY,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY
});

let passed = 0;
let failed = 0;

function test(name, result, expected) {
  const ok = result === expected;
  if (ok) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.log(`  ❌ ${name} (got: ${result}, expected: ${expected})`);
  }
  return ok;
}

async function testSuite() {
  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║        SUBSTRATE v1 - Production Test Suite               ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  // ========================================
  // TEST 1: Core Utilities
  // ========================================
  console.log('━━━ TEST 1: Core Utilities ━━━');

  const traceId = ids.trace();
  test('Trace ID format', traceId.startsWith('trc_'), true);

  const shardId = ids.shard();
  test('Shard ID format', shardId.startsWith('shd_'), true);

  const hash = generatePatternHash('input', 'output');
  test('Pattern hash length', hash.length, 16);

  // ========================================
  // TEST 2: Sandbox Security
  // ========================================
  console.log('\n━━━ TEST 2: Sandbox Security ━━━');

  const v1 = validateLogic('function execute(x) { return x * 2; }');
  test('Valid code passes', v1.valid, true);

  const v2 = validateLogic('eval("malicious")');
  test('Eval blocked', v2.valid, false);

  const v3 = validateLogic('process.exit(1)');
  test('Process access blocked', v3.valid, false);

  const v4 = validateLogic('require("fs")');
  test('Require blocked', v4.valid, false);

  // ========================================
  // TEST 3: Sandbox Execution
  // ========================================
  console.log('\n━━━ TEST 3: Sandbox Execution ━━━');

  const e1 = await execute('function execute(x) { return parseInt(x) * 2; }', '21');
  test('Basic execution', e1.output, 42);

  const e2 = await execute('function execute(x) { return x.toUpperCase(); }', 'hello');
  test('String transform', e2.output, 'HELLO');

  const e3 = await execute('function execute(x) { return JSON.parse(x).a + JSON.parse(x).b; }', '{"a":10,"b":5}');
  test('JSON processing', e3.output, 15);

  const e4 = await execute('function execute(x) { while(true){} }', 'test');
  test('Timeout protection', e4.success, false);

  // ========================================
  // TEST 4: Embeddings
  // ========================================
  console.log('\n━━━ TEST 4: Embeddings (OpenAI) ━━━');

  const emb1 = await generateEmbedding('Hello world');
  test('Embedding dimensions', emb1.length, 1536);
  test('Embedding values are numbers', typeof emb1[0], 'number');

  // Test semantic similarity
  const emb2 = await generateEmbedding('Hi there');
  const emb3 = await generateEmbedding('Database optimization');

  // Cosine similarity helper
  const cosineSim = (a, b) => {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  };

  const sim12 = cosineSim(emb1, emb2);
  const sim13 = cosineSim(emb1, emb3);
  test('Similar texts have higher similarity', sim12 > sim13, true);

  // ========================================
  // TEST 5: Database Vector Search
  // ========================================
  console.log('\n━━━ TEST 5: Database Vector Search ━━━');

  // Seed test data for vector search
  const optEpisodeId = ids.episode();
  const optEpisodeSummary = 'Optimized SQL query performance by adding indexes and rewriting joins';
  const optEpisodeEmb = await generateEmbedding(optEpisodeSummary);
  const optEpisodeEmbStr = '[' + optEpisodeEmb.join(',') + ']';

  await pool.query(
    `INSERT INTO episodes (id, situation, action, outcome, type, summary, success, valence, importance, lessons_learned, embedding, timestamp, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [
      optEpisodeId,
      JSON.stringify({ context: 'Slow database queries' }),
      JSON.stringify({ steps: ['Analyzed query plans', 'Added indexes'] }),
      JSON.stringify({ result: '10x faster queries' }),
      'optimization',
      optEpisodeSummary,
      true,
      'positive',
      0.9,
      JSON.stringify(['Always check query plans']),
      optEpisodeEmbStr
    ]
  );

  const waterFactId = ids.fact();
  const waterFactEmb = await generateEmbedding('water boiling temperature');
  const waterFactEmbStr = '[' + waterFactEmb.join(',') + ']';

  await pool.query(
    `INSERT INTO knowledge_facts (id, subject, predicate, object, statement, confidence, sources, evidence, embedding, category, is_temporal, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [waterFactId, 'water', 'boils at', '100°C', 'Water boils at 100°C at sea level', 0.99, ['physics'], '[]', waterFactEmbStr, 'science', false]
  );

  // Search episodes
  const searchEmb = await generateEmbedding('SQL query performance tuning');
  const embStr = '[' + searchEmb.join(',') + ']';

  const episodes = await pool.query(
    'SELECT type, 1 - (embedding <=> $1::vector) as sim FROM episodes ORDER BY embedding <=> $1::vector LIMIT 1',
    [embStr]
  );
  test('Episode search returns results', episodes.rows.length > 0, true);
  if (episodes.rows.length > 0) {
    test('Best match is optimization', episodes.rows[0].type, 'optimization');
  }

  // Search facts
  const factSearchEmb = await generateEmbedding('water temperature');
  const factSearchEmbStr = '[' + factSearchEmb.join(',') + ']';

  let facts;
  try {
    facts = await pool.query(
      'SELECT subject, 1 - (embedding <=> $1::vector) as sim FROM knowledge_facts ORDER BY embedding <=> $1::vector LIMIT 1',
      [factSearchEmbStr]
    );
  } catch (e) {
    console.log('  DEBUG: Fact query error:', e.message);
    facts = { rows: [] };
  }
  test('Fact search returns results', facts.rows.length > 0, true);
  if (facts.rows.length > 0) {
    test('Best match is water-related', facts.rows[0].subject, 'water');
  }

  // ========================================
  // TEST 6: Procedural Shard Execution
  // ========================================
  console.log('\n━━━ TEST 6: Shard Execution Pipeline ━━━');

  // Find shard by semantic search
  const shardEmb = await generateEmbedding('convert temperature celsius');
  const shardEmbStr = '[' + shardEmb.join(',') + ']';

  const shards = await pool.query(
    `SELECT id, name, logic, 1 - (embedding <=> $1::vector) as sim
     FROM procedural_shards
     WHERE lifecycle = 'promoted'
     ORDER BY embedding <=> $1::vector LIMIT 1`,
    [shardEmbStr]
  );

  test('Shard search finds match', shards.rows.length > 0, true);

  if (shards.rows.length > 0) {
    const shard = shards.rows[0];
    test('Found celsius converter', shard.name, 'celsius-to-fahrenheit');

    // Execute the shard
    const result = await execute(shard.logic, '0');
    test('Shard execution succeeds', result.success, true);
    test('0°C = 32°F', result.output, '32 fahrenheit');

    const result2 = await execute(shard.logic, '-40');
    test('-40°C = -40°F', result2.output, '-40 fahrenheit');
  }

  // ========================================
  // TEST 7: Trace Ingestion
  // ========================================
  console.log('\n━━━ TEST 7: Trace Ingestion ━━━');

  const beforeCount = await pool.query('SELECT COUNT(*) as c FROM reasoning_traces');

  const testInput = 'What is the square root of 144?';
  const testOutput = '12';
  const testReasoning = 'sqrt(144) = 12 because 12 * 12 = 144';

  const traceEmb = await generateEmbedding(testInput + ' ' + testOutput);
  const traceEmbStr = '[' + traceEmb.join(',') + ']';
  const traceHash = generatePatternHash(testInput, testOutput);
  const newTraceId = ids.trace();

  await pool.query(
    `INSERT INTO reasoning_traces (id, input, reasoning, output, pattern_hash, embedding, tokens_used, execution_ms, source, timestamp)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
    [newTraceId, testInput, testReasoning, testOutput, traceHash, traceEmbStr, 50, 500, 'test']
  );

  const afterCount = await pool.query('SELECT COUNT(*) as c FROM reasoning_traces');
  test('Trace inserted', parseInt(afterCount.rows[0].c), parseInt(beforeCount.rows[0].c) + 1);

  // ========================================
  // TEST 8: Knowledge Store
  // ========================================
  console.log('\n━━━ TEST 8: Knowledge Store ━━━');

  const factInput = 'The speed of light in vacuum';
  const factEmb2 = await generateEmbedding(factInput);
  const factEmbStr2 = '[' + factEmb2.join(',') + ']';
  const factId = ids.fact();

  await pool.query(
    `INSERT INTO knowledge_facts (id, subject, predicate, object, statement, confidence, sources, evidence, embedding, category, is_temporal, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())`,
    [factId, 'speed of light', 'equals', '299792458 m/s', 'The speed of light equals 299792458 m/s', 0.99, ['physics'], '[]', factEmbStr2, 'science', false]
  );

  // Verify retrieval
  const retrieved = await pool.query('SELECT * FROM knowledge_facts WHERE id = $1', [factId]);
  test('Fact stored and retrieved', retrieved.rows.length, 1);
  test('Fact confidence correct', retrieved.rows[0].confidence, 0.99);

  // ========================================
  // TEST 9: Episode Recording
  // ========================================
  console.log('\n━━━ TEST 9: Episode Recording ━━━');

  const episodeSummary = 'Successfully refactored legacy codebase to use modern async/await';
  const episodeEmb = await generateEmbedding(episodeSummary);
  const episodeEmbStr = '[' + episodeEmb.join(',') + ']';
  const episodeId = ids.episode();

  await pool.query(
    `INSERT INTO episodes (id, situation, action, outcome, type, summary, success, valence, importance, lessons_learned, embedding, timestamp, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())`,
    [
      episodeId,
      JSON.stringify({ context: 'Legacy codebase with callback hell' }),
      JSON.stringify({ steps: ['Identified async operations', 'Converted to promises', 'Used async/await'] }),
      JSON.stringify({ result: 'Clean, readable code', improvement: 'Maintainability 3x better' }),
      'refactoring',
      episodeSummary,
      true,
      'positive',
      0.8,
      JSON.stringify(['Start with leaf functions', 'Test each conversion', 'Use Promise.all for parallel ops'])
    ,episodeEmbStr]
  );

  // Verify and test recall
  const recallEmb = await generateEmbedding('modernizing old JavaScript code');
  const recallEmbStr = '[' + recallEmb.join(',') + ']';

  const recalled = await pool.query(
    `SELECT type, summary, 1 - (embedding <=> $1::vector) as sim FROM episodes ORDER BY embedding <=> $1::vector LIMIT 1`,
    [recallEmbStr]
  );

  test('Episode recalled', recalled.rows.length > 0, true);
  if (recalled.rows.length > 0) {
    test('Recalled correct episode type', recalled.rows[0].type, 'refactoring');
  }

  // ========================================
  // FINAL SUMMARY
  // ========================================
  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log(`║  RESULTS: ${passed} passed, ${failed} failed                              ║`);
  console.log('╚═══════════════════════════════════════════════════════════╝');

  if (failed === 0) {
    console.log('\n🎉 ALL TESTS PASSED - SUBSTRATE v1 is production ready!\n');
  } else {
    console.log('\n⚠️  Some tests failed - review before deployment\n');
  }

  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

testSuite().catch(e => {
  console.error('\n💥 Test suite crashed:', e.message);
  process.exit(1);
});
