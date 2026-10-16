// Unit tests for scripts/fleet-refresh.mjs. Run: node scripts/fleet-refresh.test.mjs

import {
  refreshable,
  parseConflicts,
  resolveHunk,
  resolveConflicts,
  reconcileCountLine,
  receipts,
  refreshBranch,
  mergeMessage,
  unresolvedComment,
  isRefreshCommit,
  checksToDispatch,
  COUNT_LINE,
  SELF_TEST_WORKFLOW,
  SELF_TEST_CHECK,
  REDLINE_WORKFLOW,
  BOT_EMAIL,
} from './fleet-refresh.mjs';
import { REDLINE_LOGIN } from './fleet-status.mjs';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { console.log(`  ok   ${name}`); pass++; }
  else { console.log(`  FAIL ${name}`); fail++; }
}

console.log('\n  refreshable: our bot PRs, Dependabot aside');
check('askalf on receipts- is', refreshable('askalf', 'receipts-puppeteer-15460'));
check('askalf on bot/ is', refreshable('askalf', 'bot/redline-pin'));
check('github-actions on bot/ is', refreshable('github-actions[bot]', 'bot/x'));
check('askalf on a feature branch is not', !refreshable('askalf', 'feat/x'));
check('a person on a bot branch is not', !refreshable('someone', 'receipts-x'));
check('Dependabot is not: it rebases its own PRs', !refreshable('dependabot[bot]', 'dependabot/npm/x') && !refreshable('app/dependabot', 'dependabot/npm/x'));

console.log('\n  parseConflicts');
{
  const text = ['a', '<<<<<<< HEAD', 'o1', 'o2', '||||||| base', 'b1', '=======', 't1', '>>>>>>> main', 'z'].join('\n');
  const parts = parseConflicts(text);
  check('plain lines and one hunk', parts.length === 3 && parts[0] === 'a' && parts[2] === 'z');
  check('the hunk has ours, base and theirs', JSON.stringify(parts[1]) === JSON.stringify({ ours: ['o1', 'o2'], base: ['b1'], theirs: ['t1'] }));
  const two = parseConflicts(['<<<<<<< HEAD', 'o', '=======', 't', '>>>>>>> main'].join('\n'));
  check('a two-way hunk has a null base', two.length === 1 && two[0].base === null);
  check('an empty base section is an empty array', parseConflicts(['<<<<<<< HEAD', 'o', '||||||| base', '=======', 't', '>>>>>>> main'].join('\n'))[0].base.length === 0);
  let threw = false;
  try { parseConflicts('<<<<<<< HEAD\no\n'); } catch { threw = true; }
  check('an unterminated hunk throws', threw);
}

console.log('\n  resolveHunk: the headline count');
{
  const count = (n, names) => `**${n} fixes merged upstream** into ${names} and more`;
  check('the regex reads the live line', COUNT_LINE.test(count(24, 'Hugging Face, ioredis, goauthentik, Puppeteer')));
  const r = resolveHunk({ ours: [count(23, 'Hugging Face, ioredis, Puppeteer')], base: [count(22, 'Hugging Face, ioredis')], theirs: [count(23, 'Hugging Face, ioredis, goauthentik')] });
  check('main\'s count plus the PR\'s increment, main\'s names then the PR\'s new one', r?.[0] === count(24, 'Hugging Face, ioredis, goauthentik, Puppeteer'));
  const two = resolveHunk({ ours: [count(24, 'A, B, C, D')], base: [count(22, 'A, B')], theirs: [count(25, 'A, B, E, F, G')] });
  check('a PR adding two is +2 on main\'s count', two?.[0] === count(27, 'A, B, E, F, G, C, D'));
  check('a name both added is kept once', resolveHunk({ ours: [count(23, 'A, X')], base: [count(22, 'A')], theirs: [count(23, 'A, X')] })?.[0] === count(24, 'A, X'));
  check('a PR that lowered the count is not resolved', resolveHunk({ ours: [count(21, 'A')], base: [count(22, 'A')], theirs: [count(23, 'A, B')] }) === null);
  check('a count line and something else in one hunk is not', resolveHunk({ ours: [count(23, 'A'), 'extra'], base: [count(22, 'A')], theirs: [count(23, 'A, B')] }) === null);
  check('a two-way hunk is not', resolveHunk({ ours: [count(23, 'A')], base: null, theirs: [count(23, 'A, B')] }) === null);
}

console.log('\n  resolveHunk: table rows');
{
  const row = (k) => `| [${k} #1](https://github.com/${k}/pull/1) | ${k} fix. |`;
  const appended = resolveHunk({ ours: [row('puppeteer')], base: [], theirs: [row('goauthentik')] });
  check('both appended at the same place: main\'s row, then the PR\'s', appended?.join() === [row('goauthentik'), row('puppeteer')].join());
  const twoNew = resolveHunk({ ours: [row('p1'), row('p2')], base: [], theirs: [row('m1')] });
  check('two appended rows keep their order after main\'s', twoNew?.join() === [row('m1'), row('p1'), row('p2')].join());
  const inserted = resolveHunk({ ours: [row('a'), row('new'), row('b')], base: [row('a'), row('b')], theirs: [row('a'), row('b'), row('m')] });
  check('a row inserted beside its neighbour stays beside it', inserted?.join() === [row('a'), row('new'), row('b'), row('m')].join());
  const top = resolveHunk({ ours: [row('new'), row('a')], base: [row('a')], theirs: [row('a'), row('m')] });
  check('a row the PR put above a base row stays at the top', top?.join() === [row('new'), row('a'), row('m')].join());
  check('a row both sides added is kept once', resolveHunk({ ours: [row('same')], base: [], theirs: [row('same')] })?.join() === row('same'));
  check('a side that removed a base row is not resolved', resolveHunk({ ours: [row('b')], base: [row('a'), row('b')], theirs: [row('a'), row('b'), row('m')] }) === null);
  check('a side that changed a base row is not resolved', resolveHunk({ ours: [row('a') + ' edited'], base: [row('a')], theirs: [row('a'), row('m')] }) === null);
  check('a hunk that is not all table rows is not resolved', resolveHunk({ ours: ['prose'], base: [], theirs: ['other prose'] }) === null);
  check('a side that emptied the hunk is not resolved', resolveHunk({ ours: [], base: [], theirs: [row('m')] }) === null);
}

console.log('\n  resolveConflicts');
{
  const text = ['# T', '', '<<<<<<< HEAD', '**23 fixes merged upstream** into A, P and more', '||||||| base', '**22 fixes merged upstream** into A and more', '=======', '**23 fixes merged upstream** into A, G and more', '>>>>>>> main', '', '| a | b |', '<<<<<<< HEAD', '| p | 1 |', '||||||| base', '=======', '| g | 2 |', '>>>>>>> main', ''].join('\n');
  check('both receipts hunks resolve', resolveConflicts(text) === ['# T', '', '**24 fixes merged upstream** into A, G, P and more', '', '| a | b |', '| g | 2 |', '| p | 1 |', ''].join('\n'));
  check('one unresolvable hunk fails the file', resolveConflicts(text.replace('| g | 2 |', 'prose')) === null);
  check('a file without conflicts is not "resolved"', resolveConflicts('plain\ntext\n') === null);
}

console.log('\n  reconcileCountLine: the headline whether or not it conflicted');
{
  const doc = (count, names, rows) => `# T\n\n**${count} fixes merged upstream** into ${names} and more\n\n${rows.join('\n')}\n`;
  const base = doc(22, 'A, B', ['| a |']);
  const ours = doc(23, 'A, B', ['| a |', '| b2 |']);
  const theirs = doc(23, 'A, B', ['| a |', '| a2 |']);
  const merged = doc(23, 'A, B', ['| a |', '| a2 |', '| b2 |']);
  check('identical headline edits that git merged cleanly are bumped to the true count', reconcileCountLine({ base, ours, theirs, merged }) === doc(24, 'A, B', ['| a |', '| a2 |', '| b2 |']));
  check('new names on the PR side are added after main\'s', reconcileCountLine({ base, ours: doc(23, 'A, B, P', ['| a |']), theirs: doc(23, 'A, B, G', ['| a |']), merged: doc(23, 'A, B, G', ['| a |']) })?.includes('**24 fixes merged upstream** into A, B, G, P and more'));
  check('already right: nothing to change', reconcileCountLine({ base, ours, theirs, merged: doc(24, 'A, B', ['| a |', '| a2 |', '| b2 |']) }) === null);
  check('a PR that did not touch the count: nothing to change', reconcileCountLine({ base, ours: base, theirs, merged: theirs }) === null);
  check('no headline in a version: nothing to change', reconcileCountLine({ base: 'x', ours, theirs, merged }) === null);
  check('two headlines in the merged file: left alone', reconcileCountLine({ base, ours, theirs, merged: merged + merged }) === null);
  // Receipts are the pull request links in rows; a row may hold several.
  const link = (k, n = 1) => `[${k} #${n}](https://github.com/${k}/pull/${n})`;
  const row = (...links) => `| ${links.join(' · ')} | fix. |`;
  const A = row(link('a/a'));
  const X = row(link('x/x'));
  const X2 = row(link('x/x'), link('x/x', 2));
  const P = row(link('p/p'));
  const G = row(link('g/g'));
  check('receipts are the pull links in rows, several per row', [...receipts(`${A}\n${X2}\nprose https://github.com/n/n/pull/9\n`)].join() === 'https://github.com/a/a/pull/1,https://github.com/x/x/pull/1,https://github.com/x/x/pull/2');
  const baseR = doc(22, 'A, B', [A]);
  check('a receipt both sides added counts once', reconcileCountLine({ base: baseR, ours: doc(24, 'A, B', [A, X, P]), theirs: doc(24, 'A, B', [A, X, G]), merged: doc(24, 'A, B', [A, X, G, P]) }) === doc(25, 'A, B', [A, X, G, P]));
  check('a shared row holding two receipts counts both once', reconcileCountLine({ base: baseR, ours: doc(25, 'A, B', [A, X2, P]), theirs: doc(25, 'A, B', [A, X2, G]), merged: doc(25, 'A, B', [A, X2, G, P]) }) === doc(26, 'A, B', [A, X2, G, P]));
  check('a receipt in the base is not shared', reconcileCountLine({ base: doc(22, 'A, B', [A, X]), ours: doc(23, 'A, B', [A, X, P]), theirs: doc(23, 'A, B', [A, X, G]), merged: doc(23, 'A, B', [A, X, G, P]) }) === doc(24, 'A, B', [A, X, G, P]));
  check('a PR that added a row without the count, which main counted: declined',
    reconcileCountLine({ base: baseR, ours: doc(22, 'A, B', [A, X]), theirs: doc(23, 'A, B', [A, X]), merged: doc(23, 'A, B', [A, X]) }) === false);
  check('a PR that lowered the count: declined', reconcileCountLine({ base, ours: doc(21, 'A, B', ['| a |']), theirs, merged: theirs }) === false);
}

// A scratch repository: a bare remote with main and a bot branch that both edit the README.
const sh = (cwd, ...args) => {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stdout}${r.stderr}`);
  return r.stdout.trim();
};
const README = (count, names, rows) => `# Profile\n\n**${count} fixes merged upstream** into ${names} and more\n\n| PR | Fix |\n| --- | --- |\n${rows.map((r) => (r.startsWith('|') ? r : `| [${r} #1](https://github.com/${r}/pull/1) | ${r} fix. |`)).join('\n')}\n\nAlso shipped.\n`;
const BASE_ROWS = ['a/x', 'b/y'];
/**
 * Returns { bare, work, headSha, baseSha } with main and `branch` pushed to `bare`. `prFiles` gives
 * the files the PR writes over the base ({ path: content }); main always adds the goauthentik row.
 */
function scratch(branch = 'receipts-puppeteer', prFiles = (rows, count, names) => ({ 'README.md': README(count + 1, `${names}, Puppeteer`, [...rows, 'puppeteer/puppeteer']) })) {
  const root = mkdtempSync(join(tmpdir(), 'fleet-refresh-test-'));
  const bare = join(root, 'remote.git');
  const work = join(root, 'work');
  mkdirSync(work);
  sh(root, 'init', '-q', '--bare', bare);
  sh(work, 'init', '-q', '-b', 'main');
  writeFileSync(join(work, 'README.md'), README(22, 'Hugging Face, ioredis', BASE_ROWS));
  writeFileSync(join(work, 'other.txt'), 'unrelated\n');
  sh(work, 'add', '-A');
  sh(work, 'commit', '-q', '-m', 'base');
  sh(work, 'checkout', '-q', '-b', branch);
  for (const [path, content] of Object.entries(prFiles(BASE_ROWS, 22, 'Hugging Face, ioredis'))) writeFileSync(join(work, path), content);
  sh(work, 'commit', '-q', '-am', 'receipts: puppeteer');
  const headSha = sh(work, 'rev-parse', 'HEAD');
  sh(work, 'checkout', '-q', 'main');
  writeFileSync(join(work, 'README.md'), README(23, 'Hugging Face, ioredis, goauthentik', [...BASE_ROWS, 'goauthentik/authentik']));
  sh(work, 'commit', '-q', '-am', 'receipts: goauthentik');
  const baseSha = sh(work, 'rev-parse', 'HEAD');
  sh(work, 'push', '-q', bare, 'main', branch);
  return { root, bare, work, headSha, baseSha };
}
const EXPECTED = README(24, 'Hugging Face, ioredis, goauthentik, Puppeteer', [...BASE_ROWS, 'goauthentik/authentik', 'puppeteer/puppeteer']);
const show = (bare, ref, path) => sh(bare, 'show', `${ref}:${path}`);

console.log('\n  refreshBranch against a scratch remote');
{
  const s = scratch();
  const dir = mkdtempSync(join(s.root, 'clone-'));
  const r = refreshBranch({ dir, remote: s.bare, headRef: 'receipts-puppeteer', headSha: s.headSha, baseRef: 'main', message: mergeMessage({ number: 7, headRef: 'receipts-puppeteer', baseRef: 'main', baseSha: s.baseSha }) });
  check('the conflict is resolved and pushed', r.ok === true && r.files.join() === 'README.md');
  check('the branch now ends in the merge commit', sh(s.bare, 'rev-parse', 'receipts-puppeteer') === r.sha);
  check('the merge commit has the PR head and main as parents', sh(s.bare, 'rev-parse', `${r.sha}^1`) === s.headSha && sh(s.bare, 'rev-parse', `${r.sha}^2`) === s.baseSha);
  check('the README carries both receipts and a count of 24', show(s.bare, r.sha, 'README.md') + '\n' === EXPECTED);
  check('the message names the PR and has no trailer', /^Merge main into receipts-puppeteer\n\n#7 conflicted with main at [0-9a-f]{7}/.test(sh(s.bare, 'log', '-1', '--format=%B', r.sha)) && !/-By:/.test(sh(s.bare, 'log', '-1', '--format=%B', r.sha)));
  check('the committer is the Actions bot', sh(s.bare, 'log', '-1', '--format=%an <%ae>', r.sha) === 'github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com>');
  const again = refreshBranch({ dir: mkdtempSync(join(s.root, 'clone-')), remote: s.bare, headRef: 'receipts-puppeteer', headSha: s.headSha, baseRef: 'main', message: 'm' });
  check('a stale head sha is not pushed over', again.ok === false && /moved/.test(again.reason) && sh(s.bare, 'rev-parse', 'receipts-puppeteer') === r.sha);
  const dry = scratch();
  const d = refreshBranch({ dir: mkdtempSync(join(dry.root, 'clone-')), remote: dry.bare, headRef: 'receipts-puppeteer', headSha: dry.headSha, baseRef: 'main', message: 'm', dryRun: true });
  check('a dry run merges but does not push', d.ok === true && d.dryRun === true && sh(dry.bare, 'rev-parse', 'receipts-puppeteer') === dry.headSha);
  rmSync(s.root, { recursive: true, force: true });
  rmSync(dry.root, { recursive: true, force: true });
}
{
  const s = scratch('receipts-prose', (rows, count, names) => ({ 'README.md': README(count + 1, `${names}, Puppeteer`, rows).replace('Also shipped.', 'Also shipped, and more.') }));
  sh(s.work, 'checkout', '-q', 'main');
  writeFileSync(join(s.work, 'README.md'), readFileSync(join(s.work, 'README.md'), 'utf8').replace('Also shipped.', 'Also shipped by maintainers.'));
  sh(s.work, 'commit', '-q', '-am', 'prose');
  sh(s.work, 'push', '-q', s.bare, 'main');
  const r = refreshBranch({ dir: mkdtempSync(join(s.root, 'clone-')), remote: s.bare, headRef: 'receipts-prose', headSha: s.headSha, baseRef: 'main', message: 'm' });
  check('a prose conflict is left alone', r.ok === false && /README\.md conflicts beyond/.test(r.reason) && r.files.join() === 'README.md');
  check('and the branch is untouched', sh(s.bare, 'rev-parse', 'receipts-prose') === s.headSha);
  rmSync(s.root, { recursive: true, force: true });
}
{
  // The PR only touched other.txt: no conflict, but main moved. A clean merge is still pushed.
  const s = scratch('receipts-clean', () => ({ 'other.txt': 'changed\n' }));
  const r = refreshBranch({ dir: mkdtempSync(join(s.root, 'clone-')), remote: s.bare, headRef: 'receipts-clean', headSha: s.headSha, baseRef: 'main', message: 'm' });
  check('a clean merge is committed and pushed', r.ok === true && r.files.length === 0 && sh(s.bare, 'rev-parse', `${r.sha}^2`) === s.baseSha);
  rmSync(s.root, { recursive: true, force: true });
}
{
  // Both sides add a receipt for a project already named: the headline edits are identical and
  // git merges them without a conflict, so only the rows conflict. The count must still reach 24.
  const s = scratch('receipts-ioredis-2', (rows, count, names) => ({ 'README.md': README(count + 1, names, [...rows, 'redis/ioredis']) }));
  sh(s.work, 'checkout', '-q', 'main');
  writeFileSync(join(s.work, 'README.md'), README(23, 'Hugging Face, ioredis', [...BASE_ROWS, 'huggingface/hub']));
  sh(s.work, 'commit', '-q', '-am', 'receipts: hub, same names');
  s.baseSha = sh(s.work, 'rev-parse', 'HEAD');
  sh(s.work, 'push', '-q', '-f', s.bare, 'main');
  const r = refreshBranch({ dir: mkdtempSync(join(s.root, 'clone-')), remote: s.bare, headRef: 'receipts-ioredis-2', headSha: s.headSha, baseRef: 'main', message: 'm' });
  check('identical headline edits still end at the true count', r.ok === true
    && show(s.bare, r.sha, 'README.md') + '\n' === README(24, 'Hugging Face, ioredis', [...BASE_ROWS, 'huggingface/hub', 'redis/ioredis']));
  rmSync(s.root, { recursive: true, force: true });
}
{
  // Both sides deleted other.txt while adding conflicting receipts: the deletion merges cleanly
  // and is not in the merged tree, so the headline reconcile must skip it, not throw.
  const s = scratch('receipts-rm', (rows, count, names) => ({ 'README.md': README(count + 1, `${names}, Puppeteer`, [...rows, 'puppeteer/puppeteer']) }));
  sh(s.work, 'checkout', '-q', 'receipts-rm');
  sh(s.work, 'rm', '-q', 'other.txt');
  sh(s.work, 'commit', '-q', '-m', 'drop other.txt');
  s.headSha = sh(s.work, 'rev-parse', 'HEAD');
  sh(s.work, 'checkout', '-q', 'main');
  sh(s.work, 'rm', '-q', 'other.txt');
  sh(s.work, 'commit', '-q', '-m', 'drop other.txt too');
  s.baseSha = sh(s.work, 'rev-parse', 'HEAD');
  sh(s.work, 'push', '-q', '-f', s.bare, 'main', 'receipts-rm');
  const r = refreshBranch({ dir: mkdtempSync(join(s.root, 'clone-')), remote: s.bare, headRef: 'receipts-rm', headSha: s.headSha, baseRef: 'main', message: 'm' });
  check('a shared deletion beside a resolvable conflict is merged and pushed', r.ok === true && r.files.join() === 'README.md'
    && show(s.bare, r.sha, 'README.md') + '\n' === EXPECTED && sh(s.bare, 'ls-tree', '--name-only', r.sha) === 'README.md');
  rmSync(s.root, { recursive: true, force: true });
}
{
  // Both branches add receipt X (kept once) and one receipt of their own: 22 + 3 rows is 25, not 26.
  const s = scratch('receipts-shared', (rows, count, names) => ({ 'README.md': README(count + 2, names, [...rows, 'x/x', 'puppeteer/puppeteer']) }));
  sh(s.work, 'checkout', '-q', 'main');
  writeFileSync(join(s.work, 'README.md'), README(24, 'Hugging Face, ioredis', [...BASE_ROWS, 'x/x', 'goauthentik/authentik']));
  sh(s.work, 'commit', '-q', '-am', 'receipts: x and goauthentik');
  s.baseSha = sh(s.work, 'rev-parse', 'HEAD');
  sh(s.work, 'push', '-q', '-f', s.bare, 'main');
  const r = refreshBranch({ dir: mkdtempSync(join(s.root, 'clone-')), remote: s.bare, headRef: 'receipts-shared', headSha: s.headSha, baseRef: 'main', message: 'm' });
  // The PR's puppeteer row follows x in the PR, so it stays after x; main's goauthentik row keeps its place.
  check('a receipt both branches added is kept once and counted once', r.ok === true
    && show(s.bare, r.sha, 'README.md') + '\n' === README(25, 'Hugging Face, ioredis', [...BASE_ROWS, 'x/x', 'puppeteer/puppeteer', 'goauthentik/authentik']));
  rmSync(s.root, { recursive: true, force: true });
}
{
  // The shared row holds two receipts: 22 + 2 + 1 + 1 is 26, whichever side's headline is read.
  const TWO = '| [x/x #1](https://github.com/x/x/pull/1) · [#2](https://github.com/x/x/pull/2) | two fixes. |';
  const s = scratch('receipts-shared-two', (rows, count, names) => ({ 'README.md': README(count + 3, names, [...rows, TWO, 'puppeteer/puppeteer']) }));
  sh(s.work, 'checkout', '-q', 'main');
  writeFileSync(join(s.work, 'README.md'), README(25, 'Hugging Face, ioredis', [...BASE_ROWS, TWO, 'goauthentik/authentik']));
  sh(s.work, 'commit', '-q', '-am', 'receipts: x twice and goauthentik');
  sh(s.work, 'push', '-q', '-f', s.bare, 'main');
  const r = refreshBranch({ dir: mkdtempSync(join(s.root, 'clone-')), remote: s.bare, headRef: 'receipts-shared-two', headSha: s.headSha, baseRef: 'main', message: 'm' });
  check('a shared row with two receipts is kept once and both receipts counted once', r.ok === true
    && show(s.bare, r.sha, 'README.md') + '\n' === README(26, 'Hugging Face, ioredis', [...BASE_ROWS, TWO, 'puppeteer/puppeteer', 'goauthentik/authentik']));
  rmSync(s.root, { recursive: true, force: true });
}
{
  // The PR added a row without bumping the count; main added the same row and bumped it. The merge
  // is clean, the count cannot be squared with the table, and the branch is left alone.
  const s = scratch('receipts-uncounted', (rows, count, names) => ({ 'README.md': README(count, names, [...rows, 'x/x']) }));
  sh(s.work, 'checkout', '-q', 'main');
  writeFileSync(join(s.work, 'README.md'), README(23, 'Hugging Face, ioredis', [...BASE_ROWS, 'x/x']));
  sh(s.work, 'commit', '-q', '-am', 'receipts: x');
  sh(s.work, 'push', '-q', '-f', s.bare, 'main');
  const r = refreshBranch({ dir: mkdtempSync(join(s.root, 'clone-')), remote: s.bare, headRef: 'receipts-uncounted', headSha: s.headSha, baseRef: 'main', message: 'm' });
  check('a count that cannot be squared with the table declines the merge', r.ok === false && /headline count in README\.md cannot be squared/.test(r.reason)
    && r.files.join() === 'README.md' && sh(s.bare, 'rev-parse', 'receipts-uncounted') === s.headSha);
  rmSync(s.root, { recursive: true, force: true });
}
{
  // The same with no conflict at all: the PR appended its row somewhere else in the table.
  const s = scratch('receipts-top', (rows, count, names) => ({ 'README.md': README(count + 1, names, ['redis/ioredis', ...rows]) }));
  sh(s.work, 'checkout', '-q', 'main');
  writeFileSync(join(s.work, 'README.md'), README(23, 'Hugging Face, ioredis', [...BASE_ROWS, 'huggingface/hub']));
  sh(s.work, 'commit', '-q', '-am', 'receipts: hub, same names');
  s.baseSha = sh(s.work, 'rev-parse', 'HEAD');
  sh(s.work, 'push', '-q', '-f', s.bare, 'main');
  const r = refreshBranch({ dir: mkdtempSync(join(s.root, 'clone-')), remote: s.bare, headRef: 'receipts-top', headSha: s.headSha, baseRef: 'main', message: 'm' });
  check('a clean merge with identical headline edits is still bumped', r.ok === true && r.files.join() === 'README.md'
    && show(s.bare, r.sha, 'README.md') + '\n' === README(24, 'Hugging Face, ioredis', ['redis/ioredis', ...BASE_ROWS, 'huggingface/hub']));
  rmSync(s.root, { recursive: true, force: true });
}

console.log('\n  unresolvedComment');
{
  const c = unresolvedComment({ baseRef: 'main', baseSha: 'b'.repeat(40), headSha: 'a'.repeat(40), files: ['README.md'], reason: 'README.md conflicts beyond the receipts shape this script resolves' });
  check('names the base, the file and the reason', /conflicts with main at bbbbbbb in `README.md`, and README\.md conflicts beyond/.test(c));
  check('carries a marker for the head and base', c.includes(`<!-- fleet-refresh:head=${'a'.repeat(40)} base=${'b'.repeat(40)} -->`));
  check('says the conflict blocks merging and that the statuses keep refreshing', /blocks merging/.test(c) && /keeps the fleet\/\* statuses current/.test(c) && !/cannot refresh/.test(c));
}

console.log('\n  the CLI, end to end, against a stubbed GitHub and a scratch remote');
{
  const script = fileURLToPath(new URL('./fleet-refresh.mjs', import.meta.url));
  // The stub serves both this script and the fleet-status.mjs child it spawns (which inherits
  // --import through execArgv); each process prints what it posted when it exits.
  const stub = `
    import { spawnSync } from 'node:child_process';
    const fx = JSON.parse(process.env.FLEET_REFRESH_FIXTURE);
    const posted = [];
    const git = (...a) => spawnSync('git', ['-C', fx.bare, ...a], { encoding: 'utf8' }).stdout.trim();
    const withHead = (p) => ({ ...p, head: { ...p.head, sha: git('rev-parse', fx.branch) } });
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
    globalThis.fetch = async (url, init = {}) => {
      const u = new URL(url);
      const p = u.pathname;
      if (Number(u.searchParams.get('page') ?? 1) > 1) return p.endsWith('/check-runs') ? json({ check_runs: [] }) : json([]);
      if (init.method === 'POST') {
        const body = JSON.parse(init.body);
        if (p.endsWith('/dispatches') && fx.failDispatches > 0) { fx.failDispatches--; return json({ message: 'down' }, 500); }
        posted.push({ path: p, ...body });
        if (p.endsWith('/comments')) fx.comments.push({ user: { login: 'github-actions[bot]' }, body: body.body });
        return json({}, 201);
      }
      if (p === '/repos/o/r') return json({ default_branch: 'main' });
      if (p.endsWith('/pulls')) return json(fx.pulls.map(withHead));
      if (/[/]pulls[/][0-9]+$/.test(p)) { const m = fx.mergeable.length > 1 ? fx.mergeable.shift() : fx.mergeable[0]; return json({ ...withHead(fx.pr), mergeable: m }); }
      if (/[/]commits[/][0-9a-f]+$/.test(p)) { const sha = p.split('/').pop(); return json({ sha, commit: { message: git('log', '-1', '--format=%B', sha), committer: { email: git('log', '-1', '--format=%ce', sha) } } }); }
      if (p.endsWith('/files')) return json(fx.files);
      if (p.endsWith('/reviews')) return json(fx.reviews ?? []);
      if (p.endsWith('/comments')) return json(fx.comments);
      if (p.includes('/rules/branches/')) return json([]);
      if (p.endsWith('/statuses')) return json(posted.filter((x) => x.path.includes('/statuses/')).reverse());
      if (p.endsWith('/check-runs')) return json({ check_runs: fx.checkRuns ?? [] });
      if (p.endsWith('/runs')) return json({ workflow_runs: fx.redlineRuns ?? [] });
      return json({ message: 'unexpected ' + p }, 404);
    };
    process.on('exit', () => process.stdout.write('POSTED ' + JSON.stringify(posted) + '\\n'));
  `;
  const run = (fixture, remote, env = {}, ...args) => {
    const r = spawnSync(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(stub)}`, script, ...args], {
      env: { ...process.env, GITHUB_TOKEN: 't', REPO: 'o/r', PR: '', TARGET_URL: 'https://x/run', FLEET_REFRESH_REMOTE: remote, FLEET_REFRESH_POLL_MS: '0', FLEET_REFRESH_FIXTURE: JSON.stringify(fixture), ...env },
      encoding: 'utf8',
    });
    const posted = [...r.stdout.matchAll(/^POSTED (.*)$/gm)].flatMap((m) => JSON.parse(m[1]));
    return { status: r.status, out: r.stdout + r.stderr, posted };
  };
  const pr = (s, over = {}) => ({
    state: 'open', number: 7, draft: false, html_url: 'https://x/pull/7', user: { login: 'askalf' }, labels: [],
    head: { sha: s.headSha, ref: 'receipts-puppeteer', repo: { full_name: 'o/r' } }, base: { ref: 'main', sha: s.baseSha }, ...over,
  });
  const fixture = (s, over = {}) => ({ bare: s.bare, branch: 'receipts-puppeteer', pr: pr(s), pulls: [pr(s)], mergeable: [null, false], files: [{ filename: 'README.md' }], comments: [], ...over });
  const dispatches = (r) => r.posted.filter((p) => p.path.includes('/dispatches'));
  const CODE = [{ filename: 'README.md' }, { filename: '.github/scripts/x.sh' }];

  {
    const s = scratch();
    const r = run(fixture(s), s.bare);
    const sha = sh(s.bare, 'rev-parse', 'receipts-puppeteer');
    check('a conflicted docs bot PR is merged and pushed', r.status === 0 && sha !== s.headSha && show(s.bare, sha, 'README.md') + '\n' === EXPECTED);
    check('it waits for GitHub to compute mergeability', !/has not computed/.test(r.out));
    const dispatched = r.posted.filter((p) => p.path.includes('/dispatches'));
    check('self-test is dispatched on the branch', dispatched.some((p) => p.path === `/repos/o/r/actions/workflows/${SELF_TEST_WORKFLOW}/dispatches` && p.ref === 'receipts-puppeteer'));
    check('Redline is not dispatched on docs only', !dispatched.some((p) => p.path.includes(REDLINE_WORKFLOW)) && /docs only/.test(r.out));
    const lanes = r.posted.filter((p) => p.path.startsWith('/repos/o/r/statuses/'));
    check('the lanes are posted for the PR', lanes.length === 2 && lanes.map((l) => l.context).sort().join() === 'fleet/review,fleet/verify');
    check('no comment is posted', !r.posted.some((p) => p.path.endsWith('/comments')));
    rmSync(s.root, { recursive: true, force: true });
  }
  {
    const s = scratch();
    const r = run(fixture(s, { files: CODE }), s.bare);
    const sha = sh(s.bare, 'rev-parse', 'receipts-puppeteer');
    const redline = r.posted.find((p) => p.path === `/repos/o/r/actions/workflows/${REDLINE_WORKFLOW}/dispatches`);
    check('a code bot PR also gets Redline dispatched at the new head, on the default branch',
      r.status === 0 && redline && redline.ref === 'main' && redline.inputs.pr === '7' && redline.inputs.head === sha && sha !== s.headSha);
    rmSync(s.root, { recursive: true, force: true });
  }
  {
    const s = scratch();
    const r = run(fixture(s, { mergeable: [true] }), s.bare);
    check('a mergeable PR is left alone, lanes still posted', r.status === 0 && sh(s.bare, 'rev-parse', 'receipts-puppeteer') === s.headSha
      && !r.posted.some((p) => p.path.includes('/dispatches')) && r.posted.filter((p) => p.path.includes('/statuses/')).length === 2);
    rmSync(s.root, { recursive: true, force: true });
  }
  {
    const s = scratch();
    const r = run(fixture(s, { pr: pr(s, { user: { login: 'contributor' } }), pulls: [pr(s, { user: { login: 'contributor' } })] }), s.bare);
    check('a person\'s conflicted PR is not touched or commented on', r.status === 0 && sh(s.bare, 'rev-parse', 'receipts-puppeteer') === s.headSha
      && /not a bot PR of ours/.test(r.out) && !r.posted.some((p) => p.path.endsWith('/comments') || p.path.includes('/dispatches')));
    rmSync(s.root, { recursive: true, force: true });
  }
  {
    const s = scratch();
    const r = run(fixture(s), s.bare, {}, '--dry-run');
    check('a dry run pushes, posts and dispatches nothing', r.status === 0 && sh(s.bare, 'rev-parse', 'receipts-puppeteer') === s.headSha && r.posted.length === 0 && /would push/.test(r.out));
    rmSync(s.root, { recursive: true, force: true });
  }
  {
    const s = scratch('receipts-prose', (rows, count, names) => ({ 'README.md': README(count + 1, `${names}, Puppeteer`, rows).replace('Also shipped.', 'Also shipped, and more.') }));
    sh(s.work, 'checkout', '-q', 'main');
    writeFileSync(join(s.work, 'README.md'), readFileSync(join(s.work, 'README.md'), 'utf8').replace('Also shipped.', 'Also shipped by maintainers.'));
    sh(s.work, 'commit', '-q', '-am', 'prose');
    s.baseSha = sh(s.work, 'rev-parse', 'HEAD');
    sh(s.work, 'push', '-q', s.bare, 'main');
    const fx = fixture(s, { branch: 'receipts-prose', pr: pr(s, { head: { sha: s.headSha, ref: 'receipts-prose', repo: { full_name: 'o/r' } } }) });
    fx.pulls = [fx.pr];
    const first = run(fx, s.bare);
    const comment = first.posted.find((p) => p.path === '/repos/o/r/issues/7/comments');
    check('an unresolvable conflict gets one comment, no push, no dispatch', first.status === 0 && comment && comment.body.includes(`<!-- fleet-refresh:head=${s.headSha} base=${s.baseSha} -->`)
      && sh(s.bare, 'rev-parse', 'receipts-prose') === s.headSha && !first.posted.some((p) => p.path.includes('/dispatches')));
    const second = run({ ...fx, comments: [{ user: { login: 'github-actions[bot]' }, body: comment.body }] }, s.bare);
    check('the next run does not repeat the comment', second.status === 0 && !second.posted.some((p) => p.path.endsWith('/comments')) && /already said so/.test(second.out));
    rmSync(s.root, { recursive: true, force: true });
  }
  {
    const s = scratch();
    const r = run(fixture(s), s.bare, { PR: '7' });
    check('PR=<number> refreshes that PR alone', r.status === 0 && sh(s.bare, 'rev-parse', 'receipts-puppeteer') !== s.headSha);
    check('no token is a usage error', run(fixture(s), s.bare, { GITHUB_TOKEN: '' }).status === 2);
    rmSync(s.root, { recursive: true, force: true });
  }
  {
    // A push that succeeds while the dispatch fails must not leave the head without its required
    // check: the next run, with the PR mergeable again, dispatches what the head lacks.
    const s = scratch();
    const first = run(fixture(s, { failDispatches: 1 }), s.bare);
    const sha = sh(s.bare, 'rev-parse', 'receipts-puppeteer');
    check('push ok, dispatch down: the merge is pushed, the run fails and says why',
      first.status === 1 && sha !== s.headSha && /could not dispatch/.test(first.out) && dispatches(first).length === 0);
    const second = run(fixture(s, { mergeable: [true] }), s.bare);
    check('the next run, PR mergeable, dispatches the missing self-test without another merge',
      second.status === 0 && sh(s.bare, 'rev-parse', 'receipts-puppeteer') === sha
      && dispatches(second).length === 1 && dispatches(second)[0].path.endsWith(`${SELF_TEST_WORKFLOW}/dispatches`) && dispatches(second)[0].ref === 'receipts-puppeteer');
    const third = run(fixture(s, { mergeable: [true], checkRuns: [{ name: 'status' }, { name: SELF_TEST_CHECK }] }), s.bare);
    check('once self-test reports at the head, nothing more is dispatched', third.status === 0 && dispatches(third).length === 0 && /has its checks/.test(third.out));
    rmSync(s.root, { recursive: true, force: true });
  }
  {
    // A shared deletion beside the receipts conflict: the PR is pushed and the lanes still post.
    const s = scratch();
    for (const b of ['receipts-puppeteer', 'main']) {
      sh(s.work, 'checkout', '-q', b);
      sh(s.work, 'rm', '-q', 'other.txt');
      sh(s.work, 'commit', '-q', '-m', 'drop other.txt');
    }
    s.headSha = sh(s.work, 'rev-parse', 'receipts-puppeteer');
    s.baseSha = sh(s.work, 'rev-parse', 'main');
    sh(s.work, 'push', '-q', '-f', s.bare, 'main', 'receipts-puppeteer');
    const r = run(fixture(s), s.bare);
    check('CLI: a shared deletion does not stop the refresh, the dispatch or the lanes', r.status === 0
      && sh(s.bare, 'rev-parse', 'receipts-puppeteer') !== s.headSha && dispatches(r).length === 1 && r.posted.filter((p) => p.path.includes('/statuses/')).length === 2);
    rmSync(s.root, { recursive: true, force: true });
  }
  {
    // A merge that throws fails the run but the lanes are still posted.
    const s = scratch();
    const r = run(fixture(s), join(s.root, 'no-such-remote.git'));
    check('CLI: a remote that cannot be fetched fails the run, reports it, and still posts the lanes',
      r.status === 1 && /::error::#7: the merge failed/.test(r.out) && r.posted.filter((p) => p.path.includes('/statuses/')).length === 2);
    rmSync(s.root, { recursive: true, force: true });
  }
  {
    // Redline is retried the same way on a code PR, until its dispatch run or its verdict exists.
    const s = scratch();
    const first = run(fixture(s, { files: CODE, failDispatches: 1 }), s.bare);
    const sha = sh(s.bare, 'rev-parse', 'receipts-puppeteer');
    check('code PR, dispatch down: nothing dispatched, run fails', first.status === 1 && dispatches(first).length === 0);
    const second = run(fixture(s, { files: CODE, mergeable: [true] }), s.bare);
    const redline = dispatches(second).find((p) => p.path.includes(REDLINE_WORKFLOW));
    check('the next run dispatches self-test and Redline at the head', second.status === 0 && dispatches(second).length === 2 && redline?.inputs.head === sha);
    const titled = run(fixture(s, { files: CODE, mergeable: [true], checkRuns: [{ name: SELF_TEST_CHECK }], redlineRuns: [{ display_title: `Redline review o/r#7 @ ${sha}`, name: 'Redline' }] }), s.bare);
    check('a Redline dispatch run titled with the head stops the retry', titled.status === 0 && dispatches(titled).length === 0);
    const judged = run(fixture(s, { files: CODE, mergeable: [true], checkRuns: [{ name: SELF_TEST_CHECK }], reviews: [{ user: { login: REDLINE_LOGIN }, state: 'CHANGES_REQUESTED', commit_id: sha }] }), s.bare);
    check('so does a Redline verdict at the head', judged.status === 0 && dispatches(judged).length === 0);
    const older = run(fixture(s, { files: CODE, mergeable: [true], checkRuns: [{ name: SELF_TEST_CHECK }], redlineRuns: [{ display_title: `Redline review o/r#7 @ ${s.headSha}` }], reviews: [{ user: { login: REDLINE_LOGIN }, state: 'APPROVED', commit_id: s.headSha }] }), s.bare);
    check('a run or verdict on the older head does not', older.status === 0 && dispatches(older).length === 1 && dispatches(older)[0].path.includes(REDLINE_WORKFLOW));
    rmSync(s.root, { recursive: true, force: true });
  }
}

console.log('\n  isRefreshCommit / checksToDispatch');
{
  const c = (message, email = BOT_EMAIL) => ({ commit: { message, committer: { email } } });
  check('our merge commit is', isRefreshCommit(c('Merge main into receipts-x\n\n#7 conflicted'), 'main', 'receipts-x'));
  check('a person\'s merge of main is not', !isRefreshCommit(c('Merge main into receipts-x\n', 't@x'), 'main', 'receipts-x'));
  check('the bot\'s other commits are not', !isRefreshCommit(c('pulse: 2026-10-16'), 'main', 'receipts-x'));
  check('another branch pair is not', !isRefreshCommit(c('Merge main into other\n'), 'main', 'receipts-x'));
  check('a missing commit is not', !isRefreshCommit(undefined, 'main', 'receipts-x'));
  const want = (o) => checksToDispatch({ checkNames: [], code: false, headSha: 'abc1234', redlineRunTitles: [], redlineVerdictAtHead: false, ...o });
  check('no checks at a docs head: self-test alone', JSON.stringify(want({})) === '{"selfTest":true,"redline":false}');
  check('self-test present: nothing', !want({ checkNames: ['status', SELF_TEST_CHECK] }).selfTest);
  check('code without a verdict or a dispatch: Redline too', want({ code: true }).redline === true);
  check('a dispatch run titled with the head: not again', !want({ code: true, redlineRunTitles: ['Redline review o/r#7 @ abc1234'] }).redline);
  check('a verdict at the head: not again', !want({ code: true, redlineVerdictAtHead: true }).redline);
}

console.log('\n  fleet-refresh.yml and the self-test workflow it dispatches');
{
  const dir = join(fileURLToPath(new URL('..', import.meta.url)), '.github', 'workflows');
  const y = readFileSync(join(dir, 'fleet-refresh.yml'), 'utf8');
  const onBlock = (/^on:\n((?:[ \t].*\n|\n)*)/m.exec(y)?.[1] ?? '').replace(/#.*$/gm, '');
  check('runs after a push to main, on a schedule and on demand', /^  push:\n    branches: \[main\]/m.test(onBlock) && /^  schedule:/m.test(onBlock) && /^  workflow_dispatch:/m.test(onBlock));
  check('never on a pull request, so no PR code reaches its write token', !/pull_request|issue_comment|workflow_run/.test(onBlock));
  check('the only checkout is the default branch\'s scripts, without credentials',
    (y.match(/uses: \S*checkout/g) ?? []).length === 1 && /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/.test(y)
    && /sparse-checkout: \|\n\s+scripts\/fleet-refresh\.mjs\n\s+scripts\/fleet-status\.mjs/.test(y) && /persist-credentials: false/.test(y));
  check('the job can push, comment, dispatch and post statuses, and no more',
    /^permissions: \{\}$/m.test(y) && /contents: write/.test(y) && /pull-requests: write/.test(y) && /actions: write/.test(y) && /statuses: write/.test(y)
    && !/issues: write|checks: write|id-token/.test(y));
  check('runs queue instead of overlapping', /group: fleet-refresh\n\s+cancel-in-progress: false/.test(y));
  check('runs the script from the checkout', /run: node scripts\/fleet-refresh\.mjs/.test(y));
  const self = readFileSync(join(dir, 'fleet-status-self-test.yml'), 'utf8');
  check('the self-test workflow this script dispatches can be dispatched', /^  workflow_dispatch:/m.test(self) && SELF_TEST_WORKFLOW === 'fleet-status-self-test.yml');
  check('the self-test workflow runs these tests', /node scripts\/fleet-refresh\.test\.mjs/.test(self));
  const redline = readFileSync(join(dir, REDLINE_WORKFLOW), 'utf8');
  check('the Redline workflow takes the pr and head inputs this script sends', /^  workflow_dispatch:\n    inputs:\n      pr:/m.test(redline) && /^      head:/m.test(redline));
}

console.log(`\n  ${pass} pass, ${fail} fail`);
if (fail > 0) process.exit(1);
