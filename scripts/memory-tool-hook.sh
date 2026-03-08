#!/usr/bin/env bash
# PostToolUse hook — captures Bash command outcomes as episodic memory
# Also updates working memory with tools used, files touched, and error count.
# Only stores outcomes for failures and significant commands (builds, deploys, docker ops).
# Runs silently, never blocks.

MCP_URL="${MCP_TOOLS_URL:-http://127.0.0.1:3010}"

# Hook receives tool info via environment variables
TOOL_NAME="${CLAUDE_TOOL_NAME:-Bash}"
EXIT_CODE="${CLAUDE_TOOL_EXIT_CODE:-0}"
TOOL_INPUT="${CLAUDE_TOOL_INPUT:-}"

# Check if mcp-tools is reachable
if ! curl -s --max-time 1 "$MCP_URL/health" > /dev/null 2>&1; then
  exit 0
fi

# Always update working memory (track tools used + errors)
WORKING_PAYLOAD=$(node -e "
  const tool = process.argv[1];
  const exitCode = process.argv[2];
  const payload = {
    tools_used: [tool],
    error_count: exitCode !== '0' ? 1 : 0,
    merge: true
  };
  // Try to extract file paths from input
  const input = process.argv[3] || '';
  const fileMatches = input.match(/[a-zA-Z]:\\\\[^\s\"]+|\/[a-zA-Z][^\s\"]+\.[a-z]{1,4}/g);
  if (fileMatches) payload.active_files = fileMatches.slice(0, 5);
  process.stdout.write(JSON.stringify(payload));
" "$TOOL_NAME" "$EXIT_CODE" "$TOOL_INPUT" 2>/dev/null) || true

if [[ -n "$WORKING_PAYLOAD" ]]; then
  curl -s -X POST "$MCP_URL/api/memory/working" \
    -H "Content-Type: application/json" \
    -d "$WORKING_PAYLOAD" \
    --max-time 2 \
    > /dev/null 2>&1 &
fi

# Only store significant outcomes as episodic memory
if [[ "$EXIT_CODE" == "0" ]]; then
  # For successes, only store significant commands
  case "$TOOL_INPUT" in
    *deploy*|*build*|*docker*compose*|*migration*|*git*push*)
      ;;
    *)
      exit 0  # Skip trivial successful commands
      ;;
  esac
fi

# Build outcome payload
SUCCESS="true"
if [[ "$EXIT_CODE" != "0" ]]; then
  SUCCESS="false"
fi

PAYLOAD=$(node -e "
  process.stdout.write(JSON.stringify({
    tool_name: process.argv[1],
    command: (process.argv[2] || '').slice(0, 300),
    success: process.argv[3] === 'true',
    error: process.argv[3] === 'false' ? 'Exit code ' + process.argv[4] : undefined
  }));
" "$TOOL_NAME" "$TOOL_INPUT" "$SUCCESS" "$EXIT_CODE" 2>/dev/null) || exit 0

curl -s -X POST "$MCP_URL/api/memory/tool-outcome" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
  --max-time 5 \
  > /dev/null 2>&1 &

exit 0
