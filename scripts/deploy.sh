#!/usr/bin/env bash
# Wrapper around deploy.ps1 — use from Git Bash / Claude Code
# Usage: ./scripts/deploy.sh forge
#        ./scripts/deploy.sh forge dashboard
#        ./scripts/deploy.sh forge --no-cache
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
powershell.exe -NoProfile -File "$SCRIPT_DIR/deploy.ps1" "$@"
