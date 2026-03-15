# AskAlf

**Not one AI. An entire team.**

7 core agents + unlimited custom specialists that write code, fix bugs, scan for vulnerabilities, monitor infrastructure, and coordinate autonomously. They work while you sleep. They learn from every execution. They never quit.

Other tools give you a chatbot. AskAlf gives you a workforce.

**[askalf.org](https://askalf.org)** · **[Docs](https://askalf.org/docs)** · **[support@askalf.org](mailto:support@askalf.org)**

---

## Deploy in 60 Seconds

```bash
git clone https://github.com/SprayberryLabs/askalf.git
cd askalf && ./setup.sh
docker compose -f docker-compose.selfhosted.yml up -d
# Open http://localhost:3001 — your fleet is live
```

Runs on **Linux, macOS, and Windows** — anything with Docker.

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

### 15 Communication Channels

Slack · Discord · Telegram · WhatsApp · Teams · REST API · Webhooks · Zapier · n8n · Make · Email · SMS · SendGrid · Twilio · Zoom

### 22 Integration Providers

GitHub · GitLab · Bitbucket · AWS · GCP · Azure · Vercel · Netlify · Railway · Fly.io · Jira · Linear · Notion · Asana · Datadog · Sentry · PagerDuty · Grafana · Cloudflare · S3 · Supabase · and more

---

## What Makes This Different

**This is not a framework.** Not a library. Not a toolkit you assemble yourself.

| | AskAlf | Frameworks (CrewAI, AutoGen, LangGraph, OpenClaw) |
|---|--------|---------------------------------------------------|
| **Dashboard** | Mission control with orbital fleet viz | You build it |
| **Memory** | 10-layer cognitive brain with pgvector | You build it |
| **Deployment** | Docker Compose, 60 seconds | You build it |
| **Orchestration** | Pipeline, fan-out, consensus | You build it |
| **Cost tracking** | Guardrails + audit logging | You build it |
| **Channels** | 15 built in | You build it |
| **Device control** | 12 adapters built in | You build it |
| **AI terminals** | Embedded Claude CLI + Codex | Not available |
| **VPN tunneling** | Built-in Gluetun + Proton VPN | Not available |
| **Auto-recovery** | Autoheal container self-healing | Not available |
| **Custom agents** | Spawned on demand, first-class | You build it |

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

## Optional: VPN + Autoheal

**Proton VPN tunneling** — Route all outbound agent traffic through an encrypted VPN tunnel via Gluetun. Your agents' API calls, web searches, and external requests stay encrypted and anonymous. Supports ProtonVPN, Mullvad, NordVPN, Surfshark, and any Gluetun-compatible provider.

**Autoheal** — Automatic container recovery. If any container fails its health check, it gets restarted automatically. Zero-downtime self-healing.

```bash
# Enable in your .env file
ENABLE_VPN=true
VPN_SERVICE_PROVIDER=protonvpn
OPENVPN_USER=your-proton-username
OPENVPN_PASSWORD=your-proton-password
ENABLE_AUTOHEAL=true
```

---

## Requirements

- Docker and Docker Compose
- 4GB+ RAM (8GB recommended)
- At least one AI provider API key (Anthropic recommended, OpenAI supported)
- Free to run on your own hardware — or ~$5/month on a VPS

## License

MIT — see [LICENSE](LICENSE)

---

Built by [SprayberryLabs](https://github.com/SprayberryLabs) · [askalf.org](https://askalf.org) · [support@askalf.org](mailto:support@askalf.org)
