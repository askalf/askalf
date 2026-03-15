# AskAlf

**Not one AI. An entire team.**

7 autonomous AI agents that write code, fix bugs, monitor infrastructure, and coordinate — while you sleep. Self-hosted. Open source. Deploy in 60 seconds.

[askalf.org](https://askalf.org)

---

## Deploy in 60 Seconds

```bash
git clone https://github.com/SprayberryLabs/askalf.git
cd askalf && ./setup.sh
docker compose -f docker-compose.selfhosted.yml up -d
# Open http://localhost:3001 — your fleet is live
```

## Your AI Team

| Agent | Role |
|-------|------|
| **Backend Dev** | API routes, database, server-side logic |
| **Frontend Dev** | React components, UI, dashboard features |
| **QA** | Tests, validation, quality assurance |
| **Infra** | Docker, deploys, infrastructure |
| **Security** | Vulnerability scanning, dependency audits, secrets |
| **Watchdog** | Health checks, incident detection, monitoring |
| **Writer** | Documentation, changelogs, technical writing |

## What Makes This Different

**This is not a framework.** Not a library. Not a toolkit you assemble yourself.

AskAlf is a complete, production-ready platform where agents coordinate via tickets, share a cognitive memory system, and get smarter every day.

| Feature | AskAlf | Frameworks (CrewAI, AutoGen, LangGraph) |
|---------|--------|----------------------------------------|
| Dashboard | Mission control with orbital fleet viz | You build it |
| Memory | 10-layer cognitive brain with pgvector | You build it |
| Deployment | Docker Compose, 60 seconds | You build it |
| Orchestration | Pipeline, fan-out, consensus | You build it |
| Cost tracking | Guardrails, audit logging | You build it |
| Channels | 15 built in (Slack, Discord, Telegram...) | You build it |

## Platform

- **Mission Control Dashboard** — orbital fleet visualization, real-time heartbeat, cost telemetry, neural knowledge graph
- **10-Layer Cognitive Memory** — semantic, episodic, procedural with pgvector embeddings. 1,500+ node knowledge graph
- **Multi-Agent Orchestration** — pipeline, fan-out, consensus execution modes with DAG task decomposition
- **15 Communication Channels** — Slack, Discord, Telegram, WhatsApp, Teams, REST API, Webhooks, Zapier, n8n, Make, Email, SMS, SendGrid, Twilio, Zoom
- **22 Integration Providers** — GitHub, GitLab, Bitbucket, AWS, GCP, Azure, Vercel, Netlify, Jira, Linear, Notion, Datadog, Sentry, PagerDuty, Grafana, Cloudflare, Supabase, and more
- **12 Device Adapters** — Docker, SSH, Kubernetes, Browser, Desktop, VS Code, Android, iOS, Raspberry Pi, Arduino/ESP32, Home Assistant
- **Production Hardened** — PKCE OAuth, cost guardrails, rate limiting, encrypted secrets, audit logging, health checks, graceful shutdown

## Architecture

```
┌─────────────────────────────────────────────────┐
│                   Dashboard                      │
│        Mission Control · Terminal · Chat          │
│         Fleet · Ops · Live · Brain               │
├──────────────┬──────────────┬────────────────────┤
│    Forge     │  MCP Tools   │     SearXNG        │
│  API Server  │  Agent Tools │   Web Search       │
│  Runtime     │  Memory Ops  │                    │
├──────────────┴──────────────┴────────────────────┤
│          PostgreSQL + pgvector │ Redis            │
└─────────────────────────────────────────────────┘
```

## Requirements

- Docker and Docker Compose
- 4GB+ RAM (8GB recommended)
- At least one AI provider (Anthropic recommended)

## License

Open source. See [LICENSE](LICENSE) for details.

---

Built by [SprayberryLabs](https://github.com/SprayberryLabs)
