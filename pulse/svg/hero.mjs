// The hero, alive: the same art as hero.jpg, with signal running through the
// circuit lines into the wordmark and on to ALF, antennae that breathe, a
// shimmer across the letters, and a blink. Pure CSS animation, so it runs
// inside GitHub's <img> sandbox and stops for prefers-reduced-motion.
import { readFileSync } from 'node:fs';

// Circuit lines traced off hero.jpg (1774×887 pixel space).
const INBOUND = [ // left edge to wordmark
  'M0 256H145C200 256 200 352 255 352H265',
  'M0 320H80C135 320 135 385 190 385H248',
  'M0 406H247',
  'M0 501H80C150 501 150 421 215 421H249',
];
const OUTBOUND = [ // wordmark to ALF
  'M980 384H1012C1065 384 1065 307 1118 307H1183',
  'M978 408H1062C1115 408 1115 469 1168 469H1205',
  'M976 424H1018C1068 424 1068 538 1118 538H1183',
];
const ANTENNAE = [[1262.5, 101], [1624, 137.5]];
// Eye openings: [cx, cy, rx, ry, tilt°]
const EYES = [[1280, 390, 57, 57, 0], [1514, 416, 63, 58, -8]];

export function renderHero({ heroPath }) {
  const jpg = readFileSync(heroPath).toString('base64');
  const streak = (d, i, dir, n) => {
    const dur = dir === 'in' ? 3.6 : 3.0;
    const delay = dir === 'in' ? (i * 0.9) % dur : 1.8 + i * 0.7;
    return `<path class="streak ${dir}" d="${d}" pathLength="1000" style="animation-duration:${dur}s;animation-delay:${delay.toFixed(2)}s"/>`;
  };
  const lids = EYES.map(([cx, cy, rx, ry, t], i) => `
    <clipPath id="eye${i}"><ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" transform="rotate(${t} ${cx} ${cy})"/></clipPath>
    `).join('');
  const lidShapes = EYES.map(([cx, cy, rx, ry, t], i) => `
    <g clip-path="url(#eye${i})">
      <g class="lid" filter="url(#lidsoft)" style="transform-origin:${cx}px ${cy - ry}px">
        <rect x="${cx - rx - 4}" y="${cy - ry - 4}" width="${2 * rx + 8}" height="${2 * ry + 8}" fill="url(#skin)" transform="rotate(${t} ${cx} ${cy})"/>
        <path d="M${cx - rx - 4} ${cy + ry + 2}Q${cx} ${cy + ry + 12} ${cx + rx + 4} ${cy + ry + 2}" stroke="#2a0b5c" stroke-width="5" fill="none" transform="rotate(${t} ${cx} ${cy})"/>
      </g>
    </g>`).join('');
  const bulbs = ANTENNAE.map(([x, y], i) => `
    <circle class="bulb" cx="${x}" cy="${y}" r="70" fill="url(#halo)" style="transform-origin:${x}px ${y}px;animation-delay:${i * 1.3}s"/>`).join('');
  // Twinkling dust in the empty dark field, placed deterministically.
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const dust = Array.from({ length: 34 }, () => {
    let x, y;
    do { x = rnd() * 1774; y = rnd() * 887; }
    while ((x > 240 && x < 1000 && y > 280 && y < 620) || (x > 1130 && y > 60));
    return `<circle class="dust" cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${(0.8 + rnd() * 1.6).toFixed(1)}" style="animation-delay:-${(rnd() * 6).toFixed(2)}s;animation-duration:${(3 + rnd() * 4).toFixed(2)}s"/>`;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1774 887" width="1774" height="887" role="img" aria-labelledby="t">
<title id="t">askalf. Own Your Agent Security. Own Your Stack. ALF, the violet alien mascot, blinks beside the askalf wordmark while signal runs along neon circuit lines.</title>
<style>
  .streak { fill: none; stroke-linecap: round; stroke-dasharray: 70 2000; stroke-dashoffset: 70; opacity: 0; animation-name: run; animation-timing-function: cubic-bezier(.45,.05,.55,.95); animation-iteration-count: infinite; filter: url(#glow); }
  .streak.in { stroke: #f5d0fe; stroke-width: 5; }
  .streak.out { stroke: #e9d5ff; stroke-width: 4; }
  @keyframes run { 0% { stroke-dashoffset: 70; opacity: 0 } 8% { opacity: 1 } 80% { opacity: 1 } 100% { stroke-dashoffset: -1000; opacity: 0 } }
  .bulb { mix-blend-mode: screen; animation: breathe 2.6s ease-in-out infinite; opacity: .35 }
  @keyframes breathe { 0%,100% { opacity: .25; transform: scale(.85) } 50% { opacity: .95; transform: scale(1.08) } }
  .lid { transform: scaleY(0); animation: blink 6.4s infinite; }
  @keyframes blink { 0%,91% { transform: scaleY(0) } 93.5% { transform: scaleY(1.02) } 96% { transform: scaleY(0) } 97.2% { transform: scaleY(0) } 98.4% { transform: scaleY(1.02) } 100% { transform: scaleY(0) } }
  .aura { opacity: .15; animation: aura 5.2s ease-in-out infinite; }
  @keyframes aura { 0%,100% { opacity: .1 } 50% { opacity: .75 } }
  .dust { fill: #e9d5ff; opacity: 0; animation-name: twinkle; animation-iteration-count: infinite; animation-timing-function: ease-in-out; }
  @keyframes twinkle { 0%,100% { opacity: 0 } 50% { opacity: .75 } }
  @media (prefers-reduced-motion: reduce) { * { animation: none !important } }
</style>
<defs>
  <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <radialGradient id="halo"><stop offset="0" stop-color="#fff" stop-opacity=".9"/><stop offset=".35" stop-color="#f0abfc" stop-opacity=".7"/><stop offset="1" stop-color="#c026d3" stop-opacity="0"/></radialGradient>
  <radialGradient id="skin" cx=".5" cy=".62" r=".62"><stop offset="0" stop-color="#8440dc"/><stop offset=".6" stop-color="#6c2ec6"/><stop offset="1" stop-color="#3f168e"/></radialGradient>
  <filter id="soft" x="-10%" y="-20%" width="120%" height="140%"><feGaussianBlur stdDeviation="14"/></filter>
  <filter id="lidsoft"><feGaussianBlur stdDeviation="1.2"/></filter>
  <filter id="bright" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  .3 .5 .2 0 -.55"/><feComponentTransfer><feFuncA type="linear" slope="3"/></feComponentTransfer></filter>
  <mask id="letters" maskUnits="userSpaceOnUse" x="250" y="280" width="740" height="330"><use href="#img" filter="url(#bright)"/></mask>
  ${lids}
</defs>
<image id="img" href="data:image/jpeg;base64,${jpg}" width="1774" height="887"/>
<g>${dust}</g>
<g class="aura" filter="url(#soft)" style="mix-blend-mode:screen"><rect x="250" y="280" width="740" height="330" fill="#c084fc" mask="url(#letters)"/></g>
<g>${INBOUND.map((d, i) => streak(d, i, 'in')).join('')}${OUTBOUND.map((d, i) => streak(d, i, 'out')).join('')}</g>
<g>${bulbs}</g>
<g>${lidShapes}</g>
</svg>
`;
}
