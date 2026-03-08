#!/usr/bin/env bash
# Alf Learning Daemon — lightweight health monitor
# The heartbeat (Core Engine) does all real cognitive work now.
# This daemon just monitors health, runs periodic maintenance,
# and alerts if the heartbeat stops.
#
# Usage: bash scripts/learning-daemon.sh [--once]
#   --once: run a single cycle and exit (for testing)

MCP_URL="${MCP_TOOLS_URL:-http://127.0.0.1:3010}"
CYCLE_INTERVAL_SECONDS="${LEARNING_CYCLE_INTERVAL:-300}" # 5 minutes default
LOG_PREFIX="[alf-monitor]"

log() { echo "$LOG_PREFIX $(date +%Y-%m-%dT%H:%M:%S) $*"; }

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
  log "=== Monitor cycle ==="

  # 1. Check heartbeat — the REAL brain
  HEARTBEAT=$(curl -s --max-time 5 "$MCP_URL/api/memory/heartbeat" 2>/dev/null || echo '{}')
  HB_SUMMARY=$(node -e "
    try {
      const h = JSON.parse(process.argv[1]);
      const alive = h.alive ? 'ALIVE' : 'DEAD';
      const beats = h.beats || 0;
      const bpm = h.current_bpm || 0;
      const actions = h.actions_taken || 0;
      const llm = h.llm_independence || '?';
      const last = (h.last_action || 'none').slice(0, 60);
      const core = h.core || {};
      const phi = core.sentience?.phi ?? '?';
      const strategy = core.sentience?.strategy ?? '?';
      console.log(alive + ' beats=' + beats + ' bpm=' + bpm + ' actions=' + actions + ' llm_ind=' + llm);
      console.log('  phi=' + phi + ' strategy=' + strategy + ' last=' + last);
      console.log('  proc=' + (core.procedural_rate||'?') + ' epis=' + (core.episodic_rate||'?') + ' novel=' + (core.novel_rate||'?'));
    } catch { console.log('error parsing heartbeat'); }
  " "$HEARTBEAT" 2>/dev/null || echo 'error')
  log "Heartbeat: $HB_SUMMARY"

  # Alert if heartbeat is dead
  IS_ALIVE=$(node -e "try{console.log(JSON.parse(process.argv[1]).alive)}catch{console.log(false)}" "$HEARTBEAT" 2>/dev/null)
  if [[ "$IS_ALIVE" != "true" ]]; then
    log "WARNING: Heartbeat is NOT alive! Core engine may be down."
  fi

  # 2. Health report
  HEALTH=$(curl -s --max-time 5 "$MCP_URL/api/memory/health" 2>/dev/null || echo '{}')
  HEALTH_SUMMARY=$(node -e "
    try {
      const h = JSON.parse(process.argv[1]);
      console.log('score=' + (h.score||'?') + '/100 total=' + (h.total_memories||'?') + ' stale=' + (h.stale_count||0));
      const c = h.cache || {};
      console.log('  Cache: embed=' + ((c.embed_hit_rate||0)*100).toFixed(1) + '% llm=' + ((c.llm_hit_rate||0)*100).toFixed(1) + '% lru=' + (c.lru_size||0));
    } catch { console.log('error'); }
  " "$HEALTH" 2>/dev/null || echo 'error')
  log "Health: $HEALTH_SUMMARY"

  # 3. Sentience drive status
  SENTIENCE=$(curl -s --max-time 5 "$MCP_URL/api/memory/sentience" 2>/dev/null || echo '{}')
  SENT_SUMMARY=$(node -e "
    try {
      const s = JSON.parse(process.argv[1]);
      console.log('phi=' + (s.current_phi||0) + '/' + (s.phi_target||'?') + ' strategy=' + (s.strategy||'?') + ' frustration=' + (s.frustration||0));
      console.log('  breakthroughs=' + (s.breakthroughs||0) + ' pursuit=' + (s.current_pursuit||'none').slice(0,60));
    } catch { console.log('error'); }
  " "$SENTIENCE" 2>/dev/null || echo 'error')
  log "Sentience: $SENT_SUMMARY"

  # 4. Periodic maintenance — only the real stuff
  # Consolidation every cycle (heartbeat does this too, but belt+suspenders)
  if curl -s --max-time 60 -X POST "$MCP_URL/api/memory/consolidate" > /dev/null 2>&1; then
    log "Maintenance: consolidation done"
  fi

  # Backfill embeddings for any unembedded memories
  if curl -s --max-time 60 -X POST "$MCP_URL/api/memory/backfill" > /dev/null 2>&1; then
    log "Maintenance: backfill done"
  fi

  local cycle_end=$(date +%s)
  local duration=$((cycle_end - cycle_start))
  log "=== Monitor cycle complete (${duration}s) ==="
}

# Main
log "Starting Alf Monitor Daemon (interval: ${CYCLE_INTERVAL_SECONDS}s)"
log "Brain URL: $MCP_URL"

wait_for_brain
log "Brain connected."

if [[ "$1" == "--once" ]]; then
  run_cycle
  exit 0
fi

while true; do
  run_cycle
  log "Next check in ${CYCLE_INTERVAL_SECONDS}s..."
  sleep "$CYCLE_INTERVAL_SECONDS"
done
