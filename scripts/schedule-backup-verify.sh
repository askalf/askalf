#!/bin/bash
# Scheduled Backup Verification Task
# Runs weekly backup verification and logs results to agent_audit_log
#
# This script is meant to be scheduled via cron or the agent scheduler:
#   0 2 * * 0    /path/to/scripts/schedule-backup-verify.sh
#   (Every Sunday at 2 AM)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="${BACKUP_DIR:-$PROJECT_DIR/backups}"
LOG_TABLE="agent_audit_log"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[backup-verify]${NC} $1"; }
warn() { echo -e "${YELLOW}[backup-verify]${NC} $1"; }
error() { echo -e "${RED}[backup-verify]${NC} $1"; }

log "Starting weekly backup verification..."

# Find the most recent backup
LATEST_BACKUP=$(find "$BACKUP_DIR" -maxdepth 1 -name "*.sql*" -type f 2>/dev/null | sort | tail -1)

if [ -z "$LATEST_BACKUP" ]; then
  error "No backups found in $BACKUP_DIR"
  exit 1
fi

log "Verifying backup: $(basename $LATEST_BACKUP)"

# Run verification
START_TIME=$(date +%s)
if bash "$SCRIPT_DIR/verify-backup.sh" "$LATEST_BACKUP"; then
  STATUS="SUCCESS"
  RESULT="Backup verification passed"
  log "✓ Backup verification passed"
else
  STATUS="FAILED"
  RESULT="Backup verification failed — see logs for details"
  warn "✗ Backup verification failed"
fi
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

log "Verification completed in ${DURATION}s"

# Log to agent_audit_log (if database is accessible)
if [ -n "$DATABASE_URL" ] || [ -f "$PROJECT_DIR/.env.production" ]; then
  if [ -f "$PROJECT_DIR/.env.production" ]; then
    export $(grep -v '^#' "$PROJECT_DIR/.env.production" | xargs)
  fi

  # Use psql to insert audit log entry
  if command -v psql &>/dev/null; then
    psql -v ON_ERROR_STOP=1 <<EOF 2>/dev/null || warn "Failed to log to agent_audit_log"
INSERT INTO agent_audit_log (actor, action, changes, timestamp)
VALUES (
  'Infra',
  'backup_verification',
  jsonb_build_object(
    'status', '$STATUS',
    'backup_file', '$(basename $LATEST_BACKUP)',
    'duration_seconds', $DURATION,
    'result', '$RESULT'
  ),
  NOW()
);
EOF
  fi
fi

if [ "$STATUS" = "SUCCESS" ]; then
  exit 0
else
  exit 1
fi
