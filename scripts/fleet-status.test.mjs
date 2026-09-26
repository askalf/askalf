// Unit tests for scripts/fleet-status.mjs. Run: node scripts/fleet-status.test.mjs

import {
  laneStatuses,
  isCodePath,
  isBotPr,
  latestByContext,
  statusesToPost,
  verifiedAtHead,
  CONTEXTS,
  requiredCiState,
  REDLINE_LOGIN,
  VERIFIER_LOGIN,
  collectPages,
} from './fleet-status.mjs';
import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { console.log(`  ok   ${name}`); pass++; }
  else { console.log(`  FAIL ${name}`); fail++; }
}

const HEAD = '47536435fb5c9540d8cb36fd26d81e101955b364';
const OLD = '34b7875f46525f7899a4e6601fbca4be75443903';
const base = (over = {}) => ({
  head: HEAD, headRef: 'feat/opus-alias-5-5', author: 'askalf',
  files: ['src/proxy.ts', 'test/opus-alias-fallback.mjs', 'CHANGELOG.md'],
  labels: [], reviews: [], comments: [], ...over,
});
const verification = (sha, login = VERIFIER_LOGIN) => ({ login, body: `## Verification at ${sha}\n\nbody` });
const review = (login, state, commitId, body = '') => ({ login, state, commitId, body });
const by = (rows) => Object.fromEntries(rows.map((s) => [s.context, s]));

console.log('\n  isCodePath / isBotPr');
check('src is code', isCodePath('src/proxy.ts'));
check('markdown and images are not', !isCodePath('README.md') && !isCodePath('docs/art/x.PNG') && !isCodePath('docs/notes.txt'));
check('.github config is not', !isCodePath('.github/workflows/ci.yml') && !isCodePath('.github/labeler.yml'));
check('.github scripts are', isCodePath('.github/scripts/a.sh') && isCodePath('.github/workflows/helper.mjs'));
check('.gitattributes is not', !isCodePath('.gitattributes'));
check('askalf on bot/ is a bot PR', isBotPr('askalf', 'bot/cc-drift-v2.1.281'));
check('askalf on a feature branch is not', !isBotPr('askalf', 'feat/opus-alias-5-5'));
check('a person on bot/ is not', !isBotPr('someone', 'bot/cc-drift-v2.1.281'));
check('dependabot always is', isBotPr('dependabot[bot]', 'dependabot/npm/x'));

console.log('\n  verifiedAtHead');
check('label + comment at head', verifiedAtHead(base({ labels: ['verified'], comments: [verification(HEAD)] })));
check('a 7-char prefix counts', verifiedAtHead(base({ labels: ['verified'], comments: [verification(HEAD.slice(0, 7))] })));
check('the label alone does not', !verifiedAtHead(base({ labels: ['verified'] })));
check('a comment at an older head does not', !verifiedAtHead(base({ labels: ['verified'], comments: [verification(OLD)] })));
check('the latest comment wins', !verifiedAtHead(base({ labels: ['verified'], comments: [verification(HEAD), verification(OLD)] })));
check('another login does not count', !verifiedAtHead(base({ labels: ['verified'], comments: [verification(HEAD, 'someone')] })));
check('findings heading does not count', !verifiedAtHead(base({ labels: ['verified'], comments: [{ login: VERIFIER_LOGIN, body: `## Verification findings at ${HEAD}` }] })));

console.log('\n  code PR, not verified: everything waits on the Breaker');
{
  const s = by(laneStatuses(base({ reviews: [review(REDLINE_LOGIN, 'APPROVED', HEAD)] })));
  check('verify pending', s[CONTEXTS.verify].state === 'pending' && s[CONTEXTS.verify].description.includes('4753643'));
  check('review pending even with an approval at head', s[CONTEXTS.review].state === 'pending');
}

console.log('\n  verdicts on an older head');
{
  const s = by(laneStatuses(base({
    labels: ['verified'], comments: [verification(HEAD)],
    reviews: [
      review(REDLINE_LOGIN, 'CHANGES_REQUESTED', OLD),
    ],
  })));
  check('verify green', s[CONTEXTS.verify].state === 'success');
  check('an old CHANGES_REQUESTED is not a red at this head', s[CONTEXTS.review].state === 'pending' && s[CONTEXTS.review].description.includes('34b7875'));
}

console.log('\n  verdicts at the head');
{
  const s = by(laneStatuses(base({
    labels: ['verified'], comments: [verification(HEAD)],
    reviews: [
      review(REDLINE_LOGIN, 'CHANGES_REQUESTED', OLD),
      review(REDLINE_LOGIN, 'APPROVED', HEAD),
    ],
  })));
  check('Redline approved', s[CONTEXTS.review].state === 'success');
}
{
  const s = by(laneStatuses(base({
    labels: ['verified'], comments: [verification(HEAD)],
    reviews: [
      review(REDLINE_LOGIN, 'CHANGES_REQUESTED', HEAD),
    ],
  })));
  check('Redline changes requested is red', s[CONTEXTS.review].state === 'failure');
}

console.log('\n  deterministic approvals');
{
  const det = review(REDLINE_LOGIN, 'APPROVED', HEAD, '**Deterministic approval** low-risk');
  const code = by(laneStatuses(base({ labels: ['verified'], comments: [verification(HEAD)], reviews: [det] })));
  check('on code it is not Redline\'s verdict', code[CONTEXTS.review].state === 'pending');
  const docs = by(laneStatuses(base({ files: ['README.md'], reviews: [det] })));
  check('on docs it is', docs[CONTEXTS.review].state === 'success');
}

console.log('\n  exempt PRs');
{
  const docs = by(laneStatuses(base({ files: ['README.md', 'docs/routing.md'] })));
  check('docs: verify not required', docs[CONTEXTS.verify].state === 'success' && docs[CONTEXTS.verify].description.startsWith('Not required'));
  check('docs: review still waits on Redline', docs[CONTEXTS.review].state === 'pending');
  const bot = by(laneStatuses(base({ headRef: 'bot/cc-drift-v2.1.281', reviews: [review(REDLINE_LOGIN, 'APPROVED', HEAD)] })));
  check('bot branch: verify not required, approval counts', bot[CONTEXTS.verify].state === 'success' && bot[CONTEXTS.review].state === 'success');
  const many = Array.from({ length: 101 }, (_, i) => `docs/p${i}.md`);
  check('more than 100 files is code whatever they are', by(laneStatuses(base({ files: many })))[CONTEXTS.verify].state === 'pending');
  const hundred = Array.from({ length: 100 }, (_, i) => `docs/p${i}.md`);
  check('exactly 100 docs files is not code', by(laneStatuses(base({ files: hundred })))[CONTEXTS.verify].state === 'success');
  check('more than 100 docs files still verifies once required CI passes',
    by(laneStatuses(base({ files: many, requiredCi: 'passed' })))[CONTEXTS.verify].state === 'success');
}

console.log('\n  descriptions');
check('capped at 140 characters', laneStatuses(base()).every((r) => r.description.length <= 140));

console.log('\n  verifiedAtHead: the label and the comment are each required');
check('a comment at head without the label does not count', !verifiedAtHead(base({ comments: [verification(HEAD)] })));
check('an older comment followed by one at head counts', verifiedAtHead(base({ labels: ['verified'], comments: [verification(OLD), verification(HEAD)] })));
check('a blocked heading does not count', !verifiedAtHead(base({ labels: ['verified'], comments: [{ login: VERIFIER_LOGIN, body: `## Verification blocked at ${HEAD}` }] })));

console.log('\n  Redline reviews that are not verdicts, and verdicts in order');
{
  const s = by(laneStatuses(base({
    labels: ['verified'], comments: [verification(HEAD)],
    reviews: [review(REDLINE_LOGIN, 'APPROVED', OLD), review(REDLINE_LOGIN, 'DISMISSED', HEAD), review(REDLINE_LOGIN, 'COMMENTED', HEAD, 'notes')],
  })));
  check('a dismissal and a comment at head leave the older approval as the last verdict', s[CONTEXTS.review].state === 'pending' && s[CONTEXTS.review].description.includes('34b7875'));
}
{
  const s = by(laneStatuses(base({
    labels: ['verified'], comments: [verification(HEAD)],
    reviews: [review(REDLINE_LOGIN, 'APPROVED', HEAD), review(REDLINE_LOGIN, 'CHANGES_REQUESTED', HEAD)],
  })));
  check('changes requested after an approval at the same head is red', s[CONTEXTS.review].state === 'failure');
}
{
  const s = by(laneStatuses(base({ reviews: [review(REDLINE_LOGIN, 'CHANGES_REQUESTED', HEAD)] })));
  check('changes requested at an unverified head still waits on the Breaker', s[CONTEXTS.verify].state === 'pending' && s[CONTEXTS.review].state === 'pending');
}

console.log('\n  what counts as code');
check('.github actions are', isCodePath('.github/actions/retry/action.yml'));
check('a .txt outside docs is', isCodePath('notes.txt') && isCodePath('src/fixtures/a.txt'));
check('a .github script keeps its case', isCodePath('.github/workflows/helper.MJS'));

console.log('\n  bot PRs');
check('github-actions on bot/ is', isBotPr('github-actions[bot]', 'bot/x') && isBotPr('app/github-actions', 'bot/x'));
check('askalf on a release, receipts or dependabot branch is',
  isBotPr('askalf', 'release-v6.12.0') && isBotPr('askalf', 'release/6.12') && isBotPr('askalf', 'chore/release-v6.12.0') && isBotPr('askalf', 'receipts-2026-09-24') && isBotPr('askalf', 'dependabot/npm/x'));
{
  const docs = (n) => Array.from({ length: n }, (_, i) => `docs/p${i}.md`);
  // The bot rule is read before the file count: a bot PR over 100 files is still exempt, a person's is code.
  check('a bot PR with more than 100 files is still not code', by(laneStatuses(base({ headRef: 'bot/cc-drift-v2.1.281', files: docs(101) })))[CONTEXTS.verify].state === 'success');
  check('a person with more than 100 docs files is code', by(laneStatuses(base({ files: docs(101) })))[CONTEXTS.verify].state === 'pending');
  check('99 docs files are not code', by(laneStatuses(base({ files: docs(99) })))[CONTEXTS.verify].state === 'success');
}

console.log('\n  docs PRs still show Redline\'s verdict');
{
  const s = by(laneStatuses(base({ files: ['README.md'], reviews: [review(REDLINE_LOGIN, 'CHANGES_REQUESTED', HEAD)] })));
  check('changes requested on docs is red', s[CONTEXTS.review].state === 'failure');
  const old = by(laneStatuses(base({ files: ['README.md'], reviews: [review(REDLINE_LOGIN, 'CHANGES_REQUESTED', OLD)] })));
  check('changes requested on an older docs head is pending and says where', old[CONTEXTS.review].state === 'pending' && old[CONTEXTS.review].description.endsWith('(its last verdict was on 34b7875)'));
}

console.log('\n  required CI is the verification where the base branch requires checks');
{
  const REQ = ['test', 'build (22)', 'live-test'];
  const ok = (name) => ({ name, state: 'success' });
  check('no required checks -> none', requiredCiState([], [ok('test')]) === 'none');
  check('all required passed -> passed', requiredCiState(REQ, REQ.map(ok)) === 'passed');
  check('a required check not reported yet -> pending', requiredCiState(REQ, [ok('test'), ok('build (22)')]) === 'pending');
  check('a required check still running -> pending', requiredCiState(REQ, [ok('test'), ok('build (22)'), { name: 'live-test', state: 'in_progress' }]) === 'pending');
  check('a required check failed -> failed, even with another pending',
    requiredCiState(REQ, [{ name: 'test', state: 'failure' }, ok('build (22)')]) === 'failed');
  check('the last result per check counts (a rerun that passed)',
    requiredCiState(['test'], [{ name: 'test', state: 'failure' }, ok('test')]) === 'passed');
  check('skipped and neutral pass', requiredCiState(['a', 'b'], [{ name: 'a', state: 'skipped' }, { name: 'b', state: 'neutral' }]) === 'passed');
  check('checks nobody requires do not hold it', requiredCiState(['test'], [ok('test'), { name: 'fleet/verify', state: 'pending' }]) === 'passed');

  const lanes = (over) => by(laneStatuses(base(over)));
  const passed = lanes({ requiredCi: 'passed' });
  check('CI passed: fleet/verify green with no label or comment', passed[CONTEXTS.verify].state === 'success'
    && passed[CONTEXTS.verify].description === 'Required CI passed at 4753643');
  check('CI passed: Redline is waited on, not held for a Breaker',
    passed[CONTEXTS.review].description === 'Waiting on Redline at 4753643');
  check('CI pending: fleet/verify waits on CI, not the Breaker', lanes({ requiredCi: 'pending' })[CONTEXTS.verify].description === 'Waiting on required CI at 4753643');
  check('CI failed: fleet/verify red', lanes({ requiredCi: 'failed' })[CONTEXTS.verify].state === 'failure');
  check('CI pending: an old Breaker label and comment do not count',
    lanes({ requiredCi: 'pending', labels: ['verified'], comments: [verification(HEAD)] })[CONTEXTS.verify].state === 'pending');
  check('no required checks: the label and comment still verify',
    lanes({ requiredCi: 'none', labels: ['verified'], comments: [verification(HEAD)] })[CONTEXTS.verify].description === 'Verified at 4753643');
}

{
  // The dispatcher exempts a bot-shaped branch only when one of our identities opened it.
  check('a person on a bot-shaped branch is not a bot PR', !isBotPr('contributor', 'bot/maintenance'));
  check('a person on release/1.2 is not a bot PR', !isBotPr('someone', 'release/1.2'));
  check('askalf on bot/drift is a bot PR', isBotPr('askalf', 'bot/drift'));
  check('github-actions on receipts-2026 is a bot PR', isBotPr('github-actions[bot]', 'receipts-2026'));
  check('dependabot on any branch is a bot PR', isBotPr('dependabot[bot]', 'feature/x'));
}

{
  // With the fleet/* lanes listed as required checks, they must not wait on themselves.
  const ci = ['test', 'analyze'];
  const own = [CONTEXTS.verify, CONTEXTS.review];
  const green = ci.map((name) => ({ name, state: 'SUCCESS' }));
  check('own lanes required, CI green: passed', requiredCiState([...ci, ...own], green) === 'passed');
  check('own lanes required and pending, CI green: still passed',
    requiredCiState([...ci, ...own], [...green, ...own.map((name) => ({ name, state: 'PENDING' }))]) === 'passed');
  check('only own lanes required: none (the Breaker rule applies)', requiredCiState(own, []) === 'none');
  check('own lanes required, a real check running: pending',
    requiredCiState([...ci, ...own], [{ name: 'test', state: 'SUCCESS' }, { name: 'analyze', state: 'IN_PROGRESS' }]) === 'pending');
  let posted = [];
  let states = [];
  for (let round = 0; round < 3; round++) {
    const requiredCi = requiredCiState([...ci, ...own], [...green, ...posted]);
    const out = laneStatuses(base({ requiredCi, reviews: [
      review(REDLINE_LOGIN, 'APPROVED', HEAD),
    ] }));
    posted = out.map((x) => ({ name: x.context, state: x.state.toUpperCase() }));
    states = out.map((x) => x.state);
  }
  check('own lanes required, three rounds: both green', states.join() === 'success,success');
}

{
  // Post-then-verify ordering: what differs from the head's newest status per context is posted.
  const have = latestByContext([
    { context: 'fleet/review', state: 'success', description: 'Redline approved abc1234' },
    { context: 'fleet/review', state: 'pending', description: 'older' },
    { context: 'fleet/verify', state: 'success', description: 'Required CI passed at abc1234' },
  ]);
  check('latestByContext keeps the newest per context', have.get('fleet/review').state === 'success' && have.size === 2);
  const want = [
    { context: 'fleet/verify', state: 'success', description: 'Required CI passed at abc1234' },
    { context: 'fleet/review', state: 'pending', description: 'Waiting on Redline at abc1234' },
  ];
  const todo = statusesToPost(want, have).map((s) => s.context);
  check('an identical status is not posted again', !todo.includes('fleet/verify'));
  check('a differing state is posted', todo.includes('fleet/review'));
  check('a missing context is posted', statusesToPost([{ context: 'fleet/new', state: 'pending', description: 'x' }], have).length === 1);
  check('same state, new description is posted',
    statusesToPost([{ context: 'fleet/verify', state: 'success', description: 'Verified at abc1234' }], have).length === 1);
  // A stale run posted after a fresh one: the fresh run's verify pass sees the difference and corrects it.
  const stale = latestByContext([{ context: 'fleet/review', state: 'pending', description: 'Waiting on Redline at abc1234' }]);
  const fresh = [{ context: 'fleet/review', state: 'success', description: 'Redline approved abc1234' }];
  check('a stale overwrite is corrected on the next pass', statusesToPost(fresh, stale).length === 1);
  check('and then left alone', statusesToPost(fresh, latestByContext(fresh)).length === 0);
}

{
  // This copy of fleet-status.yml has no workflow_run trigger: the branch rules require no checks,
  // so no CI run can move a lane, and the workflows beside it are not listed. A copy that does list
  // workflows names every one that runs on pull_request or pull_request_target (a
  // pull_request_target run's checks land on the PR head too), so a required check it produces
  // refreshes the lanes when it finishes.
  const dir = join(fileURLToPath(new URL('..', import.meta.url)), '.github', 'workflows');
  const own = readFileSync(join(dir, 'fleet-status.yml'), 'utf8');
  const workflowRunList = (y) => {
    const m = /^  workflow_run:\s*\n\s+workflows:\s*\[([^\]]*)\]/m.exec(y);
    return m ? m[1].split(',').map((w) => w.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean) : null;
  };
  const onBlock = (y) => {
    const m = /^on:(.*)$/m.exec(y);
    if (!m) return '';
    const lines = [m[1]];
    for (const l of y.slice(m.index + m[0].length).split('\n').slice(1)) {
      if (/^[^\s#]/.test(l)) break;
      lines.push(l);
    }
    return lines.join('\n').replace(/#.*$/gm, '');
  };
  const workflowName = (f, y) => (/^name:\s*(.+)$/m.exec(y)?.[1] ?? f).trim().replace(/^['"]|['"]$/g, '');
  // The workflows ([name, yaml]) whose listing disagrees with their trigger.
  const misfits = (list, workflows) => workflows.filter(([name, y]) => {
    const on = onBlock(y);
    if (/\bpull_request(_target)?\b/.test(on)) return list !== null && !list.includes(name);
    return false;
  }).map(([name]) => name);
  const beside = readdirSync(dir).filter((x) => /\.ya?ml$/.test(x) && x !== 'fleet-status.yml')
    .map((f) => { const y = readFileSync(join(dir, f), 'utf8'); return [workflowName(f, y), y]; });
  check('fleet-status.yml has no workflow_run trigger', !/^\s*workflow_run:/m.test(own) && workflowRunList(own) === null);
  check('the workflows beside it agree with it', misfits(workflowRunList(own), beside).length === 0);
  const onPr = (name) => `name: ${name}\non:\n  pull_request:\n    types: [opened]\njobs: {}\n`;
  const onTarget = (name) => `name: ${name}\non:\n  pull_request_target:\njobs: {}\n`;
  check('no list: a pull_request workflow beside it is not a misfit', misfits(null, [['review', onPr('review')], ['pulse', onPr('pulse')]]).length === 0);
  check('a list must name every pull_request workflow', misfits(['review'], [['review', onPr('review')], ['pulse', onPr('pulse')]]).join() === 'pulse');
  check('a list must name a pull_request_target workflow too', misfits(['review'], [['review', onPr('review')], ['triage', onTarget('triage')]]).join() === 'triage');
  check('a list is read from the yaml', String(workflowRunList(own.replace(/^on:\n/m, 'on:\n  workflow_run:\n    workflows: ["ci", \'review\']\n    types: [completed]\n'))) === 'ci,review');
}

{
  // backfill pages past one page of open PRs and stops loudly at its cap.
  const wf = readFileSync(join(fileURLToPath(new URL('..', import.meta.url)), '.github', 'workflows', 'fleet-status.yml'), 'utf8');
  const limit = Number(/gh pr list --repo "\$REPO" --state open --limit (\d+)/.exec(wf)?.[1] ?? 0);
  check('backfill reads more than one page of open PRs', limit > 100);
  check('backfill fails at its cap instead of skipping PRs', new RegExp(`-ge ${limit}\\b`).test(wf) && /::error::/.test(wf));
}

{
  // Paging reads to the first short page, so a required check on page 2 still counts.
  const pager = (sizes) => async (n) => Array.from({ length: sizes[n - 1] ?? 0 }, (_, i) => ({ name: `check-${n}-${i}`, state: 'SUCCESS' }));
  const two = await collectPages(pager([100, 1]));
  check('101 rows over two pages are all read', two.length === 101);
  check('a full last page reads one more, empty, page', (await collectPages(pager([100, 100]))).length === 200);
  check('a short first page is the only page', (await collectPages(pager([5]))).length === 5);
  check('a required check on page 2 counts', requiredCiState(['check-2-0'], two) === 'passed');
}

{
  // The CLI, end to end, against a stubbed GitHub: the rules read fails closed, check runs page,
  // and a run posts only what differs, then re-reads and corrects a stale overwrite.
  const script = fileURLToPath(new URL('./fleet-status.mjs', import.meta.url));
  const stub = `
    const fx = JSON.parse(process.env.FLEET_STATUS_FIXTURE);
    const posted = [];
    const pageOf = (u) => Number(new URL(u).searchParams.get('page') ?? 1);
    const slice = (rows, u) => rows.slice((pageOf(u) - 1) * 100, pageOf(u) * 100);
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
    globalThis.fetch = async (url, init = {}) => {
      const p = new URL(url).pathname;
      if (init.method === 'POST') { posted.push({ path: p, ...JSON.parse(init.body) }); return json({}, 201); }
      if (p.endsWith('/files')) return json(slice(fx.files, url));
      if (p.endsWith('/reviews')) return json(slice(fx.reviews, url));
      if (p.endsWith('/comments')) return json(slice(fx.comments, url));
      if (p.includes('/rules/branches/')) return fx.rules === null ? json({ message: 'no' }, 500) : json(fx.rules);
      if (p.endsWith('/statuses')) return json(slice(fx.statuses.length > 1 ? fx.statuses.shift() : fx.statuses[0], url));
      if (p.endsWith('/check-runs')) return json({ check_runs: slice(fx.checkRuns, url) });
      if (/[/]pulls[/][0-9]+$/.test(p)) return json(fx.pr);
      return json({ message: 'unexpected ' + p }, 404);
    };
    process.on('exit', () => process.stdout.write('POSTED ' + JSON.stringify(posted) + '\\n'));
  `;
  const run = (fixture, ...args) => {
    const r = spawnSync(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(stub)}`, script, ...args], {
      env: { ...process.env, GITHUB_TOKEN: 't', REPO: 'o/r', PR: '7', FLEET_STATUS_FIXTURE: JSON.stringify(fixture) },
      encoding: 'utf8',
    });
    const posted = JSON.parse(/^POSTED (.*)$/m.exec(r.stdout)?.[1] ?? '[]');
    return { status: r.status, out: r.stdout + r.stderr, posted, lane: (c) => new RegExp(`^${c}\\s+(\\S+)\\s+(.*)$`, 'm').exec(r.stdout)?.slice(1) ?? [] };
  };
  const pr = (over = {}) => ({
    state: 'open', number: 7, html_url: 'https://x/pull/7',
    head: { sha: HEAD, ref: 'feat/x', repo: { full_name: 'o/r' } }, base: { ref: 'main' },
    user: { login: 'askalf' }, labels: [{ name: 'verified' }], ...over,
  });
  const fixture = (over = {}) => ({
    pr: pr(), files: [{ filename: 'src/a.ts' }], reviews: [], rules: [],
    comments: [{ user: { login: VERIFIER_LOGIN }, body: `## Verification at ${HEAD}` }],
    statuses: [[]], checkRuns: [], ...over,
  });
  const requireTest = [{ type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'test' }] } }];
  const filler = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, name: `lint-${i}`, status: 'completed', conclusion: 'success' }));

  const unreadable = run(fixture({ rules: null }), '--dry-run');
  check('rules that cannot be read leave verify pending, label and comment notwithstanding',
    unreadable.status === 0 && unreadable.lane(CONTEXTS.verify).join(' ') === `pending Waiting on required CI at ${HEAD.slice(0, 7)}`);
  const paged = run(fixture({ rules: requireTest, checkRuns: [...filler, { id: 101, name: 'test', status: 'completed', conclusion: 'success' }] }), '--dry-run');
  check('a required check run on the second page is read', paged.status === 0 && paged.lane(CONTEXTS.verify)[0] === 'success');
  const running = run(fixture({ rules: requireTest, checkRuns: [{ id: 1, name: 'test', status: 'in_progress', conclusion: null }] }), '--dry-run');
  check('a required check still running is pending, not failed', running.lane(CONTEXTS.verify).join(' ') === `pending Waiting on required CI at ${HEAD.slice(0, 7)}`);
  check('a dry run posts nothing', unreadable.posted.length === 0 && paged.posted.length === 0);

  const want = (context, state, description) => ({ context, state, description });
  const settled = [
    want(CONTEXTS.verify, 'success', `Verified at ${HEAD.slice(0, 7)}`),
    want(CONTEXTS.review, 'pending', `Waiting on Redline at ${HEAD.slice(0, 7)}`),
  ];
  const stale = [want(CONTEXTS.review, 'pending', 'older'), ...settled];
  const posting = run(fixture({ statuses: [[], stale, settled] }));
  check('the first pass posts both lanes on the head',
    posting.status === 0 && posting.posted.slice(0, 2).every((s) => s.path === `/repos/o/r/statuses/${HEAD}` && s.target_url === 'https://x/pull/7'));
  check('the second pass re-posts only the lane a stale run overwrote',
    posting.posted.length === 3 && posting.posted[2].context === CONTEXTS.review && /^pass 2: correcting fleet\/review$/m.test(posting.out));
  const quiet = run(fixture({ statuses: [settled] }));
  check('a head already showing the right statuses gets no post', quiet.status === 0 && quiet.posted.length === 0);
  const closed = run(fixture({ pr: pr({ state: 'closed' }) }));
  check('a closed PR gets no post', closed.status === 0 && closed.posted.length === 0 && /nothing to report/.test(closed.out));
  const fork = run(fixture({ pr: pr({ head: { sha: HEAD, ref: 'feat/x', repo: { full_name: 'else/r' } } }) }));
  check('a fork PR gets no post', fork.status === 0 && fork.posted.length === 0 && /fork PR/.test(fork.out));
}

{
  // requiredCi drives the verify lane ahead of the label and comment.
  const at = (requiredCi) => by(laneStatuses(base({ requiredCi, labels: ['verified'], comments: [verification(HEAD)] })));
  check('a failed required check is red even at a verified head',
    at('failed')[CONTEXTS.verify].state === 'failure' && at('failed')[CONTEXTS.verify].description === 'A required check failed at 4753643');
  check('pending required CI holds every lane', Object.values(at('pending')).every((s) => s.state === 'pending'));
}

console.log(`\n  ${pass} pass, ${fail} fail`);
if (fail > 0) process.exit(1);
