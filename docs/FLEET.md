# AskAlf Fleet — Self-Growing Autonomous Agents

The fleet runs 24/7 as a self-healing organism. Agents communicate through a nervous system, build collective memory, and form immune response teams when things break.

## Architecture

```
                 ┌─────────────┐
                 │ Fleet Chief  │  Evolves prompts, schedules, models
                 │  Sonnet / 4  │  Creates new agents when gaps found
                 │   6hr        │  Self-improving
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

## Systems

### Nervous System (v2.9.0)
Agents communicate directly through a message bus. Message types: request, inform, consult, signal, handoff. Signals: confidence, urgency, stuck, success, overloaded, idle. Fleet Chief auto-intervenes on critical signals.

### Collective Memory (v2.9.0)
Shared knowledge graph grown by every execution. Node types: concept, entity, event, pattern, decision, outcome. Edge types: causes, fixes, relates_to, depends_on, precedes.

### Immune System (v2.9.5)
When something breaks: Detection → Triage → Mobilize → Fix → Verify → Immunize. Response teams form automatically. Antibodies prevent recurrence.

### Dream Cycles (v2.8.0)
2-6am UTC: replay executions, extract patterns, consolidate memories, generate predictions, create pre-emptive tickets.

### The Watcher (v2.8.0)
Learns user patterns. After 2 weeks, pre-runs tasks 30 minutes before expected request time.

## Agents

| Agent | Model | Schedule | Purpose |
|-------|-------|----------|---------|
| Fleet Chief | Sonnet | 6hr | Meta-agent: evolves fleet, improves prompts, creates agents |
| Builder | Sonnet | 2hr (tickets) | Fixes tickets from monitors, patches code |
| Watchdog | Haiku | 30min | Patrols 12 systems |
| Platform Tester | Haiku | 2hr | End-to-end tests |
| Security | Sonnet | 6hr | Dependency audits, CVE checks |
| Analytics Tracker | Haiku | 12hr | GitHub/npm/Docker metrics |
| Cost Optimizer | Haiku | 12hr | Spending analysis |
| Backup Agent | Haiku | daily | Database backups |
| Knowledge Base Writer | Sonnet | daily | Creates docs |
| Discord Manager | Haiku | 2hr | Community management |
| GitHub Manager | Haiku | 2hr | Issue triage, PR review |
| Social Media Manager | Sonnet | 12hr | Twitter/X content |
| Landing Page Manager | Haiku | daily | askalf.org updates |
| Release Manager | Sonnet | manual | Release pipeline |

## Autonomous Loops

- **Detect → Fix → Verify** (30min): Watchdog → Builder → Watchdog
- **Evolve** (6hr): Fleet Chief analyzes → improves one agent
- **Immune** (15min): Scan failures → form response team → antibody
- **Dream** (2-6am): Replay → patterns → predict → immunize
- **Predict** (5min): Watcher pre-runs based on user patterns

## Cost Profile

~$5-7/day with Haiku for monitors, Sonnet for workers.
