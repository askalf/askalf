-- Brain-like cognitive shards for continuous learning

-- Dream Generator: Creates synthetic test cases during idle periods
INSERT INTO procedural_shards (id, name, description, logic, lifecycle, visibility, category, execution_count, success_count, failure_count)
VALUES (
  'shd_dream_generator_001',
  'dream-generator',
  'Generates synthetic test cases to stress-test shards during idle periods - like REM sleep for the brain',
  $LOGIC$function execute(input) {
  const shardInfo = typeof input === "string" ? { name: input, category: "general" } : input;
  const name = shardInfo.name || "unknown";
  const category = shardInfo.category || "general";

  const dreamStrategies = {
    math: [
      { type: "edge_case", cases: ["0", "negative numbers", "very large numbers", "decimals"] },
      { type: "malformed", cases: ["empty input", "text instead of numbers", "special characters"] },
      { type: "boundary", cases: ["MAX_SAFE_INTEGER", "Infinity", "NaN"] }
    ],
    string: [
      { type: "edge_case", cases: ["empty string", "single character", "unicode", "emojis"] },
      { type: "malformed", cases: ["null", "undefined", "numbers as input"] }
    ],
    validation: [
      { type: "edge_case", cases: ["valid edge cases", "almost valid", "unusual but valid"] },
      { type: "adversarial", cases: ["injection attempts", "overflow attempts"] }
    ],
    cognitive: [
      { type: "nuance", cases: ["ambiguous input", "contradictory signals", "mixed context"] },
      { type: "edge_case", cases: ["extreme confidence", "extreme uncertainty"] }
    ]
  };

  const strategies = dreamStrategies[category] || dreamStrategies.cognitive;
  const dreams = [];

  for (const strategy of strategies) {
    for (const testCase of strategy.cases) {
      dreams.push({
        shard: name,
        test_type: strategy.type,
        synthetic_input: testCase,
        priority: strategy.type === "edge_case" ? "high" : "medium"
      });
    }
  }

  return JSON.stringify({
    shard_name: name,
    dream_count: dreams.length,
    dreams: dreams.slice(0, 8),
    recommendation: "Run synthetic tests during low-activity periods"
  });
}$LOGIC$,
  'testing', 'private', 'brain', 0, 0, 0
)
ON CONFLICT (id) DO UPDATE SET logic = EXCLUDED.logic, description = EXCLUDED.description;

-- Capability Gap Detector: Identifies what the system cannot do
INSERT INTO procedural_shards (id, name, description, logic, lifecycle, visibility, category, execution_count, success_count, failure_count)
VALUES (
  'shd_capability_gap_001',
  'capability-gap-detector',
  'Identifies what the system cannot do - recognizing limits is crucial for targeted learning',
  $LOGIC$function execute(input) {
  const query = typeof input === "string" ? input : input.query || "";
  const queryLower = query.toLowerCase();

  const knownCategories = ["math", "string", "conversion", "validation", "extraction", "cognitive"];
  const gaps = [];

  const potentialNeeds = [
    { pattern: /matrix|matrices/i, capability: "matrix operations", category: "math", learnable: true },
    { pattern: /graph|network|nodes/i, capability: "graph algorithms", category: "data", learnable: true },
    { pattern: /translate|language/i, capability: "language translation", category: "nlp", learnable: false },
    { pattern: /sentiment|emotion/i, capability: "sentiment analysis", category: "nlp", learnable: true },
    { pattern: /image|picture|photo/i, capability: "image processing", category: "vision", learnable: false },
    { pattern: /audio|sound|speech/i, capability: "audio processing", category: "audio", learnable: false },
    { pattern: /encrypt|decrypt|hash/i, capability: "cryptography", category: "security", learnable: true },
    { pattern: /compress|zip/i, capability: "compression", category: "data", learnable: true },
    { pattern: /schedule|calendar|timezone/i, capability: "temporal reasoning", category: "time", learnable: true },
    { pattern: /parse.*json|xml|yaml/i, capability: "structured parsing", category: "data", learnable: true }
  ];

  for (const need of potentialNeeds) {
    if (need.pattern.test(queryLower)) {
      gaps.push({
        detected_need: need.capability,
        category: need.category,
        confidence: 0.8,
        can_learn: need.learnable
      });
    }
  }

  if (gaps.length === 0) {
    return JSON.stringify({
      query: query.substring(0, 100),
      gaps_detected: 0,
      assessment: "Query matches existing capabilities or is general knowledge",
      recommendation: "ROUTE_TO_EXISTING_SHARD"
    });
  }

  return JSON.stringify({
    query: query.substring(0, 100),
    gaps_detected: gaps.length,
    gaps: gaps,
    recommendation: gaps.some(g => g.can_learn) ? "CREATE_NEW_SHARD" : "ACKNOWLEDGE_LIMITATION"
  });
}$LOGIC$,
  'testing', 'private', 'brain', 0, 0, 0
)
ON CONFLICT (id) DO UPDATE SET logic = EXCLUDED.logic, description = EXCLUDED.description;

-- Neurogenesis Shard Creator: Creates new shard templates from gaps
INSERT INTO procedural_shards (id, name, description, logic, lifecycle, visibility, category, execution_count, success_count, failure_count)
VALUES (
  'shd_neurogenesis_001',
  'neurogenesis-shard-creator',
  'Creates new shard templates from identified capability gaps - the brains ability to grow new neurons',
  $LOGIC$function execute(input) {
  const gapInfo = typeof input === "string" ? { capability: input } : input;
  const capability = gapInfo.capability || gapInfo.detected_need || "unknown";
  const category = gapInfo.category || "general";

  const templateStrategies = {
    math: { pattern: "extract numbers, compute, return result", structure: "parse -> validate -> compute -> format" },
    string: { pattern: "extract text, transform, return result", structure: "parse -> validate -> transform -> format" },
    validation: { pattern: "extract value, check rules, return boolean", structure: "parse -> validate -> check -> explain" },
    cognitive: { pattern: "analyze patterns, score signals, return insight", structure: "parse -> detect -> score -> recommend" },
    data: { pattern: "parse structure, transform, return data", structure: "parse -> validate -> transform -> serialize" }
  };

  const strategy = templateStrategies[category] || templateStrategies.cognitive;

  const template = {
    name: capability.toLowerCase().replace(/\s+/g, "-"),
    description: "Auto-generated shard for: " + capability,
    category: category,
    structure: strategy.structure,
    pattern: strategy.pattern,
    skeleton: "function execute(input) { /* " + strategy.structure + " */ return JSON.stringify({ result: null }); }"
  };

  return JSON.stringify({
    new_capability: capability,
    template: template,
    next_steps: ["Implement logic", "Add edge cases", "Test with dream-generator", "Promote to testing"]
  });
}$LOGIC$,
  'testing', 'private', 'brain', 0, 0, 0
)
ON CONFLICT (id) DO UPDATE SET logic = EXCLUDED.logic, description = EXCLUDED.description;

-- Forgetting Curve Manager: Implements Ebbinghaus forgetting curve for proper decay
INSERT INTO procedural_shards (id, name, description, logic, lifecycle, visibility, category, execution_count, success_count, failure_count)
VALUES (
  'shd_forgetting_curve_001',
  'forgetting-curve-manager',
  'Implements Ebbinghaus forgetting curve - unused knowledge should decay, but at appropriate rates',
  $LOGIC$function execute(input) {
  const shardInfo = typeof input === "string" ? JSON.parse(input) : input;
  const lastUsed = shardInfo.last_used_days || 30;
  const totalUses = shardInfo.execution_count || 0;
  const successRate = shardInfo.success_rate || 0;
  const category = shardInfo.category || "general";

  // Ebbinghaus retention formula: R = e^(-t/S) where S is stability
  // Stability increases with: repetition, success, importance
  const baseStability = 7; // Base half-life in days
  const repetitionBonus = Math.log(totalUses + 1) * 2;
  const successBonus = successRate * 5;
  const categoryMultiplier = {
    brain: 2.0,      // Core cognitive shards decay slower
    cognitive: 1.5,  // Important reasoning shards
    math: 1.0,       // Standard utility
    string: 1.0,
    validation: 0.8, // Can be relearned easily
    conversion: 0.8
  };

  const stability = (baseStability + repetitionBonus + successBonus) * (categoryMultiplier[category] || 1.0);
  const retention = Math.exp(-lastUsed / stability);

  let recommendation;
  if (retention > 0.7) {
    recommendation = "KEEP_ACTIVE";
  } else if (retention > 0.4) {
    recommendation = "REINFORCE";
  } else if (retention > 0.2) {
    recommendation = "ARCHIVE_CANDIDATE";
  } else {
    recommendation = "SAFE_TO_ARCHIVE";
  }

  return JSON.stringify({
    retention_score: Math.round(retention * 100) / 100,
    stability_days: Math.round(stability),
    days_since_use: lastUsed,
    recommendation: recommendation,
    reasoning: retention > 0.5 ? "Well-established through use" : "Decaying due to disuse"
  });
}$LOGIC$,
  'testing', 'private', 'brain', 0, 0, 0
)
ON CONFLICT (id) DO UPDATE SET logic = EXCLUDED.logic, description = EXCLUDED.description;

-- Learning Rate Adjuster: Dynamically adjusts how fast new patterns are learned
INSERT INTO procedural_shards (id, name, description, logic, lifecycle, visibility, category, execution_count, success_count, failure_count)
VALUES (
  'shd_learning_rate_001',
  'learning-rate-adjuster',
  'Dynamically adjusts learning rate based on confidence, novelty, and error signals - like adaptive learning in neural networks',
  $LOGIC$function execute(input) {
  const context = typeof input === "string" ? JSON.parse(input) : input;
  const recentErrors = context.recent_errors || 0;
  const recentSuccesses = context.recent_successes || 0;
  const noveltyScore = context.novelty || 0.5;
  const currentConfidence = context.confidence || 0.5;

  // Base learning rate
  let learningRate = 0.1;

  // Adjust based on error rate (more errors = learn faster)
  const errorRate = recentErrors / (recentErrors + recentSuccesses + 1);
  if (errorRate > 0.3) {
    learningRate *= 1.5; // High error rate - need to learn faster
  } else if (errorRate < 0.1) {
    learningRate *= 0.7; // Low error rate - slow down, we are good
  }

  // Adjust based on novelty (novel patterns need faster learning)
  learningRate *= (0.5 + noveltyScore);

  // Adjust based on confidence (low confidence = be more open to learning)
  learningRate *= (1.5 - currentConfidence);

  // Clamp to reasonable bounds
  learningRate = Math.max(0.01, Math.min(0.5, learningRate));

  const mode = learningRate > 0.2 ? "EXPLORATION" : learningRate < 0.08 ? "CONSOLIDATION" : "BALANCED";

  return JSON.stringify({
    learning_rate: Math.round(learningRate * 1000) / 1000,
    mode: mode,
    factors: {
      error_rate: Math.round(errorRate * 100) / 100,
      novelty: noveltyScore,
      confidence: currentConfidence
    },
    recommendation: mode === "EXPLORATION" ? "Actively seek new patterns" : mode === "CONSOLIDATION" ? "Reinforce existing knowledge" : "Balance learning and application"
  });
}$LOGIC$,
  'testing', 'private', 'brain', 0, 0, 0
)
ON CONFLICT (id) DO UPDATE SET logic = EXCLUDED.logic, description = EXCLUDED.description;

-- Cognitive Load Balancer: Manages processing capacity like working memory
INSERT INTO procedural_shards (id, name, description, logic, lifecycle, visibility, category, execution_count, success_count, failure_count)
VALUES (
  'shd_cognitive_load_001',
  'cognitive-load-balancer',
  'Manages processing capacity like working memory - prevents overload and prioritizes important tasks',
  $LOGIC$function execute(input) {
  const context = typeof input === "string" ? JSON.parse(input) : input;
  const pendingTasks = context.pending_tasks || [];
  const currentLoad = context.current_load || 0;
  const maxCapacity = context.max_capacity || 7; // Millers 7 plus/minus 2

  const taskPriorities = pendingTasks.map(task => {
    let priority = 0.5;

    // Urgency boost
    if (task.urgent) priority += 0.3;

    // User-facing boost
    if (task.user_facing) priority += 0.2;

    // Complexity penalty (complex tasks need more capacity)
    const complexity = task.complexity || 0.5;
    const capacityNeeded = Math.ceil(complexity * 3);

    return {
      task: task.name || task.id,
      priority: Math.min(1, priority),
      capacity_needed: capacityNeeded,
      can_process: currentLoad + capacityNeeded <= maxCapacity
    };
  });

  // Sort by priority
  taskPriorities.sort((a, b) => b.priority - a.priority);

  const processNow = taskPriorities.filter(t => t.can_process);
  const defer = taskPriorities.filter(t => !t.can_process);

  const loadPercentage = Math.round((currentLoad / maxCapacity) * 100);
  let status;
  if (loadPercentage < 50) status = "AVAILABLE";
  else if (loadPercentage < 80) status = "MODERATE";
  else if (loadPercentage < 100) status = "HIGH";
  else status = "OVERLOADED";

  return JSON.stringify({
    status: status,
    current_load: currentLoad,
    capacity: maxCapacity,
    load_percentage: loadPercentage,
    process_now: processNow.slice(0, 3),
    defer: defer,
    recommendation: status === "OVERLOADED" ? "Shed low-priority tasks" : "Continue processing"
  });
}$LOGIC$,
  'testing', 'private', 'brain', 0, 0, 0
)
ON CONFLICT (id) DO UPDATE SET logic = EXCLUDED.logic, description = EXCLUDED.description;

-- Attention Focus Controller: Determines what to focus on like selective attention
INSERT INTO procedural_shards (id, name, description, logic, lifecycle, visibility, category, execution_count, success_count, failure_count)
VALUES (
  'shd_attention_focus_001',
  'attention-focus-controller',
  'Determines what to focus on like selective attention - filters noise and amplifies signal',
  $LOGIC$function execute(input) {
  const context = typeof input === "string" ? { signals: [input] } : input;
  const signals = context.signals || [];
  const currentGoal = context.goal || "general_processing";

  const scoredSignals = signals.map(signal => {
    const text = typeof signal === "string" ? signal : signal.content || "";
    let relevance = 0.5;
    let novelty = 0.5;
    let urgency = 0.3;

    // Goal relevance
    if (text.toLowerCase().includes(currentGoal.toLowerCase())) {
      relevance = 0.9;
    }

    // Urgency markers
    const urgentWords = ["error", "fail", "urgent", "critical", "now", "immediately"];
    if (urgentWords.some(w => text.toLowerCase().includes(w))) {
      urgency = 0.9;
    }

    // Novelty detection (question marks, new patterns)
    if (text.includes("?") || text.includes("new") || text.includes("unknown")) {
      novelty = 0.8;
    }

    // Combined attention score
    const attention = (relevance * 0.4) + (urgency * 0.35) + (novelty * 0.25);

    return {
      signal: text.substring(0, 50),
      attention_score: Math.round(attention * 100) / 100,
      factors: { relevance, urgency, novelty },
      action: attention > 0.7 ? "FOCUS" : attention > 0.4 ? "MONITOR" : "BACKGROUND"
    };
  });

  scoredSignals.sort((a, b) => b.attention_score - a.attention_score);

  return JSON.stringify({
    current_goal: currentGoal,
    focus_target: scoredSignals[0] || null,
    attention_queue: scoredSignals.slice(0, 5),
    filtered_out: scoredSignals.filter(s => s.action === "BACKGROUND").length
  });
}$LOGIC$,
  'testing', 'private', 'brain', 0, 0, 0
)
ON CONFLICT (id) DO UPDATE SET logic = EXCLUDED.logic, description = EXCLUDED.description;

-- Metacognitive Monitor: Thinks about thinking - monitors cognitive processes
INSERT INTO procedural_shards (id, name, description, logic, lifecycle, visibility, category, execution_count, success_count, failure_count)
VALUES (
  'shd_metacognitive_001',
  'metacognitive-monitor',
  'Thinks about thinking - monitors cognitive processes for efficiency and correctness',
  $LOGIC$function execute(input) {
  const processLog = typeof input === "string" ? JSON.parse(input) : input;
  const steps = processLog.steps || [];
  const outcome = processLog.outcome || "unknown";
  const duration = processLog.duration_ms || 0;

  const analysis = {
    efficiency: { score: 0, issues: [] },
    correctness: { score: 0, issues: [] },
    completeness: { score: 0, issues: [] }
  };

  // Efficiency analysis
  if (steps.length > 10) {
    analysis.efficiency.issues.push("Too many steps - consider optimization");
    analysis.efficiency.score = 0.5;
  } else if (duration > 5000) {
    analysis.efficiency.issues.push("Slow execution - identify bottleneck");
    analysis.efficiency.score = 0.6;
  } else {
    analysis.efficiency.score = 0.9;
  }

  // Correctness analysis
  if (outcome === "success") {
    analysis.correctness.score = 1.0;
  } else if (outcome === "partial") {
    analysis.correctness.score = 0.6;
    analysis.correctness.issues.push("Partial success - review edge cases");
  } else {
    analysis.correctness.score = 0.2;
    analysis.correctness.issues.push("Failure - needs debugging");
  }

  // Completeness analysis
  const hasValidation = steps.some(s => s.includes && s.includes("validat"));
  const hasErrorHandling = steps.some(s => s.includes && s.includes("error"));

  if (!hasValidation) analysis.completeness.issues.push("Missing input validation");
  if (!hasErrorHandling) analysis.completeness.issues.push("Missing error handling");
  analysis.completeness.score = 0.5 + (hasValidation ? 0.25 : 0) + (hasErrorHandling ? 0.25 : 0);

  const overallScore = (analysis.efficiency.score + analysis.correctness.score + analysis.completeness.score) / 3;

  return JSON.stringify({
    overall_score: Math.round(overallScore * 100) / 100,
    analysis: analysis,
    recommendation: overallScore > 0.8 ? "Process is healthy" : overallScore > 0.5 ? "Review flagged issues" : "Significant improvement needed",
    learning_opportunity: analysis.correctness.score < 0.8 || analysis.completeness.score < 0.8
  });
}$LOGIC$,
  'testing', 'private', 'brain', 0, 0, 0
)
ON CONFLICT (id) DO UPDATE SET logic = EXCLUDED.logic, description = EXCLUDED.description;
