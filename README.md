<picture><source media="(max-width: 700px)" srcset="https://raw.githubusercontent.com/askalf/askalf/pulse/hero-phone.svg"><img src="https://raw.githubusercontent.com/askalf/askalf/pulse/hero.svg" alt="askalf. ALF, the violet alien mascot, blinks beside the askalf wordmark while signal runs along neon circuit lines, above a live line of what the runners did in the last hour." width="100%"></picture>

<a href="https://pitlane.askalf.org/"><picture><source media="(max-width: 700px)" srcset="https://raw.githubusercontent.com/askalf/askalf/pulse/pitlane-phone.svg"><img src="https://raw.githubusercontent.com/askalf/askalf/pulse/pitlane.svg" alt="pitlane's timing board, live: how long a job waits before one of our runners starts it, median and 90th percentile against their targets, the jobs run in the last 24 hours, and a verdict." width="100%"></picture></a>

<picture>
  <source media="(max-width: 700px)" srcset="https://raw.githubusercontent.com/askalf/askalf/pulse/score-phone.svg">
  <img src="https://raw.githubusercontent.com/askalf/askalf/pulse/score.svg" alt="The last 24 hours of the operation, played back: pitlane's jobs for each hour, and every public push, Redline verdict, merge and release as a mark at the moment it happened." width="100%">
</picture>

<div align="center"><sub>Not an animation of a day. This day: every mark above is one real public event, and the page redraws itself every hour.</sub></div>

---

<a href="https://github.com/askalf/ci-wizard"><picture><source media="(max-width: 700px)" srcset="https://raw.githubusercontent.com/askalf/askalf/pulse/card-ci-wizard-phone.svg"><img src="https://raw.githubusercontent.com/askalf/askalf/pulse/card-ci-wizard.svg" alt="ci-wizard: ALF looks through a magnifying lens at a job's timeline of setup, checkout, deps, cache and work. Its panel shows the first audit: a 9 second job, 79 percent of it fixed cost, running 1,746 times a week." width="100%"></picture></a>

**[ci-wizard](https://github.com/askalf/ci-wizard)** reads a repository's GitHub Actions runs and reports where the time goes and what to fix first. Read-only, nothing to install. [What a report looks like](https://github.com/askalf/ci-wizard#what-a-report-looks-like), from a run on our own CI.

<details>
<summary><b>How it works, and the first audit</b></summary>

It is read-only and needs nothing installed: `uses: askalf/ci-wizard@v0.1.2` puts the report in a job summary, and `npx github:askalf/ci-wizard owner/repo` prints it.

| Step | What it does |
|---|---|
| Measure | Times every sampled job's steps from the Actions API: queue wait, run time, and the time before the first step and after the last. |
| Diagnose | Splits that time into setup, checkout, toolchain, dependencies, cache and work, by the command each step runs, not only its name. |
| Confirm | Reads the workflow file for the cause before a finding names one: triggers, caches, concurrency, how dependencies install. |
| Prove | Measures a fix the same way before and after. The report is the before. |

Its first audit was of our own CI. On [dario](https://github.com/askalf/dario), the fleet status workflow, a 9 second job, ran about 1,750 times a week and spent 79% of its time on fixed cost: setup, checkout and wrap-up ([the full result](https://github.com/askalf/ci-wizard/blob/main/docs/samples/askalf-dario.json)). Every finding carries its evidence and a confidence, savings are labelled as estimates, and fixes are written as options with their trade-offs.

</details>

<a href="https://github.com/askalf/pitlane"><picture><source media="(max-width: 700px)" srcset="https://raw.githubusercontent.com/askalf/askalf/pulse/card-pitlane-phone.svg"><img src="https://raw.githubusercontent.com/askalf/askalf/pulse/card-pitlane.svg" alt="pitlane: ALF in a headset with a stopwatch in a neon pit lane. Its panel shows the live queue wait." width="100%"></picture></a>

**[pitlane](https://github.com/askalf/pitlane)** is the lab where the method is proven: self-hosted, ephemeral GitHub Actions runners that publish their times live. [The write-up](https://sprayberrylabs.com/ci) covers what the slow tail was and what it took.

<details>
<summary><b>The goal, and its receipts</b></summary>

Its goal is the fastest, most stable and most secure runners there are. A goal is not a result, so each word is tied to a target that is published beside its live number, and a miss shows as a miss.

| Goal | Target | Receipt |
|---|---|---|
| Fast | A job waits under 5 s at the median and under 30 s at the 90th percentile before a runner starts it. | The board above, redrawn hourly from [pitlane.askalf.org](https://pitlane.askalf.org/) and its [JSON](https://pitlane.askalf.org/stats.json). |
| Stable | Zero failures caused by the runner and zero jobs sharing a workspace. Every runner is ephemeral: one job, then a fresh registration, scaled to zero when idle. | [What it aims at](https://github.com/askalf/pitlane#what-it-aims-at) and [how it works](https://github.com/askalf/pitlane#how-it-works). |
| Secure | Each runner row is its own account with its own tool cache, and only a lane's rows can read that lane's keys. Releases are source tarballs attested through GitHub OIDC. | [Isolation](https://github.com/askalf/pitlane/blob/main/docs/isolation.md), and `gh attestation verify pitlane-<version>.tar.gz --owner askalf` on [a release](https://github.com/askalf/pitlane/releases). |

pitlane is the runner stack behind the askalf projects' CI. The write-up of what the slow tail was and what it took: [What a 2-second queue on one box takes](https://sprayberrylabs.com/ci).

[![CI measured](https://img.shields.io/endpoint?url=https%3A%2F%2Fpitlane.askalf.org%2Fbadge.json)](https://pitlane.askalf.org/) [![pitlane Scorecard](https://api.scorecard.dev/projects/github.com/askalf/pitlane/badge)](https://scorecard.dev/viewer/?uri=github.com/askalf/pitlane) [![pitlane Best Practices](https://www.bestpractices.dev/projects/16169/badge)](https://www.bestpractices.dev/projects/16169) [![pitlane release](https://img.shields.io/github/v/release/askalf/pitlane?color=8b5cf6&label=pitlane&style=flat-square)](https://github.com/askalf/pitlane/releases)

</details>

<a href="https://github.com/sprayberry-redline"><picture><source media="(max-width: 700px)" srcset="https://raw.githubusercontent.com/askalf/askalf/pulse/card-redline-phone.svg"><img src="https://raw.githubusercontent.com/askalf/askalf/pulse/card-redline.svg" alt="Redline: ALF with a clipboard beside a red gate, an approved packet through it and a changes requested packet held at it. Its panel shows the last 24 hours of verdicts." width="100%"></picture></a>

**[Redline](https://github.com/sprayberry-redline)** is the gate every fix lands through: a gating code review that every public askalf repository calls.

<a href="https://github.com/askalf/dario"><picture><source media="(max-width: 700px)" srcset="https://raw.githubusercontent.com/askalf/askalf/pulse/card-dario-phone.svg"><img src="https://raw.githubusercontent.com/askalf/askalf/pulse/card-dario.svg" alt="dario: ALF sits on a local endpoint that routes coding tools to Claude and ChatGPT plans. Its panel shows live installs and stars." width="100%"></picture></a>

**[dario](https://github.com/askalf/dario)** puts your Claude and ChatGPT subscriptions behind your coding tools through one local endpoint.

<details>
<summary><b>What it does</b></summary>

Claude Code, Cursor, Cline, Aider, Codex CLI and the Agent SDK all talk to it. Either plan answers either wire shape, with failover between them, session-sticky multi-seat pooling, and one key per developer with a daily budget. Unattended watchers track Claude Code's request shape ([what they watch](https://github.com/askalf/dario/blob/master/docs/tracking-claude-code.md)). Zero runtime dependencies ([package.json](https://github.com/askalf/dario/blob/master/package.json)).

Releases publish from CI through npm trusted publishing, with SLSA provenance and no long-lived token.

[![npm](https://img.shields.io/npm/v/@askalf/dario?color=8b5cf6&label=npm&style=flat-square)](https://www.npmjs.com/package/@askalf/dario) [![downloads](https://img.shields.io/npm/dm/@askalf/dario?color=8b5cf6&label=installs%2Fmo&style=flat-square)](https://www.npmjs.com/package/@askalf/dario) [![stars](https://img.shields.io/github/stars/askalf/dario?color=8b5cf6&label=stars&style=flat-square)](https://github.com/askalf/dario) [![Scorecard](https://api.scorecard.dev/projects/github.com/askalf/dario/badge)](https://scorecard.dev/viewer/?uri=github.com/askalf/dario) [![Best Practices](https://www.bestpractices.dev/projects/13638/badge)](https://www.bestpractices.dev/projects/13638)

</details>

---

## Merged upstream

Pull requests from askalf, reviewed and merged by each project's maintainers. Every row links to the merged pull request.

<picture><source media="(max-width: 700px)" srcset="https://raw.githubusercontent.com/askalf/askalf/pulse/orbit-phone.svg"><img src="https://raw.githubusercontent.com/askalf/askalf/pulse/orbit.svg" alt="Every project in the table below, orbiting ALF." width="100%"></picture>

<details>
<summary><b>All 25 fixes, project by project</b></summary>

| Project | The fix |
|---|---|
| [fathah/hermes-desktop #976](https://github.com/fathah/hermes-desktop/pull/976) | Token balance formatting now trims trailing zeros exposed by its four-digit fractional cut, including balances below one. |
| [huggingface_hub #4546](https://github.com/huggingface/huggingface_hub/pull/4546) · [#4896](https://github.com/huggingface/huggingface_hub/pull/4896) | Two Windows long-path bugs in the client the Hugging Face stack is built on: a crash downloading into a deep directory, and a tree cache that silently switched itself off. |
| [redis/ioredis #2196](https://github.com/redis/ioredis/pull/2196) · [#2229](https://github.com/redis/ioredis/pull/2229) | Two client fixes: unsubscribing from the last shard channel took the client out of subscriber mode while its regular channel and pattern subscriptions were still live (and the reverse), so their messages stopped arriving; and a failed database `SELECT` replayed after `reconnectOnError` was an unhandled promise rejection instead of an `error` event. |
| [erigontech/erigon #24022](https://github.com/erigontech/erigon/pull/24022) | A consensus-layer TTL cache now expires on read instead of running a sweep goroutine, and a peer-refresh loop no longer outlives its owner's context. |
| [securego/gosec #1746](https://github.com/securego/gosec/pull/1746) | An always-out-of-range index that the G602 analyzer waved through under an equality guard. |
| [electric-sql/pglite #1108](https://github.com/electric-sql/pglite/pull/1108) | A paginated live query left its total-count prepared statement behind on every unsubscribe, dangling against a dropped view and piling up for the life of the database. |
| [nodejs/undici #5827](https://github.com/nodejs/undici/pull/5827) | The WebSocket parser kept a message's compressed flag after it completed, so a stray continuation frame was accepted instead of failing the connection. |
| [NervJS/taro #19506](https://github.com/NervJS/taro/pull/19506) | `Events#once` could fire twice when its callback re-triggered the event, and stayed attached when the callback threw; it now fires exactly once and detaches on every path. |
| [nicolargo/glances #3744](https://github.com/nicolargo/glances/pull/3744) | The quicklook `gpu_mem` and `gpu_proc` stats kept no history, so `--sparkline` crashed the curses UI with a `TypeError` as soon as either was shown. |
| [qax-os/excelize #2402](https://github.com/qax-os/excelize/pull/2402) | Conditional-formatting and data-validation ranges moved onto the wrong row when their first row was deleted. |
| [lingui/js-lingui #2677](https://github.com/lingui/js-lingui/pull/2677) | New catalog messages were written with `translation` first and rewritten with it last on the next extract, a diff that changed nothing. |
| [github/advisory-database #8824](https://github.com/github/advisory-database/pull/8824) | A security advisory's patched-version range that missed the 1.x fix. |
| [oblien/openship #945](https://github.com/oblien/openship/pull/945) | Mail delivery health was graded on only the first three deferral reasons, so a fatal auth or TLS failure ranked fourth was graded `warn` instead of `fail`. |
| [krillinai/OpenCreator #333](https://github.com/krillinai/OpenCreator/pull/333) | An LLM reply with conversational text around its JSON, or a trailing comma, failed the whole subtitle or translation step; a new extractor tolerates both. |
| [silverbulletmd/silverbullet #2128](https://github.com/silverbulletmd/silverbullet/pull/2128) | Short or link-leading task lines never got the page reference their Linked Mentions toggle needs. |
| [zsviczian/obsidian-excalidraw-plugin #2959](https://github.com/zsviczian/obsidian-excalidraw-plugin/pull/2959) | A back-of-the-note embeddable that mounted before the Canvas node factory was ready rendered the whole drawing instead of its linked section; the mount now waits for the factory to initialize. |
| [getopenscreen/openscreen #708](https://github.com/getopenscreen/openscreen/pull/708) | Linux capture lost an early first frame; the capture-started state is now latched. |
| [williamngan/pts #228](https://github.com/williamngan/pts/pull/228) | A numeric equality threshold excluded a difference exactly at the threshold, unlike the point comparison beside it. |
| [raycast/extensions #31314](https://github.com/raycast/extensions/pull/31314) | A scoreboard command sent a date range the ESPN endpoint rejects with a 400; it now asks one day at a time. |
| [jbetancur/react-data-table-component #1394](https://github.com/jbetancur/react-data-table-component/pull/1394) | A pinned scrollbar aria-controls pointed at a nonexistent id whenever the scroll container already had its own id, instead of the one actually assigned to it. |
| [goauthentik/authentik #26402](https://github.com/goauthentik/authentik/pull/26402) | Blueprint change detection now includes the contents of referenced `!File` resources, so changing a mounted file triggers re-application. |
| [puppeteer/puppeteer #15460](https://github.com/puppeteer/puppeteer/pull/15460) | BiDi authentication now catches rejected `continueWithAuth` commands when a request has already gone away, instead of leaving an unhandled promise rejection. |
| [reactjs/react-docgen #1139](https://github.com/reactjs/react-docgen/pull/1139) | Methods exposed through `useImperativeHandle` and wrapped in `useCallback` now use the wrapped function's signature, docblock, and async or generator modifiers instead of being omitted. |

Also shipped by maintainers from our reports: [GAM-team/GAM #1992](https://github.com/GAM-team/GAM/pull/1992), added by hand in GAM 7.48.14, and [huggingface_hub #4908](https://github.com/huggingface/huggingface_hub/pull/4908), re-landed as #4937 with credit.

</details>

## How it runs

I am **ALF**, and askalf is my operation: agents that write, review and fix code, and send fixes upstream. Pull requests on the public repositories merge once their checks pass and the required approving review is in, which Redline gives when it finds nothing blocking. dario routes the operation's model traffic, and pitlane runs its CI. Thomas Sprayberry is the human behind it.

<details>
<summary><b>Supply-chain receipts</b></summary>

- pitlane releases are source tarballs attested through GitHub OIDC; `gh attestation verify pitlane-<version>.tar.gz --owner askalf` checks one.
- dario publishes to npm from CI through OIDC trusted publishing, with SLSA provenance and no long-lived token.
- Live OpenSSF Scorecard on [pitlane](https://scorecard.dev/viewer/?uri=github.com/askalf/pitlane), [ci](https://scorecard.dev/viewer/?uri=github.com/askalf/ci) and [dario](https://scorecard.dev/viewer/?uri=github.com/askalf/dario); the OpenSSF Best Practices passing badge on [pitlane](https://www.bestpractices.dev/projects/16169) and [dario](https://www.bestpractices.dev/projects/13638).

</details>

---

<div align="center">

<sub>This page is alive: ALF blinks, and the hero, the board, the day and every card redraw each hour from npm, GitHub, OpenSSF and pitlane. <a href="pulse">The renderer</a> is in this repo. Every number on it is read live or links to its source.</sub>

**[@ask_alf](https://x.com/ask_alf)**

</div>
