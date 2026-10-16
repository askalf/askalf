#!/usr/bin/env node
// Keeps our own bot pull requests mergeable, and every open PR's fleet lanes current, after main
// moves. GitHub runs no pull_request or pull_request_review workflow on a PR with a merge conflict,
// so a conflicted PR's lanes never hear a verdict and nothing updates its branch; this does both.
//
// The invariants it keeps, for every open same-repo PR, on each push to main, on a schedule, and
// on demand:
//   - A conflicted PR by one of our identities on a bot branch (isBotPr in fleet-status.mjs,
//     Dependabot aside: it rebases its own PRs, and a push by us stops it) has the base branch
//     merged into it when the conflict is the receipts shape: rows both sides added to the same
//     Markdown table are kept, main's first and each once, and the headline count line
//     "**N fixes merged upstream** into A, B and more" becomes main's count, plus the PR's
//     increment, less the receipts (pull request links in rows) both sides added, with main's
//     names and then the PR's new ones. The headline is reconciled that way even when git merged
//     it without a conflict (two PRs adding receipts for projects already named make the same
//     edit), and the merge is declined when the count cannot be squared with the table. Any
//     other conflict is left alone, and the PR gets one comment saying so.
//   - The merge commit is pushed with the workflow's token. Events from that token start no
//     workflow runs, so the run then dispatches self-test (a required check) on the branch, and
//     Redline on a PR that touches code (a docs-only PR is approved by the deterministic sweep),
//     and posts the fleet lanes on the new head itself. The dispatches are reconciled, not fired
//     once: every run looks at each open PR whose head is a merge commit this script pushed and
//     dispatches whichever of those checks the head still lacks, so a dispatch that failed is
//     retried on the next run, and the PR is not left without its required check.
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
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isBotPr, isCodePath, collectPages, REDLINE_LOGIN } from './fleet-status.mjs';

export const MARKER = 'fleet-refresh';
/** The README's headline: "**23 fixes merged upstream** into Hugging Face, ioredis and more". */
export const COUNT_LINE = /^\*\*(\d+) fixes merged upstream\*\* into (.+?) and more$/;
export const SELF_TEST_WORKFLOW = 'fleet-status-self-test.yml';
export const SELF_TEST_CHECK = 'self-test';
export const REDLINE_WORKFLOW = 'redline.yml';
export const BOT_EMAIL = '41898282+github-actions[bot]@users.noreply.github.com';
const ROW = /^\|/;
const RECEIPT = /https:\/\/github\.com\/[^\s/)]+\/[^\s/)]+\/(?:pull|issues)\/\d+/g;
/** The receipt links in a file's table rows. */
export const receipts = (text) => new Set(text.split('\n').filter((l) => ROW.test(l)).flatMap((l) => l.match(RECEIPT) ?? []));

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

/**
 * The merged file with its headline count reconciled from the base and both sides: null when there
 * is nothing to change, false when the count cannot be squared with the table. Two PRs that each
 * add a receipt for a project already named make the same headline edit (22 to 23, same names);
 * git merges that cleanly while the rows conflict, and the count would end one short. So the
 * headline is recomputed whether or not it conflicted: main's count, plus the PR's increment, less
 * the rows both sides added that the table now holds once; main's names plus the PR's new ones.
 */
export function reconcileCountLine({ base, ours, theirs, merged }) {
  const one = (text) => { const m = text.split('\n').filter((l) => COUNT_LINE.test(l)); return m.length === 1 ? m[0] : null; };
  const [b, o, t, m] = [base, ours, theirs, merged].map(one);
  if (!b || !o || !t || !m) return null;
  const [bm, om, tm] = [b, o, t].map((l) => COUNT_LINE.exec(l));
  const increment = Number(om[1]) - Number(bm[1]);
  if (increment < 0 || Number(tm[1]) < Number(bm[1])) return false;
  // A receipt is a pull request or issue link in a table row; a row may hold several. The ones
  // both sides added, the merged table holds once.
  const [ro, rt, rb] = [ours, theirs, base].map(receipts);
  const shared = [...ro].filter((r) => rt.has(r) && !rb.has(r)).length;
  const added = increment - shared;
  if (added < 0) return false;
  const names = (x) => x[2].split(', ');
  const list = names(tm);
  for (const n of names(om)) if (!names(bm).includes(n) && !list.includes(n)) list.push(n);
  const line = `**${Number(tm[1]) + added} fixes merged upstream** into ${list.join(', ')} and more`;
  if (line === m) return null;
  return merged.split('\n').map((l) => (l === m ? line : l)).join('\n');
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
  const baseSha = run('rev-parse', 'refs/remotes/pr/base');
  const mergeBase = run('merge-base', headSha, baseSha);
  const merged = git(dir, extra, ['merge', '-q', '--no-commit', '--no-ff', baseSha], { check: false });
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
  // The headline count, in every file both sides changed, whether or not it conflicted. A path
  // both sides deleted, or that one side deleted and the merge dropped, is not in the merged tree
  // and has no headline to reconcile.
  const show = (rev, f) => git(dir, extra, ['show', `${rev}:${f}`], { check: false }).stdout;
  const changedBy = (rev) => run('diff', '--name-only', mergeBase, rev).split('\n').filter(Boolean);
  const inTree = (f) => { try { return statSync(join(dir, f)).isFile(); } catch { return false; } };
  const both = changedBy(headSha).filter((f) => changedBy(baseSha).includes(f) && inTree(f));
  for (const f of both) {
    const reconciled = reconcileCountLine({ base: show(mergeBase, f), ours: show(headSha, f), theirs: show(baseSha, f), merged: readFileSync(join(dir, f), 'utf8') });
    if (reconciled === null) continue;
    if (reconciled === false) {
      git(dir, extra, ['merge', '--abort'], { check: false });
      return { ok: false, reason: `the headline count in ${f} cannot be squared with its table`, files: files.includes(f) ? files : [...files, f] };
    }
    writeFileSync(join(dir, f), reconciled);
    run('add', '--', f);
    if (!files.includes(f)) files.push(f);
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

/** A PR head (GitHub's commit object) that this script pushed: our bot's merge of base into head. */
export function isRefreshCommit(commit, baseRef, headRef) {
  return (commit?.commit?.committer?.email ?? '') === BOT_EMAIL
    && (commit?.commit?.message ?? '').startsWith(`Merge ${baseRef} into ${headRef}\n`);
}

/**
 * The checks a refreshed head still lacks. `checkNames` are the head's check runs; self-test
 * reports there once dispatched on the branch. A Redline dispatch runs on the default branch, so
 * it is known by a workflow_dispatch run titled with the head (`redlineRunTitles`) or by its
 * verdict review at the head (`redlineVerdictAtHead`); a docs-only diff needs none.
 */
export function checksToDispatch({ checkNames, code, headSha, redlineRunTitles, redlineVerdictAtHead }) {
  return {
    selfTest: !checkNames.includes(SELF_TEST_CHECK),
    redline: code && !redlineVerdictAtHead && !redlineRunTitles.some((t) => t.includes(headSha)),
  };
}

/** The one comment a PR gets when its conflict is not the receipts shape. */
export function unresolvedComment({ baseRef, baseSha, headSha, files, reason }) {
  return `Fleet refresh could not update this branch: it conflicts with ${baseRef} at ${baseSha.slice(0, 7)} in ${files.map((f) => `\`${f}\``).join(', ') || 'the merge'}, and ${reason}. `
    + `The conflict blocks merging until it is resolved by hand; GitHub runs no pull_request or review workflow here while it stands, and Fleet refresh keeps the fleet/* statuses current on its own runs. `
    + `It will say so again only if the head or ${baseRef} moves.\n\n`
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

    // A merge that throws (git itself failing, say) fails the run, so it is seen, and leaves the
    // branch as it was; the other PRs, the dispatches and the lanes below are still served.
    const dir = mkdtempSync(join(tmpdir(), 'fleet-refresh-'));
    let res;
    try {
      res = refreshBranch({
        dir, remote, auth, headRef, headSha: p.head.sha, baseRef: p.base.ref, dryRun,
        message: mergeMessage({ number: n, headRef, baseRef: p.base.ref, baseSha: p.base.sha }),
      });
    } catch (e) {
      console.error(`::error::#${n}: the merge failed: ${e.message}`);
      process.exitCode = 1;
      continue;
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
  }

  // A push by this token starts no workflow run. Every open PR whose head is a merge commit this
  // script pushed, now or on an earlier run, gets the checks that head still lacks: self-test (a
  // required check) on the branch, and Redline where the diff is code. Looking at the head rather
  // than remembering the push means a dispatch that failed is retried here next run. A failure
  // fails the run, so it is seen, but the other PRs are still served.
  if (!dryRun) {
    for (const listedPr of own) {
      const n = listedPr.number;
      try {
        const p = await (await gh(`/repos/${repo}/pulls/${n}`, token)).json();
        if (p.state !== 'open') continue;
        const head = p.head.sha;
        const commit = await (await gh(`/repos/${repo}/commits/${head}`, token)).json();
        if (!isRefreshCommit(commit, p.base.ref, p.head.ref)) continue;
        const runs = await collectPages(async (k) => (await (await gh(`/repos/${repo}/commits/${head}/check-runs?per_page=100&page=${k}`, token)).json()).check_runs ?? []);
        const files = (await ghAll(`/repos/${repo}/pulls/${n}/files`, token)).map((f) => f.filename);
        const code = files.some(isCodePath);
        let redlineRunTitles = [];
        let redlineVerdictAtHead = false;
        if (code) {
          const reviews = await ghAll(`/repos/${repo}/pulls/${n}/reviews`, token);
          redlineVerdictAtHead = reviews.some((r) => r.user?.login === REDLINE_LOGIN && /^(APPROVED|CHANGES_REQUESTED)$/.test(r.state) && r.commit_id === head);
          const dispatched = (await (await gh(`/repos/${repo}/actions/workflows/${REDLINE_WORKFLOW}/runs?event=workflow_dispatch&per_page=50`, token)).json()).workflow_runs ?? [];
          redlineRunTitles = dispatched.map((r) => `${r.display_title ?? ''} ${r.name ?? ''}`);
        }
        const want = checksToDispatch({ checkNames: runs.map((r) => r.name), code, headSha: head, redlineRunTitles, redlineVerdictAtHead });
        if (want.selfTest) await post(`/repos/${repo}/actions/workflows/${SELF_TEST_WORKFLOW}/dispatches`, token, { ref: p.head.ref });
        if (want.redline) await post(`/repos/${repo}/actions/workflows/${REDLINE_WORKFLOW}/dispatches`, token, { ref: defaultBranch, inputs: { pr: String(n), head } });
        const did = [want.selfTest && 'self-test', want.redline && 'Redline'].filter(Boolean);
        console.log(`#${n}: refreshed head ${head.slice(0, 7)} ${did.length ? `dispatched ${did.join(' and ')}` : 'has its checks'}${!code ? '; docs only, the sweep approves' : ''}`);
      } catch (e) {
        console.error(`::error::#${n}: could not dispatch the checks its refreshed head lacks: ${e.message}`);
        process.exitCode = 1;
      }
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
