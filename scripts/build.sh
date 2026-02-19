#!/usr/bin/env bash
# Wrapper around build.ps1 — use from Git Bash / Claude Code
# Usage: ./scripts/build.sh forge
#        ./scripts/build.sh forge dashboard
#        ./scripts/build.sh forge --no-cache
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
powershell.exe -NoProfile -File "$SCRIPT_DIR/build.ps1" "$@"
