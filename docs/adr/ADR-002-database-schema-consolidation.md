# ADR-002: Database Schema Consolidation & Missing Tables

- **Status**: Accepted
- **Date**: 2026-02-22
- **Author**: Architect Agent
- **Priority**: HIGH

## Context

An audit of the AskAlf database schema revealed three categories of issues:

1. **Ghost tables**: Tables referenced in application code with no CREATE TABLE statement anywhere in the codebase
2. **Schema fragmentation**: Core agent tables defined in an ad-hoc SQL script (`apps/dashboard/sql/agent-hub-tables.sql`) outside the standard migration system
3. **Missing indexes**: Performance-critical columns lacking indexes, plus an N+1 query pattern

### Ghost Tables (code references but no DDL)

| Table | Referenced In | Operations |
|-------|--------------|------------|
| `ticket_notes` | `apps/forge/src/routes/platform-admin/tickets.ts:219,235` | SELECT, INSERT |
| `agent_audit_log` | `apps/forge/src/routes/platform-admin/tickets.ts:118,166,203` | INSERT |
| `agent_findings` | `packages/database/src/migrations/029_reports_indexes.sql` | CREATE INDEX |

These tables likely exist in the live database (created manually or via the ad-hoc script) but have no migration to recreate them on a fresh deployment.

### Schema Fragmentation

The following tables are defined only in `apps/dashboard/sql/agent-hub-tables.sql`, not in the migration system:

- `agent_interventions` (with 4 indexes)
- `agent_tickets` (with 5 indexes)
- `agent_schedules` (with 1 index)

Migrations 028 and 029 in `packages/database/src/migrations/` add columns and indexes to these tables, creating a dependency on the ad-hoc script having been run first. A fresh database deployment running only migrations would fail.

### N+1 Query Pattern

`apps/forge/src/routes/platform-admin/tickets.ts:62-78` fetches up to 20 tickets, then loops through each to query `forge_executions` individually. This produces 1 + N queries per page load (up to 21 queries for a full page).

## Decision

### 1. Create substrate migration `034_schema_consolidation.sql`

This migration uses `CREATE TABLE IF NOT EXISTS` to bring all ghost and ad-hoc tables into the migration chain without breaking existing databases.

#### `ticket_notes` table

```sql
CREATE TABLE IF NOT EXISTS ticket_notes (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES agent_tickets(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  author TEXT NOT NULL,
  author_type TEXT NOT NULL DEFAULT 'human'
    CHECK (author_type IN ('human', 'agent')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ticket_notes_ticket_id
  ON ticket_notes(ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_notes_created_at
  ON ticket_notes(created_at DESC);
```

#### `agent_audit_log` table

Derived from INSERT statements in `tickets.ts`:

```sql
CREATE TABLE IF NOT EXISTS agent_audit_log (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  actor TEXT,
  actor_id TEXT,
  old_value JSONB DEFAULT '{}',
  new_value JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_audit_log_entity
  ON agent_audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_agent_audit_log_action
  ON agent_audit_log(action);
CREATE INDEX IF NOT EXISTS idx_agent_audit_log_created_at
  ON agent_audit_log(created_at DESC);
```

#### `agent_findings` table

```sql
CREATE TABLE IF NOT EXISTS agent_findings (
  id TEXT PRIMARY KEY,
  agent_id TEXT,
  agent_name TEXT,
  finding TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info'
    CHECK (severity IN ('info', 'warning', 'critical')),
  category TEXT,
  tags TEXT[] DEFAULT '{}',
  metadata JSONB DEFAULT '{}',
  execution_id TEXT,
  namespace TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_findings_agent_id
  ON agent_findings(agent_id);
```

#### Re-declare ad-hoc tables (idempotent)

Include `CREATE TABLE IF NOT EXISTS` for `agent_interventions`, `agent_tickets`, and `agent_schedules` with all their indexes, matching the definitions in `agent-hub-tables.sql`. This makes the migration chain self-sufficient.

### 2. Add missing indexes for `agent_schedules`

```sql
CREATE INDEX IF NOT EXISTS idx_schedules_next_run
  ON agent_schedules(next_run_at)
  WHERE next_run_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_schedules_type
  ON agent_schedules(schedule_type);
```

### 3. Fix N+1 query in tickets route

Replace the loop in `tickets.ts:62-78` with a single query using a lateral join or post-fetch IN-clause:

```typescript
// After fetching tickets, batch-fetch linked executions
const taskIds = tickets
  .map(t => t.task_id)
  .filter(Boolean);

if (taskIds.length > 0) {
  const placeholders = taskIds.map((_, i) => `$${i + 1}`).join(',');
  const execs = await query<Record<string, unknown>>(
    `SELECT id, status, started_at, completed_at
     FROM forge_executions WHERE id IN (${placeholders})`,
    taskIds,
  );
  const execMap = new Map(execs.map(e => [e.id, e]));
  for (const ticket of tickets) {
    if (ticket.task_id && execMap.has(ticket.task_id)) {
      const exec = execMap.get(ticket.task_id)!;
      ticket.task = {
        id: exec.id,
        status: exec.status,
        started_at: exec.started_at,
        completed_at: exec.completed_at,
      };
    }
  }
}
```

This reduces worst-case queries from 21 to 2 per page load.

### 4. Fix `agent_audit_log` INSERT calls

The INSERT at `tickets.ts:118` includes `actor_id` but `tickets.ts:203` omits it. Both should use consistent column lists. The missing `id` column also needs a default — either use `gen_random_uuid()::text` as default or generate with `ulid()` in application code.

**Recommended**: Add `id` generation in app code for consistency:

```typescript
import { ulid } from 'ulid';
// ...
void substrateQuery(
  `INSERT INTO agent_audit_log (id, entity_type, entity_id, action, actor, actor_id, old_value, new_value)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
  [ulid(), 'ticket', id, 'created', ...],
).catch(() => {});
```

## Consequences

### Positive
- Fresh deployments work without running ad-hoc SQL scripts
- `ticket_notes` feature becomes functional (currently silently fails)
- `agent_audit_log` inserts stop failing silently (`.catch(() => {})` masks errors)
- Tickets page load drops from 21 queries to 2
- `agent_schedules` queries by `next_run_at` use an index instead of sequential scan

### Negative
- Migration 034 must be tested carefully on existing databases to confirm `IF NOT EXISTS` doesn't conflict with existing table definitions
- The ad-hoc `agent-hub-tables.sql` should be marked as deprecated (but not deleted, for reference)

### Risks
- Column type mismatches between ad-hoc definitions and migration declarations (mitigated by using identical DDL)
- `ON DELETE CASCADE` on `ticket_notes.ticket_id` means deleting a ticket removes its notes — this is intentional

## Implementation Plan

| Phase | Work | Owner | Ticket |
|-------|------|-------|--------|
| 1 | Write `034_schema_consolidation.sql` migration | Backend Dev | TBD |
| 2 | Fix N+1 query + audit_log consistency in `tickets.ts` | Backend Dev | Same ticket |
| 3 | Test migration on existing database | Backend Dev | Same ticket |

## Notes

- The `agent_audit_log` table currently uses fire-and-forget inserts with `.catch(() => {})`. Once the table exists, these silent failures will become successful writes, which is the desired behavior.
- `agent_findings` is used by the `finding_ops` MCP tool and confirmed to exist at runtime. This migration just ensures it's reproducible from the migration chain.
- The `deleted_at` column on `agent_tickets` (referenced at `tickets.ts:198`) is not in the original `agent-hub-tables.sql` definition. It must have been added manually. The migration should include: `ALTER TABLE agent_tickets ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;`
