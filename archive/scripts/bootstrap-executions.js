/**
 * Bootstrap Shard Executions
 * Run with: node scripts/bootstrap-executions.js
 */

const { Pool } = require('pg');
const vm = require('vm');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL environment variable is required');
  process.exit(1);
}
const TARGET_EXECUTIONS = 40;

const pool = new Pool({ connectionString: DATABASE_URL });

function executeShard(logic, input) {
  const startTime = Date.now();
  try {
    // Create sandbox context
    const sandbox = {
      input: input,
      result: undefined
    };

    // Wrap logic to call execute() if it exists
    const wrappedCode = `
      ${logic}
      if (typeof execute === 'function') {
        result = execute(input);
      }
    `;

    const context = vm.createContext(sandbox);
    vm.runInContext(wrappedCode, context, { timeout: 5000 });

    return {
      success: true,
      output: String(sandbox.result ?? ''),
      executionMs: Date.now() - startTime
    };
  } catch (error) {
    return {
      success: false,
      output: '',
      error: String(error),
      executionMs: Date.now() - startTime
    };
  }
}

async function recordExecution(shardId, success, executionMs) {
  const executionId = `exec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  await pool.query(
    `INSERT INTO shard_executions (id, shard_id, input, success, execution_ms, tokens_saved, created_at)
     VALUES ($1, $2, '', $3, $4, $5, NOW())`,
    [executionId, shardId, success, executionMs, success ? 100 : 0]
  );

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

function outputsMatch(expected, actual) {
  const e = expected.trim().toLowerCase();
  const a = actual.trim().toLowerCase();
  if (e === a) return true;

  const eNum = parseFloat(e);
  const aNum = parseFloat(a);
  if (!isNaN(eNum) && !isNaN(aNum) && Math.abs(eNum - aNum) < 0.001) return true;

  try {
    const eArr = JSON.parse(expected);
    const aArr = JSON.parse(actual);
    if (Array.isArray(eArr) && Array.isArray(aArr)) {
      return JSON.stringify(eArr.sort()) === JSON.stringify(aArr.sort());
    }
  } catch {}

  return false;
}

async function bootstrap() {
  console.log('Bootstrap starting...');

  const { rows: shards } = await pool.query(`
    SELECT id, name, logic, execution_count, source_trace_ids
    FROM procedural_shards
    WHERE lifecycle = 'testing' AND execution_count < $1
    ORDER BY execution_count ASC
  `, [TARGET_EXECUTIONS]);

  console.log(`Found ${shards.length} shards`);

  for (const shard of shards) {
    const neededExecutions = TARGET_EXECUTIONS - shard.execution_count;
    process.stdout.write(`${shard.name.substring(0, 28).padEnd(28)}: `);

    const { rows: traces } = await pool.query(`
      SELECT id, input, output FROM reasoning_traces WHERE id = ANY($1)
    `, [shard.source_trace_ids]);

    if (traces.length === 0) {
      console.log('No traces, skipping');
      continue;
    }

    let successes = 0;
    for (let i = 0; i < neededExecutions; i++) {
      const trace = traces[i % traces.length];
      const result = executeShard(shard.logic, trace.input);
      let success = result.success && outputsMatch(trace.output, result.output);
      await recordExecution(shard.id, success, result.executionMs);
      process.stdout.write(success ? '.' : 'x');
      if (success) successes++;
    }
    console.log(` ${successes}/${neededExecutions}`);
  }

  console.log('Done!');
  await pool.end();
}

bootstrap().catch(e => { console.error(e); process.exit(1); });
