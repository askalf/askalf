-- BRAIN ORCHESTRATION SHARDS
-- Priority 4: Makes cognitive shards work together as a unified system
-- The "executive function" layer that coordinates all brain activities

-- ============================================================
-- 1. COGNITIVE ORCHESTRATOR
-- The central coordinator that decides which brain shards to invoke
-- ============================================================
INSERT INTO procedural_shards (id, name, description, logic, lifecycle, visibility, category)
VALUES (
  'shd_cognitive_orchestrator_001',
  'cognitive-orchestrator',
  'Central coordinator that orchestrates brain shard execution for complex tasks',
  $LOGIC$function execute(input) {
  const data = typeof input === "string" ? JSON.parse(input) : input;

  const taskType = data.task_type || "general";
  const complexity = data.complexity || "medium";
  const availableShards = data.available_shards || [];
  const memoryContext = data.memory || {};
  const currentState = data.current_state || {};

  // Define cognitive workflows for different task types
  const workflows = {
    "decision": [
      { shard: "memory-synthesis-director", purpose: "Determine which memory to query" },
      { shard: "memory-aware-decision-maker", purpose: "Make informed decision" },
      { shard: "learning-opportunity-detector", purpose: "Identify learning value" }
    ],
    "learning": [
      { shard: "experience-pattern-extractor", purpose: "Extract patterns from episodes" },
      { shard: "salience-attention-scorer", purpose: "Prioritize important patterns" },
      { shard: "memory-consolidation-processor", purpose: "Consolidate learnings" }
    ],
    "analysis": [
      { shard: "cognitive-load-balancer", purpose: "Assess task complexity" },
      { shard: "attention-focus-controller", purpose: "Focus on key aspects" },
      { shard: "metacognitive-monitor", purpose: "Monitor analysis quality" }
    ],
    "improvement": [
      { shard: "shard-improvement-proposer", purpose: "Identify improvements" },
      { shard: "shard-mutation-engine", purpose: "Generate variants" },
      { shard: "reinforcement-learner", purpose: "Evaluate changes" }
    ],
    "maintenance": [
      { shard: "forgetting-curve-manager", purpose: "Identify stale knowledge" },
      { shard: "shard-deprecation-manager", purpose: "Manage lifecycle" },
      { shard: "shard-consolidator", purpose: "Reduce redundancy" }
    ]
  };

  // Select workflow
  let selectedWorkflow = workflows[taskType] || workflows["analysis"];

  // Filter to available shards
  const availableSet = new Set(availableShards);
  selectedWorkflow = selectedWorkflow.filter(step =>
    availableSet.size === 0 || availableSet.has(step.shard)
  );

  // Adjust based on complexity
  if (complexity === "low") {
    selectedWorkflow = selectedWorkflow.slice(0, 2);
  } else if (complexity === "high") {
    // Add metacognitive monitoring for complex tasks
    if (!selectedWorkflow.find(s => s.shard === "metacognitive-monitor")) {
      selectedWorkflow.push({
        shard: "metacognitive-monitor",
        purpose: "Monitor execution quality"
      });
    }
  }

  // Build execution plan
  const executionPlan = selectedWorkflow.map((step, index) => ({
    order: index + 1,
    shard: step.shard,
    purpose: step.purpose,
    inputFrom: index === 0 ? "original" : selectedWorkflow[index - 1].shard,
    parallel: false
  }));

  // Identify parallel opportunities
  // Shards that don't depend on each other can run in parallel
  if (executionPlan.length >= 3) {
    // Memory gathering steps can often run in parallel
    const memorySteps = executionPlan.filter(s =>
      s.shard.includes("memory") && s.order > 1
    );
    if (memorySteps.length > 1) {
      memorySteps.forEach(s => { s.parallel = true; });
    }
  }

  return JSON.stringify({
    orchestrated: true,
    taskType,
    complexity,
    workflowSelected: taskType,
    stepsPlanned: executionPlan.length,
    executionPlan,
    parallelSteps: executionPlan.filter(s => s.parallel).length,
    estimatedCognitiveLoad: complexity === "high" ? 0.8 : complexity === "medium" ? 0.5 : 0.3,
    memoryContextAvailable: Object.keys(memoryContext).length > 0,
    recommendation: executionPlan.length > 0
      ? "Execute shards in order: " + executionPlan.map(s => s.shard).join(" → ")
      : "No suitable workflow found for task type"
  });
}$LOGIC$,
  'testing', 'private', 'brain'
)
ON CONFLICT (id) DO UPDATE SET logic = EXCLUDED.logic, description = EXCLUDED.description;

-- ============================================================
-- 2. INTER-SHARD COMMUNICATOR
-- Manages data flow and state between shard executions
-- ============================================================
INSERT INTO procedural_shards (id, name, description, logic, lifecycle, visibility, category)
VALUES (
  'shd_inter_shard_comm_001',
  'inter-shard-communicator',
  'Manages data flow and shared state between brain shard executions',
  $LOGIC$function execute(input) {
  const data = typeof input === "string" ? JSON.parse(input) : input;

  const sourceShardResult = data.source_result || {};
  const targetShardName = data.target_shard || "";
  const sharedState = data.shared_state || {};
  const executionContext = data.execution_context || {};

  // Extract relevant outputs from source
  const relevantOutputs = {};

  // Common output patterns to forward
  const forwardableKeys = [
    "recommendation", "action", "confidence", "score",
    "patterns", "insights", "analysis", "result",
    "shouldLearn", "memoryUtilized", "priority"
  ];

  for (const key of forwardableKeys) {
    if (sourceShardResult[key] !== undefined) {
      relevantOutputs[key] = sourceShardResult[key];
    }
  }

  // Build input for target shard
  const targetInput = {
    // Original context
    ...executionContext,

    // Forwarded outputs
    previous_shard_output: relevantOutputs,

    // Accumulated state
    accumulated_state: {
      ...sharedState,
      last_shard: data.source_shard || "unknown",
      chain_length: (sharedState.chain_length || 0) + 1,
      total_confidence: (sharedState.total_confidence || 0) + (relevantOutputs.confidence || 0.5)
    },

    // Memory context if available
    memory: data.memory || {}
  };

  // Determine what to emphasize based on target shard
  const emphasisMap = {
    "reinforcement-learner": ["outcome_score", "success_rate", "trend"],
    "metacognitive-monitor": ["steps", "outcome", "duration_ms"],
    "memory-consolidation-processor": ["patterns", "insights", "shouldLearn"],
    "shard-improvement-proposer": ["success_rate", "outcome_score", "failure_patterns"]
  };

  const emphasis = emphasisMap[targetShardName] || [];
  targetInput.emphasized_fields = emphasis;

  // Calculate communication quality
  const relevantFieldCount = Object.keys(relevantOutputs).length;
  const communicationQuality = Math.min(1, relevantFieldCount / 5);

  return JSON.stringify({
    communicated: true,
    sourceShard: data.source_shard || "unknown",
    targetShard: targetShardName,
    fieldsForwarded: relevantFieldCount,
    forwardedKeys: Object.keys(relevantOutputs),
    targetInput,
    communicationQuality: Math.round(communicationQuality * 100) / 100,
    chainLength: targetInput.accumulated_state.chain_length,
    averageConfidence: targetInput.accumulated_state.chain_length > 0
      ? Math.round((targetInput.accumulated_state.total_confidence / targetInput.accumulated_state.chain_length) * 100) / 100
      : 0.5
  });
}$LOGIC$,
  'testing', 'private', 'brain'
)
ON CONFLICT (id) DO UPDATE SET logic = EXCLUDED.logic, description = EXCLUDED.description;

-- ============================================================
-- 3. COGNITIVE PIPELINE EXECUTOR
-- Executes a sequence of brain shards as a pipeline
-- ============================================================
INSERT INTO procedural_shards (id, name, description, logic, lifecycle, visibility, category)
VALUES (
  'shd_pipeline_executor_001',
  'cognitive-pipeline-executor',
  'Executes orchestrated brain shard pipelines and aggregates results',
  $LOGIC$function execute(input) {
  const data = typeof input === "string" ? JSON.parse(input) : input;

  const pipelineSteps = data.steps || [];
  const stepResults = data.step_results || [];
  const currentStep = data.current_step || 0;

  if (pipelineSteps.length === 0) {
    return JSON.stringify({
      executed: false,
      error: "No pipeline steps provided"
    });
  }

  // Analyze execution progress
  const completedSteps = stepResults.length;
  const totalSteps = pipelineSteps.length;
  const progress = totalSteps > 0 ? completedSteps / totalSteps : 0;

  // Aggregate metrics from completed steps
  const aggregatedMetrics = {
    totalConfidence: 0,
    successfulSteps: 0,
    failedSteps: 0,
    totalExecutionMs: 0,
    learningOpportunities: 0
  };

  const insights = [];

  for (const result of stepResults) {
    if (result.success !== false) {
      aggregatedMetrics.successfulSteps++;
    } else {
      aggregatedMetrics.failedSteps++;
    }

    if (result.confidence !== undefined) {
      aggregatedMetrics.totalConfidence += result.confidence;
    }

    if (result.execution_ms !== undefined) {
      aggregatedMetrics.totalExecutionMs += result.execution_ms;
    }

    if (result.shouldLearn === true) {
      aggregatedMetrics.learningOpportunities++;
    }

    // Collect insights
    if (result.recommendation) {
      insights.push({
        step: result.step_name || "unknown",
        insight: result.recommendation
      });
    }
  }

  // Determine pipeline health
  const successRate = completedSteps > 0
    ? aggregatedMetrics.successfulSteps / completedSteps
    : 1;

  let pipelineHealth = "healthy";
  if (successRate < 0.5) {
    pipelineHealth = "critical";
  } else if (successRate < 0.8) {
    pipelineHealth = "degraded";
  }

  // Determine next action
  let nextAction = "continue";
  let nextStep = null;

  if (completedSteps >= totalSteps) {
    nextAction = "complete";
  } else if (pipelineHealth === "critical") {
    nextAction = "abort";
  } else {
    nextStep = pipelineSteps[completedSteps];
  }

  return JSON.stringify({
    executed: true,
    progress: Math.round(progress * 100) / 100,
    completedSteps,
    totalSteps,
    pipelineHealth,
    aggregatedMetrics: {
      ...aggregatedMetrics,
      avgConfidence: completedSteps > 0
        ? Math.round((aggregatedMetrics.totalConfidence / completedSteps) * 100) / 100
        : 0.5,
      avgExecutionMs: completedSteps > 0
        ? Math.round(aggregatedMetrics.totalExecutionMs / completedSteps)
        : 0
    },
    insights: insights.slice(0, 5),
    nextAction,
    nextStep,
    shouldRecordEpisode: nextAction === "complete" || nextAction === "abort",
    recommendation: nextAction === "complete"
      ? "Pipeline completed successfully with " + aggregatedMetrics.learningOpportunities + " learning opportunities"
      : nextAction === "abort"
        ? "Pipeline failed - review step results for issues"
        : "Continue with step: " + (nextStep ? nextStep.shard : "unknown")
  });
}$LOGIC$,
  'testing', 'private', 'brain'
)
ON CONFLICT (id) DO UPDATE SET logic = EXCLUDED.logic, description = EXCLUDED.description;

-- ============================================================
-- 4. BRAIN STATE MANAGER
-- Maintains and queries the overall brain state
-- ============================================================
INSERT INTO procedural_shards (id, name, description, logic, lifecycle, visibility, category)
VALUES (
  'shd_brain_state_manager_001',
  'brain-state-manager',
  'Maintains and queries the overall cognitive state of the brain system',
  $LOGIC$function execute(input) {
  const data = typeof input === "string" ? JSON.parse(input) : input;

  const action = data.action || "query";
  const currentState = data.current_state || {};
  const updateData = data.update || {};

  // Default brain state structure
  const defaultState = {
    // Cognitive resources
    attentionLevel: 1.0,
    cognitiveLoad: 0.0,
    memoryPressure: 0.0,

    // Learning state
    recentLearnings: 0,
    pendingConsolidation: 0,
    activePatterns: 0,

    // Performance metrics
    overallConfidence: 0.5,
    recentSuccessRate: 0.8,
    outcomeScore: 0.5,

    // System health
    activeShards: 0,
    stalledPipelines: 0,
    errorRate: 0.0,

    // Timestamps
    lastUpdate: null,
    lastLearningCycle: null,
    lastMaintenanceCycle: null
  };

  let state = { ...defaultState, ...currentState };

  if (action === "update") {
    // Apply updates
    for (const [key, value] of Object.entries(updateData)) {
      if (state.hasOwnProperty(key)) {
        state[key] = value;
      }
    }
    state.lastUpdate = new Date().toISOString();
  }

  // Calculate derived metrics
  const healthScore = calculateHealthScore(state);
  const readiness = calculateReadiness(state);
  const needsMaintenance = checkMaintenanceNeeded(state);
  const needsLearning = checkLearningNeeded(state);

  function calculateHealthScore(s) {
    let score = 1.0;
    score -= s.cognitiveLoad * 0.3;
    score -= s.memoryPressure * 0.2;
    score -= s.errorRate * 0.3;
    score += (s.recentSuccessRate - 0.5) * 0.2;
    return Math.max(0, Math.min(1, score));
  }

  function calculateReadiness(s) {
    if (s.cognitiveLoad > 0.9) return "overloaded";
    if (s.errorRate > 0.3) return "degraded";
    if (s.attentionLevel < 0.3) return "fatigued";
    if (s.stalledPipelines > 0) return "blocked";
    return "ready";
  }

  function checkMaintenanceNeeded(s) {
    return s.memoryPressure > 0.7 ||
           s.stalledPipelines > 2 ||
           s.errorRate > 0.2;
  }

  function checkLearningNeeded(s) {
    return s.pendingConsolidation > 10 ||
           s.recentLearnings < 5;
  }

  // Generate recommendations
  const recommendations = [];

  if (state.cognitiveLoad > 0.8) {
    recommendations.push("Reduce parallel tasks - cognitive load high");
  }
  if (state.memoryPressure > 0.7) {
    recommendations.push("Run memory consolidation - pressure high");
  }
  if (state.errorRate > 0.2) {
    recommendations.push("Review failing shards - error rate elevated");
  }
  if (state.pendingConsolidation > 10) {
    recommendations.push("Process pending learnings - consolidation backlog");
  }

  return JSON.stringify({
    action,
    state,
    derived: {
      healthScore: Math.round(healthScore * 100) / 100,
      readiness,
      needsMaintenance,
      needsLearning
    },
    recommendations,
    status: readiness === "ready" ? "operational" : "attention_needed"
  });
}$LOGIC$,
  'testing', 'private', 'brain'
)
ON CONFLICT (id) DO UPDATE SET logic = EXCLUDED.logic, description = EXCLUDED.description;

-- ============================================================
-- 5. COGNITIVE CYCLE RUNNER
-- Runs complete cognitive cycles (perceive → decide → act → learn)
-- ============================================================
INSERT INTO procedural_shards (id, name, description, logic, lifecycle, visibility, category)
VALUES (
  'shd_cognitive_cycle_001',
  'cognitive-cycle-runner',
  'Executes complete cognitive cycles following the perceive-decide-act-learn pattern',
  $LOGIC$function execute(input) {
  const data = typeof input === "string" ? JSON.parse(input) : input;

  const phase = data.phase || "perceive";
  const cycleState = data.cycle_state || {};
  const phaseResult = data.phase_result || null;

  // Cognitive cycle phases
  const phases = ["perceive", "decide", "act", "learn", "consolidate"];
  const currentIndex = phases.indexOf(phase);

  // Phase-specific processing
  let phaseOutput = {};
  let nextPhase = null;
  let shardsToInvoke = [];

  switch (phase) {
    case "perceive":
      // Gather information and context
      shardsToInvoke = [
        "memory-synthesis-director",
        "context-relevance-scorer",
        "attention-focus-controller"
      ];
      phaseOutput = {
        memoryGathered: true,
        contextScored: true,
        attentionFocused: true
      };
      nextPhase = "decide";
      break;

    case "decide":
      // Make decisions based on perception
      shardsToInvoke = [
        "memory-aware-decision-maker",
        "cognitive-load-balancer",
        "fact-consistency-checker"
      ];
      phaseOutput = {
        decisionMade: true,
        loadBalanced: true,
        factsChecked: true
      };
      nextPhase = "act";
      break;

    case "act":
      // Execute the decision
      shardsToInvoke = [
        "cognitive-orchestrator",
        "cognitive-pipeline-executor"
      ];
      phaseOutput = {
        actionExecuted: true,
        pipelineCompleted: true
      };
      nextPhase = "learn";
      break;

    case "learn":
      // Extract learnings from the action
      shardsToInvoke = [
        "learning-opportunity-detector",
        "experience-pattern-extractor",
        "reinforcement-learner"
      ];
      phaseOutput = {
        learningExtracted: true,
        patternsIdentified: true,
        reinforcementApplied: true
      };
      nextPhase = "consolidate";
      break;

    case "consolidate":
      // Consolidate learnings into long-term memory
      shardsToInvoke = [
        "memory-consolidation-processor",
        "metacognitive-monitor",
        "brain-state-manager"
      ];
      phaseOutput = {
        memoryConsolidated: true,
        cycleMonitored: true,
        stateUpdated: true
      };
      nextPhase = null; // Cycle complete
      break;
  }

  // Update cycle state
  const newCycleState = {
    ...cycleState,
    [phase]: {
      completed: true,
      timestamp: new Date().toISOString(),
      result: phaseResult
    }
  };

  // Calculate cycle progress
  const completedPhases = Object.keys(newCycleState).filter(k =>
    phases.includes(k) && newCycleState[k]?.completed
  ).length;
  const progress = completedPhases / phases.length;

  return JSON.stringify({
    currentPhase: phase,
    phaseOutput,
    shardsToInvoke,
    nextPhase,
    cycleComplete: nextPhase === null,
    progress: Math.round(progress * 100) / 100,
    cycleState: newCycleState,
    phasesCompleted: completedPhases,
    totalPhases: phases.length,
    recommendation: nextPhase
      ? "Proceed to " + nextPhase + " phase with shards: " + shardsToInvoke.join(", ")
      : "Cognitive cycle complete - ready for new cycle"
  });
}$LOGIC$,
  'testing', 'private', 'brain'
)
ON CONFLICT (id) DO UPDATE SET logic = EXCLUDED.logic, description = EXCLUDED.description;

-- ============================================================
-- VERIFY ORCHESTRATION SHARDS
-- ============================================================
SELECT name, category, lifecycle FROM procedural_shards
WHERE name IN ('cognitive-orchestrator', 'inter-shard-communicator', 'cognitive-pipeline-executor', 'brain-state-manager', 'cognitive-cycle-runner')
ORDER BY name;
