#!/usr/bin/env bash
# memory-pre-hook.sh — Claude Code PreToolUse hook for Bash commands.
# Queries the memory system for relevant procedural/episodic memories
# based on the command about to be run, and prints them to stdout.

MCP_URL="${MCP_URL:-http://127.0.0.1:3010}"

# Read the command from CLAUDE_TOOL_INPUT (JSON with a "command" field)
COMMAND="$(echo "$CLAUDE_TOOL_INPUT" | node -e "
  let buf = '';
  process.stdin.on('data', d => buf += d);
  process.stdin.on('end', () => {
    try { console.log(JSON.parse(buf).command || ''); }
    catch { console.log(''); }
  });
" 2>/dev/null)"

# Exit silently if we couldn't extract a command
if [ -z "$COMMAND" ]; then
  exit 0
fi

# Only fire for significant commands — skip trivial ones
SIGNIFICANT_PATTERN="^(deploy|build|docker|migration|migrate|git push|git tag|npm run|powershell|scripts/|\.\/scripts/|docker-compose|docker compose)"
FIRST_TOKEN="$(echo "$COMMAND" | awk '{print $1}' | sed 's|.*/||')"

case "$FIRST_TOKEN" in
  deploy|deploy.ps1|build|build.ps1|docker|docker-compose|migrate|migration|powershell|powershell.exe)
    ;; # significant — continue
  git)
    # Only significant for push/tag operations
    SECOND_TOKEN="$(echo "$COMMAND" | awk '{print $2}')"
    case "$SECOND_TOKEN" in
      push|tag) ;; # continue
      *) exit 0 ;;
    esac
    ;;
  npm|npx|pnpm)
    SECOND_TOKEN="$(echo "$COMMAND" | awk '{print $2}')"
    case "$SECOND_TOKEN" in
      run|exec) ;; # continue
      *) exit 0 ;;
    esac
    ;;
  *)
    # Check if the command references scripts/ or compose
    if echo "$COMMAND" | grep -qiE "$SIGNIFICANT_PATTERN"; then
      : # continue
    else
      exit 0
    fi
    ;;
esac

# Query memory system — max 3 seconds, fail silently
RESPONSE="$(curl -s --max-time 3 -X POST "${MCP_URL}/api/memory/relevant" \
  -H "Content-Type: application/json" \
  -d "$(node -e "console.log(JSON.stringify({context: process.argv[1], limit: 3}))" "$COMMAND" 2>/dev/null)" \
  2>/dev/null)" || exit 0

# Exit silently if empty or unreachable
if [ -z "$RESPONSE" ]; then
  exit 0
fi

# Parse response and print relevant memories (similarity > 0.4)
node -e "
  const resp = JSON.parse(process.argv[1]);
  const memories = resp.memories || resp.data || resp.results || [];
  if (!Array.isArray(memories) || memories.length === 0) process.exit(0);

  const relevant = memories.filter(m => (m.similarity || 0) > 0.4);
  if (relevant.length === 0) process.exit(0);

  console.log('[memory] Relevant procedures:');
  for (const m of relevant) {
    const type = m.type || m.memory_type || 'procedural';
    const content = (m.content || m.text || m.summary || '').slice(0, 120);
    const sim = (m.similarity || 0).toFixed(2);
    console.log('  - [' + type + '] ' + content + ' (similarity: ' + sim + ')');
  }
" "$RESPONSE" 2>/dev/null

exit 0
