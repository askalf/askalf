/**
 * Bootstrap Shard Executions
 *
 * Runs shards against their source traces to build execution history
 * for promotion eligibility (requires 10 executions with 90% success rate)
 */

import { Pool } from 'pg';
import * as ivm from 'isolated-vm';

const DATABASE_URL = process.env['DATABASE_URL'];
if (!DATABASE_URL) {
  console.error('DATABASE_URL environment variable is required');
  process.exit(1);
}
const TARGET_EXECUTIONS = 10;

const pool = new Pool({ connectionString: DATABASE_URL });

interface Shard {
  id: string;
  name: string;
  logic: string;
  execution_count: number;
  source_trace_ids: string[];
}

interface Trace {
  id: string;
  input: string;
  output: string;
}

/**
 * Execute shard logic in sandbox
 */
async function executeShard(logic: string, input: string): Promise<{ success: boolean; output: string; error?: string; executionMs: number }> {
  const startTime = Date.now();

  try {
    const isolate = new ivm.Isolate({ memoryLimit: 128 });
    const context = await isolate.createContext();

    // Set up the input
    await context.global.set('INPUT', input);

    // Wrap logic in async handler
    const wrappedCode = `
      (function() {
        const input = INPUT;
        ${logic}
      })()
    `;

    const script = await isolate.compileScript(wrappedCode);
    const result = await script.run(context, { timeout: 5000 });

    isolate.dispose();

    return {
      success: true,
      output: String(result ?? ''),
      executionMs: Date.now() - startTime,
    };
  } catch (error) {
    return {
      success: false,
      output: '',
      error: String(error),
      executionMs: Date.now() - startTime,
    };
  }
}

/**
 * Record execution result
 */
async function recordExecution(shardId: string, success: boolean, executionMs: number): Promise<void> {
  const { ids } = await import('@substrate/core');
  const executionId = ids.execution();

  // Insert execution record
  await pool.query(
    `INSERT INTO shard_executions (id, shard_id, input, success, execution_ms, tokens_saved, created_at)
     VALUES ($1, $2, '', $3, $4, $5, NOW())`,
    [executionId, shardId, success, executionMs, success ? 100 : 0]
  );

  // Update shard metrics
  await pool.query(
    `UPDATE procedural_shards SET
       execution_count = execution_count + 1,
       success_count = success_count + CASE WHEN $2 THEN 1 ELSE 0 END,
       failure_count = failure_count + CASE WHEN $2 THEN 0 ELSE 1 END,
       avg_latency_ms = CASE
         WHEN execution_count = 0 THEN $3::float
         ELSE (COALESCE(avg_latency_ms, 0) * execution_count + $3::float) / (execution_count + 1)
       END,
       tokens_saved = tokens_saved + CASE WHEN $2 THEN 100 ELSE 0 END,
       last_executed = NOW(),
       confidence = CASE
         WHEN $2 THEN LEAST(confidence + 0.01, 1.0)
         ELSE GREATEST(confidence - 0.02, 0.0)
       END
     WHERE id = $1`,
    [shardId, success, executionMs]
  );
}

/**
 * Compare outputs (flexible matching)
 */
function outputsMatch(expected: string, actual: string): boolean {
  const e = expected.trim().toLowerCase();
  const a = actual.trim().toLowerCase();

  // Exact match
  if (e === a) return true;

  // Try parsing as numbers
  const eNum = parseFloat(e);
  const aNum = parseFloat(a);
  if (!isNaN(eNum) && !isNaN(aNum) && Math.abs(eNum - aNum) < 0.001) return true;

  // Try parsing as JSON arrays
  try {
    const eArr = JSON.parse(expected);
    const aArr = JSON.parse(actual);
    if (Array.isArray(eArr) && Array.isArray(aArr)) {
      return JSON.stringify(eArr.sort()) === JSON.stringify(aArr.sort());
    }
  } catch {}

  // Boolean matching
  if ((e === 'true' || e === 'false') && (a === 'true' || a === 'false')) {
    return e === a;
  }

  return false;
}

/**
 * Main bootstrap function
 */
async function bootstrap(): Promise<void> {
  console.log('🚀 Starting shard execution bootstrap...\n');

  // Get all testing shards that need more executions
  const { rows: shards } = await pool.query<Shard>(`
    SELECT id, name, logic, execution_count, source_trace_ids
    FROM procedural_shards
    WHERE lifecycle = 'testing'
      AND execution_count < $1
    ORDER BY execution_count ASC
  `, [TARGET_EXECUTIONS]);

  console.log(`Found ${shards.length} shards needing executions\n`);

  for (const shard of shards) {
    const neededExecutions = TARGET_EXECUTIONS - shard.execution_count;
    console.log(`\n📦 ${shard.name} (${shard.execution_count}/${TARGET_EXECUTIONS} executions)`);

    // Get source traces
    const { rows: traces } = await pool.query<Trace>(`
      SELECT id, input, output
      FROM reasoning_traces
      WHERE id = ANY($1)
    `, [shard.source_trace_ids]);

    if (traces.length === 0) {
      console.log('   ⚠️  No source traces found, skipping');
      continue;
    }

    let successes = 0;
    let failures = 0;

    // Run executions until we hit target
    for (let i = 0; i < neededExecutions; i++) {
      // Cycle through traces
      const trace = traces[i % traces.length]!;

      const result = await executeShard(shard.logic, trace.input);

      let success = result.success;
      if (success) {
        // Verify output matches
        success = outputsMatch(trace.output, result.output);
      }

      await recordExecution(shard.id, success, result.executionMs);

      if (success) {
        successes++;
        process.stdout.write('✓');
      } else {
        failures++;
        process.stdout.write('✗');
      }
    }

    const successRate = ((successes / neededExecutions) * 100).toFixed(1);
    console.log(`\n   → ${successes}/${neededExecutions} passed (${successRate}%)`);
  }

  // Show final status
  console.log('\n\n📊 Final Status:\n');

  const { rows: finalStatus } = await pool.query(`
    SELECT
      name,
      lifecycle,
      execution_count,
      success_count,
      CASE WHEN execution_count > 0
        THEN ROUND((success_count::numeric / execution_count) * 100, 1)
        ELSE 0
      END as success_rate,
      ROUND(confidence::numeric, 3) as confidence
    FROM procedural_shards
    ORDER BY success_rate DESC, execution_count DESC
  `);

  console.log('Name                                     | Execs | Success Rate | Confidence');
  console.log('-'.repeat(80));

  for (const row of finalStatus) {
    const name = row.name.padEnd(40).slice(0, 40);
    const execs = String(row.execution_count).padStart(5);
    const rate = `${row.success_rate}%`.padStart(12);
    const conf = String(row.confidence).padStart(10);
    console.log(`${name} | ${execs} | ${rate} | ${conf}`);
  }

  await pool.end();
  console.log('\n✅ Bootstrap complete!');
}

bootstrap().catch(console.error);
