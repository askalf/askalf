/**
 * Execute testing shards to trigger promotion
 * Run inside API container: node execute-testing-shards.js
 */

const testCases = {
  'shd_01KFGWAGC8FEH73DPBDRJ2E8D6': [ // addition-calculator
    'What is 15 + 27?',
    'What is 100 + 200?',
    'What is 5 + 10?',
    'What is 999 + 1?',
    'What is 50 + 50?',
    'What is 123 + 456?',
    'What is 7 + 8?',
    'What is 1000 + 2000?',
    'What is 33 + 67?',
    'What is 42 + 58?',
    'What is 111 + 222?',
    'What is 88 + 12?',
  ],
  'shd_01KFGWAC9W70M6TQR67F396WFE': [ // subtraction-calculator
    'What is 100 - 37?',
    'What is 500 - 123?',
    'What is 1000 - 1?',
    'What is 75 - 25?',
    'What is 200 - 50?',
    'What is 88 - 11?',
    'What is 999 - 100?',
    'What is 50 - 25?',
    'What is 300 - 150?',
    'What is 1000 - 500?',
    'What is 42 - 12?',
    'What is 100 - 100?',
  ],
  'shd_01KFGWA89YVE0MMJRY952ZD7B8': [ // multiply-two-numbers
    'What is 12 * 12?',
    'What is 25 * 4?',
    'What is 7 * 8?',
    'What is 100 * 10?',
    'What is 9 * 9?',
    'What is 15 * 3?',
    'What is 6 * 7?',
    'What is 11 * 11?',
    'What is 20 * 5?',
    'What is 8 * 8?',
    'What is 13 * 7?',
    'What is 50 * 2?',
  ],
  'shd_01KFGWA1YAS6R9V8SP0WB5TKBZ': [ // division-calculator
    'What is 144 / 12?',
    'What is 100 / 4?',
    'What is 1000 / 8?',
    'What is 81 / 9?',
    'What is 200 / 5?',
    'What is 90 / 3?',
    'What is 50 / 2?',
    'What is 64 / 8?',
    'What is 121 / 11?',
    'What is 400 / 20?',
    'What is 72 / 6?',
    'What is 36 / 4?',
  ],
  'shd_01KFGW9SM3GR1E9FK9DYYB6B18': [ // celsius-to-fahrenheit
    'Convert 0 celsius to fahrenheit',
    'Convert 100 celsius to fahrenheit',
    'Convert 25 celsius to fahrenheit',
    'Convert 37 celsius to fahrenheit',
    'Convert -40 celsius to fahrenheit',
    'Convert 20 celsius to fahrenheit',
    'Convert 30 celsius to fahrenheit',
    'Convert 15 celsius to fahrenheit',
    'Convert 50 celsius to fahrenheit',
    'Convert 10 celsius to fahrenheit',
    'Convert 5 celsius to fahrenheit',
    'Convert 35 celsius to fahrenheit',
  ],
  'shd_01KFGW9HX76YH7G22EGGNBBADT': [ // km-to-miles
    'Convert 100 km to miles',
    'Convert 50 km to miles',
    'Convert 10 km to miles',
    'Convert 1 km to miles',
    'Convert 200 km to miles',
    'Convert 42 km to miles',
    'Convert 5 km to miles',
    'Convert 80 km to miles',
    'Convert 150 km to miles',
    'Convert 25 km to miles',
    'Convert 75 km to miles',
    'Convert 30 km to miles',
  ],
  'shd_01KFGW9DJ3KW2NRXG8ND333903': [ // uppercase
    'Convert "hello" to uppercase',
    'Convert "world" to uppercase',
    'Convert "testing" to uppercase',
    'Convert "substrate" to uppercase',
    'Convert "data" to uppercase',
    'Convert "example" to uppercase',
    'Convert "code" to uppercase',
    'Convert "memory" to uppercase',
    'Convert "shard" to uppercase',
    'Convert "crystal" to uppercase',
    'Convert "compute" to uppercase',
    'Convert "engine" to uppercase',
  ],
  'shd_01KFGW98A26JT9J7T4E4420SE0': [ // percentage
    'What is 10% of 100?',
    'What is 25% of 200?',
    'What is 50% of 80?',
    'What is 15% of 300?',
    'What is 20% of 50?',
    'What is 75% of 120?',
    'What is 5% of 1000?',
    'What is 30% of 150?',
    'What is 40% of 250?',
    'What is 60% of 500?',
    'What is 90% of 100?',
    'What is 33% of 99?',
  ],
  'shd_01KFGW8ZB63AGF5K6B0YVXXGJG': [ // reverse string
    'Reverse "hello"',
    'Reverse "world"',
    'Reverse "testing"',
    'Reverse "algorithm"',
    'Reverse "data"',
    'Reverse "substrate"',
    'Reverse "memory"',
    'Reverse "shard"',
    'Reverse "code"',
    'Reverse "crystal"',
    'Reverse "engine"',
    'Reverse "compute"',
  ],
  'shd_01KFGW8TD3VM011JRNBEB4STAK': [ // binary-to-decimal
    'Convert binary 1010 to decimal',
    'Convert binary 1111 to decimal',
    'Convert binary 10000 to decimal',
    'Convert binary 11001 to decimal',
    'Convert binary 101010 to decimal',
    'Convert binary 1100100 to decimal',
    'Convert binary 1000 to decimal',
    'Convert binary 10101 to decimal',
    'Convert binary 11111 to decimal',
    'Convert binary 100000 to decimal',
    'Convert binary 10010 to decimal',
    'Convert binary 11010 to decimal',
  ],
};

async function main() {
  const { initializePool, query } = require('@substrate/database');
  const { procedural } = require('@substrate/memory');
  const { execute } = require('@substrate/sandbox');

  await initializePool();

  let totalExecutions = 0;
  let successfulExecutions = 0;

  for (const [shardId, inputs] of Object.entries(testCases)) {
    console.log(`\nExecuting shard ${shardId}...`);

    // Get shard
    const shard = await procedural.getShardById(shardId);
    if (!shard) {
      console.log(`  Shard not found: ${shardId}`);
      continue;
    }

    console.log(`  Name: ${shard.name}`);

    for (const input of inputs) {
      const startTime = Date.now();
      try {
        const result = await execute(shard.logic, input);
        const executionMs = Date.now() - startTime;

        totalExecutions++;

        if (result.success) {
          successfulExecutions++;
          // Record successful execution
          await procedural.recordExecution(shardId, true, executionMs, 100);
          console.log(`  ✓ "${input.substring(0, 30)}..." => ${result.output} (${executionMs}ms)`);
        } else {
          // Record failed execution
          await procedural.recordExecution(shardId, false, executionMs, 0);
          console.log(`  ✗ "${input.substring(0, 30)}..." => ERROR: ${result.error}`);
        }
      } catch (err) {
        totalExecutions++;
        await procedural.recordExecution(shardId, false, Date.now() - startTime, 0);
        console.log(`  ✗ "${input.substring(0, 30)}..." => EXCEPTION: ${err.message}`);
      }
    }
  }

  console.log(`\n========================================`);
  console.log(`Total executions: ${totalExecutions}`);
  console.log(`Successful: ${successfulExecutions}`);
  console.log(`Success rate: ${((successfulExecutions / totalExecutions) * 100).toFixed(1)}%`);
  console.log(`========================================\n`);

  // Check promotion readiness
  const shards = await query(`
    SELECT name, confidence, execution_count, success_count,
           (success_count::float / NULLIF(execution_count, 0)) as success_rate
    FROM procedural_shards
    WHERE lifecycle = 'testing'
      AND created_at::date = CURRENT_DATE
    ORDER BY confidence DESC
  `);

  console.log('Shard Status After Execution:');
  console.log('--------------------------------------------------');
  for (const s of shards) {
    const rate = s.success_rate ? (s.success_rate * 100).toFixed(0) : 0;
    const ready = s.confidence >= 0.85 && s.execution_count >= 10 && s.success_rate >= 0.9;
    console.log(`${s.name}: conf=${s.confidence.toFixed(2)} exec=${s.execution_count} success=${s.success_count} rate=${rate}% ${ready ? '✓ READY' : ''}`);
  }

  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
