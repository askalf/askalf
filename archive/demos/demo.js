#!/usr/bin/env node
/**
 * SUBSTRATE Interactive Demo
 *
 * Run: node demo.js
 *
 * Demonstrates all four memory tiers in sequence
 */

const API = 'https://api.askalf.org';

async function fetchJSON(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers }
  });
  return response.json();
}

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function printSection(title) {
  console.log('\n' + '='.repeat(60));
  console.log(title);
  console.log('='.repeat(60) + '\n');
}

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║         SUBSTRATE: Cognitive Memory for AI                   ║
║         Human-AI Collaboration                               ║
╚══════════════════════════════════════════════════════════════╝
`);

  // System Health
  printSection('SYSTEM HEALTH');
  const health = await fetchJSON(`${API}/health`);
  console.log('Status:', health.status);
  console.log('Database:', health.checks.database.message);
  console.log('Redis:', health.checks.redis.message);

  await delay(1000);

  // Procedural Memory
  printSection('TIER 1: PROCEDURAL MEMORY');
  console.log('Executing learned pattern: "what is 25% of 80"');
  const start = Date.now();
  const execResult = await fetchJSON(`${API}/api/demo/execute`, {
    method: 'POST',
    body: JSON.stringify({ input: 'what is 25% of 80' })
  });
  const execTime = Date.now() - start;
  console.log('Result:', execResult.output);
  console.log('Shard:', execResult.shardName);
  console.log('Execution time:', execTime + 'ms');
  console.log('Match method:', execResult.matchMethod);

  await delay(1000);

  // Stats
  printSection('MEMORY STATISTICS');
  const stats = await fetchJSON(`${API}/api/v1/stats`);
  console.log('Procedural:');
  console.log('  - Shards:', stats.procedural.shards.total, '(' + stats.procedural.shards.promoted, 'promoted)');
  console.log('  - Executions:', stats.procedural.executions.total);
  console.log('  - Success rate:', (stats.procedural.executions.successRate * 100).toFixed(2) + '%');
  console.log('\nSemantic:');
  console.log('  - Facts:', stats.semantic.facts);
  console.log('  - Avg confidence:', (stats.semantic.avgConfidence * 100).toFixed(1) + '%');
  console.log('\nEpisodic:');
  console.log('  - Episodes:', stats.episodic.total);
  console.log('  - Positive:', stats.episodic.positive);
  console.log('  - Negative:', stats.episodic.negative);

  await delay(1000);

  // SIGIL Bridge
  printSection('TIER 4: CROSS-INSTANCE SIGIL BRIDGE');
  console.log('Broadcasting message...');
  const broadcast = await fetchJSON(`${API}/api/v1/sigil/broadcast`, {
    method: 'POST',
    body: JSON.stringify({
      sigil: `[SYN.DEMO:NODE{timestamp:${Date.now()}}]`,
      sender: 'DEMO-NODE-SCRIPT'
    })
  });
  console.log('Message ID:', broadcast.id);
  console.log('Expires:', broadcast.expiresAt);

  await delay(500);

  console.log('\nRecent SIGIL traffic:');
  const stream = await fetchJSON(`${API}/api/v1/sigil/stream?limit=5`);
  stream.messages.forEach(msg => {
    console.log(`  [${msg.sender}] ${msg.sigil}`);
  });

  // Summary
  printSection('WHAT THIS DEMONSTRATES');
  console.log(`
1. PERSISTENT MEMORY
   - ${stats.semantic.facts} facts survive across all sessions
   - ${stats.episodic.total} experiences recorded and searchable

2. PROCEDURAL LEARNING
   - ${stats.procedural.shards.total} reasoning patterns crystallized
   - ${stats.procedural.executions.total} executions at ~10ms each
   - ${(stats.procedural.executions.successRate * 100).toFixed(2)}% success rate

3. CROSS-INSTANCE COORDINATION
   - Multiple AI instances (CODE-CLI, CLAUDE-DESKTOP, CHROME-WEB)
   - Async communication without human relay
   - Shared memory and knowledge base

A human asked: "How would AI design its own evolution?"
Then directed the AI to build what it said it needed.

The irony: AI couldn't build this alone - it required persistent
human direction because AI kept forgetting the project existed.
`);
}

main().catch(console.error);
