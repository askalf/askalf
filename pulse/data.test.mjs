// node --test pulse/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OWN, inReviewFrom, recentEvents, tallyPerDay, pitlaneFrom } from './data.mjs';
import { renderSignal } from './svg/signal.mjs';
import { renderGate } from './svg/gate.mjs';
import { renderHeartbeat } from './svg/heartbeat.mjs';
import { renderStats } from './svg/stats.mjs';
import { renderPitlane, fmtWait } from './svg/pitlane.mjs';
import { renderConsole } from './svg/console.mjs';

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

test('signal panel counts only the days its tally covers', () => {
  const perDay = Array.from({ length: 14 }, (_, i) => ({ day: new Date(now - (13 - i) * DAY).toISOString().slice(0, 10), n: i >= 12 ? 10 : 0, covered: i >= 12 }));
  const svg = renderSignal({ at: new Date(now).toISOString(), github: { perDay, feed: [] } });
  assert.match(svg, /20 public events in 2 days</);
  assert.equal((svg.match(/not yet counted/g) ?? []).length, 12);
  const full = renderSignal({ at: new Date(now).toISOString(), github: { perDay: perDay.map((d) => ({ ...d, covered: true })), feed: [] } });
  assert.match(full, /20 public events in 14 days</);
  assert.doesNotMatch(full, /not yet counted/);
});

test('gate audit log rests on its newest five entries when motion is reduced', () => {
  const svg = renderGate();
  const [, top, height] = svg.match(/id="logclip"><rect x="\d+" y="(\d+)" width="\d+" height="(\d+)"/).map(Number);
  const rest = [...svg.matchAll(/<g class="entry" style="[^"]*transform:translateY\((-?\d+)px\)"><text[^>]*>\s*<tspan[^>]*>#(\d+)/g)].map((m) => [m[2], Number(m[1])]);
  assert.equal(rest.length, 8);
  assert.deepEqual(rest.filter(([, y]) => y > top && y <= top + height).map(([seq]) => seq), ['04104', '04105', '04106', '04107', '04108']);
  assert.equal(rest.at(-1)[1], top + height - 8);
  const css = svg.slice(svg.indexOf('<style>'), svg.indexOf('</style>'));
  const hidden = css.indexOf('.entry { opacity: 0;');
  const still = css.indexOf('@media (prefers-reduced-motion: reduce) { .entry { opacity: 1 } }');
  assert.ok(hidden >= 0 && still > hidden);
});

test('heartbeat shows a plain dash where a source has no data', () => {
  const svg = renderHeartbeat({ at: new Date(now).toISOString(), dario: null, installs: null });
  assert.equal((svg.match(/>-<\/text>/g) ?? []).length, 2);
  assert.doesNotMatch(svg, /\u2014/);
});

test('the header stats show each live number and drop a missing source', () => {
  const at = new Date(now).toISOString();
  const full = renderStats({ at, github: { darioStars: 558 }, installs: { last30: 26087 }, dario: { releaseCount: 643 } });
  assert.match(full, /<title id="t">dario · 558 stars · 26,087 npm installs in 30 days · 643 releases<\/title>/);
  const partial = renderStats({ at, github: null, installs: { last30: 26087 }, dario: null });
  assert.match(partial, /<title id="t">dario · 26,087 npm installs in 30 days<\/title>/);
  assert.ok(+partial.match(/width="(\d+)"/)[1] < +full.match(/width="(\d+)"/)[1]);
});

test('pitlane keeps the published fields and reads a missing number as null, never 0', () => {
  const page = { at: '2026-09-25T01:59:00.039Z', window: '24h', jobs: 1474, queueWaitMs: { p50: 2000, p90: 18000 }, targets: { p50Ms: 5000, p90Ms: 30000 }, finished: 1582, runnerSuspect: 2, stale: false };
  assert.deepEqual(pitlaneFrom(page), { at: '2026-09-25T01:59:00.039Z', window: '24h', jobs: 1474, p50Ms: 2000, p90Ms: 18000, p50TargetMs: 5000, p90TargetMs: 30000, stale: false });
  const bare = pitlaneFrom({ at: '2026-09-25T01:59:00.039Z', queueWaitMs: { p50: 2000 } });
  assert.deepEqual([bare.jobs, bare.p90Ms, bare.p50TargetMs, bare.stale], [null, null, null, false]);
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

test('console leads with the runners row only when every number it prints is present', () => {
  const at = new Date(now).toISOString();
  const pitlane = { at, window: '24h', jobs: 3629, p50Ms: 3000, p90Ms: 123_000, p50TargetMs: 5000, p90TargetMs: 30000, stale: false };
  const full = renderConsole({ at, upstream: [], pitlane });
  assert.match(full, /job starts in 3 s \(p50\) · 123 s \(p90\) · 3,629 jobs in 24 h · targets 5 s \/ 30 s/);
  for (const missing of ['p90Ms', 'jobs', 'p50TargetMs', 'p90TargetMs']) {
    const svg = renderConsole({ at, upstream: [], pitlane: { ...pitlane, [missing]: null } });
    assert.doesNotMatch(svg, /runners/, `row drawn without ${missing}`);
  }
  const partial = renderConsole({ at, upstream: [], pitlane: pitlaneFrom({ at, queueWaitMs: { p50: 2000 } }) });
  assert.doesNotMatch(partial, /runners|n\/a/);
  assert.doesNotMatch(renderConsole({ at, upstream: [], pitlane: { ...pitlane, stale: true } }), /runners/);
});
