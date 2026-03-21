# Launch Posts — Ready to Publish

## Hacker News (Show HN)

**Title:** Show HN: AskAlf — Self-hosted AI agent fleet that works while you sleep

**URL:** https://github.com/askalf/askalf

**Comment (post immediately after submission):**

I built AskAlf because I was tired of babysitting one AI agent trying to do everything.

AskAlf is a self-hosted AI workforce. You tell Alf what you need — security scan, competitor research, infrastructure monitoring, customer review tracking — and Alf creates specialized workers, puts them to work, and reports back. They coordinate autonomously, learn from every task, and get faster every day.

What happens overnight: QA catches a regression, Backend Dev writes the fix, QA re-runs tests, Security patches 2 CVEs, Watchdog monitors Redis. Total cost: ~$0.43.

Technical highlights:
- Multi-agent orchestration with autonomous ticket dispatch
- 10-layer cognitive memory (semantic + episodic + procedural) with pgvector
- 28-package marketplace for community tools and skills
- 16 communication channels (Slack, Discord, Telegram, WhatsApp, OpenClaw bridge)
- Embedded Claude CLI + OpenAI Codex terminals in the dashboard
- Optional VPN tunneling for all agent traffic

One-line install: `curl -fsSL https://get.askalf.org | bash`

Stack: TypeScript, Node 22, React 19, Fastify 5, PostgreSQL 17 + pgvector, Redis, Docker.

Discord: https://discord.gg/fENVZpdYcX

Happy to answer questions about the architecture. Full docs: https://github.com/askalf/askalf/blob/main/docs/ARCHITECTURE.md

---

## Reddit — r/selfhosted

**Title:** I built a self-hosted AI agent fleet that coordinates autonomously — AskAlf

**Body:**

After months of running single AI agents and manually shepherding them, I built AskAlf — a platform where 7 specialized agents work together without supervision.

**What it does:** Backend Dev, Frontend Dev, QA, Security, Infra, Watchdog, and Writer agents coordinate through an autonomous ticket system. The brain creates investigation tickets, routes them to the right agent, tracks outcomes, and learns from every execution.

**Install:**
```
curl -fsSL https://get.askalf.org | bash
```

**What you get:**
- Mission control dashboard with fleet visualization
- 26 built-in MCP tools (Docker, deploy, security scan, code analysis, etc.)
- 28 marketplace packages (tools + skill templates)
- 16 channels (Slack, Discord, Telegram, WhatsApp, and more)
- Persistent memory system with knowledge graph
- Embedded Claude CLI + OpenAI Codex terminals
- Optional VPN tunneling via Gluetun

**Requirements:** Docker, 4GB RAM, one AI provider API key (Anthropic recommended).

**Cost:** ~$0.43/night for 18 agent executions. Built-in per-agent budgets.

GitHub: https://github.com/askalf/askalf
Docs: https://github.com/askalf/askalf/blob/main/docs/ARCHITECTURE.md
Website: https://askalf.org

Discord: https://discord.gg/fENVZpdYcX

MIT licensed. Happy to answer any questions.

---

## Reddit — r/LocalLLaMA

**Title:** Self-hosted multi-agent fleet with persistent memory and autonomous coordination — AskAlf (open source)

**Body:**

Sharing AskAlf — an open-source multi-agent orchestration platform that runs on your own hardware.

Unlike single-agent tools, AskAlf runs 7 specialized agents that coordinate through an autonomous brain with a 10-layer cognitive memory system (semantic + episodic + procedural memories stored in pgvector).

The brain reviews its own knowledge, creates investigation tickets when it finds issues, dispatches them to the right fleet agent, and tracks resolution. It consolidates memories overnight — the 100th security scan knows exactly where to look.

Currently uses Claude and OpenAI as providers. The architecture is model-agnostic — adding local model support (Ollama, vLLM) is on the roadmap.

Key tech: TypeScript, PostgreSQL + pgvector, Redis, Docker, MCP Protocol.

`curl -fsSL https://get.askalf.org | bash`

GitHub: https://github.com/askalf/askalf

---

## Reddit — r/devops

**Title:** Open-source AI agent fleet for automated ops — monitors infra, patches CVEs, resolves incidents autonomously

**Body:**

Built an open-source platform called AskAlf that runs specialized AI agents for DevOps tasks:

- **Watchdog** — scheduled health checks every 15 min, creates tickets on anomalies
- **Security** — dependency audits, vulnerability scanning, secret detection
- **Infra** — Docker management, deploy ops, infrastructure fixes
- **QA** — test execution, regression detection, code review

The agents coordinate through an autonomous ticket system — Watchdog detects high Redis memory, creates a ticket, Infra agent claims it, checks past fixes in the knowledge graph, applies the solution.

Self-hosted, Docker Compose, one command to install. Optional VPN tunneling for all agent traffic.

`curl -fsSL https://get.askalf.org | bash`

GitHub: https://github.com/askalf/askalf

---

## X / Twitter (@ask_alf)

**Thread:**

1/ We just open-sourced AskAlf — a self-hosted AI agent fleet that works while you sleep.

Not one agent. Seven. They coordinate, investigate, and fix things autonomously.

curl -fsSL https://get.askalf.org | bash

2/ What happens overnight:

10:49 PM — QA catches a regression
10:51 PM — Backend Dev traces and fixes it
11:14 PM — Security patches 2 CVEs
2:04 AM — Watchdog fixes Redis at 91%
6:47 AM — Fleet goes quiet. Cost: $0.43.

3/ The brain has a 10-layer cognitive memory system.

Semantic memory (what it knows)
Episodic memory (what happened)
Procedural memory (what works)
Knowledge graph (how things connect)

The 100th deploy is faster than the 1st.

4/ 28 marketplace packages. 16 channels. 26 MCP tools.

Slack, Discord, Telegram, WhatsApp, OpenClaw bridge.
Docker, deploy, security scan, code analysis, fleet coordination.

One-click install from the dashboard.

5/ TypeScript. PostgreSQL + pgvector. Redis. Docker.

Self-hosted. MIT licensed. Your data stays yours.

GitHub: github.com/askalf/askalf
Docs: ARCHITECTURE.md

Discord: discord.gg/fENVZpdYcX

Star it. Fork it. Break it. Ship it.
