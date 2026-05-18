<div align="center">

## Local-first LLM infrastructure.

</div>

---

| Project | What it does | |
|---------|-------------|---|
| **[dario](https://github.com/askalf/dario)** | A universal LLM router. One local endpoint, every provider — OpenAI, Groq, OpenRouter, Ollama, Claude subscriptions, any OpenAI-compat URL. Your tools point here and stop caring which vendor is upstream. | [![npm](https://img.shields.io/npm/v/@askalf/dario?logo=npm&logoColor=white&label=npm&color=00ff88&style=flat-square)](https://www.npmjs.com/package/@askalf/dario) |
| **[arnie](https://github.com/askalf/arnie)** | An IT troubleshooting companion for the terminal. Claude Code's tool grammar, specialized for diagnosing and fixing real issues — networking, AD, Windows Update, log triage, registry, firewall, services, processes, hardware. Confirm-gated mutations, dry-run, plan mode. Routes through dario to keep subscription billing. | [![npm](https://img.shields.io/npm/v/arnie-cli?logo=npm&logoColor=white&label=npm&color=00ff88&style=flat-square)](https://www.npmjs.com/package/arnie-cli) |
| **[hands](https://github.com/askalf/hands)** | A computer-use agent. Natural language → your mouse, keyboard, and screen. Drives the OS through its native shell (PowerShell / AppleScript / xdotool) for speed, screenshot tool for visual verification, optional voice pipeline. Routes through dario or any Anthropic-compat endpoint to keep subscription billing. | [![npm](https://img.shields.io/npm/v/@askalf/hands?logo=npm&logoColor=white&label=npm&color=00ff88&style=flat-square)](https://www.npmjs.com/package/@askalf/hands) |
| **[deepdive](https://github.com/askalf/deepdive)** | A local research agent. One command, cited answer — plan, search, read, iterate with a critic loop, synthesize. Routes LLM calls through dario so deep research runs on your own subscription. | [![npm](https://img.shields.io/npm/v/@askalf/deepdive?logo=npm&logoColor=white&label=npm&color=00ff88&style=flat-square)](https://www.npmjs.com/package/@askalf/deepdive) |

---

#### Open-source building blocks

| Project | What it does | |
|---------|-------------|---|
| **[pgflex](https://github.com/askalf/pgflex)** | One Postgres API, two backends. Real PostgreSQL via pg in production, PGlite (in-process WASM) in standalone / dev. Same SQL, same query shape — drop the server when you don't need it. | [![npm](https://img.shields.io/npm/v/@askalf/pgflex?logo=npm&logoColor=white&label=npm&color=00ff88&style=flat-square)](https://www.npmjs.com/package/@askalf/pgflex) |
| **[redisflex](https://github.com/askalf/redisflex)** | One Redis API, two backends. ioredis in production, in-process Map + EventEmitter in dev. Plus a BullMQ-shaped in-memory queue so you can drop the Redis dep entirely for queueing too. | [![npm](https://img.shields.io/npm/v/@askalf/redisflex?logo=npm&logoColor=white&label=npm&color=00ff88&style=flat-square)](https://www.npmjs.com/package/@askalf/redisflex) |
| **[browser-bridge](https://github.com/askalf/browser-bridge)** | Stealth headless Chromium in a container, exposing CDP on port 9222. Plug Playwright, Puppeteer, or any MCP browser tool into one shared remote browser instead of bundling Chromium into every client. | [![GHCR](https://img.shields.io/badge/ghcr-browser--bridge-00ff88?style=flat-square)](https://github.com/askalf/browser-bridge/pkgs/container/browser-bridge) |
| **[git-providers](https://github.com/askalf/git-providers)** | One GitProvider interface for GitHub + GitLab + Bitbucket Cloud — user info, repos, branches, OAuth config. Plus a 44-entry api-key-provider taxonomy for cloud / CI / PM / monitoring / e-commerce / marketing / social vendors. Zero runtime deps. | [![npm](https://img.shields.io/npm/v/@askalf/git-providers?logo=npm&logoColor=white&label=npm&color=00ff88&style=flat-square)](https://www.npmjs.com/package/@askalf/git-providers) |
| **[install-kit](https://github.com/askalf/install-kit)** | A curl-pipe-bash template for self-hosted Docker apps. Banner, prerequisite probes, .env scaffolding with crypto-rand secrets, healthcheck wait loop, browser auto-open. Fork it, edit a handful of CONFIGURE blocks, ship a one-line installer for your own project. | [![template](https://img.shields.io/badge/use-template-00ff88?style=flat-square)](https://github.com/askalf/install-kit/generate) |

---

<div align="center">

**[@ask_alf](https://x.com/ask_alf)**

</div>
