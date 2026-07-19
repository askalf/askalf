#!/usr/bin/env node
// Regenerates the dynamic README badges (GitHub stars, npm versions) as
// vendored SVGs so the profile renders without depending on shields.io.
// Geometry and text metrics replicate shields' flat-square output exactly
// (calibrated against shields-rendered SVGs, 2026-07-19).
// Static badges in badges/ (ghcr, live) are committed once and never touched.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'badges');
const COLOR = '#b5372a';

const STARS = ['redstamp', 'truecopy', 'strongroom', 'fieldpass', 'hybrid', 'cordon'];
const NPM = ['dario', 'deepdive', 'hands'];

const GITHUB_LOGO = 'data:image/svg+xml;base64,PHN2ZyBmaWxsPSJ3aGl0ZXNtb2tlIiByb2xlPSJpbWciIHZpZXdCb3g9IjAgMCAyNCAyNCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48dGl0bGU+R2l0SHViPC90aXRsZT48cGF0aCBkPSJNMTIgLjI5N2MtNi42MyAwLTEyIDUuMzczLTEyIDEyIDAgNS4zMDMgMy40MzggOS44IDguMjA1IDExLjM4NS42LjExMy44Mi0uMjU4LjgyLS41NzcgMC0uMjg1LS4wMS0xLjA0LS4wMTUtMi4wNC0zLjMzOC43MjQtNC4wNDItMS42MS00LjA0Mi0xLjYxQzQuNDIyIDE4LjA3IDMuNjMzIDE3LjcgMy42MzMgMTcuN2MtMS4wODctLjc0NC4wODQtLjcyOS4wODQtLjcyOSAxLjIwNS4wODQgMS44MzggMS4yMzYgMS44MzggMS4yMzYgMS4wNyAxLjgzNSAyLjgwOSAxLjMwNSAzLjQ5NS45OTguMTA4LS43NzYuNDE3LTEuMzA1Ljc2LTEuNjA1LTIuNjY1LS4zLTUuNDY2LTEuMzMyLTUuNDY2LTUuOTMgMC0xLjMxLjQ2NS0yLjM4IDEuMjM1LTMuMjItLjEzNS0uMzAzLS41NC0xLjUyMy4xMDUtMy4xNzYgMCAwIDEuMDA1LS4zMjIgMy4zIDEuMjMuOTYtLjI2NyAxLjk4LS4zOTkgMy0uNDA1IDEuMDIuMDA2IDIuMDQuMTM4IDMgLjQwNSAyLjI4LTEuNTUyIDMuMjg1LTEuMjMgMy4yODUtMS4yMy42NDUgMS42NTMuMjQgMi44NzMuMTIgMy4xNzYuNzY1Ljg0IDEuMjMgMS45MSAxLjIzIDMuMjIgMCA0LjYxLTIuODA1IDUuNjI1LTUuNDc1IDUuOTIuNDIuMzYuODEgMS4wOTYuODEgMi4yMiAwIDEuNjA2LS4wMTUgMi44OTYtLjAxNSAzLjI4NiAwIC4zMTUuMjEuNjkuODI1LjU3QzIwLjU2NSAyMi4wOTIgMjQgMTcuNTkyIDI0IDEyLjI5N2MwLTYuNjI3LTUuMzczLTEyLTEyLTEyIi8+PC9zdmc+';
const NPM_LOGO = 'data:image/svg+xml;base64,PHN2ZyBmaWxsPSJ3aGl0ZSIgcm9sZT0iaW1nIiB2aWV3Qm94PSIwIDAgMjQgMjQiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHRpdGxlPm5wbTwvdGl0bGU+PHBhdGggZD0iTTEuNzYzIDBDLjc4NiAwIDAgLjc4NiAwIDEuNzYzdjIwLjQ3NEMwIDIzLjIxNC43ODYgMjQgMS43NjMgMjRoMjAuNDc0Yy45NzcgMCAxLjc2My0uNzg2IDEuNzYzLTEuNzYzVjEuNzYzQzI0IC43ODYgMjMuMjE0IDAgMjIuMjM3IDB6TTUuMTMgNS4zMjNsMTMuODM3LjAxOS0uMDA5IDEzLjgzNmgtMy40NjRsLjAxLTEwLjM4MmgtMy40NTZMMTIuMDQgMTkuMTdINS4xMTN6Ii8+PC9zdmc+';

// Verdana 11px advance widths for every character these badges can contain
// (digits, '.', 'v', 'k'), matching shields' own textLength values.
const charW = (c) => (c === '.' ? 4 : 7);
const textW = (s) => [...s].reduce((w, c) => w + charW(c), 0);

const metric = (n) =>
  n < 1000 ? String(n) : (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';

const badge = (logo, msg) => {
  const tw = textW(msg);
  const w = 28 + tw; // 5 pad + 14 logo + 4 gap + text + 5 pad
  const x = (23 + tw / 2) * 10;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${msg}"><title>${msg}</title><g shape-rendering="crispEdges"><rect width="0" height="20" fill="#555"/><rect x="0" width="${w}" height="20" fill="${COLOR}"/></g><g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="110"><image x="5" y="3" width="14" height="14" href="${logo}"/><text x="${x}" y="140" textLength="${tw * 10}" transform="scale(.1)">${msg}</text></g></svg>`;
};

const ghHeaders = { 'User-Agent': 'askalf-badge-refresh' };
if (process.env.GITHUB_TOKEN) ghHeaders.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

let failures = 0;
const save = (name, svg) => {
  const file = join(OUT, `${name}.svg`);
  if (existsSync(file) && readFileSync(file, 'utf8') === svg) return;
  writeFileSync(file, svg);
  console.log(`updated ${name}.svg`);
};

mkdirSync(OUT, { recursive: true });

for (const repo of STARS) {
  try {
    const r = await fetch(`https://api.github.com/repos/askalf/${repo}`, { headers: ghHeaders });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const { stargazers_count } = await r.json();
    save(`${repo}-stars`, badge(GITHUB_LOGO, metric(stargazers_count)));
  } catch (e) {
    failures++;
    console.error(`stars ${repo}: ${e.message} — keeping existing badge`);
  }
}

for (const pkg of NPM) {
  try {
    const r = await fetch(`https://registry.npmjs.org/@askalf/${pkg}/latest`, {
      headers: { 'User-Agent': ghHeaders['User-Agent'] },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const { version } = await r.json();
    save(`${pkg}-npm`, badge(NPM_LOGO, `v${version}`));
  } catch (e) {
    failures++;
    console.error(`npm ${pkg}: ${e.message} — keeping existing badge`);
  }
}

// A fetch failure leaves the last good badge in place (stale beats broken);
// only fail the run when nothing could be refreshed at all.
if (failures === STARS.length + NPM.length) process.exit(1);
