// What each product card says, from the live data. A figure that has never had a source reads as a
// dash; one whose source failed this hour keeps its last good value, under a heading that says so.
// The only fixed figures are ci-wizard's first audit, a published result, labelled as one.
import { join } from 'node:path';
import { C, n, hhmm, isLive } from './kit.mjs';
import { renderCard } from './card.mjs';
import { lifeOf } from './life.mjs';
import { fmtWait } from './pitlane.mjs';

const num = (v) => (Number.isFinite(v) ? n(v) : null);

// One line under the figures, short enough for the panel: a lead if the card has one, else the
// latest release, then the OpenSSF Scorecard. A field held over from an earlier run takes the whole
// line and says so, since the card's heading speaks only for its figures.
function foot(p, lead) {
  const score = Number.isFinite(p?.score) ? `Scorecard ${p.score.toFixed(1)}` : null;
  const held = p?.held ?? [];
  if (score && held.includes('score')) return `${score} (last good)`;
  if (!lead && p?.release && held.includes('release')) return `${p.release} (last good)`;
  return [lead ?? p?.release, score].filter(Boolean).join(' · ');
}

// What the Redline card's numbers cover: the day, the part of it the feed reached, or the day held
// over from the last run that could read it.
function verdictWindow(d) {
  const a = d.activity;
  if (!a) return 'NO FEED';
  if (!isLive(d, 'activity')) return `TO ${hhmm(a.to)} UTC`;
  return Date.parse(a.since) > Date.parse(a.from) ? `SINCE ${hhmm(a.since)}` : 'LAST 24 H';
}

const lastGood = (has) => (has ? 'LAST GOOD' : 'NO DATA');

const count = (d, lane) => (d.activity ? d.activity.notes.filter((x) => x.lane === lane).length : null);

export function cardSpecs(d) {
  const p = d.products ?? {};
  const pit = d.pitlane;
  const pitLive = Boolean(pit) && !pit.stale && isLive(d, 'pitlane');
  const darioLive = Boolean(d.installs && d.github) && isLive(d, 'installs') && isLive(d, 'github');
  return {
    'ci-wizard': {
      art: 'ci-wizard.jpg',
      panel: { x: 1220, y: 70, w: 520, h: 745 },
      title: 'ci-wizard reads a repository\'s GitHub Actions runs and reports where the time goes. Its first audit found a 9 second job, 79% of it fixed cost, running 1,746 times a week.',
      heading: 'FIRST AUDIT',
      live: false, // a published result, so it wears no live pip
      figures: [
        { value: '79%', label: 'fixed, on a 9 s job', color: C.pink },
        { value: '1,746', label: 'times a week' },
      ],
      foot: foot(p['ci-wizard']),
    },
    pitlane: {
      art: 'pitlane.jpg',
      panel: { x: 1200, y: 88, w: 538, h: 692 },
      title: `pitlane's self-hosted runners${pitLive ? ', live' : ', last good numbers'}: a job waits ${fmtWait(pit?.p50Ms)} at the median and ${fmtWait(pit?.p90Ms)} at the 90th percentile before a runner starts it.`,
      heading: pitLive ? 'LIVE' : lastGood(pit),
      live: pitLive,
      figures: [
        { value: fmtWait(pit?.p50Ms), label: 'median queue wait', color: C.allow },
        { value: fmtWait(pit?.p90Ms), label: 'p90, the slow tail' },
      ],
      foot: foot(p.pitlane, pitLive && Number.isFinite(pit.lastHourJobs) ? `${n(pit.lastHourJobs)} jobs/h` : null),
    },
    redline: {
      art: 'redline.jpg',
      panel: { x: 1202, y: 88, w: 536, h: 692 },
      title: 'Redline, the review gate every public askalf repository calls, and its verdicts of the day.',
      heading: verdictWindow(d),
      live: Boolean(d.activity) && isLive(d, 'activity'),
      figures: [
        { value: num(count(d, 'approve')), label: 'approved', color: C.allow },
        { value: num(count(d, 'changes')), label: 'changes requested', color: C.approve },
      ],
      foot: foot(p.ci),
    },
    dario: {
      art: 'dario-live.jpg',
      panel: { x: 1202, y: 90, w: 536, h: 688 },
      title: 'dario puts your Claude and ChatGPT subscriptions behind your coding tools through one local endpoint.',
      heading: darioLive ? 'LIVE' : lastGood(d.installs || d.github),
      live: darioLive,
      figures: [
        { value: num(d.installs?.last30), label: 'npm installs, 30 days', color: C.pink },
        { value: num(d.github?.darioStars), label: 'stars' },
      ],
      foot: foot(p.dario),
    },
  };
}

// Each card twice: the wide one, and the phone one the README's <picture> swaps in.
export function renderCards(d, cardsDir) {
  return Object.fromEntries(Object.entries(cardSpecs(d)).flatMap(([name, spec]) => {
    const card = { ...spec, artPath: join(cardsDir, spec.art), life: lifeOf(name, d) };
    return [[`card-${name}.svg`, renderCard(card)], [`card-${name}-phone.svg`, renderCard(card, { phone: true })]];
  }));
}
