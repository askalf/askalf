// The operation, lately: public GitHub activity per day for two weeks, and
// the latest moves as they came in.
import { C, esc, n, ago, frame } from './kit.mjs';

const GLYPH = { push: '↑', merge: '⇢', pr: '＋', review: '◎', release: '◆', issue: '•' };
const TINT = { push: C.lilac, merge: C.allow, pr: C.pink, review: C.blue, release: C.magenta, issue: C.dim };

export function renderSignal(d) {
  const now = Date.parse(d.at);
  const g = d.github;
  const H = 300;
  let body = '';
  if (!g) {
    body = `<text x="500" y="160" font-size="14" fill="${C.dim}" text-anchor="middle">waiting for the first pulse from the GitHub API</text>`;
  } else {
    const per = g.perDay;
    const max = Math.max(...per.map((x) => x.n), 1);
    const x0 = 40, bw = 22, gap = 6, top = 70, h = 150;
    body += per.map((x, i) => {
      const bh = Math.max(3, (x.n / max) * h);
      const bx = x0 + i * (bw + gap);
      const bar = x.covered === false
        ? `<rect x="${bx}" y="${top}" width="${bw}" height="${h}" rx="4" fill="${C.grid}" opacity=".5"><title>${x.day}: not yet counted</title></rect>`
        : `<rect class="bar" x="${bx}" y="${top + h - bh}" width="${bw}" height="${bh.toFixed(1)}" rx="4" fill="url(#col)" style="animation-delay:${(0.2 + i * 0.05).toFixed(2)}s"><title>${x.day}: ${x.n} events</title></rect>`;
      return `${bar}
      ${i % 2 === 1 ? `<text x="${bx + bw / 2}" y="${top + h + 18}" font-size="10.5" fill="${C.faint}" text-anchor="middle">${x.day.slice(8)}</text>` : ''}`;
    }).join('');
    const counted = per.filter((x) => x.covered !== false);
    const total = counted.reduce((s, x) => s + x.n, 0);
    const span = counted.length === per.length ? '14 days' : `${counted.length} day${counted.length === 1 ? '' : 's'}`;
    body += `<text x="${x0}" y="${top + h + 46}" font-size="12" fill="${C.dim}">${n(total)} public events in ${span}</text>`;
    // Newest move lands on top and the rest step down.
    const fx = 470;
    body += `<line x1="${fx - 24}" x2="${fx - 24}" y1="60" y2="${H - 30}" stroke="${C.edge}"/>`;
    body += g.feed.slice(0, 6).map((f, i) => {
      const y = 82 + i * 34;
      return `<g class="item" style="animation-delay:${(0.4 + (5 - i) * 0.25).toFixed(2)}s">
        <text x="${fx}" y="${y}" font-size="15" fill="${TINT[f.kind] ?? C.text}">${GLYPH[f.kind] ?? '·'}</text>
        <text x="${fx + 24}" y="${y}" font-size="13.5" fill="${C.text}">${esc(f.text)} <tspan fill="${C.pink}">${esc(f.repo)}</tspan></text>
        <text x="${1000 - 30}" y="${y}" font-size="12" fill="${C.faint}" text-anchor="end">${ago(f.at, now)}</text>
      </g>`;
    }).join('');
  }
  const css = `
  .bar { transform-box: fill-box; transform-origin: bottom; animation: grow .7s cubic-bezier(.2,.9,.3,1.15) both; }
  @keyframes grow { from { transform: scaleY(0) } to { transform: scaleY(1) } }
  .item { animation: drop .5s ease-out both; }
  @keyframes drop { from { opacity: 0; transform: translateY(-10px) } to { opacity: 1; transform: none } }`;
  const defs = `<linearGradient id="col" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${C.violet}" stop-opacity=".5"/><stop offset="1" stop-color="${C.pink}"/></linearGradient>`;
  return frame({
    h: H,
    title: g ? `The operation lately: ${g.feed.slice(0, 6).map((f) => `${f.text} in ${f.repo}, ${ago(f.at, now)}`).join('; ')}.` : 'The operation lately: waiting for the first pulse.',
    label: 'the operation · lately',
    footer: 'public GitHub activity',
    body, css, defs,
  });
}
