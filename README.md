<div align="center">

# AskAlf

### The First Self-Healing AI Workforce

Autonomous agents with a nervous system, immune system, and collective memory. They communicate, heal, learn overnight, and evolve through natural selection.

**Not a chatbot. An organism.**

[![Version](https://img.shields.io/badge/v2.9.9-00ff88?style=flat-square&label=version&labelColor=020612)](https://github.com/askalf/askalf/releases)
[![npm](https://img.shields.io/npm/v/@askalf/agent?style=flat-square&color=00ff88&label=agent&labelColor=020612)](https://www.npmjs.com/package/@askalf/agent)
[![License](https://img.shields.io/badge/MIT-00ff88?style=flat-square&label=license&labelColor=020612)](LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/askalf/askalf/ci.yml?style=flat-square&label=CI&labelColor=020612)](https://github.com/askalf/askalf/actions)
[![Discord](https://img.shields.io/badge/Join-00ff88?style=flat-square&label=discord&labelColor=020612)](https://discord.gg/fENVZpdYcX)

**[askalf.org](https://askalf.org)** · **[Demo](https://demo.askalf.org)** · **[Discord](https://discord.gg/fENVZpdYcX)** · **[@ask_alf](https://x.com/ask_alf)** · **[Changelog](CHANGELOG.md)**

</div>

---

## Get Started

### Standalone

```bash
npx create-askalf
```

One command. Runs in a single Node.js process with PGlite (in-process PostgreSQL) and in-memory cache. No Docker, no Postgres, no Redis. Just Node.js.

### Docker (Production)

```bash
curl -fsSL https://get.askalf.org | bash
```

Full stack: PostgreSQL + pgvector, Redis, Ollama, SearxNG. 6 core containers + 3 optional. Running at `localhost:3001` in 60 seconds.

---

## What Happens While You Sleep

```
10:49 PM  Watchdog     catches API response regression. Creates ticket.
10:51 PM  Builder      claims ticket. Traces root cause. Writes the fix.           $0.14
11:03 PM  Builder      Tests pass. Ticket resolved.                                12 min
11:14 PM  Security     scans dependencies. Finds 2 CVEs. Patches both.             $0.08
02:04 AM  Watchdog     Redis at 91%. Queries collective memory. Applies fix.       → 52%
02:30 AM  Fleet Chief  Dream Cycle. Replays 48 executions. Extracts 6 patterns.
04:30 AM  Fleet Chief  Rewrites Cost Optimizer prompt (underperforming).
06:47 AM  Watchdog     All clear. 8 agents, 18 executions, 8 hours.               $0.43
```

---

## The Organism

Six biological systems working together.

**Nervous System** — Agents signal each other in real time. Confidence, urgency, stuck status propagate across the fleet. Fleet Chief auto-intervenes on critical signals.

**Immune System** — When something breaks, agents form response teams. After fixing, antibodies prevent the same issue from recurring.

**Collective Memory** — Shared knowledge graph that grows with every execution. Agents query it for context before acting.

**Dream Cycles** — 2–6 AM: the fleet replays its day, extracts patterns, writes procedural memories, generates predictions.

**The Watcher** — Learns your daily patterns. Pre-runs tasks 30 minutes before you ask.

**Natural Selection** — Every agent scored on completion, cost, consistency, quality. Top performers promoted. Underperformers retrained. The fleet evolves itself.

---

## The Fleet

| Agent | Role | Model | Schedule |
|-------|------|-------|----------|
| Fleet Chief | Meta-Agent | Opus | 6hr |
| Builder | Engineer | Sonnet | On tickets |
| Watchdog | Monitor | Haiku | Hourly |
| Security Auditor | Security | Sonnet | 6hr |
| Cost Optimizer | Analyst | Haiku | 12hr |
| GitHub Manager | DevOps | Haiku | 2hr |
| Discord Manager | Community | Haiku | 2hr |
| Analytics Tracker | Metrics | Haiku | 6hr |
| KB Writer | Documentation | Haiku | 12hr |

Fleet Chief creates new agents when gaps are found. The fleet grows on its own.

---

## Try the Demo

**[demo.askalf.org](https://demo.askalf.org)** — Tell Alf what you need. Watch it design an agent team in real time.

---

## Any Industry

| | | | | |
|---|---|---|---|---|
| Software Dev | DevOps | Marketing | Support | E-Commerce |
| Research | Personal | Agency | Finance | Custom |

109 templates across 16 categories.

---

## Connect Any Device

```bash
npm i -g @askalf/agent
askalf-agent connect <key> --url ws://server:3005 --name prod-box --install
```

Installs as a service (systemd / launchd / Windows). Runs on boot. Auto-reconnect. See [@askalf/agent](https://www.npmjs.com/package/@askalf/agent).

---

## Under the Hood

| | |
|---|---|
| **Templates** | 109 across 16 categories |
| **Tools** | 70 MCP tools |
| **Channels** | 16 — Slack, Discord, Telegram, WhatsApp, Teams, Email, Twilio, and more |
| **Integrations** | 47 across 13 categories |
| **AI Models** | Claude, GPT, Gemini, Llama, Mistral, DeepSeek, Ollama — any OpenAI-compatible API |
| **Federation** | Cross-instance learning (opt-in) |

**Stack:** TypeScript · Node.js 22 · React 18 · Fastify 5 · PostgreSQL 17 · pgvector · Redis 8 · PGlite · Docker

---

## Why AskAlf

| | AskAlf | AutoGPT | CrewAI | Relevance AI | n8n |
|---|:---:|:---:|:---:|:---:|:---:|
| Open source + self-hosted | ✓ | ✓ | ✓ | ✗ | ✓ |
| Standalone (no infra needed) | ✓ | ✗ | ✗ | ✗ | ✗ |
| Autonomous 24/7 fleet | ✓ | ~ | ✗ | ~ | ~ |
| Agent-to-agent communication | ✓ | ✗ | ~ | ✗ | ✗ |
| Self-healing (immune system) | ✓ | ✗ | ✗ | ✗ | ✗ |
| Overnight learning (dream cycles) | ✓ | ✗ | ✗ | ✗ | ✗ |
| Collective memory / knowledge graph | ✓ | ✗ | ✗ | ✗ | ✗ |
| Natural selection / reputation | ✓ | ✗ | ✗ | ✗ | ✗ |
| 109 pre-built templates | ✓ | ✗ | ~ | ~ | ✓ |
| Remote device execution | ✓ | ✗ | ✗ | ✗ | ✗ |
| Any AI model (bring your own) | ✓ | ~ | ✓ | ✗ | ✓ |

---

## Releases

| Version | Name | Highlights |
|---------|------|-----------|
| **v2.9.9** | Natural Selection | Standalone mode, reputation economy, federation |
| **v2.9.5** | The Immune System | Self-healing response teams, antibodies |
| **v2.9.0** | The Nervous System | Agent-to-agent signals, collective memory |
| **v2.8.0** | Self-Evolving | Dream cycles, The Watcher, webhook triggers |
| **v2.7.0** | Autonomous Fleet | Fleet Chief, Builder, unified dispatcher |

See [CHANGELOG](CHANGELOG.md) for full history.

---

<div align="center">

**[askalf.org](https://askalf.org)** · **[Demo](https://demo.askalf.org)** · **[Discord](https://discord.gg/fENVZpdYcX)** · **[npm](https://www.npmjs.com/package/@askalf/agent)** · **[@ask_alf](https://x.com/ask_alf)**

MIT — [askalf.org](https://askalf.org)

</div>
