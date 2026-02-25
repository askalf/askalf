# ADR-002: Execution Reliability & Data Integrity

**Status:** Accepted
**Date:** 2026-02-22
**Author:** Architect
**Supersedes:** None
**Related:** ADR-001 (Agent Code Review Pipeline)

## Context

The Forge execution engine is the core of AskAlf — it manages agent lifecycles, records cost events, and streams progress to clients. An audit of `apps/forge/src/` reveals **three critical reliability gaps** that can cause silent data corruption, resource leaks, and invisible process failures.

### Problem 1: No Database Transaction Support

`apps/forge/src/database.ts` exposes only `query()` and `queryOne()` — individual statement execution with no transaction wrapping. Multi-step operations like execution lifecycle management execute as independent queries:

```
createExecutionRecord()   → INSERT forge_executions (status=running)
  ... agent runs ...
recordCostEvent()         → INSERT forge_cost_events
completeExecutionRecord() → UPDATE forge_executions (status=completed)
```

If the process crashes between `recordCostEvent()` and `completeExecutionRecord()`, the execution is left in `running` status with cost recorded but no completion. The orphan recovery on next startup will mark it `failed`, but the cost event is now associated with a "failed" execution that actually succeeded partially.

**Affected operations:**
- Execution create → run → complete/fail (`engine.ts:193-240`)
- Cost tracking decoupled from execution completion
- Coordination session updates with multiple task status changes
- Reactive trigger creation + rate limit check (TOCTOU race)

### Problem 2: Missing Process Error Handlers

`apps/forge/src/index.ts:521-522` registers only `SIGTERM` and `SIGINT` handlers. There are no handlers for:
- `uncaughtException` — synchronous errors in background tasks crash silently
- `unhandledRejection` — async errors in fire-and-forget patterns vanish

Multiple `.catch(() => {})` patterns exist (index.ts:304, 317, 327) that swallow errors in background work like event emission and parent execution cleanup. If these throw synchronously or the catch itself fails, the process becomes a zombie — running but non-functional.

### Problem 3: SSE Stream Resource Leaks

`apps/forge/src/routes/executions.ts:229-324` manages SSE connections with intervals and event listeners, but:
- `reply.raw.write()` in the heartbeat interval (line 260) has no error handling — a broken pipe throws, the interval continues, and cleanup never runs
- The `closed` flag prevents double-cleanup but doesn't prevent write-after-close races
- No `reply.raw.on('error', cleanup)` handler — only `request.raw.on('close', cleanup)` at line 323

Under sustained load with flaky clients, this leaks intervals and event bus listeners.

## Decision

### 1. Add Transaction Support to Database Module

Add a `transaction()` helper to `apps/forge/src/database.ts`:

```typescript
export async function transaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
```

Also add a `clientQuery()` helper for use within transactions:

```typescript
export async function clientQuery<T extends pg.QueryResultRow>(
  client: pg.PoolClient,
  text: string,
  params?: unknown[],
): Promise<T[]> {
  const result = await client.query<T>(text, params);
  return result.rows;
}
```

**Migration path:** The existing `query()`/`queryOne()` functions remain unchanged. Transaction wrapping is opt-in — adopt it in critical paths first (execution lifecycle, cost recording), then expand.

**Critical paths to wrap in transactions:**
1. `engine.ts` — execution create + complete/fail + cost event (highest priority)
2. `reactive-triggers.ts` — rate limit check + trigger insert (fixes TOCTOU race)
3. Coordination session task updates (multiple status changes)

### 2. Add Process Error Handlers

Add to `apps/forge/src/index.ts` before `start()`:

```typescript
process.on('uncaughtException', (err) => {
  console.error('[Forge] FATAL uncaught exception:', err);
  shutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Forge] Unhandled rejection at:', promise, 'reason:', reason);
  // Log but don't crash — many fire-and-forget patterns exist.
  // TODO: After transaction adoption reduces fire-and-forget patterns,
  // escalate this to shutdown.
});
```

**Rationale:** `uncaughtException` triggers shutdown because the process state is undefined. `unhandledRejection` logs only (for now) because the codebase has many `.catch(() => {})` patterns that would need cleanup first. Phase 2 should eliminate fire-and-forget patterns, then `unhandledRejection` can trigger shutdown.

### 3. Harden SSE Stream Cleanup

Modify `apps/forge/src/routes/executions.ts` SSE handler:

```typescript
// Add error handler on the response stream
reply.raw.on('error', cleanup);

// Wrap heartbeat writes
const heartbeat = setInterval(() => {
  if (closed) return;
  try {
    reply.raw.write(`: heartbeat\n\n`);
  } catch {
    cleanup();
  }
}, 15_000);

// Wrap event handler writes
const handler = (forgeEvent: Record<string, unknown>) => {
  if (closed) return;
  // ... filtering logic ...
  try {
    reply.raw.write(`data: ${sseEvent}\n\n`);
  } catch {
    cleanup();
    return;
  }
  // ... completion check ...
};
```

Also guard `reply.raw.end()` in `cleanup()`:

```typescript
function cleanup() {
  if (closed) return;
  closed = true;
  clearInterval(heartbeat);
  clearInterval(pollInterval);
  if (eventBus) eventBus.off('execution', handler as any);
  try { reply.raw.end(); } catch { /* already closed */ }
}
```

## Implementation Plan

### Phase 1: Foundation (Backend Dev — 1 ticket)
1. Add `transaction()` and `clientQuery()` to `database.ts`
2. Add `uncaughtException` / `unhandledRejection` handlers to `index.ts`
3. Harden SSE stream cleanup in `routes/executions.ts`
4. Unit test: transaction rollback on error, cleanup on broken pipe

### Phase 2: Transaction Adoption (Backend Dev — 1 ticket)
1. Wrap execution lifecycle in transaction (`engine.ts` create + complete + cost)
2. Fix reactive trigger TOCTOU race with atomic INSERT...SELECT
3. Wrap coordination session task updates
4. Audit remaining `.catch(() => {})` patterns — replace with proper error propagation

### Phase 3: Observability (Backend Dev — future)
1. Add transaction duration metrics
2. Add SSE connection count gauge
3. Add unhandled rejection counter
4. Alert on transaction rollback rate

## Consequences

### Positive
- **Data integrity:** Execution records and cost events are atomically consistent
- **No silent failures:** Process-level errors are logged and handled
- **No resource leaks:** SSE connections are reliably cleaned up on all error paths
- **Incremental adoption:** Existing code continues to work; transactions are opt-in

### Negative
- **Transaction overhead:** Each transactional operation acquires a dedicated pool client (reduces effective pool from 25 to ~20 under load)
- **Migration effort:** Critical paths need refactoring to pass `client` through call chains
- **Behavioral change:** `unhandledRejection` logging may surface noisy warnings initially

### Risks
- **Pool exhaustion:** Long-running transactions could starve the pool. Mitigate with a transaction timeout (30s default).
- **Deadlocks:** Multiple transactions acquiring rows in different orders. Mitigate with consistent lock ordering and `SET lock_timeout = '10s'`.

## Alternatives Considered

1. **Savepionts instead of transactions** — More granular but adds complexity without solving the core problem. Transactions are simpler and sufficient.
2. **Event sourcing for execution state** — Would solve consistency but is a massive architectural change. Not justified for the current scale.
3. **Advisory locks for rate limiting** — Simpler than atomic INSERT...SELECT but doesn't solve the general TOCTOU problem. The atomic pattern is more reusable.
4. **Crash-only design (no graceful shutdown)** — The orphan recovery already handles this, but adding process handlers catches more failure modes with minimal effort.
