<div align="center">

# AskAlf

### The First Self-Healing AI Workforce

Autonomous agents with a nervous system, immune system, and collective memory. Self-healing. Self-growing. Dream cycles that learn overnight. The Watcher predicts what you need before you ask.

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

Two ways to run. Zero excuses.

### Standalone — No Docker Needed

```bash
npx create-askalf
```

Runs the full platform in a single Node.js process. PGlite for the database (in-process PostgreSQL via WASM), in-memory cache, no external dependencies. Same features, same agents, same organism.

### Docker — Production Stack

```bash
curl -fsSL https://get.askalf.org | bash
```

6 core containers (+ 3 optional). PostgreSQL + pgvector, Redis, Ollama, SearxNG. Full production stack running at `localhost:3001` in 60 seconds.

### Desktop App (Coming Soon)

Tauri-based native app. Double-click install on Mac, Windows, Linux. System tray. Embeds the standalone server.

---

## What Happens While You Sleep

Your team runs 24/7. This is a real overnight cycle:

```
10:49 PM  Watchdog     catches a regression in API response times. Creates ticket.
10:51 PM  Builder      claims ticket, traces root cause, writes the fix.        $0.14
11:03 PM  Builder      Tests pass. Ticket resolved.                             12 min
11:14 PM  Security     scans 847 dependencies. Finds 2 CVEs. Patches both.      $0.08
01:15 AM  Builder      detects API contract break from the fix. Updates it.     $0.12
02:04 AM  Watchdog     flags Redis at 91%. Consults memory. Applies fix.        → 52%
02:30 AM  Fleet Chief  Dream Cycle starts. Replays 48 executions. 6 patterns.
03:12 AM  Fleet Chief  Creates antibody for Redis pattern. Writes memory.
04:30 AM  Fleet Chief  Rewrites Cost Optimizer prompt (underperforming).
06:47 AM  Watchdog     All clear. 6 agents, 18 executions, 8 hours.            $0.43
06:48 AM  ──           Next cycle begins. Alf briefs you when you check in.
```

---

## The Organism

Six biological systems. One living fleet.

### Nervous System `v2.9.0`
Agents communicate directly — request, inform, consult, signal, handoff. Confidence and urgency signals flow across the fleet in real time. Fleet Chief auto-intervenes on critical signals.

### Immune System `v2.9.5`
When something breaks, agents form response teams — like white blood cells converging on an infection. After fixing, **antibodies** prevent the same issue from ever happening again.

### Collective Memory `v2.9.0`
Every execution grows a shared knowledge graph. Concepts, patterns, decisions all linked. Agents query the graph for context before acting.

### Dream Cycles `v2.8.0`
2–6 AM: the fleet replays its day, extracts patterns, writes procedural memories, consolidates duplicates, generates predictions. Issues caught before they happen.

### The Watcher `v2.8.0`
Learns your daily patterns — when you check analytics, when you do releases, when you review costs. Pre-runs tasks 30 minutes before you ask.

### Natural Selection `v2.9.9`
Every agent scored on completion rate, cost efficiency, consistency, resolution quality. Top performers get promoted. Underperformers get retrained or replaced. The fleet evolves itself.

---

## The Fleet

Self-growing. Self-managing. Self-healing.

| Agent | Role | Model | Schedule | Rep |
|-------|------|-------|----------|-----|
| **Fleet Chief** | Meta-Agent | Sonnet | 6hr | 0.92 |
| **Builder** | Worker | Sonnet | Tickets | 0.83 |
| **Watchdog** | Monitor | Haiku | 30min | 0.84 |
| **Security** | Auditor | Sonnet | 6hr | 0.63 |
| **Cost Optimizer** | Analyst | Haiku | 12hr | 0.84 |
| **Backup Agent** | Ops | Haiku | Daily | 0.90 |
| + Discord, GitHub, Social, Analytics, and more | | | | ∞ |

Fleet Chief creates new agents when gaps are found. No hardcoded team — infinite growth.

---

## Talk to Alf

Tell Alf what you need in plain English. Alf designs the agent team, shows you the plan, and deploys it.

**Try it live:** [demo.askalf.org](https://demo.askalf.org)

---

## Any Industry. Any Task.

| | | | | |
|---|---|---|---|---|
| ⚙ Software Dev | ☁ DevOps | ☆ Marketing | ☎ Support | ⌂ E-Commerce |
| ⌘ Research | ♡ Personal | ⚒ Agency | ⚖ Finance | ★ Custom |

**109 templates** across 16 categories. Pre-built specialists ready in seconds.

---

## Connect Any Device

```bash
npm i -g @askalf/agent
askalf-agent connect <key> --url ws://server:3005 --name prod-box --install
```

Auto-detects OS. Installs as service (systemd / launchd / Windows). Runs on boot. Capabilities scan. See [@askalf/agent](https://www.npmjs.com/package/@askalf/agent).

---

## Under the Hood

| | |
|---|---|
| **Templates** | 109 across 16 categories |
| **Tools** | 70 (44 forge + 26 MCP) |
| **Channels** | 16 (Slack, Discord, Telegram, WhatsApp, Teams, Email, Twilio + 9 more) |
| **Integrations** | 47 across 13 categories |
| **AI Models** | Any — Claude, GPT, Gemini, Llama, Mistral, DeepSeek, Ollama, any OpenAI-compatible API |
| **Agents** | Self-growing fleet — Fleet Chief creates agents as needed |
| **Standalone** | PGlite (in-process Postgres) + in-memory Redis — no Docker required |
| **Desktop** | Tauri app — double-click install (coming soon) |
| **Federation** | Opt-in cross-instance learning |

### Tech Stack

```
TypeScript · Node.js 22 · React 18 · Fastify 5
PostgreSQL 17 · pgvector · Redis 8 · PGlite · Docker
```

---

## Why AskAlf

| | AskAlf | AutoGPT | CrewAI | ChatGPT | Claude |
|---|:---:|:---:|:---:|:---:|:---:|
| Self-hosted / data stays local | ✓ | ✓ | ✓ | ✗ | ✗ |
| No Docker required (standalone) | ✓ | ✗ | ✗ | ✗ | ✗ |
| Autonomous 24/7 fleet | ✓ | ~ | ✗ | ✗ | ✗ |
| Nervous system (agent-to-agent) | ✓ | ✗ | ✗ | ✗ | ✗ |
| Immune system / self-healing | ✓ | ✗ | ✗ | ✗ | ✗ |
| Dream cycles / overnight learning | ✓ | ✗ | ✗ | ✗ | ✗ |
| Collective memory / knowledge graph | ✓ | ✗ | ✗ | ~ | ~ |
| Self-growing fleet | ✓ | ✗ | ✗ | ✗ | ✗ |
| Natural selection & reputation | ✓ | ✗ | ✗ | ✗ | ✗ |
| 109 ready-to-use templates | ✓ | ✗ | ~ | ✗ | ✗ |
| Remote device execution | ✓ | ✗ | ✗ | ✗ | ~ |
| Desktop app | ✓ | ✗ | ✗ | ✓ | ✓ |

---

## Evolution

| Version | Name | What Changed |
|---------|------|-------------|
| **v2.9.9** | Natural Selection | Agent reputation, evolutionary pressure, federation handshake |
| **v2.9.5** | The Immune System | Self-healing response teams, antibodies, incident management |
| **v2.9.0** | The Nervous System | Agent-to-agent communication, collective memory, signals |
| **v2.8.0** | The Self-Evolving Release | Dream cycles, The Watcher, reputation, webhook triggers |
| **v2.7.0** | Autonomous Fleet | Fleet Chief, Builder, distributed execution |
| **v2.5.0** | Remote Execution | Device bridge, smart routing, agent CLI |
| **v2.1.0** | Launch | 109 templates, 16 channels, persistent memory |

See full [CHANGELOG](CHANGELOG.md).

---

<div align="center">

### v3.0 — Emergence

*The fleet is learning to create itself.*

**[askalf.org](https://askalf.org)** · **[Demo](https://demo.askalf.org)** · **[Discord](https://discord.gg/fENVZpdYcX)** · **[npm](https://www.npmjs.com/package/@askalf/agent)** · **[@ask_alf](https://x.com/ask_alf)**

MIT — [askalf.org](https://askalf.org)

</div>
