// node --test pulse/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OWN, inReviewFrom, recentEvents, tallyPerDay, pitlaneFrom, notesFrom, feedFrom, mergeNotes, coveredSince, productFrom, settle, activityFrom } from './data.mjs';
import { renderScore, LANES, LOOP } from './svg/score.mjs';
import { renderCards, cardSpecs } from './svg/cards.mjs';
import { renderHero, heroLine } from './svg/hero.mjs';
import { renderOrbit } from './svg/orbit.mjs';
import { renderPitlane, fmtWait } from './svg/pitlane.mjs';

const DAY = 864e5;
const now = Date.parse('2026-09-25T02:00:00Z');
const mine = new Set(OWN);
const item = (repo, number) => ({ repository_url: `https://api.github.com/repos/${repo}`, number, title: `#${number}` });
const ev = (id, at, type = 'PushEvent') => ({ id: String(id), created_at: at, type, repo: { name: 'askalf/dario' }, payload: { ref: 'refs/heads/main' } });
const pages = (...batches) => async (page) => batches[page - 1] ?? [];

test('in review excludes the staging forks under sprayberry-code', () => {
  const items = [item('ossf/scorecard', 5239), item('sprayberry-code/cvat', 1), item('Sprayberry-Code/dimos', 1), item('askalf/askalf', 54)];
  assert.deepEqual(inReviewFrom(items, mine).map((p) => p.repo), ['ossf/scorecard']);
});

test('events fetch stops at the last event already counted', async () => {
  const get = pages([ev(30, '2026-09-25T01:00:00Z'), ev(20, '2026-09-25T00:00:00Z'), ev(10, '2026-09-24T23:00:00Z')]);
  const r = await recentEvents(get, '20');
  assert.deepEqual(r.events.map((e) => e.id), ['30']);
  assert.equal(r.complete, true);
});

test('events fetch reads every page it is given before calling itself complete', async () => {
  const full = (base) => Array.from({ length: 100 }, (_, i) => ev(base - i, '2026-09-25T00:00:00Z'));
  const seen = [];
  const get = async (page) => { seen.push(page); return page < 3 ? full(1000 - (page - 1) * 100) : full(800).slice(0, 5); };
  const r = await recentEvents(get, undefined);
  assert.deepEqual(seen, [1, 2, 3]);
  assert.equal(r.events.length, 205);
  assert.equal(r.complete, true);
});

test('events fetch reports a gap when the pages run out before the last counted event', async () => {
  const full = (base) => Array.from({ length: 100 }, (_, i) => ev(base - i, '2026-09-25T00:00:00Z'));
  const get = pages(full(1000), full(900), full(800));
  const r = await recentEvents(get, '5');
  assert.equal(r.events.length, 300);
  assert.equal(r.complete, false);
});

test('per-day tally carries the previous run forward and adds only the new events', () => {
  const previous = {
    since: '2026-09-18T12:00:00Z',
    lastEventId: '10',
    perDay: [{ day: '2026-09-22', n: 4 }, { day: '2026-09-24', n: 30 }],
  };
  const fetched = { events: [ev(12, '2026-09-25T01:30:00Z'), ev(11, '2026-09-24T23:30:00Z')], complete: true };
  const t = tallyPerDay(previous, fetched, now);
  const by = Object.fromEntries(t.perDay.map((d) => [d.day, d]));
  assert.equal(t.perDay.length, 14);
  assert.equal(by['2026-09-22'].n, 4);
  assert.equal(by['2026-09-24'].n, 31);
  assert.equal(by['2026-09-25'].n, 1);
  assert.equal(t.since, previous.since);
  assert.equal(t.lastEventId, '12');
  // since is midday on 09-18, so 09-18 itself is only partly counted.
  assert.deepEqual(t.perDay.map((d) => d.covered), [false, false, false, false, false, false, false, true, true, true, true, true, true, true]);
});

test('per-day tally starts its coverage at the oldest fetched event after a gap', () => {
  const previous = { since: '2026-09-11T00:00:00Z', lastEventId: '1', perDay: [{ day: '2026-09-20', n: 9 }] };
  const fetched = { events: [ev(300, '2026-09-25T01:00:00Z'), ev(200, '2026-09-24T22:03:29Z')], complete: false };
  const t = tallyPerDay(previous, fetched, now);
  const by = Object.fromEntries(t.perDay.map((d) => [d.day, d]));
  assert.equal(t.since, '2026-09-24T22:03:29Z');
  assert.equal(by['2026-09-20'].n, 0);
  assert.equal(by['2026-09-20'].covered, false);
  assert.equal(by['2026-09-24'].n, 1);
  assert.equal(by['2026-09-24'].covered, false);
  assert.equal(by['2026-09-25'].n, 1);
});

test('per-day tally counts the day since falls on only when since is its midnight', () => {
  const covered = (since) => tallyPerDay({ since, lastEventId: '1', perDay: [] }, { events: [], complete: true }, now).perDay.find((d) => d.day === '2026-09-20').covered;
  assert.equal(covered('2026-09-20T00:00:00Z'), true);
  assert.equal(covered('2026-09-20T00:00:01Z'), false);
  assert.equal(covered('2026-09-20T23:59:59Z'), false);
});

test('per-day tally with no previous state covers the whole window once the feed is exhausted', () => {
  const t = tallyPerDay(undefined, { events: [ev(5, '2026-09-25T01:00:00Z')], complete: true }, now);
  assert.equal(t.since, new Date(now - 14 * DAY).toISOString());
  assert.ok(t.perDay.every((d) => d.covered));
  assert.equal(t.lastEventId, '5');
});

test('per-day tally keeps the last event id when nothing new arrived', () => {
  const previous = { since: '2026-09-18T12:00:00Z', lastEventId: '10', perDay: [{ day: '2026-09-24', n: 30 }] };
  const t = tallyPerDay(previous, { events: [], complete: true }, now);
  assert.equal(t.lastEventId, '10');
  assert.equal(t.perDay.find((d) => d.day === '2026-09-24').n, 30);
});

test('pitlane keeps the published fields and reads a missing number as null, never 0', () => {
  const page = { at: '2026-09-25T01:59:00.039Z', window: '24h', jobs: 1474, queueWaitMs: { p50: 2000, p90: 18000 }, targets: { p50Ms: 5000, p90Ms: 30000 }, finished: 1582, runnerSuspect: 2, stale: false };
  assert.deepEqual(pitlaneFrom(page), { at: '2026-09-25T01:59:00.039Z', window: '24h', jobs: 1474, p50Ms: 2000, p90Ms: 18000, p50TargetMs: 5000, p90TargetMs: 30000, stale: false, lastHourJobs: null, lastHourP50Ms: null, hours: [] });
  const bare = pitlaneFrom({ at: '2026-09-25T01:59:00.039Z', queueWaitMs: { p50: 2000 } });
  assert.deepEqual([bare.jobs, bare.p90Ms, bare.p50TargetMs, bare.stale], [null, null, null, false]);
  assert.deepEqual(pitlaneFrom({ hours: [{ from: 'x', jobs: 9, p50: 1 }], lastHour: { jobs: 3 } }).hours, [{ from: 'x', jobs: 9 }]);
});

test('pitlane waits read like a timing screen', () => {
  assert.deepEqual([2000, 9960, 18000, 59_600, 125_000, null].map(fmtWait), ['2.0 s', '10.0 s', '18 s', '1m 00s', '2m 05s', '-']);
});

test('pitlane board draws each wait against twice its target and gives the verdict the page gives', () => {
  const at = new Date(now).toISOString();
  const base = { at, window: '24h', jobs: 1474, p50Ms: 2000, p90Ms: 18000, p50TargetMs: 5000, p90TargetMs: 30000, stale: false };
  const svg = renderPitlane({ at, pitlane: base });
  assert.match(svg, /<title id="t">pitlane: 1,474 jobs in the last 24 hours, median queue wait 2\.0 s against a 5\.0 s target, p90 18 s against 30 s\. Both targets met\.<\/title>/);
  assert.match(svg, /class="bar bar0"[^>]*width="136"/);
  assert.match(svg, /class="bar bar1"[^>]*width="204"/);
  assert.match(svg, />BOTH TARGETS MET</);
  const behind = renderPitlane({ at, pitlane: { ...base, p50Ms: 9000, p90Ms: 70_000 } });
  assert.match(behind, />BEHIND TARGET</);
  assert.match(behind, /class="bar bar1"[^>]*width="680"/);
  assert.match(renderPitlane({ at, pitlane: { ...base, stale: true } }), />NUMBERS STALE</);
  assert.match(renderPitlane({ at, pitlane: { ...base, jobs: 0, p50Ms: null, p90Ms: null } }), />NO JOBS IN 24 H</);
});

test('pitlane board shows plain dashes with no data', () => {
  const svg = renderPitlane({ at: new Date(now).toISOString(), pitlane: null });
  assert.equal((svg.match(/>-<\/text>/g) ?? []).length, 3);
  assert.match(svg, />NO DATA</);
  assert.doesNotMatch(svg, /class="bar/);
  assert.ok(!svg.includes(String.fromCharCode(0x2014)));
});

test('the score sets each public event in its lane at the moment it happened', () => {
  const at = (h) => new Date(now - h * 36e5).toISOString();
  const e = (type, payload, h) => ({ id: '1', created_at: at(h), type, payload, repo: { name: 'askalf/dario' } });
  const notes = notesFrom([
    e('PushEvent', {}, 12),
    e('PullRequestEvent', { action: 'merged' }, 6),
    e('PullRequestEvent', { action: 'closed', pull_request: { merged: true } }, 5),
    e('PullRequestEvent', { action: 'closed', pull_request: { merged: false } }, 5),
    e('ReleaseEvent', { action: 'published' }, 3),
    e('PushEvent', {}, 30),
  ], [
    e('PullRequestReviewEvent', { review: { state: 'approved' } }, 2),
    e('PullRequestReviewEvent', { review: { state: 'changes_requested' } }, 1),
    e('PullRequestReviewEvent', { review: { state: 'commented' } }, 1),
  ], now);
  assert.deepEqual(notes.map((x) => x.lane), ['push', 'merge', 'merge', 'release', 'approve', 'changes'], 'older than a day, unmerged and comments stay out');
  assert.equal(notes[0].t, 0.5, 'twelve hours ago is halfway across');
});

test('the second reviewer\'s verdicts take lanes of their own, so Redline\'s lanes stay Redline\'s', () => {
  const at = (h) => new Date(now - h * 36e5).toISOString();
  const e = (type, payload, h) => ({ id: String(h), created_at: at(h), type, payload, repo: { name: 'askalf/redline-rubric' } });
  const notes = notesFrom([], [e('PullRequestReviewEvent', { review: { state: 'approved' } }, 4)], now, [
    e('PullRequestReviewEvent', { review: { state: 'approved' } }, 3),
    e('PullRequestReviewEvent', { review: { state: 'changes_requested' } }, 2),
    e('PullRequestReviewEvent', { review: { state: 'commented' } }, 1),
    e('PushEvent', {}, 1),
    e('PullRequestReviewEvent', { review: { state: 'approved' } }, 30),
  ]);
  assert.deepEqual(notes.map((x) => x.lane), ['approve', 'second-approve', 'second-changes'], 'a comment, a push and a review older than a day stay out');
  assert.deepEqual(notesFrom([], [], now).map((x) => x.lane), [], 'no second feed is no second notes');
  const d = { ...liveDay(), activity: { ...liveDay().activity, notes } };
  assert.equal(renderScore(d).match(/class="n"/g).length, 1, 'the score draws Redline\'s verdict only');
  assert.deepEqual(cardSpecs(d).redline.figures.map((f) => f.value), ['1', '0']);
  assert.deepEqual(cardSpecs(d)['second-read'].figures.map((f) => f.value), ['1', '1']);
});

test('the feed counts a merge in both forms GitHub has reported it', () => {
  const e = (payload) => ({ created_at: 'x', type: 'PullRequestEvent', repo: { name: 'a/b' }, payload: { number: 7, ...payload } });
  assert.equal(feedFrom([e({ action: 'merged' })])[0].kind, feedFrom([e({ action: 'closed', pull_request: { merged: true } })])[0].kind);
});

test('the score draws one mark per event, timed to its place in the loop', () => {
  const notes = [{ t: 0.25, lane: 'push', repo: 'a/b' }, { t: 0.5, lane: 'merge', repo: 'a/b' }, { t: 0.75, lane: 'approve', repo: 'a/b' }];
  const hours = Array.from({ length: 24 }, (_, i) => ({ from: new Date(now - (24 - i) * 36e5).toISOString(), jobs: i + 1 }));
  const svg = renderScore({ at: new Date(now).toISOString(), activity: { to: new Date(now).toISOString(), notes }, pitlane: { hours } });
  assert.equal(svg.match(/class="n"/g).length, 3);
  assert.equal(svg.match(/class="bar"/g).length, 24);
  assert.ok(svg.includes(`animation-delay:${(0.5 * LOOP).toFixed(2)}s`), 'halfway through the day is halfway through the loop');
  assert.ok(svg.includes('>300<'), 'the jobs total is the sum of the hours');
  assert.ok(!/NaN|undefined/.test(svg));
  for (const l of LANES) assert.ok(svg.includes(`>${l.label}<`), l.label);
});

test('the score says so when the feed did not answer, and invents nothing', () => {
  const svg = renderScore({ at: new Date(now).toISOString(), activity: null, pitlane: null });
  assert.match(svg, /did not answer/);
  assert.ok(!svg.includes('class="n"'));
});

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const cardsDir = join(repoRoot, 'cards');
const heroPath = join(repoRoot, 'hero.jpg');
const liveDay = () => {
  const at = new Date(now).toISOString();
  return {
    at,
    activity: { to: at, notes: [{ t: 0.1, lane: 'approve' }, { t: 0.5, lane: 'approve' }, { t: 0.6, lane: 'changes' }, { t: 0.2, lane: 'push' }] },
    pitlane: { at, jobs: 1500, p50Ms: 2000, p90Ms: 9000, p50TargetMs: 5000, p90TargetMs: 30000, lastHourJobs: 12, lastHourP50Ms: 2000, stale: false },
    products: { 'ci-wizard': { score: 8.2, release: 'v0.1.2' }, pitlane: { score: 8.4, release: 'v1.0.0' }, ci: { score: 8.6, release: null }, dario: { score: 9.5, release: 'v6.21.0' } },
    installs: { last30: 13254 },
    github: { darioStars: 583 },
  };
};

test('every card comes wide and for a phone, and neither prints a missing value', () => {
  for (const d of [liveDay(), { at: new Date(now).toISOString() }]) {
    const cards = renderCards(d, cardsDir);
    assert.deepEqual(Object.keys(cards).sort(), ['ci-wizard', 'dario', 'pitlane', 'redline', 'second-read'].flatMap((c) => [`card-${c}-phone.svg`, `card-${c}.svg`]).sort());
    for (const [name, svg] of Object.entries(cards)) assert.ok(!/NaN|undefined|null/.test(svg.replace(/base64,[^"]*/, '')), name);
  }
});

test('a card with no source this hour reads as a dash, not an old number', () => {
  const svg = renderCards({ at: new Date(now).toISOString() }, cardsDir)['card-dario.svg'];
  assert.equal((svg.match(/>-<\/text>/g) ?? []).length, 2);
});

test('Redline runs one packet per verdict of the day, at its place in the loop', () => {
  const svg = renderCards(liveDay(), cardsDir)['card-redline.svg'];
  assert.equal(svg.match(/class="pk"/g).length, 3, 'two approvals and a change request; a push is not a verdict');
  assert.equal(svg.match(/class="hit"/g).length, 3);
  assert.ok(svg.includes(`animation-delay:${(0.6 * LOOP).toFixed(2)}s`));
  assert.ok(!renderCards({ at: new Date(now).toISOString() }, cardsDir)['card-redline.svg'].includes('class="pk"'), 'no feed, no packets');
});

test('Second Read runs one packet per verdict of its own, and none of Redline\'s', () => {
  const d = liveDay();
  const notes = [...d.activity.notes, { t: 0.3, lane: 'second-approve' }, { t: 0.7, lane: 'second-changes' }];
  const svg = renderCards({ ...d, activity: { ...d.activity, notes } }, cardsDir)['card-second-read.svg'];
  assert.equal(svg.match(/class="pk"/g).length, 2, 'Redline\'s three verdicts are not this card\'s');
  assert.equal(svg.match(/class="hit"/g).length, 2);
  assert.ok(svg.includes(`animation-delay:${(0.7 * LOOP).toFixed(2)}s`));
  assert.ok(!renderCards(d, cardsDir)['card-second-read.svg'].includes('class="pk"'), 'a day with no second verdict draws no packet');
  assert.equal(renderCards({ ...d, activity: { ...d.activity, notes } }, cardsDir)['card-redline.svg'].match(/class="pk"/g).length, 3, 'and Redline\'s card draws none of its');
});

test('pitlane runs one light per job of the last hour, and none on stale numbers', () => {
  const d = liveDay();
  assert.equal(renderCards(d, cardsDir)['card-pitlane.svg'].match(/class="car"/g).length, 12);
  assert.equal(renderCards({ ...d, pitlane: { ...d.pitlane, lastHourJobs: 9000 } }, cardsDir)['card-pitlane.svg'].match(/class="car"/g).length, 300, 'capped');
  assert.ok(!renderCards({ ...d, pitlane: { ...d.pitlane, stale: true } }, cardsDir)['card-pitlane.svg'].includes('class="car"'));
});

test('the longest line a panel can carry stays inside its glass', () => {
  const specs = cardSpecs({ ...liveDay(), pitlane: { ...liveDay().pitlane, lastHourJobs: 999 } });
  const glyph = 0.61; // the widest monospace stack in kit.mjs
  for (const [name, s] of Object.entries(specs)) {
    const room = s.panel.w - 92;
    assert.ok(s.foot.length * 27 * glyph <= room, `${name} foot: ${s.foot}`);
    for (const f of s.figures) assert.ok(f.label.length * 32 * glyph <= room, `${name} label: ${f.label}`);
  }
});

test('the hero states the last hour only when the runners answered', () => {
  const d = liveDay();
  assert.equal(heroLine(d), '12 jobs in the last hour · 2.0 s median wait');
  assert.equal(heroLine({ ...d, pitlane: { ...d.pitlane, stale: true } }), null);
  assert.equal(heroLine({}), null);
  const wide = renderHero({ heroPath, d });
  const phone = renderHero({ heroPath, d, phone: true });
  for (const svg of [wide, phone]) assert.ok(svg.includes('12 jobs in the last hour'));
  assert.ok(phone.includes('viewBox="0 0 1774 1127"'), 'the type gets a band of its own on a phone');
  assert.doesNotMatch(renderHero({ heroPath, d: {} }), /jobs in the last hour/);
});

test('every phone panel is drawn for a phone, with the same numbers', () => {
  const d = liveDay();
  assert.ok(renderScore({ ...d, pitlane: { hours: [] } }, { phone: true }).includes('viewBox="0 0 640 '));
  const board = renderPitlane(d, { phone: true });
  assert.ok(board.includes('viewBox="0 0 640 556"'));
  assert.match(board, />BOTH TARGETS MET</);
  assert.match(board, />1,500</);
  assert.equal((renderPitlane({ at: d.at, pitlane: null }, { phone: true }).match(/>-<\/text>/g) ?? []).length, 3);
  const upstream = [{ owner: 'a', repo: 'a-name-much-longer-than-a-phone-allows', prs: [1, 2] }];
  const orbit = renderOrbit({ upstream }, { alfPath: join(repoRoot, 'pulse', 'alf.jpg'), phone: true });
  assert.ok(orbit.includes('viewBox="0 0 640 780"'));
  assert.ok(orbit.includes('a-name-much-longe… ×2'));
  assert.ok(renderOrbit({ upstream }, { alfPath: join(repoRoot, 'pulse', 'alf.jpg') }).includes('a-name-much-longer-than-a-phone-allows ×2'), 'the wide one keeps the whole name');
});

test('a busy day stays whole: earlier runs fill in what the feed no longer reaches, each event once', () => {
  const at = (h) => new Date(now - h * 36e5).toISOString();
  const note = (id, h) => ({ id, at: at(h), t: 0, lane: 'approve', repo: 'a/b' });
  const merged = mergeNotes([note('new', 1), note('both', 2)], [note('both', 2), note('morning', 20), note('expired', 25)], now);
  assert.deepEqual(merged.map((x) => x.id), ['morning', 'both', 'new']);
  assert.equal(merged[0].t, Number((4 / 24).toFixed(5)), 'its place in the day is worked out again each run');
  assert.deepEqual(mergeNotes([note('new', 1)], undefined, now).map((x) => x.id), ['new']);
});

test('coverage says how far back the day is whole, past the 300 events the feed will serve', () => {
  const at = (h) => new Date(now - h * 36e5).toISOString();
  const feed = (oldestH, count) => Array.from({ length: count }, (_, i) => ({ created_at: at(oldestH * ((i + 1) / count)) }));
  const dayStart = at(24);
  assert.equal(coveredSince([feed(30, 300), feed(30, 120)], undefined, now), dayStart, 'it reached past the start of the day');
  assert.equal(coveredSince([feed(10, 120), feed(5, 40)], undefined, now), dayStart, 'a short feed is the whole feed');
  assert.equal(coveredSince([feed(10, 300), feed(20, 40)], undefined, now), at(10), 'stopped at ten hours, with nothing to fill in');
  assert.equal(coveredSince([feed(10, 300), feed(20, 40)], { to: at(1), since: at(24) }, now), dayStart, 'the last run reaches past the stop and was whole');
  assert.equal(coveredSince([feed(10, 300), feed(20, 40)], { to: at(1), since: at(15) }, now), at(15), 'the last run was whole only that far');
  assert.equal(coveredSince([feed(10, 300), feed(20, 40)], { to: at(12), since: at(24) }, now), at(10), 'a gap between the runs cannot be filled');
  assert.equal(coveredSince([feed(10, 300), feed(20, 40)], { to: at(1) }, now), at(10), 'a last run with no coverage recorded fills nothing');
});

test('a product keeps its last good field through a transient failure, and loses it on a 404', () => {
  const ok = (value) => ({ status: 'fulfilled', value });
  const fail = (status) => ({ status: 'rejected', reason: Object.assign(new Error('x'), { status }) });
  const last = { score: 8.4, release: 'v1.0.0' };
  assert.deepEqual(productFrom([ok({ score: 9 }), ok({ tag_name: 'v2' })], last), { score: 9, release: 'v2', held: [] });
  assert.deepEqual(productFrom([fail(503), ok({ tag_name: 'v2' })], last), { score: 8.4, release: 'v2', held: ['score'] });
  assert.deepEqual(productFrom([ok({ score: 9 }), fail(502)], last), { score: 9, release: 'v1.0.0', held: ['release'] });
  assert.deepEqual(productFrom([{ status: 'rejected', reason: new Error('timeout') }, fail(500)], last), { ...last, held: ['score', 'release'] });
  assert.deepEqual(productFrom([ok({ score: 9 }), fail(404)], last), { score: 9, release: null, held: [] }, 'no release at all reads as none');
  assert.deepEqual(productFrom([fail(503), fail(503)], undefined), { score: null, release: null, held: [] }, 'nothing to hold');
});

test('a value held over from an earlier run is never called current', () => {
  const live = liveDay();
  const earlier = new Date(now - 5 * 36e5).toISOString();
  const previous = { ...live, activity: { ...live.activity, from: new Date(now - 29 * 36e5).toISOString(), to: earlier, since: new Date(now - 29 * 36e5).toISOString() } };
  const keys = ['activity', 'pitlane', 'installs', 'github'];
  const down = { status: 'rejected', reason: new Error('503 feed') };
  const d = settle(keys, keys.map(() => down), previous, { at: live.at, sources: {} });
  assert.deepEqual(keys.map((k) => d.sources[k]), keys.map(() => 'cached (503 feed)'));
  const held = `${earlier.slice(11, 16)} UTC`;

  const score = renderScore(d);
  assert.ok(!score.includes('now, UTC') && !score.includes('LAST 24 HOURS'));
  assert.ok(score.includes(`THE 24 HOURS TO ${held}`) && score.includes(`>${held}<`));
  assert.equal(heroLine(d), null);
  assert.doesNotMatch(renderHero({ heroPath, d }), /jobs in the last hour/);

  const cards = renderCards(d, cardsDir);
  assert.ok(!cards['card-pitlane.svg'].includes('class="car"'), 'no lights from an old hour');
  assert.ok(!cards['card-pitlane.svg'].includes('jobs/h'));
  const specs = cardSpecs(d);
  assert.deepEqual([specs.pitlane.heading, specs.dario.heading, specs.redline.heading], ['LAST GOOD', 'LAST GOOD', `TO ${held}`]);
  assert.deepEqual([specs.pitlane.live, specs.dario.live, specs.redline.live], [false, false, false]);
  for (const c of ['pitlane', 'dario', 'redline']) assert.ok(!cards[`card-${c}.svg`].includes('class="live"'), `${c} keeps no live pip`);
});

test('part of a day is labelled as part of a day', () => {
  const d = liveDay();
  const since = new Date(now - 9 * 36e5).toISOString();
  const partial = { ...d, activity: { ...d.activity, from: new Date(now - 864e5).toISOString(), since } };
  assert.ok(renderScore(partial).includes(`no feed before ${since.slice(11, 16)}`));
  assert.equal(cardSpecs(partial).redline.heading, `SINCE ${since.slice(11, 16)}`);
  assert.ok(!renderScore({ ...d, activity: { ...d.activity, from: new Date(now - 864e5).toISOString(), since: new Date(now - 864e5).toISOString() } }).includes('no feed before'));
  assert.equal(cardSpecs({ at: d.at }).redline.heading, 'NO FEED');
});

test('a card says when a product field is held over, even under live figures', () => {
  const d = liveDay();
  const failing = { ...d, sources: { installs: 'live', github: 'live', products: 'live' }, products: { ...d.products, dario: { score: 9.5, release: 'v6.21.0', held: ['score'] } } };
  const specs = cardSpecs(failing);
  assert.equal(specs.dario.heading, 'LIVE');
  assert.equal(specs.dario.foot, 'Scorecard 9.5 (last good)');
  assert.ok(renderCards(failing, cardsDir)['card-dario.svg'].includes('Scorecard 9.5 (last good)'));
  assert.equal(cardSpecs({ ...d, products: { ...d.products, dario: { score: 9.5, release: 'v6.21.0', held: ['release'] } } }).dario.foot, 'v6.21.0 (last good)');
  assert.equal(cardSpecs({ ...d, products: { ...d.products, pitlane: { score: 8.4, release: 'v1.0.0', held: ['release'] } } }).pitlane.foot, '12 jobs/h · Scorecard 8.4', 'a release the card does not show needs no mark');
  assert.equal(cardSpecs({ ...d, products: { ...d.products, ci: { score: 8.6, release: null, held: [] } } }).redline.foot, 'Scorecard 8.6');
  assert.equal(cardSpecs(d)['ci-wizard'].live, false, 'a published result wears no live pip');
});

test('the hero pairs the hour with the hour', () => {
  const d = liveDay();
  const busy = { ...d, pitlane: { ...d.pitlane, p50Ms: 2000, lastHourP50Ms: 20_000 } };
  assert.equal(heroLine(busy), '12 jobs in the last hour · 20 s median wait', 'never the 24 hour median');
  assert.equal(heroLine({ ...d, pitlane: { ...d.pitlane, lastHourP50Ms: null } }), null);
  assert.equal(pitlaneFrom({ queueWaitMs: { p50: 2000 }, lastHour: { jobs: 66, p50: 7000 } }).lastHourP50Ms, 7000);
});

test('the jobs lane answers to the axis when its source and the feed fail apart', () => {
  const hour = 36e5;
  const hours = Array.from({ length: 24 }, (_, i) => ({ from: new Date(now - (24 - i) * hour).toISOString(), jobs: 10 }));
  const at = new Date(now).toISOString();
  const pit = { at, hours };
  const day = (to) => ({ from: new Date(to - 864e5).toISOString(), to: new Date(to).toISOString(), since: new Date(to - 864e5).toISOString(), notes: [] });

  // The feed held over from five hours ago, pitlane current: only the hours under the axis count.
  const feedDown = renderScore({ at, activity: day(now - 5 * hour), pitlane: pit, sources: { activity: 'cached (x)', pitlane: 'live' } });
  assert.equal(feedDown.match(/class="bar"/g).length, 19);
  assert.ok(feedDown.includes('>190<'), 'the total is of the plotted hours');
  assert.ok(feedDown.includes('>jobs run<'));

  // The feed current, pitlane held over from five hours ago: the lane says where it stops.
  const old = new Date(now - 5 * hour).toISOString();
  const pitDown = renderScore({ at, activity: day(now), pitlane: { at: old, hours: hours.slice(0, 19) }, sources: { activity: 'live', pitlane: 'cached (x)' } });
  assert.equal(pitDown.match(/class="bar"/g).length, 19);
  assert.ok(pitDown.includes(`>to ${old.slice(11, 16)}<`));
  assert.ok(pitDown.includes('now, UTC'), 'the feed itself is current');
  assert.ok(!pitDown.includes('>jobs run<'));
  assert.ok(renderScore({ at, activity: day(now), pitlane: { at, hours, stale: true } }).includes(`>to ${at.slice(11, 16)}<`));
});

test('an event the feed serves twice counts once', () => {
  const at = new Date(now - 36e5).toISOString();
  const review = { id: 'r1', type: 'PullRequestReviewEvent', created_at: at, repo: { name: 'a/b' }, payload: { review: { state: 'approved' } } };
  // A new event between two page reads pushes the last of page one to the top of page two.
  const fresh = notesFrom([], [review, review], now);
  assert.equal(fresh.length, 2, 'the feed really did hand it over twice');
  const notes = mergeNotes(fresh, [{ ...fresh[0] }], now);
  assert.deepEqual(notes.map((x) => x.id), ['r1']);
  const d = { ...liveDay(), activity: { ...liveDay().activity, notes } };
  assert.equal(cardSpecs(d).redline.figures[0].value, '1');
  assert.equal(renderCards(d, cardsDir)['card-redline.svg'].match(/class="pk"/g).length, 1);
  assert.equal(renderScore(d).match(/class="n"/g).length, 1);
});

test('a capped feed cuts only its own reviewer\'s day: Redline\'s and the second reviewer\'s windows stay apart', () => {
  const at = (h) => new Date(now - h * 36e5).toISOString();
  const review = (id, h, state = 'approved') => ({ id, type: 'PullRequestReviewEvent', created_at: at(h), repo: { name: 'a/b' }, payload: { review: { state } } });
  // A full second feed: 300 events reaching back only ten hours, as the feed returns at most.
  const busy = (prefix) => Array.from({ length: 300 }, (_, i) => review(`${prefix}${i}`, 10 * ((i + 1) / 300)));
  const redline = [review('r-late', 2), review('r-early', 20, 'changes_requested')];

  const a = activityFrom({ own: [], redline, second: busy('s') }, undefined, now);
  assert.equal(a.since, at(24), 'Redline\'s day is whole');
  assert.equal(a.secondSince, at(10), 'the second reviewer\'s is cut where its feed stops');
  assert.deepEqual(a.notes.filter((x) => !x.lane.startsWith('second-')).map((x) => x.id), ['r-early', 'r-late'], 'Redline\'s verdict from before the second feed\'s cut is kept');
  const d = { ...liveDay(), activity: a };
  assert.equal(cardSpecs(d).redline.heading, 'LAST 24 H');
  assert.equal(cardSpecs(d)['second-read'].heading, `SINCE ${at(10).slice(11, 16)}`);
  assert.deepEqual(cardSpecs(d).redline.figures.map((f) => f.value), ['1', '1']);

  const b = activityFrom({ own: busy('o').map((e) => ({ ...e, type: 'PushEvent' })), redline: [], second: [review('s-early', 20)] }, undefined, now);
  assert.equal(b.since, at(10));
  assert.equal(b.secondSince, at(24), 'and a capped first feed does not cut the second\'s');
  assert.deepEqual(b.notes.filter((x) => x.lane.startsWith('second-')).map((x) => x.id), ['s-early']);
  assert.equal(cardSpecs({ ...liveDay(), activity: { ...b, secondSince: undefined } })['second-read'].heading, `SINCE ${at(10).slice(11, 16)}`, 'a state from before secondSince reads since');
});

test('past an unfilled gap nothing older is counted, so a SINCE card counts what it says', () => {
  const at = (h) => new Date(now - h * 36e5).toISOString();
  const note = (id, h, lane = 'approve') => ({ id, at: at(h), t: 0, lane, repo: 'a/b' });
  // The last run ended twelve hours ago and this capped feed reaches back ten, so two hours are lost.
  const feed = Array.from({ length: 300 }, (_, i) => ({ created_at: at(10 * ((i + 1) / 300)) }));
  const last = { to: at(12), since: at(24), notes: [note('morning', 20)] };
  const since = coveredSince([feed, []], last, now);
  assert.equal(since, at(10));
  const notes = mergeNotes([note('recent', 3), note('edge', 10)], last.notes, now, since);
  assert.deepEqual(notes.map((x) => x.id), ['edge', 'recent'], 'the approval from before the gap is gone');
  const d = { ...liveDay(), activity: { from: at(24), to: at(0), since, notes } };
  const spec = cardSpecs(d).redline;
  assert.equal(spec.heading, `SINCE ${since.slice(11, 16)}`);
  assert.equal(spec.figures[0].value, '2');
  assert.equal(renderCards(d, cardsDir)['card-redline.svg'].match(/class="pk"/g).length, 2);
  assert.ok(renderScore(d).includes('>2<'));
});

test('an hour belongs to the axis when its middle does', () => {
  const hour = 36e5;
  const at = new Date(now).toISOString();
  const day = { from: new Date(now - 864e5).toISOString(), to: at, since: new Date(now - 864e5).toISOString(), notes: [] };
  const bucket = (startsAgoH, jobs) => ({ from: new Date(now - startsAgoH * hour).toISOString(), jobs });
  const draw = (hours) => renderScore({ at, activity: day, pitlane: { at, hours } });
  const bars = (svg) => (svg.match(/class="bar"/g) ?? []).length;

  const before = draw([bucket(25, 700), bucket(3, 5)]);
  assert.equal(bars(before), 1, 'an hour ending exactly at the axis start is outside it');
  assert.ok(before.includes('>5<') && !before.includes('>705<'));
  assert.equal(bars(draw([bucket(25.6, 700)])), 0);
  assert.equal(bars(draw([bucket(24.4, 7)])), 1, 'one that overlaps by most of itself stays');
  assert.equal(bars(draw([bucket(24.6, 7)])), 0, 'one that overlaps by less than half goes');
  assert.equal(bars(draw([bucket(0, 7), bucket(0.4, 7)])), 0, 'hours that begin at or just before the right edge are past it');
  assert.equal(bars(draw([bucket(1, 7)])), 1, 'the last whole hour stays');
});

test('every moving layer holds still under prefers-reduced-motion', () => {
  const d = liveDay();
  for (const svg of [...Object.values(renderCards(d, cardsDir)), renderHero({ heroPath, d }), renderScore(d), renderPitlane(d, { phone: true })]) {
    assert.match(svg, /prefers-reduced-motion: reduce/);
  }
});
