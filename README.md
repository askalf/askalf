# SUBSTRATE / Ask ALF

**The Universal AI Platform** - One account, every AI model, with perpetual memory.

Production URLs:
- https://askalf.org - Main website
- https://app.askalf.org - Dashboard
- https://api.askalf.org - API

## Architecture

```
Internet
    ↓
Cloudflare (SSL, DDoS, WAF)
    ↓
cloudflared tunnel (outbound only)
    ↓
nginx (NO PUBLIC PORTS)
    ↓
┌─────────────────────────────────────────┐
│  api (3000)  │  dashboard (3001)        │
│  website (8080)  │  mcp (3002)          │
│  worker (background jobs)               │
└─────────────────────────────────────────┘
    ↓
pgbouncer (connection pooling)
    ↓
PostgreSQL 17 + pgvector
    ↓
Redis (event bus, sessions, caching)
```

## Stack

- **Database**: PostgreSQL 17 + pgvector for semantic search
- **Cache/Events**: Redis (sessions, BullMQ jobs, event bus)
- **API**: Node.js 20 / TypeScript / Fastify
- **Frontend**: React + Vite (dashboard), Static HTML (website)
- **Infrastructure**: Docker Compose, nginx, pgbouncer
- **Security**: Cloudflare Tunnel (Zero Trust), no public ports

## Monorepo Structure

```
substrate/
├── apps/
│   ├── api/          # Fastify REST API
│   ├── dashboard/    # React admin/user dashboard
│   ├── website/      # Public marketing site
│   ├── worker/       # BullMQ background jobs
│   └── mcp/          # Claude Desktop MCP server
├── packages/
│   ├── core/         # Shared types, utilities, Zod schemas
│   ├── database/     # PostgreSQL client, migrations, repositories
│   ├── ai/           # AI provider integrations
│   └── auth/         # Authentication utilities
└── infrastructure/
    ├── nginx/        # Reverse proxy configs
    └── docker/       # Dockerfiles
```

## Quick Commands

```bash
# Start production stack
cd substrate
docker-compose -f docker-compose.prod.yml --env-file .env.production up -d

# View logs
docker logs substrate-prod-api --tail 50
docker logs substrate-prod-dashboard --tail 50

# Access database
docker exec substrate-prod-postgres psql -U substrate -d substrate

# Check container health
docker ps --format "table {{.Names}}\t{{.Status}}"

# Rebuild specific service
docker-compose -f docker-compose.prod.yml --env-file .env.production build api
docker-compose -f docker-compose.prod.yml --env-file .env.production up -d api
```

## 4-Tier Cognitive Architecture

1. **Procedural Memory (Shards)** - Reusable response patterns, 0 tokens when matched
2. **Episodic Memory** - Conversation history and patterns
3. **Semantic Memory (Facts)** - Pure knowledge truths
4. **Working Memory** - Active context with automatic liquidation

## Phase 10: Current Development

- **My Workbench**: Private shard creation and testing
- **Shard Submission System**: Users submit private shards for review
- **Database Tables**: `shard_submissions` audit table added
- **Helper Functions**: `submit_shard_for_review()`, `review_shard_submission()`

## Security Features

- No public ports (Cloudflare tunnel only)
- CF-Connecting-IP header validation
- Rate limiting on all endpoints
- Content Security Policy headers
- Session-based authentication with secure cookies
- AES-256-CBC encryption for stored API keys
- Registration closed (waitlist mode)

## Environment Variables

Required in `.env.production`:

```env
DATABASE_URL=postgresql://substrate:xxx@postgres:5432/substrate
REDIS_URL=redis://redis:6379
JWT_SECRET=xxx
SESSION_SECRET=xxx
OPENAI_API_KEY=xxx (optional, for platform features)
ANTHROPIC_API_KEY=xxx (optional)
SENDGRID_API_KEY=xxx (for transactional emails)
STRIPE_SECRET_KEY=xxx (for billing)
CLOUDFLARE_TURNSTILE_SECRET=xxx (for CAPTCHA)
```

## License

Proprietary - All rights reserved
