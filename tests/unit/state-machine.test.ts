import { describe, it, expect, vi } from 'vitest';
import {
  createStateMachine,
  AgentState,
  InvalidTransitionError,
} from '../../apps/forge/src/runtime/state-machine.js';

describe('createStateMachine', () => {
  it('starts in IDLE state', () => {
    const sm = createStateMachine('exec-1');
    expect(sm.getState()).toBe(AgentState.IDLE);
    expect(sm.executionId).toBe('exec-1');
  });

  it('returns empty history initially', () => {
    const sm = createStateMachine('exec-1');
    expect(sm.getHistory()).toHaveLength(0);
  });

  it('transitions through a valid happy path', () => {
    const sm = createStateMachine('exec-1');
    sm.transition(AgentState.THINKING);
    expect(sm.getState()).toBe(AgentState.THINKING);

    sm.transition(AgentState.TOOL_CALLING);
    expect(sm.getState()).toBe(AgentState.TOOL_CALLING);

    sm.transition(AgentState.THINKING);
    sm.transition(AgentState.COMPLETED);
    expect(sm.getState()).toBe(AgentState.COMPLETED);

    sm.transition(AgentState.IDLE);
    expect(sm.getState()).toBe(AgentState.IDLE);
  });

  it('throws InvalidTransitionError on invalid transition', () => {
    const sm = createStateMachine('exec-1');
    expect(() => sm.transition(AgentState.COMPLETED)).toThrow(
      InvalidTransitionError,
    );
    try {
      sm.transition(AgentState.COMPLETED);
    } catch (e) {
      const err = e as InvalidTransitionError;
      expect(err.from).toBe(AgentState.IDLE);
      expect(err.to).toBe(AgentState.COMPLETED);
      expect(err.name).toBe('InvalidTransitionError');
    }
  });

  it('does not change state on invalid transition', () => {
    const sm = createStateMachine('exec-1');
    try {
      sm.transition(AgentState.TOOL_CALLING);
    } catch {
      // expected
    }
    expect(sm.getState()).toBe(AgentState.IDLE);
  });

  it('canTransition returns correct booleans', () => {
    const sm = createStateMachine('exec-1');
    expect(sm.canTransition(AgentState.THINKING)).toBe(true);
    expect(sm.canTransition(AgentState.COMPLETED)).toBe(false);
    expect(sm.canTransition(AgentState.FAILED)).toBe(false);
    expect(sm.canTransition(AgentState.TOOL_CALLING)).toBe(false);
  });

  it('records transitions in history with metadata', () => {
    const sm = createStateMachine('exec-1');
    sm.transition(AgentState.THINKING, { reason: 'start' });
    sm.transition(AgentState.COMPLETED, { tokens: 100 });

    const history = sm.getHistory();
    expect(history).toHaveLength(2);
    expect(history[0]!.from).toBe(AgentState.IDLE);
    expect(history[0]!.to).toBe(AgentState.THINKING);
    expect(history[0]!.metadata).toEqual({ reason: 'start' });
    expect(history[1]!.to).toBe(AgentState.COMPLETED);
    expect(history[1]!.metadata).toEqual({ tokens: 100 });
  });

  it('fires onTransition handlers and supports unsubscribe', () => {
    const sm = createStateMachine('exec-1');
    const handler = vi.fn();

    const unsub = sm.onTransition(handler);
    sm.transition(AgentState.THINKING);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        from: AgentState.IDLE,
        to: AgentState.THINKING,
      }),
    );

    unsub();
    sm.transition(AgentState.COMPLETED);
    expect(handler).toHaveBeenCalledTimes(1); // no additional call
  });

  it('swallows handler errors without breaking state machine', () => {
    const sm = createStateMachine('exec-1');
    sm.onTransition(() => {
      throw new Error('boom');
    });

    expect(() => sm.transition(AgentState.THINKING)).not.toThrow();
    expect(sm.getState()).toBe(AgentState.THINKING);
  });

  it('getElapsedMs returns a non-negative number', () => {
    const sm = createStateMachine('exec-1');
    expect(sm.getElapsedMs()).toBeGreaterThanOrEqual(0);
  });

  it('supports WAITING_APPROVAL flow', () => {
    const sm = createStateMachine('exec-1');
    sm.transition(AgentState.THINKING);
    sm.transition(AgentState.TOOL_CALLING);
    sm.transition(AgentState.WAITING_APPROVAL);
    expect(sm.getState()).toBe(AgentState.WAITING_APPROVAL);

    sm.transition(AgentState.TOOL_CALLING);
    expect(sm.getState()).toBe(AgentState.TOOL_CALLING);
  });

  it('supports FAILED → IDLE recovery', () => {
    const sm = createStateMachine('exec-1');
    sm.transition(AgentState.THINKING);
    sm.transition(AgentState.FAILED);
    expect(sm.getState()).toBe(AgentState.FAILED);

    sm.transition(AgentState.IDLE);
    expect(sm.getState()).toBe(AgentState.IDLE);
  });
});
