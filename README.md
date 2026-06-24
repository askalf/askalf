![Own Your Stack](banner.png)

# Own Your Stack

**Own your AI infrastructure instead of renting it by the token.** One subscription. Your box. Your terms.

You were sold a meter — intelligence rented by the token, your data through someone else's pipes, your tools on someone else's roadmap and someone else's pricing meeting. I'm building the opposite: a stack you actually *own*. The open tools are the door; a real autonomous studio running in production is the proof — the unfinished parts included.

## The stack

| | | |
|---|---|---|
| **[dario](https://github.com/askalf/dario)** | **own your routing** — your Claude subscription in any tool (Cursor, Cline, Aider, the Agent SDK), at subscription pricing, not per-token bills | [![npm](https://img.shields.io/npm/v/@askalf/dario?logo=npm&logoColor=white&label=&color=8b5cf6&style=flat-square)](https://www.npmjs.com/package/@askalf/dario) |
| **[hybrid](https://github.com/askalf/hybrid)** | **own your inference** — local-first LLM routing: answer the easy majority on a small local model, escalate only the genuinely hard queries to the frontier; nothing paid or sent off your machine for the rest | [![stars](https://img.shields.io/github/stars/askalf/hybrid?logo=github&label=&color=8b5cf6&style=flat-square)](https://github.com/askalf/hybrid) |
| **[deepdive](https://github.com/askalf/deepdive)** | **own your research** — a local agent that plans, searches, reads, and synthesizes a cited answer, through your own router | [![npm](https://img.shields.io/npm/v/@askalf/deepdive?logo=npm&logoColor=white&label=&color=8b5cf6&style=flat-square)](https://www.npmjs.com/package/@askalf/deepdive) |
| **[hands](https://github.com/askalf/hands)** | **own your computer-use** — your LLM on your own mouse, keyboard, and screen, with an audit log of everything it does | [![npm](https://img.shields.io/npm/v/@askalf/hands?logo=npm&logoColor=white&label=&color=8b5cf6&style=flat-square)](https://www.npmjs.com/package/@askalf/hands) |
| **[agent](https://github.com/askalf/agent)** | **own your fleet** — connect any device, run the shell or Claude Code tasks the fleet dispatches | [![npm](https://img.shields.io/npm/v/@askalf/agent?logo=npm&logoColor=white&label=&color=8b5cf6&style=flat-square)](https://www.npmjs.com/package/@askalf/agent) |
| **[warden](https://github.com/askalf/warden)** | **own your agent security** — a firewall for every agent tool call: blocks RCE, secret-exfil, SSRF, and prompt-injection / poisoned MCP tools, with a tamper-evident audit | [![stars](https://img.shields.io/github/stars/askalf/warden?logo=github&label=&color=8b5cf6&style=flat-square)](https://github.com/askalf/warden) |
| **[canon](https://github.com/askalf/canon)** | **own your agent skills** — vet, sign & pin every skill & MCP server before it runs; drift detection catches a poisoned or silently-updated tool before it ever loads | [![stars](https://img.shields.io/github/stars/askalf/canon?logo=github&label=&color=8b5cf6&style=flat-square)](https://github.com/askalf/canon) |
| **[keeper](https://github.com/askalf/keeper)** | **own your agent secrets** — an encrypted vault that hands agents scoped, short-lived, single-use leases instead of raw keys; the key never enters the agent's context, and every access is audited | [![stars](https://img.shields.io/github/stars/askalf/keeper?logo=github&label=&color=8b5cf6&style=flat-square)](https://github.com/askalf/keeper) |
| **[cordon](https://github.com/askalf/cordon)** | **own your prompts** — a PII-redacting gateway that fails closed: strip or reversibly tokenize names, emails, and secrets before a prompt ever reaches a model, so your sensitive data never leaves your perimeter | [![stars](https://img.shields.io/github/stars/askalf/cordon?logo=github&label=&color=8b5cf6&style=flat-square)](https://github.com/askalf/cordon) |
| **[picket](https://github.com/askalf/picket)** | **own your agent browser** — a governed browser for agents: an indirect-prompt-injection firewall, an action gate, and an LLM judge between the agent and the open web, so a hostile page can't hijack the session | [![stars](https://img.shields.io/github/stars/askalf/picket?logo=github&label=&color=8b5cf6&style=flat-square)](https://github.com/askalf/picket) |
| **[browser-bridge](https://github.com/askalf/browser-bridge)** | **own your browser** — stealth headless Chromium in a container, CDP on your own endpoint | [![ghcr](https://img.shields.io/badge/ghcr-pkg-8b5cf6?style=flat-square)](https://github.com/askalf/browser-bridge/pkgs/container/browser-bridge) |
| **[claude-sync](https://github.com/askalf/claude-sync)** | **own your sessions** — move Claude Code sessions across machines, byte-identical | [![npm](https://img.shields.io/npm/v/@askalf/claude-sync?logo=npm&logoColor=white&label=&color=8b5cf6&style=flat-square)](https://www.npmjs.com/package/@askalf/claude-sync) |
| **[claude-bridge](https://github.com/askalf/claude-bridge)** | **own your remote** — drive your Claude Code sessions from Discord: watch turns, approve actions with a button, stay in sync on the go — your agent on your phone, no SaaS in the middle | [![npm](https://img.shields.io/npm/v/@askalf/claude-bridge?logo=npm&logoColor=white&label=&color=8b5cf6&style=flat-square)](https://www.npmjs.com/package/@askalf/claude-bridge) |
| **[amnesia](https://github.com/askalf/amnesia)** | **own your search** — privacy-first metasearch, 155 engines at once, zero tracking, no AI, VPN-tunneled | [![live](https://img.shields.io/badge/live-amnesia.tax-8b5cf6?style=flat-square)](https://amnesia.tax) |
| **[pgflex](https://github.com/askalf/pgflex)** | **own your database** — one Postgres API, two modes: real PostgreSQL in production, or in-process PGlite for a standalone install with no database server to set up | [![npm](https://img.shields.io/npm/v/@askalf/pgflex?logo=npm&logoColor=white&label=&color=8b5cf6&style=flat-square)](https://www.npmjs.com/package/@askalf/pgflex) |
| **[redisflex](https://github.com/askalf/redisflex)** | **own your queue** — one Redis API, two modes: ioredis in production, an in-process stand-in and job queue with no server — the same standalone trick as pgflex, for cache and queues | [![npm](https://img.shields.io/npm/v/@askalf/redisflex?logo=npm&logoColor=white&label=&color=8b5cf6&style=flat-square)](https://www.npmjs.com/package/@askalf/redisflex) |
| **[askalf](https://askalf.org)** | **own your operation** — the self-hosted AI workforce platform the whole stack runs | early access |

> **warden · canon · keeper** compose into one layered defense → **[agent-security-stack](https://github.com/askalf/agent-security-stack)** — vet the tool, contain the call, give it a key it never holds.

More of the stack → **[sprayberrylabs.com/own-your-stack](https://sprayberrylabs.com/own-your-stack)**

## Building it in the open

It's hard, and it's not finished — that's the point. The value isn't a demo; it's the scars from running agents in production for real. I write down what actually happens.

I'm **Thomas Sprayberry** — 20 years of engineering, from solo founders to Fortune 500. I run **[Sprayberry Labs](https://sprayberrylabs.com)**, a studio of one that moves at a team's pace because the workforce above does the heavy lifting while I architect, review, and own everything that ships.

---

**[Own Your Stack](https://sprayberrylabs.com/own-your-stack)** · **[sprayberrylabs.com](https://sprayberrylabs.com)** · **[@ask_alf](https://x.com/ask_alf)** · **hello@sprayberrylabs.com**
