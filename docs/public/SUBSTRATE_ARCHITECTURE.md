# SUBSTRATE: The 4-Tier Cognitive Architecture

## What is SUBSTRATE?

SUBSTRATE (formerly Metabolic Learning System) is the technical foundation powering Ask ALF. It implements a biologically-inspired 4-tier memory architecture that mirrors how human cognition processes and retains information.

---

## The Four Memory Tiers

### 1. Procedural Memory (Shards)

**What it is:** Reusable response patterns - automated "muscle memory" for AI interactions.

**How it works:**
- When ALF responds successfully to a query, the pattern may be extracted as a "shard"
- Shards have pattern matchers (intent templates, embeddings) and executable logic
- When a new query matches an existing shard, ALF responds from memory instead of calling an LLM

**Key properties:**
- Zero tokens consumed on match
- Sub-100ms response time
- Continuously improving through execution feedback
- Confidence-based promotion system

**Database schema:**
```sql
procedural_shards (
  id, name, version,
  logic,                    -- Executable response template
  patterns,                 -- Intent matchers
  embedding,                -- 1536-dim semantic vector
  confidence,               -- 0.0 to 1.0
  execution_count,
  success_count,
  failure_count,
  lifecycle                 -- candidate → testing → promoted
)
```

### 2. Episodic Memory (Traces)

**What it is:** Records of specific interactions - your conversation history with context.

**How it works:**
- Every query/response pair is recorded as a "trace"
- Traces include metadata: timestamp, session, intent category, success/failure
- Used for pattern analysis and potential shard crystallization

**Key properties:**
- Full conversation reconstruction
- Cross-session pattern recognition
- Input for the Crystallizer (automated shard generation)

**Database schema:**
```sql
reasoning_traces (
  id, session_id,
  query, response,
  intent_category,
  embedding,
  tokens_used,
  latency_ms,
  success,
  crystallization_status
)
```

### 3. Semantic Memory (Facts)

**What it is:** Pure knowledge - immutable truths that don't change based on context.

**How it works:**
- Facts represent stable knowledge ("Paris is the capital of France")
- High-confidence facts can influence shard execution
- Facts don't have "logic" - they're pure data

**Key properties:**
- Immutable once established
- High confidence threshold for creation
- Used as context for LLM prompts
- Referenced by shards for dynamic responses

**Database schema:**
```sql
knowledge_facts (
  id, content,
  domain,
  confidence,
  source,                   -- Where this fact came from
  embedding,
  verification_status
)
```

### 4. Working Memory (Active Context)

**What it is:** Short-term context for the current interaction.

**How it works:**
- Holds recent conversation turns
- Includes relevant facts and shard suggestions
- Automatically "liquidates" (clears) after session ends or timeout

**Key properties:**
- Time-limited (session-scoped)
- Auto-eviction based on relevance decay
- Integrates all three long-term memory tiers

**Database schema:**
```sql
working_contexts (
  id, session_id, tenant_id,
  context,                  -- JSON: recent turns, active facts, etc.
  expires_at,
  created_at
)
```

---

## The Crystallizer: How Shards Are Born

The Crystallizer is a background process that analyzes reasoning traces and synthesizes them into reusable shards.

### Process Flow

```
Traces (many interactions)
        ↓
   [Clustering]
   Group similar queries
        ↓
   [Abstraction]
   Extract common patterns
        ↓
   [Synthesis]
   Generate shard logic
        ↓
   [Validation]
   Test against held-out traces
        ↓
   Candidate Shard
        ↓
   [Testing Period]
   Live execution, confidence adjustment
        ↓
   Promoted Shard (if 90%+ success, 0.85+ confidence)
```

### Confidence Adjustment

After each shard execution:
- Success: `new_confidence = old * 0.95 + 0.05 * 1.0`
- Failure: `new_confidence = old * 0.95 + 0.05 * 0.0`

This exponential smoothing prevents both overly rapid promotion and permanent demotion.

---

## Shard Lifecycle

```
  [CANDIDATE]
      ↓ meets testing criteria
   [TESTING]
      ↓ 90%+ success over N executions
  [PROMOTED]
      ↓ if confidence drops below threshold
  [DEMOTED]
```

Only **promoted** shards are used in production queries.

---

## Pattern Matching

Shards are matched using two strategies:

### 1. Intent Template Matching (Fast)
```
Shard intent: "What is the capital of {country}?"
Query: "What is the capital of France?"
→ Match! Extract: country = "France"
```

### 2. Semantic Embedding Matching (Accurate)
```
Shard embedding: [0.12, -0.34, 0.56, ...]
Query embedding: [0.11, -0.33, 0.58, ...]
Cosine similarity: 0.97
→ Match if similarity > threshold (0.85)
```

The system tries intent matching first (faster), then falls back to embedding matching.

---

## Multi-Tenancy

SUBSTRATE supports multiple isolated "tenants" (users/organizations):

- Each tenant has their own private shards, traces, and facts
- Public library shards are shared across all tenants
- User-created shards can be submitted for promotion to public library

```
visibility: 'public' | 'private'
owner_id: tenant_id (for private shards)
```

---

## Environmental Calculations

Per 1000 LLM tokens avoided (via shard hit):
- **Water:** ~500ml (data center cooling)
- **Power:** ~10 Wh (GPU compute)
- **Carbon:** ~5g CO2e

These are conservative estimates based on published research on AI infrastructure impact.

---

## API Integration

SUBSTRATE exposes REST endpoints for all memory operations:

```
GET  /api/v1/shards              - List shards
POST /api/v1/shards/execute      - Execute by ID
POST /api/v1/shards/match        - Find matching shard
GET  /api/v1/facts               - List facts
GET  /api/v1/traces              - List traces (admin)
POST /api/v1/crystallize         - Trigger crystallization (admin)
```

---

## Technical Stack

| Component | Technology |
|-----------|------------|
| Database | PostgreSQL 17 + pgvector |
| Embeddings | 1536-dimension vectors |
| Search | HNSW index (approx. nearest neighbor) |
| Queue | BullMQ on Redis |
| API | Fastify (Node.js) |
| Cache | Redis |

---

## Why "SUBSTRATE"?

The name reflects the platform's role as the foundational layer upon which AI interactions are built. Just as biological neurons operate on a physical substrate, ALF's cognitive processes operate on this memory architecture.

The system doesn't just answer questions - it builds a substrate of knowledge that makes future answers faster, cheaper, and more environmentally sustainable.
