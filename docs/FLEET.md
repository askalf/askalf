# AskAlf Fleet — 14 Autonomous Agents

The fleet runs 24/7 across two compute nodes. Fleet Chief evolves the system continuously.

## Architecture

```
         ┌─────────────┐
         │ Fleet Chief  │  Evolves prompts, schedules, models
         │  Sonnet / 4  │  Creates new agents when gaps found
         │   6hr/REMOTE │  Self-improving
         └──────┬───────┘
                │
    ┌───────────┼───────────┐
    ▼           ▼           ▼
 DETECT      EXECUTE      SERVE
 Watchdog    Builder     Discord Mgr
 Plt Tester  Release Mgr GitHub Mgr
 Security    Backup      Social Mgr
 Analytics   Cost Opt    Landing Pg
             KB Writer
```

## Agents

| Agent | Type | Model | Schedule | Node | Purpose |
|-------|------|-------|----------|------|---------|
| Fleet Chief | monitor | Sonnet | 6hr | REMOTE | Meta-agent: evolves fleet, improves prompts, creates agents |
| Builder | dev | Sonnet | tickets | REMOTE | Fixes tickets from monitors, patches code |
| Release Manager | dev | Sonnet | manual | LOCAL | Coordinates full release pipeline |
| Watchdog | monitor | Sonnet | 30min | LOCAL | Patrols 12 systems: containers, Cloudflare, certs, DB, fleet |
| Platform Tester | monitor | Sonnet | 2hr | LOCAL | End-to-end tests across all systems |
| Security | security | Sonnet | 6hr | LOCAL | Dependency audits, CVE checks, config review |
| Analytics Tracker | monitor | Haiku | 12hr | REMOTE | GitHub/npm/Docker metrics, weekly reports |
| Cost Optimizer | monitor | Haiku | 12hr | REMOTE | Spending analysis, model routing recommendations |
| Backup Agent | monitor | Haiku | daily | LOCAL | Database backups, stale data cleanup |
| Knowledge Base Writer | content | Sonnet | daily | REMOTE | Creates docs from user questions |
| Discord Manager | worker | Sonnet | 30min | REMOTE | Community management, welcomes, Q&A |
| GitHub Manager | worker | Sonnet | 1hr | REMOTE | Issue triage, PR review, community response |
| Social Media Manager | worker | Sonnet | 12hr | REMOTE | Twitter/X content and engagement |
| Landing Page Manager | worker | Sonnet | daily | REMOTE | askalf.org content via Cloudflare Pages |

## Autonomous Loops

- **Detect → Fix → Verify** (30min): Watchdog detects → Builder fixes → Watchdog confirms
- **Evolve** (6hr): Fleet Chief analyzes performance → improves one agent → checks results
- **Community** (30min-1hr): Discord/GitHub auto-respond to users
- **Content** (daily): KB Writer + Landing Page Manager keep docs current
- **Cost** (12hr): Optimizer finds savings → tickets for changes
- **Analytics** (12hr): Track growth → weekly Discord reports
- **Backup** (daily): pg_dump + cleanup

## Compute Nodes

| Node | Specs | Agents |
|------|-------|--------|
| LOCAL (forge container) | Docker access, Postgres, Redis | 5 agents |
| ALF-PROD-DOCKER | i7-4770, 8 cores, 16GB RAM, Claude CLI | 9 agents |
