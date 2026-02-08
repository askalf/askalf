#!/bin/bash
# ============================================
# SUBSTRATE Complete System Backup
# ============================================
# Comprehensive backup of all database tables organized by domain
# Includes schema, data, and detailed manifest for full system recovery
#
# Usage: ./backup-substrate.sh [--full|--data-only] [--no-compress]
#
# Environment Variables:
#   DB_HOST, DB_PORT, DB_NAME, DB_USER, POSTGRES_PASSWORD
#   BACKUP_DIR, RETENTION_DAYS, BACKUP_ENCRYPTION_KEY
# ============================================

set -euo pipefail

# ============================================
# CONFIGURATION
# ============================================
BACKUP_TYPE="${1:-full}"  # full or data-only
NO_COMPRESS="${2:-}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
DB_HOST="${DB_HOST:-postgres}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-substrate}"
DB_USER="${DB_USER:-substrate}"
ENCRYPTION_KEY="${BACKUP_ENCRYPTION_KEY:-}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_NAME="substrate_backup_${TIMESTAMP}"

export PGPASSWORD="${POSTGRES_PASSWORD:-${PGPASSWORD:-}}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()   { echo -e "${GREEN}[$(date '+%H:%M:%S')]${NC} $1"; }
warn()  { echo -e "${YELLOW}[$(date '+%H:%M:%S')] WARN:${NC} $1"; }
error() { echo -e "${RED}[$(date '+%H:%M:%S')] ERROR:${NC} $1"; }
info()  { echo -e "${BLUE}[$(date '+%H:%M:%S')] INFO:${NC} $1"; }

# ============================================
# TABLE DEFINITIONS BY DOMAIN
# ============================================

# Core Identity & Auth
TABLES_IDENTITY=(
  "users"
  "tenants"
  "tenant_members"
  "api_keys"
  "platform_api_keys"
  "sessions"
  "user_secrets"
)

# Billing & Subscriptions
TABLES_BILLING=(
  "plans"
  "subscriptions"
  "invoices"
  "invoice_history"
  "credit_bank"
  "promo_codes"
  "promo_redemptions"
  "token_bundles"
  "token_economics"
  "tier_limits"
  "model_access_tiers"
)

# Usage & Metering
TABLES_USAGE=(
  "tenant_usage"
  "usage_records"
  "user_daily_usage"
  "rate_limit_records"
  "global_counters"
)

# AI Memory & Knowledge (Core ALF Data)
TABLES_MEMORY=(
  "procedural_shards"
  "shard_executions"
  "shard_evolutions"
  "shard_forks"
  "shard_performance"
  "shard_submissions"
  "knowledge_facts"
  "knowledge_relations"
  "working_contexts"
  "episodes"
  "reasoning_traces"
  "metacognition_events"
  "blackboard_entries"
  "alf_profiles"
)

# Chat & Conversations
TABLES_CHAT=(
  "chat_sessions"
  "chat_messages"
  "demo_sessions"
)

# Integrations & Connectors
TABLES_INTEGRATIONS=(
  "user_connectors"
  "user_ai_connectors"
  "mcp_connections"
  "mcp_requests"
)

# Audit & Monitoring
TABLES_AUDIT=(
  "audit_logs"
  "audit_gates"
  "response_quality_metrics"
  "notification_preferences"
)

# Marketing & Waitlist
TABLES_MARKETING=(
  "waitlist"
  "email_queue"
)

# System (usually not needed for restore, but good to have)
TABLES_SYSTEM=(
  "migrations"
)

# ============================================
# FUNCTIONS
# ============================================

backup_table() {
  local table=$1
  local output_file=$2
  local data_only=${3:-true}

  if [ "$data_only" = "true" ]; then
    pg_dump -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" \
      --table="${table}" --data-only --column-inserts \
      -f "${output_file}" 2>/dev/null
  else
    pg_dump -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" \
      --table="${table}" --column-inserts \
      -f "${output_file}" 2>/dev/null
  fi

  return $?
}

get_row_count() {
  local table=$1
  psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" \
    -t -c "SELECT COUNT(*) FROM ${table}" 2>/dev/null | tr -d ' ' || echo "0"
}

get_table_size() {
  local table=$1
  psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" \
    -t -c "SELECT pg_size_pretty(pg_total_relation_size('${table}'))" 2>/dev/null | tr -d ' ' || echo "0"
}

backup_table_group() {
  local group_name=$1
  local output_dir=$2
  shift 2
  local tables=("$@")

  log "Backing up ${group_name} (${#tables[@]} tables)..."

  local success=0
  local failed=0

  for table in "${tables[@]}"; do
    if backup_table "${table}" "${output_dir}/${table}.sql" "${DATA_ONLY}"; then
      success=$((success + 1))
    else
      warn "Table ${table} not found or empty"
      failed=$((failed + 1))
    fi
  done

  info "  ${success} tables backed up, ${failed} skipped"
}

# ============================================
# MAIN BACKUP PROCESS
# ============================================

echo ""
echo "============================================"
echo "  SUBSTRATE Complete System Backup"
echo "============================================"
echo ""

# Validate connection
if ! psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" -c "SELECT 1" >/dev/null 2>&1; then
  error "Cannot connect to database at ${DB_HOST}:${DB_PORT}"
  exit 1
fi

log "Connected to ${DB_NAME}@${DB_HOST}"

# Determine backup mode
DATA_ONLY="true"
if [ "${BACKUP_TYPE}" = "full" ]; then
  DATA_ONLY="false"
  log "Backup mode: FULL (schema + data)"
else
  log "Backup mode: DATA-ONLY"
fi

# Create temp directory
TEMP_DIR=$(mktemp -d)
trap "rm -rf ${TEMP_DIR}" EXIT

mkdir -p "${TEMP_DIR}/identity"
mkdir -p "${TEMP_DIR}/billing"
mkdir -p "${TEMP_DIR}/usage"
mkdir -p "${TEMP_DIR}/memory"
mkdir -p "${TEMP_DIR}/chat"
mkdir -p "${TEMP_DIR}/integrations"
mkdir -p "${TEMP_DIR}/audit"
mkdir -p "${TEMP_DIR}/marketing"
mkdir -p "${TEMP_DIR}/system"

# ============================================
# BACKUP SCHEMA (for full backups)
# ============================================
if [ "${BACKUP_TYPE}" = "full" ]; then
  log "Backing up database schema..."
  pg_dump -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" \
    --schema-only --no-owner --no-privileges \
    -f "${TEMP_DIR}/schema.sql"
  info "  Schema saved to schema.sql"
fi

# ============================================
# BACKUP ALL TABLE GROUPS
# ============================================
backup_table_group "Identity & Auth" "${TEMP_DIR}/identity" "${TABLES_IDENTITY[@]}"
backup_table_group "Billing & Subscriptions" "${TEMP_DIR}/billing" "${TABLES_BILLING[@]}"
backup_table_group "Usage & Metering" "${TEMP_DIR}/usage" "${TABLES_USAGE[@]}"
backup_table_group "AI Memory & Knowledge" "${TEMP_DIR}/memory" "${TABLES_MEMORY[@]}"
backup_table_group "Chat & Conversations" "${TEMP_DIR}/chat" "${TABLES_CHAT[@]}"
backup_table_group "Integrations" "${TEMP_DIR}/integrations" "${TABLES_INTEGRATIONS[@]}"
backup_table_group "Audit & Monitoring" "${TEMP_DIR}/audit" "${TABLES_AUDIT[@]}"
backup_table_group "Marketing" "${TEMP_DIR}/marketing" "${TABLES_MARKETING[@]}"
backup_table_group "System" "${TEMP_DIR}/system" "${TABLES_SYSTEM[@]}"

# ============================================
# CREATE DETAILED MANIFEST
# ============================================
log "Creating backup manifest..."

# Get database stats
DB_SIZE=$(psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" \
  -t -c "SELECT pg_size_pretty(pg_database_size('${DB_NAME}'))" 2>/dev/null | tr -d ' ')

cat > "${TEMP_DIR}/manifest.json" << MANIFEST_EOF
{
  "backup_name": "${BACKUP_NAME}",
  "backup_type": "${BACKUP_TYPE}",
  "timestamp": "$(date -Iseconds 2>/dev/null || date)",
  "database": {
    "name": "${DB_NAME}",
    "host": "${DB_HOST}",
    "size": "${DB_SIZE}"
  },
  "domains": {
    "identity": {
      "tables": $(printf '%s\n' "${TABLES_IDENTITY[@]}" | jq -R . | jq -s .),
      "stats": {
        "users": $(get_row_count users),
        "tenants": $(get_row_count tenants),
        "api_keys": $(get_row_count api_keys),
        "sessions": $(get_row_count sessions)
      }
    },
    "billing": {
      "tables": $(printf '%s\n' "${TABLES_BILLING[@]}" | jq -R . | jq -s .),
      "stats": {
        "subscriptions": $(get_row_count subscriptions),
        "invoices": $(get_row_count invoices),
        "plans": $(get_row_count plans)
      }
    },
    "usage": {
      "tables": $(printf '%s\n' "${TABLES_USAGE[@]}" | jq -R . | jq -s .),
      "stats": {
        "usage_records": $(get_row_count usage_records),
        "tenant_usage": $(get_row_count tenant_usage)
      }
    },
    "memory": {
      "tables": $(printf '%s\n' "${TABLES_MEMORY[@]}" | jq -R . | jq -s .),
      "stats": {
        "procedural_shards": $(get_row_count procedural_shards),
        "shard_executions": $(get_row_count shard_executions),
        "knowledge_facts": $(get_row_count knowledge_facts),
        "episodes": $(get_row_count episodes),
        "reasoning_traces": $(get_row_count reasoning_traces)
      }
    },
    "chat": {
      "tables": $(printf '%s\n' "${TABLES_CHAT[@]}" | jq -R . | jq -s .),
      "stats": {
        "chat_sessions": $(get_row_count chat_sessions),
        "chat_messages": $(get_row_count chat_messages),
        "demo_sessions": $(get_row_count demo_sessions)
      }
    },
    "integrations": {
      "tables": $(printf '%s\n' "${TABLES_INTEGRATIONS[@]}" | jq -R . | jq -s .),
      "stats": {
        "mcp_connections": $(get_row_count mcp_connections),
        "user_connectors": $(get_row_count user_connectors)
      }
    },
    "audit": {
      "tables": $(printf '%s\n' "${TABLES_AUDIT[@]}" | jq -R . | jq -s .),
      "stats": {
        "audit_logs": $(get_row_count audit_logs)
      }
    },
    "marketing": {
      "tables": $(printf '%s\n' "${TABLES_MARKETING[@]}" | jq -R . | jq -s .),
      "stats": {
        "waitlist": $(get_row_count waitlist),
        "email_queue": $(get_row_count email_queue)
      }
    }
  },
  "encryption": $([ -n "${ENCRYPTION_KEY}" ] && echo "true" || echo "false"),
  "restore_order": [
    "schema.sql (if full backup)",
    "identity/*.sql",
    "billing/*.sql",
    "usage/*.sql",
    "memory/*.sql",
    "chat/*.sql",
    "integrations/*.sql",
    "audit/*.sql",
    "marketing/*.sql"
  ]
}
MANIFEST_EOF

info "  Manifest created with database stats"

# ============================================
# COMPRESS AND ENCRYPT
# ============================================
log "Packaging backup..."

mkdir -p "${BACKUP_DIR}/daily"
mkdir -p "${BACKUP_DIR}/weekly"
mkdir -p "${BACKUP_DIR}/monthly"

cd "${TEMP_DIR}"

if [ "${NO_COMPRESS}" != "--no-compress" ]; then
  tar -czf "${BACKUP_NAME}.tar.gz" \
    manifest.json \
    $([ -f schema.sql ] && echo "schema.sql") \
    identity/ billing/ usage/ memory/ chat/ integrations/ audit/ marketing/ system/

  if [ -n "${ENCRYPTION_KEY}" ]; then
    log "Encrypting backup with AES-256..."
    openssl enc -aes-256-cbc -salt -pbkdf2 -iter 100000 \
      -in "${BACKUP_NAME}.tar.gz" \
      -out "${BACKUP_NAME}.tar.gz.enc" \
      -pass pass:"${ENCRYPTION_KEY}"
    FINAL_FILE="${BACKUP_NAME}.tar.gz.enc"
    rm "${BACKUP_NAME}.tar.gz"
  else
    warn "No encryption key set - backup is NOT encrypted"
    FINAL_FILE="${BACKUP_NAME}.tar.gz"
  fi
else
  # No compression - just tar
  tar -cf "${BACKUP_NAME}.tar" \
    manifest.json \
    $([ -f schema.sql ] && echo "schema.sql") \
    identity/ billing/ usage/ memory/ chat/ integrations/ audit/ marketing/ system/
  FINAL_FILE="${BACKUP_NAME}.tar"
fi

# ============================================
# SAVE TO BACKUP LOCATIONS
# ============================================
cp "${FINAL_FILE}" "${BACKUP_DIR}/daily/"
log "Daily backup saved"

DAY_OF_WEEK=$(date +%u)
DAY_OF_MONTH=$(date +%d)

if [ "${DAY_OF_WEEK}" -eq 7 ]; then
  cp "${FINAL_FILE}" "${BACKUP_DIR}/weekly/"
  log "Weekly backup saved (Sunday)"
fi

if [ "${DAY_OF_MONTH}" = "01" ]; then
  cp "${FINAL_FILE}" "${BACKUP_DIR}/monthly/"
  log "Monthly backup saved (1st of month)"
fi

# ============================================
# CLEANUP OLD BACKUPS
# ============================================
log "Cleaning old backups..."
find "${BACKUP_DIR}/daily" -name "substrate_backup_*.tar*" -mtime +${RETENTION_DAYS} -delete 2>/dev/null || true
find "${BACKUP_DIR}/weekly" -name "substrate_backup_*.tar*" -mtime +90 -delete 2>/dev/null || true
find "${BACKUP_DIR}/monthly" -name "substrate_backup_*.tar*" -mtime +365 -delete 2>/dev/null || true

# ============================================
# SUMMARY
# ============================================
BACKUP_SIZE=$(du -h "${BACKUP_DIR}/daily/${FINAL_FILE}" 2>/dev/null | cut -f1 || echo "unknown")

echo ""
echo "============================================"
echo -e "${GREEN}  BACKUP COMPLETE${NC}"
echo "============================================"
echo "  File: ${FINAL_FILE}"
echo "  Size: ${BACKUP_SIZE}"
echo "  Type: ${BACKUP_TYPE}"
echo "  Encrypted: $([ -n "${ENCRYPTION_KEY}" ] && echo "Yes (AES-256)" || echo "No")"
echo "  Location: ${BACKUP_DIR}/daily/"
echo "============================================"
echo ""

# Output path for automation
echo "${BACKUP_DIR}/daily/${FINAL_FILE}"
