#!/usr/bin/env node
require('dotenv').config();

(async () => {
  const { initializePool, query } = await import('./packages/database/dist/index.js');
  const { initializeAI, generateEmbedding } = await import('./packages/ai/dist/index.js');

  initializePool({ connectionString: process.env.DATABASE_URL });
  initializeAI({ openaiApiKey: process.env.OPENAI_API_KEY });

  const testInput = 'What is the square of 5?';
  console.log('Generating embedding for:', testInput);

  const embedding = await generateEmbedding(testInput);
  const embStr = '[' + embedding.join(',') + ']';

  console.log('Embedding length:', embedding.length);

  const results = await query(
    `SELECT id, name, lifecycle, 1 - (embedding <=> $1::vector) as similarity
     FROM procedural_shards
     WHERE embedding IS NOT NULL
     ORDER BY embedding <=> $1::vector
     LIMIT 5`,
    [embStr]
  );

  console.log('\nSimilarity results:');
  results.forEach(r => {
    console.log(`  ${r.name}: ${(r.similarity * 100).toFixed(1)}% (${r.lifecycle})`);
  });

  console.log('\nThreshold check (>= 0.7):');
  results.filter(r => r.similarity >= 0.7).forEach(r => {
    console.log(`  PASS: ${r.name} @ ${(r.similarity * 100).toFixed(1)}%`);
  });

  if (results.filter(r => r.similarity >= 0.7).length === 0) {
    console.log('  No shards pass the 0.7 threshold');
  }

  process.exit(0);
})();
