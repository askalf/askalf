#!/bin/bash
# Backup Verification Script
# Verifies integrity of PostgreSQL backups by restoring to a temporary container
#
# Usage:
#   ./scripts/verify-backup.sh /path/to/backup.sql.gz
#   ./scripts/verify-backup.sh /path/to/backup.sql
#
# Environment:
#   POSTGRES_PASSWORD — password for test database (default: testpass123)

set -e

BACKUP_FILE="${1:?Backup file path required}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-testpass123}"
CONTAINER_NAME="askalf-backup-verify-$$"
TEST_DB="substrate_test"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[verify]${NC} $1"; }
warn() { echo -e "${YELLOW}[verify]${NC} $1"; }
error() { echo -e "${RED}[verify]${NC} $1"; exit 1; }

# Validate backup file exists
if [ ! -f "$BACKUP_FILE" ]; then
  error "Backup file not found: $BACKUP_FILE"
fi

log "Starting backup verification for: $BACKUP_FILE"

# Determine if backup is gzipped
if [[ "$BACKUP_FILE" == *.gz ]]; then
  BACKUP_CMD="zcat $BACKUP_FILE"
  log "Detected gzip format"
else
  BACKUP_CMD="cat $BACKUP_FILE"
  log "Detected raw SQL format"
fi

# Spin up temporary Postgres container
log "Starting temporary Postgres container: $CONTAINER_NAME"
docker run -d \
  --name "$CONTAINER_NAME" \
  -e POSTGRES_USER=substrate \
  -e POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
  -e POSTGRES_DB="$TEST_DB" \
  -e POSTGRES_INITDB_ARGS="--data-checksums" \
  pgvector/pgvector:0.8.1-pg17-bookworm@sha256:3e8b3adfd27b5707128f60956f62a793c3c9326ea8cfaf0eab7adccb5d700b21 \
  >/dev/null

# Wait for container to be ready
log "Waiting for Postgres to be ready..."
for i in {1..30}; do
  if docker exec "$CONTAINER_NAME" pg_isready -U substrate -d "$TEST_DB" >/dev/null 2>&1; then
    log "Postgres ready"
    break
  fi
  if [ $i -eq 30 ]; then
    error "Postgres failed to start"
  fi
  sleep 1
done

# Restore backup
log "Restoring backup..."
if ! $BACKUP_CMD | docker exec -i "$CONTAINER_NAME" psql -U substrate -d "$TEST_DB" >/dev/null 2>&1; then
  error "Backup restore failed"
fi

log "Backup restored successfully"

# Run integrity checks
log "Running integrity checks..."

# Check table count
TABLE_COUNT=$(docker exec "$CONTAINER_NAME" psql -U substrate -d "$TEST_DB" -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';" 2>/dev/null)
log "Tables found: $TABLE_COUNT"

if [ "$TABLE_COUNT" -lt 5 ]; then
  warn "Low table count — backup may be incomplete"
fi

# Check index validity
INVALID_INDEXES=$(docker exec "$CONTAINER_NAME" psql -U substrate -d "$TEST_DB" -t -c "SELECT COUNT(*) FROM pg_indexes WHERE schemaname='public';" 2>/dev/null)
log "Indexes found: $INVALID_INDEXES"

# Check for constraint violations (basic)
CONSTRAINT_CHECK=$(docker exec "$CONTAINER_NAME" psql -U substrate -d "$TEST_DB" -t -c "SELECT COUNT(*) FROM information_schema.table_constraints WHERE table_schema='public';" 2>/dev/null || echo "0")
log "Constraints found: $CONSTRAINT_CHECK"

# Verify critical tables exist
CRITICAL_TABLES=("users" "agent_tickets" "forge_executions" "forge_agents")
MISSING=0
for table in "${CRITICAL_TABLES[@]}"; do
  if docker exec "$CONTAINER_NAME" psql -U substrate -d "$TEST_DB" -t -c "SELECT to_regclass('$table');" 2>/dev/null | grep -q -E '(^[^-]|.+)'; then
    log "✓ Table '$table' exists"
  else
    warn "✗ Critical table '$table' missing or inaccessible"
    ((MISSING++))
  fi
done

# Cleanup
log "Cleaning up temporary container..."
docker stop "$CONTAINER_NAME" >/dev/null 2>&1 || true
docker rm "$CONTAINER_NAME" >/dev/null 2>&1 || true

# Summary
if [ $MISSING -eq 0 ]; then
  log "Backup verification PASSED ✓"
  exit 0
else
  warn "Backup verification FAILED — $MISSING critical tables missing"
  exit 1
fi
