// Gathers the live numbers the pulse panels are drawn from. Every source is
// public; each one that fails falls back to the last good value in state.json,
// so a flaky API never blanks a panel.
import { readFileSync } from 'node:fs';

const UA = { 'user-agent': 'askalf-pulse (+https://github.com/askalf/askalf)' };
const DAY = 864e5;
// Accounts whose repos are the operation's own, staging forks included. Org
// memberships are private, so the orgs endpoint cannot supply these.
export const OWN = ['askalf', 'sprayberry-archive', 'sprayberry-code'];
// The public events feed serves at most three pages of 100.
const EVENT_PAGES = 3;
const PAGE = 100;

async function getJSON(url, headers = {}) {
  const res = await fetch(url, { headers: { ...UA, ...headers }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

const gh = (path) => getJSON(`https://api.github.com${path}`, {
  accept: 'application/vnd.github+json',
  ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
});

const ymd = (t) => new Date(t).toISOString().slice(0, 10);

async function dario(now) {
  const doc = await getJSON('https://registry.npmjs.org/@askalf/dario');
  const latest = doc['dist-tags'].latest;
  const releases = Object.entries(doc.time)
    .filter(([v]) => v !== 'created' && v !== 'modified' && doc.versions[v])
    .map(([version, at]) => ({ version, at }))
    .sort((a, b) => a.at.localeCompare(b.at));
  return {
    latest,
    latestAt: doc.time[latest],
    releaseCount: releases.length,
    releases30: releases.filter((r) => now - Date.parse(r.at) < 30 * DAY).length,
    // Only the window the heartbeat draws, to keep state.json small.
    recent: releases.filter((r) => now - Date.parse(r.at) < 31 * DAY),
  };
}

async function installs(now) {
  const range = `${ymd(now - 120 * DAY)}:${ymd(now)}`;
  const j = await getJSON(`https://api.npmjs.org/downloads/range/${range}/@askalf/dario`);
  const days = j.downloads.map((d) => ({ day: d.day, n: d.downloads }));
  // npm publishes a day's count a day or two late; unpublished days read 0.
  while (days.length && days.at(-1).n === 0) days.pop();
  const last30 = days.slice(-30).reduce((s, d) => s + d.n, 0);
  return { days, last30 };
}

// "In review" means other people's projects, same rule as the table.
export function inReviewFrom(items, mine) {
  return items
    .map((i) => ({ repo: i.repository_url.replace('https://api.github.com/repos/', ''), number: i.number, title: i.title }))
    .filter((i) => !mine.has(i.repo.split('/')[0].toLowerCase()));
}

export function feedFrom(events) {
  const feed = [];
  for (const e of events) {
    const at = e.created_at;
    const repo = e.repo.name;
    const p = e.payload || {};
    // Push payloads no longer carry commit counts, so name the branch instead.
    if (e.type === 'PushEvent') feed.push({ at, repo, kind: 'push', text: `pushed to ${String(p.ref ?? '').replace('refs/heads/', '') || 'a branch'}` });
    else if (e.type === 'PullRequestEvent' && p.action === 'closed' && (p.pull_request?.merged || p.pull_request?.merged_at)) feed.push({ at, repo, kind: 'merge', text: `merged #${p.number ?? p.pull_request.number}` });
    else if (e.type === 'PullRequestEvent' && p.action === 'opened') feed.push({ at, repo, kind: 'pr', text: `opened #${p.number ?? p.pull_request?.number}` });
    else if (e.type === 'PullRequestReviewEvent') feed.push({ at, repo, kind: 'review', text: `reviewed #${p.pull_request?.number}` });
    else if (e.type === 'ReleaseEvent') feed.push({ at, repo, kind: 'release', text: `released ${p.release?.tag_name ?? ''}`.trim() });
    else if (e.type === 'CreateEvent' && p.ref_type === 'tag') feed.push({ at, repo, kind: 'release', text: `tagged ${p.ref}` });
    else if (e.type === 'IssuesEvent' && p.action === 'opened') feed.push({ at, repo, kind: 'issue', text: `opened issue #${p.issue?.number}` });
  }
  return feed;
}

// Reads the feed newest-first until it meets the last event already counted.
// `complete` says it did (or the feed ran out); otherwise the pages ran out
// first and there is a gap between this fetch and the previous tally.
export async function recentEvents(get, lastEventId) {
  const events = [];
  const seen = lastEventId === undefined ? -1n : BigInt(lastEventId);
  for (let page = 1; page <= EVENT_PAGES; page++) {
    const batch = await get(page);
    for (const e of batch) {
      if (BigInt(e.id) <= seen) return { events, complete: true };
      events.push(e);
    }
    if (batch.length < PAGE) return { events, complete: true };
  }
  return { events, complete: false };
}

// Events per day for the last 14 days. The feed pages back a few hours on a
// busy day, so one fetch cannot count two weeks: each run adds the events it
// has not seen to the tally carried in state.json. `since` is where the tally's
// coverage starts; it restarts at the oldest fetched event after a gap.
export function tallyPerDay(previous, { events, complete }, now) {
  const counts = {};
  let since;
  if (complete && previous?.since) {
    for (const d of previous.perDay ?? []) counts[d.day] = d.n;
    since = previous.since;
  } else if (complete) {
    since = new Date(now - 14 * DAY).toISOString();
  } else {
    since = events.at(-1).created_at;
  }
  for (const e of events) { const d = ymd(Date.parse(e.created_at)); counts[d] = (counts[d] ?? 0) + 1; }
  const first = ymd(Date.parse(since));
  const perDay = [];
  for (let i = 13; i >= 0; i--) {
    const day = ymd(now - i * DAY);
    perDay.push({ day, n: counts[day] ?? 0, covered: day >= first });
  }
  return { perDay, since, lastEventId: events[0]?.id ?? previous?.lastEventId };
}

async function github(now, previous) {
  const [repo, repos, orgs, inReview, fetched] = await Promise.all([
    gh('/repos/askalf/dario'),
    gh('/users/askalf/repos?per_page=100&type=owner'),
    gh('/users/askalf/orgs'),
    gh(`/search/issues?q=${encodeURIComponent(`is:pr is:open author:askalf ${OWN.map((o) => `-user:${o}`).join(' ')}`)}&per_page=100&sort=updated`),
    recentEvents((page) => gh(`/users/askalf/events/public?per_page=${PAGE}&page=${page}`), previous?.lastEventId),
  ]);
  const mine = new Set([...OWN, ...orgs.map((o) => o.login)].map((s) => s.toLowerCase()));
  const own = repos.filter((r) => !r.fork && !r.archived && !r.private);
  return {
    darioStars: repo.stargazers_count,
    stars: own.reduce((s, r) => s + r.stargazers_count, 0),
    publicRepos: own.length,
    feed: [...feedFrom(fetched.events), ...(previous?.feed ?? [])].slice(0, 7),
    ...tallyPerDay(previous, fetched, now),
    inReview: inReviewFrom(inReview.items, mine),
  };
}

// The Merged upstream table in README.md is the curated record; the orbit is
// drawn from it so the two never disagree.
export function upstreamFromReadme(readmePath) {
  const md = readFileSync(readmePath, 'utf8');
  const section = md.split(/^## Merged upstream\s*$/m)[1]?.split(/^## /m)[0] ?? '';
  const rows = [];
  for (const line of section.split('\n')) {
    if (!line.startsWith('| [')) continue;
    const cell = line.split('|')[1];
    const links = [...cell.matchAll(/\[([^\]]+)\]\((https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+))\)/g)];
    if (!links.length) continue;
    const [, , , owner, repo] = links[0];
    rows.push({ owner, repo, prs: links.map((l) => +l[5]) });
  }
  return rows;
}

export async function gather({ previous = {}, readmePath }) {
  const now = Date.now();
  const out = { at: new Date(now).toISOString(), sources: {} };
  const tasks = { dario: dario(now), installs: installs(now), github: github(now, previous.github ?? undefined) };
  const settled = await Promise.allSettled(Object.values(tasks));
  Object.keys(tasks).forEach((key, i) => {
    const r = settled[i];
    if (r.status === 'fulfilled') { out[key] = r.value; out.sources[key] = 'live'; return; }
    out[key] = previous[key] ?? null;
    out.sources[key] = `${previous[key] ? 'cached' : 'missing'} (${r.reason.message})`;
  });
  out.upstream = upstreamFromReadme(readmePath);
  return out;
}
