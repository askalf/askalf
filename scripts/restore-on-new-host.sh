#!/bin/bash
# AskAlf Migration Restore Script
# Run this ON THE NEW HOST after transferring the backup
# Usage: ./restore-on-new-host.sh /path/to/migration-backup

set -e

BACKUP_DIR="${1:?Usage: $0 /path/to/migration-backup}"

if [ ! -f "$BACKUP_DIR/askalf-database.dump" ]; then
  echo "ERROR: $BACKUP_DIR/askalf-database.dump not found"
  echo "Make sure you're pointing to the correct backup directory"
  exit 1
fi

echo "============================================"
echo "  AskAlf Migration Restore"
echo "  Source: $BACKUP_DIR"
echo "============================================"
echo ""

# 0. Check prerequisites
echo "[0/6] Checking prerequisites..."
command -v docker >/dev/null 2>&1 || { echo "ERROR: Docker not installed"; exit 1; }
command -v docker compose >/dev/null 2>&1 || docker compose version >/dev/null 2>&1 || { echo "ERROR: Docker Compose not installed"; exit 1; }
echo "  Docker: $(docker --version | cut -d' ' -f3)"

# 1. Clone repo (if not already done)
echo "[1/6] Setting up repo..."
if [ ! -f "docker-compose.selfhosted.yml" ]; then
  echo "  Not in repo directory. Clone first:"
  echo "  git clone https://github.com/askalf/askalf.git && cd askalf"
  exit 1
fi
echo "  Repo OK"

# 2. Restore gitignored configs
echo "[2/6] Restoring configs..."
if [ -d "$BACKUP_DIR/gitignored" ]; then
  cp -rn "$BACKUP_DIR/gitignored/"* . 2>/dev/null || true
  echo "  Gitignored files restored"
fi
if [ -f "$BACKUP_DIR/configs/.env" ]; then
  cp "$BACKUP_DIR/configs/.env" .env
  echo "  .env restored"
fi

# 3. Start database and redis first
echo "[3/6] Starting database..."
docker compose -f docker-compose.selfhosted.yml up -d postgres redis
echo "  Waiting for PostgreSQL to be ready..."
for i in $(seq 1 30); do
  docker exec askalf-postgres pg_isready -U substrate > /dev/null 2>&1 && break
  sleep 2
done
echo "  PostgreSQL ready"

# 4. Restore database
echo "[4/6] Restoring database..."
# Create fresh database
docker exec askalf-postgres psql -U substrate -c "DROP DATABASE IF EXISTS askalf" 2>/dev/null || true
docker exec askalf-postgres psql -U substrate -c "CREATE DATABASE askalf" 2>/dev/null || true
# Restore from dump
docker exec -i askalf-postgres pg_restore -U substrate -d askalf --no-owner --no-acl < "$BACKUP_DIR/askalf-database.dump" 2>/dev/null || true
echo "  Database restored"

# Verify
AGENT_COUNT=$(docker exec askalf-postgres psql -U substrate -d askalf -t -c "SELECT COUNT(*) FROM forge_agents" 2>/dev/null | tr -d ' ')
MEMORY_COUNT=$(docker exec askalf-postgres psql -U substrate -d askalf -t -c "SELECT COUNT(*) FROM forge_semantic_memories" 2>/dev/null | tr -d ' ')
echo "  Agents: $AGENT_COUNT, Memories: $MEMORY_COUNT"

# 5. Restore credential volumes
echo "[5/6] Restoring volumes..."
for vol in askalf_credentials askalf_claude_home askalf_codex_home; do
  if [ -f "$BACKUP_DIR/volumes/$vol.tar.gz" ]; then
    docker volume create "$vol" 2>/dev/null || true
    docker run --rm -v "$vol":/data -v "$(cd "$BACKUP_DIR/volumes" && pwd)":/backup alpine tar xzf "/backup/$vol.tar.gz" -C /data
    echo "  $vol restored"
  fi
done

# 6. Start full stack
echo "[6/6] Starting full stack..."
docker compose -f docker-compose.selfhosted.yml up -d

echo ""
echo "  Waiting for services to be healthy..."
sleep 30

echo ""
echo "============================================"
echo "  Restore complete!"
echo "============================================"
echo ""
docker ps --filter "label=autoheal-askalf" --format "table {{.Names}}\t{{.Status}}"
echo ""
echo "Dashboard: http://localhost:3001"
echo ""
echo "Post-restore checklist:"
echo "  [ ] Dashboard loads at localhost:3001"
echo "  [ ] Agents visible in Fleet tab"
echo "  [ ] Memory search works in Brain tab"
echo "  [ ] Audit entries showing"
echo "  [ ] Ollama: pull models (ollama pull qwen2.5:7b)"
echo "  [ ] Re-authenticate Claude OAuth if needed"
echo "  [ ] Update DNS/tunnel if IP changed"
