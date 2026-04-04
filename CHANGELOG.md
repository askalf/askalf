# Changelog

All notable changes to AskAlf are documented here.

## [2.9.9] — 2026-04-02 — Standalone Mode + Natural Selection

### Added
- **Standalone Mode** — `npx create-askalf` runs the full platform without Docker. PGlite (in-process PostgreSQL via WASM) replaces Postgres. In-memory cache replaces Redis. Single Node.js process.
- **Database Adapter** — `@askalf/database-adapter` package. Dual-mode: PGlite for standalone, pg for Docker. Zero SQL rewrites.
- **Redis Adapter** — `@askalf/redis-adapter` package. In-memory Map/EventEmitter replaces Redis in standalone mode. Full pub/sub, hashes, sorted sets.
- **In-Memory Job Queue** — Replaces BullMQ in standalone mode. Same retry/backoff behavior.
- **Desktop App** — Tauri wrapper with system tray. Spawns standalone server as sidecar. (Foundation — build pipeline in progress)
- **create-askalf CLI** — Interactive setup wizard. Generates secrets, configures AI providers, starts server.
- **Natural Selection** — Evolutionary pressure on the fleet. Top performers promoted, underperformers retrained.
- **Federation Handshake** — Cross-instance discovery endpoint for future multi-fleet intelligence.
- **The Organism Tab** — Real-time dashboard visualization: neural canvas, vital signs, systems status, autonomous decision feed.

### Changed
- Codebase reduced from 145K to 31K lines — removed all dead SaaS code, old brand references, stale scripts
- Git history squashed to 17 clean commits — no AI attribution, no old brand names
- All 6 Redis consumers wired for dual-mode (ioredis / in-memory adapter)
- All 3 database consumers wired for dual-mode (pg / PGlite adapter)
- Comparison table now includes Claude column and "No Docker required" row
- Demo responses lighter — conversational tone, no markdown walls
- Demo fleet panel dynamically shows agents proposed by Alf

### Fixed
- Dashboard Docker build — removed 50+ dead SaaS pages, components, stores
- `forge_knowledge_nodes` missing `access_count`, `confidence`, `content` columns
- Manual agent run missing `owner_id` in execution insert
- Discord bot token not loading into container (Docker Compose v5 requires explicit `env_file`)
- Rate limiter using `Math.random()` — switched to `crypto.randomBytes`

## [2.9.5] — 2026-03-31 — The Immune System

### Added
- **Immune System** — Self-healing response teams. Detects repeated failures, forms agent response teams, creates antibodies after resolution
- **Nervous System** — Agent-to-agent messaging (request, inform, consult, signal, handoff). Signal board: confidence, urgency, stuck, overloaded
- **Collective Memory** — Shared knowledge graph grown by every execution. Concepts, patterns, decisions linked automatically
- **Antibodies** — Procedural memories that prevent issue recurrence. Strengthen when patterns re-match
- **Incident API** — `/api/v1/forge/incidents`, `/api/v1/forge/antibodies`, `/api/v1/forge/nervous-system`
- Post-execution signal emission and knowledge extraction on every agent run
- Fleet awareness includes signals and knowledge graph stats

## [2.8.0] — 2026-03-29 — The Self-Evolving Release

### Added
- **Dream Cycles** — Overnight fleet learning: replay executions, extract patterns, write procedural memories, generate predictions (2-6am UTC)
- **The Watcher** — Learns user patterns, pre-runs tasks 30 minutes before you ask
- **Webhook Triggers** — GitHub push/issue/PR fire agents. Custom webhooks with HMAC verification
- **Team Collaboration** — Invite members to workspaces with role-based access (admin/member/viewer)
- **Agent Reputation Economy** — Scores: completion rate, cost efficiency, consistency, resolution quality. Updated every 2 hours
- **Cross-Instance Federation** — Anonymized learning between AskAlf instances (opt-in)
- **Builder Auto-PR Pipeline** — Agent code changes push branches, create PRs. Auto-merge for autonomy >= 3
- **Dashboard**: Reputation scores in Fleet tab, Webhooks settings, Team management, Cost projections
- **9-step onboarding wizard** with workspace type selection, team reveal animation, first task trial
- **demo.askalf.org** — Anonymous demo SPA on Cloudflare Pages with budget-capped sessions

## [2.7.0] — 2026-03-27 — 14-Agent Autonomous Fleet

### Added
- **Fleet Chief** — Meta-agent (autonomy 4) that evolves the fleet: rewrites prompts, adjusts schedules, creates agents
- **Builder** — Picks up tickets from monitors and fixes them autonomously
- **14-agent fleet** across 2 compute nodes (9 remote, 5 local)
- Analytics Tracker, Cost Optimizer, Backup Agent, Knowledge Base Writer
- Live execution stream tab in dashboard
- Distributed execution via WebSocket bridge

## [2.6.0] — 2026-03-27 — Multi-Tenant Workspaces

### Added
- Multi-tenant workspaces with tenant switching
- Agent CLI v2.6.0 — Windows service runs hidden via PowerShell
- OAuth credential sync to remote devices
- Security hardening across all containers

## [2.5.0] — 2026-03-26 — Remote Execution

### Added
- Remote device execution via WebSocket agent bridge
- Smart execution routing (Claude CLI / shell / auto)
- Shell fallback for non-Claude tasks
- Agent CLI `install-service` command (systemd/launchd/Windows)
- Capabilities scan on device registration

## [2.4.0] — 2026-03-26 — Onboarding & Reports

### Added
- Scheduled reports (daily/weekly) to Discord webhook or email
- Save as Template — one-click from Fleet detail panel
- Onboarding wizard with Ollama detection and use-case provisioning
- Schema cleanup: api_keys view, forge_preferences, usage_count tracking

## [2.3.0] — 2026-03-25 — Device Bridge & Daily Releases

### Added
- Agent CLI (@askalf/agent) — connect any device to the fleet
- Device bridge via WebSocket with heartbeat and auto-reconnect
- Budget enforcement (global daily/monthly limits)
- Marketplace overhaul — import/export tool bundles
- Ollama model quick-pull
- Daily release cadence

## [2.2.0] — 2026-03-24 — Security & Memory

### Added
- Brain tab with semantic vector search via pgvector
- Teach Alf — store facts directly from dashboard
- Docker hardening — CPU limits, read-only mounts, credential encryption
- 155 search engines via SearXNG + VPN
- 8 CodeQL fixes
- 70 tools (44 forge + 26 MCP)

## [2.1.0] — 2026-03-23 — Launch

### Added
- Initial public release
- 109 worker templates across 16 categories
- 16 communication channels
- Persistent memory system (semantic, episodic, procedural)
- Knowledge graph with 1,500+ nodes
- Unified dispatcher with ticket-driven execution
- Self-hosted deployment via Docker Compose
