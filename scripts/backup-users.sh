#!/bin/bash
# SUBSTRATE User Account Backup Script
# Creates encrypted backups of all user account data

set -e

# Configuration
BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
DB_HOST="${DB_HOST:-postgres}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-substrate}"
DB_USER="${DB_USER:-substrate}"
ENCRYPTION_KEY="${BACKUP_ENCRYPTION_KEY:-}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_NAME="substrate_users_${TIMESTAMP}"

# Export PGPASSWORD for non-interactive pg_dump
export PGPASSWORD="${POSTGRES_PASSWORD:-${PGPASSWORD:-}}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1"; }
warn() { echo -e "${YELLOW}[$(date '+%Y-%m-%d %H:%M:%S')] WARNING:${NC} $1"; }
error() { echo -e "${RED}[$(date '+%Y-%m-%d %H:%M:%S')] ERROR:${NC} $1"; exit 1; }

# Ensure backup directory exists
mkdir -p "${BACKUP_DIR}"
mkdir -p "${BACKUP_DIR}/daily"
mkdir -p "${BACKUP_DIR}/weekly"
mkdir -p "${BACKUP_DIR}/monthly"

log "Starting SUBSTRATE user account backup..."
log "Backup destination: ${BACKUP_DIR}"

# Create temporary directory for this backup
TEMP_DIR=$(mktemp -d)
trap "rm -rf ${TEMP_DIR}" EXIT

# ============================================
# BACKUP CORE USER TABLES
# ============================================
log "Backing up core user tables..."

# Users table (contains hashed passwords, emails)
pg_dump -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" \
  --table=users \
  --data-only \
  -f "${TEMP_DIR}/users.sql"

# Tenants table
pg_dump -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" \
  --table=tenants \
  --data-only \
  -f "${TEMP_DIR}/tenants.sql"

# Tenant members
pg_dump -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" \
  --table=tenant_members \
  --data-only \
  -f "${TEMP_DIR}/tenant_members.sql"

# API keys (sensitive - contains hashed keys)
pg_dump -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" \
  --table=api_keys \
  --data-only \
  -f "${TEMP_DIR}/api_keys.sql"

# Sessions (for active logins)
pg_dump -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" \
  --table=sessions \
  --data-only \
  -f "${TEMP_DIR}/sessions.sql"

log "Core user tables backed up."

# ============================================
# BACKUP SUBSCRIPTION/BILLING DATA
# ============================================
log "Backing up subscription and billing data..."

pg_dump -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" \
  --table=subscriptions \
  --table=invoices \
  --table=invoice_history \
  --table=plans \
  --data-only \
  -f "${TEMP_DIR}/billing.sql"

log "Billing data backed up."

# ============================================
# BACKUP USER CONTENT DATA
# ============================================
log "Backing up user content data..."

# Reasoning traces
pg_dump -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" \
  --table=reasoning_traces \
  --data-only \
  -f "${TEMP_DIR}/traces.sql"

# Procedural shards
pg_dump -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" \
  --table=procedural_shards \
  --table=shard_executions \
  --table=shard_evolutions \
  --table=shard_forks \
  --data-only \
  -f "${TEMP_DIR}/shards.sql"

# Episodes
pg_dump -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" \
  --table=episodes \
  --data-only \
  -f "${TEMP_DIR}/episodes.sql"

# Knowledge facts and relations
pg_dump -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" \
  --table=knowledge_facts \
  --table=knowledge_relations \
  --data-only \
  -f "${TEMP_DIR}/knowledge.sql"

# Working contexts
pg_dump -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" \
  --table=working_contexts \
  --data-only \
  -f "${TEMP_DIR}/working_contexts.sql"

log "User content data backed up."

# ============================================
# BACKUP USAGE AND AUDIT DATA
# ============================================
log "Backing up usage and audit data..."

pg_dump -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" \
  --table=tenant_usage \
  --table=usage_records \
  --table=audit_logs \
  --table=notification_preferences \
  --data-only \
  -f "${TEMP_DIR}/usage_audit.sql"

log "Usage and audit data backed up."

# ============================================
# BACKUP WAITLIST
# ============================================
log "Backing up waitlist data..."

pg_dump -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" \
  --table=waitlist \
  --data-only \
  -f "${TEMP_DIR}/waitlist.sql" 2>/dev/null || warn "Waitlist table not found (may not exist yet)"

log "Waitlist data backed up."

# ============================================
# CREATE BACKUP MANIFEST
# ============================================
log "Creating backup manifest..."

cat > "${TEMP_DIR}/manifest.json" << EOF
{
  "backup_name": "${BACKUP_NAME}",
  "timestamp": "$(date -Iseconds)",
  "database": "${DB_NAME}",
  "tables_backed_up": [
    "users",
    "tenants",
    "tenant_members",
    "api_keys",
    "sessions",
    "subscriptions",
    "invoices",
    "invoice_history",
    "plans",
    "reasoning_traces",
    "procedural_shards",
    "shard_executions",
    "shard_evolutions",
    "shard_forks",
    "episodes",
    "knowledge_facts",
    "knowledge_relations",
    "working_contexts",
    "tenant_usage",
    "usage_records",
    "audit_logs",
    "notification_preferences",
    "waitlist"
  ],
  "stats": {
    "users": $(psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" -t -c "SELECT COUNT(*) FROM users" 2>/dev/null || echo 0),
    "tenants": $(psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" -t -c "SELECT COUNT(*) FROM tenants" 2>/dev/null || echo 0),
    "traces": $(psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" -t -c "SELECT COUNT(*) FROM reasoning_traces" 2>/dev/null || echo 0),
    "shards": $(psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" -t -c "SELECT COUNT(*) FROM procedural_shards" 2>/dev/null || echo 0),
    "episodes": $(psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" -t -c "SELECT COUNT(*) FROM episodes" 2>/dev/null || echo 0),
    "waitlist": $(psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" -t -c "SELECT COUNT(*) FROM waitlist" 2>/dev/null || echo 0)
  }
}
EOF

# ============================================
# COMPRESS AND OPTIONALLY ENCRYPT
# ============================================
log "Compressing backup..."

cd "${TEMP_DIR}"
tar -czf "${BACKUP_NAME}.tar.gz" *.sql manifest.json

if [ -n "${ENCRYPTION_KEY}" ]; then
  log "Encrypting backup with AES-256..."
  openssl enc -aes-256-cbc -salt -pbkdf2 \
    -in "${BACKUP_NAME}.tar.gz" \
    -out "${BACKUP_NAME}.tar.gz.enc" \
    -pass pass:"${ENCRYPTION_KEY}"
  FINAL_FILE="${BACKUP_NAME}.tar.gz.enc"
  rm "${BACKUP_NAME}.tar.gz"
else
  warn "No encryption key set. Backup will NOT be encrypted."
  FINAL_FILE="${BACKUP_NAME}.tar.gz"
fi

# ============================================
# MOVE TO APPROPRIATE BACKUP LOCATION
# ============================================
DAY_OF_WEEK=$(date +%u)
DAY_OF_MONTH=$(date +%d)

# Daily backup
cp "${FINAL_FILE}" "${BACKUP_DIR}/daily/"
log "Daily backup saved: ${BACKUP_DIR}/daily/${FINAL_FILE}"

# Weekly backup (on Sundays)
if [ "${DAY_OF_WEEK}" -eq 7 ]; then
  cp "${FINAL_FILE}" "${BACKUP_DIR}/weekly/"
  log "Weekly backup saved: ${BACKUP_DIR}/weekly/${FINAL_FILE}"
fi

# Monthly backup (on 1st of month)
if [ "${DAY_OF_MONTH}" -eq "01" ]; then
  cp "${FINAL_FILE}" "${BACKUP_DIR}/monthly/"
  log "Monthly backup saved: ${BACKUP_DIR}/monthly/${FINAL_FILE}"
fi

# ============================================
# CLEANUP OLD BACKUPS
# ============================================
log "Cleaning up old backups (retention: ${RETENTION_DAYS} days)..."

# Clean daily backups older than RETENTION_DAYS
find "${BACKUP_DIR}/daily" -name "substrate_users_*.tar.gz*" -mtime +${RETENTION_DAYS} -delete 2>/dev/null || true

# Clean weekly backups older than 90 days
find "${BACKUP_DIR}/weekly" -name "substrate_users_*.tar.gz*" -mtime +90 -delete 2>/dev/null || true

# Clean monthly backups older than 365 days
find "${BACKUP_DIR}/monthly" -name "substrate_users_*.tar.gz*" -mtime +365 -delete 2>/dev/null || true

# ============================================
# SUMMARY
# ============================================
BACKUP_SIZE=$(du -h "${BACKUP_DIR}/daily/${FINAL_FILE}" | cut -f1)

log "============================================"
log "BACKUP COMPLETE"
log "============================================"
log "Backup file: ${FINAL_FILE}"
log "Size: ${BACKUP_SIZE}"
log "Location: ${BACKUP_DIR}/daily/"
if [ -n "${ENCRYPTION_KEY}" ]; then
  log "Encryption: AES-256-CBC (encrypted)"
else
  log "Encryption: NONE"
fi
log "============================================"

echo "${BACKUP_DIR}/daily/${FINAL_FILE}"
