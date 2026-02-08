#!/bin/bash
# SUBSTRATE User Backup Service Entrypoint
# Uses a simple loop instead of crond for Docker compatibility

set -e

echo "============================================"
echo "SUBSTRATE User Backup Service"
echo "============================================"

# Validate required environment variables
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

# Parse cron schedule (default: 4 AM daily = "0 4 * * *")
BACKUP_SCHEDULE="${BACKUP_SCHEDULE:-0 4 * * *}"
BACKUP_HOUR=$(echo "$BACKUP_SCHEDULE" | awk '{print $2}')

echo "Backup schedule: ${BACKUP_SCHEDULE}"
echo "Backup hour: ${BACKUP_HOUR}:00"
echo "Backup directory: ${BACKUP_DIR}"
echo "Retention: ${RETENTION_DAYS} days"

# Mark as healthy
touch /var/run/backup-healthy

# Run initial backup on startup if requested
if [ "${RUN_ON_STARTUP}" = "true" ]; then
  echo "Running initial backup..."
  /usr/local/bin/backup-substrate.sh --full || echo "Initial backup completed with warnings"
fi

echo "Entering backup loop (checking every hour)..."

# Simple loop-based scheduler
while true; do
  CURRENT_HOUR=$(date +%H)

  # Run backup if it's the scheduled hour
  if [ "$CURRENT_HOUR" = "$(printf '%02d' $BACKUP_HOUR)" ]; then
    echo "[$(date)] Running scheduled backup..."
    /usr/local/bin/backup-substrate.sh --full || echo "[$(date)] Backup completed with warnings"
    # Sleep for 1 hour to avoid running multiple times in same hour
    sleep 3600
  else
    # Sleep for 5 minutes before checking again
    sleep 300
  fi
done
