![Own Your Stack](banner.png)

Two banners fly here. **Own Your Agent Security** — govern what your agents are allowed to *do*. **Own Your Stack** — own the AI infrastructure they run on instead of renting it by the token. Related, but not the same question — and each gets its own answer.

## Own Your Agent Security

**Don't trust agents by default.** A firewall for every agent tool call, a supply-chain gate for every skill, leases instead of raw keys, a governed browser between the agent and the open web — one layered defense, running in production here.

| | | |
|---|---|---|
| **[warden](https://github.com/askalf/warden)** | **own your agent security** — a firewall for every agent tool call: blocks RCE, secret-exfil, SSRF, and prompt-injection / poisoned MCP tools, with a tamper-evident audit | [![stars](https://img.shields.io/github/stars/askalf/warden?logo=github&label=&color=8b5cf6&style=flat-square)](https://github.com/askalf/warden) |
| **[canon](https://github.com/askalf/canon)** | **own your agent skills** — vet, sign & pin every skill & MCP server before it runs; drift detection catches a poisoned or silently-updated tool before it ever loads | [![stars](https://img.shields.io/github/stars/askalf/canon?logo=github&label=&color=8b5cf6&style=flat-square)](https://github.com/askalf/canon) |
| **[keeper](https://github.com/askalf/keeper)** | **own your agent secrets** — an encrypted vault that hands agents scoped, short-lived, single-use leases instead of raw keys; the key never enters the agent's context, and every access is audited | [![stars](https://img.shields.io/github/stars/askalf/keeper?logo=github&label=&color=8b5cf6&style=flat-square)](https://github.com/askalf/keeper) |
| **[picket](https://github.com/askalf/picket)** | **own your agent browser** — a governed browser for agents: an indirect-prompt-injection firewall, an action gate, and an LLM judge between the agent and the open web, so a hostile page can't hijack the session | [![stars](https://img.shields.io/github/stars/askalf/picket?logo=github&label=&color=8b5cf6&style=flat-square)](https://github.com/askalf/picket) |

> **warden · canon · keeper** compose into one layered defense → **[agent-security-stack](https://github.com/askalf/agent-security-stack)** — vet the tool, contain the call, give it a key it never holds.

## Own Your Stack

**One subscription. Your box. Your terms.** You were sold a meter — intelligence rented by the token, your data through someone else's pipes, your tools on someone else's roadmap and someone else's pricing meeting. I'm building the opposite: a stack you actually *own*. The open tools are the door; a real autonomous studio running in production is the proof — the unfinished parts included.

| | | |
|---|---|---|
| **[dario](https://github.com/askalf/dario)** | **own your routing** — your Claude subscription in any tool (Cursor, Cline, Aider, the Agent SDK), at subscription pricing, not per-token bills | [![npm](https://img.shields.io/npm/v/@askalf/dario?logo=npm&logoColor=white&label=&color=8b5cf6&style=flat-square)](https://www.npmjs.com/package/@askalf/dario) |
| **[hybrid](https://github.com/askalf/hybrid)** | **own your inference** — local-first LLM routing: answer the easy majority on a small local model, escalate only the genuinely hard queries to the frontier; nothing paid or sent off your machine for the rest | [![stars](https://img.shields.io/github/stars/askalf/hybrid?logo=github&label=&color=8b5cf6&style=flat-square)](https://github.com/askalf/hybrid) |
| **[deepdive](https://github.com/askalf/deepdive)** | **own your research** — a local agent that plans, searches, reads, and synthesizes a cited answer, through your own router | [![npm](https://img.shields.io/npm/v/@askalf/deepdive?logo=npm&logoColor=white&label=&color=8b5cf6&style=flat-square)](https://www.npmjs.com/package/@askalf/deepdive) |
| **[hands](https://github.com/askalf/hands)** | **own your computer-use** — your LLM on your own mouse, keyboard, and screen, with an audit log of everything it does | [![npm](https://img.shields.io/npm/v/@askalf/hands?logo=npm&logoColor=white&label=&color=8b5cf6&style=flat-square)](https://www.npmjs.com/package/@askalf/hands) |
| **[cordon](https://github.com/askalf/cordon)** | **own your prompts** — a PII-redacting gateway that fails closed: strip or reversibly tokenize names, emails, and secrets before a prompt ever reaches a model, so your sensitive data never leaves your perimeter | [![stars](https://img.shields.io/github/stars/askalf/cordon?logo=github&label=&color=8b5cf6&style=flat-square)](https://github.com/askalf/cordon) |
| **[browser-bridge](https://github.com/askalf/browser-bridge)** | **own your browser** — stealth headless Chromium in a container, CDP on your own endpoint | [![ghcr](https://img.shields.io/badge/ghcr-pkg-8b5cf6?style=flat-square)](https://github.com/askalf/browser-bridge/pkgs/container/browser-bridge) |
| **[amnesia](https://github.com/askalf/amnesia)** | **own your search** — privacy-first metasearch, 155 engines at once, zero tracking, no AI, VPN-tunneled | [![live](https://img.shields.io/badge/live-amnesia.tax-8b5cf6?style=flat-square)](https://amnesia.tax) |
| **[askalf](https://askalf.org)** | **own your operation** — the self-hosted AI workforce platform the whole stack runs | early access |

More of the stack → **[ownyourstack.sprayberrylabs.com](https://ownyourstack.sprayberrylabs.com)**

## The receipts

[Sprayberry Labs](https://sprayberrylabs.com) is a research lab in the literal sense: every claim above traces to a merged PR, a release, or a measured incident. Some of the write-ups:

- **[The leaderboard I refused to build](https://sprayberrylabs.com/blog/the-leaderboard-i-refused-to-build)** — why an agent-firewall leaderboard would be a category error; a threat-model map instead, with warden's own benchmark numbers shown, misses included
- **[Auditing the skills supply chain](https://sprayberrylabs.com/blog/auditing-the-skills-supply-chain)** — canon run across 2,019 published Claude skills: what a real marketplace audit finds, and doesn't
- **[Zero raw credentials](https://sprayberrylabs.com/blog/keeper-zero-raw-credentials)** — migrating a live agent fleet from 132 inherited environment keys to keeper leases, one seam at a time
- **[An injection firewall for the agentic browser](https://sprayberrylabs.com/blog/picket-governed-agentic-browser)** — why the lethal trifecta is structural, and how picket gates it
- **[A self-healing release pipeline](https://sprayberrylabs.com/blog/dario-self-healing-release-pipeline)** — how dario ships, health-gates, and rolls itself back
- **Warden governing third-party frameworks** — [CrewAI](https://sprayberrylabs.com/blog/crewai-flowdef-under-askalf) · [LangGraph](https://sprayberrylabs.com/blog/langgraph-under-askalf) · [OpenAI Agents SDK](https://sprayberrylabs.com/blog/openai-agents-under-askalf) · [AutoGen](https://sprayberrylabs.com/blog/autogen-under-askalf), each with a runnable public example in [askalf/warden](https://github.com/askalf/warden/tree/master/examples)

Full engineering log → **[sprayberrylabs.com/blog](https://sprayberrylabs.com/blog)**

## Building it in the open

It's hard, and it's not finished — that's the point. The value isn't a demo; it's the scars from running agents in production for real. I write down what actually happens.

I'm **Thomas Sprayberry** — 20 years of engineering, from solo founders to Fortune 500. I run **[Sprayberry Labs](https://sprayberrylabs.com)**, a studio of one that moves at a team's pace because the workforce above does the heavy lifting while I architect, review, and own everything that ships.

Portfolio → **[thomas.sprayberrylabs.com](https://thomas.sprayberrylabs.com)**

---

**[Own Your Stack](https://ownyourstack.sprayberrylabs.com)** · **[Own Your Agent Security](https://github.com/askalf/agent-security-stack)** · **[sprayberrylabs.com](https://sprayberrylabs.com)** · **[@ask_alf](https://x.com/ask_alf)** · **hello@sprayberrylabs.com**
