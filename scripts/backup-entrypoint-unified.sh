#!/bin/bash
# ============================================
# SUBSTRATE Unified Backup Service Entrypoint
# ============================================
# Runs both the HTTP API server and scheduled backups
# in a single container for simplified management.
#
# Features:
# - HTTP API on port 8080 for manual triggers
# - Scheduled backups via internal loop
# - Database job tracking
# - Health monitoring
# ============================================

set -e

echo "============================================"
echo "SUBSTRATE Unified Backup Service"
echo "============================================"
echo "Started at: $(date)"

# ============================================
# ENVIRONMENT VALIDATION
# ============================================
if [ -z "${DB_HOST}" ]; then
  echo "ERROR: DB_HOST is required"
  exit 1
fi

if [ -z "${POSTGRES_PASSWORD}" ]; then
  echo "ERROR: POSTGRES_PASSWORD is required"
  exit 1
fi

# Set defaults
export DB_HOST="${DB_HOST:-postgres}"
export DB_PORT="${DB_PORT:-5432}"
export DB_NAME="${DB_NAME:-substrate}"
export DB_USER="${DB_USER:-substrate}"
export BACKUP_DIR="${BACKUP_DIR:-/backups}"
export RETENTION_DAYS="${RETENTION_DAYS:-30}"
export PGPASSWORD="${POSTGRES_PASSWORD}"
export API_PORT="${API_PORT:-8080}"

# Parse cron schedule (default: 4 AM daily)
BACKUP_SCHEDULE="${BACKUP_SCHEDULE:-0 4 * * *}"
BACKUP_HOUR=$(echo "$BACKUP_SCHEDULE" | awk '{print $2}')

echo ""
echo "Configuration:"
echo "  Database:    ${DB_USER}@${DB_HOST}:${DB_PORT}/${DB_NAME}"
echo "  Backup Dir:  ${BACKUP_DIR}"
echo "  Retention:   ${RETENTION_DAYS} days"
echo "  Schedule:    ${BACKUP_SCHEDULE} (Hour: ${BACKUP_HOUR}:00)"
echo "  API Port:    ${API_PORT}"
echo ""

# ============================================
# DIRECTORY SETUP
# ============================================
mkdir -p "${BACKUP_DIR}/daily" "${BACKUP_DIR}/weekly" "${BACKUP_DIR}/monthly"
echo "Backup directories created"

# ============================================
# WAIT FOR DATABASE
# ============================================
echo "Waiting for database to be ready..."
MAX_RETRIES=30
RETRY_COUNT=0

while ! pg_isready -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -q; do
  RETRY_COUNT=$((RETRY_COUNT + 1))
  if [ $RETRY_COUNT -ge $MAX_RETRIES ]; then
    echo "ERROR: Database not ready after ${MAX_RETRIES} attempts"
    exit 1
  fi
  echo "  Waiting for database... (${RETRY_COUNT}/${MAX_RETRIES})"
  sleep 2
done

echo "Database is ready"

# ============================================
# HEALTH CHECK FILE
# ============================================
touch /var/run/backup-healthy
echo "Health check file created"

# ============================================
# START HTTP API SERVER
# ============================================
echo "Starting HTTP API server on port ${API_PORT}..."
node /usr/local/bin/backup-api.js &
API_PID=$!
echo "API server started (PID: ${API_PID})"

# Wait for API to be ready
sleep 2
if ! kill -0 ${API_PID} 2>/dev/null; then
  echo "ERROR: API server failed to start"
  exit 1
fi

# ============================================
# CREATE SCHEDULED JOB FUNCTION
# ============================================
run_scheduled_backup() {
  local trigger_type="${1:-scheduled}"

  echo "[$(date)] Creating backup job..."

  # Create job via API
  local response=$(curl -s -X POST "http://localhost:${API_PORT}/backup" \
    -H "Content-Type: application/json" \
    -d "{\"type\":\"full\",\"trigger\":\"${trigger_type}\",\"triggeredBy\":\"scheduler\"}")

  local job_id=$(echo "$response" | jq -r '.jobId // empty')

  if [ -n "$job_id" ]; then
    echo "[$(date)] Backup job created: ${job_id}"
  else
    echo "[$(date)] WARNING: Failed to create backup job via API"
    echo "[$(date)] Response: ${response}"

    # Fallback: run backup script directly
    echo "[$(date)] Running backup script directly..."
    /usr/local/bin/backup-substrate.sh --full || echo "[$(date)] Backup completed with warnings"
  fi
}

# ============================================
# INITIAL BACKUP (OPTIONAL)
# ============================================
if [ "${RUN_ON_STARTUP}" = "true" ]; then
  echo ""
  echo "Running initial backup on startup..."
  run_scheduled_backup "startup"
fi

# ============================================
# SCHEDULED BACKUP LOOP
# ============================================
echo ""
echo "Entering scheduled backup loop..."
echo "Next backup scheduled for ${BACKUP_HOUR}:00"

# Track last backup hour to prevent duplicate runs
LAST_BACKUP_HOUR=""

while true; do
  CURRENT_HOUR=$(date +%H)
  CURRENT_DATE=$(date +%Y-%m-%d)

  # Check if API server is still running
  if ! kill -0 ${API_PID} 2>/dev/null; then
    echo "WARNING: API server died, restarting..."
    node /usr/local/bin/backup-api.js &
    API_PID=$!
    sleep 2
  fi

  # Run backup if it's the scheduled hour and we haven't run today at this hour
  BACKUP_HOUR_PADDED=$(printf '%02d' $BACKUP_HOUR)
  if [ "$CURRENT_HOUR" = "$BACKUP_HOUR_PADDED" ] && [ "$LAST_BACKUP_HOUR" != "${CURRENT_DATE}-${CURRENT_HOUR}" ]; then
    echo ""
    echo "[$(date)] Running scheduled backup..."
    run_scheduled_backup "scheduled"
    LAST_BACKUP_HOUR="${CURRENT_DATE}-${CURRENT_HOUR}"
    echo "[$(date)] Scheduled backup initiated"
    echo "[$(date)] Next backup scheduled for tomorrow at ${BACKUP_HOUR}:00"
  fi

  # Update health check file
  touch /var/run/backup-healthy

  # Sleep for 5 minutes before checking again
  sleep 300
done
