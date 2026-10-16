#!/usr/bin/env node
// Keeps our own bot pull requests mergeable, and their fleet lanes current, after main moves.
//
// Why this exists: two receipts PRs opened minutes apart both bump the README's headline count
// and append a row to the same table. The second conflicts with main as soon as the first merges.
// GitHub runs no pull_request or pull_request_review workflow on a PR with a merge conflict, so
// from that moment fleet-status.yml never hears about Redline's verdict, the fleet/review status
// stays at "Waiting on Redline", and the PR sits until a person merges main into it by hand
// (askalf/askalf#130 sat five hours).
//
// What it does, for every open same-repo PR, on each push to main, on a schedule, and on demand:
//   - A conflicted PR by one of our identities on a bot branch (isBotPr in fleet-status.mjs,
//     Dependabot aside: it rebases its own PRs, and a push by us stops it) has the base branch
//     merged into it. Conflicts of the receipts shape are resolved: rows both sides added to the
//     same Markdown table are kept, main's first, and the headline count line
//     "**N fixes merged upstream** into A, B and more" adds the PR's increment to main's count and
//     the PR's new names to main's list. Any other conflict is left alone, and the PR gets one
//     comment saying so.
//   - The merge commit is pushed with the workflow's token. Events from that token start no
//     workflow runs, so the run then dispatches self-test (a required check) on the branch, and
//     Redline on a PR that touches code (a docs-only PR is approved by the deterministic sweep),
//     and posts the fleet lanes on the new head itself.
//   - Every open same-repo PR has its lanes re-posted (scripts/fleet-status.mjs), so a status
//     that went stale for any reason is corrected on the next run.
//
// The checked-out code is the default branch's; a PR head is only fetched into a scratch clone
// and merged as text. Nothing from it is executed.
//
// CLI:
//   GITHUB_TOKEN=... REPO=owner/name [PR=<number>] node scripts/fleet-refresh.mjs [--dry-run]
// With --dry-run nothing is pushed, posted or dispatched; the merge is still attempted locally.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isBotPr, isCodePath, collectPages } from './fleet-status.mjs';

export const MARKER = 'fleet-refresh';
/** The README's headline: "**23 fixes merged upstream** into Hugging Face, ioredis and more". */
export const COUNT_LINE = /^\*\*(\d+) fixes merged upstream\*\* into (.+?) and more$/;
export const SELF_TEST_WORKFLOW = 'fleet-status-self-test.yml';
export const REDLINE_WORKFLOW = 'redline.yml';
const ROW = /^\|/;

/** A PR we may push a merge commit to: ours, on a bot branch, and not Dependabot's. */
export function refreshable(author, headRef) {
  if (/dependabot/i.test(author ?? '')) return false;
  return isBotPr(author, headRef);
}

/**
 * Splits a file with diff3-style conflict markers into plain lines and hunks
 * ({ ours, base, theirs }, each an array of lines; base is null without a ||||||| section).
 */
export function parseConflicts(text) {
  const lines = text.split('\n');
  const out = [];
  for (let i = 0; i < lines.length;) {
    if (!lines[i].startsWith('<<<<<<< ')) { out.push(lines[i++]); continue; }
    const h = { ours: [], base: null, theirs: [] };
    i++;
    while (i < lines.length && !lines[i].startsWith('||||||| ') && lines[i] !== '=======') h.ours.push(lines[i++]);
    if (lines[i]?.startsWith('||||||| ')) {
      h.base = [];
      i++;
      while (i < lines.length && lines[i] !== '=======') h.base.push(lines[i++]);
    }
    if (lines[i] !== '=======') throw new Error('a conflict hunk has no ======= line');
    i++;
    while (i < lines.length && !lines[i].startsWith('>>>>>>> ')) h.theirs.push(lines[i++]);
    if (!lines[i]?.startsWith('>>>>>>> ')) throw new Error('a conflict hunk has no >>>>>>> line');
    i++;
    out.push(h);
  }
  return out;
}

/** Every line of base, in order, is still in side: side only added lines. */
function keepsAll(base, side) {
  let j = 0;
  for (const l of side) if (j < base.length && l === base[j]) j++;
  return j === base.length;
}

/** Both sides edited the one headline count line: main's count plus the PR's increment. */
function mergeCountLine(ours, base, theirs) {
  if (ours.length !== 1 || base.length !== 1 || theirs.length !== 1) return null;
  const [o, b, t] = [ours[0], base[0], theirs[0]].map((l) => COUNT_LINE.exec(l));
  if (!o || !b || !t) return null;
  const names = (m) => m[2].split(', ');
  const added = Number(o[1]) - Number(b[1]);
  if (added < 1 || Number(t[1]) < Number(b[1])) return null;
  const list = names(t);
  for (const n of names(o)) if (!names(b).includes(n) && !list.includes(n)) list.push(n);
  return [`**${Number(t[1]) + added} fixes merged upstream** into ${list.join(', ')} and more`];
}

/**
 * Both sides added rows to the same Markdown table: main's rows stay where they are, and each row
 * the PR added goes after the row that precedes it in the PR. The PR's first row goes after main's
 * rows when the hunk has no base rows (both sides appended at the same place), and at the top when
 * the PR put it above a base row. A row both sides added is kept once. A side that changed or
 * removed a base row is not resolved.
 */
function mergeTableRows(ours, base, theirs) {
  if (![...ours, ...base, ...theirs].every((l) => ROW.test(l))) return null;
  if (!ours.length || !theirs.length) return null;
  if (!keepsAll(base, ours) || !keepsAll(base, theirs)) return null;
  const result = [...theirs];
  for (let i = 0; i < ours.length; i++) {
    const line = ours[i];
    if (base.includes(line) || result.includes(line)) continue;
    const at = i === 0 ? (base.length ? -1 : result.length - 1) : result.indexOf(ours[i - 1]);
    result.splice(at + 1, 0, line);
  }
  return result;
}

/** The lines that replace a hunk, or null when it is not a shape this script resolves. */
export function resolveHunk({ ours, base, theirs }) {
  if (base === null) return null;
  return mergeCountLine(ours, base, theirs) ?? mergeTableRows(ours, base, theirs);
}

/** The file with every hunk resolved, or null when any hunk is not. */
export function resolveConflicts(text) {
  const out = [];
  let hunks = 0;
  for (const part of parseConflicts(text)) {
    if (typeof part === 'string') { out.push(part); continue; }
    const lines = resolveHunk(part);
    if (lines === null) return null;
    hunks++;
    out.push(...lines);
  }
  return hunks ? out.join('\n') : null;
}

function git(dir, extra, args, { check = true } = {}) {
  const r = spawnSync('git', [...extra, ...args], { cwd: dir, encoding: 'utf8' });
  if (check && r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr.trim()}`);
  return r;
}

/**
 * Merges the base branch into the PR head in a scratch clone at `dir`, resolving receipts
 * conflicts, and pushes the merge commit as a fast-forward of the head branch.
 * `auth` is the http.extraheader value for the remote, or '' for a local one.
 * Returns { ok: true, sha, files } or { ok: false, reason, files }.
 */
export function refreshBranch({ dir, remote, auth = '', headRef, headSha, baseRef, message, dryRun = false }) {
  const extra = auth ? ['-c', `http.extraheader=${auth}`] : [];
  const run = (...args) => git(dir, extra, args).stdout.trim();
  run('init', '-q');
  run('config', 'user.name', 'github-actions[bot]');
  run('config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com');
  run('config', 'merge.conflictStyle', 'diff3');
  run('config', 'commit.gpgsign', 'false');
  run('fetch', '-q', '--no-tags', remote, `+refs/heads/${headRef}:refs/remotes/pr/head`, `+refs/heads/${baseRef}:refs/remotes/pr/base`);
  if (run('rev-parse', 'refs/remotes/pr/head') !== headSha) return { ok: false, reason: 'the branch moved while it was read', files: [] };
  run('checkout', '-q', '--detach', headSha);
  const merged = git(dir, extra, ['merge', '-q', '--no-commit', '--no-ff', 'refs/remotes/pr/base'], { check: false });
  const files = run('diff', '--name-only', '--diff-filter=U').split('\n').filter(Boolean);
  if (merged.status !== 0) {
    if (!files.length) {
      git(dir, extra, ['merge', '--abort'], { check: false });
      return { ok: false, reason: `the merge failed: ${merged.stderr.trim()}`, files };
    }
    for (const f of files) {
      let resolved = null;
      try { resolved = resolveConflicts(readFileSync(join(dir, f), 'utf8')); } catch { resolved = null; }
      if (resolved === null) {
        git(dir, extra, ['merge', '--abort'], { check: false });
        return { ok: false, reason: `${f} conflicts beyond the receipts shape this script resolves`, files };
      }
      writeFileSync(join(dir, f), resolved);
      run('add', '--', f);
    }
  }
  run('commit', '-q', '--no-verify', '-m', message);
  const sha = run('rev-parse', 'HEAD');
  if (dryRun) return { ok: true, sha, files, dryRun: true };
  const pushed = git(dir, extra, ['push', '-q', remote, `HEAD:refs/heads/${headRef}`], { check: false });
  if (pushed.status !== 0) return { ok: false, reason: `the push was rejected: ${pushed.stderr.trim()}`, files };
  return { ok: true, sha, files };
}

/** The merge commit's message: no trailers, as the repository's review rule requires. */
export function mergeMessage({ number, headRef, baseRef, baseSha }) {
  return `Merge ${baseRef} into ${headRef}\n\n#${number} conflicted with ${baseRef} at ${baseSha.slice(0, 7)} after another pull request merged. `
    + 'Fleet refresh merged the receipts table and its count, keeping both sides.';
}

/** The one comment a PR gets when its conflict is not the receipts shape. */
export function unresolvedComment({ baseRef, baseSha, headSha, files, reason }) {
  return `Fleet refresh could not update this branch: it conflicts with ${baseRef} at ${baseSha.slice(0, 7)} in ${files.map((f) => `\`${f}\``).join(', ') || 'the merge'}, and ${reason}. `
    + 'Until the conflict is resolved by hand, GitHub runs no pull_request or review workflow here, so the fleet/* statuses cannot refresh.\n\n'
    + `<!-- ${MARKER}:head=${headSha} base=${baseSha} -->`;
}

// CLI
async function gh(path, token, init = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path}: HTTP ${res.status} ${await res.text()}`);
  return res;
}
const ghAll = (path, token) => collectPages(async (n) => (await gh(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${n}`, token)).json());
const post = (path, token, body) => gh(path, token, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { GITHUB_TOKEN: token, REPO: repo, PR: prArg, TARGET_URL: targetUrl } = process.env;
  const dryRun = process.argv.includes('--dry-run');
  if (!token || !repo) {
    console.error('usage: GITHUB_TOKEN=... REPO=owner/name [PR=<number>] node scripts/fleet-refresh.mjs [--dry-run]');
    process.exit(2);
  }
  // Tests point the clone at a local repository and skip the wait for GitHub's mergeability.
  const remote = process.env.FLEET_REFRESH_REMOTE || `https://github.com/${repo}.git`;
  const auth = process.env.FLEET_REFRESH_REMOTE ? '' : `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`;
  const pollMs = Number(process.env.FLEET_REFRESH_POLL_MS ?? 5000);

  /** The PR with `mergeable` computed: GitHub returns null until it has, on a read after a push. */
  async function readPr(number) {
    let p = null;
    for (let i = 0; i < 8; i++) {
      p = await (await gh(`/repos/${repo}/pulls/${number}`, token)).json();
      if (p.state !== 'open' || p.mergeable !== null) break;
      await sleep(pollMs);
    }
    return p;
  }

  const defaultBranch = (await (await gh(`/repos/${repo}`, token)).json()).default_branch;
  const listed = /^\d+$/.test(prArg ?? '') ? [await (await gh(`/repos/${repo}/pulls/${prArg}`, token)).json()] : await ghAll(`/repos/${repo}/pulls?state=open`, token);
  const own = listed.filter((p) => p.state === 'open' && !p.draft && p.head?.repo?.full_name === repo);
  console.log(`${own.length} open PR(s) of our own${dryRun ? ' (dry run)' : ''}`);

  for (const listedPr of own) {
    const p = await readPr(listedPr.number);
    if (p.state !== 'open') continue;
    const n = p.number;
    const headRef = p.head.ref;
    const author = p.user?.login ?? '';
    if (p.mergeable === null) { console.log(`#${n}: GitHub has not computed mergeability yet; next run`); continue; }
    if (p.mergeable !== false) continue;
    if (!refreshable(author, headRef)) { console.log(`#${n}: conflicts with ${p.base.ref}; not a bot PR of ours, so its author resolves it`); continue; }

    const dir = mkdtempSync(join(tmpdir(), 'fleet-refresh-'));
    let res;
    try {
      res = refreshBranch({
        dir, remote, auth, headRef, headSha: p.head.sha, baseRef: p.base.ref, dryRun,
        message: mergeMessage({ number: n, headRef, baseRef: p.base.ref, baseSha: p.base.sha }),
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }

    if (!res.ok) {
      console.log(`#${n}: not refreshed: ${res.reason}`);
      if (/moved|rejected/.test(res.reason) || dryRun) continue;
      const body = unresolvedComment({ baseRef: p.base.ref, baseSha: p.base.sha, headSha: p.head.sha, files: res.files, reason: res.reason });
      const marker = /<!-- fleet-refresh:head=\S+ base=\S+ -->/.exec(body)[0];
      const comments = await ghAll(`/repos/${repo}/issues/${n}/comments`, token);
      if (comments.some((c) => (c.body ?? '').includes(marker))) { console.log(`#${n}: already said so`); continue; }
      await post(`/repos/${repo}/issues/${n}/comments`, token, { body });
      console.log(`#${n}: commented`);
      continue;
    }

    console.log(`#${n}: ${dryRun ? 'would push' : 'pushed'} ${res.sha.slice(0, 7)} merging ${p.base.ref} into ${headRef}${res.files.length ? ` (resolved ${res.files.join(', ')})` : ''}`);
    if (dryRun) continue;
    // A push by this token starts no workflow run: dispatch the required check on the branch, and
    // Redline where the diff is code. The lanes are posted below, with every other PR's. A failed
    // dispatch fails the run, so it is seen, but the other PRs are still served.
    try {
      await post(`/repos/${repo}/actions/workflows/${SELF_TEST_WORKFLOW}/dispatches`, token, { ref: headRef });
      const files = (await ghAll(`/repos/${repo}/pulls/${n}/files`, token)).map((f) => f.filename);
      if (files.some(isCodePath)) {
        await post(`/repos/${repo}/actions/workflows/${REDLINE_WORKFLOW}/dispatches`, token, { ref: defaultBranch, inputs: { pr: String(n), head: res.sha } });
        console.log(`#${n}: dispatched self-test and Redline at ${res.sha.slice(0, 7)}`);
      } else {
        console.log(`#${n}: dispatched self-test at ${res.sha.slice(0, 7)}; docs only, the sweep approves`);
      }
    } catch (e) {
      console.error(`::error::#${n}: pushed ${res.sha.slice(0, 7)} but could not dispatch its checks: ${e.message}`);
      process.exitCode = 1;
    }
  }

  // Every open PR's lanes, so a status that went stale while a PR was conflicted is corrected.
  const statusScript = fileURLToPath(new URL('./fleet-status.mjs', import.meta.url));
  for (const p of own) {
    console.log(`== lanes #${p.number}`);
    const r = spawnSync(process.execPath, [...process.execArgv, statusScript, ...(dryRun ? ['--dry-run'] : [])], {
      env: { ...process.env, GITHUB_TOKEN: token, REPO: repo, PR: String(p.number), HEAD_REPO: '', HEAD_BRANCH: '', TARGET_URL: targetUrl ?? '' },
      encoding: 'utf8',
    });
    process.stdout.write(r.stdout);
    if (r.status !== 0) { process.stderr.write(r.stderr); process.exitCode = 1; }
  }
}
