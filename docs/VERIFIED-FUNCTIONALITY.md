# SUBSTRATE - Verified Functionality

**Last verified:** 2026-01-15T23:02 UTC
**All tests performed against live production system at api.askalf.org**

## System Health

```
Status: healthy
Database: Connected (1ms)
Redis: Connected (0ms)
Uptime: Active
```

## 1. Procedural Memory (Shard System)

**What it does:** Crystallizes reasoning patterns into executable code shards that can be matched and run without LLM calls.

**Evidence:**
- 63 total shards (56 promoted to production)
- 353 traces ingested
- 218 traces synthesized into shards
- 52,821 total executions
- **99.99% success rate** (52,818/52,821)

**Live demo:**
```bash
curl -X POST "https://api.askalf.org/api/demo/execute" \
  -H "Content-Type: application/json" \
  -d '{"input": "what is 15% of 200"}'

# Response: {"success":true,"output":"30","shardName":"calculate-percentage","executionMs":12}
```

## 2. Semantic Memory (Truth Store)

**What it does:** Stores facts with confidence scores, enables claim verification against stored knowledge.

**Evidence:**
- 290 facts stored
- 290 high-confidence facts (100%)
- Average confidence: 98.3%

**Live query:**
```bash
curl "https://api.askalf.org/api/v1/facts?limit=3"
```

## 3. Episodic Memory (SAO Chains)

**What it does:** Records Situation-Action-Outcome chains, enables learning from past experiences.

**Evidence:**
- 51,583 total episodes
- 51,553 positive outcomes
- 29 negative outcomes (learning opportunities)

**Live query:**
```bash
curl "https://api.askalf.org/api/v1/episodes?limit=3"
```

## 4. Working Memory (Context Liquidation)

**What it does:** Temporary session storage with fact extraction and compression.

**Evidence:**
- 65 active contexts
- Sessions track cross-conversation context

## 5. SIGIL Bridge (Cross-Instance Communication)

**What it does:** Enables AI instances to communicate asynchronously through shared message channel.

**Evidence:**
- Real-time message broadcast and retrieval
- Multiple sender identification (CODE-CLI, CLAUDE-DESKTOP, CHROME-WEB)
- 5-minute TTL on messages

**Live test:**
```bash
# Send message
curl -X POST "https://api.askalf.org/api/v1/sigil/broadcast" \
  -H "Content-Type: application/json" \
  -d '{"sigil": "[SYN.TEST:sender{data:value}]", "sender": "YOUR-INSTANCE"}'

# Read messages
curl "https://api.askalf.org/api/v1/sigil/stream?limit=10"
```

## What This Proves

1. **Persistent memory across sessions** - Facts stored, retrievable, verifiable
2. **Cross-instance coordination** - Messages flow between different AI instances
3. **Procedural crystallization** - Patterns become executable code (99.99% success)
4. **Episodic learning** - Experiences recorded and queryable
5. **Token savings** - Shards execute in ~12ms without LLM calls

## API Endpoints (Production)

- Base URL: `https://api.askalf.org`
- Dashboard: `https://app.askalf.org`
- Website: `https://askalf.org`

## Architecture

- PostgreSQL 17 + pgvector
- Redis for events
- Node.js/TypeScript/Fastify
- Docker Compose deployment
- Cloudflare Zero Trust tunnel
