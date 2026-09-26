// Shared look for the pulse panels: the same near-black, violet and neon
// pink as the rest of the profile art, and a monospace stack that every
// platform has, since an SVG inside <img> can't load web fonts.
export const C = {
  bg: '#0a0612', panel: '#0d0918', edge: '#2a1f47', grid: '#1a1330',
  text: '#ece8ff', dim: '#8e84ad', faint: '#5b5378',
  violet: '#8b5cf6', lilac: '#c4b5fd', pink: '#f0abfc', magenta: '#e879f9', blue: '#818cf8',
  allow: '#4ade80', approve: '#fbbf24', block: '#fb4f6d',
};
export const MONO = `ui-monospace,SFMono-Regular,'SF Mono',Menlo,Consolas,'Liberation Mono',monospace`;

export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const n = (x) => Number(x).toLocaleString('en-US');

export function ago(iso, now) {
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400 * 1.5) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export const stamp = (iso) => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;

// A dark glass panel with a header chip and a live dot. `h` is the height.
export function frame({ w = 1000, h, title, label, body, css = '', defs = '', footer = '' }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-labelledby="t">
<title id="t">${esc(title)}</title>
<style>
  text { font-family: ${MONO}; }
  .live { animation: live 1.6s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
  @keyframes live { 0%,100% { opacity: 1; transform: scale(1) } 50% { opacity: .35; transform: scale(.7) } }
  .ring { animation: ring 1.6s ease-out infinite; transform-box: fill-box; transform-origin: center; }
  @keyframes ring { 0% { opacity: .8; transform: scale(1) } 100% { opacity: 0; transform: scale(3.2) } }
  ${css}
  @media (prefers-reduced-motion: reduce) { * { animation: none !important } }
</style>
<defs>
  <linearGradient id="edge" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${C.violet}" stop-opacity=".55"/><stop offset=".5" stop-color="${C.edge}"/><stop offset="1" stop-color="${C.magenta}" stop-opacity=".45"/></linearGradient>
  <radialGradient id="wash" cx=".15" cy="0" r="1"><stop offset="0" stop-color="${C.violet}" stop-opacity=".16"/><stop offset=".6" stop-color="${C.violet}" stop-opacity="0"/></radialGradient>
  <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  ${defs}
</defs>
<rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="14" fill="${C.panel}" stroke="url(#edge)" stroke-width="1.5"/>
<rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="14" fill="url(#wash)"/>
<g transform="translate(26 30)">
  <circle class="ring" cx="5" cy="-4" r="5" fill="none" stroke="${C.allow}" stroke-width="1.5"/>
  <circle class="live" cx="5" cy="-4" r="4.5" fill="${C.allow}"/>
  <text x="20" y="0" font-size="13" fill="${C.lilac}" letter-spacing="2.5">${esc(label.toUpperCase())}</text>
</g>
${footer ? `<text x="${w - 26}" y="30" font-size="12" fill="${C.faint}" text-anchor="end">${esc(footer)}</text>` : ''}
${body}
</svg>
`;
}
