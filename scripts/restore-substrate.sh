#!/bin/bash
# ============================================
# SUBSTRATE Complete System Restore
# ============================================
# Restores a backup created by backup-substrate.sh
#
# Usage: ./restore-substrate.sh <backup_file> [--dry-run] [--domain=<domain>]
#
# Options:
#   --dry-run          Show what would be restored without executing
#   --domain=<domain>  Restore only specific domain (identity, billing, etc.)
#   --schema-only      Restore only schema, no data
#   --data-only        Restore only data, assume schema exists
#
# Environment Variables:
#   DB_HOST, DB_PORT, DB_NAME, DB_USER, POSTGRES_PASSWORD
#   BACKUP_ENCRYPTION_KEY (if backup is encrypted)
# ============================================

set -euo pipefail

# ============================================
# CONFIGURATION
# ============================================
BACKUP_FILE="${1:-}"
DRY_RUN="false"
DOMAIN_FILTER=""
SCHEMA_ONLY="false"
DATA_ONLY="false"

DB_HOST="${DB_HOST:-postgres}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-substrate}"
DB_USER="${DB_USER:-substrate}"
ENCRYPTION_KEY="${BACKUP_ENCRYPTION_KEY:-}"

export PGPASSWORD="${POSTGRES_PASSWORD:-${PGPASSWORD:-}}"

# Parse arguments
shift || true
for arg in "$@"; do
  case $arg in
    --dry-run)
      DRY_RUN="true"
      ;;
    --domain=*)
      DOMAIN_FILTER="${arg#*=}"
      ;;
    --schema-only)
      SCHEMA_ONLY="true"
      ;;
    --data-only)
      DATA_ONLY="true"
      ;;
    *)
      echo "Unknown option: $arg"
      exit 1
      ;;
  esac
done

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()   { echo -e "${GREEN}[$(date '+%H:%M:%S')]${NC} $1"; }
warn()  { echo -e "${YELLOW}[$(date '+%H:%M:%S')] WARN:${NC} $1"; }
error() { echo -e "${RED}[$(date '+%H:%M:%S')] ERROR:${NC} $1"; exit 1; }
info()  { echo -e "${BLUE}[$(date '+%H:%M:%S')] INFO:${NC} $1"; }

# ============================================
# VALIDATION
# ============================================

if [ -z "${BACKUP_FILE}" ]; then
  echo "Usage: $0 <backup_file> [--dry-run] [--domain=<domain>]"
  echo ""
  echo "Domains: identity, billing, usage, memory, chat, integrations, audit, marketing"
  exit 1
fi

if [ ! -f "${BACKUP_FILE}" ]; then
  error "Backup file not found: ${BACKUP_FILE}"
fi

echo ""
echo "============================================"
echo "  SUBSTRATE System Restore"
echo "============================================"
echo ""

# ============================================
# EXTRACT BACKUP
# ============================================
log "Preparing backup for restore..."

TEMP_DIR=$(mktemp -d)
trap "rm -rf ${TEMP_DIR}" EXIT

cd "${TEMP_DIR}"

# Determine if encrypted
if [[ "${BACKUP_FILE}" == *.enc ]]; then
  if [ -z "${ENCRYPTION_KEY}" ]; then
    error "Backup is encrypted but BACKUP_ENCRYPTION_KEY not set"
  fi
  log "Decrypting backup..."
  openssl enc -aes-256-cbc -d -pbkdf2 -iter 100000 \
    -in "${BACKUP_FILE}" \
    -out backup.tar.gz \
    -pass pass:"${ENCRYPTION_KEY}"
  tar -xzf backup.tar.gz
elif [[ "${BACKUP_FILE}" == *.tar.gz ]]; then
  tar -xzf "${BACKUP_FILE}"
elif [[ "${BACKUP_FILE}" == *.tar ]]; then
  tar -xf "${BACKUP_FILE}"
else
  error "Unknown backup format: ${BACKUP_FILE}"
fi

# ============================================
# READ MANIFEST
# ============================================
if [ ! -f manifest.json ]; then
  error "No manifest.json found in backup"
fi

log "Reading backup manifest..."
BACKUP_NAME=$(jq -r '.backup_name' manifest.json)
BACKUP_TYPE=$(jq -r '.backup_type' manifest.json)
BACKUP_TIME=$(jq -r '.timestamp' manifest.json)

info "  Backup: ${BACKUP_NAME}"
info "  Type: ${BACKUP_TYPE}"
info "  Created: ${BACKUP_TIME}"

if [ "${DRY_RUN}" = "true" ]; then
  echo ""
  warn "DRY RUN MODE - No changes will be made"
  echo ""
fi

# ============================================
# VALIDATE DATABASE CONNECTION
# ============================================
if [ "${DRY_RUN}" != "true" ]; then
  if ! psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" -c "SELECT 1" >/dev/null 2>&1; then
    error "Cannot connect to database at ${DB_HOST}:${DB_PORT}"
  fi
  log "Connected to ${DB_NAME}@${DB_HOST}"
fi

# ============================================
# RESTORE FUNCTIONS
# ============================================

restore_sql_file() {
  local file=$1
  local table_name=$(basename "${file}" .sql)

  if [ ! -f "${file}" ]; then
    return 1
  fi

  if [ "${DRY_RUN}" = "true" ]; then
    info "  Would restore: ${table_name}"
    return 0
  fi

  # Check if file has content (more than just comments)
  if ! grep -q "^INSERT\|^COPY" "${file}" 2>/dev/null; then
    info "  Skipping empty: ${table_name}"
    return 0
  fi

  psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" \
    -f "${file}" >/dev/null 2>&1 && \
    info "  Restored: ${table_name}" || \
    warn "  Failed: ${table_name}"
}

restore_domain() {
  local domain=$1
  local domain_dir=$2

  if [ ! -d "${domain_dir}" ]; then
    warn "Domain directory not found: ${domain_dir}"
    return
  fi

  log "Restoring ${domain}..."

  for sql_file in "${domain_dir}"/*.sql; do
    [ -f "${sql_file}" ] && restore_sql_file "${sql_file}"
  done
}

# ============================================
# SCHEMA RESTORE
# ============================================
if [ "${DATA_ONLY}" != "true" ] && [ -f "schema.sql" ]; then
  log "Restoring schema..."

  if [ "${DRY_RUN}" = "true" ]; then
    info "  Would restore: schema.sql"
  else
    if [ "${SCHEMA_ONLY}" = "true" ] || [ "${BACKUP_TYPE}" = "full" ]; then
      psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" \
        -f "schema.sql" >/dev/null 2>&1 && \
        info "  Schema restored" || \
        warn "  Schema restore had warnings (tables may already exist)"
    fi
  fi
fi

if [ "${SCHEMA_ONLY}" = "true" ]; then
  log "Schema-only restore complete"
  exit 0
fi

# ============================================
# DATA RESTORE
# ============================================

# Define restore order (respects foreign key dependencies)
DOMAINS=(
  "identity"
  "billing"
  "usage"
  "memory"
  "chat"
  "integrations"
  "audit"
  "marketing"
  "system"
)

if [ -n "${DOMAIN_FILTER}" ]; then
  log "Filtering to domain: ${DOMAIN_FILTER}"
  DOMAINS=("${DOMAIN_FILTER}")
fi

for domain in "${DOMAINS[@]}"; do
  if [ -d "${domain}" ]; then
    restore_domain "${domain}" "${domain}"
  fi
done

# ============================================
# POST-RESTORE VALIDATION
# ============================================
if [ "${DRY_RUN}" != "true" ]; then
  log "Validating restore..."

  USER_COUNT=$(psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" \
    -t -c "SELECT COUNT(*) FROM users" 2>/dev/null | tr -d ' ' || echo "?")
  TENANT_COUNT=$(psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" \
    -t -c "SELECT COUNT(*) FROM tenants" 2>/dev/null | tr -d ' ' || echo "?")
  SHARD_COUNT=$(psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" \
    -t -c "SELECT COUNT(*) FROM procedural_shards" 2>/dev/null | tr -d ' ' || echo "?")

  info "  Users: ${USER_COUNT}"
  info "  Tenants: ${TENANT_COUNT}"
  info "  Shards: ${SHARD_COUNT}"
fi

# ============================================
# SUMMARY
# ============================================
echo ""
echo "============================================"
if [ "${DRY_RUN}" = "true" ]; then
  echo -e "${YELLOW}  DRY RUN COMPLETE${NC}"
  echo "  No changes were made"
else
  echo -e "${GREEN}  RESTORE COMPLETE${NC}"
fi
echo "============================================"
echo "  Backup: ${BACKUP_NAME}"
echo "  Domains: ${DOMAINS[*]}"
echo "============================================"
echo ""
