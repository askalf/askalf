// Test all brain-like cognitive shards
module.paths.unshift('/app/node_modules');

const { Pool } = require('pg');
const vm = require('vm');

const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://substrate:caff003669dce684448cb89002333263a8684242f43db4e2@pgbouncer:5432/substrate' });

// Test cases for each brain shard
const brainTests = {
  'prediction-error-processor': [
    '{"expected": "42", "actual": "undefined", "shard": "factorial-calculator"}',
    '{"expected": "true", "actual": "false", "shard": "prime-checker", "error_type": "logic_error"}'
  ],
  'associative-memory-linker': [
    '{"shard_a": "celsius-to-fahrenheit", "shard_b": "fahrenheit-to-celsius", "context": "temperature conversion"}',
    '{"shard_a": "calculate-sum", "shard_b": "calculate-average", "context": "aggregate math"}'
  ],
  'salience-attention-scorer': [
    '{"pattern": "repeated user failure", "frequency": 15, "recency_hours": 2, "user_explicit": true}',
    '{"pattern": "rare edge case", "frequency": 1, "recency_hours": 168, "user_explicit": false}'
  ],
  'memory-consolidation-processor': [
    '{"shards_to_consolidate": ["add", "subtract", "multiply"], "usage_patterns": "frequent_together"}',
    '{"phase": "daily", "candidates": ["old-shard-1", "old-shard-2"]}'
  ],
  'dream-generator': [
    '{"name": "factorial-calculator", "category": "math"}',
    '{"name": "email-validator", "category": "validation"}',
    '{"name": "detect-underconfidence", "category": "cognitive"}'
  ],
  'capability-gap-detector': [
    'I need to translate this text from English to Spanish',
    'Can you analyze the sentiment of this customer review?',
    'Calculate the matrix multiplication of these two matrices',
    'What is 15 plus 27?'  // Should find no gap
  ],
  'neurogenesis-shard-creator': [
    '{"capability": "sentiment analysis", "category": "nlp"}',
    '{"capability": "matrix multiplication", "category": "math"}',
    '{"detected_need": "time zone conversion", "category": "time"}'
  ],
  'forgetting-curve-manager': [
    '{"last_used_days": 1, "execution_count": 500, "success_rate": 0.95, "category": "math"}',
    '{"last_used_days": 60, "execution_count": 5, "success_rate": 0.6, "category": "validation"}',
    '{"last_used_days": 30, "execution_count": 50, "success_rate": 0.8, "category": "brain"}'
  ],
  'learning-rate-adjuster': [
    '{"recent_errors": 8, "recent_successes": 2, "novelty": 0.9, "confidence": 0.3}',
    '{"recent_errors": 1, "recent_successes": 50, "novelty": 0.2, "confidence": 0.9}',
    '{"recent_errors": 5, "recent_successes": 5, "novelty": 0.5, "confidence": 0.5}'
  ],
  'cognitive-load-balancer': [
    '{"current_load": 3, "max_capacity": 7, "pending_tasks": [{"name": "urgent-fix", "urgent": true, "complexity": 0.8}, {"name": "routine-task", "urgent": false, "complexity": 0.3}]}',
    '{"current_load": 6, "max_capacity": 7, "pending_tasks": [{"name": "complex-analysis", "complexity": 0.9}]}'
  ],
  'attention-focus-controller': [
    '{"signals": ["error in production system", "user asked a question", "routine log message"], "goal": "handle_errors"}',
    '{"signals": ["new feature request", "unknown pattern detected", "system running normally"], "goal": "learn_new_patterns"}'
  ],
  'metacognitive-monitor': [
    '{"steps": ["parse input", "validate", "compute", "format output"], "outcome": "success", "duration_ms": 50}',
    '{"steps": ["parse", "skip validation", "compute", "error"], "outcome": "failure", "duration_ms": 100}'
  ]
};

function exec(logic, input) {
  try {
    const sb = {
      input,
      result: undefined,
      JSON, Object, Array, String, Number, Boolean, Math,
      parseInt, parseFloat, RegExp, Date,
      console: { log: () => {} }
    };
    vm.runInContext(logic + '\nif(typeof execute==="function"){result=execute(input);}', vm.createContext(sb), { timeout: 5000 });
    return { success: sb.result !== undefined, output: sb.result };
  } catch(e) {
    return { success: false, error: e.message };
  }
}

async function main() {
  console.log('='.repeat(70));
  console.log('BRAIN ARCHITECTURE TEST SUITE');
  console.log('='.repeat(70));
  console.log('\nTesting all 12 brain-like cognitive shards...\n');

  let totalPassed = 0;
  let totalFailed = 0;

  for (const [shardName, testInputs] of Object.entries(brainTests)) {
    console.log(`\n${'─'.repeat(70)}`);
    console.log(`Testing: ${shardName}`);
    console.log('─'.repeat(70));

    const { rows } = await pool.query('SELECT id, logic FROM procedural_shards WHERE name = $1 LIMIT 1', [shardName]);

    if (rows.length === 0) {
      console.log('  ⚠ Shard not found!');
      totalFailed += testInputs.length;
      continue;
    }

    const shard = rows[0];
    let passed = 0;
    let failed = 0;

    for (const input of testInputs) {
      const result = exec(shard.logic, input);
      const inputPreview = (typeof input === 'string' ? input : JSON.stringify(input)).substring(0, 60);

      if (result.success) {
        passed++;
        totalPassed++;

        try {
          const output = typeof result.output === 'string' ? JSON.parse(result.output) : result.output;
          console.log(`\n  ✓ Input: "${inputPreview}..."`);

          // Show key fields from output
          const keys = Object.keys(output).slice(0, 4);
          for (const key of keys) {
            const val = typeof output[key] === 'object' ? JSON.stringify(output[key]).substring(0, 50) : output[key];
            console.log(`    ${key}: ${val}`);
          }
        } catch {
          console.log(`\n  ✓ Input: "${inputPreview}..."`);
          console.log(`    Output: ${String(result.output).substring(0, 100)}`);
        }
      } else {
        failed++;
        totalFailed++;
        console.log(`\n  ✗ Input: "${inputPreview}..."`);
        console.log(`    Error: ${result.error}`);
      }
    }

    console.log(`\n  Result: ${passed}/${testInputs.length} passed`);
  }

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('BRAIN ARCHITECTURE SUMMARY');
  console.log('='.repeat(70));
  console.log(`Total Tests: ${totalPassed + totalFailed}`);
  console.log(`Passed: ${totalPassed}`);
  console.log(`Failed: ${totalFailed}`);
  console.log(`Success Rate: ${((totalPassed / (totalPassed + totalFailed)) * 100).toFixed(1)}%`);

  // Show brain capabilities
  console.log('\n' + '─'.repeat(70));
  console.log('BRAIN CAPABILITIES MATRIX');
  console.log('─'.repeat(70));

  const capabilities = [
    ['prediction-error-processor', 'Learn from mistakes', 'Synaptic plasticity'],
    ['associative-memory-linker', 'Connect related concepts', 'Hebbian learning'],
    ['salience-attention-scorer', 'Prioritize important signals', 'Dopamine system'],
    ['memory-consolidation-processor', 'Deep processing cycles', 'Sleep/REM'],
    ['dream-generator', 'Synthetic stress testing', 'Dream generation'],
    ['capability-gap-detector', 'Know what you dont know', 'Metacognition'],
    ['neurogenesis-shard-creator', 'Grow new capabilities', 'Neurogenesis'],
    ['forgetting-curve-manager', 'Strategic forgetting', 'Ebbinghaus curve'],
    ['learning-rate-adjuster', 'Adaptive learning speed', 'Neural plasticity'],
    ['cognitive-load-balancer', 'Working memory limits', 'Prefrontal cortex'],
    ['attention-focus-controller', 'Selective attention', 'Thalamus/attention'],
    ['metacognitive-monitor', 'Think about thinking', 'Executive function']
  ];

  for (const [shard, capability, brainAnalog] of capabilities) {
    console.log(`  ${shard.padEnd(30)} → ${capability.padEnd(25)} [${brainAnalog}]`);
  }

  if (totalFailed === 0) {
    console.log('\n✓ BRAIN ARCHITECTURE FULLY OPERATIONAL');
  } else {
    console.log('\n⚠ Some brain functions need attention');
  }

  await pool.end();
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
