# SUBSTRATE Infrastructure

Production infrastructure for deploying SUBSTRATE via Docker.

## Architecture

```
Internet
    │
    ▼
Cloudflare Tunnel (cloudflared)
    │
    ▼
nginx (reverse proxy, rate limiting)
    │
    ├── askalf.org     → website (port 8080)
    ├── api.askalf.org → api (port 3000)
    └── app.askalf.org → dashboard (port 3001)
                              │
                              ▼
                         pgbouncer
                              │
                              ▼
                         PostgreSQL + Redis
```

## Containers

| Container | Description | Port |
|-----------|-------------|------|
| postgres | PostgreSQL 17 + pgvector | 5432 |
| redis | Redis cache/queue | 6379 |
| api | Fastify REST API | 3000 |
| worker | Background job processor | - |
| website | Public marketing site | 8080 |
| dashboard | User/Admin dashboards | 3001 |
| nginx | Reverse proxy | 80 |
| pgbouncer | Connection pooler | 6432 |
| cloudflared | Cloudflare tunnel | - |
| backup | Automated DB backups | - |
| autoheal | Container recovery | - |

## Setup Instructions

### 1. Configure Environment

Copy and edit the production environment file:

```bash
cp .env.production.example .env.production
# Edit .env.production with your credentials
```

Required variables:
- `POSTGRES_PASSWORD` - Database password
- `REDIS_PASSWORD` - Redis password
- `SESSION_SECRET` - 32+ character session secret
- `JWT_SECRET` - 32+ character JWT secret
- `OPENAI_API_KEY` - OpenAI API key (for embeddings)
- `ANTHROPIC_API_KEY` - Anthropic API key (for Claude)
- `STRIPE_SECRET_KEY` - Stripe secret key
- `STRIPE_WEBHOOK_SECRET` - Stripe webhook secret

### 2. Configure Cloudflare Tunnel

1. Install cloudflared locally:
   ```bash
   # macOS
   brew install cloudflared

   # Windows
   winget install Cloudflare.cloudflared
   ```

2. Login to Cloudflare:
   ```bash
   cloudflared tunnel login
   ```

3. Create a tunnel:
   ```bash
   cloudflared tunnel create substrate
   ```

4. Copy the credentials file:
   ```bash
   cp ~/.cloudflared/<TUNNEL_ID>.json infrastructure/cloudflared/credentials.json
   ```

5. Update `infrastructure/cloudflared/config.yml`:
   - Replace `YOUR_TUNNEL_ID_HERE` with your tunnel ID

6. Add DNS routes:
   ```bash
   cloudflared tunnel route dns substrate askalf.org
   cloudflared tunnel route dns substrate api.askalf.org
   cloudflared tunnel route dns substrate app.askalf.org
   ```

### 3. Deploy

```bash
# Build and start all containers
docker-compose -f docker-compose.prod.yml --env-file .env.production up -d --build

# View logs
docker-compose -f docker-compose.prod.yml logs -f

# Check status
docker-compose -f docker-compose.prod.yml ps
```

### 4. Verify Deployment

```bash
# Check health endpoints
curl https://askalf.org/health
curl https://api.askalf.org/health
curl https://app.askalf.org/health

# Check API metrics
curl https://api.askalf.org/metrics
```

## Development

For local development without cloudflared:

```bash
# Start dev stack
docker-compose up -d

# Access services directly:
# - API: http://localhost:3000
# - Website: http://localhost:8080
# - Dashboard: http://localhost:3001
```

## Maintenance

### Backups

Automated daily backups are stored in `./backups/`:
- Daily: kept for 7 days
- Weekly: kept for 4 weeks
- Monthly: kept for 6 months

Manual backup:
```bash
docker exec substrate-prod-postgres pg_dump -U substrate substrate > backup-$(date +%Y%m%d).sql
```

### Logs

```bash
# All services
docker-compose -f docker-compose.prod.yml logs -f

# Specific service
docker-compose -f docker-compose.prod.yml logs -f api

# API structured logs
docker logs substrate-prod-api 2>&1 | jq
```

### Scaling

To run multiple API instances behind nginx:

1. Update `docker-compose.prod.yml`:
   ```yaml
   api:
     deploy:
       replicas: 3
   ```

2. Update nginx upstream in `nginx.conf`:
   ```nginx
   upstream api_servers {
       server api:3000;
       # Docker Swarm or Kubernetes handles routing to replicas
   }
   ```

## Troubleshooting

### Container won't start

```bash
# Check logs
docker logs substrate-prod-<container>

# Check health
docker inspect --format='{{.State.Health.Status}}' substrate-prod-<container>
```

### Database connection issues

```bash
# Test direct connection
docker exec -it substrate-prod-postgres psql -U substrate -c "SELECT 1"

# Test via pgbouncer
docker exec -it substrate-prod-pgbouncer psql -h localhost -p 6432 -U substrate -c "SELECT 1"
```

### Cloudflared tunnel not working

```bash
# Check tunnel status
docker logs substrate-prod-cloudflared

# Verify credentials
cat infrastructure/cloudflared/credentials.json

# Test tunnel locally
cloudflared tunnel run substrate
```
