# Dependency Audit Report

**Date**: 2026-03-21
**Auditor**: Security Agent
**Ticket**: tkt_overnight_05

## Critical Findings

### 1. Zod Version Split (CRITICAL)

The monorepo has **two incompatible zod versions** running simultaneously:
- **Root** devDeps: `zod ^4.3.6` → resolves to **4.3.6**
- **apps/forge**, **packages/auth**, **packages/core**: `zod ^3.23-3.24` → resolves to **3.25.76**

The lockfile shows two separate resolution trees — e.g., `openai` is instantiated twice with different zod versions. Schemas created in one context will NOT validate if passed across the boundary.

**Action**: Standardize on zod 4.x across all packages, or pin everything to 3.x until migration is complete.

### 2. bcryptjs 2.4.3 → 3.0.3 (CRITICAL)

Password hashing library in `apps/forge` was published **February 2017** (9 years old). Version 3.0.0+ released November 2025 with security hardening.

**Action**: Upgrade bcryptjs to ^3.0.3 in apps/forge.

### 3. openai SDK v4.104.0 → v6.32.0 (HIGH)

**2 major versions behind**. v5/v6 introduced breaking API changes. Old SDK versions get deprecated on a rolling basis; new model features may only be available in latest SDK.

**Action**: Plan migration to openai v6 in forge and mcp-tools. Requires code changes.

### 4. vite v5.4.21 → v8.0.1 (HIGH)

**3 major versions behind**. Lockfile resolves to 5.4.21 despite package.json specifying `^6.0.7` — lockfile is stale. Build tools accumulate security fixes for dev server CORS and SSR vulnerabilities.

**Action**: Regenerate lockfile, then plan migration to vite 8.x.

## Medium Findings

### 5. Dashboard Client Not in pnpm Workspace

`apps/dashboard/client` is not included in the pnpm workspace (workspace yaml covers `apps/*` and `packages/*`, not `apps/*/client`). Its dependencies are **completely unmanaged** by the monorepo lockfile — no reproducibility for the frontend build.

**Action**: Add `apps/dashboard/client` to pnpm-workspace.yaml or create a nested lockfile.

### 6. postgres-migrations Unmaintained

v5.3.0 last published **July 2021** (~5 years ago). Relying on an unmaintained migration runner is risky if PostgreSQL introduces breaking changes.

**Action**: Evaluate `node-pg-migrate` or `graphile-migrate` as replacements.

### 7. nodemailer v7.0.12 → v8.0.3

One major version behind. v8 likely includes TLS handling improvements.

**Action**: Upgrade in packages/email.

### 8. react v18.3.1 → v19.2.4

One major version behind in dashboard client. Lower priority given the client workspace issue above.

### 9. ulid v2.4.0 → v3.0.2

One major version behind. Used in forge, auth, and core.

**Action**: Evaluate upgrade to ulid 3.x.

## Low Findings

### 10. pino v9.14.0 → v10.3.1

One major version behind. v9 still maintained.

## Structural Observations

### @askalf/database vs @askalf/db — Intentional but Confusing

- `@askalf/database` (packages/database): Full ORM/migration layer. Used by dashboard, auth.
- `@askalf/db` (packages/db): Lightweight connection pool wrapper for MCP. Used by mcp-tools.

Both depend on `pg` separately. Consider consolidating or renaming `@askalf/db` to `@askalf/db-pools` for clarity.

### Workspace Cross-References

All `@askalf/*` workspace packages are properly cross-referenced via `workspace:*`:
- forge → @askalf/email, @askalf/observability
- dashboard → @askalf/auth, @askalf/database, @askalf/email, @askalf/observability
- mcp-tools → @askalf/db, @askalf/observability
- auth → @askalf/core, @askalf/database
- email → @askalf/core, @askalf/observability
- database → @askalf/core

### Overrides (Good Practice)

Root package.json applies security overrides for: fast-xml-parser, qs, fastify, ajv, diff, esbuild, rollup. This shows awareness of supply chain risks.

### Duplicate Dependencies

| Package | Used In |
|---------|---------|
| pg ^8.20.0 | root, forge, dashboard (via database), db |
| ioredis ^5.10.1 | forge, dashboard, db |
| typescript ^5.7.0 | all packages (expected) |
| zod ^3.x / ^4.x | **VERSION SPLIT — see finding #1** |

No unnecessary duplicates detected beyond the zod split.

## Priority Action Items

| Priority | Item | Effort |
|----------|------|--------|
| CRITICAL | Resolve zod 3/4 version split | Medium |
| CRITICAL | Upgrade bcryptjs to 3.x | Low |
| HIGH | Plan openai SDK v4→v6 migration | High |
| HIGH | Fix stale vite lockfile, plan v8 migration | Medium |
| MEDIUM | Add dashboard/client to workspace | Low |
| MEDIUM | Replace postgres-migrations | Medium |
| MEDIUM | Upgrade nodemailer to v8 | Low |
| MEDIUM | Upgrade ulid to v3 | Low |
| LOW | Upgrade pino to v10 | Low |
| LOW | Upgrade react to v19 | Medium |
