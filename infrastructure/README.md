# Infrastructure

Docker infrastructure for AskAlf — self-hosted AI agent fleet platform.

## Containers

| Container | Description | Port |
|-----------|-------------|------|
| askalf-postgres | PostgreSQL 17 + pgvector | 5432 |
| askalf-redis | Redis 8 | 6379 |
| askalf-dashboard | React dashboard + Claude/Codex terminals | 3001 |
| askalf-forge | Agent runtime, API, scheduler, orchestration | 3005 |
| askalf-mcp-tools | MCP tool server for agents | 3010 |
| askalf-searxng | Privacy-respecting web search | 8080 |
| askalf-autoheal | Container auto-recovery | - |

## Quick Start

```bash
git clone https://github.com/askalf/askalf.git
cd askalf && ./setup.sh
docker compose -f docker-compose.selfhosted.yml up -d
```

Open `http://localhost:3001` and complete the onboarding wizard.

## Configuration

Copy and edit the environment file:

```bash
cp .env.example .env
```

Required:
- `POSTGRES_PASSWORD` — Database password
- `REDIS_PASSWORD` — Redis password
- `JWT_SECRET` — 32+ character JWT secret
- `SESSION_SECRET` — 32+ character session secret

Optional:
- `ANTHROPIC_API_KEY` — For enhanced intent parser
- `OPENAI_API_KEY` — For embeddings and agent execution
- `GOOGLE_AI_KEY` — For Google AI models

## Directory Structure

```
infrastructure/
├── postgres/
│   └── postgresql.conf       # Tuned PostgreSQL config
├── redis/
│   └── redis-selfhosted.conf # Redis config for self-hosted
├── searxng/
│   └── settings.yml          # Search engine config
└── README.md
```

## Maintenance

```bash
# View logs
docker compose -f docker-compose.selfhosted.yml logs -f

# Specific service
docker compose -f docker-compose.selfhosted.yml logs -f forge

# Database backup
docker exec askalf-postgres pg_dump -U substrate askalf > backup-$(date +%Y%m%d).sql

# Restart a service
docker compose -f docker-compose.selfhosted.yml restart forge
```

## Support

[askalf.org](https://askalf.org) — [Docs](https://askalf.org/docs) — [support@askalf.org](mailto:support@askalf.org)
