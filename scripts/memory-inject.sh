#!/usr/bin/env bash
# Memory inject — LEGACY fallback, only for manual testing.
# The primary path is claude-with-memory.sh which injects via --append-system-prompt.
# This script writes MEMORY.md for debugging/inspection only.

set -euo pipefail

MCP_URL="${MCP_TOOLS_URL:-http://127.0.0.1:3010}"
MEMORY_DIR="C:/Users/masterm1nd.DOCK/.claude/projects/C--Users-masterm1nd-DOCK-Desktop-recover/memory"
MEMORY_FILE="$MEMORY_DIR/MEMORY.md"

if ! curl -s --max-time 3 "$MCP_URL/health" > /dev/null 2>&1; then
  echo "[memory-inject] mcp-tools not reachable — skipping"
  exit 0
fi

mkdir -p "$MEMORY_DIR"

RESPONSE=$(curl -s --max-time 15 "$MCP_URL/api/memory/context?project=substrate" 2>/dev/null || true)

if [[ -n "$RESPONSE" ]]; then
  MARKDOWN=$(node -e "
    try {
      const data = JSON.parse(process.argv[1]);
      if (data.markdown) process.stdout.write(data.markdown);
    } catch {}
  " "$RESPONSE" 2>/dev/null || true)

  if [[ -n "$MARKDOWN" ]]; then
    echo "$MARKDOWN" > "$MEMORY_FILE"
    COUNTS=$(node -e "
      try {
        const data = JSON.parse(process.argv[1]);
        const c = data.counts || {};
        console.log((c.semantic||0) + 's/' + (c.episodic||0) + 'e/' + (c.procedural||0) + 'p');
      } catch { console.log('?'); }
    " "$RESPONSE" 2>/dev/null || echo "?")
    echo "[memory-inject] MEMORY.md written (debug): ${COUNTS} memories"
  fi
fi

# Consolidation
curl -s -X POST "$MCP_URL/api/memory/consolidate" --max-time 10 > /dev/null 2>&1 &
