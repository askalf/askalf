-- FEEDBACK LOOP SHARDS
-- These shards implement the actual learning logic

-- ============================================================
-- 1. ATTRIBUTION RECORDER
-- Records which shards contributed to a response
-- ============================================================
INSERT INTO procedural_shards (id, name, description, logic, lifecycle, visibility, category)
VALUES (
  'shd_attr_recorder_001',
  'attribution-recorder',
  'Records which shards contributed to a response for later feedback attribution',
  $LOGIC$function execute(input) {
  const data = typeof input === "string" ? JSON.parse(input) : input;

  // Required fields
  const conversationId = data.conversation_id;
  const messageId = data.message_id;
  const userId = data.user_id;
  const shardId = data.shard_id;
  const shardName = data.shard_name;

  // Optional context
  const inputGiven = data.input || "";
  const outputProduced = data.output || "";
  const executionTime = data.execution_time_ms || 0;
  const confidence = data.confidence || 0.5;
  const memoryContext = data.memory_context || {};

  if (!shardId) {
    return JSON.stringify({ error: "shard_id required", recorded: false });
  }

  // This would be executed by the system to record attribution
  // The shard returns the data structure to be inserted
  return JSON.stringify({
    recorded: true,
    attribution: {
      conversation_id: conversationId,
      message_id: messageId,
      user_id: userId,
      shard_id: shardId,
      shard_name: shardName,
      input_given: inputGiven.substring(0, 1000),
      output_produced: outputProduced.substring(0, 1000),
      execution_time_ms: executionTime,
      confidence_at_execution: confidence,
      memory_context: memoryContext
    },
    sql: "INSERT INTO response_attributions (conversation_id, message_id, user_id, shard_id, shard_name, input_given, output_produced, execution_time_ms, confidence_at_execution, memory_context) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)"
  });
}$LOGIC$,
  'testing', 'private', 'feedback'
)
ON CONFLICT (id) DO UPDATE SET logic = EXCLUDED.logic, description = EXCLUDED.description;

-- ============================================================
-- 2. FEEDBACK CLASSIFIER
-- Classifies user signals into positive/negative/neutral
-- ============================================================
INSERT INTO procedural_shards (id, name, description, logic, lifecycle, visibility, category)
VALUES (
  'shd_feedback_classifier_001',
  'feedback-classifier',
  'Classifies user input/behavior into feedback signals with scores',
  $LOGIC$function execute(input) {
  const data = typeof input === "string" ? JSON.parse(input) : input;
  const text = (data.text || data.message || "").toLowerCase();
  const behavior = data.behavior || {};

  // Explicit positive signals
  const explicitPositive = [
    "thanks", "thank you", "helpful", "great", "perfect", "exactly",
    "awesome", "amazing", "love it", "that worked", "solved", "fixed",
    "brilliant", "excellent", "wonderful", "fantastic", "appreciate"
  ];

  // Explicit negative signals
  const explicitNegative = [
    "wrong", "incorrect", "no", "not what i", "doesn't work", "broken",
    "useless", "unhelpful", "confused", "frustrating", "terrible",
    "bad", "awful", "hate", "stupid", "waste", "failed"
  ];

  // Check explicit signals in text
  let explicitScore = 0;
  let signalType = "neutral";
  let detectedSignals = [];

  for (const signal of explicitPositive) {
    if (text.includes(signal)) {
      explicitScore += 0.3;
      detectedSignals.push({ signal, type: "positive" });
    }
  }

  for (const signal of explicitNegative) {
    if (text.includes(signal)) {
      explicitScore -= 0.3;
      detectedSignals.push({ signal, type: "negative" });
    }
  }

  // Check behavioral signals
  let behaviorScore = 0;

  if (behavior.returned_same_session) behaviorScore += 0.1;
  if (behavior.returned_next_day) behaviorScore += 0.2;
  if (behavior.session_length_minutes > 10) behaviorScore += 0.1;
  if (behavior.follow_up_question) behaviorScore += 0.1;
  if (behavior.abandoned_immediately) behaviorScore -= 0.3;
  if (behavior.repeated_same_question) behaviorScore -= 0.2;
  if (behavior.expressed_confusion) behaviorScore -= 0.2;

  // Combine scores
  const totalScore = Math.max(-1, Math.min(1, explicitScore + behaviorScore));

  if (totalScore > 0.1) {
    signalType = "positive";
  } else if (totalScore < -0.1) {
    signalType = "negative";
  } else {
    signalType = "neutral";
  }

  // Determine feedback type for database
  let feedbackType;
  if (detectedSignals.length > 0) {
    feedbackType = signalType === "positive" ? "explicit_positive" : signalType === "negative" ? "explicit_negative" : "explicit_neutral";
  } else if (Object.keys(behavior).length > 0) {
    feedbackType = signalType === "positive" ? "implicit_positive" : signalType === "negative" ? "implicit_negative" : "implicit_neutral";
  } else {
    feedbackType = "unknown";
  }

  return JSON.stringify({
    feedback_type: feedbackType,
    feedback_score: Math.round(totalScore * 100) / 100,
    signal_type: signalType,
    detected_signals: detectedSignals,
    explicit_score: Math.round(explicitScore * 100) / 100,
    behavior_score: Math.round(behaviorScore * 100) / 100,
    confidence: Math.min(0.95, 0.3 + detectedSignals.length * 0.2 + Object.keys(behavior).length * 0.1)
  });
}$LOGIC$,
  'testing', 'private', 'feedback'
)
ON CONFLICT (id) DO UPDATE SET logic = EXCLUDED.logic, description = EXCLUDED.description;

-- ============================================================
-- 3. FEEDBACK PROPAGATOR
-- Propagates feedback to attributed shards
-- ============================================================
INSERT INTO procedural_shards (id, name, description, logic, lifecycle, visibility, category)
VALUES (
  'shd_feedback_propagator_001',
  'feedback-propagator',
  'Propagates user feedback to the shards that contributed to the response',
  $LOGIC$function execute(input) {
  const data = typeof input === "string" ? JSON.parse(input) : input;

  const feedbackId = data.feedback_id;
  const feedbackScore = data.feedback_score || 0; // -1 to +1
  const attributions = data.attributions || []; // [{shard_id, attribution_strength}]

  if (attributions.length === 0) {
    return JSON.stringify({ propagated: false, reason: "no_attributions" });
  }

  const propagations = [];
  const learningRate = 0.1; // How much each feedback event affects the score

  for (const attr of attributions) {
    const shardId = attr.shard_id;
    const strength = attr.attribution_strength || 1.0;
    const currentScore = attr.current_outcome_score || 0.5;

    // Calculate score change
    // Positive feedback pushes toward 1, negative toward 0
    const impact = feedbackScore * learningRate * strength;
    const newScore = Math.max(0, Math.min(1, currentScore + impact));
    const delta = newScore - currentScore;

    propagations.push({
      shard_id: shardId,
      previous_score: currentScore,
      new_score: Math.round(newScore * 1000) / 1000,
      delta: Math.round(delta * 1000) / 1000,
      attribution_strength: strength,
      feedback_impact: Math.round(impact * 1000) / 1000
    });
  }

  return JSON.stringify({
    propagated: true,
    feedback_id: feedbackId,
    feedback_score: feedbackScore,
    shards_affected: propagations.length,
    propagations: propagations,
    sql_template: "UPDATE procedural_shards SET outcome_score = $1, outcome_count = outcome_count + 1, last_outcome_at = NOW() WHERE id = $2"
  });
}$LOGIC$,
  'testing', 'private', 'feedback'
)
ON CONFLICT (id) DO UPDATE SET logic = EXCLUDED.logic, description = EXCLUDED.description;

-- ============================================================
-- 4. OUTCOME CALCULATOR
-- Calculates overall outcome score for a shard
-- ============================================================
INSERT INTO procedural_shards (id, name, description, logic, lifecycle, visibility, category)
VALUES (
  'shd_outcome_calc_001',
  'outcome-calculator',
  'Calculates outcome score from accumulated feedback with time decay',
  $LOGIC$function execute(input) {
  const data = typeof input === "string" ? JSON.parse(input) : input;

  const shardId = data.shard_id;
  const feedbackHistory = data.feedback_history || []; // [{score, timestamp, weight}]
  const currentScore = data.current_score || 0.5;

  if (feedbackHistory.length === 0) {
    return JSON.stringify({
      shard_id: shardId,
      outcome_score: currentScore,
      confidence: 0.5,
      trend: "stable",
      data_points: 0
    });
  }

  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  // Apply time decay: recent feedback matters more
  let weightedSum = 0;
  let totalWeight = 0;
  let recentPositive = 0;
  let recentNegative = 0;

  for (const fb of feedbackHistory) {
    const age = (now - (fb.timestamp || now)) / dayMs;
    const timeDecay = Math.exp(-age / 30); // Half-life of ~30 days
    const weight = (fb.weight || 1) * timeDecay;

    weightedSum += fb.score * weight;
    totalWeight += weight;

    // Track recent trend (last 7 days)
    if (age < 7) {
      if (fb.score > 0) recentPositive++;
      else if (fb.score < 0) recentNegative++;
    }
  }

  const newScore = totalWeight > 0 ? (weightedSum / totalWeight + 1) / 2 : 0.5; // Normalize to 0-1
  const confidence = Math.min(0.95, 0.3 + Math.log(feedbackHistory.length + 1) * 0.15);

  let trend = "stable";
  if (recentPositive > recentNegative * 2) trend = "improving";
  else if (recentNegative > recentPositive * 2) trend = "declining";

  return JSON.stringify({
    shard_id: shardId,
    outcome_score: Math.round(newScore * 1000) / 1000,
    previous_score: currentScore,
    change: Math.round((newScore - currentScore) * 1000) / 1000,
    confidence: Math.round(confidence * 100) / 100,
    trend: trend,
    data_points: feedbackHistory.length,
    recent_positive: recentPositive,
    recent_negative: recentNegative
  });
}$LOGIC$,
  'testing', 'private', 'feedback'
)
ON CONFLICT (id) DO UPDATE SET logic = EXCLUDED.logic, description = EXCLUDED.description;

-- ============================================================
-- 5. HELP RATE ANALYZER
-- Analyzes system-wide help rate metrics
-- ============================================================
INSERT INTO procedural_shards (id, name, description, logic, lifecycle, visibility, category)
VALUES (
  'shd_help_rate_001',
  'help-rate-analyzer',
  'Analyzes system-wide helpfulness metrics over time',
  $LOGIC$function execute(input) {
  const data = typeof input === "string" ? JSON.parse(input) : input;

  const periodType = data.period_type || "daily";
  const metrics = data.metrics || {};

  const totalResponses = metrics.total_responses || 0;
  const responsesWithFeedback = metrics.responses_with_feedback || 0;
  const positiveFeedback = metrics.positive_feedback || 0;
  const negativeFeedback = metrics.negative_feedback || 0;
  const previousHelpRate = data.previous_help_rate || 0.5;

  // Calculate rates
  const feedbackRate = totalResponses > 0 ? responsesWithFeedback / totalResponses : 0;
  const totalFeedback = positiveFeedback + negativeFeedback;
  const positiveRate = totalFeedback > 0 ? positiveFeedback / totalFeedback : 0.5;

  // Estimate help rate (weighted by feedback confidence)
  // If no feedback, assume neutral
  const feedbackConfidence = Math.min(0.9, feedbackRate * 2);
  const helpRate = feedbackConfidence * positiveRate + (1 - feedbackConfidence) * 0.5;

  const helpRateChange = helpRate - previousHelpRate;

  let status;
  if (helpRate > 0.7) status = "healthy";
  else if (helpRate > 0.5) status = "adequate";
  else if (helpRate > 0.3) status = "needs_attention";
  else status = "critical";

  let trend;
  if (helpRateChange > 0.05) trend = "improving";
  else if (helpRateChange < -0.05) trend = "declining";
  else trend = "stable";

  return JSON.stringify({
    period_type: periodType,
    help_rate: Math.round(helpRate * 1000) / 1000,
    positive_rate: Math.round(positiveRate * 1000) / 1000,
    feedback_rate: Math.round(feedbackRate * 1000) / 1000,
    help_rate_change: Math.round(helpRateChange * 1000) / 1000,
    status: status,
    trend: trend,
    confidence: Math.round(feedbackConfidence * 100) / 100,
    recommendation: status === "critical" ? "Investigate failing shards immediately" :
                    status === "needs_attention" ? "Review negative feedback patterns" :
                    trend === "declining" ? "Monitor for continued decline" :
                    "System performing well"
  });
}$LOGIC$,
  'testing', 'private', 'feedback'
)
ON CONFLICT (id) DO UPDATE SET logic = EXCLUDED.logic, description = EXCLUDED.description;

-- ============================================================
-- 6. REINFORCEMENT LEARNER
-- Determines how to adjust shard behavior based on outcomes
-- ============================================================
INSERT INTO procedural_shards (id, name, description, logic, lifecycle, visibility, category)
VALUES (
  'shd_reinforcement_001',
  'reinforcement-learner',
  'Determines adjustments to shard confidence and selection priority based on outcomes',
  $LOGIC$function execute(input) {
  const data = typeof input === "string" ? JSON.parse(input) : input;

  const shardId = data.shard_id;
  const shardName = data.shard_name;
  const outcomeScore = data.outcome_score || 0.5;
  const executionSuccessRate = data.execution_success_rate || 1.0;
  const outcomeCount = data.outcome_count || 0;
  const trend = data.trend || "stable";

  // Combined quality score
  // Execution success matters, but outcome matters more
  const qualityScore = (executionSuccessRate * 0.3) + (outcomeScore * 0.7);

  // Determine action based on quality and confidence
  let action;
  let selectionPriority;
  let confidenceAdjustment;

  if (outcomeCount < 10) {
    // Not enough data, maintain neutral
    action = "observe";
    selectionPriority = 0.5;
    confidenceAdjustment = 0;
  } else if (qualityScore > 0.8 && trend !== "declining") {
    // High performer
    action = "promote";
    selectionPriority = Math.min(1, 0.7 + qualityScore * 0.3);
    confidenceAdjustment = 0.1;
  } else if (qualityScore > 0.6) {
    // Adequate performer
    action = "maintain";
    selectionPriority = 0.5 + (qualityScore - 0.5) * 0.4;
    confidenceAdjustment = 0;
  } else if (qualityScore > 0.4) {
    // Underperformer
    action = "review";
    selectionPriority = 0.3;
    confidenceAdjustment = -0.1;
  } else {
    // Poor performer
    action = "deprioritize";
    selectionPriority = 0.1;
    confidenceAdjustment = -0.2;
  }

  // Trend adjustments
  if (trend === "improving") {
    selectionPriority = Math.min(1, selectionPriority + 0.1);
  } else if (trend === "declining") {
    selectionPriority = Math.max(0, selectionPriority - 0.1);
  }

  return JSON.stringify({
    shard_id: shardId,
    shard_name: shardName,
    quality_score: Math.round(qualityScore * 1000) / 1000,
    action: action,
    selection_priority: Math.round(selectionPriority * 1000) / 1000,
    confidence_adjustment: confidenceAdjustment,
    reasoning: {
      outcome_score: outcomeScore,
      execution_rate: executionSuccessRate,
      data_points: outcomeCount,
      trend: trend
    }
  });
}$LOGIC$,
  'testing', 'private', 'feedback'
)
ON CONFLICT (id) DO UPDATE SET logic = EXCLUDED.logic, description = EXCLUDED.description;

-- ============================================================
-- VERIFY NEW SHARDS
-- ============================================================
SELECT name, category, lifecycle FROM procedural_shards WHERE category = 'feedback' ORDER BY name;
