-- MEMORY INTEGRATION SHARDS
-- These shards receive memory context and make decisions based on past experiences
-- Part of Priority 2: Memory Integration

-- ============================================================
-- 1. MEMORY-AWARE DECISION MAKER
-- Uses past experiences to guide current decisions
-- ============================================================
INSERT INTO procedural_shards (id, name, description, logic, lifecycle, visibility, category)
VALUES (
  'shd_memory_decision_001',
  'memory-aware-decision-maker',
  'Makes decisions informed by similar past experiences from episodic memory',
  $LOGIC$function execute(input) {
  const data = typeof input === "string" ? JSON.parse(input) : input;

  // Extract memory context
  const memory = data.memory || {};
  const episodes = memory.episodes || [];
  const insights = memory.insights || {};
  const original = data.original || data;

  // Analyze past experiences
  const successCount = episodes.filter(e => e.success === true).length;
  const failureCount = episodes.filter(e => e.success === false).length;
  const totalExperiences = successCount + failureCount;

  // Calculate experience-based confidence
  let confidenceAdjustment = 0;
  let recommendation = "proceed_with_caution";
  let reasoning = [];

  if (totalExperiences === 0) {
    recommendation = "explore";
    reasoning.push("No similar past experiences found - this is a learning opportunity");
    confidenceAdjustment = -0.1;
  } else {
    const successRate = successCount / totalExperiences;

    if (successRate >= 0.8) {
      recommendation = "proceed_confidently";
      confidenceAdjustment = 0.15;
      reasoning.push(`High success rate (${(successRate * 100).toFixed(0)}%) in similar situations`);
    } else if (successRate >= 0.5) {
      recommendation = "proceed_with_caution";
      confidenceAdjustment = 0.05;
      reasoning.push(`Moderate success rate (${(successRate * 100).toFixed(0)}%) - apply learned patterns`);
    } else {
      recommendation = "reconsider_approach";
      confidenceAdjustment = -0.15;
      reasoning.push(`Low success rate (${(successRate * 100).toFixed(0)}%) - past approaches often failed`);
    }
  }

  // Incorporate success/failure patterns
  const successPatterns = insights.successPatterns || [];
  const failurePatterns = insights.failurePatterns || [];

  if (successPatterns.length > 0) {
    reasoning.push(`Apply these success patterns: ${successPatterns.slice(0, 2).join("; ")}`);
  }

  if (failurePatterns.length > 0) {
    reasoning.push(`Avoid these failure patterns: ${failurePatterns.slice(0, 2).join("; ")}`);
  }

  // Factor in relevant knowledge
  const relevantKnowledge = insights.relevantKnowledge || [];
  if (relevantKnowledge.length > 0) {
    reasoning.push(`Consider known facts: ${relevantKnowledge.slice(0, 2).join("; ")}`);
  }

  return JSON.stringify({
    recommendation,
    confidenceAdjustment: Math.round(confidenceAdjustment * 100) / 100,
    experiencesSampled: totalExperiences,
    successRate: totalExperiences > 0 ? Math.round((successCount / totalExperiences) * 100) / 100 : null,
    reasoning,
    shouldLearn: totalExperiences < 5,
    memoryUtilized: true
  });
}$LOGIC$,
  'testing', 'private', 'brain'
)
ON CONFLICT (id) DO UPDATE SET logic = EXCLUDED.logic, description = EXCLUDED.description;

-- ============================================================
-- 2. EXPERIENCE PATTERN EXTRACTOR
-- Extracts learning patterns from episode collections
-- ============================================================
INSERT INTO procedural_shards (id, name, description, logic, lifecycle, visibility, category)
VALUES (
  'shd_pattern_extractor_001',
  'experience-pattern-extractor',
  'Extracts actionable patterns from collections of similar experiences',
  $LOGIC$function execute(input) {
  const data = typeof input === "string" ? JSON.parse(input) : input;

  const episodes = data.episodes || [];
  if (episodes.length < 2) {
    return JSON.stringify({
      extracted: false,
      reason: "Need at least 2 episodes to extract patterns",
      patterns: []
    });
  }

  // Group episodes by outcome
  const successEpisodes = episodes.filter(e => e.success === true);
  const failureEpisodes = episodes.filter(e => e.success === false);

  const patterns = [];

  // Extract success patterns
  if (successEpisodes.length >= 2) {
    // Look for common elements in situations
    const situationKeys = new Map();
    for (const ep of successEpisodes) {
      const situation = ep.situation || {};
      for (const [key, value] of Object.entries(situation)) {
        const keyStr = `${key}:${JSON.stringify(value)}`;
        situationKeys.set(keyStr, (situationKeys.get(keyStr) || 0) + 1);
      }
    }

    // Find patterns that appear in majority of successes
    const threshold = Math.ceil(successEpisodes.length * 0.6);
    for (const [pattern, count] of situationKeys) {
      if (count >= threshold) {
        patterns.push({
          type: "success_indicator",
          pattern: pattern,
          frequency: count / successEpisodes.length,
          description: `This pattern appeared in ${count}/${successEpisodes.length} successful executions`
        });
      }
    }
  }

  // Extract failure patterns
  if (failureEpisodes.length >= 2) {
    const situationKeys = new Map();
    for (const ep of failureEpisodes) {
      const situation = ep.situation || {};
      for (const [key, value] of Object.entries(situation)) {
        const keyStr = `${key}:${JSON.stringify(value)}`;
        situationKeys.set(keyStr, (situationKeys.get(keyStr) || 0) + 1);
      }
    }

    const threshold = Math.ceil(failureEpisodes.length * 0.6);
    for (const [pattern, count] of situationKeys) {
      if (count >= threshold) {
        patterns.push({
          type: "failure_indicator",
          pattern: pattern,
          frequency: count / failureEpisodes.length,
          description: `This pattern appeared in ${count}/${failureEpisodes.length} failed executions`
        });
      }
    }
  }

  return JSON.stringify({
    extracted: patterns.length > 0,
    totalEpisodes: episodes.length,
    successCount: successEpisodes.length,
    failureCount: failureEpisodes.length,
    patterns: patterns.slice(0, 10),
    overallSuccessRate: episodes.length > 0 ? Math.round((successEpisodes.length / episodes.length) * 100) / 100 : 0
  });
}$LOGIC$,
  'testing', 'private', 'brain'
)
ON CONFLICT (id) DO UPDATE SET logic = EXCLUDED.logic, description = EXCLUDED.description;

-- ============================================================
-- 3. FACT CONSISTENCY CHECKER
-- Verifies new information against known facts
-- ============================================================
INSERT INTO procedural_shards (id, name, description, logic, lifecycle, visibility, category)
VALUES (
  'shd_fact_checker_001',
  'fact-consistency-checker',
  'Checks if new information is consistent with known facts from semantic memory',
  $LOGIC$function execute(input) {
  const data = typeof input === "string" ? JSON.parse(input) : input;

  const newClaim = data.claim || data.statement || "";
  const facts = data.facts || (data.memory && data.memory.facts) || [];

  if (!newClaim || facts.length === 0) {
    return JSON.stringify({
      consistent: null,
      reason: newClaim ? "No known facts to check against" : "No claim provided",
      confidence: 0,
      relatedFacts: []
    });
  }

  // Simple consistency checking via keyword overlap
  const claimWords = new Set(newClaim.toLowerCase().split(/\W+/).filter(w => w.length > 3));
  const relatedFacts = [];
  let supportingEvidence = 0;
  let contradictingEvidence = 0;

  for (const fact of facts) {
    const factWords = new Set(fact.statement.toLowerCase().split(/\W+/).filter(w => w.length > 3));

    // Calculate word overlap
    let overlap = 0;
    for (const word of claimWords) {
      if (factWords.has(word)) overlap++;
    }

    if (overlap >= 2) {
      relatedFacts.push({
        statement: fact.statement,
        confidence: fact.confidence,
        overlap: overlap
      });

      // Higher confidence facts count more
      if (fact.confidence >= 0.7) {
        supportingEvidence += fact.confidence;
      }
    }
  }

  // Simple heuristic: if we found related high-confidence facts, likely consistent
  const consistent = relatedFacts.length > 0 && supportingEvidence > contradictingEvidence;
  const confidence = relatedFacts.length > 0
    ? Math.min(0.9, supportingEvidence / relatedFacts.length)
    : 0.5;

  return JSON.stringify({
    consistent,
    confidence: Math.round(confidence * 100) / 100,
    relatedFactsFound: relatedFacts.length,
    relatedFacts: relatedFacts.slice(0, 5),
    recommendation: relatedFacts.length === 0
      ? "No related facts found - this may be new knowledge"
      : consistent
        ? "Claim appears consistent with known facts"
        : "Claim may contradict known facts - verify carefully"
  });
}$LOGIC$,
  'testing', 'private', 'brain'
)
ON CONFLICT (id) DO UPDATE SET logic = EXCLUDED.logic, description = EXCLUDED.description;

-- ============================================================
-- 4. CONTEXT RELEVANCE SCORER
-- Scores how relevant working context is to current task
-- ============================================================
INSERT INTO procedural_shards (id, name, description, logic, lifecycle, visibility, category)
VALUES (
  'shd_context_scorer_001',
  'context-relevance-scorer',
  'Scores working memory contexts by relevance to the current task',
  $LOGIC$function execute(input) {
  const data = typeof input === "string" ? JSON.parse(input) : input;

  const currentTask = data.task || data.query || "";
  const contexts = data.contexts || (data.memory && data.memory.workingContext) || [];

  if (!currentTask || contexts.length === 0) {
    return JSON.stringify({
      scored: false,
      reason: !currentTask ? "No task provided" : "No contexts to score",
      rankedContexts: []
    });
  }

  const taskWords = new Set(currentTask.toLowerCase().split(/\W+/).filter(w => w.length > 3));

  const scoredContexts = contexts.map(ctx => {
    const summary = ctx.summary || "";
    const summaryWords = new Set(summary.toLowerCase().split(/\W+/).filter(w => w.length > 3));

    // Calculate relevance via word overlap
    let overlap = 0;
    for (const word of taskWords) {
      if (summaryWords.has(word)) overlap++;
    }

    const overlapScore = taskWords.size > 0 ? overlap / taskWords.size : 0;

    // Factor in importance
    const importance = ctx.importance || 0.5;

    // Combined relevance score
    const relevance = (overlapScore * 0.6) + (importance * 0.4);

    return {
      id: ctx.id,
      contentType: ctx.contentType,
      relevance: Math.round(relevance * 100) / 100,
      overlapScore: Math.round(overlapScore * 100) / 100,
      importance: importance,
      summaryPreview: summary.substring(0, 100)
    };
  });

  // Sort by relevance
  scoredContexts.sort((a, b) => b.relevance - a.relevance);

  return JSON.stringify({
    scored: true,
    totalContexts: contexts.length,
    highlyRelevant: scoredContexts.filter(c => c.relevance >= 0.6).length,
    rankedContexts: scoredContexts,
    recommendation: scoredContexts.length > 0 && scoredContexts[0].relevance >= 0.5
      ? `Focus on context: ${scoredContexts[0].summaryPreview}...`
      : "No highly relevant context found - may need additional information"
  });
}$LOGIC$,
  'testing', 'private', 'brain'
)
ON CONFLICT (id) DO UPDATE SET logic = EXCLUDED.logic, description = EXCLUDED.description;

-- ============================================================
-- 5. MEMORY SYNTHESIS DIRECTOR
-- Orchestrates which memory systems to query for a given task
-- ============================================================
INSERT INTO procedural_shards (id, name, description, logic, lifecycle, visibility, category)
VALUES (
  'shd_memory_director_001',
  'memory-synthesis-director',
  'Decides which memory systems are most relevant for a given task',
  $LOGIC$function execute(input) {
  const data = typeof input === "string" ? JSON.parse(input) : input;

  const taskType = data.taskType || data.type || "general";
  const query = data.query || "";

  // Analyze task to determine memory needs
  const queryLower = query.toLowerCase();

  const memoryNeeds = {
    episodic: 0.5,  // Base relevance
    semantic: 0.5,
    working: 0.5
  };

  // Keywords that suggest episodic memory (past experiences)
  if (/similar|before|last time|previously|experience|tried|worked|failed/.test(queryLower)) {
    memoryNeeds.episodic += 0.3;
  }

  // Keywords that suggest semantic memory (facts)
  if (/what is|define|fact|true|false|meaning|explain|how does/.test(queryLower)) {
    memoryNeeds.semantic += 0.3;
  }

  // Keywords that suggest working memory (current context)
  if (/current|now|this|today|session|conversation|we were|you said/.test(queryLower)) {
    memoryNeeds.working += 0.3;
  }

  // Task type adjustments
  switch (taskType) {
    case "decision":
      memoryNeeds.episodic += 0.2;  // Decisions benefit from past experience
      break;
    case "verification":
      memoryNeeds.semantic += 0.2;  // Verification needs facts
      break;
    case "continuation":
      memoryNeeds.working += 0.3;  // Continuation needs recent context
      break;
    case "learning":
      memoryNeeds.episodic += 0.2;
      memoryNeeds.semantic += 0.1;
      break;
  }

  // Normalize scores
  const max = Math.max(memoryNeeds.episodic, memoryNeeds.semantic, memoryNeeds.working);
  Object.keys(memoryNeeds).forEach(k => {
    memoryNeeds[k] = Math.round((memoryNeeds[k] / max) * 100) / 100;
  });

  // Determine priority order
  const priority = Object.entries(memoryNeeds)
    .sort((a, b) => b[1] - a[1])
    .map(([system, score]) => ({ system, relevance: score }));

  return JSON.stringify({
    taskType,
    memoryRelevance: memoryNeeds,
    priorityOrder: priority,
    recommendation: `Primary: ${priority[0].system}, Secondary: ${priority[1].system}`,
    queryEpisodic: memoryNeeds.episodic >= 0.6,
    querySemantic: memoryNeeds.semantic >= 0.6,
    queryWorking: memoryNeeds.working >= 0.6
  });
}$LOGIC$,
  'testing', 'private', 'brain'
)
ON CONFLICT (id) DO UPDATE SET logic = EXCLUDED.logic, description = EXCLUDED.description;

-- ============================================================
-- 6. LEARNING OPPORTUNITY DETECTOR
-- Identifies when current execution provides valuable learning
-- ============================================================
INSERT INTO procedural_shards (id, name, description, logic, lifecycle, visibility, category)
VALUES (
  'shd_learning_detector_001',
  'learning-opportunity-detector',
  'Detects when an execution outcome provides valuable learning for future decisions',
  $LOGIC$function execute(input) {
  const data = typeof input === "string" ? JSON.parse(input) : input;

  const outcome = data.outcome || {};
  const memory = data.memory || {};
  const episodes = memory.episodes || [];

  const wasSuccessful = outcome.success === true;
  const hadMemoryContext = episodes.length > 0;

  // Calculate learning value
  let learningValue = 0.5;  // Base value
  const learningOpportunities = [];

  // Novel situation (no similar experiences)
  if (episodes.length === 0) {
    learningValue += 0.2;
    learningOpportunities.push({
      type: "novel_situation",
      value: 0.2,
      description: "First encounter with this type of situation"
    });
  }

  // Contradicts past experience
  const pastSuccessRate = episodes.length > 0
    ? episodes.filter(e => e.success === true).length / episodes.length
    : 0.5;

  if (wasSuccessful && pastSuccessRate < 0.3) {
    learningValue += 0.3;
    learningOpportunities.push({
      type: "success_against_odds",
      value: 0.3,
      description: "Succeeded where past attempts mostly failed - valuable new approach"
    });
  }

  if (!wasSuccessful && pastSuccessRate > 0.7) {
    learningValue += 0.25;
    learningOpportunities.push({
      type: "unexpected_failure",
      value: 0.25,
      description: "Failed where past attempts usually succeeded - edge case discovered"
    });
  }

  // Failure with memory context is very informative
  if (!wasSuccessful && hadMemoryContext) {
    learningValue += 0.15;
    learningOpportunities.push({
      type: "informed_failure",
      value: 0.15,
      description: "Failed despite having relevant context - patterns may need updating"
    });
  }

  // Cap learning value
  learningValue = Math.min(1.0, learningValue);

  return JSON.stringify({
    learningValue: Math.round(learningValue * 100) / 100,
    shouldRecord: learningValue >= 0.6,
    shouldTriggerReview: learningValue >= 0.8,
    opportunities: learningOpportunities,
    wasSuccessful,
    hadMemoryContext,
    pastSuccessRate: Math.round(pastSuccessRate * 100) / 100,
    recommendation: learningValue >= 0.8
      ? "HIGH VALUE: Record this outcome and consider shard review"
      : learningValue >= 0.6
        ? "MODERATE VALUE: Record for future reference"
        : "LOW VALUE: Standard execution, minimal learning"
  });
}$LOGIC$,
  'testing', 'private', 'brain'
)
ON CONFLICT (id) DO UPDATE SET logic = EXCLUDED.logic, description = EXCLUDED.description;

-- ============================================================
-- VERIFY NEW SHARDS
-- ============================================================
SELECT name, category, lifecycle FROM procedural_shards WHERE category = 'brain' ORDER BY name;
