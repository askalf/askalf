// The score: the last 24 hours of the operation as a piano roll. Each lane is a kind of work and
// each note is one real public event, set at the moment it happened; the jobs lane is pitlane's
// count for each hour. A playhead sweeps the day in LOOP seconds, and every note flares as it is
// passed, so the panel plays back what actually happened and nothing here is decoration.
import { C, esc, n, frame, hhmm, isLive } from './kit.mjs';

const DAY = 864e5;
export const LOOP = 48;

// The same score at two widths: a phone shows it at about a third of the desktop size, so its
// version is drawn narrower with larger type rather than scaled down.
const WIDE = { W: 1200, X0: 182, TW: 990, JOBS_Y: 62, JOBS_H: 92, LANE_Y: 170, LANE_H: 54, label: 14, count: 19, jobs: 24, jobsLabel: 15, axis: 13, mark: 4, ticks: [0, 6, 12, 18], footer: `each mark is one real event · ${LOOP} s = 24 h` };
const PHONE = { W: 640, X0: 150, TW: 470, JOBS_Y: 62, JOBS_H: 96, LANE_Y: 176, LANE_H: 66, label: 17, count: 24, jobs: 27, jobsLabel: 18, axis: 16, mark: 3, ticks: [0, 12], footer: '' };

// In the order work moves: pushed, gated by Redline, merged, released.
export const LANES = [
  { id: 'push', label: 'pushes', color: C.blue },
  { id: 'changes', label: 'changes asked', color: C.approve },
  { id: 'approve', label: 'approved', color: C.allow },
  { id: 'merge', label: 'merged', color: C.magenta },
  { id: 'release', label: 'released', color: C.pink },
];

const axisY = (L) => L.LANE_Y + LANES.length * L.LANE_H;
const heightOf = (L) => axisY(L) + 44;

const delay = (t) => (t * LOOP).toFixed(2);

// pitlane and the events feed fail apart, so the lane answers to the axis: only the hours inside its
// window are drawn, and the total is of those hours. Numbers held over from an earlier run say when
// they stop, in place of the plain label.
function jobsLabel(d) {
  const p = d.pitlane;
  if (!p || (!p.stale && isLive(d, 'pitlane'))) return 'jobs run';
  return Number.isFinite(Date.parse(p.at)) ? `to ${hhmm(p.at)}` : 'last good';
}

function jobsLane(L, d, fromMs) {
  const rows = (d.pitlane?.hours ?? [])
    .map((h) => ({ ...h, t: (Date.parse(h.from) - fromMs) / DAY }))
    .filter((h) => Number.isFinite(h.jobs) && h.t >= -0.05 && h.t < 1);
  const top = Math.max(1, ...rows.map((h) => h.jobs));
  const bw = L.TW / 24;
  const total = rows.reduce((s, h) => s + h.jobs, 0);
  const bars = rows.map(({ jobs, t }) => {
    const bh = Math.max(3, (jobs / top) * (L.JOBS_H - 12));
    const x = L.X0 + Math.max(0, t) * L.TW;
    return `<rect class="bar" x="${x.toFixed(1)}" y="${(L.JOBS_Y + L.JOBS_H - bh).toFixed(1)}" width="${(bw - Math.min(5, bw / 4)).toFixed(1)}" height="${bh.toFixed(1)}" rx="3" fill="url(#jobsFill)" style="animation-delay:${delay(Math.max(0, t))}s"/>`;
  }).join('');
  return `<text x="${L.X0 - 18}" y="${L.JOBS_Y + 44}" text-anchor="end" font-size="${L.jobsLabel}" fill="${C.lilac}">${esc(jobsLabel(d))}</text>
<text x="${L.X0 - 18}" y="${L.JOBS_Y + 74}" text-anchor="end" font-size="${L.jobs}" font-weight="700" fill="${C.text}">${rows.length ? n(total) : '-'}</text>${bars}`;
}

function lane(L, l, i, notes) {
  const y = L.LANE_Y + i * L.LANE_H;
  const mine = notes.filter((x) => x.lane === l.id);
  const marks = mine.map((x) => `<rect class="n" x="${(L.X0 + x.t * L.TW - L.mark / 2).toFixed(1)}" y="${y + 14}" width="${L.mark}" height="${L.LANE_H - 28}" rx="${L.mark / 2}" fill="${l.color}" style="animation-delay:${delay(x.t)}s"/>`).join('');
  return `<line x1="${L.X0}" y1="${y + L.LANE_H / 2}" x2="${L.X0 + L.TW}" y2="${y + L.LANE_H / 2}" stroke="${C.grid}" stroke-width="1"/>
<text x="${L.X0 - 18}" y="${y + L.LANE_H * 0.44}" text-anchor="end" font-size="${L.label}" fill="${C.dim}">${esc(l.label)}</text>
<text x="${L.X0 - 18}" y="${y + L.LANE_H * 0.82}" text-anchor="end" font-size="${L.count}" font-weight="700" fill="${l.color}">${n(mine.length)}</text>${marks}`;
}

function axis(L, fromMs, edge) {
  const ticks = L.ticks.map((h) => {
    const x = L.X0 + (h / 24) * L.TW;
    return `<line x1="${x}" y1="${L.JOBS_Y - 6}" x2="${x}" y2="${axisY(L)}" stroke="${C.grid}" stroke-width="1"/>
<text x="${x}" y="${axisY(L) + 24}" font-size="${L.axis}" fill="${C.faint}">${hhmm(fromMs + h * 36e5)}</text>`;
  }).join('');
  return `${ticks}<text x="${L.X0 + L.TW}" y="${axisY(L) + 24}" text-anchor="end" font-size="${L.axis}" fill="${C.lilac}">${esc(edge)}</text>`;
}

// The part of the day the feed could not reach, shaded and named, so a gap never reads as a quiet morning.
function gap(L, fromMs, sinceMs) {
  const w = ((sinceMs - fromMs) / DAY) * L.TW;
  if (!(w > 0)) return '';
  const y = L.LANE_Y, h = axisY(L) - L.LANE_Y;
  return `<rect x="${L.X0}" y="${y}" width="${w.toFixed(1)}" height="${h}" fill="${C.bg}" fill-opacity=".72"/>
<text x="${L.X0 + 10}" y="${y + h / 2}" font-size="${L.axis}" fill="${C.dim}">no feed before ${hhmm(sinceMs)}</text>`;
}

export function renderScore(d, { phone = false } = {}) {
  const L = phone ? PHONE : WIDE;
  const H = heightOf(L);
  const a = d.activity;
  const toMs = Date.parse(a?.to ?? d.at);
  const fromMs = toMs - DAY;
  const notes = a?.notes ?? [];
  // A day held over from an earlier run is still a real day, so it plays, but under its own date.
  const live = isLive(d, 'activity');
  const edge = live ? 'now, UTC' : `${hhmm(toMs)} UTC`;
  const top = L.JOBS_Y - 6, tall = axisY(L) - L.JOBS_Y + 6;
  const body = a
    ? `${axis(L, fromMs, edge)}${jobsLane(L, d, fromMs)}${LANES.map((l, i) => lane(L, l, i, notes)).join('')}${gap(L, fromMs, Date.parse(a.since))}
<g class="head"><rect x="${L.X0 - 70}" y="${top}" width="70" height="${tall}" fill="url(#trail)"/><rect x="${L.X0 - 1}" y="${top}" width="2" height="${tall}" fill="${C.pink}" filter="url(#glow)"/></g>`
    : `<text x="${L.W / 2}" y="${H / 2}" text-anchor="middle" font-size="16" fill="${C.dim}">The activity feed did not answer this hour.</text>`;
  const counts = LANES.map((l) => `${notes.filter((x) => x.lane === l.id).length} ${l.label}`).join(', ');
  return frame({
    w: L.W,
    h: H,
    title: `${live ? 'The last 24 hours' : `The 24 hours to ${hhmm(toMs)} UTC`} of the operation, played back: ${counts}, and pitlane's jobs for each hour. Each mark is one public event at the time it happened.`,
    label: live ? (phone ? 'the last 24 hours' : 'the last 24 hours, played back') : `the 24 hours to ${hhmm(toMs)} UTC`,
    labelSize: phone ? 18 : 13,
    footer: L.footer,
    css: `
  .n { opacity: .34; transform-box: fill-box; transform-origin: center; animation: hit ${LOOP}s linear infinite; }
  .bar { opacity: .5; animation: lift ${LOOP}s linear infinite; }
  .head { animation: sweep ${LOOP}s linear infinite; }
  @keyframes hit { 0% { opacity: 1; transform: scaleY(1.7) scaleX(1.5) } 5% { opacity: .75; transform: scaleY(1) scaleX(1) } 16% { opacity: .34 } 100% { opacity: .34 } }
  @keyframes lift { 0% { opacity: 1 } 7% { opacity: .85 } 20% { opacity: .5 } 100% { opacity: .5 } }
  @keyframes sweep { from { transform: translateX(0) } to { transform: translateX(${L.TW}px) } }
  @media (prefers-reduced-motion: reduce) { .n, .bar { opacity: .9 } .head { display: none } }`,
    defs: `<linearGradient id="jobsFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.pink}"/><stop offset="1" stop-color="${C.violet}"/></linearGradient>
  <linearGradient id="trail" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${C.magenta}" stop-opacity="0"/><stop offset="1" stop-color="${C.magenta}" stop-opacity=".2"/></linearGradient>`,
    body,
  });
}
