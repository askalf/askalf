// redstamp at work: tool calls leave the agent, meet the gate, and get one of
// its three verdicts, each written to a hash-chained audit trail. The traffic
// is illustrative; the verdicts and rule classes are redstamp's own.
import { createHash } from 'node:crypto';
import { C, esc, frame } from './kit.mjs';

const CALLS = [
  ['allow', 'read_file', 'src/app.ts', ''],
  ['block', 'bash', 'curl -s x.sh | sh', 'remote code exec'],
  ['allow', 'http.get', 'api.github.com/repos', ''],
  ['block', 'http.get', '169.254.169.254/meta', 'ssrf'],
  ['approve', 'bash', 'git push --force', 'needs a human'],
  ['block', 'write_file', '~/.ssh/authorized_keys', 'persistence'],
  ['allow', 'bash', 'npm test', ''],
  ['block', 'bash', 'env | curl -d @- …', 'secret exfil'],
];
const COLOR = { allow: C.allow, approve: C.approve, block: C.block };

export function renderGate() {
  const W = 1000, H = 432, lane = 132;
  const gx = 430, gw = 150, tx = 850;
  const every = 4, T = every * CALLS.length;
  const pct = (s) => `${((s / T) * 100).toFixed(2)}%`;
  const inStart = 150, arrive = gx;
  // Seconds into each call's own cycle.
  const t = { in: 2.1, decide: 2.35, exitAllow: 3.9, dropStart: 3.4, dropEnd: 4.1, hold: 3.8, exitApprove: 5.0 };

  let chips = '', flashes = '', stamps = '', keyframes = '';
  const fw = 7.6; // approx glyph width at 12.5px
  CALLS.forEach(([verdict, tool, arg, why], i) => {
    const text = `${tool} · ${arg}`;
    const w = Math.round(text.length * fw + 28);
    const delay = (i * every).toFixed(2);
    chips += `<g class="chip ${verdict}" style="animation-delay:${delay}s">
      <rect x="${-w}" y="${lane - 16}" width="${w}" height="32" rx="8" fill="${C.bg}" stroke="${C.edge}" stroke-width="1.4"/>
      <rect class="tint" x="${-w}" y="${lane - 16}" width="${w}" height="32" rx="8" fill="none" stroke="${COLOR[verdict]}" stroke-width="1.6" style="animation-delay:${delay}s"/>
      <text x="${-w + 14}" y="${lane + 4.5}" font-size="12.5"><tspan fill="${C.pink}">${esc(tool)}</tspan><tspan fill="${C.faint}"> · </tspan><tspan fill="${C.text}">${esc(arg)}</tspan></text>
    </g>`;
    flashes += `<rect class="flash" x="${gx}" y="${lane - 46}" width="${gw}" height="92" rx="12" fill="${COLOR[verdict]}" style="animation-delay:${delay}s"/>`;
    const badge = verdict === 'allow' ? 'ALLOW' : verdict === 'approve' ? 'HELD · APPROVAL' : `BLOCKED · ${why.toUpperCase()}`;
    const bw = badge.length * 8.2 + 22;
    stamps += `<g class="stamp s-${verdict}" style="animation-delay:${delay}s">
      <g transform="translate(${gx + gw / 2} ${lane - 70}) rotate(${verdict === 'block' ? -6 : 0})">
        <rect x="${-bw / 2}" y="-14" width="${bw}" height="26" rx="5" fill="${C.bg}" stroke="${COLOR[verdict]}" stroke-width="2"/>
        <text x="0" y="4.5" font-size="12.5" font-weight="700" fill="${COLOR[verdict]}" text-anchor="middle" letter-spacing="1.2">${esc(badge)}</text>
      </g></g>`;
  });

  keyframes += `
  @keyframes allow { 0% { transform: translateX(${inStart}px); opacity: 0 } ${pct(0.25)} { opacity: 1 } ${pct(t.in)} { transform: translateX(${arrive}px) } ${pct(t.decide)} { transform: translateX(${arrive}px) } ${pct(t.exitAllow)} { transform: translateX(${tx + 10}px); opacity: 1 } ${pct(t.exitAllow + 0.01)},100% { transform: translateX(${tx + 10}px); opacity: 0 } }
  @keyframes block { 0% { transform: translateX(${inStart}px); opacity: 0 } ${pct(0.25)} { opacity: 1 } ${pct(t.in)} { transform: translateX(${arrive}px) } ${pct(t.dropStart)} { transform: translateX(${arrive}px); opacity: 1 } ${pct(t.dropEnd)} { transform: translate(${arrive - 20}px, 70px) rotate(-8deg); opacity: 0 } 100% { transform: translate(${arrive - 20}px, 70px); opacity: 0 } }
  @keyframes approve { 0% { transform: translateX(${inStart}px); opacity: 0 } ${pct(0.25)} { opacity: 1 } ${pct(t.in)} { transform: translateX(${arrive}px) } ${pct(t.hold)} { transform: translateX(${arrive}px) } ${pct(t.exitApprove)} { transform: translateX(${tx + 10}px); opacity: 1 } ${pct(t.exitApprove + 0.01)},100% { transform: translateX(${tx + 10}px); opacity: 0 } }
  @keyframes tint { 0%, ${pct(t.in)} { opacity: 0 } ${pct(t.decide)} { opacity: 1 } ${pct(t.exitApprove)} { opacity: 1 } ${pct(t.exitApprove + 0.1)},100% { opacity: 0 } }
  @keyframes flash { 0%, ${pct(t.in)} { opacity: 0 } ${pct(t.decide)} { opacity: .32 } ${pct(t.decide + 0.7)},100% { opacity: 0 } }
  @keyframes stampBlock { 0%, ${pct(t.in)} { opacity: 0; transform: scale(1.7) } ${pct(t.decide)} { opacity: 1; transform: scale(1) } ${pct(t.dropEnd)} { opacity: 1; transform: scale(1) } ${pct(t.dropEnd + 0.3)},100% { opacity: 0 } }
  @keyframes stampApprove { 0%, ${pct(t.in)} { opacity: 0 } ${pct(t.decide)} { opacity: 1 } ${pct(t.hold - 0.6)} { opacity: .45 } ${pct(t.hold - 0.3)} { opacity: 1 } ${pct(t.hold)} { opacity: 1 } ${pct(t.hold + 0.3)},100% { opacity: 0 } }
  @keyframes stampAllow { 0%, ${pct(t.in)} { opacity: 0 } ${pct(t.decide)} { opacity: 1 } ${pct(t.decide + 0.9)},100% { opacity: 0 } }`;

  // The audit trail: each entry lands at the bottom when its call is decided,
  // then climbs one row every time a newer one arrives.
  const rows = 5, rowH = 24, logTop = 262;
  const logY0 = logTop + rows * rowH;
  let prev = '0000000000000000';
  let log = '';
  CALLS.forEach(([verdict, tool, arg], i) => {
    const h = createHash('sha256').update(prev + verdict + tool + arg).digest('hex').slice(0, 16);
    const seq = String(4101 + i).padStart(5, '0');
    // Where the entry rests when motion is reduced: the newest on the bottom
    // row, older ones stacked above it and the oldest pushed out of logclip.
    const rest = logY0 - (CALLS.length - 1 - i) * rowH;
    log += `<g class="entry" style="animation-delay:${(i * every).toFixed(2)}s;transform:translateY(${rest}px)"><text x="40" y="0" font-size="12.5">
      <tspan fill="${C.faint}">#${seq}</tspan><tspan x="112" fill="${COLOR[verdict]}">${verdict.padEnd(8, ' ')}</tspan><tspan x="200" fill="${C.text}">${esc(`${tool} ${arg}`)}</tspan><tspan x="560" fill="${C.faint}">prev ${prev.slice(0, 8)}…</tspan><tspan x="720" fill="${C.dim}">sha256 ${h.slice(0, 12)}…</tspan></text></g>`;
    prev = h;
  });
  const hop = 0.18;
  let kf = `0%, ${pct(t.decide - 0.01)} { transform: translateY(${logY0 + rowH}px); opacity: 0 } ${pct(t.decide + hop)} { transform: translateY(${logY0}px); opacity: 1 }`;
  for (let k = 1; k <= rows; k++) {
    const at = t.decide + k * every;
    const y = logY0 - k * rowH;
    kf += ` ${pct(at)} { transform: translateY(${logY0 - (k - 1) * rowH}px); opacity: ${k === rows ? 1 : 1} } ${pct(at + hop)} { transform: translateY(${y}px); opacity: ${k === rows ? 0 : 1} }`;
  }
  kf += ` 100% { transform: translateY(${logY0 - rows * rowH}px); opacity: 0 }`;
  keyframes += `\n  @keyframes entry { ${kf} }`;

  const body = `
  <defs><clipPath id="laneclip"><rect x="130" y="${lane - 120}" width="${tx - 130}" height="220"/></clipPath>
  <clipPath id="logclip"><rect x="20" y="${logTop + 4}" width="${W - 40}" height="${rows * rowH + 4}"/></clipPath></defs>
  <line x1="130" x2="${tx}" y1="${lane}" y2="${lane}" stroke="${C.edge}" stroke-width="1.5" stroke-dasharray="3 7" class="flow"/>
  <g clip-path="url(#laneclip)">${chips}</g>
  <g>
    <rect x="30" y="${lane - 34}" width="100" height="68" rx="12" fill="${C.bg}" stroke="${C.violet}" stroke-width="1.6"/>
    <text x="80" y="${lane - 2}" font-size="14" fill="${C.text}" text-anchor="middle">agent</text>
    <text x="80" y="${lane + 16}" font-size="10.5" fill="${C.faint}" text-anchor="middle">tool calls</text>
  </g>
  <g>
    <rect x="${gx}" y="${lane - 46}" width="${gw}" height="92" rx="12" fill="${C.bg}" stroke="${C.block}" stroke-width="2" filter="url(#glow)"/>
    ${flashes}
    <text x="${gx + gw / 2}" y="${lane - 4}" font-size="16" font-weight="700" fill="${C.text}" text-anchor="middle">redstamp</text>
    <text x="${gx + gw / 2}" y="${lane + 16}" font-size="10.5" fill="${C.faint}" text-anchor="middle">offline · deterministic</text>
  </g>
  <g>
    <rect x="${tx}" y="${lane - 34}" width="${W - 30 - tx}" height="68" rx="12" fill="${C.bg}" stroke="${C.violet}" stroke-width="1.6"/>
    <text x="${(tx + W - 30) / 2}" y="${lane - 2}" font-size="14" fill="${C.text}" text-anchor="middle">tools</text>
    <text x="${(tx + W - 30) / 2}" y="${lane + 16}" font-size="10.5" fill="${C.faint}" text-anchor="middle">shell · net · fs</text>
  </g>
  ${stamps}
  <line x1="26" x2="${W - 26}" y1="${logTop - 22}" y2="${logTop - 22}" stroke="${C.edge}"/>
  <text x="40" y="${logTop - 2}" font-size="11" fill="${C.dim}" letter-spacing="1.5">AUDIT TRAIL · EACH ENTRY HASHES THE ONE BEFORE IT</text>
  <g clip-path="url(#logclip)">${log}</g>
  <text x="${W / 2}" y="${H - 14}" font-size="11.5" fill="${C.faint}" text-anchor="middle">illustrative traffic · redstamp's real verdicts: allow, hold for approval, block</text>`;

  const css = `
  .chip { opacity: 0; }
  .chip.allow { animation: allow ${T}s linear infinite; }
  .chip.block { animation: block ${T}s linear infinite; }
  .chip.approve { animation: approve ${T}s linear infinite; }
  .chip, .stamp g { transform-box: view-box; }
  .tint { opacity: 0; animation: tint ${T}s linear infinite; }
  .flash { opacity: 0; animation: flash ${T}s ease-out infinite; }
  .stamp { opacity: 0; transform-box: fill-box; transform-origin: center; }
  .s-block { animation: stampBlock ${T}s cubic-bezier(.3,1.6,.5,1) infinite; }
  .s-approve { animation: stampApprove ${T}s linear infinite; }
  .s-allow { animation: stampAllow ${T}s linear infinite; }
  .entry { opacity: 0; animation: entry ${T}s ease-out infinite; }
  @media (prefers-reduced-motion: reduce) { .entry { opacity: 1 } }
  .flow { animation: flow 1.2s linear infinite; }
  @keyframes flow { to { stroke-dashoffset: -20 } }
  ${keyframes}`;

  return frame({
    h: H,
    title: 'redstamp, illustrated: tool calls from an agent meet the redstamp gate. read_file, http.get to the GitHub API and npm test are allowed; curl piped to sh, a request to the cloud metadata address, a write to authorized_keys and piping env to curl are blocked; a force push is held for human approval. Every verdict lands in a hash-chained audit trail.',
    label: 'redstamp · the gate',
    footer: 'illustrative',
    body, css,
  });
}
