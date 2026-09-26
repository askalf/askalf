// Merged upstream as a small solar system: ALF at the center, and every
// project that merged a fix in orbit around it, drawn from the README table.
import { readFileSync } from 'node:fs';
import { C, esc, frame } from './kit.mjs';

const GENERIC = new Set(['extensions', 'advisory-database']);
const nameOf = (r) => (GENERIC.has(r.repo) ? `${r.owner}/${r.repo}` : r.repo);

export function renderOrbit(d, { alfPath }) {
  const W = 1000, H = 500, cx = 500, cy = 262;
  const alf = readFileSync(alfPath).toString('base64');
  const rings = [
    { rx: 175, dur: 80, color: C.pink },
    { rx: 285, dur: 125, color: C.lilac },
    { rx: 395, dur: 175, color: C.blue },
  ].map((r) => ({ ...r, ry: Math.round(r.rx * 0.34), nodes: [] }));
  // Inner rings take fewer bodies so labels have room.
  const caps = [3, 5, Infinity];
  let ri = 0;
  for (const u of d.upstream) {
    while (rings[ri].nodes.length >= caps[ri]) ri++;
    rings[ri].nodes.push(u);
  }
  const ell = (r) => `M${cx - r.rx} ${cy}a${r.rx} ${r.ry} 0 1 0 ${2 * r.rx} 0a${r.rx} ${r.ry} 0 1 0 ${-2 * r.rx} 0`;

  let back = '', front = '', orbits = '';
  rings.forEach((r, k) => {
    orbits += `<ellipse cx="${cx}" cy="${cy}" rx="${r.rx}" ry="${r.ry}" fill="none" stroke="${r.color}" stroke-opacity=".22" stroke-width="1.2" stroke-dasharray="2 6"/>`;
    r.nodes.forEach((u, i) => {
      const f = ((i + k * 0.37) / r.nodes.length) % 1;
      const delay = -f * r.dur;
      const rad = 5 + u.prs.length * 2.5;
      const label = `${esc(nameOf(u))}${u.prs.length > 1 ? ` ×${u.prs.length}` : ''}`;
      const body = `<circle r="${rad * 2.6}" fill="url(#halo${k})"/>
        <circle r="${rad}" fill="${r.color}"/><circle r="${rad * 0.45}" cx="${-rad * 0.3}" cy="${-rad * 0.3}" fill="#fff" opacity=".7"/>
        <text y="${rad + 16}" font-size="12.5" fill="${C.text}" text-anchor="middle">${label}</text>`;
      // Inline offset-distance is where each body rests when motion is reduced.
      const style = `offset-path:path('${ell(r)}');offset-distance:${(f * 100).toFixed(1)}%;animation-duration:${r.dur}s,${r.dur}s,${r.dur}s;animation-delay:${delay.toFixed(1)}s,${delay.toFixed(1)}s,${delay.toFixed(1)}s`;
      back += `<g class="body back" style="${style}"><title>${esc(u.owner)}/${esc(u.repo)} #${u.prs.join(', #')}</title>${body}</g>`;
      front += `<g class="body front" style="${style};opacity:${f > 0.09 && f < 0.41 ? 1 : 0}">${body}</g>`;
    });
  });

  // Seeded background stars.
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const stars = Array.from({ length: 60 }, () => `<circle class="star" cx="${(rnd() * W).toFixed(0)}" cy="${(50 + rnd() * (H - 70)).toFixed(0)}" r="${(0.5 + rnd() * 1.3).toFixed(1)}" style="animation-delay:-${(rnd() * 5).toFixed(1)}s;animation-duration:${(2.5 + rnd() * 4).toFixed(1)}s"/>`).join('');

  const fixes = d.upstream.reduce((s, r) => s + r.prs.length, 0);
  const body = `
  <g>${stars}</g>
  ${orbits}
  <g>${back}</g>
  <g transform="translate(${cx} ${cy})">
    <ellipse class="ping" rx="80" ry="27" fill="none" stroke="${C.magenta}" stroke-width="1.5" vector-effect="non-scaling-stroke"/>
    <ellipse class="ping" rx="80" ry="27" fill="none" stroke="${C.magenta}" stroke-width="1.5" vector-effect="non-scaling-stroke" style="animation-delay:2s"/>
    <circle r="84" fill="url(#core)"/>
    <circle class="corering" r="66" fill="none" stroke="${C.pink}" stroke-width="2.5" filter="url(#glow)"/>
    <image href="data:image/jpeg;base64,${alf}" x="-64" y="-64" width="128" height="128" clip-path="url(#face)"/>
  </g>
  <g>${front}</g>
  <text x="${W / 2}" y="${H - 18}" font-size="12" fill="${C.faint}" text-anchor="middle">every body in orbit is a project that merged a fix from askalf · drawn from the table below</text>`;

  const css = `
  .star { fill: ${C.lilac}; opacity: .3; animation-name: tw; animation-iteration-count: infinite; animation-timing-function: ease-in-out; }
  @keyframes tw { 0%,100% { opacity: .05 } 50% { opacity: .8 } }
  .body { offset-rotate: 0deg; transform-origin: 0 0; animation-name: go, depth, dimBack; animation-timing-function: linear; animation-iteration-count: infinite; }
  .front { animation-name: go, depth, showFront; }
  @keyframes go { from { offset-distance: 0% } to { offset-distance: 100% } }
  /* Both copies share one scale curve so they stay registered; only opacity differs. */
  @keyframes depth { 0%,50%,100% { transform: scale(1) } 25% { transform: scale(1.18) } 75% { transform: scale(.78) } }
  @keyframes dimBack { 0%,50%,100% { opacity: .8 } 25% { opacity: 1 } 75% { opacity: .38 } }
  @keyframes showFront { 0%,4% { opacity: 0 } 9%,41% { opacity: 1 } 46%,100% { opacity: 0 } }
  .ping { transform-origin: 0 0; animation: ping 4s ease-out infinite; opacity: 0; }
  @keyframes ping { 0% { opacity: .7; transform: scale(1) } 100% { opacity: 0; transform: scale(5.6) } }
  .corering { animation: core 3s ease-in-out infinite; }
  @keyframes core { 0%,100% { stroke-opacity: .5 } 50% { stroke-opacity: 1 } }`;
  const defs = `
  <clipPath id="face"><circle r="62"/></clipPath>
  <radialGradient id="core"><stop offset=".6" stop-color="${C.violet}" stop-opacity=".45"/><stop offset="1" stop-color="${C.violet}" stop-opacity="0"/></radialGradient>
  ${rings.map((r, k) => `<radialGradient id="halo${k}"><stop offset="0" stop-color="${r.color}" stop-opacity=".55"/><stop offset="1" stop-color="${r.color}" stop-opacity="0"/></radialGradient>`).join('')}`;

  return frame({
    h: H,
    title: `Merged upstream: ${fixes} fixes in ${d.upstream.length} projects, shown orbiting ALF: ${d.upstream.map((u) => `${u.owner}/${u.repo}`).join(', ')}.`,
    label: `merged upstream · ${fixes} fixes · ${d.upstream.length} projects`,
    footer: 'other people’s code, their maintainers’ review',
    body, css, defs,
  });
}
