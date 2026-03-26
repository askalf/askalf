#!/bin/bash
# AskAlf Migration Backup Script
# Run this BEFORE migrating to new host
# Creates a complete backup of all data, configs, and secrets

set -e

BACKUP_DIR="./migration-backups/$(date +%Y%m%d-%H%M)"
mkdir -p "$BACKUP_DIR/volumes" "$BACKUP_DIR/configs" "$BACKUP_DIR/gitignored"

echo "============================================"
echo "  AskAlf Migration Backup"
echo "  Target: $BACKUP_DIR"
echo "============================================"
echo ""

# 1. Database dump
echo "[1/5] Backing up PostgreSQL..."
docker exec askalf-postgres pg_dump -U substrate -d askalf -Fc > "$BACKUP_DIR/askalf-database.dump"
echo "  Database: $(du -sh "$BACKUP_DIR/askalf-database.dump" | cut -f1)"

# 2. Docker volumes
echo "[2/5] Backing up Docker volumes..."
for vol in askalf_postgres_data askalf_redis_data askalf_credentials askalf_claude_home askalf_codex_home askalf_searxng_cache askalf_ollama_data; do
  if docker volume inspect "$vol" > /dev/null 2>&1; then
    docker run --rm -v "$vol":/data -v "$(pwd)/$BACKUP_DIR/volumes":/backup alpine tar czf "/backup/$vol.tar.gz" -C /data . 2>/dev/null
    echo "  $vol: $(du -sh "$BACKUP_DIR/volumes/$vol.tar.gz" | cut -f1)"
  fi
done

# 3. Environment and secrets
echo "[3/5] Backing up environment and secrets..."
cp .env "$BACKUP_DIR/configs/.env" 2>/dev/null && echo "  .env copied" || echo "  .env not found"

# 4. Gitignored config files
echo "[4/5] Backing up gitignored configs..."
# Selfhosted configs
for f in \
  infrastructure/searxng/settings.yml \
  infrastructure/searxng/limiter.toml \
  infrastructure/searxng/webhost-settings.yml \
  infrastructure/searxng/webhost-limiter.toml \
  infrastructure/redis/redis-selfhosted.conf \
  infrastructure/postgres/postgresql.conf \
  apps/forge/src/routes/marketplace-sync.ts \
  apps/forge/src/routes/marketplace-central.ts; do
  if [ -f "$f" ]; then
    mkdir -p "$BACKUP_DIR/gitignored/$(dirname "$f")"
    cp "$f" "$BACKUP_DIR/gitignored/$f"
    echo "  $f"
  fi
done

# Webhost configs
for f in \
  docker-compose.webhost.yml \
  infrastructure/nginx/nginx.conf \
  infrastructure/nginx/conf.d/webhost.conf \
  infrastructure/nginx/security-headers.conf; do
  if [ -f "$f" ]; then
    mkdir -p "$BACKUP_DIR/gitignored/$(dirname "$f")"
    cp "$f" "$BACKUP_DIR/gitignored/$f"
    echo "  $f"
  fi
done

# Nginx static files (landing pages, etc)
if [ -d "infrastructure/nginx/static" ]; then
  cp -r infrastructure/nginx/static "$BACKUP_DIR/gitignored/infrastructure/nginx/"
  echo "  infrastructure/nginx/static/ ($(ls infrastructure/nginx/static/ | wc -l) files)"
fi

# Marketplace
if [ -d "infrastructure/marketplace" ]; then
  cp -r infrastructure/marketplace "$BACKUP_DIR/gitignored/infrastructure/"
  echo "  infrastructure/marketplace/"
fi

# 5. Summary
echo "[5/5] Generating manifest..."
echo "AskAlf Migration Backup — $(date)" > "$BACKUP_DIR/MANIFEST.txt"
echo "Source host: $(hostname)" >> "$BACKUP_DIR/MANIFEST.txt"
echo "" >> "$BACKUP_DIR/MANIFEST.txt"
echo "=== Docker Images ===" >> "$BACKUP_DIR/MANIFEST.txt"
docker images --format "{{.Repository}}:{{.Tag}} {{.Size}}" >> "$BACKUP_DIR/MANIFEST.txt"
echo "" >> "$BACKUP_DIR/MANIFEST.txt"
echo "=== Docker Volumes ===" >> "$BACKUP_DIR/MANIFEST.txt"
docker volume ls --format "{{.Name}}" >> "$BACKUP_DIR/MANIFEST.txt"
echo "" >> "$BACKUP_DIR/MANIFEST.txt"
echo "=== Agent Status ===" >> "$BACKUP_DIR/MANIFEST.txt"
docker exec askalf-postgres psql -U substrate -d askalf -t -c "SELECT name || ' (' || status || ')' FROM forge_agents ORDER BY name" >> "$BACKUP_DIR/MANIFEST.txt" 2>/dev/null
echo "" >> "$BACKUP_DIR/MANIFEST.txt"
echo "=== Memory Count ===" >> "$BACKUP_DIR/MANIFEST.txt"
docker exec askalf-postgres psql -U substrate -d askalf -t -c "SELECT 'semantic: ' || COUNT(*) FROM forge_semantic_memories UNION ALL SELECT 'episodic: ' || COUNT(*) FROM forge_episodic_memories UNION ALL SELECT 'procedural: ' || COUNT(*) FROM forge_procedural_memories" >> "$BACKUP_DIR/MANIFEST.txt" 2>/dev/null

TOTAL_SIZE=$(du -sh "$BACKUP_DIR" | cut -f1)

echo ""
echo "============================================"
echo "  Backup complete!"
echo "  Location: $BACKUP_DIR"
echo "  Total size: $TOTAL_SIZE"
echo "============================================"
echo ""
echo "Next steps:"
echo "  1. Transfer $BACKUP_DIR to new host"
echo "  2. Clone repo: git clone https://github.com/askalf/askalf.git"
echo "  3. Copy configs: cp -r $BACKUP_DIR/gitignored/* askalf/"
echo "  4. Copy .env: cp $BACKUP_DIR/configs/.env askalf/"
echo "  5. Restore DB: docker exec -i askalf-postgres pg_restore -U substrate -d askalf -c < $BACKUP_DIR/askalf-database.dump"
echo "  6. Start: docker compose -f docker-compose.selfhosted.yml up -d"
