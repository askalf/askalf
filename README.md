# AskAlf

**Autonomous AI Agent Orchestration Platform** — A fleet of AI agents that write, review, deploy, and evolve production software.

- [askalf.org](https://askalf.org) — Dashboard
- [amnesia.tax](https://amnesia.tax) — Search engine

## Architecture

```
Internet → Cloudflare (SSL, WAF) → cloudflared tunnel → nginx
    ↓
┌─────────────────────────────────────────┐
│  Forge (3005) — Agent orchestration     │
│  Dashboard (3001) — React admin UI      │
│  MCP-Tools (3010) — 15 MCP tools        │
└─────────────────────────────────────────┘
    ↓
PostgreSQL 17 + pgvector  ←  pgbouncer
Redis 7 (sessions, caching)
```

## Agent Fleet

10 agents (5 active, 5 paused) running via Claude Code CLI in isolated git worktrees:

- **Aegis** — Security monitoring and vulnerability detection
- **Backend Dev** — API routes, database queries, server-side logic
- **Frontend Dev** — React dashboard components and UI
- **Heartbeat** — Infrastructure health monitoring
- **QA Engineer** — Testing, bug detection, code quality
- **Architect** (paused) — System design and code review
- **DevOps** (paused) — Docker, deployments, infrastructure
- **Doc Writer** (paused) — Documentation
- **Nexus** (paused) — Task decomposition and coordination
- **Scout** (paused) — External research and CVE monitoring

## Autonomous Pipeline

```
Ticket assigned → Agent executes in isolated worktree
  → Code committed on agent/* branch
  → Git review (risk classification + peer review)
  → Auto-merge to main (low risk) or intervention request (high risk)
  → Auto-deploy: rebuild baked-in services, restart volume-mounted
  → Health check → rollback on failure
  → Ticket resolved
```

## Monorepo Structure

```
substrate/
├── apps/
│   ├── forge/        # Agent orchestration engine (Fastify)
│   ├── dashboard/    # React admin dashboard (Vite)
│   └── mcp-tools/    # 15 MCP tools for agent capabilities
├── packages/
│   ├── core/         # Shared types, Zod validation, ulid
│   ├── database/     # PostgreSQL client, migrations
│   ├── observability/# Pino logging, Prometheus metrics
│   ├── email/        # Nodemailer email service
│   ├── auth/         # Session/API key auth
│   ├── ai/           # Multi-provider LLM support
│   └── db/           # Shared DB pools for MCP
├── infrastructure/
│   └── nginx/        # Reverse proxy + static sites
└── scripts/          # Build, deploy, maintenance
```

## Stack

- **Runtime**: Node.js 22, TypeScript (strict), Fastify v5, ESM
- **Database**: PostgreSQL 17 + pgvector, pgbouncer
- **Cache**: Redis 7
- **AI**: Claude (Anthropic) via Claude Code CLI + MCP Protocol
- **Frontend**: React 18, Tailwind CSS, Vite
- **Infrastructure**: Docker Compose, Nginx, Cloudflare Tunnel
- **Packages**: pnpm workspaces monorepo

## License

Proprietary — All rights reserved
