#!/usr/bin/env node
// Draws the profile's live panels.
//
//   node pulse/render.mjs --out <dir>   gather live data, write the panels + state.json
//   node pulse/render.mjs --hero        redraw pulse/hero.svg from hero.jpg (static art)
//
// Zero dependencies. The scheduled workflow runs the first form and publishes
// <dir> to the `pulse` branch, which the README links to.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gather } from './data.mjs';
import { renderHero } from './svg/hero.mjs';
import { renderConsole } from './svg/console.mjs';
import { renderHeartbeat } from './svg/heartbeat.mjs';
import { renderOrbit } from './svg/orbit.mjs';
import { renderGate } from './svg/gate.mjs';
import { renderSignal } from './svg/signal.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const args = process.argv.slice(2);

if (args.includes('--hero')) {
  writeFileSync(join(here, 'hero.svg'), renderHero({ heroPath: join(root, 'hero.jpg') }));
  console.log('wrote pulse/hero.svg');
  process.exit(0);
}

const out = args[args.indexOf('--out') + 1];
if (!args.includes('--out') || !out) {
  console.error('usage: render.mjs --out <dir> | --hero');
  process.exit(2);
}
mkdirSync(out, { recursive: true });
const statePath = join(out, 'state.json');
const previous = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : {};

const d = await gather({ previous, readmePath: join(root, 'README.md') });
for (const [k, v] of Object.entries(d.sources)) console.log(`${k.padEnd(9)} ${v}`);

const panels = {
  'console.svg': renderConsole(d),
  'heartbeat.svg': renderHeartbeat(d),
  'orbit.svg': renderOrbit(d, { alfPath: join(here, 'alf.jpg') }),
  'gate.svg': renderGate(d),
  'signal.svg': renderSignal(d),
};
for (const [name, svg] of Object.entries(panels)) writeFileSync(join(out, name), svg);
writeFileSync(statePath, JSON.stringify(d, null, 1) + '\n');
console.log(`wrote ${Object.keys(panels).length} panels to ${out}`);
