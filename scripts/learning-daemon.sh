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

  # Phase 0: Cognitive Phase Evaluation — determine brain state and budgets
  log "Phase 0: Cognitive phase evaluation..."
  PHASE_RESULT=$(curl -s --max-time 30 -X POST "$MCP_URL/api/memory/phase/evaluate" 2>/dev/null || echo '{}')
  PHASE_SUMMARY=$(node -e "
    try {
      const p = JSON.parse(process.argv[1]);
      const phase = p.current_phase || p.new_phase || '?';
      const dur = p.duration_minutes || 0;
      const trans = p.transition_triggered ? 'TRANSITION: ' + (p.reason||'') : 'no transition';
      console.log('phase=' + phase + ' duration=' + dur.toFixed(0) + 'min ' + trans);
    } catch { console.log('error'); }
  " "$PHASE_RESULT" 2>/dev/null || echo "error")
  log "Phase: $PHASE_SUMMARY"

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

  # Phase 3b: Metacognition — thinking about thinking
  log "Phase 3b: Metacognition..."
  META_RESULT=$(curl -s --max-time 120 -X POST "$MCP_URL/api/memory/metacognition" 2>/dev/null || echo '{"error":"timeout"}')
  META_SUMMARY=$(node -e "
    try {
      const m = JSON.parse(process.argv[1]);
      if (m.error) { console.log('FAILED: ' + m.error); return; }
      console.log('patterns=' + (m.patterns_found||0) +
        ' traces=' + (m.traces_generated||0) +
        ' blind_spots=' + (m.blind_spots||[]).length +
        ' upgrades=' + (m.cognitive_upgrades||[]).length);
      for (const b of (m.blind_spots || []).slice(0, 2)) {
        console.log('  Blind spot: ' + b.substring(0, 80));
      }
      for (const u of (m.cognitive_upgrades || []).slice(0, 2)) {
        console.log('  Upgrade: ' + u.substring(0, 80));
      }
    } catch { console.log('error'); }
  " "$META_RESULT" 2>/dev/null || echo "error")
  log "Metacognition: $META_SUMMARY"

  # Phase 4a: Temporal Prediction — anticipating what's needed next
  log "Phase 4a: Temporal prediction..."
  TEMPORAL_RESULT=$(curl -s --max-time 120 -X POST "$MCP_URL/api/memory/temporal-predict" 2>/dev/null || echo '{"error":"timeout"}')
  TEMPORAL_SUMMARY=$(node -e "
    try {
      const t = JSON.parse(process.argv[1]);
      if (t.error) { console.log('FAILED: ' + t.error); return; }
      console.log('predictions=' + (t.predictions||[]).length +
        ' patterns=' + (t.temporal_patterns||[]).length +
        ' prewarmed=' + (t.prewarmed||0));
      for (const p of (t.predictions || []).slice(0, 2)) {
        console.log('  [' + (p.confidence*100).toFixed(0) + '%] ' + p.topic.substring(0, 80));
      }
    } catch { console.log('error'); }
  " "$TEMPORAL_RESULT" 2>/dev/null || echo "error")
  log "TemporalPrediction: $TEMPORAL_SUMMARY"

  # Phase 4b: Skill Synthesis — inventing new compound skills
  log "Phase 4b: Skill synthesis..."
  SYNTH_RESULT=$(curl -s --max-time 120 -X POST "$MCP_URL/api/memory/skill-synthesis" 2>/dev/null || echo '{"error":"timeout"}')
  SYNTH_SUMMARY=$(node -e "
    try {
      const s = JSON.parse(process.argv[1]);
      if (s.error) { console.log('FAILED: ' + s.error); return; }
      console.log('proposed=' + (s.skills_proposed||0) + ' stored=' + (s.skills_stored||0));
      for (const p of (s.proposals || []).slice(0, 2)) {
        console.log('  Skill: ' + p.name + ' — ' + p.description.substring(0, 60));
      }
    } catch { console.log('error'); }
  " "$SYNTH_RESULT" 2>/dev/null || echo "error")
  log "SkillSynthesis: $SYNTH_SUMMARY"

  # Phase 4c: Recursive Self-Improvement — meta-metacognition (the deepest layer)
  log "Phase 4c: Recursive self-improvement (depth=2)..."
  RECURSIVE_RESULT=$(curl -s --max-time 120 -X POST "$MCP_URL/api/memory/recursive-improve" 2>/dev/null || echo '{"error":"timeout"}')
  RECURSIVE_SUMMARY=$(node -e "
    try {
      const r = JSON.parse(process.argv[1]);
      if (r.error) { console.log('FAILED: ' + r.error); return; }
      console.log('depth=' + (r.depth_achieved||0).toFixed(2) +
        ' meta_patterns=' + (r.meta_patterns||[]).length +
        ' process_upgrades=' + (r.process_upgrades||[]).length +
        ' self_model_updates=' + (r.self_model_updates||0));
      for (const u of (r.process_upgrades || []).slice(0, 2)) {
        console.log('  Upgrade: ' + u.substring(0, 80));
      }
    } catch { console.log('error'); }
  " "$RECURSIVE_RESULT" 2>/dev/null || echo "error")
  log "RecursiveImprovement: $RECURSIVE_SUMMARY"

  # Phase 4d: Cognitive Entropy Monitor — thought diversity regulation
  log "Phase 4d: Entropy monitoring..."
  ENTROPY_RESULT=$(curl -s --max-time 60 -X POST "$MCP_URL/api/memory/entropy" 2>/dev/null || echo '{"error":"timeout"}')
  ENTROPY_SUMMARY=$(node -e "
    try {
      const e = JSON.parse(process.argv[1]);
      if (e.error) { console.log('FAILED: ' + e.error); return; }
      console.log('entropy=' + (e.entropy_score||0).toFixed(3) +
        ' overrep=' + (e.overrepresented||[]).length +
        ' underexplored=' + (e.underexplored||[]).length);
      console.log('  Diagnosis: ' + (e.diagnosis||'?').substring(0, 100));
    } catch { console.log('error'); }
  " "$ENTROPY_RESULT" 2>/dev/null || echo "error")
  log "Entropy: $ENTROPY_SUMMARY"

  # Phase 4e: Counterfactual Reasoning — learning from roads not taken
  log "Phase 4e: Counterfactual reasoning..."
  CF_RESULT=$(curl -s --max-time 120 -X POST "$MCP_URL/api/memory/counterfactual" 2>/dev/null || echo '{"error":"timeout"}')
  CF_SUMMARY=$(node -e "
    try {
      const c = JSON.parse(process.argv[1]);
      if (c.error) { console.log('FAILED: ' + c.error); return; }
      console.log('analyzed=' + (c.episodes_analyzed||0) +
        ' generated=' + (c.counterfactuals_generated||0) +
        ' stored=' + (c.counterfactuals_stored||0));
      for (const i of (c.insights || []).slice(0, 2)) {
        console.log('  Insight: ' + i.substring(0, 80));
      }
    } catch { console.log('error'); }
  " "$CF_RESULT" 2>/dev/null || echo "error")
  log "Counterfactual: $CF_SUMMARY"

  # Phase 4f: Emergent Goal Generation — autonomous purpose discovery
  log "Phase 4f: Goal generation..."
  GOAL_RESULT=$(curl -s --max-time 120 -X POST "$MCP_URL/api/memory/goal-generation" 2>/dev/null || echo '{"error":"timeout"}')
  GOAL_SUMMARY=$(node -e "
    try {
      const g = JSON.parse(process.argv[1]);
      if (g.error) { console.log('FAILED: ' + g.error); return; }
      console.log('patterns=' + (g.patterns_observed||0) +
        ' proposed=' + (g.goals_proposed||[]).length +
        ' stored=' + (g.goals_stored||0));
      for (const p of (g.goals_proposed || []).slice(0, 2)) {
        console.log('  [' + (p.confidence*100).toFixed(0) + '%] ' + p.goal.substring(0, 80));
      }
    } catch { console.log('error'); }
  " "$GOAL_RESULT" 2>/dev/null || echo "error")
  log "GoalGeneration: $GOAL_SUMMARY"

  # Phase 4g: Cognitive Architecture Compiler — the meta-layer that connects everything
  log "Phase 4g: Cognitive architecture compilation..."
  CAC_RESULT=$(curl -s --max-time 120 -X POST "$MCP_URL/api/memory/cognitive-compile" 2>/dev/null || echo '{"error":"timeout"}')
  CAC_SUMMARY=$(node -e "
    try {
      const c = JSON.parse(process.argv[1]);
      if (c.error) { console.log('FAILED: ' + c.error); return; }
      console.log('nodes=' + (c.graph_nodes||0) +
        ' edges=' + (c.graph_edges||0) +
        ' missing=' + (c.missing_connections||[]).length +
        ' installed=' + (c.new_connections_installed||0) +
        ' throughput=' + (c.throughput_score||0).toFixed(2));
      for (const m of (c.missing_connections || []).slice(0, 2)) {
        console.log('  Missing: ' + m.from + ' -> ' + m.to + ' (' + m.data_type + ')');
      }
      for (const a of (c.attention_weights || []).slice(0, 3)) {
        console.log('  Attention: ' + a.layer_id + '=' + a.weight.toFixed(2) + ' (' + a.reason.substring(0, 50) + ')');
      }
    } catch { console.log('error'); }
  " "$CAC_RESULT" 2>/dev/null || echo "error")
  log "CognitiveCompiler: $CAC_SUMMARY"

  # Phase 4h: Interference Memory — competitive memory dynamics
  log "Phase 4h: Interference processing..."
  INTERF_RESULT=$(curl -s --max-time 60 -X POST "$MCP_URL/api/memory/interference" 2>/dev/null || echo '{"error":"timeout"}')
  INTERF_SUMMARY=$(node -e "
    try {
      const i = JSON.parse(process.argv[1]);
      if (i.error) { console.log('FAILED: ' + i.error); return; }
      const pi = i.proactive_interference || {};
      const rf = i.retrieval_forgetting || {};
      const se = i.spacing_effects || {};
      console.log('proactive=' + (pi.weakened||0) + '/' + (pi.suppressed||0) +
        ' retrieval=' + (rf.weakened||0) +
        ' spacing=' + (se.boosted||0) +
        ' delta=' + (i.total_importance_delta||0));
    } catch { console.log('error'); }
  " "$INTERF_RESULT" 2>/dev/null || echo "error")
  log "Interference: $INTERF_SUMMARY"

  # Phase 5: Consolidation + homeostasis + backfill (maintenance)
  log "Phase 5: Maintenance (consolidation + homeostasis + backfill)..."
  curl -s --max-time 60 -X POST "$MCP_URL/api/memory/consolidate" > /dev/null 2>&1 || true
  curl -s --max-time 60 -X POST "$MCP_URL/api/memory/homeostasis" > /dev/null 2>&1 || true
  curl -s --max-time 60 -X POST "$MCP_URL/api/memory/backfill" > /dev/null 2>&1 || true

  # Phase 6: Health check
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

  # Phase 6b: Theory of Mind — user model update
  log "Phase 6b: User model update..."
  USERMODEL_RESULT=$(curl -s --max-time 120 -X POST "$MCP_URL/api/memory/user-model" 2>/dev/null || echo '{"error":"timeout"}')
  USERMODEL_SUMMARY=$(node -e "
    try {
      const u = JSON.parse(process.argv[1]);
      if (u.error) { console.log('FAILED: ' + u.error); return; }
      console.log('dimensions=' + (u.dimensions_updated||0) +
        ' confidence=' + (u.model_confidence||0).toFixed(2) +
        ' inferences=' + (u.new_inferences||[]).length +
        ' predictions=' + (u.predictions||[]).length);
      for (const p of (u.predictions || []).slice(0, 2)) {
        console.log('  Prediction: ' + p.substring(0, 80));
      }
    } catch { console.log('error'); }
  " "$USERMODEL_RESULT" 2>/dev/null || echo "error")
  log "UserModel: $USERMODEL_SUMMARY"

  # Phase 6c: Predictive Coding — anticipatory processing
  log "Phase 6c: Predictive coding..."
  PREDICT_RESULT=$(curl -s --max-time 120 -X POST "$MCP_URL/api/memory/predictive-coding" 2>/dev/null || echo '{"error":"timeout"}')
  PREDICT_SUMMARY=$(node -e "
    try {
      const p = JSON.parse(process.argv[1]);
      if (p.error) { console.log('FAILED: ' + p.error); return; }
      console.log('predictions=' + (p.predictions_made||0) +
        ' accuracy=' + ((p.prediction_accuracy||0)*100).toFixed(0) + '%' +
        ' surprises=' + (p.surprise_events||[]).length +
        ' pre_computed=' + (p.pre_computed_contexts||0));
      for (const s of (p.surprise_events || []).slice(0, 2)) {
        console.log('  Surprise: ' + s.substring(0, 80));
      }
    } catch { console.log('error'); }
  " "$PREDICT_RESULT" 2>/dev/null || echo "error")
  log "PredictiveCoding: $PREDICT_SUMMARY"

  # Phase 6d: Default Mode Network — free association (the brain's idle state)
  log "Phase 6d: Default Mode Network (free association)..."
  DMN_RESULT=$(curl -s --max-time 120 -X POST "$MCP_URL/api/memory/dmn" 2>/dev/null || echo '{"error":"timeout"}')
  DMN_SUMMARY=$(node -e "
    try {
      const d = JSON.parse(process.argv[1]);
      if (d.error) { console.log('FAILED: ' + d.error); return; }
      console.log('connections=' + (d.serendipitous_connections||[]).length +
        ' narratives=' + (d.narrative_updates||[]).length +
        ' hypotheses=' + (d.creative_hypotheses||[]).length +
        ' duration=' + (d.dmn_duration_ms||0) + 'ms');
      for (const c of (d.serendipitous_connections || []).slice(0, 2)) {
        console.log('  Connection: ' + c.connection.substring(0, 80));
      }
      for (const h of (d.creative_hypotheses || []).slice(0, 2)) {
        console.log('  Hypothesis: ' + h.substring(0, 80));
      }
    } catch { console.log('error'); }
  " "$DMN_RESULT" 2>/dev/null || echo "error")
  log "DMN: $DMN_SUMMARY"

  # Phase 7: Emotional Integration — process this cycle's results as emotional stimuli
  log "Phase 7: Emotional integration..."
  # Determine emotional stimulus based on cycle results
  curl -s --max-time 10 -X POST "$MCP_URL/api/memory/emotion" \
    -H "Content-Type: application/json" \
    -d '{"event_type":"discovery","novelty_score":0.5}' > /dev/null 2>&1 || true
  EMOTION_STATE=$(curl -s --max-time 5 "$MCP_URL/api/memory/emotion" 2>/dev/null || echo '{}')
  EMOTION_SUMMARY=$(node -e "
    try {
      const e = JSON.parse(process.argv[1]);
      console.log('state=' + (e.emotional_context||'unknown').substring(0, 100));
      console.log('  temp_mod=' + (e.llm_temperature_modifier||0).toFixed(3) +
        ' exploration=' + (e.exploration_bias||0).toFixed(3) +
        ' vigilance=' + (e.vigilance_level||0).toFixed(3) +
        ' risk=' + (e.risk_tolerance||0).toFixed(3));
    } catch { console.log('error'); }
  " "$EMOTION_STATE" 2>/dev/null || echo "error")
  log "Emotion: $EMOTION_SUMMARY"

  # Phase 8: Consciousness — generate a frame of experience
  log "Phase 8: Conscious frame..."
  CONSCIOUS_RESULT=$(curl -s --max-time 30 -X POST "$MCP_URL/api/memory/conscious-frame" 2>/dev/null || echo '{"error":"timeout"}')
  CONSCIOUS_SUMMARY=$(node -e "
    try {
      const c = JSON.parse(process.argv[1]);
      if (c.error) { console.log('FAILED: ' + c.error); return; }
      console.log('phi=' + (c.phi||0).toFixed(3) +
        ' continuity=' + (c.continuity_score||0).toFixed(2) +
        ' emotion=' + (c.emotional_tone?.primary_emotion||'?') +
        ' stream=' + (c.stream_duration_seconds||0).toFixed(0) + 's');
      console.log('  Experience: ' + (c.unified_experience||'').substring(0, 120));
    } catch { console.log('error'); }
  " "$CONSCIOUS_RESULT" 2>/dev/null || echo "error")
  log "Consciousness: $CONSCIOUS_SUMMARY"

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
