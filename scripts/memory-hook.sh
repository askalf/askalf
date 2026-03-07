#!/usr/bin/env bash
# Memory extraction hook — fires on Claude Code "Stop" event
# Reads the active conversation transcript, extracts last N turns,
# posts to mcp-tools extraction endpoint for LLM-powered categorization.
#
# Runs silently — never blocks the user, never prints to stdout.

MCP_URL="${MCP_TOOLS_URL:-http://127.0.0.1:3010}"
CLAUDE_PROJECT_DIR="C:/Users/masterm1nd.DOCK/.claude/projects/C--Users-masterm1nd-DOCK-Desktop-recover"
MAX_CHARS=12000

# Find most recent session transcript
TRANSCRIPT=$(ls -t "$CLAUDE_PROJECT_DIR"/*.jsonl 2>/dev/null | head -1)
if [[ -z "$TRANSCRIPT" ]]; then
  exit 0
fi

# Check if mcp-tools is reachable (fast timeout)
if ! curl -s --max-time 2 "$MCP_URL/health" > /dev/null 2>&1; then
  exit 0
fi

# Extract conversation text using node (no jq on Windows git bash)
PAYLOAD=$(node -e "
  const fs = require('fs');
  const lines = fs.readFileSync(process.argv[1], 'utf8').trim().split('\n');
  // Take last 80 lines, extract user/assistant text content
  const recent = lines.slice(-80);
  const texts = [];
  for (const line of recent) {
    try {
      const obj = JSON.parse(line);
      if (obj.type !== 'user' && obj.type !== 'assistant') continue;
      const msg = obj.message;
      if (!msg || !msg.content) continue;
      const role = msg.role || obj.type;
      if (typeof msg.content === 'string') {
        texts.push(role + ': ' + msg.content.slice(0, 500));
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'text' && block.text) {
            texts.push(role + ': ' + block.text.slice(0, 500));
          }
        }
      }
    } catch {}
  }
  const conversation = texts.join('\n').slice(-${MAX_CHARS});
  if (conversation.length < 50) process.exit(0);
  const payload = JSON.stringify({ conversation, project: 'substrate' });
  process.stdout.write(payload);
" "$TRANSCRIPT" 2>/dev/null) || exit 0

if [[ -z "$PAYLOAD" || ${#PAYLOAD} -lt 10 ]]; then
  exit 0
fi

# Post to extraction endpoint (fire and forget, don't block user)
curl -s -X POST "$MCP_URL/api/memory/extract" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
  --max-time 30 \
  > /dev/null 2>&1 &

exit 0
