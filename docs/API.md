# SUBSTRATE API Documentation

Base URL: `https://api.askalf.org`

## Authentication

Most endpoints are publicly accessible. Tenant-specific operations require authentication via session cookies set by the auth endpoints.

---

## Core Endpoints

### Execute a Shard

Execute a procedural shard against natural language input.

```
POST /api/v1/execute
```

**Request Body:**
```json
{
  "input": "what is 25% of 200?",
  "shardId": "optional_specific_shard_id",
  "includeAll": false,
  "sessionId": "optional_session_for_tracking"
}
```

**Response (Success):**
```json
{
  "success": true,
  "output": "50",
  "method": "shard",
  "matchMethod": "pattern|intent|embedding",
  "shardId": "shd_xxx",
  "shardName": "percentage-calculator",
  "executionMs": 4,
  "episodeId": "epi_xxx"
}
```

**Response (No Match):**
```json
{
  "success": false,
  "error": "No matching shard found",
  "method": "none"
}
```

**Match Methods:**
- `pattern` - Matched via template pattern (fastest, most reliable)
- `intent` - Matched via intent template similarity
- `embedding` - Matched via vector similarity (fallback)

---

### Batch Execute

Execute multiple inputs in a single request.

```
POST /api/v1/execute/batch
```

**Request Body:**
```json
{
  "inputs": [
    { "input": "what is 5 + 3?" },
    { "input": "convert hello to uppercase" },
    { "input": "15 * 4" }
  ],
  "sessionId": "optional_session"
}
```

**Response:**
```json
{
  "success": true,
  "totalInputs": 3,
  "successCount": 3,
  "failureCount": 0,
  "totalExecutionMs": 45,
  "avgExecutionMs": 15,
  "results": [
    {
      "input": "what is 5 + 3?",
      "success": true,
      "output": "8",
      "shardId": "shd_xxx",
      "shardName": "simple-addition",
      "matchMethod": "pattern",
      "executionMs": 12
    }
  ]
}
```

**Limits:** Maximum 50 inputs per batch.

---

### Get System Stats

Retrieve comprehensive system statistics.

```
GET /api/v1/stats
```

**Response:**
```json
{
  "procedural": {
    "shards": { "total": 55, "promoted": 40 },
    "traces": { "total": 189, "synthesized": 45 },
    "executions": { "total": 26000, "successful": 25800, "successRate": 0.992 }
  },
  "episodic": {
    "total": 150,
    "positive": 140,
    "negative": 10
  },
  "semantic": {
    "facts": 86,
    "highConfidence": 80,
    "avgConfidence": 0.89
  },
  "working": {
    "total": 5,
    "raw": 2,
    "liquidated": 2,
    "promoted": 1,
    "avgCompression": 0.65
  }
}
```

---

### List Shards

List available procedural shards.

```
GET /api/v1/shards?lifecycle=promoted&visibility=public
```

**Query Parameters:**
- `lifecycle` - Filter by lifecycle: `testing`, `promoted`, `deprecated`, `all`
- `visibility` - Filter by visibility: `public`, `private`, `organization`

**Response:**
```json
{
  "shards": [
    {
      "id": "shd_xxx",
      "name": "percentage-calculator",
      "confidence": 0.95,
      "lifecycle": "promoted",
      "visibility": "public",
      "executionCount": 1500,
      "successRate": 0.99,
      "isOwned": false,
      "createdAt": "2025-01-10T..."
    }
  ]
}
```

---

## Trace Ingestion

### Ingest a Trace

Submit a reasoning trace for crystallization into shards.

```
POST /api/v1/traces
```

**Request Body:**
```json
{
  "input": "What is 50% of 80?",
  "output": "40",
  "reasoning": "To find 50% of 80, multiply 80 by 0.5 = 40",
  "tokensUsed": 150,
  "model": "claude-3-sonnet",
  "sessionId": "optional_session",
  "visibility": "private"
}
```

**Response:**
```json
{
  "id": "trc_xxx",
  "intentTemplate": "what is {percent}% of {number}?",
  "intentHash": "abc123",
  "patternHash": "def456",
  "ownerId": "tenant_xxx"
}
```

---

## Episodic Memory

### Record an Episode

Record a Situation-Action-Outcome (SAO) episode.

```
POST /api/v1/episodes
```

**Request Body:**
```json
{
  "situation": {
    "context": "User asked for percentage calculation",
    "entities": ["percentage", "math"],
    "state": { "complexity": "simple" }
  },
  "action": {
    "type": "shard_execution",
    "description": "Executed percentage-calculator shard",
    "parameters": { "input": "50% of 80" },
    "reasoning": "Pattern matched percentage template"
  },
  "outcome": {
    "result": "40",
    "success": true,
    "effects": ["tokens_saved", "user_served"],
    "metrics": { "executionMs": 4 }
  },
  "type": "shard_execution",
  "summary": "Successfully calculated 50% of 80 = 40",
  "lessonsLearned": [],
  "importance": 0.5,
  "sessionId": "optional",
  "relatedShardId": "shd_xxx",
  "visibility": "private"
}
```

**Response:**
```json
{
  "id": "epi_xxx",
  "summary": "Successfully calculated 50% of 80 = 40",
  "type": "shard_execution",
  "success": true
}
```

---

### Find Similar Episodes

Search for similar past episodes.

```
GET /api/v1/episodes/similar?q=percentage+calculation&limit=5
```

**Response:**
```json
{
  "episodes": [
    {
      "id": "epi_xxx",
      "summary": "Successfully calculated 25% of 200",
      "type": "shard_execution",
      "success": true,
      "valence": "positive",
      "importance": 0.4,
      "lessonsLearned": [],
      "timestamp": "2025-01-13T..."
    }
  ]
}
```

---

### Get Episode Chain

Retrieve the chain of episodes linked to a specific episode.

```
GET /api/v1/episodes/:id/chain
```

---

### List Episodes

```
GET /api/v1/episodes?limit=20&type=shard_execution
```

---

## Semantic Memory (Truth Store)

### Store a Fact

Add a knowledge fact to the semantic store.

```
POST /api/v1/facts
```

**Request Body:**
```json
{
  "subject": "Earth",
  "predicate": "has_moons",
  "object": "1",
  "statement": "Earth has 1 natural moon",
  "confidence": 0.99,
  "sources": ["NASA"],
  "evidence": [],
  "category": "astronomy",
  "isTemporal": false,
  "visibility": "public"
}
```

**Response:**
```json
{
  "id": "fct_xxx",
  "statement": "Earth has 1 natural moon",
  "confidence": 0.99,
  "visibility": "public"
}
```

---

### Verify a Claim

Check a claim against the truth store.

```
POST /api/v1/facts/verify
```

**Request Body:**
```json
{
  "claim": "The Moon orbits Earth"
}
```

**Response:**
```json
{
  "verified": true,
  "confidence": 0.95,
  "supportingFacts": [
    {
      "id": "fct_xxx",
      "statement": "Earth has 1 natural moon",
      "confidence": 0.99
    }
  ]
}
```

---

### Search Facts

```
GET /api/v1/facts/search?q=moon&limit=10
```

---

### Get Facts by Subject

```
GET /api/v1/facts/subject/:subject
```

---

### List Facts

```
GET /api/v1/facts?limit=20&category=astronomy
```

---

## Working Memory (Context Liquidation)

### Create Context

Create a working memory context for a session.

```
POST /api/v1/contexts
```

**Request Body:**
```json
{
  "sessionId": "sess_xxx",
  "rawContent": "Full conversation or document text...",
  "contentType": "conversation",
  "agentId": "optional_agent",
  "ttlSeconds": 3600,
  "originalTokens": 5000,
  "visibility": "private"
}
```

---

### Liquidate Context

Compress a context, extracting facts and entities.

```
POST /api/v1/contexts/:id/liquidate
```

**Response:**
```json
{
  "id": "ctx_xxx",
  "status": "liquidated",
  "extractedFacts": ["User prefers dark mode", "User is a developer"],
  "extractedEntities": ["dark mode", "developer", "TypeScript"],
  "compressionRatio": 0.35
}
```

---

### Promote Context to Semantic Memory

```
POST /api/v1/contexts/:id/promote
```

---

### Get Session Contexts

```
GET /api/v1/contexts/session/:sessionId
```

---

### Get Context for Continuation

Get relevant context for continuing a conversation.

```
GET /api/v1/contexts/continuation?sessionId=xxx&input=current+query&maxTokens=2000
```

---

### Find Similar Contexts

```
GET /api/v1/contexts/similar?q=query&limit=5&sessionId=optional
```

---

### Cleanup Expired Contexts

```
POST /api/v1/contexts/cleanup
```

---

## Metabolic Operations

### Crystallize

Trigger crystallization of traces into shards.

```
POST /api/v1/metabolic/crystallize
```

**Request Body:**
```json
{
  "minTracesPerCluster": 3
}
```

---

### Promote Shards

Promote testing shards that meet criteria.

```
POST /api/v1/metabolic/promote
```

---

### Run Decay Cycle

```
POST /api/v1/metabolic/decay
```

---

### Extract Lessons

```
POST /api/v1/metabolic/lessons
```

---

### Evolve Shards

```
POST /api/v1/metabolic/evolve
```

---

### Reseed Preview

Preview what would be affected by a reseed.

```
GET /api/v1/metabolic/reseed/preview?preserveHighConfidence=true&confidenceThreshold=0.8
```

---

### Soft Reseed

Reset low-confidence data while preserving promoted shards.

```
POST /api/v1/metabolic/reseed/soft
```

---

### Full Reseed (Dangerous)

Reset procedural memory. Requires confirmation.

```
POST /api/v1/metabolic/reseed/full
```

**Request Body:**
```json
{
  "confirm": "RESEED_CONFIRMED",
  "preserveHighConfidence": true,
  "confidenceThreshold": 0.8
}
```

---

### Re-cluster Traces

```
POST /api/v1/metabolic/recluster
```

---

### Migrate to Hybrid

```
POST /api/v1/metabolic/migrate-hybrid
```

---

## Health & Monitoring

### Health Check

```
GET /health
```

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-01-13T...",
  "checks": {
    "database": { "status": "pass", "message": "Connected (5ms)" },
    "redis": { "status": "pass", "message": "Connected (2ms)" }
  },
  "uptime_seconds": 86400
}
```

---

### Liveness Probe

```
GET /health/live
```

---

### Readiness Probe

```
GET /health/ready
```

---

### Prometheus Metrics

```
GET /metrics
```

Returns metrics in Prometheus text format.

---

### JSON Metrics

```
GET /metrics/json
```

---

### Monitoring Status

```
GET /api/v1/monitoring/status
```

Returns combined health, metrics, and activity stats.

---

## Admin Operations

### Regenerate Embeddings

Regenerate all vector embeddings with current model.

```
POST /api/v1/admin/regenerate-embeddings
```

---

### Backfill Intent Embeddings

```
POST /api/v1/admin/backfill-intent-embeddings
```

---

## Rate Limits

| Endpoint | Limit |
|----------|-------|
| `/api/v1/execute` | 1000 requests/minute |
| `/api/v1/auth/*` | 10 requests/minute |
| All other `/api/*` | 100 requests/minute |

Localhost/internal IPs bypass rate limiting for testing.

---

## Error Responses

All errors follow this format:

```json
{
  "error": "Error message",
  "message": "Detailed message (dev only)",
  "statusCode": 400
}
```

Common status codes:
- `400` - Bad Request (invalid input)
- `429` - Rate Limited
- `500` - Internal Server Error

---

## Available Shards (55 total)

### Math Operations
- `simple-addition-question-solver` - Addition (5 + 3)
- `simple-subtraction-question-solver` - Subtraction (10 - 4)
- `simple-multiplication-solver` - Multiplication (6 * 7)
- `basic-division-parser` - Division (20 / 4)
- `percentage-calculator` - Percentages (25% of 200)
- `fibonacci-number` - Fibonacci (10th fibonacci)
- `factorial-calculator` - Factorials (5 factorial)
- `power-calculator` - Exponents (2 ^ 10)
- `square-root-calculator` - Square roots (square root of 144)
- `modulo-calculator` - Modulo (17 mod 5)
- `absolute-value` - Absolute value (abs -5)
- `gcd-calculator` - GCD (gcd 12 18)
- `lcm-calculator` - LCM (lcm 4 6)

### String Operations
- `convert-text-to-uppercase` - Uppercase conversion
- `convert-text-to-lowercase` - Lowercase conversion
- `reverse-string` - String reversal
- `extract-email-address` - Email extraction
- `count-words-in-sentence` - Word counting
- `character-counter` - Character counting
- `slug-generator` - URL slug generation
- `extract-longest-word-from-quoted-phrase` - Find longest word

### Conversions
- `celsius-to-fahrenheit` - Temperature (100 celsius to fahrenheit)
- `fahrenheit-to-celsius` - Temperature (212 fahrenheit to celsius)
- `hex-to-decimal` - Number base (0xFF to decimal)
- `decimal-to-hex` - Number base (255 to hex)
- `binary-to-decimal` - Number base (1010 to decimal)

### Validation
- `validate-email-format` - Email validation
- `is-prime-number-checker` - Prime checking

---

## Example Usage

### cURL

```bash
# Execute a shard
curl -X POST https://api.askalf.org/api/v1/execute \
  -H "Content-Type: application/json" \
  -d '{"input": "what is 25% of 200?"}'

# Get stats
curl https://api.askalf.org/api/v1/stats

# Batch execute
curl -X POST https://api.askalf.org/api/v1/execute/batch \
  -H "Content-Type: application/json" \
  -d '{"inputs": [{"input": "5 + 3"}, {"input": "10 * 4"}]}'
```

### JavaScript

```javascript
const response = await fetch('https://api.askalf.org/api/v1/execute', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ input: 'what is 25% of 200?' })
});
const result = await response.json();
console.log(result.output); // "50"
```

### Python

```python
import requests

response = requests.post(
    'https://api.askalf.org/api/v1/execute',
    json={'input': 'what is 25% of 200?'}
)
print(response.json()['output'])  # "50"
```
