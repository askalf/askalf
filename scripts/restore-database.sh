#!/bin/bash
# SUBSTRATE Full Database Restore Script
# Restores a complete database backup from encrypted .sql.gz.enc file
#
# Usage:
#   ./restore-database.sh <backup_file.sql.gz.enc> [options]
#
# Prerequisites:
#   - BACKUP_ENCRYPTION_KEY environment variable set
#   - POSTGRES_PASSWORD environment variable set (or in .env.production)
#   - Docker running with substrate-prod-postgres container

set -e

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
  echo "SUBSTRATE Full Database Restore Script"
  echo ""
  echo "Usage: $0 <backup_file> [options]"
  echo ""
  echo "Arguments:"
  echo "  backup_file         Path to encrypted backup (.sql.gz.enc)"
  echo ""
  echo "Options:"
  echo "  --dry-run           Show what would be done without making changes"
  echo "  --no-confirm        Skip confirmation prompts"
  echo "  --container NAME    Docker container name (default: substrate-prod-postgres)"
  echo "  --database NAME     Database name (default: substrate)"
  echo "  --user NAME         Database user (default: substrate)"
  echo "  --help              Show this help message"
  echo ""
  echo "Environment Variables:"
  echo "  BACKUP_ENCRYPTION_KEY   Required for encrypted backups"
  echo "  POSTGRES_PASSWORD       Database password (or uses .env.production)"
  echo ""
  echo "Examples:"
  echo "  # Restore most recent daily backup"
  echo "  BACKUP_ENCRYPTION_KEY=xxx ./restore-database.sh backups/daily/substrate-20260124.sql.gz.enc"
  echo ""
  echo "  # Dry run to see what would happen"
  echo "  ./restore-database.sh backups/daily/substrate-20260124.sql.gz.enc --dry-run"
  echo ""
  echo "  # Restore with auto-confirm (for scripts)"
  echo "  ./restore-database.sh backup.sql.gz.enc --no-confirm"
  exit 0
}

# Parse arguments
BACKUP_FILE=""
DRY_RUN=false
NO_CONFIRM=false
CONTAINER="substrate-prod-postgres"
DATABASE="substrate"
DB_USER="substrate"

while [[ $# -gt 0 ]]; do
  case $1 in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --no-confirm)
      NO_CONFIRM=true
      shift
      ;;
    --container)
      CONTAINER="$2"
      shift 2
      ;;
    --database)
      DATABASE="$2"
      shift 2
      ;;
    --user)
      DB_USER="$2"
      shift 2
      ;;
    --help|-h)
      usage
      ;;
    -*)
      error "Unknown option: $1"
      ;;
    *)
      if [ -z "${BACKUP_FILE}" ]; then
        BACKUP_FILE="$1"
      fi
      shift
      ;;
  esac
done

# Validate arguments
if [ -z "${BACKUP_FILE}" ]; then
  error "No backup file specified. Use --help for usage."
fi

if [ ! -f "${BACKUP_FILE}" ]; then
  error "Backup file not found: ${BACKUP_FILE}"
fi

# Check if file is encrypted
IS_ENCRYPTED=false
if [[ "${BACKUP_FILE}" == *.enc ]]; then
  IS_ENCRYPTED=true
  if [ -z "${BACKUP_ENCRYPTION_KEY}" ]; then
    error "Backup is encrypted but BACKUP_ENCRYPTION_KEY is not set"
  fi
fi

# Check Docker container
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
  error "Docker container '${CONTAINER}' is not running"
fi

# ============================================
# DISPLAY INFO
# ============================================
echo ""
log "============================================"
log "SUBSTRATE Full Database Restore"
log "============================================"
log ""
log "Backup file:    ${BACKUP_FILE}"
log "Encrypted:      ${IS_ENCRYPTED}"
log "Container:      ${CONTAINER}"
log "Database:       ${DATABASE}"
log "User:           ${DB_USER}"
log ""

if [ "${DRY_RUN}" = true ]; then
  warn "DRY RUN MODE - No changes will be made"
  echo ""
fi

# Get backup file size
FILE_SIZE=$(ls -lh "${BACKUP_FILE}" | awk '{print $5}')
log "Backup file size: ${FILE_SIZE}"

# ============================================
# CONFIRMATION
# ============================================
if [ "${NO_CONFIRM}" = false ] && [ "${DRY_RUN}" = false ]; then
  echo ""
  echo -e "${RED}============================================${NC}"
  echo -e "${RED}                  WARNING                   ${NC}"
  echo -e "${RED}============================================${NC}"
  echo ""
  echo "This will:"
  echo "  1. Drop and recreate the '${DATABASE}' database"
  echo "  2. Restore all data from the backup"
  echo "  3. PERMANENTLY DELETE all current data"
  echo ""
  echo -e "${YELLOW}Current database will be COMPLETELY REPLACED${NC}"
  echo ""
  echo -n "Type 'yes' to proceed: "
  read -r CONFIRM
  if [ "${CONFIRM}" != "yes" ]; then
    log "Restore cancelled by user."
    exit 0
  fi
  echo ""
fi

# ============================================
# CREATE TEMPORARY WORKING DIRECTORY
# ============================================
TEMP_DIR=$(mktemp -d)
trap "rm -rf ${TEMP_DIR}" EXIT

log "Working directory: ${TEMP_DIR}"

# ============================================
# DECRYPT BACKUP (if encrypted)
# ============================================
if [ "${IS_ENCRYPTED}" = true ]; then
  log "Decrypting backup..."

  if [ "${DRY_RUN}" = true ]; then
    info "[DRY RUN] Would decrypt: ${BACKUP_FILE}"
    DECRYPTED_FILE="${TEMP_DIR}/backup.sql.gz"
  else
    DECRYPTED_FILE="${TEMP_DIR}/backup.sql.gz"
    openssl enc -aes-256-cbc -d -pbkdf2 -iter 100000 \
      -in "${BACKUP_FILE}" \
      -out "${DECRYPTED_FILE}" \
      -pass env:BACKUP_ENCRYPTION_KEY

    log "Decryption successful"
  fi
else
  DECRYPTED_FILE="${BACKUP_FILE}"
fi

# ============================================
# VERIFY BACKUP
# ============================================
if [ "${DRY_RUN}" = false ]; then
  log "Verifying backup integrity..."

  # Check if it's valid gzip
  if ! gzip -t "${DECRYPTED_FILE}" 2>/dev/null; then
    error "Backup file appears to be corrupted (invalid gzip)"
  fi

  # Check first few lines of SQL
  FIRST_LINES=$(gunzip -c "${DECRYPTED_FILE}" | head -20)
  if ! echo "${FIRST_LINES}" | grep -qE "(PostgreSQL|pg_dump|CREATE|COPY)"; then
    warn "Backup may not be a valid PostgreSQL dump"
  fi

  log "Backup verification passed"
fi

# ============================================
# PRE-RESTORE: CREATE BACKUP OF CURRENT STATE
# ============================================
if [ "${DRY_RUN}" = false ]; then
  log "Creating safety backup of current database..."

  SAFETY_BACKUP="${TEMP_DIR}/pre-restore-safety-$(date +%Y%m%d_%H%M%S).sql.gz"
  docker exec "${CONTAINER}" pg_dump -U "${DB_USER}" "${DATABASE}" 2>/dev/null | gzip > "${SAFETY_BACKUP}" || true

  if [ -s "${SAFETY_BACKUP}" ]; then
    SAFETY_SIZE=$(ls -lh "${SAFETY_BACKUP}" | awk '{print $5}')
    log "Safety backup created: ${SAFETY_SIZE}"
    log "Safety backup location: ${SAFETY_BACKUP}"

    # Copy safety backup to backups directory
    PERMANENT_SAFETY="./backups/pre-restore-safety-$(date +%Y%m%d_%H%M%S).sql.gz"
    cp "${SAFETY_BACKUP}" "${PERMANENT_SAFETY}" 2>/dev/null || true
    if [ -f "${PERMANENT_SAFETY}" ]; then
      log "Safety backup saved to: ${PERMANENT_SAFETY}"
    fi
  else
    warn "Could not create safety backup (database may be empty)"
  fi
fi

# ============================================
# STOP DEPENDENT SERVICES
# ============================================
if [ "${DRY_RUN}" = false ]; then
  log "Note: You may want to stop dependent services before restore:"
  info "  docker-compose -f docker-compose.prod.yml stop api worker dashboard scheduler"
  echo ""
fi

# ============================================
# RESTORE DATABASE
# ============================================
if [ "${DRY_RUN}" = true ]; then
  info "[DRY RUN] Would restore database from: ${DECRYPTED_FILE}"
  info "[DRY RUN] Command: gunzip -c backup.sql.gz | docker exec -i ${CONTAINER} psql -U ${DB_USER} -d ${DATABASE}"
else
  log "Restoring database..."
  log "This may take several minutes depending on backup size..."

  # Use psql to restore (pg_dump format)
  # The backup from prodrigestivill/postgres-backup-local is a plain SQL dump
  gunzip -c "${DECRYPTED_FILE}" | docker exec -i "${CONTAINER}" psql -U "${DB_USER}" -d "${DATABASE}" 2>&1 | \
    grep -v "^SET$" | grep -v "^$" | tail -20 || true

  log "Database restore complete"
fi

# ============================================
# POST-RESTORE VERIFICATION
# ============================================
if [ "${DRY_RUN}" = false ]; then
  log "Verifying restore..."

  # Check table counts
  echo ""
  log "Current table counts:"
  docker exec "${CONTAINER}" psql -U "${DB_USER}" -d "${DATABASE}" -c "
    SELECT 'users' as table_name, COUNT(*) as count FROM users
    UNION ALL SELECT 'tenants', COUNT(*) FROM tenants
    UNION ALL SELECT 'api_keys', COUNT(*) FROM api_keys
    UNION ALL SELECT 'procedural_shards', COUNT(*) FROM procedural_shards
    UNION ALL SELECT 'reasoning_traces', COUNT(*) FROM reasoning_traces
    UNION ALL SELECT 'episodes', COUNT(*) FROM episodes
    UNION ALL SELECT 'knowledge_facts', COUNT(*) FROM knowledge_facts
    ORDER BY table_name;
  " 2>/dev/null || warn "Could not verify table counts"
fi

# ============================================
# SUMMARY
# ============================================
echo ""
log "============================================"
if [ "${DRY_RUN}" = true ]; then
  log "DRY RUN COMPLETE - No changes were made"
else
  log "RESTORE COMPLETE"
  echo ""
  log "Next steps:"
  info "  1. Restart dependent services:"
  info "     docker-compose -f docker-compose.prod.yml up -d api worker dashboard scheduler"
  info ""
  info "  2. Verify application functionality"
  info ""
  info "  3. If restore failed, safety backup is at:"
  info "     ${PERMANENT_SAFETY:-./backups/pre-restore-safety-*.sql.gz}"
fi
log "============================================"
