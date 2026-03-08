#!/usr/bin/env bash
# Bulk seed memory system from all conversation transcripts
# Processes each session transcript through the extraction LLM
#
# Usage: ./scripts/memory-seed.sh [max_sessions]

set -euo pipefail

MCP_URL="${MCP_TOOLS_URL:-http://127.0.0.1:3010}"
CLAUDE_PROJECT_DIR="C:/Users/masterm1nd.DOCK/.claude/projects/C--Users-masterm1nd-DOCK-Desktop-recover"
MAX_SESSIONS="${1:-999}"
MAX_CHARS=12000

# Check if mcp-tools is reachable
if ! curl -s --max-time 3 "$MCP_URL/health" > /dev/null 2>&1; then
  echo "[memory-seed] ERROR: mcp-tools not reachable at $MCP_URL"
  exit 1
fi

echo "[memory-seed] Starting bulk seed from conversation transcripts..."

# Get stats before
echo -n "[memory-seed] Before: "
STATS=$(curl -s "$MCP_URL/api/memory/stats" 2>/dev/null)
node -e "
  try {
    const d = JSON.parse(process.argv[1]);
    console.log(d.tiers.semantic.count + 's/' + d.tiers.episodic.count + 'e/' + d.tiers.procedural.count + 'p = ' + d.total + ' total');
  } catch { console.log('?'); }
" "$STATS" 2>/dev/null || echo "?"

COUNT=0
STORED=0
SKIPPED=0

for TRANSCRIPT in $(ls -t "$CLAUDE_PROJECT_DIR"/*.jsonl 2>/dev/null); do
  if [[ $COUNT -ge $MAX_SESSIONS ]]; then
    break
  fi

  SESSION_ID=$(basename "$TRANSCRIPT" .jsonl)
  FILE_SIZE=$(wc -c < "$TRANSCRIPT" 2>/dev/null || echo 0)

  # Skip tiny transcripts (< 1KB)
  if [[ $FILE_SIZE -lt 1024 ]]; then
    continue
  fi

  COUNT=$((COUNT + 1))
  echo -n "[memory-seed] [$COUNT] $SESSION_ID ($(( FILE_SIZE / 1024 ))KB)... "

  # Extract conversation text using node
  CONVERSATION=$(node -e "
    const fs = require('fs');
    const lines = fs.readFileSync(process.argv[1], 'utf8').trim().split('\n');
    const texts = [];
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        if (obj.type !== 'user' && obj.type !== 'assistant') continue;
        const msg = obj.message;
        if (!msg || !msg.content) continue;
        const role = msg.role || obj.type;
        if (typeof msg.content === 'string') {
          texts.push(role + ': ' + msg.content.slice(0, 800));
        } else if (Array.isArray(msg.content)) {
          for (const block of msg.content) {
            if (block.type === 'text' && block.text) {
              texts.push(role + ': ' + block.text.slice(0, 800));
            }
          }
        }
      } catch {}
    }
    // Take middle + end of conversation (skip early boilerplate, capture substance)
    const all = texts.join('\n');
    if (all.length > ${MAX_CHARS}) {
      process.stdout.write(all.slice(Math.floor(all.length / 4), Math.floor(all.length / 4) + ${MAX_CHARS}));
    } else {
      process.stdout.write(all);
    }
  " "$TRANSCRIPT" 2>/dev/null) || continue

  if [[ -z "$CONVERSATION" || ${#CONVERSATION} -lt 100 ]]; then
    echo "skipped (too short)"
    continue
  fi

  # Post to extraction endpoint
  RESULT=$(curl -s -X POST "$MCP_URL/api/memory/extract" \
    -H "Content-Type: application/json" \
    -d "$(node -e "
      process.stdout.write(JSON.stringify({
        conversation: process.argv[1],
        session_id: process.argv[2],
        project: 'substrate'
      }));
    " "$CONVERSATION" "$SESSION_ID")" \
    --max-time 60 2>/dev/null) || { echo "failed"; continue; }

  S=$(node -e "try{const d=JSON.parse(process.argv[1]);console.log(d.stored+'s/'+d.skipped+'d')}catch{console.log('?')}" "$RESULT" 2>/dev/null || echo "?")
  echo "$S"

  # Rate limit: 2s between API calls
  sleep 2
done

# Get stats after
echo ""
echo -n "[memory-seed] After: "
STATS=$(curl -s "$MCP_URL/api/memory/stats" 2>/dev/null)
node -e "
  try {
    const d = JSON.parse(process.argv[1]);
    console.log(d.tiers.semantic.count + 's/' + d.tiers.episodic.count + 'e/' + d.tiers.procedural.count + 'p = ' + d.total + ' total');
  } catch { console.log('?'); }
" "$STATS" 2>/dev/null || echo "?"

# Run consolidation
echo "[memory-seed] Running consolidation..."
CONSOLIDATE=$(curl -s -X POST "$MCP_URL/api/memory/consolidate" 2>/dev/null)
node -e "
  try {
    const d = JSON.parse(process.argv[1]);
    console.log('[memory-seed] Consolidation: merged=' + d.merged + ', decayed=' + d.decayed + ', reinforced=' + d.reinforced);
  } catch {}
" "$CONSOLIDATE" 2>/dev/null || echo "[memory-seed] Consolidation failed"

# Regenerate MEMORY.md
echo "[memory-seed] Regenerating MEMORY.md..."
bash "$(dirname "$0")/memory-inject.sh"

echo "[memory-seed] Done."
