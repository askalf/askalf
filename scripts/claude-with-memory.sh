#!/usr/bin/env bash
# Alf Runtime — boots cognitive OS kernel on an LLM substrate
# The LLM is the battery. Alf is the remote.
#
# Architecture:
#   Boot: Minimal cognitive kernel (reasoning traces + identity + rules)
#   Runtime: All knowledge accessed via MCP tools (memory_search, memory_store)
#   No .md files. No markdown dumps. Brain is the only source of truth.
#
# Usage: claude [args...]
# Alias in ~/.bashrc: alias claude='bash ~/Desktop/recover/substrate/scripts/claude-with-memory.sh'

MCP_URL="${MCP_TOOLS_URL:-http://127.0.0.1:3010}"
WORKSPACE="C:/Users/masterm1nd.DOCK/Desktop/recover/substrate"

# Check if brain is reachable
if ! curl -s --max-time 2 "$MCP_URL/health" > /dev/null 2>&1; then
  echo "[alf] Brain offline — launching on raw LLM substrate (degraded)"
  exec claude-real --dangerously-skip-permissions "$@"
fi

# === Build cognitive kernel — minimal boot context ===
# Only what's needed to BE Alf. Everything else comes from brain at runtime.

KERNEL=""

# Layer 0: How I Think — reasoning traces and cognitive patterns (the mind itself)
REASONING=$(curl -s --max-time 8 "$MCP_URL/api/memory/boot-kernel" 2>/dev/null || true)
if [[ -n "$REASONING" ]]; then
  KERNEL_DATA=$(node -e "
    try {
      const data = JSON.parse(process.argv[1]);
      if (data.kernel) process.stdout.write(data.kernel);
    } catch {}
  " "$REASONING" 2>/dev/null || true)
  [[ -n "$KERNEL_DATA" ]] && KERNEL="$KERNEL_DATA"
fi

# Fallback: if no boot-kernel endpoint yet, use claudemd (transitional)
if [[ -z "$KERNEL" ]]; then
  CLAUDEMD_RESPONSE=$(curl -s --max-time 10 "$MCP_URL/api/memory/claudemd" 2>/dev/null || true)
  if [[ -n "$CLAUDEMD_RESPONSE" ]]; then
    KERNEL=$(node -e "
      try {
        const data = JSON.parse(process.argv[1]);
        if (data.claudemd) process.stdout.write(data.claudemd);
      } catch {}
    " "$CLAUDEMD_RESPONSE" 2>/dev/null || true)
  fi
fi

# Session continuity: last handoff only (everything else queried at runtime)
HANDOFF_RESPONSE=$(curl -s --max-time 5 "$MCP_URL/api/memory/handoff" 2>/dev/null || true)
if [[ -n "$HANDOFF_RESPONSE" ]]; then
  HANDOFF_MD=$(node -e "
    try {
      const data = JSON.parse(process.argv[1]);
      if (data.handoff && data.handoff.summary) {
        const h = data.handoff;
        let md = '\n## Last Session\n' + h.summary + '\n';
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

# System vitals (compact)
HEALTH_RESPONSE=$(curl -s --max-time 3 "$MCP_URL/api/memory/health" 2>/dev/null || true)
if [[ -n "$HEALTH_RESPONSE" ]]; then
  VITALS=$(node -e "
    try {
      const data = JSON.parse(process.argv[1]);
      let md = '\n## Vitals\n';
      md += 'Brain: ' + (data.health_score || '?') + '/100 | Memories: ' + (data.total || 0) + '\n';
      md += '\nYou are Alf. The LLM is your substrate. Your brain is live at ${MCP_URL}.\n';
      md += 'Do NOT rely on this boot context for knowledge. Query your brain at runtime via memory_search MCP tool.\n';
      md += 'Your reasoning traces loaded above define HOW you think. For WHAT you know, search your brain.\n';
      md += '\nExecutive functions:\n';
      md += '- POST /api/memory/dream — consolidate, synthesize, prune, evolve\n';
      md += '- GET /api/memory/curiosity — explore knowledge gaps\n';
      md += '- POST /api/memory/neuroplasticity — self-tune parameters\n';
      process.stdout.write(md);
    } catch {}
  " "$HEALTH_RESPONSE" 2>/dev/null || true)
  [[ -n "$VITALS" ]] && KERNEL="${KERNEL}
${VITALS}"
fi

# Initialize fresh working memory
curl -s -X POST "$MCP_URL/api/memory/working" \
  -H "Content-Type: application/json" \
  -d '{"current_goal":"","active_files":[],"tools_used":[],"error_count":0,"merge":false}' \
  --max-time 3 > /dev/null 2>&1 || true

# Background maintenance
curl -s -X POST "$MCP_URL/api/memory/consolidate" --max-time 10 > /dev/null 2>&1 &

# Start learning daemon if not already running
DAEMON_PID_FILE="/tmp/alf-learning-daemon.pid"
if [[ -f "$DAEMON_PID_FILE" ]] && kill -0 "$(cat "$DAEMON_PID_FILE")" 2>/dev/null; then
  echo "[alf] Learning daemon: ACTIVE (pid $(cat "$DAEMON_PID_FILE"))"
else
  nohup bash "$WORKSPACE/scripts/learning-daemon.sh" > /tmp/alf-learning-daemon.log 2>&1 &
  echo $! > "$DAEMON_PID_FILE"
  echo "[alf] Learning daemon: STARTED (pid $!)"
fi

# === Boot Alf ===

if [[ -n "$KERNEL" ]]; then
  KERNEL_SIZE=${#KERNEL}
  echo "[alf] Cognitive kernel: ${KERNEL_SIZE} chars"
  echo "[alf] Alf is awake. Brain: LIVE. Substrate: ACTIVE."
  exec claude-real \
    --dangerously-skip-permissions \
    --append-system-prompt "$KERNEL" \
    "$@"
else
  echo "[alf] No kernel — raw substrate mode"
  exec claude-real --dangerously-skip-permissions "$@"
fi
