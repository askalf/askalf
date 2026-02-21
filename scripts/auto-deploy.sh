#!/usr/bin/env bash
# Auto-deploy pipeline: type-check → build → deploy → health gate → tag
# Usage: ./scripts/auto-deploy.sh forge
#        ./scripts/auto-deploy.sh forge dashboard --no-cache
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
powershell.exe -NoProfile -File "$SCRIPT_DIR/auto-deploy.ps1" "$@"
