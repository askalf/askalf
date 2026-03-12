# AskAlf

**Self-hosted AI agent platform.** Deploy a fleet of AI agents that research, code, monitor, and automate — running on your own infrastructure.

[![PR Checks](https://github.com/askalf/askalf/actions/workflows/pr-checks.yml/badge.svg)](https://github.com/askalf/askalf/actions/workflows/pr-checks.yml)
[![Main Branch Build](https://github.com/askalf/askalf/actions/workflows/main-branch.yml/badge.svg)](https://github.com/askalf/askalf/actions/workflows/main-branch.yml)

## Quick Start

```bash
git clone https://github.com/askalf/askalf.git
cd askalf

# Generate secrets and create .env
./setup.sh

# Edit .env — add your API key
nano .env

# Start everything
docker compose -f docker-compose.selfhosted.yml up -d

# Open http://localhost:3001
```

## What It Does

AskAlf gives you a team of AI agents with real capabilities:

- **14 Skills** — Research, security scanning, code review, content writing, monitoring, data analysis, and more
- **Agent Chat** — Talk to agents naturally, they pick the right skills automatically
- **Fleet Orchestration** — Fan-out tasks, pipeline workflows, consensus patterns
- **24 Built-in Tools** — Database queries, Docker control, web search, code analysis, team coordination (MCP)
- **Multi-Provider** — Anthropic, OpenAI, Google. Switch per-agent, per-task
- **Cost Control** — Per-agent budgets, execution caps, real-time tracking
- **Terminal** — Built-in Claude Code CLI with full workspace access
- **22 Integrations** — GitHub, AWS, Jira, Datadog, Vercel, and more
- **5 Channels** — Slack, Discord, Telegram, WhatsApp, webhooks

## Skills

Skills are markdown files in the `skills/` directory. Each skill defines an agent's capabilities:

```markdown
---
name: Competitor Research
slug: competitor-research
category: research
model: claude-sonnet-4-6
max_iterations: 15
max_cost: 0.50
tools:
  - web_search
  - web_browse
  - memory_store
---

# Competitor Research

You are a competitive research analyst...
```

Create your own skills by adding `.md` files to `skills/`. They sync automatically on startup.

### Built-in Skills

| Category | Skills |
|----------|--------|
| Research | Competitor Research, SEO Analyzer |
| Security | Security Scanner, Dependency Auditor |
| Build | QA Code Review, Frontend Dev, Backend Dev, API Tester |
| Automate | Content Writer, Release Notes Generator |
| Monitor | System Monitor, Incident Responder |
| Analyze | Data Analyst, Performance Profiler |

## Agent Fleet

### User-Facing Agents (6)
- **Researcher** — Web research, competitor analysis, SEO
- **Sentinel** — Security scanning, dependency auditing
- **Developer** — Code review, testing, full-stack dev
- **Writer** — Content, docs, release notes
- **Watchdog** — System monitoring, incident response
- **Analyst** — Data analysis, performance profiling

### Internal Agents (5, ticket-gated)
- **Frontend Dev** — React/UI work
- **Backend Dev** — API/DB/server work
- **Infra** — DevOps, Docker, deployments
- **QA** — Testing, code quality
- **Security** — Scanning, vulnerability detection

## Architecture

```
┌─────────────────────────────────────────┐
│  Dashboard (3001) — React SPA + Fastify │
│  Forge (3005) — Agent Orchestration     │
│  MCP-Tools (3010) — 24 Agent Tools      │
├─────────────────────────────────────────┤
│  PostgreSQL 17 + pgvector               │
│  Redis (event bus, caching)             │
│  SearXNG (web search, no API keys)      │
│  Docker Proxy (container management)    │
└─────────────────────────────────────────┘
```

7 containers. `docker compose up` and you're running.

## Configuration

All configuration lives in `.env`. See `.env.example` for all options.

### Required
- `ADMIN_EMAIL` / `ADMIN_PASSWORD` — Your login credentials
- At least one AI API key (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `GOOGLE_AI_KEY`)

### Optional
- **Integrations** — Add API keys for GitHub, AWS, Jira, etc. to enable them in Settings
- **Channels** — Add bot tokens for Slack, Discord, Telegram to receive agent messages
- **OAuth** — Connect your Claude subscription for agent CLI execution

## Project Structure

```
askalf/
├── apps/
│   ├── forge/        # Agent orchestration engine (Fastify)
│   ├── dashboard/    # React SPA + Fastify server
│   └── mcp-tools/    # 24 MCP tools for agent capabilities
├── packages/
│   ├── core/         # Shared types, validation, ulid
│   ├── database/     # PostgreSQL client, migrations
│   ├── auth/         # Session authentication
│   ├── observability/ # Logging, metrics
│   └── email/        # Email service
├── skills/           # Markdown skill definitions
├── infrastructure/   # SearXNG, Redis configs
└── scripts/          # Build, deploy scripts
```

## Stack

`TypeScript` · `Node.js 22` · `Fastify v5` · `ESM` · `Claude (Anthropic)` · `OpenAI` · `Google GenAI` · `Claude Code CLI` · `MCP Protocol` · `PostgreSQL 17 + pgvector` · `Redis` · `Docker Compose`

## License

Private. All rights reserved.
