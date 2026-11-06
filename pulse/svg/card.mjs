// A product card: the art as it was made, moving, with that product's live numbers. The art never
// holds a number: every figure is drawn on top each hour from the same sources as the rest of the
// page. One that has never had a source reads as a dash, and one whose source failed this hour
// keeps its last good value under a heading and a dim pip that say it is not live.
//
// A phone shows a card at about a fifth of its size, where the glass panel's type is unreadable.
// So the phone card keeps the scene, drops the empty panel, and sets the figures in a strip below.
import { readFileSync } from 'node:fs';
import { C, ART_BG, esc, MONO } from './kit.mjs';

const W = 1774, H = 887;
const PHONE_W = 1190, STRIP_Y = 884, STRIP_H = 408;
const dash = (v) => (v === null || v === undefined || v === '' || Number.isNaN(v) ? '-' : v);

// One figure in the glass panel: a big value and what it counts.
function panelFigure(f, y, big, PANEL) {
  const size = big ? 118 : 76;
  const x = PANEL.x + 46;
  return `<text x="${x}" y="${y}" font-size="${size}" font-weight="700" fill="${f.color ?? C.text}" filter="url(#soft)">${esc(dash(f.value))}</text>
<text x="${x}" y="${y + (big ? 50 : 42)}" font-size="${big ? 32 : 28}" fill="${C.lilac}">${esc(f.label)}</text>`;
}

function livePip(x, y, heading, size, live) {
  return `<g transform="translate(${x} ${y})">
  ${live ? `<circle class="ring" r="${size * 0.36}" fill="none" stroke="${C.allow}" stroke-width="3"/>
  <circle class="live" r="${size * 0.33}" fill="${C.allow}"/>` : `<circle r="${size * 0.33}" fill="${C.faint}"/>`}
  <text x="${size * 0.93}" y="${size * 0.36}" font-size="${size}" letter-spacing="4" fill="${C.lilac}">${esc(heading)}</text>
</g>`;
}

function panel(PANEL, { heading, figures, foot, live }) {
  const gap = 196;
  let y = PANEL.y + 214;
  const rows = figures.map((f, i) => {
    const out = panelFigure(f, y, i === 0, PANEL);
    y += i === 0 ? gap + 34 : gap - 16;
    return out;
  }).join('\n');
  return `<g clip-path="url(#glass)"><rect class="glint" x="${PANEL.x}" y="${PANEL.y}" width="${PANEL.w}" height="${PANEL.h}" fill="url(#sheen)"/></g>
${livePip(PANEL.x + 54, PANEL.y + 70, heading, 30, live)}
${rows}
${foot ? `<text x="${PANEL.x + 46}" y="${PANEL.y + PANEL.h - 42}" font-size="27" fill="${C.dim}">${esc(foot)}</text>` : ''}`;
}

function strip({ heading, figures, foot, live }) {
  const y = STRIP_Y, cols = [74, 640];
  const rows = figures.map((f, i) => `<text x="${cols[i]}" y="${y + 228}" font-size="136" font-weight="700" fill="${f.color ?? C.text}" filter="url(#soft)">${esc(dash(f.value))}</text>
<text x="${cols[i]}" y="${y + 288}" font-size="42" fill="${C.lilac}">${esc(f.label)}</text>`).join('\n');
  return `<rect y="${H - 90}" width="${PHONE_W}" height="90" fill="url(#fade)"/>
<rect y="${H - 1}" width="${PHONE_W}" height="${STRIP_H}" fill="${ART_BG}"/>
<rect x="26" y="${y}" width="${PHONE_W - 52}" height="${STRIP_H - 26}" rx="34" fill="${C.panel}" stroke="url(#stripEdge)" stroke-width="4"/>
${livePip(92, y + 72, heading, 40, live)}
${rows}
${foot ? `<text x="74" y="${y + 350}" font-size="36" fill="${C.dim}">${esc(foot)}</text>` : ''}`;
}

export function renderCard({ artPath, panel: PANEL, title, heading, figures, foot, live = true, life }, { phone = false } = {}) {
  const jpg = readFileSync(artPath).toString('base64');
  const w = phone ? PHONE_W : W, h = phone ? H + STRIP_H - 3 : H;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-labelledby="t">
<title id="t">${esc(title)}</title>
<style>
  text { font-family: ${MONO}; }
  .live { animation: live 1.6s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
  @keyframes live { 0%,100% { opacity: 1; transform: scale(1) } 50% { opacity: .35; transform: scale(.7) } }
  .ring { animation: ring 1.6s ease-out infinite; transform-box: fill-box; transform-origin: center; }
  @keyframes ring { 0% { opacity: .8; transform: scale(1) } 100% { opacity: 0; transform: scale(3) } }
  .glint { animation: glint 7s ease-in-out infinite; }
  @keyframes glint { 0%,60% { transform: translateY(-${PANEL.h}px); opacity: 0 } 66% { opacity: 1 } 92% { opacity: .8 } 100% { transform: translateY(${PANEL.h}px); opacity: 0 } }
  ${life.css}
  @media (prefers-reduced-motion: reduce) { * { animation: none !important } .glint { display: none } }
</style>
<defs>
  <clipPath id="glass"><rect x="${PANEL.x}" y="${PANEL.y}" width="${PANEL.w}" height="${PANEL.h}" rx="34"/></clipPath>
  <linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.magenta}" stop-opacity="0"/><stop offset=".5" stop-color="${C.pink}" stop-opacity=".16"/><stop offset="1" stop-color="${C.magenta}" stop-opacity="0"/></linearGradient>
  <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${ART_BG}" stop-opacity="0"/><stop offset="1" stop-color="${ART_BG}"/></linearGradient>
  <linearGradient id="stripEdge" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${C.violet}"/><stop offset="1" stop-color="${C.magenta}"/></linearGradient>
  <filter id="soft" x="-20%" y="-30%" width="140%" height="160%"><feGaussianBlur stdDeviation="7" result="b"/><feColorMatrix in="b" type="matrix" values="0 0 0 0 .75  0 0 0 0 .45  0 0 0 0 1  0 0 0 .55 0" result="g"/><feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  ${life.defs}
</defs>
<image href="data:image/jpeg;base64,${jpg}" width="${W}" height="${H}"/>
${life.over}
${phone ? strip({ heading, figures, foot, live }) : panel(PANEL, { heading, figures, foot, live })}
</svg>
`;
}
