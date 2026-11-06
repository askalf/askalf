// What makes a card breathe. On every card ALF blinks and the antennae glow, and the art then moves
// the way that product works. Where the art can carry a real count it does: on Redline one packet
// reaches the gate per verdict of the last 24 hours, at the hour it was given, and on pitlane one
// light runs per job of the last hour. CSS only, which is all GitHub's <img> sandbox allows, and
// every coordinate below is traced off the art in cards/, in its 1774 x 887 pixel space.
import { C } from './kit.mjs';
import { LOOP } from './score.mjs';

const HOUR_LOOP = 60; // pitlane's loop: a minute on the page for an hour of jobs
const TRAVEL = 3.6; // seconds a packet takes along its line
const MAX_LIGHTS = 150; // past this the lights read as one solid line, and each is an element

const streak = (d, { color = '#fff', width = 7, dur = 3.4, delay = 0 } = {}) =>
  `<path class="streak" d="${d}" pathLength="1000" stroke="${color}" stroke-width="${width}" style="animation-duration:${dur}s;animation-delay:${delay.toFixed(2)}s"/>`;

// The lid drops from the top of the eye, clipped to the opening so it can only ever cover the eye.
function lids(eyes) {
  const clips = eyes.map(([cx, cy, rx, ry, tilt], i) => `<clipPath id="eye${i}"><ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" transform="rotate(${tilt} ${cx} ${cy})"/></clipPath>`).join('');
  const shapes = eyes.map(([cx, cy, rx, ry, tilt], i) => `<g clip-path="url(#eye${i})"><g class="lid" style="transform-origin:${cx}px ${cy - ry - 3}px"><rect x="${cx - rx - 6}" y="${cy - ry - 6}" width="${2 * rx + 12}" height="${2 * ry + 12}" fill="url(#skin)" transform="rotate(${tilt} ${cx} ${cy})"/><path d="M${cx - rx - 6} ${cy + ry + 2}Q${cx} ${cy + ry + 10} ${cx + rx + 6} ${cy + ry + 2}" stroke="#2a0b5c" stroke-width="4" fill="none" transform="rotate(${tilt} ${cx} ${cy})"/></g></g>`).join('');
  return { clips, shapes };
}

const bulbs = (points) => points.map(([x, y], i) => `<circle class="bulb" cx="${x}" cy="${y}" r="62" fill="url(#halo)" style="transform-origin:${x}px ${y}px;animation-delay:${(i * 1.3).toFixed(1)}s"/>`).join('');

const COMMON_DEFS = `<radialGradient id="halo"><stop offset="0" stop-color="#fff" stop-opacity=".9"/><stop offset=".35" stop-color="#f0abfc" stop-opacity=".7"/><stop offset="1" stop-color="#c026d3" stop-opacity="0"/></radialGradient>
  <radialGradient id="skin" cx=".5" cy=".62" r=".62"><stop offset="0" stop-color="#8a42e2"/><stop offset=".6" stop-color="#6f30ca"/><stop offset="1" stop-color="#44189a"/></radialGradient>
  <filter id="line" x="-20%" y="-60%" width="140%" height="220%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;

const COMMON_CSS = `
  .streak { fill: none; stroke-linecap: round; stroke-dasharray: 60 2000; stroke-dashoffset: 60; opacity: 0; animation: run 3.4s cubic-bezier(.45,.05,.55,.95) infinite; filter: url(#line); }
  @keyframes run { 0% { stroke-dashoffset: 60; opacity: 0 } 8% { opacity: 1 } 82% { opacity: 1 } 100% { stroke-dashoffset: -1000; opacity: 0 } }
  .bulb { mix-blend-mode: screen; opacity: .3; animation: breathe 2.6s ease-in-out infinite; }
  @keyframes breathe { 0%,100% { opacity: .22; transform: scale(.85) } 50% { opacity: .95; transform: scale(1.08) } }
  .lid { transform: scaleY(0); animation: blink 6.4s infinite; }
  @keyframes blink { 0%,91% { transform: scaleY(0) } 93.5% { transform: scaleY(1.02) } 96% { transform: scaleY(0) } 97.2% { transform: scaleY(0) } 98.4% { transform: scaleY(1.02) } 100% { transform: scaleY(0) } }
  .swell { mix-blend-mode: screen; opacity: .2; animation: swell 5.2s ease-in-out infinite; }
  @keyframes swell { 0%,100% { opacity: .12 } 50% { opacity: .8 } }`;

function ciWizard() {
  // The job's timeline. The beam spends 79% of each run before it reaches the work pill, the share
  // the first audit measured, so the wait you watch is the finding.
  const T = 11;
  const PILLS = [[342, 460], [493, 650], [696, 817], [857, 977], [1018, 1170]];
  const WORK_X = PILLS[4][0], BEAM_W = 150;
  const clip = PILLS.map(([a, b]) => `<rect x="${a}" y="484" width="${b - a}" height="44" rx="19"/>`).join('');
  const LINES = [
    'M0 152L24 152L48 152L72 152L95 156L114 170L127 188L142 206L163 216L185 218',
    'M0 208L24 208L48 208L70 209L93 216L111 230L134 237L157 237L182 238L185 238',
    'M0 271L24 271L48 271L72 271L95 271L118 269L139 259L161 256L185 256',
    'M0 322L24 322L49 322L72 317L89 303L104 285L121 269L142 259L164 256L185 255',
    'M1078 222L1101 218L1118 204L1130 185L1147 169L1169 163L1188 163',
    'M1078 238L1104 238L1127 238L1148 243L1165 259L1186 265L1200 266',
    'M1078 255L1101 258L1120 271L1132 290L1147 308L1169 315L1188 316',
  ];
  return {
    bulbs: [[106, 420], [237, 373]],
    eyes: [[205, 574, 43, 33, 5], [302, 527, 25, 34, -12]],
    defs: `<clipPath id="pills">${clip}</clipPath>
  <clipPath id="lens"><circle cx="522" cy="522" r="140"/></clipPath>
  <linearGradient id="beam"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".75" stop-color="#e9d5ff" stop-opacity=".8"/><stop offset="1" stop-color="#fff" stop-opacity=".95"/></linearGradient>
  <linearGradient id="band" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#f5d0fe" stop-opacity=".22"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>`,
    css: `
  .beam { animation: beam ${T}s linear infinite; }
  @keyframes beam { 0% { transform: translateX(0) } 79% { transform: translateX(${WORK_X - PILLS[0][0]}px) } 100% { transform: translateX(${PILLS[4][1] - PILLS[0][0] + BEAM_W}px) } }
  .flare { mix-blend-mode: screen; opacity: 0; animation: flare ${T}s linear infinite; }
  @keyframes flare { 0%,78% { opacity: 0 } 82% { opacity: .85 } 98% { opacity: .7 } 100% { opacity: 0 } }
  .band { animation: band 8s ease-in-out infinite; }
  @keyframes band { 0%,55% { transform: translateX(-340px) } 100% { transform: translateX(340px) } }`,
    over: `${LINES.map((d, i) => streak(d, { dur: 4.2, delay: i * 0.6 })).join('')}
<g clip-path="url(#pills)"><rect class="beam" x="${PILLS[0][0] - BEAM_W}" y="480" width="${BEAM_W}" height="52" fill="url(#beam)"/></g>
<rect class="flare" x="1018" y="484" width="152" height="44" rx="19" fill="#f0abfc"/>
<g clip-path="url(#lens)"><rect class="band" x="440" y="340" width="170" height="370" fill="url(#band)" transform="rotate(24 522 522)"/></g>`,
  };
}

function pitlane(d) {
  // One light per job of the last hour, evenly through a one-minute loop, so the lane runs as busy
  // as the runners did. They split across the two painted lines, on into the open bay.
  const jobs = d.pitlane?.stale ? 0 : d.pitlane?.lastHourJobs;
  const lights = Math.min(Number.isFinite(jobs) ? jobs : 0, MAX_LIGHTS);
  const LANES = ['M430 662C640 672 900 690 1200 712', 'M418 690C640 716 900 744 1200 778'];
  const marks = Array.from({ length: lights }, (_, i) => `<path class="car" d="${LANES[i % 2]}" pathLength="1000" stroke="${i % 2 ? C.pink : C.lilac}" style="animation-delay:${((i * HOUR_LOOP) / lights).toFixed(2)}s"/>`).join('');
  return {
    bulbs: [[194, 300], [393, 337]],
    eyes: [[249, 537, 43, 38, 5], [364, 551, 22, 34, 20]],
    defs: `<radialGradient id="bay" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#f0abfc" stop-opacity=".5"/><stop offset="1" stop-color="#c026d3" stop-opacity="0"/></radialGradient>`,
    css: `
  .car { fill: none; stroke-width: 9; stroke-linecap: round; stroke-dasharray: 54 2000; stroke-dashoffset: 54; opacity: 0; animation: car ${HOUR_LOOP}s linear infinite; }
  @keyframes car { 0% { stroke-dashoffset: 54; opacity: 0 } .6% { opacity: 1 } 5% { opacity: 1 } 5.6% { stroke-dashoffset: -1000; opacity: 0 } 100% { stroke-dashoffset: -1000; opacity: 0 } }
  .comms { opacity: .25; animation: comms 2.2s ease-out infinite; transform-box: fill-box; transform-origin: center; }
  @keyframes comms { 0% { opacity: .9; transform: scale(1) } 70%,100% { opacity: 0; transform: scale(1.22) } }`,
    over: `<ellipse class="swell" cx="958" cy="560" rx="240" ry="210" fill="url(#bay)"/>
<ellipse class="comms" cx="106" cy="500" rx="28" ry="42" fill="none" stroke="#f5d0fe" stroke-width="4"/>
<g>${marks}</g>`,
  };
}

function redline(d) {
  // The day's verdicts, on the art's own two lines. An approval runs through the gate and on; a
  // change request stops at the gate. Each leaves at its moment of the day on the same LOOP as the score.
  const notes = d.activity?.notes ?? [];
  const PASS = 'M380 467L429 467L452 465L470 451L486 434L502 418L520 404L543 401H1121L1143 399L1161 386L1179 372L1200 369';
  const HOLD = 'M375 570L447 570L469 575L487 590L502 607L517 623L535 637L557 640H664C705 640 730 605 796 605';
  const GATE_AT = TRAVEL * 0.53; // how far along PASS the gate falls
  const at = (x) => x.t * LOOP;
  const pack = (x, line, color) => `<path class="pk" d="${line}" pathLength="1000" stroke="${color}" style="animation-delay:${at(x).toFixed(2)}s"/>`;
  const hit = (x, cy, lag, color) => `<circle class="hit" cx="812" cy="${cy}" r="22" fill="none" stroke="${color}" stroke-width="5" style="animation-delay:${(at(x) + lag).toFixed(2)}s"/>`;
  const passed = notes.filter((x) => x.lane === 'approve');
  const held = notes.filter((x) => x.lane === 'changes');
  return {
    bulbs: [[154, 278], [352, 295]],
    eyes: [[232, 491, 43, 36, 5], [349, 496, 21, 33, 14]],
    defs: `<radialGradient id="gate" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fb4f6d" stop-opacity=".6"/><stop offset=".6" stop-color="#fb4f6d" stop-opacity=".22"/><stop offset="1" stop-color="#fb4f6d" stop-opacity="0"/></radialGradient>`,
    css: `
  .pk { fill: none; stroke-width: 7; stroke-linecap: round; stroke-dasharray: 44 2000; stroke-dashoffset: 44; opacity: 0; animation: pk ${LOOP}s linear infinite; }
  @keyframes pk { 0% { stroke-dashoffset: 44; opacity: 0 } .5% { opacity: 1 } ${((TRAVEL / LOOP) * 100 - 0.4).toFixed(2)}% { opacity: 1 } ${((TRAVEL / LOOP) * 100).toFixed(2)}% { stroke-dashoffset: -1000; opacity: 0 } 100% { stroke-dashoffset: -1000; opacity: 0 } }
  .hit { opacity: 0; transform-box: fill-box; transform-origin: center; animation: hit ${LOOP}s linear infinite; }
  @keyframes hit { 0% { opacity: 1; transform: scale(.7) } 2.4% { opacity: 0; transform: scale(2.6) } 100% { opacity: 0 } }`,
    over: `<ellipse class="swell" cx="812" cy="516" rx="64" ry="300" fill="url(#gate)"/>
<g>${passed.map((x) => pack(x, PASS, C.allow)).join('')}${held.map((x) => pack(x, HOLD, C.approve)).join('')}</g>
<g>${passed.map((x) => hit(x, 402, GATE_AT, C.allow)).join('')}${held.map((x) => hit(x, 605, TRAVEL - 0.1, C.approve)).join('')}</g>`,
  };
}

function dario() {
  // Requests leave each tool for the one local endpoint, and leave it again for a plan.
  const IN = [
    'M306 311L330 311L354 315L372 328L385 347L394 371L400 393L405 416L410 439L417 461L428 483L443 501L452 507',
    'M306 398L330 399L353 402L372 416L385 436L394 457L405 480L418 498L436 513L451 521',
    'M306 485L330 485L353 487L375 496L393 509L412 523L435 530L448 533',
    'M306 572L330 572L354 571L376 566L397 557L418 551L441 549L448 549',
    'M306 660L330 659L352 657L372 644L386 625L397 605L410 585L429 571L450 565',
    'M306 748L330 748L353 745L373 734L387 715L395 695L401 672L406 648L412 626L423 603L440 586L454 581',
  ];
  const OUT = [
    'M835 525L853 512L858 490L858 467L861 444L874 425L897 423L910 423',
    'M835 562L853 574L858 596L859 618L870 638L893 645L910 645',
  ];
  return {
    bulbs: [[558, 306], [696, 278]],
    eyes: [[628, 402, 22, 18.5, 0], [704, 383, 18, 18.5, 0]],
    defs: `<radialGradient id="port" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#e879f9" stop-opacity=".55"/><stop offset="1" stop-color="#c026d3" stop-opacity="0"/></radialGradient>`,
    css: '',
    over: `<ellipse class="swell" cx="642" cy="548" rx="240" ry="96" fill="url(#port)"/>
${IN.map((d, i) => streak(d, { dur: 3, delay: i * 0.5 })).join('')}${OUT.map((d, i) => streak(d, { color: '#f0abfc', dur: 1.5, delay: 1.1 + i * 1.5 })).join('')}`,
  };
}

const CARDS = { 'ci-wizard': ciWizard, pitlane, redline, dario };

// One card's moving layers: { css, defs, over } to lay over the art and under the figures.
export function lifeOf(name, d) {
  const l = CARDS[name](d);
  const { clips, shapes } = lids(l.eyes);
  return {
    css: `${COMMON_CSS}${l.css}`,
    defs: `${COMMON_DEFS}\n  ${clips}\n  ${l.defs}`,
    over: `${l.over}\n<g>${bulbs(l.bulbs)}</g>\n<g>${shapes}</g>`,
  };
}
