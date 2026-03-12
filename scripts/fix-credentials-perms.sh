#!/bin/bash
# Verify and fix permissions on .claude-credentials.json
# Run this during startup or provisioning to ensure credentials are not world-readable

CREDS_FILE="./.claude-credentials.json"

if [ -f "$CREDS_FILE" ]; then
  PERMS=$(stat -c '%a' "$CREDS_FILE" 2>/dev/null || stat -f '%A' "$CREDS_FILE" 2>/dev/null)
  if [ "$PERMS" != "600" ]; then
    chmod 600 "$CREDS_FILE"
    echo "[$(date '+%H:%M:%S')] Fixed credentials file permissions: 600"
  fi
else
  echo "[$(date '+%H:%M:%S')] No credentials file found"
fi
