#!/usr/bin/env bash
# Memory injection — queries 4-tier memory system, writes MEMORY.md
# Run before each Claude Code session or on demand.
#
# Usage: ./scripts/memory-inject.sh

set -euo pipefail

MCP_URL="${MCP_TOOLS_URL:-http://127.0.0.1:3010}"
MEMORY_FILE="C:/Users/masterm1nd.DOCK/.claude/projects/C--Users-masterm1nd-DOCK-Desktop-recover/memory/MEMORY.md"

# Check if mcp-tools is reachable
if ! curl -s --max-time 3 "$MCP_URL/health" > /dev/null 2>&1; then
  echo "[memory-inject] mcp-tools not reachable at $MCP_URL — skipping"
  exit 0
fi

# Query the context endpoint
RESPONSE=$(curl -s --max-time 15 "$MCP_URL/api/memory/context?project=substrate" 2>/dev/null || true)

if [[ -z "$RESPONSE" ]]; then
  echo "[memory-inject] Empty response from context endpoint — skipping"
  exit 0
fi

# Extract markdown using node (jq not available on Windows git bash)
MARKDOWN=$(node -e "
  try {
    const data = JSON.parse(process.argv[1]);
    if (data.markdown) {
      process.stdout.write(data.markdown);
    }
  } catch {}
" "$RESPONSE" 2>/dev/null || true)

if [[ -z "$MARKDOWN" ]]; then
  echo "[memory-inject] No markdown in response — skipping"
  exit 0
fi

# Ensure directory exists
mkdir -p "$(dirname "$MEMORY_FILE")"

# Write the generated memory context
echo "$MARKDOWN" > "$MEMORY_FILE"

# Extract counts for logging
COUNTS=$(node -e "
  try {
    const data = JSON.parse(process.argv[1]);
    const c = data.counts || {};
    console.log((c.semantic||0) + 's/' + (c.episodic||0) + 'e/' + (c.procedural||0) + 'p');
  } catch { console.log('?'); }
" "$RESPONSE" 2>/dev/null || echo "?")

echo "[memory-inject] MEMORY.md updated: ${COUNTS} memories"
