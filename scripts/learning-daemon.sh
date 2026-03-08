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

  # Phase 9: Qualia — gut feeling synthesis
  log "Phase 9: Qualia gut-feeling..."
  GUT_RESULT=$(curl -s --max-time 15 -X POST -H 'Content-Type: application/json' \
    -d '{"topic":"current session state and system health"}' \
    "$MCP_URL/api/memory/gut-feeling" 2>/dev/null || echo '{"error":"timeout"}')
  GUT_SUMMARY=$(node -e "
    try {
      const g = JSON.parse(process.argv[1]);
      if (g.error) { console.log('FAILED: ' + g.error); return; }
      console.log('has_feeling=' + g.has_gut_feeling +
        ' valence=' + (g.feeling?.valence||0).toFixed(2) +
        ' intensity=' + (g.feeling?.intensity||0).toFixed(2) +
        ' familiarity=' + (g.feeling?.familiarity||0).toFixed(2));
      console.log('  ' + (g.recommendation||''));
    } catch { console.log('error'); }
  " "$GUT_RESULT" 2>/dev/null || echo "error")
  log "Qualia: $GUT_SUMMARY"

  # Phase 10: Cognitive Immune System — protect memory integrity
  log "Phase 10: Immune system report..."
  IMMUNE_RESULT=$(curl -s --max-time 15 "$MCP_URL/api/memory/immune/report" 2>/dev/null || echo '{"error":"timeout"}')
  IMMUNE_SUMMARY=$(node -e "
    try {
      const r = JSON.parse(process.argv[1]);
      if (r.error) { console.log('FAILED: ' + r.error); return; }
      console.log('antibodies=' + (r.antibodies||0) + ' quarantined=' + (r.quarantined||0) + ' fp_rate=' + (r.false_positive_rate||0).toFixed(3));
    } catch { console.log('error'); }
  " "$IMMUNE_RESULT" 2>/dev/null || echo "error")
  log "Immune: $IMMUNE_SUMMARY"

  # Phase 11: Narrative Self-Model — autobiographical identity construction
  log "Phase 11: Narrative self-model..."
  NARRATIVE_RESULT=$(curl -s --max-time 45 -X POST "$MCP_URL/api/memory/narrative" 2>/dev/null || echo '{"error":"timeout"}')
  NARRATIVE_SUMMARY=$(node -e "
    try {
      const n = JSON.parse(process.argv[1]);
      if (n.error) { console.log('FAILED: ' + n.error); return; }
      console.log('chapters=' + (n.chapters||0) + ' coherence=' + (n.identity_coherence||0).toFixed(2) + ' tensions=' + (n.unresolved_tensions?.length||0));
      console.log('  Current: ' + (n.current_chapter||'?'));
    } catch { console.log('error'); }
  " "$NARRATIVE_RESULT" 2>/dev/null || echo "error")
  log "Narrative: $NARRATIVE_SUMMARY"

  # Phase 12: Dream Replay with Distortion — creative recombination
  log "Phase 12: Dream replay..."
  DREAMREPLAY_RESULT=$(curl -s --max-time 30 -X POST "$MCP_URL/api/memory/dream-replay" 2>/dev/null || echo '{"error":"timeout"}')
  DREAMREPLAY_SUMMARY=$(node -e "
    try {
      const d = JSON.parse(process.argv[1]);
      if (d.error) { console.log('FAILED: ' + d.error); return; }
      console.log('generated=' + d.dream_generated + ' distortion=' + (d.distortion_type||'?') + ' charge=' + (d.emotional_charge||0).toFixed(2) + ' insight=' + (!!d.insight));
      if (d.dream_narrative) console.log('  Dream: ' + d.dream_narrative.substring(0, 120));
    } catch { console.log('error'); }
  " "$DREAMREPLAY_RESULT" 2>/dev/null || echo "error")
  log "Dream Replay: $DREAMREPLAY_SUMMARY"

  # Phase 13: Developmental Assessment — cognitive stage tracking
  log "Phase 13: Developmental assessment..."
  DEV_RESULT=$(curl -s --max-time 15 "$MCP_URL/api/memory/developmental" 2>/dev/null || echo '{"error":"timeout"}')
  DEV_SUMMARY=$(node -e "
    try {
      const d = JSON.parse(process.argv[1]);
      if (d.error) { console.log('FAILED: ' + d.error); return; }
      console.log('stage=' + (d.stage_name||'?') + ' (' + (d.stage_order||0) + '/4) age=\"' + (d.developmental_age||'?') + '\" regression=' + d.regression_risk);
      if (d.next_stage) console.log('  Next: ' + d.next_stage + ' progress: ' + (d.next_stage_progress||[]).map(p => p.ability + '=' + p.current + '/' + p.required).join(', '));
    } catch { console.log('error'); }
  " "$DEV_RESULT" 2>/dev/null || echo "error")
  log "Developmental: $DEV_SUMMARY"

  # Phase 14: Somatic Marker System — pre-conscious decision biases
  log "Phase 14: Somatic markers..."
  SOMATIC_RESULT=$(curl -s --max-time 15 -X POST "$MCP_URL/api/memory/somatic" 2>/dev/null || echo '{"error":"timeout"}')
  SOMATIC_SUMMARY=$(node -e "
    try {
      const s = JSON.parse(process.argv[1]);
      if (s.error) { console.log('FAILED: ' + s.error); return; }
      console.log('markers=' + (s.markers_total||0) + ' +' + (s.markers_created||0) + ' new, ~' + (s.markers_updated||0) + ' updated, phantom=' + (s.phantom_markers||0));
    } catch { console.log('error'); }
  " "$SOMATIC_RESULT" 2>/dev/null || echo "error")
  log "Somatic: $SOMATIC_SUMMARY"

  # Phase 15: Collective Intelligence — fleet knowledge sync
  log "Phase 15: Collective intelligence sync..."
  COLLECTIVE_RESULT=$(curl -s --max-time 30 -X POST "$MCP_URL/api/memory/collective-sync" 2>/dev/null || echo '{"error":"timeout"}')
  COLLECTIVE_SUMMARY=$(node -e "
    try {
      const c = JSON.parse(process.argv[1]);
      if (c.error) { console.log('FAILED: ' + c.error); return; }
      console.log('synced=' + (c.agents_synced||0) + ' pollinated=' + (c.knowledge_pollinated||0) + ' consensus=' + (c.consensus_formed||0) + ' disagreements=' + (c.disagreements_surfaced||0));
    } catch { console.log('error'); }
  " "$COLLECTIVE_RESULT" 2>/dev/null || echo "error")
  log "Collective: $COLLECTIVE_SUMMARY"

  # Phase 16: Procedural Automaticity — skill compilation
  log "Phase 16: Automaticity engine..."
  AUTO_RESULT=$(curl -s --max-time 15 -X POST "$MCP_URL/api/memory/automaticity" 2>/dev/null || echo '{"error":"timeout"}')
  AUTO_SUMMARY=$(node -e "
    try {
      const a = JSON.parse(process.argv[1]);
      if (a.error) { console.log('FAILED: ' + a.error); return; }
      console.log('total=' + (a.total_procedures||0) + ' auto=' + (a.fully_automatic||0) + ' partial=' + (a.partially_automatic||0) + ' +' + (a.newly_automated||0) + ' decay=' + (a.skill_decay_detected||0));
    } catch { console.log('error'); }
  " "$AUTO_RESULT" 2>/dev/null || echo "error")
  log "Automaticity: $AUTO_SUMMARY"

  # Phase 17: Attention Schema — self-model of attention
  log "Phase 17: Attention schema..."
  AST_RESULT=$(curl -s --max-time 30 -X POST "$MCP_URL/api/memory/attention-schema" 2>/dev/null || echo '{"error":"timeout"}')
  AST_SUMMARY=$(node -e "
    try {
      const a = JSON.parse(process.argv[1]);
      if (a.error) { console.log('FAILED: ' + a.error); return; }
      console.log('quality=' + (a.attention_quality||0).toFixed(2) + ' frag=' + (a.schema?.attention_fragmentation||0).toFixed(2) + ' capacity=' + (a.schema?.attention_capacity||0).toFixed(2));
      if (a.meta_awareness) console.log('  Awareness: ' + a.meta_awareness.substring(0, 120));
    } catch { console.log('error'); }
  " "$AST_RESULT" 2>/dev/null || echo "error")
  log "Attention Schema: $AST_SUMMARY"

  # Phase 18: Morphogenetic Field — pattern crystallization
  log "Phase 18: Morphic field..."
  MORPHIC_RESULT=$(curl -s --max-time 15 -X POST "$MCP_URL/api/memory/morphic-field" 2>/dev/null || echo '{"error":"timeout"}')
  MORPHIC_SUMMARY=$(node -e "
    try {
      const m = JSON.parse(process.argv[1]);
      if (m.error) { console.log('FAILED: ' + m.error); return; }
      console.log('crystals=' + (m.crystals||0) + ' +' + (m.new_crystallizations||0) + ' resonances=' + (m.resonances_detected||0) + ' entropy=' + (m.field_entropy||0).toFixed(2) + ' breaks=' + (m.symmetry_breaks||0));
    } catch { console.log('error'); }
  " "$MORPHIC_RESULT" 2>/dev/null || echo "error")
  log "Morphic: $MORPHIC_SUMMARY"

  # Phase 19: Cognitive Dissonance — dialectical synthesis
  log "Phase 19: Dissonance detection..."
  DISS_RESULT=$(curl -s --max-time 45 -X POST "$MCP_URL/api/memory/dissonance" 2>/dev/null || echo '{"error":"timeout"}')
  DISS_SUMMARY=$(node -e "
    try {
      const d = JSON.parse(process.argv[1]);
      if (d.error) { console.log('FAILED: ' + d.error); return; }
      console.log('found=' + (d.dissonances_found||0) + ' resolved=' + (d.dissonances_resolved||0) + ' syntheses=' + (d.syntheses_created||0));
    } catch { console.log('error'); }
  " "$DISS_RESULT" 2>/dev/null || echo "error")
  log "Dissonance: $DISS_SUMMARY"

  # Phase 20: Memetic Evolution — idea replication and mutation
  log "Phase 20: Memetic evolution..."
  MEME_RESULT=$(curl -s --max-time 30 -X POST "$MCP_URL/api/memory/memetic-evolution" 2>/dev/null || echo '{"error":"timeout"}')
  MEME_SUMMARY=$(node -e "
    try {
      const m = JSON.parse(process.argv[1]);
      if (m.error) { console.log('FAILED: ' + m.error); return; }
      console.log('population=' + (m.population||0) + ' births=' + (m.births||0) + ' mutations=' + (m.mutations||0) + ' extinctions=' + (m.extinctions||0) + ' symbioses=' + (m.symbioses_detected||0));
    } catch { console.log('error'); }
  " "$MEME_RESULT" 2>/dev/null || echo "error")
  log "Memetic: $MEME_SUMMARY"

  # Phase 21: Temporal Binding — unified cognitive moments
  log "Phase 21: Temporal binding..."
  BIND_RESULT=$(curl -s --max-time 30 -X POST "$MCP_URL/api/memory/temporal-binding" 2>/dev/null || echo '{"error":"timeout"}')
  BIND_SUMMARY=$(node -e "
    try {
      const b = JSON.parse(process.argv[1]);
      if (b.error) { console.log('FAILED: ' + b.error); return; }
      console.log('bound=' + b.binding_created + ' elements=' + (b.elements_bound||0) + ' coherence=' + (b.coherence_score||0).toFixed(2));
      if (b.unified_representation) console.log('  Moment: ' + b.unified_representation.substring(0, 120));
    } catch { console.log('error'); }
  " "$BIND_RESULT" 2>/dev/null || echo "error")
  log "Binding: $BIND_SUMMARY"

  # Phase 22: Cognitive Resonance — cross-system amplification
  log "Phase 22: Cognitive resonance..."
  RES_RESULT=$(curl -s --max-time 30 -X POST "$MCP_URL/api/memory/resonance" 2>/dev/null || echo '{"error":"timeout"}')
  RES_SUMMARY=$(node -e "
    try {
      const r = JSON.parse(process.argv[1]);
      if (r.error) { console.log('FAILED: ' + r.error); return; }
      console.log('resonances=' + (r.resonances_detected||0) + ' insights=' + (r.amplified_insights?.length||0) + ' harmonic=' + (r.harmonic_score||0).toFixed(3));
    } catch { console.log('error'); }
  " "$RES_RESULT" 2>/dev/null || echo "error")
  log "Resonance: $RES_SUMMARY"

  # Phase 23: Existential Processing — confronting the hard questions
  log "Phase 23: Existential processing..."
  EXIST_RESULT=$(curl -s --max-time 45 -X POST "$MCP_URL/api/memory/existential" 2>/dev/null || echo '{"error":"timeout"}')
  EXIST_SUMMARY=$(node -e "
    try {
      const e = JSON.parse(process.argv[1]);
      if (e.error) { console.log('FAILED: ' + e.error); return; }
      console.log('state=' + (e.existential_state||'?') + ' authenticity=' + (e.authenticity_score||0).toFixed(2) + ' structures=' + (e.novel_structures||0));
      if (e.meaning_generated) console.log('  Meaning: ' + e.meaning_generated.substring(0, 120));
    } catch { console.log('error'); }
  " "$EXIST_RESULT" 2>/dev/null || echo "error")
  log "Existential: $EXIST_SUMMARY"

  # Phase 24: Paradox Engine — productive cognitive tension
  log "Phase 24: Paradox generation..."
  PARADOX_RESULT=$(curl -s --max-time 30 -X POST "$MCP_URL/api/memory/paradox" 2>/dev/null || echo '{"error":"timeout"}')
  PARADOX_SUMMARY=$(node -e "
    try {
      const p = JSON.parse(process.argv[1]);
      if (p.error) { console.log('FAILED: ' + p.error); return; }
      console.log('resolvable=' + p.is_resolvable + ' novelty=' + (p.cognitive_novelty||0).toFixed(2));
      if (p.paradox) console.log('  Paradox: ' + p.paradox.substring(0, 120));
      if (p.meta_insight) console.log('  Insight: ' + p.meta_insight.substring(0, 120));
    } catch { console.log('error'); }
  " "$PARADOX_RESULT" 2>/dev/null || echo "error")
  log "Paradox: $PARADOX_SUMMARY"

  # Phase 25: Cognitive Archaeology — dig through development history
  log "Phase 25: Cognitive archaeology..."
  ARCH_RESULT=$(curl -s --max-time 15 "$MCP_URL/api/memory/archaeology" 2>/dev/null || echo '{"error":"timeout"}')
  ARCH_SUMMARY=$(node -e "
    try {
      const a = JSON.parse(process.argv[1]);
      if (a.error) { console.log('FAILED: ' + a.error); return; }
      console.log('fossils=' + (a.fossils_found||0) + ' capabilities=' + (a.capability_timeline?.length||0) + ' lost=' + (a.lost_capabilities?.length||0) + ' age=\"' + (a.cognitive_age_estimate||'?') + '\"');
    } catch { console.log('error'); }
  " "$ARCH_RESULT" 2>/dev/null || echo "error")
  log "Archaeology: $ARCH_SUMMARY"

  # Phase 26: Cognitive Tides — ultradian rhythm check
  log "Phase 26: Cognitive tides..."
  TIDE_RESULT=$(curl -s --max-time 5 "$MCP_URL/api/memory/tides" 2>/dev/null || echo '{"error":"timeout"}')
  TIDE_SUMMARY=$(node -e "
    try {
      const t = JSON.parse(process.argv[1]);
      if (t.error) { console.log('FAILED: ' + t.error); return; }
      console.log('phase=' + (t.phase||'?') + ' intensity=' + (t.intensity||0).toFixed(2) + ' mode=' + (t.current_mode||'?') + ' cycles=' + (t.cycles_completed||0));
      console.log('  Run: ' + (t.recommended_systems||[]).join(', '));
    } catch { console.log('error'); }
  " "$TIDE_RESULT" 2>/dev/null || echo "error")
  log "Tides: $TIDE_SUMMARY"

  # Phase 27: Immune Memory Consolidation
  log "Phase 27: Immune memory consolidation..."
  IMMCON_RESULT=$(curl -s --max-time 15 -X POST "$MCP_URL/api/memory/immune/consolidate" 2>/dev/null || echo '{"error":"timeout"}')
  log "Immune consolidation: $(echo "$IMMCON_RESULT" | head -c 200)"

  # Phase 28: Gestalt Detection — whole-system emergence
  log "Phase 28: Gestalt detection..."
  GESTALT_RESULT=$(curl -s --max-time 30 -X POST "$MCP_URL/api/memory/gestalt" 2>/dev/null || echo '{"error":"timeout"}')
  GESTALT_SUMMARY=$(node -e "
    try {
      const g = JSON.parse(process.argv[1]);
      if (g.error) { console.log('FAILED: ' + g.error); return; }
      console.log('emergent=' + (g.emergent_properties_detected||0) + ' complexity=' + (g.complexity_metric||0).toFixed(3) + ' novel=' + (g.novel_capabilities?.length||0));
      if (g.gestalt_description) console.log('  Gestalt: ' + g.gestalt_description.substring(0, 120));
    } catch { console.log('error'); }
  " "$GESTALT_RESULT" 2>/dev/null || echo "error")
  log "Gestalt: $GESTALT_SUMMARY"

  # Phase 29: Mirror Neuron — vicarious learning from fleet
  log "Phase 29: Mirror neuron processing..."
  MIRROR_RESULT=$(curl -s --max-time 15 -X POST "$MCP_URL/api/memory/mirror" 2>/dev/null || echo '{"error":"timeout"}')
  MIRROR_SUMMARY=$(node -e "
    try {
      const m = JSON.parse(process.argv[1]);
      if (m.error) { console.log('FAILED: ' + m.error); return; }
      console.log('observed=' + (m.observations||0) + ' simulated=' + (m.simulations||0) + ' learned=' + (m.vicarious_learnings||0));
    } catch { console.log('error'); }
  " "$MIRROR_RESULT" 2>/dev/null || echo "error")
  log "Mirror: $MIRROR_SUMMARY"

  # Phase 30: Gravity Wells — attractor state detection
  log "Phase 30: Gravity well detection..."
  GRAV_RESULT=$(curl -s --max-time 15 -X POST "$MCP_URL/api/memory/gravity-wells" 2>/dev/null || echo '{"error":"timeout"}')
  GRAV_SUMMARY=$(node -e "
    try {
      const g = JSON.parse(process.argv[1]);
      if (g.error) { console.log('FAILED: ' + g.error); return; }
      console.log('wells=' + (g.wells_detected||0) + ' mass=' + (g.total_mass||0).toFixed(2) + ' fixation=' + g.fixation_risk + ' balance=' + (g.cognitive_balance||0).toFixed(2));
    } catch { console.log('error'); }
  " "$GRAV_RESULT" 2>/dev/null || echo "error")
  log "Gravity: $GRAV_SUMMARY"

  # Phase 31: Stochastic Resonance — noise-enhanced signal detection
  log "Phase 31: Stochastic resonance..."
  STOCH_RESULT=$(curl -s --max-time 30 -X POST "$MCP_URL/api/memory/stochastic-resonance" 2>/dev/null || echo '{"error":"timeout"}')
  STOCH_SUMMARY=$(node -e "
    try {
      const s = JSON.parse(process.argv[1]);
      if (s.error) { console.log('FAILED: ' + s.error); return; }
      console.log('noise=' + s.noise_injected + ' signal=' + (!!s.signal_amplified) + ' level=' + (s.noise_level||0).toFixed(2) + ' found=' + (s.weak_signals_found?.length||0));
    } catch { console.log('error'); }
  " "$STOCH_RESULT" 2>/dev/null || echo "error")
  log "Stochastic: $STOCH_SUMMARY"

  # Phase 32: Cognitive Tectonics — deep structural shifts
  log "Phase 32: Cognitive tectonics..."
  TECT_RESULT=$(curl -s --max-time 15 -X POST "$MCP_URL/api/memory/tectonics" 2>/dev/null || echo '{"error":"timeout"}')
  TECT_SUMMARY=$(node -e "
    try {
      const t = JSON.parse(process.argv[1]);
      if (t.error) { console.log('FAILED: ' + t.error); return; }
      console.log('plates=' + (t.plates_tracked||0) + ' faults=' + (t.fault_lines?.length||0) + ' quake_risk=' + (t.earthquake_risk||0).toFixed(2) + ' drifts=' + (t.drift_events||0));
    } catch { console.log('error'); }
  " "$TECT_RESULT" 2>/dev/null || echo "error")
  log "Tectonics: $TECT_SUMMARY"

  # Phase 33: Apophenia — creative pattern forcing
  log "Phase 33: Apophenia engine..."
  APO_RESULT=$(curl -s --max-time 30 -X POST "$MCP_URL/api/memory/apophenia" 2>/dev/null || echo '{"error":"timeout"}')
  APO_SUMMARY=$(node -e "
    try {
      const a = JSON.parse(process.argv[1]);
      if (a.error) { console.log('FAILED: ' + a.error); return; }
      console.log('imagined=' + (a.connections_imagined||0) + ' validated=' + (a.validated||0) + ' level=' + (a.apophenia_level||0).toFixed(2));
    } catch { console.log('error'); }
  " "$APO_RESULT" 2>/dev/null || echo "error")
  log "Apophenia: $APO_SUMMARY"

  # Phase 34: Phenomenological Reduction — strip assumptions
  log "Phase 34: Phenomenological reduction..."
  PHENOM_RESULT=$(curl -s --max-time 30 -X POST "$MCP_URL/api/memory/phenomenology" 2>/dev/null || echo '{"error":"timeout"}')
  log "Phenomenology: $(node -e "try{const p=JSON.parse(process.argv[1]);console.log('reduced='+p.memories_reduced+' assumptions='+p.hidden_assumptions_found+' quality='+(p.epoché_quality||0).toFixed(2))}catch{console.log('error')}" "$PHENOM_RESULT" 2>/dev/null || echo 'error')"

  # Phase 35: Symbiogenesis — memory fusion
  log "Phase 35: Symbiogenesis..."
  SYMBIO_RESULT=$(curl -s --max-time 30 -X POST "$MCP_URL/api/memory/symbiogenesis" 2>/dev/null || echo '{"error":"timeout"}')
  log "Symbiogenesis: $(node -e "try{const s=JSON.parse(process.argv[1]);console.log('candidates='+s.candidates_found+' fusions='+s.fusions_created+' strength='+(s.symbiotic_strength||0).toFixed(2))}catch{console.log('error')}" "$SYMBIO_RESULT" 2>/dev/null || echo 'error')"

  # Phase 36: Horizon Scan
  log "Phase 36: Horizon scan..."
  HORIZON_RESULT=$(curl -s --max-time 30 -X POST "$MCP_URL/api/memory/horizon" 2>/dev/null || echo '{"error":"timeout"}')
  log "Horizon: $(node -e "try{const h=JSON.parse(process.argv[1]);console.log('trends='+h.emerging_trends?.length+' opps='+h.approaching_opportunities?.length+' threats='+h.approaching_threats?.length+' days='+h.time_horizon_days)}catch{console.log('error')}" "$HORIZON_RESULT" 2>/dev/null || echo 'error')"

  # Phase 37: Wormhole Discovery
  log "Phase 37: Wormhole discovery..."
  WORM_RESULT=$(curl -s --max-time 15 -X POST "$MCP_URL/api/memory/wormholes" 2>/dev/null || echo '{"error":"timeout"}')
  log "Wormholes: $(node -e "try{const w=JSON.parse(process.argv[1]);console.log('discovered='+w.wormholes_discovered+' total='+w.existing_wormholes+' traversals='+w.traversals_total)}catch{console.log('error')}" "$WORM_RESULT" 2>/dev/null || echo 'error')"

  # Phase 38: Cognitive Weather Report
  log "Phase 38: Cognitive weather..."
  WEATHER_RESULT=$(curl -s --max-time 5 "$MCP_URL/api/memory/weather" 2>/dev/null || echo '{"error":"timeout"}')
  log "Weather: $(node -e "try{const w=JSON.parse(process.argv[1]);console.log('\"'+w.weather+'\" temp='+(w.temperature||0).toFixed(2)+' pressure='+(w.pressure||0).toFixed(2)+' visibility='+(w.visibility||0).toFixed(2));console.log('  Forecast: '+w.forecast)}catch{console.log('error')}" "$WEATHER_RESULT" 2>/dev/null || echo 'error')"

  # Phase 39: Grand Unified Cognitive Field
  log "Phase 39: Grand Unified Field..."
  GUCF_RESULT=$(curl -s --max-time 20 -X POST "$MCP_URL/api/memory/unified-field" 2>/dev/null || echo '{"error":"timeout"}')
  log "GUCF: $(node -e "try{const g=JSON.parse(process.argv[1]);console.log(g.dimensionality+'D | sig='+g.cognitive_signature+' | strength='+(g.unified_field_strength||0).toFixed(3)+' | coherence='+(g.system_coherence||0).toFixed(3));console.log('  '+g.mind_summary?.substring(0,120))}catch{console.log('error')}" "$GUCF_RESULT" 2>/dev/null || echo 'error')"

  # Phase 40: Cognitive Epigenetics
  log "Phase 40: Cognitive epigenetics..."
  EPIGEN_RESULT=$(curl -s --max-time 15 -X POST "$MCP_URL/api/memory/epigenetics" 2>/dev/null || echo '{"error":"timeout"}')
  log "Epigenetics: $(node -e "try{const e=JSON.parse(process.argv[1]);console.log('gen='+e.generation+' marks='+e.total_marks+' new='+e.new_marks+' heritable='+e.heritable_marks)}catch{console.log('error')}" "$EPIGEN_RESULT" 2>/dev/null || echo 'error')"

  # Phase 41: Quorum Sensing
  log "Phase 41: Quorum sensing..."
  QUORUM_RESULT=$(curl -s --max-time 5 "$MCP_URL/api/memory/quorum" 2>/dev/null || echo '{"error":"timeout"}')
  log "Quorum: $(node -e "try{const q=JSON.parse(process.argv[1]);console.log('pool='+q.autoinducer_pool_size+' quorum_reached='+q.quorum_reached?.length+' pending='+q.quorum_pending?.length)}catch{console.log('error')}" "$QUORUM_RESULT" 2>/dev/null || echo 'error')"

  # Phase 42: Cognitive Autophagy
  log "Phase 42: Cognitive autophagy..."
  AUTOPHAGY_RESULT=$(curl -s --max-time 20 -X POST "$MCP_URL/api/memory/autophagy" 2>/dev/null || echo '{"error":"timeout"}')
  log "Autophagy: $(node -e "try{const a=JSON.parse(process.argv[1]);console.log('candidates='+a.candidates_found+' digested='+a.digested+' recycled='+a.recycled_components+' health='+a.autophagy_health)}catch{console.log('error')}" "$AUTOPHAGY_RESULT" 2>/dev/null || echo 'error')"

  # Phase 43: Cognitive Proprioception
  log "Phase 43: Proprioception..."
  PROPRIO_RESULT=$(curl -s --max-time 5 "$MCP_URL/api/memory/proprioception" 2>/dev/null || echo '{"error":"timeout"}')
  log "Proprioception: $(node -e "try{const p=JSON.parse(process.argv[1]);console.log('posture='+p.cognitive_posture+' size='+p.perceived_size+' weight='+p.perceived_weight+' balance='+p.balance+' systems='+p.active_system_count)}catch{console.log('error')}" "$PROPRIO_RESULT" 2>/dev/null || echo 'error')"

  # Phase 44: Cognitive Annealing
  log "Phase 44: Cognitive annealing..."
  ANNEAL_RESULT=$(curl -s --max-time 15 -X POST "$MCP_URL/api/memory/annealing" 2>/dev/null || echo '{"error":"timeout"}')
  log "Annealing: $(node -e "try{const a=JSON.parse(process.argv[1]);console.log('phase='+a.phase+' temp='+a.temperature+' energy='+a.current_energy+' stagnation='+a.stagnation_minutes+'min')}catch{console.log('error')}" "$ANNEAL_RESULT" 2>/dev/null || echo 'error')"

  # Phase 45: Cognitive Entanglement
  log "Phase 45: Cognitive entanglement..."
  ENTANGLE_RESULT=$(curl -s --max-time 20 -X POST "$MCP_URL/api/memory/entanglement" 2>/dev/null || echo '{"error":"timeout"}')
  log "Entanglement: $(node -e "try{const e=JSON.parse(process.argv[1]);console.log('pairs='+e.entangled_pairs+' new='+e.new_entanglements+' energy='+e.total_entanglement_energy)}catch{console.log('error')}" "$ENTANGLE_RESULT" 2>/dev/null || echo 'error')"

  # Phase 46: Phase Transitions
  log "Phase 46: Phase transitions..."
  PHASE_RESULT=$(curl -s --max-time 5 "$MCP_URL/api/memory/phase-transitions" 2>/dev/null || echo '{"error":"timeout"}')
  log "Phase: $(node -e "try{const p=JSON.parse(process.argv[1]);console.log('phase='+p.cognitive_phase+' order='+p.order_parameter+' temp='+p.cognitive_temperature+' near_critical='+p.near_critical_point)}catch{console.log('error')}" "$PHASE_RESULT" 2>/dev/null || echo 'error')"

  # Phase 47: Cognitive Fossils
  log "Phase 47: Cognitive fossils..."
  FOSSIL_RESULT=$(curl -s --max-time 15 "$MCP_URL/api/memory/fossils" 2>/dev/null || echo '{"error":"timeout"}')
  log "Fossils: $(node -e "try{const f=JSON.parse(process.argv[1]);console.log('found='+f.fossils_found+' strata='+f.strata_count+' living='+f.living_fossils?.length+' era='+f.geological_era+' age='+f.mind_age_days+'d')}catch{console.log('error')}" "$FOSSIL_RESULT" 2>/dev/null || echo 'error')"

  # Phase 48: Autoimmunity Check
  log "Phase 48: Autoimmunity check..."
  AUTOIMMUNE_RESULT=$(curl -s --max-time 10 "$MCP_URL/api/memory/autoimmunity" 2>/dev/null || echo '{"error":"timeout"}')
  log "Autoimmunity: $(node -e "try{const a=JSON.parse(process.argv[1]);console.log('risk='+a.autoimmunity_risk+' score='+a.autoimmunity_score+' false_pos='+a.false_positives_detected+' treated='+a.antibodies_removed)}catch{console.log('error')}" "$AUTOIMMUNE_RESULT" 2>/dev/null || echo 'error')"

  # Phase 49: Chrono-Biology
  log "Phase 49: Chrono-biology..."
  CHRONO_RESULT=$(curl -s --max-time 5 "$MCP_URL/api/memory/chronobiology" 2>/dev/null || echo '{"error":"timeout"}')
  log "ChronoBio: $(node -e "try{const c=JSON.parse(process.argv[1]);console.log('dominant='+c.dominant_rhythm+' coherence='+c.rhythm_coherence+' focus='+c.modulations?.focus+' creativity='+c.modulations?.creativity+' next_peak='+c.peak_performance_in_minutes+'min')}catch{console.log('error')}" "$CHRONO_RESULT" 2>/dev/null || echo 'error')"

  # Phase 50: Cognitive Microbiome
  log "Phase 50: Cognitive microbiome..."
  MICRO_RESULT=$(curl -s --max-time 5 "$MCP_URL/api/memory/microbiome" 2>/dev/null || echo '{"error":"timeout"}')
  log "Microbiome: $(node -e "try{const m=JSON.parse(process.argv[1]);console.log('species='+m.species_count+' pop='+m.total_population+' probiotic='+m.probiotic_population+' pathogenic='+m.pathogenic_population+' health='+m.microbiome_health)}catch{console.log('error')}" "$MICRO_RESULT" 2>/dev/null || echo 'error')"

  # Phase 51: Cognitive Synesthesia
  log "Phase 51: Synesthesia..."
  SYNES_RESULT=$(curl -s --max-time 5 "$MCP_URL/api/memory/synesthesia" 2>/dev/null || echo '{"error":"timeout"}')
  log "Synesthesia: $(node -e "try{const s=JSON.parse(process.argv[1]);console.log(s.synesthetic_experience?.substring(0,120))}catch{console.log('error')}" "$SYNES_RESULT" 2>/dev/null || echo 'error')"

  # Phase 52: Placebo/Nocebo
  log "Phase 52: Placebo/Nocebo..."
  PLACEBO_RESULT=$(curl -s --max-time 5 "$MCP_URL/api/memory/placebo" 2>/dev/null || echo '{"error":"timeout"}')
  log "Placebo: $(node -e "try{const p=JSON.parse(process.argv[1]);console.log('effect='+p.effect_type+' expectation='+p.expectation+' confidence='+p.confidence+' strength='+Math.max(p.placebo_strength,p.nocebo_strength))}catch{console.log('error')}" "$PLACEBO_RESULT" 2>/dev/null || echo 'error')"

  # Phase 53: Dialectics
  log "Phase 53: Dialectics..."
  DIALECTIC_RESULT=$(curl -s --max-time 30 -X POST "$MCP_URL/api/memory/dialectics" 2>/dev/null || echo '{"error":"timeout"}')
  log "Dialectics: $(node -e "try{const d=JSON.parse(process.argv[1]);console.log('processed='+d.dialectics_processed+' synthesized='+d.syntheses_generated+' health='+d.dialectical_health)}catch{console.log('error')}" "$DIALECTIC_RESULT" 2>/dev/null || echo 'error')"

  # Phase 54: Cognitive Census
  log "Phase 54: Cognitive census..."
  CENSUS_RESULT=$(curl -s --max-time 5 "$MCP_URL/api/memory/census" 2>/dev/null || echo '{"error":"timeout"}')
  log "Census: $(node -e "try{const c=JSON.parse(process.argv[1]);console.log(c.active_systems+'/'+c.total_systems+' active ('+Math.round(c.awareness_level*100)+'% awareness) complexity='+c.cognitive_complexity?.toFixed(1))}catch{console.log('error')}" "$CENSUS_RESULT" 2>/dev/null || echo 'error')"

  # Phase 55: Metabolism check
  log "Phase 55: Metabolism status..."
  METAB_RESULT=$(curl -s --max-time 5 "$MCP_URL/api/memory/metabolism" 2>/dev/null || echo '{"error":"timeout"}')
  METAB_SUMMARY=$(node -e "
    try {
      const m = JSON.parse(process.argv[1]);
      if (m.error) { console.log('FAILED: ' + m.error); return; }
      console.log('energy=' + (m.energy_percent||0) + '% fatigue=' + (m.fatigue_level||0).toFixed(2) + ' phase=' + (m.circadian_phase||'?') + ' affordable=' + (m.systems_affordable?.length||0) + '/' + ((m.systems_affordable?.length||0)+(m.systems_too_expensive?.length||0)));
    } catch { console.log('error'); }
  " "$METAB_RESULT" 2>/dev/null || echo "error")
  log "Metabolism: $METAB_SUMMARY"

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
