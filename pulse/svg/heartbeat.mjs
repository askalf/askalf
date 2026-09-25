// dario's heartbeat: an ECG trace where every spike is real releases shipped
// in a four-hour window over the last two weeks, over the daily install curve.
import { C, esc, n, ago, frame } from './kit.mjs';

const DAY = 864e5, BUCKET = 4 * 3600e3, SPAN = 14 * DAY;

export function renderHeartbeat(d) {
  const now = Date.parse(d.at);
  const x0 = 40, x1 = 740, base = 150;
  const start = now - SPAN;
  const buckets = Math.round(SPAN / BUCKET);
  const bw = (x1 - x0) / buckets;
  const counts = new Array(buckets).fill(0);
  for (const r of d.dario?.recent ?? []) {
    const i = Math.floor((Date.parse(r.at) - start) / BUCKET);
    if (i >= 0 && i < buckets) counts[i]++;
  }
  // Build one continuous trace. A bucket with releases gets a QRS complex
  // whose height grows with how many shipped in it.
  let p = `M${x0} ${base}`;
  counts.forEach((c, i) => {
    const bx = x0 + i * bw;
    if (!c) { p += `L${(bx + bw).toFixed(1)} ${base}`; return; }
    const h = Math.min(92, 34 + (c - 1) * 18);
    const f = (k) => (bx + bw * k).toFixed(1);
    p += `L${f(0.15)} ${base}L${f(0.3)} ${base + 7}L${f(0.5)} ${base - h}L${f(0.68)} ${base + 16}L${f(0.82)} ${base}L${f(1)} ${base}`;
  });

  // Daily installs as a soft band under the trace.
  const days = (d.installs?.days ?? []).filter((x) => Date.parse(x.day) >= start - DAY);
  const max = Math.max(...days.map((x) => x.n), 1);
  const bandTop = 200, bandH = 56;
  const dx = (day) => x0 + ((Date.parse(day) + DAY / 2 - start) / SPAN) * (x1 - x0);
  const pts = days.map((x) => [Math.max(x0, Math.min(x1, dx(x.day))), bandTop + bandH - (x.n / max) * bandH]);
  let area = '';
  if (pts.length > 1) {
    const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');
    area = `<path d="${line}L${pts.at(-1)[0].toFixed(1)} ${bandTop + bandH}L${pts[0][0].toFixed(1)} ${bandTop + bandH}Z" fill="url(#area)"/>
      <path d="${line}" fill="none" stroke="${C.violet}" stroke-width="1.5" opacity=".8"/>`;
  }
  // Day ticks every other day.
  let ticks = '';
  for (let i = 0; i <= 14; i += 2) {
    const t = start + i * DAY;
    const x = x0 + (i / 14) * (x1 - x0);
    const label = i === 14 ? 'now' : new Date(t).toISOString().slice(5, 10).replace('-', '/');
    ticks += `<line x1="${x}" x2="${x}" y1="58" y2="${bandTop + bandH}" stroke="${C.grid}" stroke-width="1"/>
      <text x="${x}" y="${bandTop + bandH + 20}" font-size="11" fill="${C.faint}" text-anchor="middle">${label}</text>`;
  }
  const minor = Array.from({ length: 13 }, (_, i) => `<line x1="${x0}" x2="${x1}" y1="${62 + i * 15}" y2="${62 + i * 15}" stroke="${C.grid}" stroke-width=".6" opacity=".6"/>`).join('');

  const sweep = 7;
  const rx = 790;
  const body = `
  ${minor}${ticks}
  ${area}
  <text x="${x0}" y="${bandTop - 6}" font-size="11" fill="${C.faint}">daily installs</text>
  <path d="${p}" fill="none" stroke="${C.magenta}" stroke-width="1.6" opacity=".38"/>
  <path class="sweep" d="${p}" pathLength="1000" fill="none" stroke="${C.pink}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" filter="url(#glow)"/>
  <circle class="head" r="4.5" fill="#fff" filter="url(#glow)" style="offset-path:path('${p}')"/>

  <line x1="${rx - 22}" x2="${rx - 22}" y1="56" y2="${bandTop + bandH + 20}" stroke="${C.edge}"/>
  <g transform="translate(${rx} 0)">
    <text x="0" y="78" font-size="11" fill="${C.dim}" letter-spacing="1.5">RELEASES · 30 DAYS</text>
    <g transform="translate(0 132)">
      <text x="0" y="0" font-size="58" font-weight="700" fill="${C.pink}" filter="url(#glow)">${d.dario ? d.dario.releases30 : '—'}</text>
      <path class="heart" d="M160 -30c-6-9-20-7-20 4 0 9 12 16 20 23 8-7 20-14 20-23 0-11-14-13-20-4z" fill="${C.block}"/>
    </g>
    <text x="0" y="170" font-size="13" fill="${C.text}">${d.dario ? `v${esc(d.dario.latest)}` : ''}</text>
    <text x="0" y="190" font-size="12" fill="${C.dim}">${d.dario ? `shipped ${ago(d.dario.latestAt, now)}` : ''}</text>
    <text x="0" y="228" font-size="11" fill="${C.dim}" letter-spacing="1.5">INSTALLS · 30 DAYS</text>
    <text x="0" y="252" font-size="20" fill="${C.text}">${d.installs ? n(d.installs.last30) : '—'}</text>
  </g>
  <text x="${x0}" y="${bandTop + bandH + 44}" font-size="11.5" fill="${C.faint}">every spike is dario shipping: releases per four-hour window, from the npm registry</text>`;

  const css = `
  .sweep { stroke-dasharray: 90 2000; animation: sweep ${sweep}s linear infinite; }
  @keyframes sweep { from { stroke-dashoffset: 90 } to { stroke-dashoffset: -1000 } }
  .head { offset-rotate: 0deg; animation: head ${sweep}s linear infinite; }
  @keyframes head { from { offset-distance: 0% } to { offset-distance: 100% } }
  .heart { transform-box: fill-box; transform-origin: center; animation: beat 1.1s ease-in-out infinite; }
  @keyframes beat { 0%,40%,100% { transform: scale(1) } 12% { transform: scale(1.28) } 24% { transform: scale(1.05) } 30% { transform: scale(1.2) } }`;
  const defs = `<linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.violet}" stop-opacity=".45"/><stop offset="1" stop-color="${C.violet}" stop-opacity="0"/></linearGradient>`;

  return frame({
    h: bandTop + bandH + 62,
    title: `dario heartbeat: ${d.dario ? `${d.dario.releases30} releases in the last 30 days, latest v${d.dario.latest}` : ''}${d.installs ? `, ${n(d.installs.last30)} installs in the last 30 days` : ''}.`,
    label: 'dario · heartbeat',
    footer: 'npm · last 14 days',
    body, css, defs,
  });
}
