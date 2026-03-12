#!/usr/bin/env bash
# Automated PostgreSQL backup with optional S3 upload
#
# Usage:
#   ./scripts/backup-db.sh                    # Backup + upload to S3 (if configured)
#   ./scripts/backup-db.sh --local-only       # Backup locally, skip S3
#   ./scripts/backup-db.sh --no-compress      # Skip gzip compression
#
# Environment variables:
#   BACKUP_S3_BUCKET        - S3 bucket name (required for upload)
#   BACKUP_S3_PREFIX        - S3 key prefix (default: backups/)
#   AWS_REGION              - AWS region (default: us-east-1)
#   AWS_ACCESS_KEY_ID       - AWS credentials
#   AWS_SECRET_ACCESS_KEY   - AWS credentials
#   BACKUP_ENCRYPTION_KEY   - Optional: encrypt backup with openssl aes-256-cbc
#   BACKUP_RETENTION_DAYS   - Local retention in days (default: 7)
#   POSTGRES_CONTAINER      - Docker container name (default: askalf-postgres)
#   POSTGRES_USER           - Database user (default: substrate)
#   POSTGRES_DB             - Database name (default: askalf)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="${ROOT_DIR}/backups"

# Load .env if present
for envfile in "${ROOT_DIR}/.env.production" "${ROOT_DIR}/.env"; do
    if [[ -f "$envfile" ]]; then
        set -a
        # shellcheck disable=SC1090
        source <(grep -v '^\s*#' "$envfile" | grep -v '^\s*$')
        set +a
        break
    fi
done

# Config
PG_CONTAINER="${POSTGRES_CONTAINER:-askalf-postgres}"
PG_USER="${POSTGRES_USER:-substrate}"
PG_DB="${POSTGRES_DB:-askalf}"
S3_BUCKET="${BACKUP_S3_BUCKET:-}"
S3_PREFIX="${BACKUP_S3_PREFIX:-backups/}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-7}"
ENCRYPTION_KEY="${BACKUP_ENCRYPTION_KEY:-}"
TIMESTAMP="$(date -u +'%Y%m%d-%H%M%S')"
DUMP_FILE="askalf-${TIMESTAMP}.sql"

# Flags
LOCAL_ONLY=false
COMPRESS=true

for arg in "$@"; do
    case "$arg" in
        --local-only)  LOCAL_ONLY=true ;;
        --no-compress) COMPRESS=false ;;
        --help|-h)
            head -15 "$0" | tail -14
            exit 0
            ;;
        *) echo "Unknown option: $arg"; exit 1 ;;
    esac
done

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()    { echo -e "${CYAN}[backup]${NC} $1"; }
success() { echo -e "${GREEN}[backup]${NC} $1"; }
warn()    { echo -e "${YELLOW}[backup]${NC} $1"; }
fail()    { echo -e "${RED}[backup]${NC} $1" >&2; exit 1; }

# Ensure backup directory exists
mkdir -p "$BACKUP_DIR"

# Verify container is running
if ! docker ps --format '{{.Names}}' | grep -q "^${PG_CONTAINER}$"; then
    fail "Container '${PG_CONTAINER}' is not running"
fi

# ── Step 1: pg_dump ──────────────────────────────────────────────
info "Dumping database '${PG_DB}' from container '${PG_CONTAINER}'..."
docker exec "$PG_CONTAINER" pg_dump \
    -U "$PG_USER" \
    -d "$PG_DB" \
    --no-owner \
    --no-privileges \
    --clean \
    --if-exists \
    > "${BACKUP_DIR}/${DUMP_FILE}" \
    || fail "pg_dump failed"

DUMP_SIZE=$(du -h "${BACKUP_DIR}/${DUMP_FILE}" | cut -f1)
success "Dump complete: ${DUMP_FILE} (${DUMP_SIZE})"

FINAL_FILE="${DUMP_FILE}"

# ── Step 2: Compress ─────────────────────────────────────────────
if $COMPRESS; then
    info "Compressing..."
    gzip -f "${BACKUP_DIR}/${DUMP_FILE}"
    FINAL_FILE="${DUMP_FILE}.gz"
    COMPRESSED_SIZE=$(du -h "${BACKUP_DIR}/${FINAL_FILE}" | cut -f1)
    success "Compressed: ${FINAL_FILE} (${COMPRESSED_SIZE})"
fi

# ── Step 3: Encrypt (optional) ───────────────────────────────────
if [[ -n "$ENCRYPTION_KEY" ]]; then
    info "Encrypting backup..."
    openssl enc -aes-256-cbc -salt -pbkdf2 \
        -in "${BACKUP_DIR}/${FINAL_FILE}" \
        -out "${BACKUP_DIR}/${FINAL_FILE}.enc" \
        -pass "pass:${ENCRYPTION_KEY}"
    rm -f "${BACKUP_DIR}/${FINAL_FILE}"
    FINAL_FILE="${FINAL_FILE}.enc"
    success "Encrypted: ${FINAL_FILE}"
fi

# ── Step 4: Upload to S3 ─────────────────────────────────────────
if $LOCAL_ONLY; then
    info "Skipping S3 upload (--local-only)"
elif [[ -z "$S3_BUCKET" ]]; then
    warn "BACKUP_S3_BUCKET not set — skipping S3 upload"
else
    if ! command -v aws &>/dev/null; then
        fail "AWS CLI not installed — cannot upload to S3"
    fi

    S3_KEY="${S3_PREFIX}${FINAL_FILE}"
    info "Uploading to s3://${S3_BUCKET}/${S3_KEY}..."

    aws s3 cp \
        "${BACKUP_DIR}/${FINAL_FILE}" \
        "s3://${S3_BUCKET}/${S3_KEY}" \
        --region "${AWS_REGION:-us-east-1}" \
        --storage-class STANDARD_IA \
        --no-progress \
        || fail "S3 upload failed"

    success "Uploaded to s3://${S3_BUCKET}/${S3_KEY}"
fi

# ── Step 5: Clean up old local backups ────────────────────────────
if [[ "$RETENTION_DAYS" -gt 0 ]]; then
    DELETED=$(find "$BACKUP_DIR" -maxdepth 1 -name "askalf-*.sql*" -type f -mtime "+${RETENTION_DAYS}" -print -delete | wc -l)
    if [[ "$DELETED" -gt 0 ]]; then
        info "Cleaned up ${DELETED} backup(s) older than ${RETENTION_DAYS} days"
    fi
fi

# ── Summary ───────────────────────────────────────────────────────
echo ""
success "Backup complete: ${BACKUP_DIR}/${FINAL_FILE}"
if [[ -n "$S3_BUCKET" ]] && ! $LOCAL_ONLY; then
    success "S3 copy: s3://${S3_BUCKET}/${S3_PREFIX}${FINAL_FILE}"
fi
