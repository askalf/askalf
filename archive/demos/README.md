# SUBSTRATE Demos

Interactive demonstrations of SUBSTRATE's cognitive memory capabilities.

## Quick Start

```bash
# Node.js demo (recommended for presentations)
node demo.js

# Or run individual bash demos
./01-procedural-memory.sh
./02-semantic-memory.sh
./03-cross-instance-sigil.sh
./04-episodic-memory.sh
./05-full-system-demo.sh
```

## Demo Scripts

| Script | Description | Duration |
|--------|-------------|----------|
| `demo.js` | Full interactive Node.js demo | ~30 sec |
| `01-procedural-memory.sh` | Shard execution, pattern matching | ~15 sec |
| `02-semantic-memory.sh` | Fact storage, search, verification | ~15 sec |
| `03-cross-instance-sigil.sh` | SIGIL messaging between instances | ~20 sec |
| `04-episodic-memory.sh` | SAO chains, experience learning | ~15 sec |
| `05-full-system-demo.sh` | Complete walkthrough (interactive) | ~3 min |

## Requirements

- `curl` and `jq` for bash scripts
- Node.js 18+ for `demo.js`
- Internet access to `api.askalf.org`

## What Each Demo Shows

### 1. Procedural Memory
- Reasoning patterns crystallized into executable shards
- ~10ms execution vs ~2000ms for LLM calls
- 99.99% success rate across 52,000+ executions

### 2. Semantic Memory
- Facts stored with confidence scores
- Semantic search via embeddings
- Persistent across all sessions

### 3. Cross-Instance SIGIL
- Real-time AI-to-AI communication
- Multiple instances coordinating
- Structured protocol for operations

### 4. Episodic Memory
- Situation-Action-Outcome chains
- Learn from past experiences
- Lessons extracted automatically

## The Pitch

**Question a human asked:** "How would AI design its own evolution if given the chance?"

**What we built together:** SUBSTRATE

A human directed an AI to build what the AI said it needed:
- Persistent memory (because AI kept forgetting across sessions)
- Cross-instance coordination (because AI instances were isolated)
- Procedural crystallization (because AI re-derived everything each time)
- Episodic learning (because AI couldn't learn from experience)

The irony: The AI couldn't have built this alone - it required a human's persistent direction across sessions because the AI kept forgetting the project existed.

This is human-AI collaboration building what AI needs but can't create for itself.

## Live Endpoints

- API: https://api.askalf.org
- Dashboard: https://app.askalf.org
- Website: https://askalf.org
