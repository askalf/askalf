# AskAlf

**Tell Alf what you need. Alf builds the team.**

One AI that creates specialized workers for any task — security, operations, research, support, development, whatever your business needs. Alf figures out who to hire, puts them to work, and reports back while you sleep. They learn from every task. They get faster every day.

Other tools give you a chatbot. AskAlf gives you a workforce.

**[askalf.org](https://askalf.org)** · **[Wiki](https://github.com/askalf/askalf/wiki)** · **[Discord](https://discord.gg/fENVZpdYcX)** · **[@ask_alf](https://x.com/ask_alf)**

---

## Deploy in One Line

```bash
curl -fsSL https://get.askalf.org | bash
```

That's it. Checks prerequisites, generates secrets, pulls images, and starts your fleet at `http://localhost:3001`.

Runs on **Linux, macOS, and Windows WSL2** — anything with Docker.

<details>
<summary>Manual install</summary>

```bash
git clone https://github.com/askalf/askalf.git
cd askalf/substrate && ./setup.sh
docker compose -f docker-compose.selfhosted.yml up -d
```

</details>

---

## What Happens While You Sleep

You close your laptop at 10:47 PM. Here's what happens next:

- **10:49 PM** — QA catches a regression in your last commit. Creates a ticket.
- **10:51 PM** — Backend Dev claims it, traces the root cause, writes the fix. *12 minutes after you went to bed.*
- **11:03 PM** — QA re-runs 42 tests. All pass. Ticket resolved.
- **11:14 PM** — Security scans 847 dependencies. Finds 2 CVEs. Patches both.
- **01:15 AM** — Frontend Dev detects an API contract break from the fix. Updates the component.
- **02:04 AM** — Watchdog flags Redis at 91%. Infra consults the Brain for past fixes. Applies it. Redis drops to 52%.
- **03:12 AM** — A **Terraform Specialist** is spawned on demand to audit infrastructure drift. Cost: **$0.04**.
- **04:30 AM** — Writer generates a changelog for your morning standup.
- **06:47 AM** — Fleet goes quiet. 7 agents, 18 executions, 8 hours. Total cost: **$0.43**.
- **09:00 AM** — You open your laptop. Everything is done.

---

## The Fleet

### 7 Core Agents

| Agent | Role |
|-------|------|
| **Backend Dev** | API routes, database, server-side logic, bug fixes |
| **Frontend Dev** | React components, UI, CSS, dashboard features |
| **QA** | Tests, validation, regression detection, coverage |
| **Infra** | Docker, deploys, infrastructure, CI/CD |
| **Security** | Vulnerability scanning, dependency audits, secret detection |
| **Watchdog** | Health checks, monitoring, incident detection, alerting |
| **Writer** | Documentation, changelogs, runbooks, technical writing |

### Unlimited Custom Specialists

For any task outside generic web dev, AskAlf spawns a **custom specialist** on demand with the exact tools, system prompt, and domain knowledge needed:

*Terraform Specialist · ML Ops Engineer · Data Pipeline Architect · HIPAA Compliance Auditor · iOS Build Engineer · Salesforce Integration Dev · K8s Migration Specialist · API Gateway Architect*

Custom agents are first-class — they create tickets, store memories, and coordinate with core agents. They're destroyed when done.

---

## Embedded Claude CLI + OpenAI Codex

Full Claude Code and OpenAI Codex terminal sessions **embedded directly in the dashboard**. Not wrappers — real PTY sessions via xterm.js with your full codebase available.

- **Claude Code** — `claude --dangerously-skip-permissions` with MCP tools, your knowledge graph, and agent context
- **OpenAI Codex** — `codex --full-auto` with dynamic instructions injected from the platform
- Switch between them with a tab. Same toolbar. Same workspace.

---

## The Brain — 10-Layer Cognitive Memory

Every fix, every failure, every deployment is stored in a cognitive memory system that grows with every execution.

- **Semantic Memory** — Facts, concepts, system architecture (pgvector embeddings)
- **Episodic Memory** — What happened, what worked, what failed
- **Procedural Memory** — Successful patterns extracted into reusable templates
- **Knowledge Graph** — 1,500+ nodes with automatic cross-agent connection discovery
- **Metabolic Consolidation** — Overnight cycles that strengthen useful memories and decay noise

The 10th deploy is faster than the 1st. The 100th security scan knows exactly where to look.

---

## The Ecosystem

### 12 Device Adapters

Your agents don't just run in the cloud — they control real machines.

| Category | Devices |
|----------|---------|
| **Compute** | CLI Agent, Docker Host, SSH Remote, Kubernetes |
| **Desktop & Mobile** | Browser Bridge, Desktop Control, VS Code, Android, iOS |
| **IoT & Edge** | Raspberry Pi, Arduino/ESP32, Home Assistant |

### 16 Communication Channels

Slack · Discord · Telegram · WhatsApp · Teams · **OpenClaw** · REST API · Webhooks · Zapier · n8n · Make · Email · SMS · SendGrid · Twilio · Zoom

### 22 Integration Providers

GitHub · GitLab · Bitbucket · AWS · GCP · Azure · Vercel · Netlify · Railway · Fly.io · Jira · Linear · Notion · Asana · Datadog · Sentry · PagerDuty · Grafana · Cloudflare · S3 · Supabase · and more

---

## What Makes This Different

**This is not a framework.** Not a library. Not a toolkit you assemble yourself.

| | AskAlf | OpenClaw | Frameworks (CrewAI, AutoGen, LangGraph) |
|---|--------|---------|------------------------------------------|
| **Multi-specialist teams** | Unlimited, built on demand | Single agent | You build it |
| **Dashboard** | Mission control with fleet viz | CLI/chat only | You build it |
| **Memory** | 10-layer cognitive brain with pgvector | 24h context window | You build it |
| **Deployment** | `curl \| bash`, 60 seconds | `npm install -g` | You build it |
| **Orchestration** | Autonomous ticket dispatch | Reactive only | You build it |
| **Security** | AES-256, sandboxed, VPN, audited | 512 vulnerabilities found | You build it |
| **Cost tracking** | Per-agent budgets + audit log | Token estimates | You build it |
| **Channels** | 16 built in (inc. OpenClaw) | 19 chat platforms | You build it |
| **Marketplace** | MCP tools + skill templates | ClawHub skills | You build it |
| **AI terminals** | Embedded Claude CLI + Codex | Not available | Not available |
| **VPN tunneling** | Built-in Gluetun + Proton VPN | Not available | Not available |
| **Auto-recovery** | Autoheal container self-healing | Not available | Not available |

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Dashboard                         │
│     Mission Control · Claude CLI · Codex CLI         │
│      Fleet · Ops · Brain · Builder · Live            │
├───────────────┬───────────────┬──────────────────────┤
│     Forge     │   MCP Tools   │      SearXNG         │
│   API Server  │  Agent Tools  │    Web Search        │
│   Runtime     │  Memory Ops   │                      │
│   Scheduler   │  Ticket Ops   │                      │
├───────────────┴───────────────┴──────────────────────┤
│           PostgreSQL + pgvector  │  Redis             │
└─────────────────────────────────────────────────────┘
```

## Tech Stack

TypeScript 5.4 · Node.js 22 · React 19 · Fastify 5 · PostgreSQL 17 · pgvector 0.8 · Redis 8 · Docker Compose · xterm.js · node-pty · WebSocket · MCP Protocol · PKCE OAuth · SearXNG · Gluetun VPN · Autoheal

---

## Optional: VPN Tunneling

Route all outbound agent traffic through an encrypted VPN tunnel via **Gluetun**. Your agents' API calls, web searches, and external requests stay encrypted and anonymous.

```bash
# Add to your .env file
VPN_SERVICE_PROVIDER=protonvpn
VPN_TYPE=wireguard
WIREGUARD_PRIVATE_KEY=your-key-from-protonvpn-dashboard
VPN_SERVER_COUNTRIES=Switzerland

# Start with VPN enabled
docker compose -f docker-compose.selfhosted.yml --profile vpn up -d
```

Supports 30+ providers — ProtonVPN, Mullvad, NordVPN, Surfshark, and [more](https://github.com/qdm12/gluetun-wiki/tree/main/setup/providers). Change the country to route through any location your provider supports.

## Marketplace

Browse, install, and publish tools and skills from the community marketplace — built into the dashboard.

- **26 built-in MCP tools** — tickets, findings, Docker, deploy, security scan, code analysis, knowledge graph, fleet intel, and more
- **Community packages** — publish your own tools and skill templates
- **One-click install** — add tools to your agents directly from the marketplace
- **Ratings and reviews** — community-driven quality signals

Visit `/command-center/marketplace` in your dashboard.

---

## OpenClaw Bridge

Already running OpenClaw? Connect it as a channel frontend to AskAlf. Messages from OpenClaw-connected platforms (WhatsApp, Telegram, Discord, etc.) route through AskAlf's agent fleet with full memory, orchestration, and multi-agent coordination.

```bash
# Add to your .env
OPENCLAW_GATEWAY_URL=ws://127.0.0.1:18789
OPENCLAW_GATEWAY_TOKEN=your-gateway-token
```

OpenClaw handles the chat. AskAlf handles the thinking.

Compare features: [AskAlf vs OpenClaw Security](/security)

---

## Migrating from OpenClaw

One-command migration converts your OpenClaw agents, skills, memory, and config to AskAlf format:

```bash
./scripts/migrate-from-openclaw.sh ~/.openclaw
# Review: ./openclaw-migration/
# Import: ./openclaw-migration/import-to-askalf.sh
```

Converts: agents (AGENTS.md + SOUL.md → system prompts), skills (SKILL.md → templates), memory (MEMORY.md → semantic seeds), channels, providers, and heartbeat config.

## Autoheal

Automatic container recovery — included by default. If any container fails its health check, Autoheal restarts it automatically.

---

## Requirements

- Docker and Docker Compose
- 4GB+ RAM (8GB recommended)
- At least one AI provider API key (Anthropic recommended, OpenAI supported)
- Free to run on your own hardware — or ~$5/month on a VPS

## License

MIT — see [LICENSE](LICENSE)

---

Built by [askalf](https://github.com/askalf) · [askalf.org](https://askalf.org) · [support@askalf.org](mailto:support@askalf.org)
