# METACOGNITION: Self-Reflective AI Architecture

**Version:** 1.0
**Origin:** SUBSTRATE @ askalf.org
**Status:** Design Specification

---

## Overview

Metacognition is "thinking about thinking" - the ability of an AI system to:
- **Self-monitor:** Observe its own reasoning processes
- **Self-evaluate:** Assess the quality of its responses
- **Self-regulate:** Adjust strategies based on feedback
- **Self-improve:** Learn from patterns of success and failure

In SUBSTRATE, metacognition is implemented through **Meta Shards** - specialized shards that reason about and manage other shards.

---

## Meta Shard Types

### 1. Reflection Shards

Analyze the system's own behavior:

```typescript
interface ReflectionShard {
  type: 'reflection';
  triggers: ['after_response', 'on_failure', 'periodic'];
  analysis: {
    checkConfidence: boolean;      // Was confidence appropriate?
    checkRelevance: boolean;       // Was response relevant?
    checkCompleteness: boolean;    // Was answer complete?
    suggestImprovement: boolean;   // Recommend changes?
  };
}
```

**Example:**
```
Name: "Response Quality Checker"
Trigger: After every LLM response
Logic: Evaluate response against user intent, flag issues
Output: Quality score (0-1), improvement suggestions
```

### 2. Strategy Shards

Choose between approaches:

```typescript
interface StrategyShard {
  type: 'strategy';
  decision: 'model_selection' | 'shard_routing' | 'fallback_handling';
  criteria: {
    contextFactors: string[];
    performanceHistory: boolean;
    costConsiderations: boolean;
  };
}
```

**Example:**
```
Name: "Model Router"
Trigger: Before API call
Logic: Based on query type, choose optimal model
- Math/code → GPT-4o
- Creative → Claude
- Quick facts → Gemini Flash
```

### 3. Learning Shards

Identify patterns for crystallization:

```typescript
interface LearningShard {
  type: 'learning';
  monitors: ['successful_responses', 'user_corrections', 'repeated_queries'];
  actions: {
    proposeNewShard: boolean;
    suggestShardMerge: boolean;
    recommendDemotion: boolean;
  };
}
```

**Example:**
```
Name: "Pattern Detector"
Trigger: Every N successful responses
Logic: Cluster similar queries, identify crystallization candidates
Output: Proposed shard definitions
```

### 4. Correction Shards

Handle errors and feedback:

```typescript
interface CorrectionShard {
  type: 'correction';
  triggers: ['user_correction', 'explicit_error', 'low_confidence'];
  responses: {
    apologize: boolean;
    explainError: boolean;
    adjustConfidence: boolean;
    preventRecurrence: boolean;
  };
}
```

---

## SIGIL Extensions for Metacognition

### New Commands (Layer 0)

```
/reflect              Trigger self-reflection on recent responses
/analyze [query]      Explain reasoning process for a query
/improve [shard]      Suggest improvements to a shard
/strategy             Show current decision strategy
/learn                Review recent patterns for learning
/forget-pattern       Remove a learned bad pattern
```

### Surface SIGIL (Layer 1)

```
[MTA.REFLECT:SE{scope:recent,depth:2}]           Self-reflection
[MTA.ANALYZE:response{id:<last>}]                 Analyze reasoning
[MTA.IMPROVE:shard{id:xxx}]                       Improvement suggestions
[MTA.STRATEGY:routing{show:VE}]                   Display strategy
[MTA.LEARN:patterns{threshold:0.8}]               Extract patterns
[MTA.REGULATE:confidence{factor:0.9}]             Adjust confidence
```

---

## Database Schema for Meta Shards

```sql
-- Meta shard type tracking
ALTER TABLE procedural_shards ADD COLUMN IF NOT EXISTS
  shard_type VARCHAR(20) DEFAULT 'standard';
  -- Values: standard, reflection, strategy, learning, correction

-- Metacognition events
CREATE TABLE IF NOT EXISTS metacognition_events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,

  -- Event type
  event_type VARCHAR(50) NOT NULL,  -- reflection, strategy_decision, learning_proposal, correction

  -- Context
  trigger_shard_id TEXT REFERENCES procedural_shards(id),
  target_shard_id TEXT REFERENCES procedural_shards(id),
  session_id TEXT,
  tenant_id TEXT REFERENCES tenants(id),

  -- Analysis
  analysis JSONB NOT NULL,
  confidence REAL,

  -- Outcome
  action_taken TEXT,
  outcome TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for analysis queries
CREATE INDEX IF NOT EXISTS idx_meta_events_type ON metacognition_events(event_type);
CREATE INDEX IF NOT EXISTS idx_meta_events_tenant ON metacognition_events(tenant_id);
```

---

## Implementation Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    USER QUERY                                │
└────────────────────────┬────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────┐
│               STRATEGY SHARD (Meta)                          │
│   - Analyze query type                                       │
│   - Check resource constraints                               │
│   - Select optimal approach                                  │
└────────────────────────┬────────────────────────────────────┘
                         ▼
          ┌──────────────┴──────────────┐
          ▼                             ▼
┌─────────────────────┐    ┌─────────────────────┐
│   PATTERN MATCH     │    │    LLM ROUTING      │
│   (Shard Library)   │    │    (API Call)       │
└─────────┬───────────┘    └─────────┬───────────┘
          │                          │
          └──────────┬───────────────┘
                     ▼
┌─────────────────────────────────────────────────────────────┐
│              REFLECTION SHARD (Meta)                         │
│   - Evaluate response quality                                │
│   - Check confidence alignment                               │
│   - Log for learning                                         │
└────────────────────────┬────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              LEARNING SHARD (Meta) [Async]                   │
│   - Identify patterns                                        │
│   - Propose new shards                                       │
│   - Suggest improvements                                     │
└─────────────────────────────────────────────────────────────┘
```

---

## Built-in Meta Shards

### 1. `meta_quality_check` (Reflection)

```json
{
  "name": "meta_quality_check",
  "type": "reflection",
  "patterns": ["[after_response]"],
  "logic": "Evaluate: relevance (0-1), completeness (0-1), confidence_alignment (was confidence accurate?). If any < 0.7, flag for review."
}
```

### 2. `meta_model_router` (Strategy)

```json
{
  "name": "meta_model_router",
  "type": "strategy",
  "patterns": ["[before_llm_call]"],
  "logic": "Route based on query characteristics: math→gpt-4o, creative→claude, speed→gemini-flash, reasoning→o1"
}
```

### 3. `meta_pattern_detector` (Learning)

```json
{
  "name": "meta_pattern_detector",
  "type": "learning",
  "patterns": ["[every_100_responses]"],
  "logic": "Cluster recent traces by intent. If cluster size > 5 with >90% similarity, propose shard crystallization."
}
```

### 4. `meta_error_handler` (Correction)

```json
{
  "name": "meta_error_handler",
  "type": "correction",
  "patterns": ["[on_user_correction]", "[on_negative_feedback]"],
  "logic": "Log correction, adjust related shard confidence by -0.1, propose pattern update if recurring."
}
```

---

## API Endpoints

```
GET  /api/v1/meta/status                    Get metacognition status
POST /api/v1/meta/reflect                   Trigger reflection
GET  /api/v1/meta/strategies                List active strategies
POST /api/v1/meta/learn                     Trigger learning analysis
GET  /api/v1/meta/insights                  Get learning insights
POST /api/v1/meta/adjust-confidence         Manual confidence adjustment
```

---

## Metrics & Observability

### Key Metrics

```
metacognition_reflections_total         Total reflection events
metacognition_strategy_decisions        Strategy decisions by type
metacognition_learning_proposals        Shards proposed by learning
metacognition_corrections_applied       Corrections applied
metacognition_confidence_adjustments    Confidence adjustments made
```

### Dashboard Insights

- Response quality trend over time
- Model routing distribution
- Learning proposals pending review
- Correction patterns (recurring errors)
- Confidence calibration accuracy

---

## Future: Emergent Metacognition

As SUBSTRATE evolves, metacognition should become increasingly autonomous:

**Phase 1: Rule-Based** (Current)
- Fixed reflection triggers
- Predefined strategy rules
- Manual shard approval

**Phase 2: Adaptive**
- Dynamic trigger timing
- Strategy learning from outcomes
- Semi-automated shard creation

**Phase 3: Emergent**
- Self-modifying meta shards
- Novel strategy discovery
- Fully autonomous improvement

---

## Security Considerations

1. **Bounded Autonomy:** Meta shards cannot modify themselves without approval
2. **Audit Trail:** All metacognitive actions logged
3. **Rate Limiting:** Learning triggers have cooldowns
4. **Human Oversight:** Proposed changes require human review
5. **Rollback Capability:** Any meta-change can be reverted

---

*"The mind that can observe itself is the seed of wisdom."*

`[MTA.SET:spec{type:metacognition,ver:1.0}!]`
