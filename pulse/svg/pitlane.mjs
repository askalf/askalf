// pitlane's timing board: how long a job waits in the queue before one of our
// runners starts it, median and p90 against their targets, the jobs run in
// the last 24 hours, and five start lights that go out before each run.
import { C, esc, n, ago, frame } from './kit.mjs';

// The board at two widths. A phone shows it at about a third of the desktop size, so the lanes run
// the full width in larger type and the jobs count moves underneath them.
const WIDE = { W: 1000, H: 316, X0: 40, TRACK: 680, lanes: [70, 178], label: 11, value: 40, target: 12, tick: 10, valueDy: 40, trackDy: 54, tickDy: 28, bar: 10 };
const PHONE = { W: 640, H: 556, X0: 32, TRACK: 576, lanes: [76, 226], label: 17, value: 62, target: 18, tick: 15, valueDy: 64, trackDy: 84, tickDy: 38, bar: 14 };
const RX = 790;
// A lane spans twice its target, so the target tick sits mid-track.
const SPAN = 2;
const LOOP = 8;
const TONE = { ok: C.allow, warn: C.approve, bad: C.block, off: C.faint };

// Seconds the way a timing screen shows them: tenths under 10 s, whole
// seconds under a minute, then minutes and seconds.
export function fmtWait(ms) {
  if (!Number.isFinite(ms)) return '-';
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)} s`;
  const t = Math.round(ms / 1000);
  if (t < 60) return `${t} s`;
  return `${Math.floor(t / 60)}m ${String(t % 60).padStart(2, '0')}s`;
}

// The proof page's thresholds, so the board and the page never disagree.
export function verdict(p) {
  if (!p) return { tone: 'off', text: 'NO DATA' };
  if (p.stale) return { tone: 'off', text: 'NUMBERS STALE' };
  const { jobs, p50Ms: p50, p90Ms: p90, p50TargetMs: t50, p90TargetMs: t90 } = p;
  if (!jobs || !Number.isFinite(p50)) return { tone: 'off', text: 'NO JOBS IN 24 H' };
  if (Number.isFinite(t50) && Number.isFinite(t90) && p50 < t50 && p90 < t90) return { tone: 'ok', text: 'BOTH TARGETS MET' };
  if (Number.isFinite(t50) && p50 < t50) return { tone: 'ok', text: 'MEDIAN TARGET MET' };
  if (Number.isFinite(t50) && p50 < 3 * t50) return { tone: 'warn', text: 'BEHIND TARGET' };
  return { tone: 'bad', text: 'WELL BEHIND TARGET' };
}

const sentence = (s) => s.charAt(0) + s.slice(1).toLowerCase();

function laneTone(ms, targetMs) {
  if (!Number.isFinite(ms) || !Number.isFinite(targetMs)) return 'off';
  if (ms < targetMs) return 'ok';
  return ms < 3 * targetMs ? 'warn' : 'bad';
}

// One lane of the board: label, the time, its target, and a track the wait
// fills along once the lights go out, with a job dot at the leading edge.
function lane(L, i, y, label, ms, targetMs, css) {
  const { X0, TRACK } = L;
  const tone = TONE[laneTone(ms, targetMs)];
  const has = Number.isFinite(ms) && Number.isFinite(targetMs) && targetMs > 0;
  const w = has ? Math.round(Math.max(4, Math.min(TRACK, (ms / (SPAN * targetMs)) * TRACK))) : 0;
  const ty = y + L.trackDy, mid = X0 + TRACK / 2, r = L.bar / 2;
  // Lights out at 40% of the loop. Every lane fills at the same speed, the
  // full track in 30% of the loop, so a longer wait takes longer to draw.
  const end = 40 + (w / TRACK) * 30;
  css.push(`
  .bar${i} { transform-box: fill-box; transform-origin: left; animation: bar${i} ${LOOP}s linear infinite; }
  @keyframes bar${i} { 0%,40% { transform: scaleX(0) } ${end.toFixed(1)}%,100% { transform: scaleX(1) } }
  .job${i} { animation: job${i} ${LOOP}s linear infinite; }
  @keyframes job${i} { 0%,39.9% { transform: translateX(0); opacity: 0 } 40% { opacity: 1 } ${end.toFixed(1)}% { transform: translateX(${w}px); opacity: 1 } ${(end + 4).toFixed(1)}%,100% { transform: translateX(${w}px); opacity: 0 } }`);
  return `
  <text x="${X0}" y="${y}" font-size="${L.label}" fill="${C.dim}" letter-spacing="1.5">${esc(label)}</text>
  <text x="${X0}" y="${y + L.valueDy}" font-size="${L.value}" font-weight="700" fill="${tone}" filter="url(#glow)">${esc(fmtWait(ms))}</text>
  <text x="${X0 + TRACK}" y="${y + L.valueDy}" font-size="${L.target}" fill="${C.dim}" text-anchor="end">${Number.isFinite(targetMs) ? `target under ${esc(fmtWait(targetMs))}` : 'no target set'}</text>
  <rect x="${X0}" y="${ty}" width="${TRACK}" height="${L.bar}" rx="${r}" fill="${C.grid}" stroke="${C.edge}" stroke-width=".6"/>
  ${w ? `<rect class="bar bar${i}" x="${X0}" y="${ty}" width="${w}" height="${L.bar}" rx="${r}" fill="${tone}" opacity=".85"/>
  <circle class="job job${i}" cx="${X0 + 1}" cy="${ty + r}" r="${r}" fill="#fff" opacity="0" filter="url(#glow)"/>` : ''}
  <line x1="${mid}" x2="${mid}" y1="${ty - 5}" y2="${ty + L.bar + 5}" stroke="${C.lilac}" stroke-width="1.5"/>
  <text x="${mid}" y="${ty + L.tickDy}" font-size="${L.tick}" fill="${C.faint}" text-anchor="middle" letter-spacing="1">TARGET</text>
  <text x="${X0}" y="${ty + L.tickDy}" font-size="${L.tick}" fill="${C.faint}">0</text>
  <text x="${X0 + TRACK}" y="${ty + L.tickDy}" font-size="${L.tick}" fill="${C.faint}" text-anchor="end">${SPAN}× TARGET</text>`;
}

// The right-hand board: start lights, the job count, the verdict pill and
// the age of the numbers.
function board(p, v, now) {
  const tone = TONE[v.tone];
  const lamps = Array.from({ length: 5 }, (_, i) => `<circle class="lamp lamp${i}" cx="${i * 26}" cy="72" r="9" fill="${C.grid}" stroke="${C.edge}"/>`).join('\n    ');
  const pillW = Math.round(v.text.length * 8.1 + 26);
  return `
  <line x1="${RX - 22}" x2="${RX - 22}" y1="56" y2="276" stroke="${C.edge}"/>
  <g transform="translate(${RX} 0)">
    <rect x="-14" y="56" width="132" height="32" rx="8" fill="${C.bg}" stroke="${C.edge}"/>
    ${lamps}
    <text x="0" y="122" font-size="11" fill="${C.dim}" letter-spacing="1.5">JOBS · 24 H</text>
    <text x="0" y="176" font-size="58" font-weight="700" fill="${C.pink}" filter="url(#glow)">${p && Number.isFinite(p.jobs) ? n(p.jobs) : '-'}</text>
    <rect x="0" y="200" width="${pillW}" height="26" rx="13" fill="${tone}" fill-opacity=".14" stroke="${tone}"/>
    <text x="13" y="218" font-size="11" fill="${tone}" letter-spacing="1.5">${esc(v.text)}</text>
    <text x="0" y="256" font-size="12" fill="${C.dim}">${p ? `written ${ago(p.at, now)}` : 'no live numbers'}</text>
  </g>`;
}

// The same board for a phone: the count on the left, and the lights, the verdict and the age on the right.
function phoneBoard(p, v, now) {
  const tone = TONE[v.tone];
  const lamps = Array.from({ length: 5 }, (_, i) => `<circle class="lamp lamp${i}" cx="${i * 38}" cy="0" r="13" fill="${C.grid}" stroke="${C.edge}"/>`).join('\n    ');
  const pillW = Math.round(v.text.length * 12 + 34);
  return `
  <line x1="32" x2="608" y1="384" y2="384" stroke="${C.edge}"/>
  <text x="32" y="420" font-size="17" fill="${C.dim}" letter-spacing="1.5">JOBS · 24 H</text>
  <text x="32" y="490" font-size="72" font-weight="700" fill="${C.pink}" filter="url(#glow)">${p && Number.isFinite(p.jobs) ? n(p.jobs) : '-'}</text>
  <g transform="translate(608 0)">
    <g transform="translate(-165 420)">${lamps}</g>
    <rect x="${-pillW}" y="450" width="${pillW}" height="38" rx="19" fill="${tone}" fill-opacity=".14" stroke="${tone}"/>
    <text x="${-pillW / 2}" y="475" font-size="16" fill="${tone}" letter-spacing="1.5" text-anchor="middle">${esc(v.text)}</text>
    <text x="0" y="526" font-size="17" fill="${C.dim}" text-anchor="end">${p ? `written ${ago(p.at, now)}` : 'no live numbers'}</text>
  </g>`;
}

export function renderPitlane(d, { phone = false } = {}) {
  const L = phone ? PHONE : WIDE;
  const now = Date.parse(d.at);
  const p = d.pitlane ?? null;
  const v = verdict(p);
  const css = [];
  const lanes = lane(L, 0, L.lanes[0], 'QUEUE WAIT · MEDIAN', p?.p50Ms, p?.p50TargetMs, css)
    + lane(L, 1, L.lanes[1], 'QUEUE WAIT · P90, THE SLOW TAIL', p?.p90Ms, p?.p90TargetMs, css);
  const body = phone
    ? lanes + phoneBoard(p, v, now)
    : lanes + board(p, v, now) + `\n  <text x="${L.X0}" y="294" font-size="11.5" fill="${C.faint}">queue wait: from GitHub creating the job to our runner starting it, the whole wait before the logs begin</text>`;
  // Five lights come on one by one and all go out together, then the lanes run.
  const lamps = Array.from({ length: 5 }, (_, i) => `.lamp${i} { animation: lamp${i} ${LOOP}s linear infinite; }
  @keyframes lamp${i} { 0%,${(7.9 + i * 5).toFixed(1)}% { fill: ${C.grid} } ${8 + i * 5}%,39.9% { fill: ${C.block} } 40%,100% { fill: ${C.grid} } }`).join('\n  ');
  const title = p && Number.isFinite(p.jobs)
    ? `pitlane: ${n(p.jobs)} jobs in the last 24 hours, median queue wait ${fmtWait(p.p50Ms)} against a ${fmtWait(p.p50TargetMs)} target, p90 ${fmtWait(p.p90Ms)} against ${fmtWait(p.p90TargetMs)}. ${sentence(v.text)}.`
    : 'pitlane: no live numbers.';
  return frame({
    w: L.W,
    h: L.H,
    title,
    label: 'pitlane · queue wait',
    labelSize: phone ? 18 : 13,
    footer: phone ? '' : 'pitlane.askalf.org · last 24 hours',
    body,
    css: `${css.join('\n')}\n  ${lamps}`,
  });
}
