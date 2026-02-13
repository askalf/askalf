#!/bin/bash
# Sync Claude Code OAuth credentials from active session to agent fleet mount.
# Run in a loop to keep credentials fresh overnight:
#   bash scripts/sync-credentials.sh &
#
# The active Claude Code session auto-refreshes the token.
# This script copies it to the Docker mount point every 15 minutes.

SOURCE="$HOME/.claude/.credentials.json"
TARGET="$(dirname "$0")/../.claude-credentials.json"

while true; do
  if [ -f "$SOURCE" ]; then
    cp "$SOURCE" "$TARGET"
    EXPIRES=$(node -e "const c=JSON.parse(require('fs').readFileSync('$SOURCE','utf8'));console.log(Math.round((c.claudeAiOauth.expiresAt-Date.now())/60000))" 2>/dev/null)
    echo "[$(date '+%H:%M:%S')] Credentials synced (TTL: ${EXPIRES}min)"
  else
    echo "[$(date '+%H:%M:%S')] No source credentials found"
  fi
  sleep 900  # 15 minutes
done
