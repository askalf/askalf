// `alf status --live`: a terminal that types itself out with the numbers
// from the latest pulse.
import { C, esc, n, ago, stamp, frame } from './kit.mjs';

const clip = (s, max) => (s.length > max ? s.slice(0, max - 1) + '…' : s);

export function renderConsole(d) {
  const now = Date.parse(d.at);
  const rows = [];
  if (d.dario) rows.push(['dario', `v${d.dario.latest} · shipped ${ago(d.dario.latestAt, now)} · ${n(d.dario.releaseCount)} releases, ${d.dario.releases30} in the last 30 days`]);
  if (d.installs) rows.push(['installs', `${n(d.installs.last30)} in the last 30 days`, 'spark']);
  if (d.github) rows.push(['stars', `${n(d.github.darioStars)} on dario · ${n(d.github.stars)} across ${d.github.publicRepos} public repos`]);
  const fixes = d.upstream.reduce((s, r) => s + r.prs.length, 0);
  rows.push(['upstream', `${fixes} fixes merged into ${d.upstream.length} projects${d.github ? ` · ${d.github.inReview.length} open for review` : ''}`]);
  if (d.github?.inReview.length) rows.push(['in review', clip(d.github.inReview.map((p) => `${p.repo}#${p.number}`).join(' · '), 84)]);
  if (d.github?.feed.length) { const f = d.github.feed[0]; rows.push(['last move', `${f.text} in ${f.repo} · ${ago(f.at, now)}`]); }
  rows.push(['pulse', `rendered ${stamp(d.at)} · redrawn hourly by a GitHub Action`]);

  const top = 70, step = 31, key = 40, val = 175;
  const cmd = 'alf status --live';
  const cmdW = cmd.length * 9.03;
  const cmdX = key + 'alf@askalf ~ $ '.length * 9.03;
  const tType = 0.5, tCmd = 0.9, tOut = tType + tCmd + 0.25;
  let body = '', defs = '', css = '';

  // Prompt line, typed character by character.
  defs += `<clipPath id="c0"><rect class="type" x="${cmdX}" y="${top - 18}" width="${cmdW + 2}" height="26" style="animation:type ${tCmd}s steps(${cmd.length}) ${tType}s both"/></clipPath>`;
  body += `<text x="${key}" y="${top}" font-size="15"><tspan fill="${C.magenta}">alf@askalf</tspan><tspan fill="${C.faint}"> ~ $</tspan></text>`;
  body += `<text x="${cmdX}" y="${top}" font-size="15" fill="${C.text}" clip-path="url(#c0)">${cmd}</text>`;

  rows.forEach(([k, v, extra], i) => {
    const y = top + step * (i + 1) + 6;
    const delay = tOut + i * 0.22;
    const w = (v.length + 1) * 9.03;
    defs += `<clipPath id="c${i + 1}"><rect x="${val}" y="${y - 18}" width="${w}" height="26" style="animation:type .45s steps(${Math.max(8, Math.round(v.length / 3))}) ${delay.toFixed(2)}s both"/></clipPath>`;
    body += `<g class="row" style="animation-delay:${delay.toFixed(2)}s">
      <text x="${key}" y="${y}" font-size="15" fill="${C.pink}">${esc(k)}</text>
      <text x="${key + 105}" y="${y}" font-size="15" fill="${C.faint}">›</text>
    </g>
    <text x="${val}" y="${y}" font-size="15" fill="${k === 'pulse' ? C.dim : C.text}" clip-path="url(#c${i + 1})">${esc(v)}</text>`;
    if (extra === 'spark' && d.installs?.days?.length) {
      const days = d.installs.days.slice(-30);
      const max = Math.max(...days.map((x) => x.n), 1);
      const x0 = val + w + 24, bw = 10, gap = 3;
      body += days.map((x, j) => {
        const bh = Math.max(2, (x.n / max) * 24);
        return `<rect class="bar" x="${x0 + j * (bw + gap)}" y="${y + 3 - bh}" width="${bw}" height="${bh.toFixed(1)}" rx="2" fill="url(#barfill)" style="animation-delay:${(delay + 0.3 + j * 0.03).toFixed(2)}s"><title>${x.day}: ${n(x.n)}</title></rect>`;
      }).join('');
      defs += `<linearGradient id="barfill" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${C.violet}"/><stop offset="1" stop-color="${C.pink}"/></linearGradient>`;
    }
  });

  const yEnd = top + step * (rows.length + 1) + 12;
  const tEnd = tOut + rows.length * 0.22 + 0.4;
  body += `<g class="row" style="animation-delay:${tEnd.toFixed(2)}s"><text x="${key}" y="${yEnd}" font-size="15"><tspan fill="${C.magenta}">alf@askalf</tspan><tspan fill="${C.faint}"> ~ $</tspan></text>
    <rect class="cursor" x="${cmdX}" y="${yEnd - 14}" width="9" height="18" fill="${C.lilac}"/></g>`;

  css += `
  @keyframes type { from { transform: scaleX(0) } to { transform: scaleX(1) } }
  clipPath rect { transform-box: fill-box; transform-origin: left; }
  .row { animation: show .01s linear both; }
  @keyframes show { from { opacity: 0 } to { opacity: 1 } }
  .bar { transform-box: fill-box; transform-origin: bottom; animation: grow .5s cubic-bezier(.2,.9,.3,1.2) both; }
  @keyframes grow { from { transform: scaleY(0) } to { transform: scaleY(1) } }
  .cursor { animation: blink 1.05s steps(1) infinite; }
  @keyframes blink { 50% { opacity: 0 } }`;

  return frame({
    h: yEnd + 26,
    title: `alf status: ${rows.map(([k, v]) => `${k} ${v}`).join('; ')}`,
    label: 'live · the operation right now',
    footer: 'askalf/askalf · pulse',
    body, defs, css,
  });
}
