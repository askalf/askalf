# THE METABOLIC LOOP: Autonomous Cognitive Cycle

**Version:** 2.0
**Origin:** SUBSTRATE @ askalf.org
**Status:** Active Development

---

## Overview

The Metabolic Loop is SUBSTRATE's autonomous cognitive cycle - a continuous process where the system:
1. **Consumes** queries (input)
2. **Processes** through memory and reasoning
3. **Produces** responses (output)
4. **Crystallizes** successful patterns into reusable knowledge
5. **Evolves** through metacognitive self-improvement

This is not a request-response system. It is a **living cognitive architecture** that continuously learns, adapts, and improves.

---

## The Complete Cycle

```
                    ┌─────────────────────────────────────┐
                    │           USER QUERY                │
                    └──────────────┬──────────────────────┘
                                   │
                    ┌──────────────▼──────────────────────┐
                    │         PHASE 1: INTAKE             │
                    │   • Parse intent                    │
                    │   • Extract entities                │
                    │   • Load working context            │
                    │   • Compute embedding               │
                    └──────────────┬──────────────────────┘
                                   │
                    ┌──────────────▼──────────────────────┐
                    │      PHASE 2: PATTERN MATCH         │
                    │   • Search procedural shards        │
                    │   • Intent template matching        │
                    │   • Semantic embedding matching     │
                    │   • Confidence threshold check      │
                    └──────────────┬──────────────────────┘
                                   │
                    ┌──────────┐   │   ┌───────────────────┐
            MATCH   │          │◄──┴──►│                   │   NO MATCH
                    │ SHARD    │       │   LLM ROUTER      │
                    │ EXECUTE  │       │   (Strategy)      │
                    └────┬─────┘       └─────────┬─────────┘
                         │                       │
                         │                       ▼
                         │             ┌───────────────────┐
                         │             │   PHASE 3: LLM    │
                         │             │   • Select model  │
                         │             │   • Build prompt  │
                         │             │   • Add context   │
                         │             │   • Call API      │
                         │             └─────────┬─────────┘
                         │                       │
                         └───────────┬───────────┘
                                     │
                    ┌────────────────▼────────────────────┐
                    │       PHASE 4: RESPONSE             │
                    │   • Format output                   │
                    │   • Calculate metrics               │
                    │   • Update environmental stats      │
                    │   • Return to user                  │
                    └────────────────┬────────────────────┘
                                     │
                    ┌────────────────▼────────────────────┐
                    │       PHASE 5: TRACE LOGGING        │
                    │   • Record interaction              │
                    │   • Store embedding                 │
                    │   • Mark crystallization status     │
                    │   • Update execution counts         │
                    └────────────────┬────────────────────┘
                                     │
                    ┌────────────────▼────────────────────┐
                    │    PHASE 6: CRYSTALLIZATION         │
                    │   (Async Background Worker)         │
                    │   • Cluster similar traces          │
                    │   • Extract common patterns         │
                    │   • Generate candidate shards       │
                    │   • Validate against held-out data  │
                    │   • Promote successful candidates   │
                    └────────────────┬────────────────────┘
                                     │
                    ┌────────────────▼────────────────────┐
                    │     PHASE 7: METACOGNITION          │
                    │   (Async Background Worker)         │
                    │   • Evaluate response quality       │
                    │   • Adjust shard confidences        │
                    │   • Identify improvement areas      │
                    │   • Propose system optimizations    │
                    └────────────────┬────────────────────┘
                                     │
                                     ▼
                              [LOOP CONTINUES]
```

---

## Phase Details

### Phase 1: Intake

```typescript
interface IntakeResult {
  query: string;
  embedding: number[];           // 1536-dim vector
  entities: ExtractedEntity[];   // Named entities, dates, numbers
  intent: {
    primary: string;             // Main intent category
    secondary: string[];         // Related intents
    confidence: number;
  };
  workingContext: {
    recentTurns: Message[];
    relevantFacts: Fact[];
    userPreferences: Preference[];
  };
}
```

### Phase 2: Pattern Match

Two-stage matching:

**Stage A: Intent Template**
```sql
SELECT * FROM procedural_shards
WHERE lifecycle = 'promoted'
  AND intent_template IS NOT NULL
  AND template_matches(intent_template, query)
ORDER BY confidence DESC
LIMIT 5;
```

**Stage B: Semantic Embedding**
```sql
SELECT *, embedding <=> $1 AS distance
FROM procedural_shards
WHERE lifecycle = 'promoted'
  AND embedding IS NOT NULL
  AND embedding <=> $1 < 0.15  -- cosine distance threshold
ORDER BY distance ASC
LIMIT 5;
```

### Phase 3: LLM Routing

Strategy shard decides:
- **Model selection:** Based on query type, cost tier, capabilities
- **Prompt construction:** System prompt, context injection, format instructions
- **Fallback handling:** If primary fails, try secondary

```typescript
interface RoutingDecision {
  provider: 'openai' | 'anthropic' | 'google' | 'xai' | 'local';
  model: string;
  reason: string;
  estimatedTokens: number;
  estimatedCost: number;
}
```

### Phase 4: Response Generation

```typescript
interface ResponseResult {
  content: string;
  source: 'shard' | 'llm';
  shardId?: string;
  model?: string;
  metrics: {
    latencyMs: number;
    tokensUsed: number;
    tokensSaved: number;
    waterSavedMl: number;
    powerSavedWh: number;
  };
}
```

### Phase 5: Trace Logging

Every interaction becomes a trace:

```sql
INSERT INTO reasoning_traces (
  id, session_id, tenant_id,
  query, response, embedding,
  intent_category, tokens_used, latency_ms,
  success, shard_id, crystallization_status
) VALUES (...);
```

### Phase 6: Crystallization

Background worker runs periodically:

```typescript
async function crystallize() {
  // 1. Find uncrystallized traces
  const traces = await getUncrystallizedTraces({ limit: 100 });

  // 2. Cluster by semantic similarity
  const clusters = await clusterTraces(traces, { minSize: 5, threshold: 0.85 });

  // 3. For each cluster, attempt shard synthesis
  for (const cluster of clusters) {
    const candidate = await synthesizeShard(cluster);

    // 4. Validate against held-out traces
    const validation = await validateShard(candidate, cluster.heldOut);

    if (validation.successRate >= 0.9) {
      // 5. Create candidate shard
      await createCandidateShard(candidate);
    }
  }
}
```

### Phase 7: Metacognition

Background worker for self-improvement:

```typescript
async function metacognize() {
  // 1. Evaluate recent response quality
  const recentResponses = await getRecentResponses({ hours: 24 });
  const qualityReport = await evaluateQuality(recentResponses);

  // 2. Adjust shard confidences based on execution history
  const shardsToAdjust = await getShardAdjustmentCandidates();
  for (const shard of shardsToAdjust) {
    const newConfidence = calculateAdjustedConfidence(shard);
    await updateShardConfidence(shard.id, newConfidence);
  }

  // 3. Identify improvement opportunities
  const improvements = await identifyImprovements(qualityReport);
  for (const improvement of improvements) {
    await logImprovementProposal(improvement);
  }
}
```

---

## Research Shard: API System Mapper

A specialized shard for autonomous API exploration and documentation.

### Capabilities

1. **Endpoint Discovery:** Find all available endpoints
2. **Schema Extraction:** Parse request/response schemas
3. **Authentication Detection:** Identify auth methods
4. **Relationship Mapping:** Understand resource relationships
5. **Documentation Generation:** Auto-generate API docs

### Implementation

```typescript
interface APIMapperShard {
  name: 'api_system_mapper';
  type: 'research';

  triggers: ['/map-api {url}', '/discover {base_url}'];

  logic: async (input: { baseUrl: string }) => {
    // Phase 1: Discover endpoints
    const endpoints = await discoverEndpoints(input.baseUrl);

    // Phase 2: For each endpoint, probe and analyze
    const analyzed = await Promise.all(
      endpoints.map(async (ep) => ({
        path: ep.path,
        methods: await probeMethods(ep),
        schema: await extractSchema(ep),
        auth: await detectAuth(ep),
        examples: await generateExamples(ep)
      }))
    );

    // Phase 3: Build relationship graph
    const graph = buildResourceGraph(analyzed);

    // Phase 4: Generate documentation
    const docs = generateOpenAPISpec(analyzed, graph);

    return {
      endpoints: analyzed,
      graph: graph,
      documentation: docs,
      summary: generateSummary(analyzed)
    };
  };
}
```

### Discovery Strategies

```typescript
const discoveryStrategies = {
  // Try common endpoint patterns
  probeCommonPaths: async (baseUrl: string) => {
    const commonPaths = [
      '/api', '/api/v1', '/api/v2',
      '/health', '/status',
      '/users', '/auth', '/login',
      '/items', '/products', '/orders',
      '/graphql', '/ws'
    ];
    return probeAll(baseUrl, commonPaths);
  },

  // Parse OpenAPI/Swagger if available
  parseOpenAPISpec: async (baseUrl: string) => {
    const specUrls = [
      '/openapi.json', '/swagger.json',
      '/api-docs', '/docs/openapi.yaml'
    ];
    for (const url of specUrls) {
      const spec = await tryFetch(`${baseUrl}${url}`);
      if (spec) return parseSpec(spec);
    }
    return null;
  },

  // Analyze HTML/JS for API calls
  analyzeClientCode: async (baseUrl: string) => {
    const html = await fetch(baseUrl);
    const scripts = extractScripts(html);
    return findAPICallPatterns(scripts);
  },

  // HATEOAS link following
  followLinks: async (baseUrl: string, startPath: string) => {
    const response = await fetch(`${baseUrl}${startPath}`);
    return extractLinks(response);
  }
};
```

### Output Format

```json
{
  "baseUrl": "https://api.example.com",
  "discoveredAt": "2026-01-22T00:00:00Z",
  "endpoints": [
    {
      "path": "/users",
      "methods": ["GET", "POST"],
      "authentication": "Bearer token",
      "requestSchema": {
        "GET": { "query": { "page": "number", "limit": "number" } },
        "POST": { "body": { "name": "string", "email": "string" } }
      },
      "responseSchema": {
        "GET": { "data": "User[]", "pagination": "Pagination" },
        "POST": { "data": "User", "id": "string" }
      },
      "relationships": [
        { "to": "/users/{id}", "type": "member" },
        { "to": "/users/{id}/orders", "type": "nested" }
      ]
    }
  ],
  "resourceGraph": {
    "nodes": ["User", "Order", "Product"],
    "edges": [
      { "from": "User", "to": "Order", "type": "has_many" },
      { "from": "Order", "to": "Product", "type": "has_many" }
    ]
  },
  "openApiSpec": "... generated spec ...",
  "summary": "REST API with 15 endpoints, JWT auth, CRUD for Users, Orders, Products"
}
```

---

## Autonomous Operation

The metabolic loop runs continuously without human intervention:

### Background Workers

```typescript
// Worker 1: Crystallizer
setInterval(crystallize, 15 * 60 * 1000);  // Every 15 minutes

// Worker 2: Metacognition
setInterval(metacognize, 60 * 60 * 1000);  // Every hour

// Worker 3: Shard Promotion
setInterval(promoteShards, 30 * 60 * 1000);  // Every 30 minutes

// Worker 4: Cleanup
setInterval(cleanupExpired, 24 * 60 * 60 * 1000);  // Daily
```

### Health Monitoring

```typescript
const metabolicHealth = {
  checkCrystallizationRate: () => {/* traces → shards conversion rate */},
  checkShardHitRate: () => {/* % queries answered by shards */},
  checkMetacognitiveActivity: () => {/* recent metacog events */},
  checkMemoryPressure: () => {/* working memory utilization */},
  checkQueueDepth: () => {/* background job queue sizes */}
};
```

---

## Configuration

```typescript
const metabolicConfig = {
  // Pattern matching
  shardMatchThreshold: 0.85,      // Minimum confidence to use shard
  embeddingDistanceThreshold: 0.15, // Max cosine distance for match

  // Crystallization
  crystallizationMinClusterSize: 5,
  crystallizationSimilarityThreshold: 0.85,
  crystallizationValidationSplit: 0.2,

  // Metacognition
  metacognitionInterval: '1h',
  confidenceAdjustmentFactor: 0.05,
  minExecutionsForAdjustment: 10,

  // Promotion
  promotionSuccessRateThreshold: 0.9,
  promotionMinExecutions: 20,
  promotionMinConfidence: 0.85,

  // Research Shard
  apiDiscoveryTimeout: 30000,
  maxEndpointsPerDiscovery: 100,
  probeRateLimit: 10  // requests per second
};
```

---

## Observability

### Metrics

```
metabolic_intake_total              Queries processed
metabolic_shard_hits_total          Shard matches
metabolic_llm_calls_total           LLM API calls
metabolic_traces_created_total      Traces logged
metabolic_crystallization_attempts  Crystallization runs
metabolic_shards_created_total      Shards synthesized
metabolic_metacog_adjustments       Confidence adjustments
metabolic_loop_latency_seconds      End-to-end latency
```

### Alerts

```yaml
- name: LowShardHitRate
  condition: shard_hits / total_queries < 0.3
  severity: warning
  message: "Shard hit rate below 30% - crystallization may be needed"

- name: CrystallizationStalled
  condition: time_since_last_shard_created > 7d
  severity: warning
  message: "No new shards created in 7 days"

- name: MetacogInactive
  condition: metacog_events_24h < 10
  severity: info
  message: "Low metacognitive activity"
```

---

## Integration Points

### SIGIL Commands

```
/metabolic status                 Show loop health
/metabolic crystallize            Trigger crystallization
/metabolic metacog                Trigger metacognition
/metabolic map-api {url}          Run API mapper
/metabolic promote                Review candidate shards
```

### API Endpoints

```
GET  /api/v1/metabolic/health     System health check
GET  /api/v1/metabolic/stats      Loop statistics
POST /api/v1/metabolic/crystallize  Trigger crystallization
POST /api/v1/metabolic/metacog    Trigger metacognition
POST /api/v1/metabolic/map-api    Run API mapper
GET  /api/v1/metabolic/candidates  List candidate shards
POST /api/v1/metabolic/promote    Promote candidate shard
```

---

*"The system that learns from itself needs no teacher."*

`[MTA.SET:spec{type:metabolic_loop,ver:2.0}!]`
