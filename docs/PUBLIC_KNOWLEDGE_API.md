# Public Knowledge Base API — Design Specification

> **Status:** Implemented
> **Route file:** `apps/api/src/routes/knowledge.ts`
> **Base path:** `/api/v1/knowledge`
> **Auth:** None required (public endpoints)
> **Rate limits:** 30 req/min (browse), 10 req/min (ask)

## Overview

The Public Knowledge API exposes ALF's procedural knowledge base to external consumers. It allows browsing, searching (text and semantic), and AI-powered Q&A against promoted shards. All endpoints are unauthenticated and rate-limited per IP.

## Data Sources

| Table | Purpose |
|---|---|
| `procedural_shards` | Primary knowledge store — 614 shards (485 promoted, 102 candidate, 27 archived) |
| `knowledge_facts` | Structured subject-predicate-object facts (264 entries) |

Only shards with `visibility = 'public' OR visibility IS NULL` and `lifecycle = 'promoted'` are exposed by default.

---

## Endpoints

### 1. Browse Knowledge

```
GET /api/v1/knowledge
```

Paginated listing of knowledge items with filtering and sorting.

**Query Parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `category` | string | — | Filter by category (e.g., `science`, `programming`, `math`) |
| `knowledgeType` | string | — | Filter: `immutable`, `temporal`, `contextual`, `procedural` |
| `minConfidence` | float | `0.5` | Minimum confidence score (0–1) |
| `lifecycle` | string | `promoted` | Shard lifecycle: `promoted`, `testing`, `candidate` |
| `sort` | string | `confidence` | Sort by: `confidence`, `executions`, `recent`, `name` |
| `limit` | int | `20` | Results per page (1–100) |
| `offset` | int | `0` | Pagination offset |

**Response (200):**
```json
{
  "knowledge": [
    {
      "id": "01ABC...",
      "name": "explain-photosynthesis",
      "description": "Explains the process of photosynthesis",
      "category": "science",
      "knowledgeType": "immutable",
      "patterns": ["what is photosynthesis", "how do plants make food"],
      "confidence": 0.95,
      "executionCount": 42,
      "successRate": 98,
      "estimatedTokens": 150,
      "intentTemplate": "Explain {{concept}}",
      "verificationStatus": "verified",
      "createdAt": "2026-01-15T...",
      "updatedAt": "2026-02-10T..."
    }
  ],
  "total": 485,
  "limit": 20,
  "offset": 0,
  "hasMore": true
}
```

**Rate limit:** 30/min per IP

---

### 2. List Categories

```
GET /api/v1/knowledge/categories
```

Returns all knowledge categories with aggregate stats. Categories are grouped from the `category` and `knowledge_type` columns.

**Response (200):**
```json
{
  "categories": [
    {
      "category": "science",
      "totalShards": 83,
      "promotedShards": 78,
      "avgConfidence": 0.87,
      "totalExecutions": 1204,
      "knowledgeTypes": ["immutable", "temporal"]
    }
  ]
}
```

**Rate limit:** 30/min per IP

---

### 3. Search Knowledge

```
GET /api/v1/knowledge/search
```

Search with two modes: `semantic` (pgvector cosine similarity via `embedding <=>`) and `text` (ILIKE fallback on `name`, `description`, `intent_template`).

**Query Parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `q` | string | **required** | Search query |
| `category` | string | — | Filter by category |
| `limit` | int | `10` | Results (1–20) |
| `mode` | string | `semantic` | `semantic` or `text` |

**Response (200):**
```json
{
  "query": "how does gravity work",
  "mode": "semantic",
  "results": [
    {
      "id": "01XYZ...",
      "name": "explain-gravity",
      "description": "Explains gravitational force",
      "category": "science",
      "knowledgeType": "immutable",
      "patterns": ["what is gravity", "how does gravity work"],
      "confidence": 0.92,
      "executionCount": 35,
      "intentTemplate": "Explain {{concept}}",
      "relevance": 0.89
    }
  ],
  "total": 5
}
```

**Semantic search flow:**
1. Generate embedding for query via `@substrate/ai.generateEmbedding()`
2. Query `procedural_shards` using `embedding <=> $1::vector` (pgvector cosine distance)
3. Return results sorted by similarity, with `relevance = 1 - cosine_distance`
4. On embedding failure, automatically falls back to text search

**Rate limit:** 30/min per IP

**Error (400):**
```json
{ "error": "Search query (q) is required." }
```

---

### 4. Get Knowledge Item

```
GET /api/v1/knowledge/:id
```

Returns full details for a single shard, including the `logic` field (the actual knowledge content). Increments `execution_count` on each access.

**Response (200):**
```json
{
  "id": "01ABC...",
  "name": "explain-photosynthesis",
  "description": "Explains the process of photosynthesis",
  "version": 3,
  "logic": "Photosynthesis is the process by which plants...",
  "patterns": ["what is photosynthesis"],
  "category": "science",
  "knowledgeType": "immutable",
  "confidence": 0.95,
  "executionCount": 43,
  "successRate": 98,
  "estimatedTokens": 150,
  "intentTemplate": "Explain {{concept}}",
  "verificationStatus": "verified",
  "lifecycle": "promoted",
  "synthesisMethod": "reasoning_trace",
  "createdAt": "2026-01-15T...",
  "updatedAt": "2026-02-10T..."
}
```

**Error (404):**
```json
{ "error": "Knowledge item not found." }
```

**Rate limit:** 30/min per IP

---

### 5. Ask a Question (AI-Powered)

```
POST /api/v1/knowledge/ask
```

Natural language Q&A that retrieves relevant shards via semantic search, then synthesizes an answer using Claude.

**Request Body:**
```json
{
  "question": "How does photosynthesis work?",
  "category": "science"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `question` | string | yes | Natural language question (max 1000 chars) |
| `category` | string | no | Scope to a specific category |

**Response (200):**
```json
{
  "answer": "Photosynthesis is a process used by plants to convert light energy...",
  "question": "How does photosynthesis work?",
  "sources": [
    {
      "id": "01ABC...",
      "name": "explain-photosynthesis",
      "category": "science",
      "confidence": 0.95,
      "relevance": 0.89
    }
  ],
  "tokensUsed": 256
}
```

**Implementation details:**
1. Generate embedding for the question
2. Find top 5 shards by cosine similarity (`embedding <=> vector`)
3. Filter to shards with `similarity > 0.3`
4. Build context from shard `description` or `logic` (truncated to 300 chars)
5. Call `claude-sonnet-4-5-20250929` with system prompt restricting answers to provided context
6. Return synthesized answer with source attribution

**Rate limit:** 10/min per IP (AI-powered, higher cost)

**Errors:**
- `400`: Missing or too-long question
- `429`: Rate limit exceeded
- `500`: Embedding or LLM failure

---

## Rate Limiting

In-memory per-IP rate limiting with 1-minute sliding window:

| Endpoint group | Limit | Window |
|---|---|---|
| Browse (`/knowledge`, `/categories`, `/search`, `/:id`) | 30 req | 1 minute |
| Ask (`/knowledge/ask`) | 10 req | 1 minute |

Implementation: `Map<string, { count, resetAt }>` with 5-minute cleanup interval.

**Rate limit response (429):**
```json
{ "error": "Rate limit exceeded. Max 30 requests per minute." }
```

---

## Architecture Decisions

### Why public/unauthenticated?
The knowledge base is ALF's public-facing value proposition. External users and search engines should be able to browse and query it without friction. Rate limiting provides abuse protection.

### Why in-memory rate limiting?
For a single-instance API, in-memory is simpler and faster than Redis-backed rate limiting. If the API scales horizontally, this should migrate to Redis (using the existing Redis instance) with `INCR`/`EXPIRE` patterns.

### Why semantic search as default?
pgvector embeddings provide much higher relevance than ILIKE text matching. The text fallback exists for resilience when the embedding service is unavailable.

### Why filter similarity > 0.3 for /ask?
Shards below 0.3 cosine similarity are typically irrelevant noise. Including them would degrade answer quality and waste LLM tokens.

### Why increment execution_count on GET /:id?
Tracks organic access patterns. This feeds back into convergence metrics and helps identify high-demand knowledge areas.

---

## Available Categories

Current promoted shard distribution (top 20):

| Category | Shards |
|---|---|
| science | 83 |
| geography | 41 |
| math | 38 |
| programming | 37 |
| technology | 31 |
| health | 30 |
| conversion | 29 |
| language | 29 |
| history | 23 |
| finance | 22 |
| definitions | 20 |
| space | 17 |
| psychology | 13 |
| food | 12 |
| animals | 10 |
| sports | 10 |
| meta | 8 |
| music | 8 |
| fun | 6 |
| business | 5 |

---

## Future Considerations

- **Redis-backed rate limiting** if API scales to multiple instances
- **Cache layer** (Redis or CDN) for `/categories` and popular browse queries (TTL: 5 min)
- **API key support** for higher rate limits (integrate with existing `api_keys` table)
- **knowledge_facts integration** — expose the 264 structured facts via `/api/v1/knowledge/facts` endpoint
- **Webhook/streaming** for `/ask` responses on long queries
- **OpenAPI/Swagger spec** generation from Fastify schemas
