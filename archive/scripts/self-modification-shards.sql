-- SELF-MODIFICATION SHARDS
-- Priority 3: Shards that can propose improvements and create new shards
-- This enables the system to evolve and improve itself based on learning

-- ============================================================
-- 1. SHARD IMPROVEMENT PROPOSER
-- Analyzes underperforming shards and proposes logic improvements
-- ============================================================
INSERT INTO procedural_shards (id, name, description, logic, lifecycle, visibility, category)
VALUES (
  'shd_improvement_proposer_001',
  'shard-improvement-proposer',
  'Analyzes shard performance and proposes specific logic improvements',
  $LOGIC$function execute(input) {
  const data = typeof input === "string" ? JSON.parse(input) : input;

  const shardName = data.shard_name || "";
  const currentLogic = data.current_logic || "";
  const executionCount = data.execution_count || 0;
  const successRate = data.success_rate || 0;
  const outcomeScore = data.outcome_score || 0.5;
  const failurePatterns = data.failure_patterns || [];
  const recentErrors = data.recent_errors || [];

  // Analyze performance
  const issues = [];
  const proposals = [];

  // Low success rate
  if (successRate < 0.7 && executionCount > 10) {
    issues.push({
      type: "low_success_rate",
      severity: successRate < 0.5 ? "high" : "medium",
      detail: "Success rate " + (successRate * 100).toFixed(1) + "% is below threshold"
    });

    proposals.push({
      type: "add_error_handling",
      description: "Add try-catch blocks and input validation",
      priority: 1
    });
  }

  // Low outcome score (users not satisfied)
  if (outcomeScore < 0.4 && executionCount > 10) {
    issues.push({
      type: "low_outcome_score",
      severity: "high",
      detail: "Outcome score " + outcomeScore.toFixed(3) + " indicates user dissatisfaction"
    });

    proposals.push({
      type: "revise_output_format",
      description: "Output may not match user expectations - review output structure",
      priority: 1
    });
  }

  // Analyze failure patterns
  if (failurePatterns.length > 0) {
    const patternCounts = {};
    for (const pattern of failurePatterns) {
      patternCounts[pattern] = (patternCounts[pattern] || 0) + 1;
    }

    const sorted = Object.entries(patternCounts).sort((a, b) => b[1] - a[1]);
    if (sorted.length > 0) {
      issues.push({
        type: "recurring_failure",
        severity: "high",
        detail: "Most common failure: " + sorted[0][0] + " (" + sorted[0][1] + " occurrences)"
      });

      proposals.push({
        type: "address_specific_failure",
        description: "Add handling for: " + sorted[0][0],
        priority: 1
      });
    }
  }

  // Check for common code issues (simple static analysis)
  if (currentLogic) {
    // No input validation
    if (!currentLogic.includes("typeof input") && !currentLogic.includes("JSON.parse")) {
      proposals.push({
        type: "add_input_parsing",
        description: "Add robust input parsing with type checking",
        priority: 2
      });
    }

    // No error handling
    if (!currentLogic.includes("try") && !currentLogic.includes("catch")) {
      proposals.push({
        type: "add_try_catch",
        description: "Wrap logic in try-catch for graceful error handling",
        priority: 2
      });
    }

    // No default values
    if (!currentLogic.includes("|| ") && !currentLogic.includes("?? ")) {
      proposals.push({
        type: "add_defaults",
        description: "Add default values for optional parameters",
        priority: 3
      });
    }
  }

  // Determine overall recommendation
  let recommendation = "maintain";
  let urgency = "low";

  if (issues.filter(i => i.severity === "high").length >= 2) {
    recommendation = "major_revision";
    urgency = "high";
  } else if (issues.filter(i => i.severity === "high").length === 1) {
    recommendation = "minor_revision";
    urgency = "medium";
  } else if (proposals.length > 0) {
    recommendation = "optimization";
    urgency = "low";
  }

  return JSON.stringify({
    shardName,
    recommendation,
    urgency,
    issuesFound: issues.length,
    issues,
    proposalsCount: proposals.length,
    proposals: proposals.sort((a, b) => a.priority - b.priority),
    metrics: {
      executionCount,
      successRate: Math.round(successRate * 100) / 100,
      outcomeScore: Math.round(outcomeScore * 1000) / 1000
    },
    shouldAutoFix: recommendation === "optimization" && urgency === "low"
  });
}$LOGIC$,
  'testing', 'private', 'brain'
)
ON CONFLICT (id) DO UPDATE SET logic = EXCLUDED.logic, description = EXCLUDED.description;

-- ============================================================
-- 2. SHARD GENERATOR
-- Creates new shard logic based on patterns and requirements
-- ============================================================
INSERT INTO procedural_shards (id, name, description, logic, lifecycle, visibility, category)
VALUES (
  'shd_generator_001',
  'shard-generator',
  'Generates new shard logic templates based on requirements and patterns',
  $LOGIC$function execute(input) {
  const data = typeof input === "string" ? JSON.parse(input) : input;

  const shardType = data.shard_type || "transformer";
  const inputDescription = data.input_description || "generic input";
  const outputDescription = data.output_description || "processed output";
  const requirements = data.requirements || [];
  const exampleInputs = data.example_inputs || [];
  const exampleOutputs = data.example_outputs || [];

  // Template based on shard type
  let template = "";
  let confidence = 0.5;

  switch (shardType) {
    case "transformer":
      template = generateTransformerTemplate(inputDescription, outputDescription);
      confidence = 0.7;
      break;
    case "validator":
      template = generateValidatorTemplate(inputDescription, requirements);
      confidence = 0.75;
      break;
    case "analyzer":
      template = generateAnalyzerTemplate(inputDescription, requirements);
      confidence = 0.65;
      break;
    case "calculator":
      template = generateCalculatorTemplate(inputDescription, outputDescription);
      confidence = 0.8;
      break;
    default:
      template = generateGenericTemplate(inputDescription, outputDescription);
      confidence = 0.5;
  }

  // Add examples as test cases in comments
  let testCases = "";
  if (exampleInputs.length > 0 && exampleOutputs.length > 0) {
    testCases = "// Test cases:\\n";
    for (let i = 0; i < Math.min(exampleInputs.length, exampleOutputs.length, 3); i++) {
      testCases += "// Input: " + JSON.stringify(exampleInputs[i]) + "\\n";
      testCases += "// Expected: " + JSON.stringify(exampleOutputs[i]) + "\\n";
    }
    confidence += 0.1;
  }

  return JSON.stringify({
    generated: true,
    shardType,
    template: testCases + template,
    confidence: Math.min(0.9, confidence),
    requirements: requirements,
    needsReview: true,
    suggestedName: generateShardName(shardType, inputDescription),
    suggestedPatterns: generatePatterns(inputDescription, requirements)
  });

  function generateTransformerTemplate(input, output) {
    return "function execute(input) {\\n" +
      "  const data = typeof input === \\"string\\" ? JSON.parse(input) : input;\\n" +
      "  // Transform: " + input + " -> " + output + "\\n" +
      "  const result = {};\\n" +
      "  // TODO: Add transformation logic\\n" +
      "  return JSON.stringify(result);\\n" +
      "}";
  }

  function generateValidatorTemplate(input, reqs) {
    return "function execute(input) {\\n" +
      "  const data = typeof input === \\"string\\" ? JSON.parse(input) : input;\\n" +
      "  const errors = [];\\n" +
      "  // Validate: " + input + "\\n" +
      (reqs.map(r => "  // Check: " + r + "\\n").join("")) +
      "  return JSON.stringify({ valid: errors.length === 0, errors });\\n" +
      "}";
  }

  function generateAnalyzerTemplate(input, reqs) {
    return "function execute(input) {\\n" +
      "  const data = typeof input === \\"string\\" ? JSON.parse(input) : input;\\n" +
      "  const analysis = { metrics: {}, insights: [] };\\n" +
      "  // Analyze: " + input + "\\n" +
      (reqs.map(r => "  // Analyze: " + r + "\\n").join("")) +
      "  return JSON.stringify(analysis);\\n" +
      "}";
  }

  function generateCalculatorTemplate(input, output) {
    return "function execute(input) {\\n" +
      "  const data = typeof input === \\"string\\" ? JSON.parse(input) : input;\\n" +
      "  // Calculate: " + input + " -> " + output + "\\n" +
      "  let result = 0;\\n" +
      "  // TODO: Add calculation logic\\n" +
      "  return JSON.stringify({ result, unit: null });\\n" +
      "}";
  }

  function generateGenericTemplate(input, output) {
    return "function execute(input) {\\n" +
      "  const data = typeof input === \\"string\\" ? JSON.parse(input) : input;\\n" +
      "  // Process: " + input + "\\n" +
      "  // Output: " + output + "\\n" +
      "  return JSON.stringify({ processed: true });\\n" +
      "}";
  }

  function generateShardName(type, input) {
    const words = input.toLowerCase().replace(/[^a-z0-9\\s]/g, "").split(/\\s+/).slice(0, 3);
    return words.join("-") + "-" + type;
  }

  function generatePatterns(input, reqs) {
    const patterns = [];
    const words = input.toLowerCase().split(/\\s+/);
    if (words.length > 0) {
      patterns.push(words.join(".*"));
    }
    for (const req of reqs.slice(0, 2)) {
      const reqWords = req.toLowerCase().split(/\\s+/).slice(0, 3);
      if (reqWords.length > 0) {
        patterns.push(reqWords.join(".*"));
      }
    }
    return patterns;
  }
}$LOGIC$,
  'testing', 'private', 'brain'
)
ON CONFLICT (id) DO UPDATE SET logic = EXCLUDED.logic, description = EXCLUDED.description;

-- ============================================================
-- 3. SHARD MUTATION ENGINE
-- Creates variations of existing shards for A/B testing
-- ============================================================
INSERT INTO procedural_shards (id, name, description, logic, lifecycle, visibility, category)
VALUES (
  'shd_mutation_engine_001',
  'shard-mutation-engine',
  'Creates mutated variations of shards for evolutionary improvement',
  $LOGIC$function execute(input) {
  const data = typeof input === "string" ? JSON.parse(input) : input;

  const originalLogic = data.logic || "";
  const mutationType = data.mutation_type || "parameter";
  const targetArea = data.target_area || "threshold";

  if (!originalLogic) {
    return JSON.stringify({ mutated: false, error: "No logic provided" });
  }

  const mutations = [];

  // Parameter mutations - adjust thresholds and constants
  if (mutationType === "parameter" || mutationType === "all") {
    // Find numeric constants
    const numbers = originalLogic.match(/(?<![a-zA-Z_])(\d+\.?\d*)/g) || [];
    for (const num of numbers.slice(0, 5)) {
      const original = parseFloat(num);
      if (original > 0 && original < 1000) {
        mutations.push({
          type: "parameter_increase",
          original: num,
          mutated: (original * 1.2).toFixed(original % 1 === 0 ? 0 : 2),
          description: "Increase " + num + " by 20%"
        });
        mutations.push({
          type: "parameter_decrease",
          original: num,
          mutated: (original * 0.8).toFixed(original % 1 === 0 ? 0 : 2),
          description: "Decrease " + num + " by 20%"
        });
      }
    }
  }

  // Logic mutations - add conditions
  if (mutationType === "logic" || mutationType === "all") {
    // Add null checks
    if (!originalLogic.includes("=== null") && !originalLogic.includes("!= null")) {
      mutations.push({
        type: "add_null_check",
        description: "Add null/undefined checks for safety",
        suggestedChange: "Add: if (value === null || value === undefined) return default;"
      });
    }

    // Add bounds checking
    if (originalLogic.includes("[") && !originalLogic.includes(".length")) {
      mutations.push({
        type: "add_bounds_check",
        description: "Add array bounds checking",
        suggestedChange: "Add: if (index >= 0 && index < array.length)"
      });
    }
  }

  // Structure mutations - reorganize code
  if (mutationType === "structure" || mutationType === "all") {
    // Extract repeated patterns
    const lines = originalLogic.split("\\n");
    const lineOccurrences = {};
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length > 20) {
        lineOccurrences[trimmed] = (lineOccurrences[trimmed] || 0) + 1;
      }
    }

    for (const [line, count] of Object.entries(lineOccurrences)) {
      if (count >= 2) {
        mutations.push({
          type: "extract_function",
          description: "Extract repeated code into function",
          repeatedCode: line.substring(0, 50) + "...",
          occurrences: count
        });
      }
    }
  }

  // Select best mutations
  const selectedMutations = mutations.slice(0, 5);

  return JSON.stringify({
    mutated: selectedMutations.length > 0,
    mutationType,
    originalLength: originalLogic.length,
    mutationsGenerated: mutations.length,
    selectedMutations,
    recommendation: selectedMutations.length > 0
      ? "Create variant shards with these mutations for A/B testing"
      : "No suitable mutations found - logic appears optimal",
    readyForTesting: selectedMutations.filter(m => m.type.startsWith("parameter")).length > 0
  });
}$LOGIC$,
  'testing', 'private', 'brain'
)
ON CONFLICT (id) DO UPDATE SET logic = EXCLUDED.logic, description = EXCLUDED.description;

-- ============================================================
-- 4. SHARD CONSOLIDATOR
-- Merges similar shards into optimized versions
-- ============================================================
INSERT INTO procedural_shards (id, name, description, logic, lifecycle, visibility, category)
VALUES (
  'shd_consolidator_001',
  'shard-consolidator',
  'Identifies and merges similar shards to reduce redundancy',
  $LOGIC$function execute(input) {
  const data = typeof input === "string" ? JSON.parse(input) : input;

  const shards = data.shards || [];
  if (shards.length < 2) {
    return JSON.stringify({
      consolidated: false,
      reason: "Need at least 2 shards to consolidate"
    });
  }

  // Analyze similarity between shards
  const similarities = [];

  for (let i = 0; i < shards.length; i++) {
    for (let j = i + 1; j < shards.length; j++) {
      const s1 = shards[i];
      const s2 = shards[j];

      // Calculate pattern overlap
      const p1 = new Set(s1.patterns || []);
      const p2 = new Set(s2.patterns || []);
      const patternOverlap = [...p1].filter(p => p2.has(p)).length;
      const patternSimilarity = patternOverlap / Math.max(p1.size, p2.size, 1);

      // Calculate name similarity (simple word overlap)
      const n1 = new Set(s1.name.split(/[-_]/));
      const n2 = new Set(s2.name.split(/[-_]/));
      const nameOverlap = [...n1].filter(n => n2.has(n)).length;
      const nameSimilarity = nameOverlap / Math.max(n1.size, n2.size, 1);

      // Calculate logic similarity (simple character comparison)
      const l1 = (s1.logic || "").replace(/\\s/g, "");
      const l2 = (s2.logic || "").replace(/\\s/g, "");
      const minLen = Math.min(l1.length, l2.length);
      const maxLen = Math.max(l1.length, l2.length);
      let logicMatch = 0;
      for (let k = 0; k < minLen; k++) {
        if (l1[k] === l2[k]) logicMatch++;
      }
      const logicSimilarity = maxLen > 0 ? logicMatch / maxLen : 0;

      // Combined similarity score
      const overallSimilarity = (patternSimilarity * 0.3) + (nameSimilarity * 0.2) + (logicSimilarity * 0.5);

      if (overallSimilarity > 0.3) {
        similarities.push({
          shard1: s1.name,
          shard2: s2.name,
          patternSimilarity: Math.round(patternSimilarity * 100) / 100,
          nameSimilarity: Math.round(nameSimilarity * 100) / 100,
          logicSimilarity: Math.round(logicSimilarity * 100) / 100,
          overallSimilarity: Math.round(overallSimilarity * 100) / 100
        });
      }
    }
  }

  // Sort by similarity
  similarities.sort((a, b) => b.overallSimilarity - a.overallSimilarity);

  // Identify consolidation candidates
  const candidates = similarities.filter(s => s.overallSimilarity > 0.6);

  return JSON.stringify({
    consolidated: false,
    analyzed: shards.length,
    pairsCompared: (shards.length * (shards.length - 1)) / 2,
    similarPairsFound: similarities.length,
    consolidationCandidates: candidates.length,
    candidates: candidates.slice(0, 5),
    recommendation: candidates.length > 0
      ? "Consider merging " + candidates.length + " highly similar shard pairs"
      : "No significant redundancy found",
    potentialReduction: candidates.length > 0
      ? Math.round((candidates.length / shards.length) * 100) + "% potential shard reduction"
      : "0%"
  });
}$LOGIC$,
  'testing', 'private', 'brain'
)
ON CONFLICT (id) DO UPDATE SET logic = EXCLUDED.logic, description = EXCLUDED.description;

-- ============================================================
-- 5. SHARD DEPRECATION MANAGER
-- Manages the lifecycle of underperforming shards
-- ============================================================
INSERT INTO procedural_shards (id, name, description, logic, lifecycle, visibility, category)
VALUES (
  'shd_deprecation_manager_001',
  'shard-deprecation-manager',
  'Identifies shards that should be deprecated and manages transitions',
  $LOGIC$function execute(input) {
  const data = typeof input === "string" ? JSON.parse(input) : input;

  const shardName = data.shard_name || "";
  const executionCount = data.execution_count || 0;
  const successRate = data.success_rate || 1;
  const outcomeScore = data.outcome_score || 0.5;
  const daysSinceLastUse = data.days_since_last_use || 0;
  const hasReplacement = data.has_replacement || false;
  const dependentShards = data.dependent_shards || [];

  // Deprecation criteria scoring
  let deprecationScore = 0;
  const reasons = [];

  // Unused for too long
  if (daysSinceLastUse > 30) {
    deprecationScore += 0.3;
    reasons.push("Unused for " + daysSinceLastUse + " days");
  } else if (daysSinceLastUse > 14) {
    deprecationScore += 0.15;
    reasons.push("Low recent usage (" + daysSinceLastUse + " days)");
  }

  // Poor performance
  if (successRate < 0.5 && executionCount > 20) {
    deprecationScore += 0.35;
    reasons.push("Low success rate: " + (successRate * 100).toFixed(1) + "%");
  } else if (successRate < 0.7 && executionCount > 50) {
    deprecationScore += 0.2;
    reasons.push("Below-average success rate");
  }

  // Poor outcomes
  if (outcomeScore < 0.3 && executionCount > 10) {
    deprecationScore += 0.25;
    reasons.push("Low outcome score: " + outcomeScore.toFixed(3));
  }

  // Has better replacement
  if (hasReplacement) {
    deprecationScore += 0.2;
    reasons.push("Better replacement available");
  }

  // Determine action
  let action = "maintain";
  let urgency = "none";
  const blockers = [];

  if (deprecationScore >= 0.7) {
    action = "deprecate";
    urgency = "high";
  } else if (deprecationScore >= 0.5) {
    action = "review_for_deprecation";
    urgency = "medium";
  } else if (deprecationScore >= 0.3) {
    action = "monitor";
    urgency = "low";
  }

  // Check blockers
  if (dependentShards.length > 0) {
    blockers.push("Has " + dependentShards.length + " dependent shards: " + dependentShards.join(", "));
    if (action === "deprecate") {
      action = "deprecate_after_migration";
    }
  }

  if (executionCount < 10) {
    blockers.push("Insufficient execution data for confident decision");
    if (action === "deprecate") {
      action = "monitor";
    }
  }

  return JSON.stringify({
    shardName,
    deprecationScore: Math.round(deprecationScore * 100) / 100,
    action,
    urgency,
    reasons,
    blockers,
    metrics: {
      executionCount,
      successRate: Math.round(successRate * 100) / 100,
      outcomeScore: Math.round(outcomeScore * 1000) / 1000,
      daysSinceLastUse
    },
    migrationRequired: dependentShards.length > 0,
    dependentShards,
    recommendation: action === "deprecate"
      ? "Archive this shard and redirect to replacement"
      : action === "deprecate_after_migration"
        ? "Migrate dependents before deprecating"
        : action === "review_for_deprecation"
          ? "Manual review recommended"
          : "Continue monitoring"
  });
}$LOGIC$,
  'testing', 'private', 'brain'
)
ON CONFLICT (id) DO UPDATE SET logic = EXCLUDED.logic, description = EXCLUDED.description;

-- ============================================================
-- VERIFY SELF-MODIFICATION SHARDS
-- ============================================================
SELECT name, category, lifecycle FROM procedural_shards
WHERE name IN ('shard-improvement-proposer', 'shard-generator', 'shard-mutation-engine', 'shard-consolidator', 'shard-deprecation-manager')
ORDER BY name;
