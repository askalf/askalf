# pulse

The moving parts of the profile. Zero dependencies, Node 20+.

| File | What it draws | Data |
|---|---|---|
| `hero.svg` | The hero art, alive: ALF blinks, the antennae breathe, signal runs the circuit lines | `hero.jpg`, embedded |
| `console.svg` | `alf status --live` typing itself out | npm registry + downloads, GitHub API |
| `heartbeat.svg` | dario's ECG: each spike is releases shipped in a four-hour window | npm registry + downloads |
| `orbit.svg` | Every project that merged a fix, orbiting ALF | the Merged upstream table in `README.md` |
| `gate.svg` | redstamp's three verdicts and its hash-chained audit trail | illustrative |
| `signal.svg` | Public GitHub activity per day, and the latest moves | GitHub API |

`hero.svg` is static art and lives here on `main`; redraw it with `node pulse/render.mjs --hero` after changing `hero.jpg`.

The rest are data. [`.github/workflows/pulse.yml`](../.github/workflows/pulse.yml) runs `node pulse/render.mjs --out out` every hour and force-pushes the result as a single commit to the orphan `pulse` branch, which the README links to. A source that fails keeps its last good value from `state.json` on that branch, so a flaky API never blanks a panel.

Everything moves with CSS animation only, which GitHub's `<img>` sandbox allows, and it all holds still under `prefers-reduced-motion`.
