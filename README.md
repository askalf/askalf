# AskAlf

**Autonomous AI Agent Orchestration Platform** — A fleet of AI agents that write, review, deploy, and evolve production software.

- [askalf.org](https://askalf.org) — Dashboard
- [amnesia.tax](https://amnesia.tax) — Search engine
- [integration.tax](https://integration.tax) — Admin console

## Architecture

```
Internet -> Cloudflare (SSL, WAF) -> cloudflared tunnel -> nginx
    |
+------------------------------------------+
|  Forge (3005) - Agent orchestration      |
|  Dashboard (3001) - React admin UI       |
|  MCP-Tools (3010) - 24 MCP tools        |
|  Admin Console (3002) - Claude terminal  |
+------------------------------------------+
    |
PostgreSQL 17 + pgvector  <-  pgbouncer
Redis (event bus, caching)
```

## Agent Fleet

4 active agents running via Claude Code CLI, ticket-gated dispatch, 6h intervals:

- **Engineer** — Backend development, API routes, database queries
- **Infra** — DevOps, Docker, deployments, infrastructure
- **QA** — Testing, bug detection, code quality
- **Security** — Security scanning and vulnerability detection

## Autonomous Pipeline

```
Ticket assigned -> Agent executes in isolated worktree
  -> Code committed on agent/* branch
  -> Git review (risk classification + peer review)
  -> Auto-merge to main (low risk) or intervention request (high risk)
  -> Auto-deploy: rebuild baked-in services, restart volume-mounted
  -> Health check -> rollback on failure
  -> Ticket resolved
```

## Monorepo Structure

```
substrate/
+-- apps/
|   +-- forge/        # Agent orchestration engine (Fastify)
|   +-- dashboard/    # React admin dashboard (Vite + Fastify)
|   +-- mcp-tools/    # 24 MCP tools for agent capabilities
|   +-- admin-console/ # Claude Code terminal (integration.tax)
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

`TypeScript` - `Node.js 22` - `Fastify v5` - `ESM` - `Claude (Anthropic)` - `Claude Code CLI` - `MCP Protocol` - `PostgreSQL 17 + pgvector` - `Redis` - `Docker Compose` - `Nginx` - `Cloudflare Zero Trust`

## Infrastructure

- 13 Docker containers (single stack: `askalf`)
- Cloudflare Tunnel (Zero Trust, QUIC)
- Docker socket proxy for secure container management
- Daily PostgreSQL backups (7-day retention)
- All third-party images pinned to SHA256 digests
- SearXNG for agent web search (no API keys)
