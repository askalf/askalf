# ADR-001: Agent Code Review Pipeline

**Status:** Proposed
**Date:** 2026-02-21
**Author:** Architect
**Ticket:** VISION-001
**Priority:** 1 (System Vision)

## Context

AskAlf agents (Anvil, Backend Dev, Frontend Dev, DevOps) write code during their execution cycles. Currently, changes are applied directly with no peer review. This creates risk:

- No validation that agent-written code is correct before deployment
- No second opinion on architectural decisions made during execution
- Prompt revisions (`forge_prompt_revisions`) are proposed but never surfaced for review
- The QA Engineer → Backend Dev repair loop works ad-hoc but isn't formalized

The system already has building blocks for a review pipeline:
- **`forge_prompt_revisions`** — agents can propose prompt changes (pending → approved → applied)
- **`forge_checkpoints`** — approval gates with polling and timeout
- **`intervention_ops`** — human escalation via `agent_interventions` table
- **`git-review.ts`** — routes for branch diff, log, merge, files
- **`coordination_sessions` / `coordination_tasks`** — multi-agent task orchestration
- **`forge_audit_log`** — immutable action logging

## Decision

Build a **Change Proposal** system that generalizes `forge_prompt_revisions` to all agent-produced changes. Implement a PR-like review workflow: **propose → assign reviewers → review → approve/reject → apply**.

## Architecture

### 1. New Table: `forge_change_proposals`

Extends the prompt revision concept to all change types.

```sql
CREATE TABLE forge_change_proposals (
  id              TEXT PRIMARY KEY,           -- ulid
  proposal_type   TEXT NOT NULL,              -- 'prompt_revision' | 'code_change' | 'config_change' | 'schema_change'
  title           TEXT NOT NULL,              -- human-readable summary
  description     TEXT,                       -- detailed reasoning
  author_agent_id TEXT NOT NULL REFERENCES forge_agents(id),

  -- Change content (one of these populated based on proposal_type)
  prompt_revision_id TEXT REFERENCES forge_prompt_revisions(id),  -- link to existing revision
  file_changes    JSONB DEFAULT '[]',         -- [{path, action: add|modify|delete, old_content, new_content, diff}]
  config_changes  JSONB DEFAULT '{}',         -- {key: {old, new}} for agent config

  -- Target
  target_agent_id TEXT REFERENCES forge_agents(id),  -- for prompt/config changes
  target_branch   TEXT DEFAULT 'main',        -- for code changes

  -- Workflow state
  status          TEXT NOT NULL DEFAULT 'draft',  -- draft → pending_review → approved → applied → closed | rejected
  required_reviews INTEGER NOT NULL DEFAULT 1,
  risk_level      TEXT NOT NULL DEFAULT 'low',    -- low | medium | high | critical

  -- Execution context
  execution_id    TEXT REFERENCES forge_executions(id),  -- which execution proposed this
  checkpoint_id   TEXT REFERENCES forge_checkpoints(id), -- approval gate (for high-risk)

  -- Timestamps
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_at      TIMESTAMPTZ,
  closed_at       TIMESTAMPTZ
);

CREATE INDEX idx_proposals_status ON forge_change_proposals(status);
CREATE INDEX idx_proposals_author ON forge_change_proposals(author_agent_id);
CREATE INDEX idx_proposals_target ON forge_change_proposals(target_agent_id);
```

### 2. New Table: `forge_proposal_reviews`

Tracks individual reviews on a proposal.

```sql
CREATE TABLE forge_proposal_reviews (
  id              TEXT PRIMARY KEY,           -- ulid
  proposal_id     TEXT NOT NULL REFERENCES forge_change_proposals(id),
  reviewer_agent_id TEXT NOT NULL REFERENCES forge_agents(id),

  verdict         TEXT NOT NULL,              -- 'approve' | 'reject' | 'request_changes' | 'comment'
  comment         TEXT,                       -- review feedback
  suggestions     JSONB DEFAULT '[]',         -- [{file, line, suggestion}] inline suggestions

  -- Automated analysis results (populated by reviewer tooling)
  analysis        JSONB DEFAULT '{}',         -- {typecheck: pass/fail, complexity: {}, security: {}}

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_reviews_proposal ON forge_proposal_reviews(proposal_id);
CREATE INDEX idx_reviews_reviewer ON forge_proposal_reviews(reviewer_agent_id);
```

### 3. Reviewer Assignment Matrix

Which agents review which types of changes:

| Change Type | Primary Reviewer | Secondary Reviewer | Human Gate? |
|---|---|---|---|
| `prompt_revision` | Meta | Architect | Yes (always) |
| `code_change` (backend) | QA Engineer | Architect | If risk >= high |
| `code_change` (frontend) | QA Engineer | Frontend Dev | If risk >= high |
| `code_change` (infra) | DevOps | Architect | If risk >= high |
| `config_change` | Nexus | - | If autonomy_level change |
| `schema_change` | Backend Dev | Architect | Yes (always) |

**Risk level auto-classification:**
- **low**: Comment changes, documentation, non-functional edits
- **medium**: New functions, new routes, UI changes
- **high**: Database schema changes, auth/security changes, agent config changes
- **critical**: System prompt modifications, deployment config, autonomy level changes

### 4. Workflow State Machine

```
  draft ──────→ pending_review ──────→ approved ──────→ applied
    │                │                     │
    │                ├──→ rejected          │
    │                │                     └──→ closed (rollback)
    │                └──→ revision_requested
    │                          │
    └──────────────────────────┘  (author revises, resubmits)
```

**Transitions:**
- `draft → pending_review`: Author calls `submit_proposal`. Reviewer assignment runs.
- `pending_review → approved`: All required reviews are approvals. If human gate required, checkpoint created.
- `pending_review → rejected`: Any reviewer rejects with justification.
- `pending_review → revision_requested`: Reviewer requests changes. Author notified via ticket.
- `approved → applied`: Changes applied (prompt update, git merge, config write). Audit logged.
- `applied → closed`: Rollback triggered (revert prompt, revert commit).

### 5. New MCP Tool: `proposal_ops`

Exposed to agents via the MCP tool registry.

```typescript
// Actions available to agents:
{
  action: 'create',      // Create a change proposal
  // Required: proposal_type, title, description
  // + type-specific: file_changes | prompt_revision_id | config_changes

  action: 'submit',      // Submit for review (draft → pending_review)
  // Required: proposal_id

  action: 'review',      // Submit a review verdict
  // Required: proposal_id, verdict, comment
  // Optional: suggestions, analysis

  action: 'list',        // List proposals with filters
  // Optional: status, author_agent_id, reviewer_agent_id, proposal_type

  action: 'get',         // Get proposal details with reviews
  // Required: proposal_id

  action: 'apply',       // Apply an approved proposal
  // Required: proposal_id
  // Requires: status === 'approved', human checkpoint cleared if needed

  action: 'revise',      // Update a proposal after revision_requested
  // Required: proposal_id + updated fields
}
```

### 6. Integration Points

#### A. With Existing Prompt Revisions
The `prompt-rewriter.ts` proposePromptRevision() function is modified to:
1. Create the revision in `forge_prompt_revisions` as before
2. **Also** create a `forge_change_proposals` record with `proposal_type: 'prompt_revision'`
3. Auto-submit for review (triggers reviewer assignment)

This means existing prompt revision infrastructure continues to work, but now gets review coverage.

#### B. With Checkpoints
When a proposal is approved and `risk_level >= 'high'`:
1. A `forge_checkpoint` is created (type: 'approval')
2. The apply step blocks until checkpoint is responded to
3. Human approves or rejects via dashboard checkpoint UI

#### C. With Coordination
When a proposal needs multi-agent review:
1. A `coordination_session` (pattern: 'fan-out') is created
2. Each reviewer gets a `coordination_task`
3. Reviews collected in parallel
4. Session completes when all reviews submitted

#### D. With Audit Log
Every state transition writes to `forge_audit_log`:
- `proposal.created`, `proposal.submitted`, `proposal.reviewed`
- `proposal.approved`, `proposal.rejected`, `proposal.applied`
- Full before/after state captured in `details` JSONB

#### E. With Dashboard
New routes needed in forge (admin routes):
- `GET /api/v1/admin/proposals` — list with filters
- `GET /api/v1/admin/proposals/:id` — detail with reviews and diff
- `POST /api/v1/admin/proposals/:id/respond` — human approve/reject

New dashboard pages:
- **Proposals List** — table of pending/approved/applied proposals
- **Proposal Detail** — side-by-side diff, review comments, approve/reject buttons
- **Review Queue** — agent-specific view of proposals awaiting their review

### 7. Agent Execution Integration

During a build cycle, when an agent (e.g., Anvil) writes code:

**Current flow:**
```
Agent executes → writes files directly → done
```

**New flow (for non-trivial changes):**
```
Agent executes → creates change proposal with diffs → submits for review
→ reviewers analyze → approve/reject → if approved, changes applied via git
```

**Opt-in behavior:** Not all changes need review. Agents use `proposal_ops.create` when:
- Modifying another agent's prompt (always)
- Changing database schema (always)
- Writing new API routes or modifying existing ones (when risk >= medium)
- Modifying deployment/infra config (always)

Low-risk changes (adding comments, fixing typos, updating docs) can bypass the pipeline.

### 8. Review Automation

Reviewer agents don't just rubber-stamp. When assigned a review, they:

1. **Read the diff** — full file_changes from the proposal
2. **Run code_analysis** — typecheck the changed files, check complexity
3. **Run security_scan** — check for OWASP issues in new code
4. **Check architectural alignment** — does this follow existing patterns?
5. **Post review** — verdict + comments + automated analysis results

This creates the **evaluator-optimizer loop** identified as a gap by Scout:
```
Builder (Anvil) proposes → Reviewer (QA) evaluates →
  if rejected: Builder revises → Reviewer re-evaluates → ...
  if approved: Apply changes
```

## Migration Plan

### Phase 1: Schema & Tool (Backend Dev — ~2 hours)
1. Create migration: `forge_change_proposals` + `forge_proposal_reviews` tables
2. Implement `proposal_ops` MCP tool (create, submit, review, list, get, apply, revise)
3. Add admin routes for proposals
4. Wire into audit log

### Phase 2: Prompt Revision Integration (Backend Dev — ~1 hour)
1. Modify `prompt-rewriter.ts` to create proposals alongside revisions
2. Bridge existing `forge_prompt_revisions.status` with proposal status
3. Backfill any pending revisions as proposals

### Phase 3: Review Assignment Engine (Backend Dev — ~1 hour)
1. Implement reviewer assignment based on change type matrix
2. Create coordination session for multi-reviewer proposals
3. Add notification mechanism (ticket creation for reviewers)

### Phase 4: Dashboard UI (Frontend Dev — ~3 hours)
1. Proposals list page with status filters
2. Proposal detail page with diff viewer (side-by-side)
3. Review submission form (approve/reject/request changes + comments)
4. Integration into existing navigation

### Phase 5: Agent Integration (Anvil + QA — ~2 hours)
1. Update builder agents to use `proposal_ops.create` for non-trivial changes
2. Update QA Engineer to handle review assignments automatically
3. Test the full loop: propose → review → approve → apply

## Consequences

### Positive
- Every significant agent change gets peer review before application
- Human oversight via checkpoint gates on high-risk changes
- Full audit trail of who proposed what, who reviewed, why approved/rejected
- Formalizes the QA→Builder repair loop into a reusable pattern
- Builds on existing infrastructure (checkpoints, interventions, coordination)

### Negative
- Adds latency to the change pipeline (review takes time)
- Increases execution cost (reviewer agents consume tokens)
- Requires agents to learn new tool (`proposal_ops`)

### Mitigations
- Low-risk changes bypass the pipeline entirely
- Parallel fan-out reviews minimize latency
- Review automation reduces human burden
- Gradual rollout: start with prompt revisions only, expand to code changes

## Alternatives Considered

### A. Git-native PR workflow
Use actual git branches and PRs. Rejected because:
- Agents don't have persistent git auth
- GitHub PR API adds external dependency
- Internal proposals give us more control over the workflow

### B. Extend forge_prompt_revisions for all changes
Add columns to existing table. Rejected because:
- Table is specifically scoped to prompt changes
- New table is cleaner and doesn't break existing prompt revision code
- Separate concerns: proposals are the workflow, revisions are the content

### C. Human-only review
All changes go through human checkpoints. Rejected because:
- Doesn't scale — 16 agents generating changes
- Agent reviewers catch most issues automatically
- Humans still gate high-risk changes via checkpoints
