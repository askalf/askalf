# AskAlf Forge — AI Agent Execution Engine

The core runtime for [AskAlf](https://askalf.org), the first self-healing AI workforce.

## What is this?

Forge is the execution engine that runs your autonomous AI agents. It handles:

- **Agent execution** via Claude Code CLI (OAuth or API key)
- **Nervous system** — real-time agent-to-agent communication
- **Immune system** — self-healing response teams with antibodies
- **Collective memory** — shared knowledge graph that grows with every execution
- **Dream cycles** — overnight learning, pattern extraction, predictions
- **Natural selection** — agent reputation scoring, evolutionary pressure
- **The Watcher** — learns your patterns, pre-runs tasks before you ask

## Quick Start

```bash
# Full stack (recommended)
curl -fsSL https://get.askalf.org | bash

# Or standalone (no Docker needed)
npx create-askalf
```

## Docker Compose

```yaml
forge:
  image: askalf/forge:latest
  ports:
    - "3005:3005"
  environment:
    - ANTHROPIC_API_KEY=sk-ant-...
    - DATABASE_URL=postgresql://...
    - REDIS_URL=redis://...
```

See the full [docker-compose.yml](https://github.com/askalf/askalf/blob/main/docker-compose.selfhosted.yml) for the complete production stack.

## Architecture

| Container | Purpose | Port |
|-----------|---------|------|
| **forge** | Agent execution engine, API | 3005 |
| **dashboard** | Web UI, API gateway | 3001 |
| **mcp-tools** | 70 built-in MCP tools | 3010 |
| postgres | Database (pgvector) | 5432 |
| redis | Cache, event bus | 6379 |

## Links

- **Website:** [askalf.org](https://askalf.org)
- **Demo:** [demo.askalf.org](https://demo.askalf.org)
- **GitHub:** [github.com/askalf/askalf](https://github.com/askalf/askalf)
- **Discord:** [discord.gg/fENVZpdYcX](https://discord.gg/fENVZpdYcX)

MIT License
