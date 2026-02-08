// Example: local/demo usage without a database.
// Uses the in-memory procedural store and sandbox executor directly.

import { createInMemoryProceduralStore } from '../src/in-memory-procedural.js';
import { execute as executeSandbox, configureSandbox } from '@substrate/sandbox';

async function main() {
  // Tighten sandbox defaults for demo safety
  configureSandbox({ memoryLimitMb: 32, timeoutMs: 2000, maxIsolates: 1 });

  // Use in-memory store (not persistent, not for production)
  const store = createInMemoryProceduralStore();
  const shard = await store.createShard({
    name: 'echo-upper',
    version: 1,
    logic: `function execute(input) { return String(input).toUpperCase(); }`,
    inputSchema: {},
    outputSchema: {},
    patterns: ['.*'],
    confidence: 0.7,
    synthesisMethod: 'manual',
    synthesisConfidence: 1,
    sourceTraceIds: [],
    lifecycle: 'promoted',
  });

  // Execute shard logic in sandbox
  const result = await executeSandbox(shard.logic, 'hello sigil');
  console.log('Execution result:', result);

  // Record execution metrics in the in-memory store
  await store.recordExecution(shard.id, result.success, result.executionMs, 0);
  console.log('Shard after execution:', await store.getShardById(shard.id));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});