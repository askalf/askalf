# AskAlf Migration Plan

## Architecture: Split Deployment

| Stack | Host | Purpose |
|-------|------|---------|
| **Webhost** | VPS (Ubuntu) | Public sites: askalf.org, amnesia.tax, get.askalf.org |
| **Selfhosted** | Local machine | AskAlf platform: dashboard, forge, agents, Ollama |

---

## Phase 1: Pre-Migration Backup (run on current host)

### 1.1 Database Backup
```bash
# Full PostgreSQL dump with all data
docker exec askalf-postgres pg_dump -U substrate -d askalf -Fc > backup-askalf-$(date +%Y%m%d).dump

# Verify backup integrity
pg_restore --list backup-askalf-*.dump | head -20
```

### 1.2 Volume Backup
```bash
# Export all named volumes to tar archives
for vol in askalf_postgres_data askalf_redis_data askalf_credentials askalf_claude_home askalf_codex_home askalf_searxng_cache askalf_ollama_data; do
  echo "Backing up $vol..."
  docker run --rm -v $vol:/data -v $(pwd)/backups:/backup alpine tar czf /backup/$vol.tar.gz -C /data .
done

# Webhost volumes
for vol in webhost_nginx_cache webhost_nginx_logs webhost_redis_data webhost_searxng_cache; do
  docker run --rm -v $vol:/data -v $(pwd)/backups:/backup alpine tar czf /backup/$vol.tar.gz -C /data .
done
```

### 1.3 Gitignored Files (must copy manually)
```
# Selfhosted
.env                                          # All secrets, API keys, passwords
infrastructure/searxng/settings.yml           # SearXNG config (selfhosted)
infrastructure/searxng/limiter.toml           # Rate limiter config
infrastructure/redis/redis-selfhosted.conf    # Redis config
infrastructure/postgres/postgresql.conf       # PostgreSQL tuning

# Webhost (copy to VPS)
docker-compose.webhost.yml                    # Webhost compose file
infrastructure/nginx/nginx.conf               # Nginx main config
infrastructure/nginx/conf.d/webhost.conf      # Nginx site configs
infrastructure/nginx/security-headers.conf    # Security headers snippet
infrastructure/nginx/static/                  # All static HTML, images, icons
infrastructure/searxng/webhost-settings.yml   # SearXNG config (webhost)
infrastructure/searxng/webhost-limiter.toml   # Rate limiter (webhost)

# Marketplace (copy to wherever marketplace runs)
infrastructure/marketplace/server.js          # Central marketplace API
infrastructure/nginx/static/admin-review.html # Admin review panel
infrastructure/nginx/static/marketplace.html  # Public marketplace page

# Forge private routes
apps/forge/src/routes/marketplace-sync.ts     # Marketplace sync route
apps/forge/src/routes/marketplace-central.ts  # Central marketplace route (if exists)
```

### 1.4 Credentials Checklist
```
[ ] ANTHROPIC_API_KEY
[ ] OPENAI_API_KEY
[ ] PROTON_WIREGUARD_PRIVATE_KEY
[ ] CLOUDFLARE_TUNNEL_TOKEN
[ ] SESSION_SECRET
[ ] JWT_SECRET
[ ] POSTGRES_PASSWORD
[ ] REDIS_PASSWORD
[ ] ENCRYPTION_KEY
[ ] CHANNEL_ENCRYPTION_KEY
[ ] FORGE_API_KEY
[ ] INTERNAL_API_SECRET
[ ] SEARXNG_SECRET_KEY
[ ] DISCORD_BOT_TOKEN
[ ] MARKETPLACE_ADMIN_SECRET
[ ] MARKETPLACE_URL
[ ] Twitter cookies (CT0, AUTH_TOKEN, etc.)
[ ] Claude OAuth credentials (.credentials.json)
```

---

## Phase 2: VPS Setup (Webhost)

### 2.1 Provision VPS
- Ubuntu 22.04+ LTS
- 2 vCPU, 4GB RAM minimum (webhost is lightweight)
- 40GB SSD
- Docker + Docker Compose installed

### 2.2 Deploy Webhost
```bash
# Clone repo
git clone https://github.com/askalf/askalf.git
cd askalf

# Copy gitignored webhost files from backup
# (docker-compose.webhost.yml, nginx configs, static files, searxng configs)

# Create .env with webhost-specific secrets
cat > .env << 'EOF'
REDIS_PASSWORD=<generate new>
SEARXNG_SECRET_KEY=<generate new>
PROTON_WIREGUARD_PRIVATE_KEY=<same key>
PROTON_SERVER_COUNTRIES=United States
CLOUDFLARE_TUNNEL_TOKEN=<update tunnel to point to VPS IP>
EOF

# Start webhost stack
docker compose -f docker-compose.webhost.yml up -d
```

### 2.3 Update Cloudflare Tunnel
- Go to Cloudflare Zero Trust dashboard
- Update tunnel endpoint to VPS public IP
- Test: `curl -H "Host: askalf.org" http://VPS_IP/health`

---

## Phase 3: Local Host Migration (Selfhosted)

### 3.1 If moving to new Ubuntu machine
```bash
# Clone repo
git clone https://github.com/askalf/askalf.git
cd askalf

# Copy .env and gitignored configs from backup
# Copy infrastructure/searxng/, infrastructure/redis/, infrastructure/postgres/

# Restore database
docker compose -f docker-compose.selfhosted.yml up -d postgres redis
sleep 10
docker exec -i askalf-postgres pg_restore -U substrate -d askalf -c < backup-askalf-*.dump

# Restore volumes (if needed)
for vol in askalf_credentials askalf_claude_home askalf_codex_home askalf_ollama_data; do
  docker volume create $vol
  docker run --rm -v $vol:/data -v $(pwd)/backups:/backup alpine tar xzf /backup/$vol.tar.gz -C /data
done

# Start full stack
docker compose -f docker-compose.selfhosted.yml up -d
```

### 3.2 If keeping current Windows host
```bash
# Just remove webhost stack (it's on VPS now)
docker compose -f docker-compose.webhost.yml down
# Remove webhost volumes
docker volume rm webhost_nginx_cache webhost_nginx_logs webhost_redis_data webhost_searxng_cache

# Selfhosted continues running as-is
docker compose -f docker-compose.selfhosted.yml up -d
```

---

## Phase 4: Verification

### 4.1 Webhost (VPS)
```bash
# All sites responding through Cloudflare
curl -s https://askalf.org | grep -q "AskAlf" && echo "OK"
curl -s https://amnesia.tax | grep -q "amnesia" && echo "OK"
curl -s https://get.askalf.org | grep -q "bash" && echo "OK"

# SearXNG searching through VPN
curl -s "https://amnesia.tax/search?q=test&format=json" | python3 -c "import sys,json;d=json.load(sys.stdin);print(f'Results: {len(d.get(\"results\",[]))}')"

# Security headers present
curl -sI https://askalf.org | grep -i strict-transport
```

### 4.2 Selfhosted (Local)
```bash
# Dashboard accessible
curl -s http://localhost:3001/health

# Forge healthy
curl -s http://localhost:3001/api/v1/forge/health | python3 -c "import sys,json;print(json.load(sys.stdin)['status'])"

# Agents running
docker exec askalf-postgres psql -U substrate -d askalf -c "SELECT name, status FROM forge_agents WHERE status = 'active'"

# Memory intact
curl -s -X POST http://localhost:3001/api/v1/forge/memory/search -H "Content-Type: application/json" -d '{"query":"test","limit":1}'

# Ollama connected
curl -s http://localhost:11434/api/tags
```

---

## Fallback Plan

### If VPS deployment fails
1. Webhost stays on current Windows host — no downtime
2. Cloudflare tunnel stays pointed at current IP
3. Roll back: `docker compose -f docker-compose.webhost.yml up -d` on Windows

### If selfhosted migration fails
1. Database restore from pg_dump backup
2. Volume restore from tar archives
3. `.env` and configs are backed up — full rebuild possible
4. Current Windows host remains operational as fallback

### Rollback procedure
```bash
# On current Windows host (if new host fails)
cd substrate
docker compose -f docker-compose.selfhosted.yml up -d
docker compose -f docker-compose.webhost.yml up -d
# Everything back to current state in <2 minutes
```

---

## Migration-Day Script

```bash
#!/bin/bash
# run-migration.sh — execute on migration day

set -e
BACKUP_DIR="./migration-backups/$(date +%Y%m%d)"
mkdir -p "$BACKUP_DIR"

echo "=== Phase 1: Backup ==="
docker exec askalf-postgres pg_dump -U substrate -d askalf -Fc > "$BACKUP_DIR/askalf.dump"
cp .env "$BACKUP_DIR/.env"
cp -r infrastructure/searxng "$BACKUP_DIR/searxng"
cp -r infrastructure/redis "$BACKUP_DIR/redis"
cp -r infrastructure/postgres "$BACKUP_DIR/postgres"
cp -r infrastructure/nginx "$BACKUP_DIR/nginx"
cp docker-compose.webhost.yml "$BACKUP_DIR/" 2>/dev/null || true
cp apps/forge/src/routes/marketplace-sync.ts "$BACKUP_DIR/" 2>/dev/null || true

for vol in askalf_postgres_data askalf_redis_data askalf_credentials askalf_ollama_data; do
  docker run --rm -v $vol:/data -v "$(pwd)/$BACKUP_DIR":/backup alpine tar czf /backup/$vol.tar.gz -C /data .
done

echo "=== Backup complete: $BACKUP_DIR ==="
ls -lh "$BACKUP_DIR"
echo ""
echo "Transfer $BACKUP_DIR to new host, then run the restore steps from MIGRATION.md"
```

---

## Notes
- Cloudflare tunnel token must be regenerated if changing the tunnel endpoint
- ProtonVPN WireGuard key works on both hosts simultaneously (same account)
- Claude OAuth credentials (.credentials.json) are host-specific — re-auth on new host
- Ollama models must be re-pulled on new host (not backed up — too large)
- Redis data is ephemeral (cache only) — no need to restore
