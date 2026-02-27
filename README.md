# AskAlf

**AI agents that actually use computers.** Mouse, keyboard, browser, SSH, applications. Not chatbots — digital employees.

- [askalf.org](https://askalf.org) — Platform
- [amnesia.tax](https://amnesia.tax) — Search engine

## What Makes It Different

Agents that do everything a human can do on a computer:

- **Mouse & Keyboard** — Move cursors, click buttons, type into fields, use keyboard shortcuts
- **Real Browser Sessions** — Navigate any website, fill forms, extract data, take screenshots
- **Run Any Application** — IDEs, spreadsheets, design tools, terminals
- **SSH Into Anything** — Servers, containers, VMs, routers, IoT devices, cloud instances
- **File System Control** — Read, write, organize files across codebases and documents
- **Shell & CLI** — Build scripts, deploy pipelines, test suites, piped commands

## Architecture

```
Internet -> Cloudflare (SSL, WAF) -> cloudflared tunnel -> nginx
    |
+------------------------------------------+
|  Forge (3005) - Agent orchestration      |
|  Dashboard (3001) - React SPA + Fastify  |
|  MCP-Tools (3010) - 24 MCP tools        |
+------------------------------------------+
    |
PostgreSQL 17 + pgvector
Redis (event bus, caching)
```

## Agent Fleet

### Internal Agents (5, admin-only, ticket-gated)
- **Frontend Dev** — React/UI work
- **Backend Dev** — API/DB/server work
- **Infra** — DevOps, Docker, deployments
- **QA** — Testing, code quality
- **Security** — Scanning, vulnerability detection

### User-Facing Agents (6, dispatched via chat/templates)
- **Researcher** — Web research, competitor analysis, SEO
- **Sentinel** — Security scanning, dependency auditing
- **Developer** — Code review, testing, full-stack dev
- **Writer** — Content, docs, release notes
- **Watchdog** — System monitoring, incident response
- **Analyst** — Data analysis, performance profiling

## Platform Features

- **Fleet Orchestration** — Fan-out tasks, pipeline workflows, consensus patterns
- **Multi-Provider** — Anthropic, OpenAI, Google. Switch per-agent, per-task
- **Cost Control** — Per-agent budgets, execution caps, real-time tracking
- **Guardrails** — Human-in-the-loop approvals, content filtering, execution boundaries
- **24 Built-in Tools** — Database, Docker, web search, code analysis, team coordination via MCP
- **Full Observability** — Structured logs, execution traces, performance metrics

## Security & Privacy

Agents with full computer access demand uncompromising security:

- **End-to-End Encryption** — TLS 1.3 in transit, AES-256 at rest. Sessions, credentials, and outputs never stored in plaintext
- **Zero-Knowledge Architecture** — Per-tenant encryption keys. We cannot read your agent sessions, credentials, or data
- **Full Audit Trail** — Immutable, tamper-proof logs. Every agent action traced — who, what, when, why
- **Compliance-Ready** — Built for regulated environments. Role-based access, data residency controls, audit-ready infrastructure
- **Credential Vault** — SSH keys, API tokens, and passwords in a hardware-backed vault. Injected at runtime, never persisted in memory or logs
- **Sandboxed Execution** — Every agent runs in an isolated container. Network policies, filesystem restrictions, and resource limits enforced at the kernel level

## Monorepo Structure

```
substrate/
+-- apps/
|   +-- forge/        # Agent orchestration engine (Fastify)
|   +-- dashboard/    # React SPA + Fastify server (Vite)
|   +-- mcp-tools/    # 24 MCP tools for agent capabilities
|   +-- admin-console/ # Master control terminal
+-- packages/
|   +-- core/         # Shared types, Zod validation, ulid
|   +-- database/     # PostgreSQL client, migrations, repositories
|   +-- db/           # Shared DB pools
|   +-- auth/         # Session/API key authentication
|   +-- observability/ # Pino logging, Prometheus metrics
|   +-- email/        # Nodemailer email service
+-- infrastructure/
|   +-- nginx/        # Reverse proxy, domain routing
|   +-- backup/       # Daily PostgreSQL backups
+-- scripts/          # Build, deploy, migration scripts
```

## Stack

`TypeScript` · `Node.js 22` · `Fastify v5` · `ESM` · `Claude (Anthropic)` · `OpenAI` · `Google GenAI` · `Claude Code CLI` · `MCP Protocol` · `PostgreSQL 17 + pgvector` · `Redis` · `Docker Compose` · `Nginx` · `Cloudflare Zero Trust`
