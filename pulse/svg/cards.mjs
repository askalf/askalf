// What each product card says, from the live data. A figure with no source this hour reads as a
// dash rather than as an old number, and the only fixed figures are ci-wizard's first audit, which
// is a published result, labelled as one.
import { join } from 'node:path';
import { C, n } from './kit.mjs';
import { renderCard } from './card.mjs';
import { lifeOf } from './life.mjs';
import { fmtWait } from './pitlane.mjs';

const num = (v) => (Number.isFinite(v) ? n(v) : null);

// One line under the figures, short enough for the panel: a lead if the card has one, else the
// latest release, then the OpenSSF Scorecard.
function foot(p, lead) {
  const parts = [lead ?? p?.release, Number.isFinite(p?.score) ? `Scorecard ${p.score.toFixed(1)}` : null].filter(Boolean);
  return parts.join(' · ');
}

const count = (d, lane) => (d.activity ? d.activity.notes.filter((x) => x.lane === lane).length : null);

export function cardSpecs(d) {
  const p = d.products ?? {};
  const pit = d.pitlane;
  return {
    'ci-wizard': {
      art: 'ci-wizard.jpg',
      panel: { x: 1220, y: 70, w: 520, h: 745 },
      title: 'ci-wizard reads a repository\'s GitHub Actions runs and reports where the time goes. Its first audit found a 9 second job, 79% of it fixed cost, running 1,746 times a week.',
      heading: 'FIRST AUDIT',
      figures: [
        { value: '79%', label: 'fixed, on a 9 s job', color: C.pink },
        { value: '1,746', label: 'times a week' },
      ],
      foot: foot(p['ci-wizard']),
    },
    pitlane: {
      art: 'pitlane.jpg',
      panel: { x: 1200, y: 88, w: 538, h: 692 },
      title: `pitlane's self-hosted runners, live: a job waits ${fmtWait(pit?.p50Ms)} at the median and ${fmtWait(pit?.p90Ms)} at the 90th percentile before a runner starts it.`,
      heading: 'LIVE',
      figures: [
        { value: fmtWait(pit?.p50Ms), label: 'median queue wait', color: C.allow },
        { value: fmtWait(pit?.p90Ms), label: 'p90, the slow tail' },
      ],
      foot: foot(p.pitlane, Number.isFinite(pit?.lastHourJobs) ? `${n(pit.lastHourJobs)} jobs/h` : null),
    },
    redline: {
      art: 'redline.jpg',
      panel: { x: 1202, y: 88, w: 536, h: 692 },
      title: 'Redline, the review gate every public askalf repository calls, and its verdicts in the last 24 hours.',
      heading: 'LAST 24 H',
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
      heading: 'LIVE',
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
