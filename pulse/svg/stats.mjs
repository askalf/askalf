// The header's stat line as a badge: dario's stars, installs and releases,
// redrawn every hour. A source that fails shows its last good value from
// state.json, so a long outage leaves that stat at its cached number.
import { C, MONO, esc, n } from './kit.mjs';

const CW = 9.03, H = 36, PAD = 16, DOT = 18;

export function renderStats(d) {
  // Each stat is [value, unit]; a source with neither live nor cached data drops its stat.
  const stats = [];
  if (d.github) stats.push([n(d.github.darioStars), 'stars']);
  if (d.installs) stats.push([n(d.installs.last30), 'npm installs in 30 days']);
  if (d.dario) stats.push([n(d.dario.releaseCount), 'releases']);

  const parts = [['dario', C.pink]];
  for (const [value, unit] of stats) parts.push([' · ', C.faint], [value, C.text], [` ${unit}`, C.dim]);
  const chars = parts.reduce((s, [t]) => s + [...t].length, 0);
  const x0 = PAD + DOT;
  const w = Math.ceil(x0 + chars * CW + PAD);
  const title = ['dario', ...stats.map(([v, u]) => `${v} ${u}`)].join(' · ');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${H}" width="${w}" height="${H}" role="img" aria-labelledby="t">
<title id="t">${esc(title)}</title>
<style>
  text { font-family: ${MONO}; }
  .live { animation: live 1.6s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
  @keyframes live { 0%,100% { opacity: 1; transform: scale(1) } 50% { opacity: .35; transform: scale(.7) } }
  @media (prefers-reduced-motion: reduce) { * { animation: none !important } }
</style>
<defs><linearGradient id="edge" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${C.violet}" stop-opacity=".55"/><stop offset=".5" stop-color="${C.edge}"/><stop offset="1" stop-color="${C.magenta}" stop-opacity=".45"/></linearGradient></defs>
<rect x=".75" y=".75" width="${w - 1.5}" height="${H - 1.5}" rx="${H / 2 - 1}" fill="${C.panel}" stroke="url(#edge)" stroke-width="1.5"/>
<circle class="live" cx="${PAD + 4}" cy="${H / 2}" r="4" fill="${C.allow}"/>
<text x="${x0}" y="${H / 2 + 5}" font-size="15" xml:space="preserve">${parts.map(([t, fill]) => `<tspan fill="${fill}">${esc(t)}</tspan>`).join('')}</text>
</svg>
`;
}
