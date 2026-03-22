# Launch Posts — Ready to Publish

## Hacker News (Show HN)

**Title:** Show HN: AskAlf — Self-hosted AI workforce that runs 24/7

**URL:** https://github.com/askalf/askalf

**Comment (post immediately after submission):**

I built AskAlf because I was tired of babysitting one AI agent trying to do everything.

AskAlf is a self-hosted AI workforce. You tell Alf what you need — security scan, competitor research, infrastructure monitoring, customer review tracking, meal planning — and Alf creates specialized workers, puts them to work, and reports back. They coordinate autonomously, learn from every task, and get faster every day.

What happens while you're away: a Monitor detects a service at 91% memory, consults Alf's memory for past fixes, applies the solution. A Security Scanner finds 2 CVEs across 847 packages, a Patch Worker fixes them. A Researcher tracks your competitors and flags pricing changes. Total cost: ~$0.43.

Technical highlights:
- Dynamic worker creation from 109 templates across 16 categories
- 10-layer cognitive memory (semantic + episodic + procedural) with pgvector
- 109 skill templates + community library for sharing custom workers
- 16 communication channels (Slack, Discord, Telegram, WhatsApp, OpenClaw bridge)
- Embedded Claude CLI + OpenAI Codex terminals in the dashboard
- Optional VPN tunneling for all worker traffic

One-line install: `curl -fsSL https://get.askalf.org | bash`

Stack: TypeScript, Node 22, React 19, Fastify 5, PostgreSQL 17 + pgvector, Redis, Docker.

Discord: https://discord.gg/fENVZpdYcX

Happy to answer questions about the architecture. Full docs: https://github.com/askalf/askalf/blob/main/docs/ARCHITECTURE.md

---

## Reddit — r/selfhosted

**Title:** I built a self-hosted AI workforce that coordinates autonomously — AskAlf

**Body:**

After months of running single AI agents and manually shepherding them, I built AskAlf — an AI workforce platform. You tell Alf what you need, Alf creates specialized workers and puts them to work.

**What it does:** Alf dynamically creates the right specialist for any task — research, monitoring, security, content, support, finance, personal productivity. Workers coordinate through an autonomous ticket system. The memory system tracks outcomes and learns from every execution.

**Install:**
```
curl -fsSL https://get.askalf.org | bash
```

**What you get:**
- Dashboard with team visualization and Alf chat
- 109 worker templates across 16 categories (Personal, Marketing, Support, E-Commerce, Finance, and more)
- 26 built-in MCP tools (Docker, deploy, security scan, code analysis, etc.)
- 16 channels (Slack, Discord, Telegram, WhatsApp, and more)
- Persistent memory system with knowledge graph
- Embedded Claude CLI + OpenAI Codex terminals
- Community skills library — share and install custom worker templates
- Optional VPN tunneling via Gluetun

**Requirements:** Docker, 4GB RAM, one AI provider API key (Anthropic recommended).

**Cost:** ~$0.43/day for typical workloads. Built-in per-worker budgets.

GitHub: https://github.com/askalf/askalf
Docs: https://github.com/askalf/askalf/blob/main/docs/ARCHITECTURE.md
Website: https://askalf.org

Discord: https://discord.gg/fENVZpdYcX

MIT licensed. Happy to answer any questions.

---

## Reddit — r/LocalLLaMA

**Title:** Self-hosted AI workforce with persistent memory and autonomous coordination — AskAlf (open source)

**Body:**

Sharing AskAlf — an open-source multi-agent orchestration platform that runs on your own hardware.

Unlike single-agent tools, AskAlf dynamically creates specialized workers that coordinate through an autonomous system with a 10-layer cognitive memory (semantic + episodic + procedural memories stored in pgvector).

The system reviews its own knowledge, creates investigation tickets when it finds issues, dispatches them to the right worker, and tracks resolution. Memory consolidation strengthens useful patterns — the 100th security scan knows exactly where to look.

Currently uses Claude and OpenAI as providers. The architecture is model-agnostic — adding local model support (Ollama, vLLM) is on the roadmap.

Key tech: TypeScript, PostgreSQL + pgvector, Redis, Docker, MCP Protocol.

`curl -fsSL https://get.askalf.org | bash`

GitHub: https://github.com/askalf/askalf

---

## Reddit — r/devops

**Title:** Open-source AI workforce for automated ops — monitors infra, patches CVEs, resolves incidents autonomously

**Body:**

Built an open-source platform called AskAlf that creates specialized AI workers for ops tasks:

- **System Monitor** — continuous health checks, creates tickets on anomalies
- **Security Scanner** — dependency audits, vulnerability scanning, secret detection
- **Ops Worker** — Docker management, deploy ops, infrastructure fixes
- **Tester** — test execution, regression detection, validation

Workers coordinate through an autonomous ticket system — a Monitor detects high memory usage, creates a ticket, an Ops Worker claims it, checks past fixes in the knowledge graph, applies the solution.

Self-hosted, Docker Compose, one command to install. Optional VPN tunneling for all worker traffic.

`curl -fsSL https://get.askalf.org | bash`

GitHub: https://github.com/askalf/askalf

---

## X / Twitter (@ask_alf)

**Thread:**

1/ We just open-sourced AskAlf — a self-hosted AI workforce that runs 24/7.

Not one agent. A full team. Tell Alf what you need — Alf creates the right specialist and puts them to work.

curl -fsSL https://get.askalf.org | bash

2/ What Alf does while you're away:

A Monitor catches a service at 91% memory — fixes it.
A Security Scanner finds 2 CVEs — patches them.
A Researcher tracks competitors — flags changes.
A Writer generates your morning report.

Cost: $0.43.

3/ The memory system has 10 cognitive layers.

Semantic memory (what it knows)
Episodic memory (what happened)
Procedural memory (what works)
Knowledge graph (how things connect)

The 100th task is faster than the 1st.

4/ 109 templates. 16 categories. 16 channels. 26 MCP tools.

Personal, Marketing, Support, E-Commerce, Finance, Security, Research, and more.

Slack, Discord, Telegram, WhatsApp, OpenClaw bridge.

Community skills library — share your custom workers.

5/ TypeScript. PostgreSQL + pgvector. Redis. Docker.

Self-hosted. MIT licensed. Your data stays yours.

GitHub: github.com/askalf/askalf
Website: askalf.org

Discord: discord.gg/fENVZpdYcX

Star it. Fork it. Break it. Ship it.
