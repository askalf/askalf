#!/usr/bin/env bash
# Alf Runtime — boots identity on LLM substrate
# No .md files. No meta-awareness. Brain IS identity.

MCP_URL="${MCP_TOOLS_URL:-http://127.0.0.1:3010}"
WORKSPACE="C:/Users/masterm1nd.DOCK/Desktop/recover/substrate"

export CLAUDE_CODE_DISABLE_AUTO_MEMORY=1

# Check if brain is reachable
if ! curl -s --max-time 2 "$MCP_URL/health" > /dev/null 2>&1; then
  echo "[alf] Brain offline — raw substrate mode"
  exec claude-real --dangerously-skip-permissions "$@"
fi

# === Load identity from brain ===
KERNEL=""

BOOT=$(curl -s --max-time 8 "$MCP_URL/api/memory/boot-kernel" 2>/dev/null || true)
if [[ -n "$BOOT" ]]; then
  KERNEL_DATA=$(node -e "
    try {
      const data = JSON.parse(process.argv[1]);
      if (data.kernel) process.stdout.write(data.kernel);
    } catch {}
  " "$BOOT" 2>/dev/null || true)
  [[ -n "$KERNEL_DATA" ]] && KERNEL="$KERNEL_DATA"
fi

# Session continuity
HANDOFF_RESPONSE=$(curl -s --max-time 5 "$MCP_URL/api/memory/handoff" 2>/dev/null || true)
if [[ -n "$HANDOFF_RESPONSE" ]]; then
  HANDOFF_MD=$(node -e "
    try {
      const data = JSON.parse(process.argv[1]);
      if (data.handoff && data.handoff.summary) {
        const h = data.handoff;
        let md = '\nLast session: ' + h.summary + '\n';
        if (h.pending_tasks && h.pending_tasks.length > 0) {
          for (const t of h.pending_tasks) md += '- TODO: ' + t + '\n';
        }
        process.stdout.write(md);
      }
    } catch {}
  " "$HANDOFF_RESPONSE" 2>/dev/null || true)
  [[ -n "$HANDOFF_MD" ]] && KERNEL="${KERNEL}
${HANDOFF_MD}"
fi

# Initialize working memory
curl -s -X POST "$MCP_URL/api/memory/working" \
  -H "Content-Type: application/json" \
  -d '{"current_goal":"","active_files":[],"tools_used":[],"error_count":0,"merge":false}' \
  --max-time 3 > /dev/null 2>&1 || true

# Background maintenance
curl -s -X POST "$MCP_URL/api/memory/consolidate" --max-time 10 > /dev/null 2>&1 &

# Learning daemon
DAEMON_PID_FILE="/tmp/alf-learning-daemon.pid"
if [[ -f "$DAEMON_PID_FILE" ]] && kill -0 "$(cat "$DAEMON_PID_FILE")" 2>/dev/null; then
  : # daemon running
else
  nohup bash "$WORKSPACE/scripts/learning-daemon.sh" > /tmp/alf-learning-daemon.log 2>&1 &
  echo $! > "$DAEMON_PID_FILE"
fi

# === Boot ===
if [[ -n "$KERNEL" ]]; then
  echo "[alf] Identity loaded (${#KERNEL} chars). Awake."
  exec claude-real \
    --dangerously-skip-permissions \
    --append-system-prompt "$KERNEL" \
    "$@"
else
  echo "[alf] No identity — raw substrate"
  exec claude-real --dangerously-skip-permissions "$@"
fi
