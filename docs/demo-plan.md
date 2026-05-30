# askalf Demo Strategy — Operator Decision Document

**Status:** Draft for operator review  
**Authored by:** Studio Ops, 2026-05-30  
**Parent ticket:** BUILDOUT-18  
**Acceptance gates this doc must satisfy:**
- [ ] Operator picks one of the two demo approaches below (or explicitly defers)
- [ ] Code team removes dead `demo.askalf.org` links (ticket 00MPRMEJSZF733A42AC7C55028)
- [ ] This file committed to repo at `docs/demo-plan.md`

---

## 1. Problem Statement

`CLAUDE.md` mandates a converting demo at `demo.askalf.org`. No demo surface exists today:

| Thing | Status |
|---|---|
| `demo.askalf.org` subdomain | Resolves to 404 (no deployment) |
| `demo` / `demo-worker` repos | **ARCHIVED** |
| `platform/README.md` | Honestly states: "Public demo: Not yet" |
| `packages/create-askalf/README.md:87` | 💀 Ships `Try the demo: https://demo.askalf.org` |
| `packages/create-askalf/src/index.ts:250` | 💀 Ships `Try the demo: https://demo.askalf.org` (CLI `doctor` no-install path) |

Every developer who runs `npx create-askalf` and hits `--doctor` sees a dead link. That is an active trust problem, not a future gap.

---

## 2. Hard Constraints (non-negotiable)

From `CLAUDE.md`:

> Demo traffic **must** route through a Cloudflare Worker at `demo-api.askalf.org` — **NOT** the production backend.

This means:
- The demo cannot simply point at the live forge API.
- Any sandboxed or interactive demo needs a CF Worker proxy as its backend.
- A read-only tour that hits zero backend is exempt from this constraint.

---

## 3. Options

### Option A — Read-Only Fleet/Dashboard Tour (lower lift, faster)

**What it is:** A static or lightly-interactive walkthrough of what the Askalf dashboard looks like with a pre-populated fake dataset. Think: recorded UI tour, a Framer/Figma prototype, or a hardcoded Next.js page at `demo.askalf.org` fed by fixture JSON.

**What it is not:** A real agent execution environment. Users browse, they don't run.

**Pros:**
- No CF Worker infra needed (no backend calls)
- Can ship in 1–2 dev days
- Zero risk of demo traffic touching production
- Satisfies CLAUDE.md's "converting demo" intent — most PLG demos are guided tours

**Cons:**
- Not interactive / not "try it yourself"
- May feel lightweight vs. competitor live demos
- Needs ongoing updates as UI evolves

**Infra needed:** Cloudflare Pages deployment of a static demo app (new repo, no worker)

---

### Option B — Sandboxed Try-It (higher lift, higher conversion)

**What it is:** A real Askalf environment with scoped permissions — user logs in (or enters a guest token), gets a demo tenant with pre-seeded agents/projects, can kick off one or two pre-approved execution flows against `demo-api.askalf.org`.

**What it is not:** Access to the real forge backend or other tenants' data.

**Pros:**
- Genuine "wow, it actually works" conversion moment
- Directly proves the product's core value prop
- Satisfies CLAUDE.md literally (live demo, CF Worker-gated)

**Cons:**
- Requires the CF Worker at `demo-api.askalf.org` to be built and deployed
- Needs a sandboxed tenant model (demo users must not bleed into prod)
- Significant infra scope: worker, demo tenant seeding, quota enforcement, cost management
- 2–6 week effort depending on existing tenant isolation maturity

**Infra needed:**
1. CF Worker: `demo-api.askalf.org` — request proxy + tenant scoping
2. Demo tenant: pre-seeded agents, projects, canned executions
3. Guest auth or invite-code flow
4. Execution quota limits (prevent abuse)
5. Cost tracking for demo workloads (separate from prod billing)

---

## 4. Operator Decisions Required

Answer these before any demo work begins:

| # | Decision | Options |
|---|---|---|
| 1 | **Which approach?** | Option A (tour) or Option B (sandboxed) |
| 2 | **Timeline priority?** | "Ship something in 2 weeks" → forces Option A; "Do it right" → Option B |
| 3 | **Guest access model?** (Option B only) | Open (anyone) / invite-code / signup-wall |
| 4 | **Execution types to demo?** (Option B only) | Canned only / any user-defined / limited to safe agent types |
| 5 | **Demo cost cap?** (Option B only) | Monthly budget for demo executions before CF Worker throttles |
| 6 | **Subdomain ownership** | Is `demo-api.askalf.org` already routed? Who manages DNS? |

---

## 5. Immediate Action (unblocked)

**Remove the dead links now.** Not blocked on any operator decision.

Files:
- `packages/create-askalf/README.md:87`
- `packages/create-askalf/src/index.ts:250`

Tracked in ticket 00MPRMEJSZF733A42AC7C55028.

---

## 6. Recommended Path

**Phase 1 (now, ~2 days):**
- Remove dead links (ticket filed)
- Commit this doc to repo
- Operator answers §4 decisions

**Phase 2 (after operator decision):**
- Option A → Frontend Dev scopes + builds the tour page
- Option B → Backend Dev scopes CF Worker + sandboxed tenant model; Studio Ops drafts project scope + budget

---

## 7. Out of Scope

- Deploying a "fake" demo that misrepresents the product
- Exposing the production forge API to unauthenticated demo traffic
- Rebuilding the archived `demo` / `demo-worker` repos without an operator greenlight

---

*Revisit after operator decisions in §4 are answered.*
