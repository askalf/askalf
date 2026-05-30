<div align="center">

# I ship bespoke software — with a workforce of AI agents I built.

**[Sprayberry Labs](https://sprayberrylabs.com)** — fixed-price **audits & builds**, delivered end-to-end.
The building blocks below are open-source and free to use. The platform that turns them into a working AI workforce is the studio's own — and it's how I deliver.

[![sprayberrylabs.com](https://img.shields.io/badge/sprayberrylabs.com-22d3ee?style=flat-square&logo=safari&logoColor=04181d)](https://sprayberrylabs.com)
[![@ask_alf](https://img.shields.io/badge/%40ask__alf-111111?style=flat-square&logo=x&logoColor=white)](https://x.com/ask_alf)

</div>

---

I'm **Thomas Sprayberry** — 20 years of engineering, from solo founders to Fortune 500. I run **[Sprayberry Labs](https://sprayberrylabs.com)**, a studio of one that moves at a team's pace: I built my own AI workforce to do the heavy lifting while I architect, review, and own everything that ships.

> **Have a codebase that needs an expert read, or something that needs building?**
> → **[sprayberrylabs.com](https://sprayberrylabs.com)** — fixed-price **Audits from $1,500**, build **Sprints**, and **retainers**. There's an AI on the site that answers anything before we talk.

These aren't demos — **[dario](https://github.com/askalf/dario)** has **200+ stars** and ships on npm, and the studio runs on this stack every day.

**Shipped with it:** **[amnesia.tax](https://amnesia.tax)** — a privacy-first metasearch engine. 155 engines at once, zero tracking, no AI, VPN-tunneled. *Search the web, remember nothing.*

---

## The open-source workforce

| Project | What it does | |
|---------|-------------|---|
| **[dario](https://github.com/askalf/dario)** | A universal LLM router. One local endpoint, every provider — OpenAI, Groq, OpenRouter, Ollama, Claude subscriptions, any OpenAI-compat URL. Your tools point here and stop caring which vendor is upstream. | [![npm](https://img.shields.io/npm/v/@askalf/dario?logo=npm&logoColor=white&label=npm&color=00ff88&style=flat-square)](https://www.npmjs.com/package/@askalf/dario) |
| **[hands](https://github.com/askalf/hands)** | A computer-use agent. Natural language → your mouse, keyboard, and screen. Drives the OS through its native shell (PowerShell / AppleScript / xdotool) for speed, screenshot tool for visual verification, optional voice pipeline. Routes through dario or any Anthropic-compat endpoint to keep subscription billing. | [![npm](https://img.shields.io/npm/v/@askalf/hands?logo=npm&logoColor=white&label=npm&color=00ff88&style=flat-square)](https://www.npmjs.com/package/@askalf/hands) |
| **[deepdive](https://github.com/askalf/deepdive)** | A local research agent. One command, cited answer — plan, search, read, iterate with a critic loop, synthesize. Routes LLM calls through dario so deep research runs on your own subscription. | [![npm](https://img.shields.io/npm/v/@askalf/deepdive?logo=npm&logoColor=white&label=npm&color=00ff88&style=flat-square)](https://www.npmjs.com/package/@askalf/deepdive) |
| **[agent](https://github.com/askalf/agent)** | Connect any device to your askalf fleet. A WebSocket connector that registers a machine — laptop, server, remote box — then runs the shell or Claude Code tasks the fleet dispatches and streams results back. Installs as a system service; Claude Code execution routes through dario. | [![npm](https://img.shields.io/npm/v/@askalf/agent?logo=npm&logoColor=white&label=npm&color=00ff88&style=flat-square)](https://www.npmjs.com/package/@askalf/agent) |

---

#### Open-source building blocks

| Project | What it does | |
|---------|-------------|---|
| **[pgflex](https://github.com/askalf/pgflex)** | One Postgres API, two backends. Real PostgreSQL via pg in production, PGlite (in-process WASM) in standalone / dev. Same SQL, same query shape — drop the server when you don't need it. | [![npm](https://img.shields.io/npm/v/@askalf/pgflex?logo=npm&logoColor=white&label=npm&color=00ff88&style=flat-square)](https://www.npmjs.com/package/@askalf/pgflex) |
| **[redisflex](https://github.com/askalf/redisflex)** | One Redis API, two backends. ioredis in production, in-process Map + EventEmitter in dev. Plus a BullMQ-shaped in-memory queue so you can drop the Redis dep entirely for queueing too. | [![npm](https://img.shields.io/npm/v/@askalf/redisflex?logo=npm&logoColor=white&label=npm&color=00ff88&style=flat-square)](https://www.npmjs.com/package/@askalf/redisflex) |
| **[browser-bridge](https://github.com/askalf/browser-bridge)** | Stealth headless Chromium in a container, exposing CDP on port 9222. Plug Playwright, Puppeteer, or any MCP browser tool into one shared remote browser instead of bundling Chromium into every client. | [![GHCR](https://img.shields.io/badge/ghcr-browser--bridge-00ff88?style=flat-square)](https://github.com/askalf/browser-bridge/pkgs/container/browser-bridge) |
| **[git-providers](https://github.com/askalf/git-providers)** | One GitProvider interface for GitHub + GitLab + Bitbucket Cloud — user info, repos, branches, OAuth config. Plus a 44-entry api-key-provider taxonomy across cloud / CI / PM / monitoring / commerce. Zero runtime deps. | [![npm](https://img.shields.io/npm/v/@askalf/git-providers?logo=npm&logoColor=white&label=npm&color=00ff88&style=flat-square)](https://www.npmjs.com/package/@askalf/git-providers) |
| **[claude-sync](https://github.com/askalf/claude-sync)** | Sync Claude Code sessions across machines. Pack a session into a portable .ccsync file, move it via Dropbox / iCloud / Syncthing / USB, unpack on the other side. Path-hash mismatches solved via git-remote-url as the canonical project key. Zero runtime deps. | [![npm](https://img.shields.io/npm/v/@askalf/claude-sync?logo=npm&logoColor=white&label=npm&color=00ff88&style=flat-square)](https://www.npmjs.com/package/@askalf/claude-sync) |
| **[install-kit](https://github.com/askalf/install-kit)** | A curl-pipe-bash template for self-hosted Docker apps. Banner, prerequisite probes, .env scaffolding with crypto-random secrets, healthcheck wait loop, browser auto-open. Fork it, edit a few CONFIGURE blocks, ship a one-line installer. | [![template](https://img.shields.io/badge/use-template-00ff88?style=flat-square)](https://github.com/askalf/install-kit/generate) |

---

<div align="center">

**[sprayberrylabs.com](https://sprayberrylabs.com)** · **[@ask_alf](https://x.com/ask_alf)** · **hello@sprayberrylabs.com**

</div>
