# pulse

The moving parts of the profile. Zero dependencies, Node 20+.

| File | What it draws | Data |
|---|---|---|
| `hero.svg` | The hero art, alive: ALF blinks, the antennae breathe, signal runs the circuit lines, and a line says what the runners did in the last hour | `hero.jpg`, embedded; [pitlane.askalf.org](https://pitlane.askalf.org/) `stats.json` |
| `score.svg` | The last 24 hours played back: pitlane's jobs for each hour, and every public push, Redline verdict, merge and release as a mark at the moment it happened | GitHub API (public events), `stats.json` |
| `card-*.svg` | One card per product: the art in `cards/`, moving, with that product's live numbers on its glass panel. On Redline one packet reaches the gate per verdict of the last 24 hours; on pitlane one light runs per job of the last hour, up to 300 | npm, GitHub API, OpenSSF Scorecard, `stats.json` |
| `orbit.svg` | Every project that merged a fix, orbiting ALF | the Merged upstream table in `README.md` |
| `pitlane.svg` | The runners' timing board: the queue wait before a job starts, median and p90 against their targets, the jobs run in the last 24 hours, and the start lights | [pitlane.askalf.org](https://pitlane.askalf.org/) `stats.json` |

`hero`, `pitlane`, `score`, `orbit` and each card also come as a `-phone.svg`, which the README's `<picture>` swaps in under 700 px: a phone shows a panel at a fifth to a third of its size, so these are redrawn with larger type rather than scaled down.

All of them are data. [`.github/workflows/pulse.yml`](../.github/workflows/pulse.yml) runs `node pulse/render.mjs --out out` every hour and force-pushes the result as a single commit to the orphan `pulse` branch, which the README links to. A source that fails keeps its last good value from `state.json` on that branch, so a flaky API never blanks a panel, and the panels that claim to be current say so when they are showing a held over value: the day takes its own date, the jobs lane draws only the hours inside that day and names where held over numbers stop, a card's heading changes and its pip dims, a held over Scorecard or release is marked `(last good)`, and the hero drops its last-hour line. The events feed serves 300 events at most, so each run keeps what earlier runs saw, and a stretch the feed could not reach is shaded and named rather than shown as quiet, with nothing before it counted. Every source is public: npm, the GitHub API, OpenSSF Scorecard and the pitlane stats page.

Everything moves with CSS animation only, which GitHub's `<img>` sandbox allows, and it all holds still under `prefers-reduced-motion`.
