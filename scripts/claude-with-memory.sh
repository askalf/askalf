#!/usr/bin/env bash
# Claude Code launcher with memory injection
# Injects 4-tier memory context before starting Claude Code
#
# Usage: ./scripts/claude-with-memory.sh [claude args...]
# Alias: alias claude='bash ~/Desktop/recover/substrate/scripts/claude-with-memory.sh'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Inject memories (silent, non-blocking if mcp-tools is down)
bash "$SCRIPT_DIR/memory-inject.sh" 2>/dev/null || true

# Pass through to claude with all arguments
exec claude "$@"
