#!/bin/sh
set -e

DATE=$(date +%Y-%m-%d_%H%M)
BACKUP_DIR=/backups
DATABASES="orcastr8r"

echo "[Backup] $(date) — starting"

for db in $DATABASES; do
  FILE="$BACKUP_DIR/${db}_${DATE}.dump"
  pg_dump -Fc "$db" > "$FILE"
  SIZE=$(du -h "$FILE" | cut -f1)
  echo "[Backup] $db — $SIZE"
done

# Rotate: keep last 7 days
find "$BACKUP_DIR" -name "*.dump" -mtime +7 -delete

echo "[Backup] $(date) — completed"
