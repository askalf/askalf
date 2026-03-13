/**
 * Agent Matcher unit tests.
 *
 * Tests for the pure scoring functions: computeKeywordOverlap, isTypeCompatible,
 * and the scoreAgents logic (tested indirectly via matchAgentsToTasks with
 * mocked DB and capability registry).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock database and capability registry before imports
vi.mock('../../apps/forge/src/database.js', () => ({
  query: vi.fn(),
}));

vi.mock('../../apps/forge/src/orchestration/capability-registry.js', () => ({
  getAgentCapabilities: vi.fn(),
}));

import {
  computeKeywordOverlap,
  isTypeCompatible,
  matchAgentsToTasks,
} from '../../apps/forge/src/orchestration/agent-matcher.js';
import { query } from '../../apps/forge/src/database.js';
import { getAgentCapabilities } from '../../apps/forge/src/orchestration/capability-registry.js';

const mockQuery = vi.mocked(query);
const mockGetCaps = vi.mocked(getAgentCapabilities);

function makeAgent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'agent-1',
    name: 'Dev Agent',
    type: 'dev',
    description: 'A development agent',
    system_prompt: 'You are a dev agent.',
    status: 'idle',
    autonomy_level: 5,
    tasks_completed: 10,
    tasks_failed: 2,
    ...overrides,
  };
}

beforeEach(() => {
  mockQuery.mockReset();
  mockGetCaps.mockReset();
});

// ── computeKeywordOverlap ──

describe('computeKeywordOverlap', () => {
  it('returns 0 for completely different texts', () => {
    const score = computeKeywordOverlap(
      'quantum physics nuclear fusion',
      'chocolate cake recipe baking',
    );
    expect(score).toBe(0);
  });

  it('returns 1 for identical texts', () => {
    const score = computeKeywordOverlap(
      'security vulnerability scanning',
      'security vulnerability scanning',
    );
    expect(score).toBe(1);
  });

  it('returns a score between 0 and 1 for partial overlap', () => {
    const score = computeKeywordOverlap(
      'security vulnerability scanning analysis',
      'security audit penetration testing scanning',
    );
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it('returns 0 when one text is empty', () => {
    expect(computeKeywordOverlap('', 'some words here')).toBe(0);
    expect(computeKeywordOverlap('hello world testing', '')).toBe(0);
  });

  it('returns 0 when both texts are empty', () => {
    expect(computeKeywordOverlap('', '')).toBe(0);
  });

  it('ignores stop words', () => {
    // 'the', 'is', 'a' are stop words; only significant words count
    const score = computeKeywordOverlap(
      'the quick brown fox',
      'the slow brown dog',
    );
    // 'brown' overlaps, 'quick' vs 'slow' / 'fox' vs 'dog' differ
    // stop words 'the' excluded, only 'quick','brown','fox' and 'slow','brown','dog'
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it('ignores words with 2 or fewer characters', () => {
    const score = computeKeywordOverlap('go do it', 'go do it');
    // 'go' and 'do' and 'it' are all <= 2 chars, filtered out
    expect(score).toBe(0);
  });

  it('is case-insensitive', () => {
    const score1 = computeKeywordOverlap('Security Analysis', 'security analysis');
    const score2 = computeKeywordOverlap('security analysis', 'security analysis');
    expect(score1).toBe(score2);
  });

  it('strips non-alphanumeric characters', () => {
    const score = computeKeywordOverlap(
      'code-review, testing!',
      'code review testing',
    );
    expect(score).toBe(1);
  });
});

// ── isTypeCompatible ──

describe('isTypeCompatible', () => {
  it('dev is compatible with research', () => {
    expect(isTypeCompatible('dev', 'research')).toBe(true);
  });

  it('dev is compatible with custom', () => {
    expect(isTypeCompatible('dev', 'custom')).toBe(true);
  });

  it('dev is compatible with security', () => {
    expect(isTypeCompatible('dev', 'security')).toBe(true);
  });

  it('dev is NOT compatible with support', () => {
    expect(isTypeCompatible('dev', 'support')).toBe(false);
  });

  it('research is compatible with dev', () => {
    expect(isTypeCompatible('research', 'dev')).toBe(true);
  });

  it('research is compatible with content', () => {
    expect(isTypeCompatible('research', 'content')).toBe(true);
  });

  it('security is compatible with monitor', () => {
    expect(isTypeCompatible('security', 'monitor')).toBe(true);
  });

  it('custom is compatible with everything', () => {
    expect(isTypeCompatible('custom', 'dev')).toBe(true);
    expect(isTypeCompatible('custom', 'research')).toBe(true);
    expect(isTypeCompatible('custom', 'support')).toBe(true);
    expect(isTypeCompatible('custom', 'content')).toBe(true);
    expect(isTypeCompatible('custom', 'monitor')).toBe(true);
    expect(isTypeCompatible('custom', 'security')).toBe(true);
  });

  it('returns false for unknown agent type', () => {
    expect(isTypeCompatible('unknown', 'dev')).toBe(false);
  });

  it('monitor is compatible with dev', () => {
    expect(isTypeCompatible('monitor', 'dev')).toBe(true);
  });

  it('support is NOT compatible with dev', () => {
    expect(isTypeCompatible('support', 'dev')).toBe(false);
  });
});

// ── matchAgentsToTasks (scoring integration) ──

describe('matchAgentsToTasks', () => {
  it('throws when no active agents are available', async () => {
    mockQuery.mockResolvedValueOnce([]);

    await expect(
      matchAgentsToTasks([
        {
          title: 'Some task',
          description: 'Do something',
          suggestedAgentType: 'dev',
          dependencies: [],
          estimatedComplexity: 'low' as const,
        },
      ]),
    ).rejects.toThrow('No active agents available');
  });

  it('matches a dev task to a dev agent with type alignment', async () => {
    const devAgent = makeAgent({ id: 'a-dev', name: 'DevBot', type: 'dev', status: 'idle' });
    const researchAgent = makeAgent({ id: 'a-res', name: 'ResBot', type: 'research', status: 'idle' });

    mockQuery.mockResolvedValueOnce([devAgent, researchAgent]);
    mockGetCaps.mockResolvedValue([]);

    const results = await matchAgentsToTasks([
      {
        title: 'Fix login bug',
        description: 'Debug and fix the login endpoint',
        suggestedAgentType: 'dev',
        dependencies: [],
        estimatedComplexity: 'low' as const,
      },
    ]);

    expect(results).toHaveLength(1);
    expect(results[0]!.agentId).toBe('a-dev');
    expect(results[0]!.score).toBeGreaterThan(0);
  });

  it('prefers idle agents over busy ones', async () => {
    const idleAgent = makeAgent({ id: 'a-idle', name: 'IdleBot', type: 'research', status: 'idle' });
    const busyAgent = makeAgent({ id: 'a-busy', name: 'BusyBot', type: 'research', status: 'running' });

    mockQuery.mockResolvedValueOnce([busyAgent, idleAgent]);
    mockGetCaps.mockResolvedValue([]);

    const results = await matchAgentsToTasks([
      {
        title: 'Research competitors',
        description: 'Investigate competitor landscape',
        suggestedAgentType: 'research',
        dependencies: [],
        estimatedComplexity: 'low' as const,
      },
    ]);

    expect(results).toHaveLength(1);
    expect(results[0]!.agentId).toBe('a-idle');
  });

  it('penalizes already-assigned agents across tasks', async () => {
    const agentA = makeAgent({ id: 'a-1', name: 'Agent A', type: 'dev', status: 'idle' });
    const agentB = makeAgent({ id: 'a-2', name: 'Agent B', type: 'dev', status: 'idle' });

    mockQuery.mockResolvedValueOnce([agentA, agentB]);
    mockGetCaps.mockResolvedValue([]);

    const results = await matchAgentsToTasks([
      {
        title: 'Task 1',
        description: 'First development task',
        suggestedAgentType: 'dev',
        dependencies: [],
        estimatedComplexity: 'low' as const,
      },
      {
        title: 'Task 2',
        description: 'Second development task',
        suggestedAgentType: 'dev',
        dependencies: [],
        estimatedComplexity: 'low' as const,
      },
    ]);

    expect(results).toHaveLength(2);
    // The two tasks should ideally be assigned to different agents
    // because of the -10 penalty for already-assigned
    const assignedIds = new Set(results.map((r) => r.agentId));
    expect(assignedIds.size).toBe(2);
  });

  it('favors agents with higher success rate', async () => {
    const goodAgent = makeAgent({
      id: 'a-good',
      name: 'GoodBot',
      type: 'dev',
      status: 'idle',
      tasks_completed: 100,
      tasks_failed: 0,
    });
    const badAgent = makeAgent({
      id: 'a-bad',
      name: 'BadBot',
      type: 'dev',
      status: 'idle',
      tasks_completed: 5,
      tasks_failed: 95,
    });

    mockQuery.mockResolvedValueOnce([badAgent, goodAgent]);
    mockGetCaps.mockResolvedValue([]);

    const results = await matchAgentsToTasks([
      {
        title: 'Critical task',
        description: 'Important development work',
        suggestedAgentType: 'dev',
        dependencies: [],
        estimatedComplexity: 'low' as const,
      },
    ]);

    expect(results[0]!.agentId).toBe('a-good');
  });

  it('gives new agents benefit of the doubt (8 points)', async () => {
    const newAgent = makeAgent({
      id: 'a-new',
      name: 'NewBot',
      type: 'dev',
      status: 'idle',
      tasks_completed: 0,
      tasks_failed: 0,
    });
    const poorAgent = makeAgent({
      id: 'a-poor',
      name: 'PoorBot',
      type: 'dev',
      status: 'idle',
      tasks_completed: 1,
      tasks_failed: 9,
    });

    mockQuery.mockResolvedValueOnce([poorAgent, newAgent]);
    mockGetCaps.mockResolvedValue([]);

    const results = await matchAgentsToTasks([
      {
        title: 'Some task',
        description: 'A development task',
        suggestedAgentType: 'dev',
        dependencies: [],
        estimatedComplexity: 'low' as const,
      },
    ]);

    // New agent gets 8 points for success rate vs poor agent gets 1.5 (10% * 15)
    expect(results[0]!.agentId).toBe('a-new');
  });

  it('grants autonomy bonus for high-complexity tasks with high autonomy agents', async () => {
    const highAutoAgent = makeAgent({
      id: 'a-auto',
      name: 'AutoBot',
      type: 'dev',
      status: 'idle',
      autonomy_level: 9,
    });
    const lowAutoAgent = makeAgent({
      id: 'a-low',
      name: 'ManualBot',
      type: 'dev',
      status: 'idle',
      autonomy_level: 3,
    });

    mockQuery.mockResolvedValueOnce([lowAutoAgent, highAutoAgent]);
    mockGetCaps.mockResolvedValue([]);

    const results = await matchAgentsToTasks([
      {
        title: 'Complex refactor',
        description: 'Major architecture refactoring',
        suggestedAgentType: 'dev',
        dependencies: [],
        estimatedComplexity: 'high' as const,
      },
    ]);

    // highAutoAgent should get 5 points for autonomy, lowAutoAgent gets 2
    expect(results[0]!.agentId).toBe('a-auto');
  });

  it('uses compatible type when exact match is unavailable', async () => {
    const devAgent = makeAgent({ id: 'a-dev', name: 'DevBot', type: 'dev', status: 'idle' });

    mockQuery.mockResolvedValueOnce([devAgent]);
    mockGetCaps.mockResolvedValue([]);

    const results = await matchAgentsToTasks([
      {
        title: 'Security audit',
        description: 'Run security analysis',
        suggestedAgentType: 'security',
        dependencies: [],
        estimatedComplexity: 'medium' as const,
      },
    ]);

    expect(results).toHaveLength(1);
    expect(results[0]!.agentId).toBe('a-dev');
    // dev is compatible with security, so should get 15 points for type
    expect(results[0]!.reasons).toEqual(
      expect.arrayContaining([expect.stringContaining('compatible type')]),
    );
  });

  it('falls back to first agent when no ideal match', async () => {
    // Create an agent with a type that has no compatibility with the suggested type
    const supportAgent = makeAgent({
      id: 'a-support',
      name: 'SupportBot',
      type: 'support',
      status: 'idle',
    });

    mockQuery.mockResolvedValueOnce([supportAgent]);
    mockGetCaps.mockResolvedValue([]);

    const results = await matchAgentsToTasks([
      {
        title: 'Some task',
        description: 'A generic task',
        suggestedAgentType: 'monitor',
        dependencies: [],
        estimatedComplexity: 'low' as const,
      },
    ]);

    expect(results).toHaveLength(1);
    // Even without ideal match, agent still gets scored and returned
    expect(results[0]!.agentId).toBe('a-support');
  });
});
