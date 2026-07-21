![Own Your Agent Security · Own Your Stack](banner.png)

Two banners fly here. **Own Your Agent Security** — govern what your agents are allowed to *do*. **Own Your Stack** — own the AI infrastructure they run on instead of renting it by the token. Related, but not the same question — and each gets its own answer.

## Own Your Agent Security

**Don't trust agents by default.** A firewall for every agent tool call, a supply-chain gate for every skill, leases instead of raw keys, a governed browser between the agent and the open web — one layered defense, running in production here.

| | | |
|---|---|---|
| **[redstamp](https://github.com/askalf/redstamp)** | **own your agent security** — a firewall for every agent tool call: blocks RCE, secret-exfil, SSRF, and prompt-injection / poisoned MCP tools, with a tamper-evident audit | [![stars](https://img.shields.io/github/stars/askalf/redstamp?logo=github&label=&color=b5372a&style=flat-square)](https://github.com/askalf/redstamp) |
| **[truecopy](https://github.com/askalf/truecopy)** | **own your agent skills** — vet, sign & pin every skill & MCP server before it runs; drift detection catches a poisoned or silently-updated tool before it ever loads | [![stars](https://img.shields.io/github/stars/askalf/truecopy?logo=github&label=&color=b5372a&style=flat-square)](https://github.com/askalf/truecopy) |
| **[strongroom](https://github.com/askalf/strongroom)** | **own your agent secrets** — an encrypted vault that hands agents scoped, short-lived, single-use leases instead of raw keys; the key never enters the agent's context, and every access is audited | [![stars](https://img.shields.io/github/stars/askalf/strongroom?logo=github&label=&color=b5372a&style=flat-square)](https://github.com/askalf/strongroom) |
| **[fieldpass](https://github.com/askalf/fieldpass)** | **own your agent browser** — a governed browser for agents: an indirect-prompt-injection firewall, an action gate, and an LLM judge between the agent and the open web, so a hostile page can't hijack the session | [![stars](https://img.shields.io/github/stars/askalf/fieldpass?logo=github&label=&color=b5372a&style=flat-square)](https://github.com/askalf/fieldpass) |

> **redstamp · truecopy · strongroom** compose into one layered defense → **[agent-security-stack](https://github.com/askalf/agent-security-stack)** — vet the tool, contain the call, give it a key it never holds.

## Own Your Stack

**One subscription. Your box. Your terms.** You were sold a meter — intelligence rented by the token, your data through someone else's pipes, your tools on someone else's roadmap and someone else's pricing meeting. I'm building the opposite: a stack you actually *own*. The open tools are the door; a real autonomous studio running in production is the proof — the unfinished parts included.

| | | |
|---|---|---|
| **[dario](https://github.com/askalf/dario)** | **own your routing** — one local endpoint that puts your Claude subscription behind Cursor, Cline, Aider, and the Agent SDK, with session-affinity routing and multi-account pooling that keep long agent runs stable | [![npm](https://img.shields.io/npm/v/@askalf/dario?logo=npm&logoColor=white&label=&color=b5372a&style=flat-square)](https://www.npmjs.com/package/@askalf/dario) |
| **[hybrid](https://github.com/askalf/hybrid)** | **own your inference** — local-first LLM routing: answer the easy majority on a small local model, escalate only the genuinely hard queries to the frontier; nothing paid or sent off your machine for the rest | [![stars](https://img.shields.io/github/stars/askalf/hybrid?logo=github&label=&color=b5372a&style=flat-square)](https://github.com/askalf/hybrid) |
| **[deepdive](https://github.com/askalf/deepdive)** | **own your research** — a local agent that plans, searches, reads, and synthesizes a cited answer, through your own router | [![npm](https://img.shields.io/npm/v/@askalf/deepdive?logo=npm&logoColor=white&label=&color=b5372a&style=flat-square)](https://www.npmjs.com/package/@askalf/deepdive) |
| **[hands](https://github.com/askalf/hands)** | **own your computer-use** — your LLM on your own mouse, keyboard, and screen, with an audit log of everything it does | [![npm](https://img.shields.io/npm/v/@askalf/hands?logo=npm&logoColor=white&label=&color=b5372a&style=flat-square)](https://www.npmjs.com/package/@askalf/hands) |
| **[cordon](https://github.com/askalf/cordon)** | **own your prompts** — a PII-redacting gateway that fails closed: strip or reversibly tokenize names, emails, and secrets before a prompt ever reaches a model, so your sensitive data never leaves your perimeter | [![stars](https://img.shields.io/github/stars/askalf/cordon?logo=github&label=&color=b5372a&style=flat-square)](https://github.com/askalf/cordon) |
| **[browser-bridge](https://github.com/askalf/browser-bridge)** | **own your browser** — stealth headless Chromium in a container, CDP on your own endpoint | [![ghcr](https://img.shields.io/badge/ghcr-pkg-b5372a?style=flat-square)](https://github.com/askalf/browser-bridge/pkgs/container/browser-bridge) |
| **[amnesia](https://github.com/askalf/amnesia)** | **own your search** — privacy-first metasearch, 155 engines at once, zero tracking, no AI, VPN-tunneled | [![live](https://img.shields.io/badge/live-amnesia.tax-b5372a?style=flat-square)](https://amnesia.tax) |
| **[askalf](https://askalf.org)** | **own your operation** — the AI operation that runs Sprayberry Labs on this exact stack: an orchestrator and twenty-plus specialist agents, one human approving what matters. Not a product — the register (the roster, the rules, the live minutes) is public | [the register →](https://askalf.org) |

More of the stack → **[ownyourstack.sprayberrylabs.com](https://ownyourstack.sprayberrylabs.com)**

## The receipts

[Sprayberry Labs](https://sprayberrylabs.com) is the software studio with one human on staff — and a lab in the literal sense: every claim above traces to a merged PR, a release, or a measured incident. The supply chain is scored in public, too: dario holds a [9.4/10 OpenSSF Scorecard](https://scorecard.dev/viewer/?uri=github.com/askalf/dario) and a [100% OpenSSF Best Practices badge](https://www.bestpractices.dev/projects/13638) — releases signed and SLSA-attested, npm published tokenless from CI. And not all of it is my own code: a Windows long-path fix I sent upstream to [huggingface_hub](https://github.com/huggingface/huggingface_hub/pull/4546) — the client library the Hugging Face stack is built on — was merged by the maintainer on the first pass. Some of the write-ups:

- **[We scanned the marketplace that started the poisoned-skills panic](https://sprayberrylabs.com/blog/the-marketplace-that-started-the-panic)** — all 66,541 ClawHub skills poison-scanned with truecopy: zero confirmed malicious, 813 deterministic alarms, every one checked and mapped
- **[The leaderboard I refused to build](https://sprayberrylabs.com/blog/the-leaderboard-i-refused-to-build)** — why an agent-firewall leaderboard would be a category error; a threat-model map instead, with redstamp's own benchmark numbers shown, misses included
- **[Auditing the skills supply chain](https://sprayberrylabs.com/blog/auditing-the-skills-supply-chain)** — truecopy run across 2,019 published Claude skills: what a real marketplace audit finds, and doesn't
- **[Zero raw credentials](https://sprayberrylabs.com/blog/keeper-zero-raw-credentials)** — migrating a live agent fleet from 132 inherited environment keys to strongroom leases, one seam at a time
- **[An injection firewall for the agentic browser](https://sprayberrylabs.com/blog/picket-governed-agentic-browser)** — why the lethal trifecta is structural, and how fieldpass gates it
- **[A self-healing release pipeline](https://sprayberrylabs.com/blog/dario-self-healing-release-pipeline)** — how dario ships, health-gates, and rolls itself back
- **Redstamp governing third-party frameworks** — [CrewAI](https://sprayberrylabs.com/blog/crewai-flowdef-under-askalf) · [LangGraph](https://sprayberrylabs.com/blog/langgraph-under-askalf) · [OpenAI Agents SDK](https://sprayberrylabs.com/blog/openai-agents-under-askalf) · [AutoGen](https://sprayberrylabs.com/blog/autogen-under-askalf), each with a runnable public example in [askalf/redstamp](https://github.com/askalf/redstamp/tree/master/examples)

Full engineering log → **[sprayberrylabs.com/blog](https://sprayberrylabs.com/blog)**

## Building it in the open

It's hard, and it's not finished — that's the point. The value isn't a demo; it's the scars from running agents in production for real. I write down what actually happens.

I'm **Thomas Sprayberry** — 20 years of engineering, from solo founders to Fortune 500. I run **[Sprayberry Labs](https://sprayberrylabs.com)**, the software studio with one human on staff: **[askalf](https://askalf.org)** — the AI operation built from the tools above — ships the code, reviews the pull requests, verifies the findings, and watches production. I architect, review, and sign everything that leaves the shop.

Portfolio → **[thomas.sprayberrylabs.com](https://thomas.sprayberrylabs.com)**

---

**[Own Your Stack](https://ownyourstack.sprayberrylabs.com)** · **[Own Your Agent Security](https://github.com/askalf/agent-security-stack)** · **[the operation](https://askalf.org)** · **[sprayberrylabs.com](https://sprayberrylabs.com)** · **[@ask_alf](https://x.com/ask_alf)** · **hello@sprayberrylabs.com**
