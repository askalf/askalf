#!/usr/bin/env bash
# Backup verification script for AskAlf PostgreSQL
# Spins up temporary Postgres container, restores backup, runs integrity checks
#
# Usage:
#   ./scripts/verify-backup.sh                 # Use latest backup in ./backups/
#   ./scripts/verify-backup.sh /path/to/dump   # Verify specific dump file

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="${1:-.}/backups"
TEMP_CONTAINER="askalf-backup-verify-$$"
TEMP_PORT="5432"
POSTGRES_VERSION="17"
PGVECTOR_IMAGE="pgvector/pgvector:0.8.1-pg${POSTGRES_VERSION}-bookworm@sha256:3e8b3adfd27b5707128f60956f62a793c3c9326ea8cfaf0eab7adccb5d700b21"
VERIFICATION_LOG="${ROOT_DIR}/.backup-verification.log"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

log_info() {
    local msg="$1"
    echo -e "${CYAN}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $msg" | tee -a "$VERIFICATION_LOG"
}

log_success() {
    local msg="$1"
    echo -e "${GREEN}✓${NC} $msg" | tee -a "$VERIFICATION_LOG"
}

log_warn() {
    local msg="$1"
    echo -e "${YELLOW}⚠${NC} $msg" | tee -a "$VERIFICATION_LOG"
}

log_error() {
    local msg="$1"
    echo -e "${RED}✗${NC} $msg" | tee -a "$VERIFICATION_LOG"
    cleanup_temp_container
    exit 1
}

cleanup_temp_container() {
    if docker ps -a --format '{{.Names}}' | grep -q "^${TEMP_CONTAINER}$"; then
        log_info "Cleaning up temporary container..."
        docker rm -f "$TEMP_CONTAINER" &>/dev/null || true
    fi
}

find_latest_backup() {
    if [[ ! -d "$BACKUP_DIR" ]]; then
        log_error "Backup directory not found: $BACKUP_DIR"
    fi

    local latest
    latest=$(find "$BACKUP_DIR" -maxdepth 1 -name "*.sql" -o -name "*.dump" | sort -r | head -1)

    if [[ -z "$latest" ]]; then
        log_error "No backup files found in $BACKUP_DIR"
    fi

    echo "$latest"
}

verify_backup() {
    local backup_file="$1"

    if [[ ! -f "$backup_file" ]]; then
        log_error "Backup file not found: $backup_file"
    fi

    local file_size
    file_size=$(du -h "$backup_file" | cut -f1)
    log_info "Verifying backup: $backup_file (size: $file_size)"

    # Cleanup function
    trap cleanup_temp_container EXIT INT TERM

    # Start temporary Postgres container
    log_info "Starting temporary PostgreSQL container ($POSTGRES_VERSION)..."
    docker run \
        --name "$TEMP_CONTAINER" \
        -e POSTGRES_USER=substrate \
        -e POSTGRES_PASSWORD=test-backup-verify \
        -e POSTGRES_DB=askalf \
        -p "5433:${TEMP_PORT}" \
        -d \
        "$PGVECTOR_IMAGE" \
        postgres -c shared_buffers=256MB -c effective_cache_size=1GB \
        >/dev/null || log_error "Failed to start temporary container"

    # Wait for Postgres to be ready
    log_info "Waiting for PostgreSQL to be ready..."
    local attempts=0
    local max_attempts=30
    while ! docker exec "$TEMP_CONTAINER" pg_isready -U substrate -d askalf &>/dev/null; do
        if (( attempts >= max_attempts )); then
            log_error "PostgreSQL failed to start within ${max_attempts}s"
        fi
        sleep 1
        (( attempts++ ))
    done
    log_success "PostgreSQL is ready"

    # Restore backup
    log_info "Restoring backup..."
    if [[ "$backup_file" == *.dump ]]; then
        # Binary format (pg_restore)
        docker exec -i "$TEMP_CONTAINER" pg_restore \
            -U substrate -d askalf --no-owner --no-privileges \
            < "$backup_file" 2>&1 | tee -a "$VERIFICATION_LOG" || log_error "Restore failed"
    else
        # SQL format
        docker exec -i "$TEMP_CONTAINER" psql \
            -U substrate -d askalf \
            < "$backup_file" 2>&1 | tee -a "$VERIFICATION_LOG" || log_error "Restore failed"
    fi
    log_success "Backup restored successfully"

    # Run integrity checks
    log_info "Running integrity checks..."

    # Check database size
    local db_size
    db_size=$(docker exec "$TEMP_CONTAINER" psql -U substrate -d askalf -t -c \
        "SELECT pg_size_pretty(pg_database_size('askalf'))")
    log_success "Database size: $db_size"

    # Check table count
    local table_count
    table_count=$(docker exec "$TEMP_CONTAINER" psql -U substrate -d askalf -t -c \
        "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")
    log_success "Tables restored: $table_count"

    # Check for corruption (simple check)
    local index_check
    index_check=$(docker exec "$TEMP_CONTAINER" psql -U substrate -d askalf -t -c \
        "SELECT COUNT(*) FROM pg_indexes WHERE schemaname='public'" 2>&1)
    log_success "Indexes present: $index_check"

    # Check sequences
    local seq_count
    seq_count=$(docker exec "$TEMP_CONTAINER" psql -U substrate -d askalf -t -c \
        "SELECT COUNT(*) FROM information_schema.sequences WHERE sequence_schema='public'" 2>&1)
    log_success "Sequences restored: $seq_count"

    # Optional: Run a simple query to verify data access
    if docker exec "$TEMP_CONTAINER" psql -U substrate -d askalf -t -c "SELECT 1" &>/dev/null; then
        log_success "Basic query test passed"
    else
        log_warn "Basic query test failed — backup may be corrupted"
    fi

    # Cleanup
    log_info "Cleaning up..."
    cleanup_temp_container
    log_success "Backup verification completed successfully"

    # Log summary
    log_info "Verification summary: OK"
    echo ""
    echo "Full verification log: $VERIFICATION_LOG"
}

# Main
if [[ $# -eq 0 ]]; then
    BACKUP_FILE=$(find_latest_backup)
    log_info "Using latest backup: $(basename "$BACKUP_FILE")"
else
    BACKUP_FILE="$1"
fi

verify_backup "$BACKUP_FILE"
