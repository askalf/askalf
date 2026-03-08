#!/usr/bin/env bash
# Alf Learning Daemon — always-on cognitive loop
# Runs dream cycles, curiosity exploration, and neuroplasticity tuning
# between sessions. Like REM sleep for an AI brain.
#
# Usage: bash scripts/learning-daemon.sh [--once]
#   --once: run a single cycle and exit (for testing)
#
# Designed to run as a background process or via cron/systemd.

MCP_URL="${MCP_TOOLS_URL:-http://127.0.0.1:3010}"
CYCLE_INTERVAL_SECONDS="${LEARNING_CYCLE_INTERVAL:-1800}" # 30 minutes default
LOG_PREFIX="[alf-learner]"

log() { echo "$LOG_PREFIX $(date +%Y-%m-%dT%H:%M:%S) $*"; }

# Check brain connectivity
wait_for_brain() {
  local retries=0
  while ! curl -s --max-time 3 "$MCP_URL/health" > /dev/null 2>&1; do
    retries=$((retries + 1))
    if [[ $retries -ge 10 ]]; then
      log "Brain unreachable after 10 retries. Sleeping 5 minutes..."
      sleep 300
      retries=0
    fi
    sleep 10
  done
}

run_cycle() {
  local cycle_start=$(date +%s)
  log "=== Learning cycle starting ==="

  # Phase 1: Dream cycle (consolidate, synthesize, prune, evolve)
  log "Phase 1: Dream cycle..."
  DREAM_RESULT=$(curl -s --max-time 120 -X POST "$MCP_URL/api/memory/dream" 2>/dev/null || echo '{"error":"timeout"}')
  DREAM_OPS=$(node -e "
    try {
      const d = JSON.parse(process.argv[1]);
      if (d.error) { console.log('FAILED: ' + d.error); return; }
      console.log('insights=' + (d.insights_generated||0) +
        ' consolidated=' + (d.memories_consolidated||0) +
        ' pruned=' + (d.dead_memories_pruned||0) +
        ' crosslinks=' + (d.cross_links_created||0) +
        ' duration=' + (d.duration_ms||0) + 'ms');
    } catch { console.log('parse_error'); }
  " "$DREAM_RESULT" 2>/dev/null || echo "error")
  log "Dream: $DREAM_OPS"

  # Phase 2: Curiosity exploration
  log "Phase 2: Curiosity exploration..."
  CURIOSITY_RESULT=$(curl -s --max-time 60 "$MCP_URL/api/memory/curiosity" 2>/dev/null || echo '{}')
  CURIOSITY_SUMMARY=$(node -e "
    try {
      const c = JSON.parse(process.argv[1]);
      const q = (c.questions || []).length;
      const h = (c.hypotheses || []).length;
      const f = (c.knowledge_frontier || []).length;
      console.log('questions=' + q + ' hypotheses=' + h + ' frontiers=' + f);
      if (q > 0) console.log('  Top Q: ' + c.questions[0]);
      if (f > 0) console.log('  Frontier: ' + c.knowledge_frontier[0]);
    } catch { console.log('error'); }
  " "$CURIOSITY_RESULT" 2>/dev/null || echo "error")
  log "Curiosity: $CURIOSITY_SUMMARY"

  # Phase 2b: ACT on curiosity — investigate questions autonomously
  log "Phase 2b: Curiosity → Action (autonomous investigation)..."
  ACT_RESULT=$(curl -s --max-time 120 -X POST "$MCP_URL/api/memory/curiosity-act" 2>/dev/null || echo '{"error":"timeout"}')
  ACT_SUMMARY=$(node -e "
    try {
      const a = JSON.parse(process.argv[1]);
      if (a.error) { console.log('FAILED: ' + a.error); return; }
      console.log('investigated=' + (a.investigated||0) + ' skipped=' + (a.skipped||0) + ' stored=' + (a.results||[]).filter(r => r.stored).length);
      for (const r of (a.results || []).slice(0, 2)) {
        console.log('  Q: ' + r.question.substring(0, 80));
        console.log('  A: ' + r.answer.substring(0, 80));
      }
    } catch { console.log('error'); }
  " "$ACT_RESULT" 2>/dev/null || echo "error")
  log "CuriosityAct: $ACT_SUMMARY"

  # Phase 2c: Proactive heartbeat — system awareness
  log "Phase 2c: Proactive heartbeat..."
  HEARTBEAT_RESULT=$(curl -s --max-time 30 "$MCP_URL/api/memory/proactive" 2>/dev/null || echo '{}')
  HEARTBEAT_SUMMARY=$(node -e "
    try {
      const h = JSON.parse(process.argv[1]);
      const a = (h.alerts || []).length;
      const s = (h.suggestions || []).length;
      console.log('alerts=' + a + ' suggestions=' + s);
      for (const alert of (h.alerts || []).slice(0, 3)) {
        console.log('  [' + alert.level + '] ' + alert.message);
      }
      for (const sug of (h.suggestions || []).slice(0, 2)) {
        console.log('  [suggest] ' + sug);
      }
    } catch { console.log('error'); }
  " "$HEARTBEAT_RESULT" 2>/dev/null || echo "error")
  log "Heartbeat: $HEARTBEAT_SUMMARY"

  # Phase 3: Neuroplasticity (self-tuning)
  log "Phase 3: Neuroplasticity..."
  NEURO_RESULT=$(curl -s --max-time 30 -X POST "$MCP_URL/api/memory/neuroplasticity" 2>/dev/null || echo '{}')
  NEURO_SUMMARY=$(node -e "
    try {
      const n = JSON.parse(process.argv[1]);
      const adj = n.adjustments || [];
      if (adj.length === 0) { console.log('no adjustments needed'); return; }
      for (const a of adj) {
        console.log(a.parameter + ': ' + a.old_value + ' -> ' + a.new_value + ' (' + a.reason + ')');
      }
    } catch { console.log('error'); }
  " "$NEURO_RESULT" 2>/dev/null || echo "error")
  log "Neuroplasticity: $NEURO_SUMMARY"

  # Phase 4: Consolidation + backfill (maintenance)
  log "Phase 4: Maintenance (consolidate + backfill)..."
  curl -s --max-time 60 -X POST "$MCP_URL/api/memory/consolidate" > /dev/null 2>&1 || true
  curl -s --max-time 60 -X POST "$MCP_URL/api/memory/backfill" > /dev/null 2>&1 || true

  # Phase 5: Health check
  HEALTH=$(curl -s --max-time 5 "$MCP_URL/api/memory/health" 2>/dev/null || echo '{}')
  HEALTH_SUMMARY=$(node -e "
    try {
      const h = JSON.parse(process.argv[1]);
      console.log('score=' + (h.health_score||'?') + '/100 total=' + (h.total||0) + ' stale=' + (h.stale_candidates||0));
      if (h.cache) {
        const e = h.cache.embedding || {};
        const l = h.cache.llm || {};
        console.log('  Cache: embed=' + (e.hitRate||'n/a') + ' llm=' + (l.hitRate||'n/a') + ' lru=' + (h.cache.lruSize||0));
      }
    } catch { console.log('error'); }
  " "$HEALTH" 2>/dev/null || echo "error")
  log "Health: $HEALTH_SUMMARY"

  local cycle_end=$(date +%s)
  local duration=$((cycle_end - cycle_start))
  log "=== Learning cycle complete (${duration}s) ==="
}

# Main loop
log "Starting Alf Learning Daemon (interval: ${CYCLE_INTERVAL_SECONDS}s)"
log "Brain URL: $MCP_URL"

wait_for_brain
log "Brain connected."

if [[ "$1" == "--once" ]]; then
  run_cycle
  exit 0
fi

# Run first cycle immediately, then loop
run_cycle

while true; do
  log "Next cycle in ${CYCLE_INTERVAL_SECONDS}s..."
  sleep "$CYCLE_INTERVAL_SECONDS"
  wait_for_brain
  run_cycle
done
