import { describe, it, expect, vi } from 'vitest';
import {
  createStateMachine,
  AgentState,
  InvalidTransitionError,
} from '../apps/forge/src/runtime/state-machine.js';

describe('AgentStateMachine', () => {
  it('starts in IDLE state', () => {
    const sm = createStateMachine('exec-1');
    expect(sm.getState()).toBe(AgentState.IDLE);
    expect(sm.executionId).toBe('exec-1');
    expect(sm.getHistory()).toHaveLength(0);
  });

  it('allows valid IDLE -> THINKING transition', () => {
    const sm = createStateMachine('exec-2');
    sm.transition(AgentState.THINKING);
    expect(sm.getState()).toBe(AgentState.THINKING);
    expect(sm.getHistory()).toHaveLength(1);
    expect(sm.getHistory()[0]!.from).toBe(AgentState.IDLE);
    expect(sm.getHistory()[0]!.to).toBe(AgentState.THINKING);
  });

  it('rejects invalid IDLE -> COMPLETED transition', () => {
    const sm = createStateMachine('exec-3');
    expect(() => sm.transition(AgentState.COMPLETED)).toThrow(InvalidTransitionError);
  });

  it('walks full happy path: IDLE -> THINKING -> TOOL_CALLING -> THINKING -> COMPLETED', () => {
    const sm = createStateMachine('exec-4');
    sm.transition(AgentState.THINKING);
    sm.transition(AgentState.TOOL_CALLING);
    sm.transition(AgentState.THINKING);
    sm.transition(AgentState.COMPLETED);
    expect(sm.getState()).toBe(AgentState.COMPLETED);
    expect(sm.getHistory()).toHaveLength(4);
  });

  it('supports WAITING_APPROVAL flow', () => {
    const sm = createStateMachine('exec-5');
    sm.transition(AgentState.THINKING);
    sm.transition(AgentState.TOOL_CALLING);
    sm.transition(AgentState.WAITING_APPROVAL);
    expect(sm.getState()).toBe(AgentState.WAITING_APPROVAL);
    sm.transition(AgentState.TOOL_CALLING);
    expect(sm.getState()).toBe(AgentState.TOOL_CALLING);
  });

  it('allows FAILED -> IDLE reset', () => {
    const sm = createStateMachine('exec-6');
    sm.transition(AgentState.THINKING);
    sm.transition(AgentState.FAILED);
    expect(sm.getState()).toBe(AgentState.FAILED);
    sm.transition(AgentState.IDLE);
    expect(sm.getState()).toBe(AgentState.IDLE);
  });

  it('canTransition reports correctly', () => {
    const sm = createStateMachine('exec-7');
    expect(sm.canTransition(AgentState.THINKING)).toBe(true);
    expect(sm.canTransition(AgentState.COMPLETED)).toBe(false);
    expect(sm.canTransition(AgentState.FAILED)).toBe(false);
  });

  it('stores metadata on transitions', () => {
    const sm = createStateMachine('exec-8');
    sm.transition(AgentState.THINKING, { reason: 'user input' });
    expect(sm.getHistory()[0]!.metadata).toEqual({ reason: 'user input' });
  });

  it('calls onTransition handlers and supports unsubscribe', () => {
    const sm = createStateMachine('exec-9');
    const handler = vi.fn();
    const unsub = sm.onTransition(handler);
    sm.transition(AgentState.THINKING);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]![0]).toMatchObject({
      from: AgentState.IDLE,
      to: AgentState.THINKING,
    });
    unsub();
    sm.transition(AgentState.TOOL_CALLING);
    expect(handler).toHaveBeenCalledTimes(1); // not called again
  });

  it('swallows handler errors without breaking state machine', () => {
    const sm = createStateMachine('exec-10');
    sm.onTransition(() => { throw new Error('boom'); });
    expect(() => sm.transition(AgentState.THINKING)).not.toThrow();
    expect(sm.getState()).toBe(AgentState.THINKING);
  });

  it('InvalidTransitionError has from/to properties', () => {
    const err = new InvalidTransitionError(AgentState.IDLE, AgentState.COMPLETED);
    expect(err.from).toBe(AgentState.IDLE);
    expect(err.to).toBe(AgentState.COMPLETED);
    expect(err.name).toBe('InvalidTransitionError');
    expect(err.message).toContain('idle');
    expect(err.message).toContain('completed');
  });

  it('getElapsedMs returns positive number', () => {
    const sm = createStateMachine('exec-11');
    expect(sm.getElapsedMs()).toBeGreaterThanOrEqual(0);
  });
});
