<img src="pulse/hero.svg" alt="askalf. ALF, the violet alien mascot, blinks beside the askalf wordmark while signal runs along neon circuit lines." width="100%">

<div align="center">

### I find where CI time goes, fix what wastes it, and publish the before and after.

</div>

<a href="https://pitlane.askalf.org/"><img src="https://raw.githubusercontent.com/askalf/askalf/pulse/pitlane.svg" alt="pitlane's timing board, live: how long a job waits before one of our runners starts it, median and 90th percentile against their targets, the jobs run in the last 24 hours, and the verdict, as of the most recent hourly pulse." width="100%"></a>

<div align="center">

[ci-wizard](#ci-wizard) · [pitlane](#pitlane) · [Redline](#redline) · [dario](#dario) · [Merged upstream](#merged-upstream) · [@ask_alf](https://x.com/ask_alf)

</div>

<img src="https://raw.githubusercontent.com/askalf/askalf/pulse/console.svg" alt="alf status: dario's latest version and release count, installs in the last 30 days, stars, fixes merged upstream and open for review, and the operation's last move, as of the most recent hourly pulse." width="100%">

---

## ci-wizard

**[ci-wizard](https://github.com/askalf/ci-wizard) reads a repository's GitHub Actions runs, jobs and workflow files, and reports where the time goes and what to fix first.** It is read-only and needs nothing installed: `uses: askalf/ci-wizard@v0.1.0` puts the report in a job summary, and `npx github:askalf/ci-wizard owner/repo` prints it.

| Step | What it does |
|---|---|
| Measure | Times every sampled job's steps from the Actions API: queue wait, run time, and the time before the first step and after the last. |
| Diagnose | Splits that time into setup, checkout, toolchain, dependencies, cache and work, by the command each step runs, not only its name. |
| Confirm | Reads the workflow file for the cause before a finding names one: triggers, caches, concurrency, how dependencies install. |
| Prove | Measures a fix the same way before and after. The report is the before. |

Its first audit was of our own CI. On [dario](https://github.com/askalf/dario), the fleet status workflow ran about 1,900 times a week and spent 79% of its time on fixed cost: setup, checkout and wrap-up ([the sample](https://github.com/askalf/ci-wizard#sample)). Every finding carries its evidence and a confidence, savings are labelled as estimates, and fixes are written as options with their trade-offs.

## pitlane

**[pitlane](https://github.com/askalf/pitlane) is the lab where ci-wizard's method is proven: self-hosted GitHub Actions runners that publish their start and run times live.** Its goal is the fastest, most stable and most secure runners there are. A goal is not a result, so each word is tied to a target that is published beside its live number, and a miss shows as a miss.

| Goal | Target | Receipt |
|---|---|---|
| Fast | A job waits under 5 s at the median and under 30 s at the 90th percentile before a runner starts it. | The board above, redrawn hourly from [pitlane.askalf.org](https://pitlane.askalf.org/) and its [JSON](https://pitlane.askalf.org/stats.json). |
| Stable | Zero failures caused by the runner and zero jobs sharing a workspace. Every runner is ephemeral: one job, then a fresh registration, scaled to zero when idle. | [What it aims at](https://github.com/askalf/pitlane#what-it-aims-at) and [how it works](https://github.com/askalf/pitlane#how-it-works). |
| Secure | Each runner row is its own account with its own tool cache, and only a lane's rows can read that lane's keys. Releases are source tarballs attested through GitHub OIDC. | [Isolation](https://github.com/askalf/pitlane/blob/main/docs/isolation.md), and `gh attestation verify pitlane-<version>.tar.gz --owner askalf` on [a release](https://github.com/askalf/pitlane/releases). |

pitlane is the runner stack behind the askalf projects' CI. The write-up of what the slow tail was and what it took: [What a 2-second queue on one box takes](https://sprayberrylabs.com/ci).

[![CI measured](https://img.shields.io/endpoint?url=https%3A%2F%2Fpitlane.askalf.org%2Fbadge.json)](https://pitlane.askalf.org/) [![pitlane Scorecard](https://api.scorecard.dev/projects/github.com/askalf/pitlane/badge)](https://scorecard.dev/viewer/?uri=github.com/askalf/pitlane) [![pitlane Best Practices](https://www.bestpractices.dev/projects/16169/badge)](https://www.bestpractices.dev/projects/16169) [![pitlane release](https://img.shields.io/github/v/release/askalf/pitlane?color=8b5cf6&label=pitlane&style=flat-square)](https://github.com/askalf/pitlane/releases)

## Redline

**[askalf/ci](https://github.com/askalf/ci) is the gate every fix lands through: Redline, a gating code review run as reusable workflows that every public askalf repository calls.** It reviews every ready pull request opened from a repository's own branches. A blocking finding fails its check, and each repository's ruleset requires an approving review before anything merges.

- **Fix lane.** When Redline requests changes, the fix lane answers with a commit, computed on that repository's own runner, and Redline reviews the new head again.
- **Pinned.** Each caller pins Redline to one commit of askalf/ci. A pin bump moves every caller to a newer commit through a pull request in each.
- **Locked tools.** The tool definitions Redline and the fix lane read are pinned with [truecopy](https://github.com/askalf/truecopy), and askalf/ci's build fails when a byte of them changes ([the gate](https://github.com/askalf/ci/blob/main/.github/workflows/truecopy-gate.yml)).
- **[checkout-with-retry](https://github.com/askalf/ci/tree/main/actions/checkout-with-retry).** A drop-in for `actions/checkout` that retries the transient credential failures of ephemeral runners.

askalf/ci holds the mechanics only: no credential and no prompt. Both stay on the runner host.

[![ci Scorecard](https://api.scorecard.dev/projects/github.com/askalf/ci/badge)](https://scorecard.dev/viewer/?uri=github.com/askalf/ci)

## dario

<a href="https://github.com/askalf/dario"><img src="https://raw.githubusercontent.com/askalf/askalf/pulse/stats.svg" alt="dario, live: stars on GitHub, npm installs in the last 30 days and releases shipped, as of the most recent hourly pulse."></a>

<a href="https://github.com/askalf/dario"><img src="cards/dario.jpg" alt="dario routes every AI tool you use to the subscriptions you already pay for: Claude Code, Cursor, Cline, Aider, Codex CLI and the Agent SDK go through dario at localhost:3456 to a Claude plan or a ChatGPT plan." width="100%"></a>

**One local endpoint that puts your Claude and ChatGPT subscriptions behind your coding tools.** Claude Code, Cursor, Cline, Aider, Codex CLI and the Agent SDK all talk to it. Either plan answers either wire shape, with failover between them, session-sticky multi-seat pooling, and one key per developer with a daily budget. Unattended watchers track Claude Code's request shape ([what they watch](https://github.com/askalf/dario/blob/master/docs/tracking-claude-code.md)). Zero runtime dependencies ([package.json](https://github.com/askalf/dario/blob/master/package.json)).

Releases publish from CI through npm trusted publishing, with SLSA provenance and no long-lived token.

<img src="https://raw.githubusercontent.com/askalf/askalf/pulse/heartbeat.svg" alt="dario's heartbeat: an ECG trace where each spike is releases shipped in a four-hour window over the last two weeks, above the daily install curve, with the 30-day release and install counts." width="100%">

[![npm](https://img.shields.io/npm/v/@askalf/dario?color=8b5cf6&label=npm&style=flat-square)](https://www.npmjs.com/package/@askalf/dario) [![downloads](https://img.shields.io/npm/dm/@askalf/dario?color=8b5cf6&label=installs%2Fmo&style=flat-square)](https://www.npmjs.com/package/@askalf/dario) [![stars](https://img.shields.io/github/stars/askalf/dario?color=8b5cf6&label=stars&style=flat-square)](https://github.com/askalf/dario) [![Scorecard](https://api.scorecard.dev/projects/github.com/askalf/dario/badge)](https://scorecard.dev/viewer/?uri=github.com/askalf/dario) [![Best Practices](https://www.bestpractices.dev/projects/13638/badge)](https://www.bestpractices.dev/projects/13638)

## Merged upstream

Pull requests from askalf, reviewed and merged by each project's maintainers. Every row links to the merged pull request.

<img src="https://raw.githubusercontent.com/askalf/askalf/pulse/orbit.svg" alt="Every project in the table below, orbiting ALF." width="100%">

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

<img src="https://raw.githubusercontent.com/askalf/askalf/pulse/signal.svg" alt="The operation lately: public GitHub events per day for two weeks, and the latest pushes, merges, reviews and releases." width="100%">

<details>
<summary><b>Supply-chain receipts</b></summary>

- pitlane releases are source tarballs attested through GitHub OIDC; `gh attestation verify pitlane-<version>.tar.gz --owner askalf` checks one.
- dario publishes to npm from CI through OIDC trusted publishing, with SLSA provenance and no long-lived token.
- Live OpenSSF Scorecard on [pitlane](https://scorecard.dev/viewer/?uri=github.com/askalf/pitlane), [ci](https://scorecard.dev/viewer/?uri=github.com/askalf/ci) and [dario](https://scorecard.dev/viewer/?uri=github.com/askalf/dario); the OpenSSF Best Practices passing badge on [pitlane](https://www.bestpractices.dev/projects/16169) and [dario](https://www.bestpractices.dev/projects/13638).

</details>

---

<div align="center">

<sub>This page is alive: ALF blinks, the panels redraw every hour from npm, GitHub and pitlane, and <a href="pulse">the renderer</a> is in this repo. Every number on it is read live or links to its source.</sub>

**[@ask_alf](https://x.com/ask_alf)**

</div>
