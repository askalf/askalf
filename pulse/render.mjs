#!/usr/bin/env node
// Draws the profile's live panels.
//
//   node pulse/render.mjs --out <dir>   gather live data, write the panels + state.json
//
// Zero dependencies. The scheduled workflow runs the first form and publishes
// <dir> to the `pulse` branch, which the README links to.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gather } from './data.mjs';
import { readState } from './state.mjs';
import { renderHero } from './svg/hero.mjs';
import { renderConsole } from './svg/console.mjs';
import { renderHeartbeat } from './svg/heartbeat.mjs';
import { renderOrbit } from './svg/orbit.mjs';
import { renderGate } from './svg/gate.mjs';
import { renderSignal } from './svg/signal.mjs';
import { renderStats } from './svg/stats.mjs';
import { renderPitlane } from './svg/pitlane.mjs';
import { renderScore } from './svg/score.mjs';
import { renderCards } from './svg/cards.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const args = process.argv.slice(2);

const out = args[args.indexOf('--out') + 1];
if (!args.includes('--out') || !out) {
  console.error('usage: render.mjs --out <dir>');
  process.exit(2);
}
mkdirSync(out, { recursive: true });
const statePath = join(out, 'state.json');
const previous = readState(statePath);

const d = await gather({ previous, readmePath: join(root, 'README.md') });
for (const [k, v] of Object.entries(d.sources)) console.log(`${k.padEnd(9)} ${v}`);

const panels = {
  'stats.svg': renderStats(d),
  'console.svg': renderConsole(d),
  'heartbeat.svg': renderHeartbeat(d),
  'orbit.svg': renderOrbit(d, { alfPath: join(here, 'alf.jpg') }),
  'orbit-phone.svg': renderOrbit(d, { alfPath: join(here, 'alf.jpg'), phone: true }),
  'gate.svg': renderGate(),
  'signal.svg': renderSignal(d),
  'pitlane.svg': renderPitlane(d),
  'pitlane-phone.svg': renderPitlane(d, { phone: true }),
  'score.svg': renderScore(d),
  'score-phone.svg': renderScore(d, { phone: true }),
  'hero.svg': renderHero({ heroPath: join(root, 'hero.jpg'), d }),
  'hero-phone.svg': renderHero({ heroPath: join(root, 'hero.jpg'), d, phone: true }),
  ...renderCards(d, join(root, 'cards')),
};
for (const [name, svg] of Object.entries(panels)) writeFileSync(join(out, name), svg);
writeFileSync(statePath, JSON.stringify(d, null, 1) + '\n');
console.log(`wrote ${Object.keys(panels).length} panels to ${out}`);
