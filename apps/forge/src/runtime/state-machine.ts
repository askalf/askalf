/**
 * Agent State Machine
 * Tracks the execution state of an agent through defined transitions,
 * emits events on state changes, and records the full transition history.
 */

// ============================================
// State Definitions
// ============================================

export enum AgentState {
  IDLE = 'idle',
  THINKING = 'thinking',
  TOOL_CALLING = 'tool_calling',
  WAITING_APPROVAL = 'waiting_approval',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

/**
 * Valid state transitions.
 * From each state, only certain transitions are allowed.
 */
const VALID_TRANSITIONS: Record<AgentState, AgentState[]> = {
  [AgentState.IDLE]: [AgentState.THINKING],
  [AgentState.THINKING]: [
    AgentState.TOOL_CALLING,
    AgentState.COMPLETED,
    AgentState.FAILED,
  ],
  [AgentState.TOOL_CALLING]: [
    AgentState.THINKING,
    AgentState.WAITING_APPROVAL,
    AgentState.FAILED,
  ],
  [AgentState.WAITING_APPROVAL]: [
    AgentState.TOOL_CALLING,
    AgentState.FAILED,
  ],
  [AgentState.COMPLETED]: [AgentState.IDLE],
  [AgentState.FAILED]: [AgentState.IDLE],
};

// ============================================
// Types
// ============================================

export interface StateTransition {
  from: AgentState;
  to: AgentState;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export type StateEventHandler = (transition: StateTransition) => void;

export interface StateMachine {
  /** The execution ID this state machine tracks. */
  readonly executionId: string;

  /** Get the current state. */
  getState(): AgentState;

  /** Get the full transition history. */
  getHistory(): ReadonlyArray<StateTransition>;

  /**
   * Transition to a new state.
   * Throws if the transition is not valid from the current state.
   *
   * @param to - Target state
   * @param metadata - Optional metadata to attach to the transition record
   */
  transition(to: AgentState, metadata?: Record<string, unknown>): void;

  /**
   * Check if a transition to the given state is valid from the current state.
   */
  canTransition(to: AgentState): boolean;

  /**
   * Register an event handler that fires on every state transition.
   * Returns an unsubscribe function.
   */
  onTransition(handler: StateEventHandler): () => void;

  /**
   * Get the duration in milliseconds since the state machine was created.
   */
  getElapsedMs(): number;
}

// ============================================
// Invalid Transition Error
// ============================================

export class InvalidTransitionError extends Error {
  public readonly from: AgentState;
  public readonly to: AgentState;

  constructor(from: AgentState, to: AgentState) {
    super(`Invalid state transition: ${from} -> ${to}`);
    this.name = 'InvalidTransitionError';
    this.from = from;
    this.to = to;
  }
}

// ============================================
// Factory
// ============================================

/**
 * Creates a new state machine for an agent execution.
 * Starts in the IDLE state.
 *
 * @param executionId - The execution ID to associate with this state machine
 * @returns A StateMachine instance
 */
export function createStateMachine(executionId: string): StateMachine {
  let currentState: AgentState = AgentState.IDLE;
  const history: StateTransition[] = [];
  const handlers: Set<StateEventHandler> = new Set();
  const createdAt = Date.now();

  return {
    executionId,

    getState(): AgentState {
      return currentState;
    },

    getHistory(): ReadonlyArray<StateTransition> {
      return history;
    },

    transition(to: AgentState, metadata?: Record<string, unknown>): void {
      const allowed = VALID_TRANSITIONS[currentState];
      if (!allowed || !allowed.includes(to)) {
        throw new InvalidTransitionError(currentState, to);
      }

      const transition: StateTransition = {
        from: currentState,
        to,
        timestamp: Date.now(),
        metadata,
      };

      currentState = to;
      history.push(transition);

      // Notify all handlers
      for (const handler of handlers) {
        try {
          handler(transition);
        } catch {
          // Swallow listener errors to prevent them from breaking the state machine
        }
      }
    },

    canTransition(to: AgentState): boolean {
      const allowed = VALID_TRANSITIONS[currentState];
      return allowed !== undefined && allowed.includes(to);
    },

    onTransition(handler: StateEventHandler): () => void {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },

    getElapsedMs(): number {
      return Date.now() - createdAt;
    },
  };
}
