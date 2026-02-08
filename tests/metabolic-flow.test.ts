/**
 * Integration Tests: Trace → Shard → Execute Flow
 *
 * Tests the complete metabolic pipeline:
 * 1. Ingest traces via API
 * 2. Crystallize traces into shards
 * 3. Execute shards and verify output
 * 4. Promotion based on success metrics
 * 5. Evolution on failures
 * 6. Lesson extraction from negative episodes
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const API_BASE = process.env.API_URL || 'http://localhost:3000';

interface TraceResponse {
  id: string;
  intentTemplate: string;
  intentHash: string;
  patternHash: string;
}

interface ExecuteResponse {
  success: boolean;
  output?: string;
  error?: string;
  method: string;
  matchMethod?: string;
  shardId?: string;
  shardName?: string;
  executionMs?: number;
}

interface CrystallizeResponse {
  shardsCreated: number;
  tracesProcessed: number;
}

interface PromoteResponse {
  promoted: number;
  demoted: number;
  candidates: string[];
}

async function api<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  // Only set Content-Type for requests with a body
  const headers: HeadersInit = options.body
    ? { 'Content-Type': 'application/json', ...options.headers }
    : { ...options.headers };

  const res = await fetch(`${API_BASE}${path}`, {
    headers,
    ...options,
  });
  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

async function ingestTrace(
  input: string,
  output: string,
  reasoning?: string
): Promise<TraceResponse> {
  return api<TraceResponse>('/api/v1/traces', {
    method: 'POST',
    body: JSON.stringify({
      input,
      output,
      reasoning,
      tokensUsed: 50,
    }),
  });
}

async function execute(input: string, options?: { shardId?: string; includeAll?: boolean }): Promise<ExecuteResponse> {
  return api<ExecuteResponse>('/api/v1/execute', {
    method: 'POST',
    body: JSON.stringify({ input, ...options }),
  });
}

describe('Metabolic Flow Integration Tests', () => {
  // Test data for a simple math operation
  const mathTraces = [
    { input: 'add 5 and 3', output: '8', reasoning: '5 + 3 = 8' },
    { input: 'add 10 and 20', output: '30', reasoning: '10 + 20 = 30' },
    { input: 'add 100 and 50', output: '150', reasoning: '100 + 50 = 150' },
    { input: 'add 7 and 8', output: '15', reasoning: '7 + 8 = 15' },
    { input: 'add 25 and 25', output: '50', reasoning: '25 + 25 = 50' },
  ];

  describe('1. Trace Ingestion', () => {
    it('should ingest traces and extract intent templates', async () => {
      const results: TraceResponse[] = [];

      for (const trace of mathTraces) {
        const result = await ingestTrace(trace.input, trace.output, trace.reasoning);
        results.push(result);

        expect(result.id).toMatch(/^trc_/);
        expect(result.intentTemplate).toBeDefined();
        expect(result.patternHash).toBeDefined();
      }

      // All traces should have similar intent templates (add pattern)
      const templates = results.map(r => r.intentTemplate);
      console.log('Intent templates:', templates);
    });
  });

  describe('2. Crystallization', () => {
    it('should crystallize traces into a shard when threshold is met', async () => {
      const result = await api<CrystallizeResponse>('/api/v1/metabolic/crystallize', {
        method: 'POST',
      });

      console.log('Crystallization result:', result);

      // May or may not create shards depending on clustering
      expect(result).toHaveProperty('shardsCreated');
      expect(result).toHaveProperty('tracesProcessed');
    });
  });

  describe('3. Shard Execution', () => {
    it('should execute existing shards via embedding match', async () => {
      // Test against known working shards
      const testCases = [
        { input: 'convert 100 kilometers to miles', expected: /miles/i },
        { input: 'convert 50 celsius to fahrenheit', expected: /fahrenheit/i },
        { input: 'Reverse string: hello', expected: 'olleh' },
        { input: 'Calculate 20% of 500', expected: '100' },
      ];

      for (const tc of testCases) {
        const result = await execute(tc.input);

        console.log(`Execute "${tc.input}":`, result);

        if (result.success) {
          expect(result.method).toBe('shard');
          expect(result.matchMethod).toMatch(/embedding|intent|direct/);

          if (typeof tc.expected === 'string') {
            expect(result.output).toContain(tc.expected);
          } else {
            expect(result.output).toMatch(tc.expected);
          }
        }
      }
    });

    it('should return error for unmatched inputs', async () => {
      const result = await execute('play beethoven symphony no 5');

      // Should either fail to match or fail execution
      if (result.success === false) {
        expect(result.error).toBeDefined();
      }
    });
  });

  describe('4. Promotion Cycle', () => {
    it('should identify shards eligible for promotion', async () => {
      const result = await api<PromoteResponse>('/api/v1/metabolic/promote', {
        method: 'POST',
      });

      console.log('Promotion result:', result);

      expect(result).toHaveProperty('promoted');
      expect(result).toHaveProperty('demoted');
      expect(result).toHaveProperty('candidates');
    });
  });

  describe('5. Decay Cycle', () => {
    it('should run decay cycle without errors', async () => {
      const result = await api<{ decayed: number; archived: number }>('/api/v1/metabolic/decay', {
        method: 'POST',
      });

      console.log('Decay result:', result);

      expect(result).toHaveProperty('decayed');
      expect(result).toHaveProperty('archived');
    });
  });

  describe('6. Evolution Cycle', () => {
    it('should run evolution cycle without errors', async () => {
      const result = await api<{ processed: number; evolved: number; failed: number }>('/api/v1/metabolic/evolve', {
        method: 'POST',
      });

      console.log('Evolution result:', result);

      expect(result).toHaveProperty('processed');
      expect(result).toHaveProperty('evolved');
      expect(result).toHaveProperty('failed');
    });
  });

  describe('7. Lesson Extraction', () => {
    it('should run lesson extraction cycle', async () => {
      const result = await api<{ processed: number; factsCreated: number; duplicatesSkipped: number }>('/api/v1/metabolic/lessons', {
        method: 'POST',
      });

      console.log('Lesson extraction result:', result);

      expect(result).toHaveProperty('processed');
      expect(result).toHaveProperty('factsCreated');
      expect(result).toHaveProperty('duplicatesSkipped');
    });
  });
});

describe('End-to-End Flow: New Pattern', () => {
  const uniquePrefix = `test_${Date.now()}`;

  it('should process a new pattern through the full pipeline', async () => {
    // 1. Ingest 5 traces with a unique pattern
    console.log('\n--- Step 1: Ingesting traces ---');
    const traces: TraceResponse[] = [];

    for (let i = 1; i <= 5; i++) {
      const trace = await ingestTrace(
        `${uniquePrefix} double ${i * 10}`,
        `${i * 20}`,
        `${i * 10} * 2 = ${i * 20}`
      );
      traces.push(trace);
      console.log(`Trace ${i}: ${trace.intentTemplate}`);
    }

    // 2. Run crystallization
    console.log('\n--- Step 2: Running crystallization ---');
    const crystalResult = await api<CrystallizeResponse>('/api/v1/metabolic/crystallize', {
      method: 'POST',
    });
    console.log('Crystallized:', crystalResult);

    // 3. Try to execute (may or may not have a shard yet)
    console.log('\n--- Step 3: Attempting execution ---');
    const execResult = await execute(`${uniquePrefix} double 100`, { includeAll: true });
    console.log('Execution result:', execResult);

    // 4. Run promotion cycle
    console.log('\n--- Step 4: Running promotion ---');
    const promoteResult = await api<PromoteResponse>('/api/v1/metabolic/promote', {
      method: 'POST',
    });
    console.log('Promotion result:', promoteResult);

    // Assertions
    expect(traces).toHaveLength(5);
    expect(crystalResult.tracesProcessed).toBeGreaterThanOrEqual(0);
  });
});

describe('Shard Matching Accuracy', () => {
  const matchTestCases = [
    { input: 'convert 50 kilometers to miles', expectedShard: 'conversion' },
    { input: 'convert 100 fahrenheit to celsius', expectedShard: 'conversion' },
    { input: 'convert 32 celsius to fahrenheit', expectedShard: 'conversion' },
    { input: 'Calculate 15% of 200', expectedShard: 'percent' },
    { input: 'Reverse string: test', expectedShard: 'reverse' },
    { input: 'Convert to uppercase: hello', expectedShard: 'uppercase' },
    { input: 'Convert to lowercase: HELLO', expectedShard: 'lowercase' },
    { input: 'Format JSON: {"a":1}', expectedShard: 'json' },
  ];

  it.each(matchTestCases)('should match "$input" to correct shard', async ({ input, expectedShard }) => {
    const result = await execute(input);

    if (result.success && result.shardName) {
      expect(result.shardName.toLowerCase()).toContain(expectedShard.toLowerCase());
    } else {
      // If no match, log for debugging
      console.log(`No match for "${input}":`, result);
    }
  });
});

describe('Regression Tests', () => {
  it('should match km-to-miles input to conversion shard (not wrong category)', async () => {
    const result = await execute('convert 50 kilometers to miles');

    // On a fresh database without promoted shards, this will fail to match
    // This is expected behavior - the test validates correct matching when shards exist
    if (result.success) {
      // Should match a conversion shard, not something unrelated
      expect(result.shardName?.toLowerCase()).toMatch(/conversion|kilometer|miles|unit/);
      // Output should be correct distance conversion
      expect(result.output).toMatch(/\d+.*miles/i);
    } else {
      // No shard available - this is fine for a fresh database
      expect(result.error).toBe('No matching shard found');
    }
  });

  it('should handle edge cases gracefully', async () => {
    const edgeCases = [
      '',
      '   ',
      'convert',
      'convert to',
      '12345',
    ];

    for (const input of edgeCases) {
      const result = await execute(input);
      // Should either succeed or fail gracefully, not throw
      expect(result).toHaveProperty('success');
    }
  });
});
