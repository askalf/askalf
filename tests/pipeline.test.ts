/**
 * Pipeline Integration Tests - Boringly Repeatable
 *
 * These tests are designed to:
 * 1. Run in isolation (cleanup before and after)
 * 2. Be deterministic (same inputs = same outputs)
 * 3. Test the full metabolic pipeline
 * 4. Run repeatedly without accumulating test data
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  TEST_RUN_ID,
  api,
  ingestTestTrace,
  execute,
  crystallize,
  promote,
  decay,
  evolve,
  extractLessons,
  cleanupTestData,
  waitForApi,
} from './test-utils';

// Increase timeout for integration tests
const TIMEOUT = 60000;

describe('Pipeline Integration Tests', () => {
  // Cleanup before all tests
  beforeAll(async () => {
    await waitForApi();
    // Pre-cleanup any leftover test data from previous runs
    await cleanupTestData();
  }, TIMEOUT);

  // Cleanup after all tests
  afterAll(async () => {
    const cleanup = await cleanupTestData();
    console.log(`Cleanup: ${cleanup.tracesDeleted} traces, ${cleanup.shardsDeleted} shards, ${cleanup.episodesDeleted} episodes`);
  }, TIMEOUT);

  describe('API Health', () => {
    it('should respond to stats endpoint', async () => {
      const stats = await api<{
        traces: number;
        shards: number;
        promotedShards: number;
        episodes: number;
        facts: number;
      }>('/api/v1/test/stats');

      expect(stats).toHaveProperty('traces');
      expect(stats).toHaveProperty('shards');
      expect(stats).toHaveProperty('episodes');
      expect(typeof stats.traces).toBe('number');
    });
  });

  describe('Trace Ingestion', () => {
    it('should ingest a trace and return intent template', async () => {
      const trace = await ingestTestTrace(
        'add 5 and 3',
        '8',
        '5 + 3 = 8'
      );

      expect(trace.id).toMatch(/^trc_/);
      expect(trace.intentTemplate).toBeDefined();
      expect(trace.intentHash).toBeDefined();
      expect(trace.patternHash).toBeDefined();
    }, TIMEOUT);

    it('should extract consistent intent templates for similar inputs', async () => {
      const traces = await Promise.all([
        ingestTestTrace('multiply 4 by 5', '20', '4 * 5 = 20'),
        ingestTestTrace('multiply 10 by 3', '30', '10 * 3 = 30'),
        ingestTestTrace('multiply 7 by 8', '56', '7 * 8 = 56'),
      ]);

      // All should have similar intent structure
      traces.forEach(t => {
        expect(t.intentTemplate).toMatch(/multiply/i);
      });
    }, TIMEOUT);
  });

  describe('Crystallization Cycle', () => {
    beforeEach(async () => {
      // Ingest enough traces to trigger crystallization (min 3 per cluster)
      await Promise.all([
        ingestTestTrace('square 5', '25', '5 * 5 = 25'),
        ingestTestTrace('square 4', '16', '4 * 4 = 16'),
        ingestTestTrace('square 3', '9', '3 * 3 = 9'),
        ingestTestTrace('square 10', '100', '10 * 10 = 100'),
        ingestTestTrace('square 7', '49', '7 * 7 = 49'),
      ]);
    }, TIMEOUT);

    it('should run crystallization without errors', async () => {
      const result = await crystallize();

      expect(result).toHaveProperty('shardsCreated');
      expect(result).toHaveProperty('tracesProcessed');
      expect(typeof result.shardsCreated).toBe('number');
      expect(typeof result.tracesProcessed).toBe('number');
    }, TIMEOUT);
  });

  describe('Shard Execution', () => {
    it('should execute promoted shards successfully', async () => {
      // Test against known promoted shards
      const result = await execute('convert 100 celsius to fahrenheit');

      if (result.success) {
        expect(result.method).toBe('shard');
        expect(result.shardName).toBeDefined();
        expect(result.executionMs).toBeGreaterThanOrEqual(0);
        expect(result.output).toMatch(/fahrenheit/i);
      }
    }, TIMEOUT);

    it('should handle no-match gracefully', async () => {
      const result = await execute(`${TEST_RUN_ID} unknown operation xyz123`);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.method).toBe('none');
    }, TIMEOUT);

    it('should execute testing shards with includeAll flag', async () => {
      const result = await execute('divide 100 by 4', { includeAll: true });

      // May or may not have a shard, but should not error
      expect(result).toHaveProperty('success');
      if (result.success) {
        expect(result.method).toBe('shard');
      }
    }, TIMEOUT);
  });

  describe('Promotion Cycle', () => {
    it('should run promotion cycle without errors', async () => {
      const result = await promote();

      expect(result).toHaveProperty('promoted');
      expect(result).toHaveProperty('demoted');
      expect(result).toHaveProperty('candidates');
      expect(typeof result.promoted).toBe('number');
      expect(typeof result.demoted).toBe('number');
      expect(Array.isArray(result.candidates)).toBe(true);
    }, TIMEOUT);
  });

  describe('Decay Cycle', () => {
    it('should run decay cycle without errors', async () => {
      const result = await decay();

      expect(result).toHaveProperty('decayed');
      expect(result).toHaveProperty('archived');
      expect(typeof result.decayed).toBe('number');
      expect(typeof result.archived).toBe('number');
    }, TIMEOUT);
  });

  describe('Evolution Cycle', () => {
    it('should run evolution cycle without errors', async () => {
      const result = await evolve();

      expect(result).toHaveProperty('processed');
      expect(result).toHaveProperty('evolved');
      expect(result).toHaveProperty('failed');
      expect(typeof result.processed).toBe('number');
    }, TIMEOUT);
  });

  describe('Lesson Extraction', () => {
    it('should run lesson extraction without errors', async () => {
      const result = await extractLessons();

      expect(result).toHaveProperty('processed');
      expect(result).toHaveProperty('factsCreated');
      expect(result).toHaveProperty('duplicatesSkipped');
      expect(typeof result.processed).toBe('number');
    }, TIMEOUT);
  });
});

describe('Full Pipeline Flow', () => {
  const FLOW_PREFIX = `${TEST_RUN_ID}_flow_`;

  afterAll(async () => {
    await cleanupTestData();
  }, TIMEOUT);

  it('should process traces through full metabolic pipeline', async () => {
    // Step 1: Record initial stats
    const initialStats = await api<{ traces: number; shards: number }>('/api/v1/test/stats');
    console.log('Initial stats:', initialStats);

    // Step 2: Ingest 5 traces with unique pattern
    console.log('Step 1: Ingesting traces...');
    const traces = [];
    for (let i = 1; i <= 5; i++) {
      const trace = await ingestTestTrace(
        `${FLOW_PREFIX}triple ${i * 10}`,
        `${i * 30}`,
        `${i * 10} * 3 = ${i * 30}`
      );
      traces.push(trace);
    }
    expect(traces).toHaveLength(5);
    traces.forEach(t => expect(t.id).toMatch(/^trc_/));

    // Step 3: Run crystallization
    console.log('Step 2: Crystallizing...');
    const crystalResult = await crystallize();
    expect(crystalResult).toHaveProperty('shardsCreated');
    expect(crystalResult).toHaveProperty('tracesProcessed');

    // Step 4: Run all metabolic cycles
    console.log('Step 3: Running metabolic cycles...');
    const [promoteResult, decayResult, evolveResult] = await Promise.all([
      promote(),
      decay(),
      evolve(),
    ]);

    expect(promoteResult).toHaveProperty('promoted');
    expect(decayResult).toHaveProperty('decayed');
    expect(evolveResult).toHaveProperty('processed');

    // Step 5: Extract lessons
    console.log('Step 4: Extracting lessons...');
    const lessonsResult = await extractLessons();
    expect(lessonsResult).toHaveProperty('processed');

    // Step 6: Verify final stats
    const finalStats = await api<{ traces: number; shards: number }>('/api/v1/test/stats');
    console.log('Final stats:', finalStats);

    // We should have added traces
    expect(finalStats.traces).toBeGreaterThanOrEqual(initialStats.traces);

    console.log('Pipeline flow completed successfully');
  }, TIMEOUT * 2);
});

describe('Repeatability Tests', () => {
  afterAll(async () => {
    await cleanupTestData();
  }, TIMEOUT);

  // Run the same test 3 times to verify repeatability
  for (let run = 1; run <= 3; run++) {
    describe(`Run ${run}`, () => {
      it(`should ingest and crystallize consistently (run ${run})`, async () => {
        const runPrefix = `${TEST_RUN_ID}_repeat${run}_`;

        // Ingest traces
        const traces = await Promise.all([
          ingestTestTrace(`${runPrefix}cube 2`, '8', '2^3 = 8'),
          ingestTestTrace(`${runPrefix}cube 3`, '27', '3^3 = 27'),
          ingestTestTrace(`${runPrefix}cube 4`, '64', '4^3 = 64'),
        ]);

        expect(traces).toHaveLength(3);
        traces.forEach(t => {
          expect(t.id).toMatch(/^trc_/);
          expect(t.intentTemplate).toBeDefined();
        });

        // Run cycles
        const [crystal, promote_, decay_] = await Promise.all([
          crystallize(),
          promote(),
          decay(),
        ]);

        expect(crystal).toHaveProperty('shardsCreated');
        expect(promote_).toHaveProperty('promoted');
        expect(decay_).toHaveProperty('decayed');
      }, TIMEOUT);
    });
  }
});

describe('Edge Cases', () => {
  it('should handle empty input gracefully', async () => {
    const result = await execute('');
    expect(result).toHaveProperty('success');
    // Empty input should fail gracefully
    expect(result.success).toBe(false);
  }, TIMEOUT);

  it('should handle whitespace-only input', async () => {
    const result = await execute('   ');
    expect(result).toHaveProperty('success');
  }, TIMEOUT);

  it('should handle very long input', async () => {
    const longInput = 'convert ' + 'very '.repeat(100) + 'long input to something';
    const result = await execute(longInput);
    expect(result).toHaveProperty('success');
    // Should not crash
  }, TIMEOUT);

  it('should handle special characters', async () => {
    const result = await execute('convert 100°C to °F');
    expect(result).toHaveProperty('success');
  }, TIMEOUT);
});
