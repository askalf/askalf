-- Fix Pre-Action Checkpoint
UPDATE procedural_shards SET logic = $LOGIC$function execute(input) {
  const data = typeof input === "string" ? JSON.parse(input) : input;
  const text = (data.action || data.command || input).toString().toLowerCase();

  const expensiveOps = {
    "api call": { cost: "tokens", reversible: true, risk: 0.3 },
    "database": { cost: "latency", reversible: false, risk: 0.5 },
    "delete": { cost: "data_loss", reversible: false, risk: 0.9 },
    "drop": { cost: "data_loss", reversible: false, risk: 1.0 },
    "truncate": { cost: "data_loss", reversible: false, risk: 0.95 },
    "email": { cost: "reputation", reversible: false, risk: 0.7 },
    "deploy": { cost: "downtime", reversible: true, risk: 0.6 },
    "payment": { cost: "money", reversible: false, risk: 0.9 },
    "publish": { cost: "visibility", reversible: false, risk: 0.6 },
    "migrate": { cost: "schema", reversible: false, risk: 0.8 },
    "update": { cost: "data_change", reversible: false, risk: 0.4 },
    "insert": { cost: "data_add", reversible: true, risk: 0.2 }
  };

  const detectedOps = [];
  const questions = [];
  let maxRisk = 0;

  for (const [op, meta] of Object.entries(expensiveOps)) {
    if (text.includes(op)) {
      detectedOps.push({ operation: op, cost: meta.cost, reversible: meta.reversible, risk: meta.risk });
      maxRisk = Math.max(maxRisk, meta.risk);

      if (!meta.reversible) {
        questions.push("IRREVERSIBLE action - confirm you understand the impact");
        questions.push("Do you have a backup or rollback plan?");
      }
      if (meta.cost === "money") {
        questions.push("Have you verified the amount and recipient?");
      }
      if (meta.cost === "data_loss") {
        questions.push("Have you backed up data that will be lost?");
        questions.push("Is this the correct target?");
      }
    }
  }

  if (questions.length === 0) {
    questions.push("What specific change will this make?");
    questions.push("How will you verify it succeeded?");
  }

  const riskLevel = maxRisk >= 0.8 ? "critical" : maxRisk >= 0.5 ? "high" : maxRisk >= 0.3 ? "medium" : "low";
  const uniqueQuestions = [];
  for (var i = 0; i < questions.length; i++) {
    if (uniqueQuestions.indexOf(questions[i]) === -1) uniqueQuestions.push(questions[i]);
  }

  return JSON.stringify({
    checkpoint: "PRE-ACTION REVIEW",
    riskLevel: riskLevel,
    riskScore: Math.round(maxRisk * 100) / 100,
    detectedOperations: detectedOps,
    irreversibleOps: detectedOps.filter(function(o) { return !o.reversible; }).length,
    questions: uniqueQuestions,
    proceed: riskLevel === "critical" ? "REQUIRES EXPLICIT CONFIRMATION" : "After answering questions",
    requiresBackup: detectedOps.some(function(o) { return o.cost === "data_loss"; })
  });
}$LOGIC$
WHERE name = 'Pre-Action Checkpoint' AND lifecycle = 'promoted';

-- Fix string-reversal to handle non-JSON input
UPDATE procedural_shards SET logic = $LOGIC$function execute(input) {
  var text = String(input || "");

  // Try to parse as JSON first
  try {
    var parsed = JSON.parse(text);
    text = parsed.text || parsed.input || parsed.query || text;
  } catch (e) {
    // Not JSON, use as-is
  }

  // Try to find quoted string
  var quoteMatch = text.match(/["']([^"']+)["']/);
  if (quoteMatch && quoteMatch[1]) {
    return quoteMatch[1].split("").reverse().join("");
  }

  // Try "Reverse X" pattern
  var reverseMatch = text.match(/reverse\s+(.+)/i);
  if (reverseMatch && reverseMatch[1]) {
    var toReverse = reverseMatch[1].trim().replace(/["']/g, "");
    return toReverse.split("").reverse().join("");
  }

  // Fallback: reverse the entire input (cleaned)
  var cleaned = text.trim().replace(/["']/g, "");
  return cleaned.split("").reverse().join("");
}$LOGIC$
WHERE name = 'string-reversal' AND lifecycle = 'promoted';

-- Verify
SELECT name, lifecycle, 'FIXED' as status FROM procedural_shards
WHERE name IN ('Pre-Action Checkpoint', 'string-reversal') AND lifecycle = 'promoted';
