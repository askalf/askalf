#!/usr/bin/env bash
# Memory hook — fires on Claude Code "Stop" event
# 1. Extracts memories from conversation via LLM
# 2. Self-reflects on session effectiveness
# 3. Stores conversation thread (compressed narrative)
# 4. Generates session handoff (shift change notes)
# 5. Runs consolidation + embedding backfill
# 6. Clears working memory
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
CONVERSATION=$(node -e "
  const fs = require('fs');
  const lines = fs.readFileSync(process.argv[1], 'utf8').trim().split('\n');
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
  process.stdout.write(conversation);
" "$TRANSCRIPT" 2>/dev/null) || exit 0

if [[ -z "$CONVERSATION" || ${#CONVERSATION} -lt 50 ]]; then
  exit 0
fi

# Build JSON payload once
PAYLOAD=$(node -e "process.stdout.write(JSON.stringify({ conversation: process.argv[1], project: 'substrate' }))" "$CONVERSATION" 2>/dev/null)

# 1. Extract memories
curl -s -X POST "$MCP_URL/api/memory/extract" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
  --max-time 30 \
  > /dev/null 2>&1 &

# 2. Self-reflect on session effectiveness
curl -s -X POST "$MCP_URL/api/memory/reflect" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
  --max-time 20 \
  > /dev/null 2>&1 &

# 3. Store conversation thread (compressed narrative)
curl -s -X POST "$MCP_URL/api/memory/thread" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
  --max-time 15 \
  > /dev/null 2>&1 &

# 4. Generate session handoff from last few messages
HANDOFF=$(node -e "
  const conv = process.argv[1];
  const lines = conv.split('\n').filter(l => l.trim());
  const last10 = lines.slice(-10).join(' ').slice(0, 500);
  const summary = 'Last session context: ' + last10;
  process.stdout.write(JSON.stringify({
    summary: summary,
    pending_tasks: [],
    warnings: []
  }));
" "$CONVERSATION" 2>/dev/null)

if [[ -n "$HANDOFF" && ${#HANDOFF} -gt 10 ]]; then
  curl -s -X POST "$MCP_URL/api/memory/handoff" \
    -H "Content-Type: application/json" \
    -d "$HANDOFF" \
    --max-time 5 \
    > /dev/null 2>&1 &
fi

# 5. Consolidation + backfill + dream cycle + clear working memory (background)
(
  sleep 8  # Wait for extraction + reflection to finish
  curl -s -X POST "$MCP_URL/api/memory/consolidate" --max-time 15 > /dev/null 2>&1
  curl -s -X POST "$MCP_URL/api/memory/backfill" --max-time 60 > /dev/null 2>&1
  # Dream cycle — consolidate, cross-synthesize, prune, evolve
  curl -s -X POST "$MCP_URL/api/memory/dream" --max-time 120 > /dev/null 2>&1
  # Neuroplasticity — self-tune memory parameters
  curl -s -X POST "$MCP_URL/api/memory/neuroplasticity" --max-time 30 > /dev/null 2>&1
  curl -s -X DELETE "$MCP_URL/api/memory/working" --max-time 3 > /dev/null 2>&1
) &

exit 0
