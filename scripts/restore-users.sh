#!/bin/bash
# SUBSTRATE User Account Restore Script
# Restores user account data from backup

set -e

# Configuration
DB_HOST="${DB_HOST:-postgres}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-substrate}"
DB_USER="${DB_USER:-substrate}"
ENCRYPTION_KEY="${BACKUP_ENCRYPTION_KEY:-}"

# Export PGPASSWORD for non-interactive psql
export PGPASSWORD="${POSTGRES_PASSWORD:-${PGPASSWORD:-}}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log() { echo -e "${GREEN}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1"; }
warn() { echo -e "${YELLOW}[$(date '+%Y-%m-%d %H:%M:%S')] WARNING:${NC} $1"; }
error() { echo -e "${RED}[$(date '+%Y-%m-%d %H:%M:%S')] ERROR:${NC} $1"; exit 1; }
info() { echo -e "${CYAN}[$(date '+%Y-%m-%d %H:%M:%S')] INFO:${NC} $1"; }

usage() {
  echo "SUBSTRATE User Account Restore Script"
  echo ""
  echo "Usage: $0 <backup_file> [options]"
  echo ""
  echo "Options:"
  echo "  --dry-run         Show what would be restored without making changes"
  echo "  --tables TABLE    Restore only specific tables (comma-separated)"
  echo "  --user USER_ID    Restore only data for specific user"
  echo "  --tenant TENANT   Restore only data for specific tenant"
  echo "  --no-confirm      Skip confirmation prompts"
  echo "  --help            Show this help message"
  echo ""
  echo "Examples:"
  echo "  $0 substrate_users_20260113.tar.gz"
  echo "  $0 substrate_users_20260113.tar.gz.enc --tables users,api_keys"
  echo "  $0 backup.tar.gz --tenant tenant_01ABC123 --dry-run"
  exit 0
}

# Parse arguments
BACKUP_FILE=""
DRY_RUN=false
TABLES=""
USER_ID=""
TENANT_ID=""
NO_CONFIRM=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --tables)
      TABLES="$2"
      shift 2
      ;;
    --user)
      USER_ID="$2"
      shift 2
      ;;
    --tenant)
      TENANT_ID="$2"
      shift 2
      ;;
    --no-confirm)
      NO_CONFIRM=true
      shift
      ;;
    --help)
      usage
      ;;
    *)
      if [ -z "${BACKUP_FILE}" ]; then
        BACKUP_FILE="$1"
      fi
      shift
      ;;
  esac
done

if [ -z "${BACKUP_FILE}" ]; then
  error "No backup file specified. Use --help for usage."
fi

if [ ! -f "${BACKUP_FILE}" ]; then
  error "Backup file not found: ${BACKUP_FILE}"
fi

log "============================================"
log "SUBSTRATE User Account Restore"
log "============================================"
log "Backup file: ${BACKUP_FILE}"
log "Database: ${DB_NAME}@${DB_HOST}:${DB_PORT}"
if [ "${DRY_RUN}" = true ]; then
  warn "DRY RUN MODE - No changes will be made"
fi

# Create temporary directory
TEMP_DIR=$(mktemp -d)
trap "rm -rf ${TEMP_DIR}" EXIT

# ============================================
# DECRYPT AND EXTRACT BACKUP
# ============================================
log "Extracting backup..."

if [[ "${BACKUP_FILE}" == *.enc ]]; then
  if [ -z "${ENCRYPTION_KEY}" ]; then
    error "Backup is encrypted but BACKUP_ENCRYPTION_KEY is not set"
  fi
  log "Decrypting backup..."
  openssl enc -aes-256-cbc -d -pbkdf2 \
    -in "${BACKUP_FILE}" \
    -out "${TEMP_DIR}/backup.tar.gz" \
    -pass pass:"${ENCRYPTION_KEY}"
  tar -xzf "${TEMP_DIR}/backup.tar.gz" -C "${TEMP_DIR}"
else
  tar -xzf "${BACKUP_FILE}" -C "${TEMP_DIR}"
fi

# Check manifest
if [ -f "${TEMP_DIR}/manifest.json" ]; then
  log "Backup manifest found:"
  cat "${TEMP_DIR}/manifest.json" | head -20
  echo ""
fi

# ============================================
# DETERMINE TABLES TO RESTORE
# ============================================
RESTORE_TABLES=()

if [ -n "${TABLES}" ]; then
  IFS=',' read -ra RESTORE_TABLES <<< "${TABLES}"
else
  # Default: all tables
  RESTORE_TABLES=(
    "users"
    "tenants"
    "tenant_members"
    "api_keys"
    "sessions"
    "billing"
    "traces"
    "shards"
    "episodes"
    "knowledge"
    "working_contexts"
    "usage_audit"
  )
fi

log "Tables to restore: ${RESTORE_TABLES[*]}"

# ============================================
# CONFIRMATION
# ============================================
if [ "${NO_CONFIRM}" = false ] && [ "${DRY_RUN}" = false ]; then
  echo ""
  warn "This will OVERWRITE existing data in the database!"
  echo -n "Are you sure you want to proceed? (yes/no): "
  read -r CONFIRM
  if [ "${CONFIRM}" != "yes" ]; then
    log "Restore cancelled."
    exit 0
  fi
fi

# ============================================
# RESTORE TABLES
# ============================================
restore_sql_file() {
  local file="$1"
  local table_name="$2"

  if [ ! -f "${TEMP_DIR}/${file}" ]; then
    warn "SQL file not found: ${file}, skipping..."
    return
  fi

  if [ "${DRY_RUN}" = true ]; then
    info "[DRY RUN] Would restore: ${file}"
    return
  fi

  log "Restoring ${table_name}..."

  # If restoring specific tenant/user, filter the data
  if [ -n "${TENANT_ID}" ] || [ -n "${USER_ID}" ]; then
    # Create filtered version
    FILTER_FILE="${TEMP_DIR}/${file}.filtered"

    if [ -n "${TENANT_ID}" ]; then
      grep -E "(tenant_id|owner_id).*${TENANT_ID}" "${TEMP_DIR}/${file}" > "${FILTER_FILE}" 2>/dev/null || true
    elif [ -n "${USER_ID}" ]; then
      grep -E "user_id.*${USER_ID}" "${TEMP_DIR}/${file}" > "${FILTER_FILE}" 2>/dev/null || true
    fi

    if [ -s "${FILTER_FILE}" ]; then
      psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" -f "${FILTER_FILE}" 2>/dev/null || warn "Some records may have conflicts"
    else
      warn "No matching records found for filter in ${table_name}"
    fi
  else
    # Restore full file
    psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" -f "${TEMP_DIR}/${file}" 2>/dev/null || warn "Some records may have conflicts"
  fi
}

for table in "${RESTORE_TABLES[@]}"; do
  case "${table}" in
    users)
      restore_sql_file "users.sql" "users"
      ;;
    tenants)
      restore_sql_file "tenants.sql" "tenants"
      ;;
    tenant_members)
      restore_sql_file "tenant_members.sql" "tenant_members"
      ;;
    api_keys)
      restore_sql_file "api_keys.sql" "api_keys"
      ;;
    sessions)
      restore_sql_file "sessions.sql" "sessions"
      ;;
    billing)
      restore_sql_file "billing.sql" "subscriptions, invoices, plans"
      ;;
    traces)
      restore_sql_file "traces.sql" "reasoning_traces"
      ;;
    shards)
      restore_sql_file "shards.sql" "procedural_shards, shard_*"
      ;;
    episodes)
      restore_sql_file "episodes.sql" "episodes"
      ;;
    knowledge)
      restore_sql_file "knowledge.sql" "knowledge_facts, knowledge_relations"
      ;;
    working_contexts)
      restore_sql_file "working_contexts.sql" "working_contexts"
      ;;
    usage_audit)
      restore_sql_file "usage_audit.sql" "tenant_usage, usage_records, audit_logs"
      ;;
    *)
      warn "Unknown table: ${table}"
      ;;
  esac
done

# ============================================
# SUMMARY
# ============================================
log "============================================"
if [ "${DRY_RUN}" = true ]; then
  log "DRY RUN COMPLETE - No changes were made"
else
  log "RESTORE COMPLETE"
fi
log "============================================"

# Show current stats
if [ "${DRY_RUN}" = false ]; then
  log "Current database stats:"
  psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" -c "
    SELECT 'users' as table_name, COUNT(*) as count FROM users
    UNION ALL SELECT 'tenants', COUNT(*) FROM tenants
    UNION ALL SELECT 'api_keys', COUNT(*) FROM api_keys
    UNION ALL SELECT 'traces', COUNT(*) FROM reasoning_traces
    UNION ALL SELECT 'shards', COUNT(*) FROM procedural_shards
    UNION ALL SELECT 'episodes', COUNT(*) FROM episodes;
  " 2>/dev/null || true
fi
