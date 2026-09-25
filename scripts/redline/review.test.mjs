// Unit and end-to-end tests for scripts/redline/review.mjs. Run: node scripts/redline/review.test.mjs
// The model and GitHub are stubbed through ctx.fetch; nothing leaves the machine.

import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  parseEnvFile, safePath, buildDiff, quoteIsGrounded, corpusOf, checkSubmission, finalVerdict,
  renderBody, verdictAtHead, runTool, runReview, buildBrief, REVIEWER_LOGIN, HEADER, LIMITS,
} from './review.mjs';

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { console.log(`  ok   ${name}`); pass++; }
  else { console.log(`  FAIL ${name}`); fail++; }
}
async function throws(fn) { try { await fn(); return null; } catch (e) { return e; } }

const HEAD = '47536435fb5c9540d8cb36fd26d81e101955b364';
const OTHER = '34b7875f46525f7899a4e6601fbca4be75443903';

console.log('\n  parseEnvFile');
{
  const e = parseEnvFile('# c\nA=1\n\nB="two words"\nC=\'x=y\'\n bad \nD = spaced \r\n');
  check('values, quotes and = inside a value', e.A === '1' && e.B === 'two words' && e.C === 'x=y' && e.D === 'spaced');
  check('comments and malformed lines are skipped', !('# c' in e) && !('bad' in e));
}

const root = mkdtempSync(join(tmpdir(), 'redline-'));
const outside = mkdtempSync(join(tmpdir(), 'redline-out-'));
mkdirSync(join(root, 'src'));
writeFileSync(join(root, 'src', 'a.js'), Array.from({ length: 900 }, (_, i) => `line ${i + 1}`).join('\n'));
writeFileSync(join(root, 'src', 'b.js'), 'export const token = process.env.X;\nconst y = 2;\n');
writeFileSync(join(root, 'img.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]));
writeFileSync(join(outside, 'secret.txt'), 'top secret');
let symlinked = true;
try { symlinkSync(join(outside, 'secret.txt'), join(root, 'leak.txt')); } catch { symlinked = false; }

console.log('\n  safePath');
check('a path inside resolves', safePath(root, 'src/a.js').endsWith('a.js'));
check('.. is refused', /outside/.test(runTool(root, 'redline_read', { path: '../x' })));
check('a leading slash is relative to the checkout, not the host', /no such file/.test(runTool(root, 'redline_read', { path: '/etc/passwd' })));
if (symlinked) check('a symlink out of the checkout is refused', /outside the checkout/.test(runTool(root, 'redline_read', { path: 'leak.txt' })));

console.log('\n  tools');
check('redline_list lists, directories with a slash', runTool(root, 'redline_list', {}).split('\n').includes('src/'));
{
  const r = runTool(root, 'redline_read', { path: 'src/a.js', start_line: 10, end_line: 12 });
  check('redline_read returns the numbered range', r.startsWith('10\tline 10\n11\tline 11\n12\tline 12\n') && r.includes('(file has 900 lines)'));
  const big = runTool(root, 'redline_read', { path: 'src/a.js' });
  check(`redline_read stops at ${LIMITS.readLines} lines`, big.includes(`${LIMITS.readLines}\tline ${LIMITS.readLines}\n`) && !big.includes(`${LIMITS.readLines + 1}\tline`));
}
check('redline_read refuses a binary file', /binary/.test(runTool(root, 'redline_read', { path: 'img.png' })));
check('redline_read on a directory says so', /directory/.test(runTool(root, 'redline_read', { path: 'src' })));
check('grep finds file:line: text', runTool(root, 'redline_search', { pattern: 'process\\.env' }) === 'src/b.js:1: export const token = process.env.X;');
check('grep skips binaries and reports no matches', runTool(root, 'redline_search', { pattern: 'PNG' }) === '(no matches)');
check('grep reports a bad pattern', /bad pattern/.test(runTool(root, 'redline_search', { pattern: '(' })));
check('grep caps its matches', runTool(root, 'redline_search', { pattern: 'line' }).endsWith('(match cap reached)'));
check('an unknown tool is an error, not a throw', /unknown tool/.test(runTool(root, 'exec', {})));

console.log('\n  diff, brief and grounding');
{
  const files = [
    { filename: 'src/b.js', status: 'modified', additions: 1, deletions: 0, patch: '@@ -1 +1,2 @@\n+export const token = process.env.X;\n const y = 2;' },
    { filename: 'img.png', status: 'added', additions: 0, deletions: 0 },
  ];
  const diff = buildDiff(files);
  check('a patch is included and a binary is named', diff.includes('+export const token') && diff.includes('diff --git a/img.png b/img.png\n(no patch'));
  check('the cap names what it left out', buildDiff(files, 60).includes('not shown, read them with redline_read: src/b.js'));
  const pr = { number: 7, title: 'feat: add token', body: '- adds the token\n\nGenerated with a tool', user: { login: 'askalf' },
    head: { ref: 'feat/x', sha: HEAD }, base: { ref: 'main', repo: { full_name: 'askalf/r' } } };
  const brief = buildBrief(pr, files, [{ sha: HEAD, commit: { message: 'feat: add token\n\nCo-Authored-By: Someone' } }], diff);
  const corpus = corpusOf(brief);
  check('a quote copied with its + marker is grounded', quoteIsGrounded('+export const token = process.env.X;', corpus));
  check('a quote copied without the marker is grounded', quoteIsGrounded('export const token = process.env.X;', corpus));
  check('a markdown list line from the PR body is grounded', quoteIsGrounded('- adds the token', corpus));
  check('a commit message line is grounded', quoteIsGrounded('Co-Authored-By: Someone', corpus));
  check('an invented line is not', !quoteIsGrounded('eval(userInput);', corpus));
  check('a fragment too short to prove anything is not', !quoteIsGrounded('y = 2', corpus));
  check('every line of a multi-line quote must be there', !quoteIsGrounded('const y = 2;\nconst z = 3;', corpus));
}

console.log('\n  submission, verdict and body');
{
  check('verdict must be one of the two', /verdict/.test(checkSubmission({ verdict: 'COMMENT', summary: 's', findings: [] }).error));
  check('summary is required', /summary/.test(checkSubmission({ verdict: 'APPROVE', summary: ' ', findings: [] }).error));
  check('a finding needs a quote', /quote/.test(checkSubmission({ verdict: 'REQUEST_CHANGES', summary: 's', findings: [{ severity: 'blocking', file: 'a', problem: 'p' }] }).error));
  check('an odd rule slug becomes none', checkSubmission({ verdict: 'REQUEST_CHANGES', summary: 's', findings: [], rule: 'Bad Rule!' }).review.rule === 'none');
  const blocking = { severity: 'blocking', file: 'src/b.js', line: 1, quote: 'export const token = process.env.X;', problem: 'Leaks X.', suggestion: 'const x = `a`;' };
  const approveButBlocking = checkSubmission({ verdict: 'APPROVE', summary: 'Looks fine.', findings: [blocking], rule: 'secret-exposure' }).review;
  check('a blocking finding forces REQUEST_CHANGES', finalVerdict(approveButBlocking) === 'REQUEST_CHANGES');
  check('minor findings do not', finalVerdict(checkSubmission({ verdict: 'APPROVE', summary: 's', findings: [{ ...blocking, severity: 'minor' }] }).review) === 'APPROVE');
  const body = renderBody(approveButBlocking, 'REQUEST_CHANGES', HEAD, ['a note']);
  check('body starts with the reviewer header', body.startsWith(HEADER));
  check('body quotes the finding, names file:line and ends with the rule and head marker',
    body.includes('`src/b.js:1`') && body.includes('> export const token') && body.includes('rule:secret-exposure') && body.endsWith(`<!-- redline:head=${HEAD} -->`));
  check('a suggestion containing backticks gets a longer fence', body.includes('````\nconst x = `a`;\n````') || body.includes('```\nconst x = `a`;\n```'));
  check('an approval carries no rule line', !renderBody(checkSubmission({ verdict: 'APPROVE', summary: 's', findings: [] }).review, 'APPROVE', HEAD).includes('rule:'));
  check('the fixed text uses no em dash', !renderBody(approveButBlocking, 'REQUEST_CHANGES', HEAD, ['n']).replace(/Leaks X\.|Looks fine\./g, '').includes('—'));
}

console.log('\n  verdictAtHead');
{
  const r = (login, state, commit_id) => ({ user: { login }, state, commit_id, html_url: `u-${state}` });
  check('none', verdictAtHead([], HEAD) === null);
  check('comments, other logins and other heads do not count',
    verdictAtHead([r(REVIEWER_LOGIN, 'COMMENTED', HEAD), r('someone', 'APPROVED', HEAD), r(REVIEWER_LOGIN, 'APPROVED', OTHER)], HEAD) === null);
  check('the last verdict at the head wins', verdictAtHead([r(REVIEWER_LOGIN, 'CHANGES_REQUESTED', HEAD), r(REVIEWER_LOGIN, 'APPROVED', HEAD)], HEAD).state === 'APPROVED');
  check('a dismissed review is not a verdict', verdictAtHead([r(REVIEWER_LOGIN, 'DISMISSED', HEAD)], HEAD) === null);
}

// ---------- end to end against a fake GitHub and a fake model ----------

const PATCH = '@@ -1 +1,2 @@\n+export const token = process.env.X;\n const y = 2;';
function world({ reviews = [], heads = [HEAD], turns, modelStatus = [] } = {}) {
  const calls = { posted: [], model: [], sleeps: 0 };
  let headReads = 0;
  const json = (body, status = 200) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    if (u.pathname.endsWith('/v1/messages')) {
      const body = JSON.parse(init.body);
      calls.model.push(body);
      if (modelStatus.length) { const s = modelStatus.shift(); if (s !== 200) return json({ error: 'busy' }, s); }
      const step = turns[Math.min(calls.model.length - 1, turns.length - 1)];
      return json({ content: typeof step === 'function' ? step(body) : step });
    }
    const p = u.pathname;
    if (init.method === 'POST' && p.endsWith('/reviews')) { const b = JSON.parse(init.body); calls.posted.push({ ...b, auth: init.headers.authorization }); return json({ html_url: 'https://x/review/1' }); }
    if (/\/pulls\/7$/.test(p)) { const sha = heads[Math.min(headReads++, heads.length - 1)]; return json({ number: 7, state: 'open', title: 'feat: add token', body: 'Adds it.', user: { login: 'askalf' }, head: { sha, ref: 'feat/x', repo: { full_name: 'askalf/r' } }, base: { ref: 'main', repo: { full_name: 'askalf/r' } } }); }
    if (p.endsWith('/reviews')) return json(u.searchParams.get('page') === '1' ? reviews : []);
    if (p.endsWith('/files')) return json(u.searchParams.get('page') === '1' ? [{ filename: 'src/b.js', status: 'modified', additions: 1, deletions: 0, patch: PATCH }] : []);
    if (p.endsWith('/commits')) return json(u.searchParams.get('page') === '1' ? [{ sha: HEAD, commit: { message: 'feat: add token' } }] : []);
    return json({ message: `unexpected ${p}` }, 404);
  };
  let t = 0;
  const ctx = { repo: 'askalf/r', pr: 7, headSha: HEAD, checkout: root, readToken: 'read', reviewToken: 'review', darioUrl: 'http://dario/', darioKey: 'k',
    model: 'm', system: 'sys', fetch, sleep: async () => { calls.sleeps++; }, now: () => (t += 1000) };
  return { ctx, calls };
}
const use = (name, input, id = name) => [{ type: 'tool_use', id, name, input }];
const submit = (input) => use('redline_submit', input, `s${Math.random()}`);
const APPROVE = { verdict: 'APPROVE', summary: 'No blocking issues; read src/b.js.', findings: [] };
const GOOD = { severity: 'blocking', file: 'src/b.js', line: 1, quote: '+export const token = process.env.X;', problem: 'Exports a secret from the environment.' };

console.log('\n  runReview');
{
  const { ctx, calls } = world({ turns: [use('redline_read', { path: 'src/b.js' }), submit(APPROVE)] });
  const r = await runReview(ctx);
  check('approve: posted at the head with the reviewer token', r.outcome === 'posted' && r.verdict === 'APPROVE'
    && calls.posted.length === 1 && calls.posted[0].commit_id === HEAD && calls.posted[0].event === 'APPROVE' && calls.posted[0].auth === 'Bearer review');
  check('the tool result went back to the model', JSON.stringify(calls.model[1].messages.at(-1)).includes('export const token'));
  check('the model got the diff and the tools, and no forced choice early', calls.model[0].messages[0].content.includes('+export const token') && calls.model[0].tools.length === 4 && !calls.model[0].tool_choice);
}
{
  const { ctx, calls } = world({ reviews: [{ user: { login: REVIEWER_LOGIN }, state: 'CHANGES_REQUESTED', commit_id: HEAD, html_url: 'old' }], turns: [submit(APPROVE)] });
  const r = await runReview(ctx);
  check('a verdict already at the head is reused: no model call, no post', r.outcome === 'existing' && r.verdict === 'REQUEST_CHANGES' && calls.model.length === 0 && calls.posted.length === 0);
}
{
  const { ctx, calls } = world({ heads: [OTHER], turns: [submit(APPROVE)] });
  const r = await runReview(ctx);
  check('a head that already moved is skipped', r.outcome === 'skipped' && calls.model.length === 0);
}
{
  const { ctx, calls } = world({ heads: [HEAD, OTHER], turns: [submit(APPROVE)] });
  const r = await runReview(ctx);
  check('a head that moves during the review gets no post', r.outcome === 'skipped' && calls.posted.length === 0);
}
{
  const bad = { ...GOOD, quote: 'eval(userInput); // never in the diff' };
  const { ctx, calls } = world({ turns: [submit({ verdict: 'REQUEST_CHANGES', summary: 'Two problems.', findings: [bad], rule: 'security' }), submit({ verdict: 'REQUEST_CHANGES', summary: 'One problem.', findings: [GOOD], rule: 'secret-exposure' })] });
  const r = await runReview(ctx);
  check('an ungrounded finding gets one repair round, then the grounded review posts',
    r.verdict === 'REQUEST_CHANGES' && calls.model.length === 2 && JSON.stringify(calls.model[1].messages.at(-1)).includes('not in the diff')
      && calls.posted[0].body.includes('rule:secret-exposure'));
}
{
  const bad = { ...GOOD, quote: 'eval(userInput); // never in the diff' };
  const { ctx, calls } = world({ turns: [submit({ verdict: 'REQUEST_CHANGES', summary: 'Problem.', findings: [bad] })] });
  const r = await runReview(ctx);
  check('still ungrounded after the repair: dropped, and the review fails closed with a note',
    r.verdict === 'REQUEST_CHANGES' && calls.posted[0].body.includes('could be grounded') && !calls.posted[0].body.includes('eval(userInput)'));
}
{
  const { ctx, calls } = world({ turns: [submit({ ...APPROVE, findings: [GOOD] })] });
  const r = await runReview(ctx);
  check('APPROVE with a blocking finding posts REQUEST_CHANGES', r.verdict === 'REQUEST_CHANGES' && calls.posted[0].event === 'REQUEST_CHANGES');
}
{
  const { ctx, calls } = world({ modelStatus: [429, 503], turns: [submit(APPROVE)] });
  const r = await runReview(ctx);
  check('429 and 5xx from the model are retried with backoff', r.verdict === 'APPROVE' && calls.sleeps === 2);
}
{
  const { ctx, calls } = world({ modelStatus: [400], turns: [submit(APPROVE)] });
  const e = await throws(() => runReview(ctx));
  check('a 400 from the model is not retried and fails the run', e && /HTTP 400/.test(e.message) && calls.sleeps === 0 && calls.posted.length === 0);
}
{
  const { ctx, calls } = world({ turns: [(b) => (b.tool_choice ? submit(APPROVE) : use('redline_list', {}))] });
  const r = await runReview(ctx);
  check(`the model is forced to submit at turn ${LIMITS.forceSubmitAt}`, r.verdict === 'APPROVE' && calls.model.length === LIMITS.forceSubmitAt && calls.model.at(-1).tool_choice.name === 'redline_submit');
  check('a forced turn keeps every tool in the request (history may name them)', calls.model.at(-1).tools.length === 4);
}
{
  const { ctx } = world({ turns: [use('redline_list', {})] });
  const lines = [];
  ctx.log = (l) => lines.push(l);
  const e = await throws(() => runReview(ctx));
  check('each turn is logged with its tools, and the forced turns are marked',
    lines[0] === 'turn 1: redline_list; stop=-' && lines.some((l) => l.startsWith(`turn ${LIMITS.forceSubmitAt} (forced): redline_list`)));
  check('a model that never submits fails the run', e && /no review submitted/.test(e.message));
}
{
  const { ctx, calls } = world({ turns: [(b) => (b.messages.length > 2 * LIMITS.forceSubmitAt + 1 ? submit(APPROVE) : use('redline_read', { path: 'src/b.js' }))] });
  const r = await runReview(ctx);
  const forcedResult = JSON.stringify(calls.model[LIMITS.forceSubmitAt].messages.at(-1));
  check('a read past the forced turn is refused, not run, and the model then submits',
    r.verdict === 'APPROVE' && forcedResult.includes('read budget is spent') && !forcedResult.includes('export const token'));
}
{
  const { ctx, calls } = world({ turns: [[{ type: 'text', text: 'thinking' }], submit(APPROVE)] });
  const r = await runReview(ctx);
  check('a text-only turn is nudged back to the tools', r.verdict === 'APPROVE' && calls.model[1].messages.at(-1).content.includes('redline_submit'));
  check('the nudge says the text was discarded', calls.model[1].messages.at(-1).content.startsWith('That text was discarded'));
}
{
  const { ctx, calls } = world({ turns: [[{ type: 'text', text: 'Here is my review in prose.' }]] });
  const e = await throws(() => runReview(ctx));
  check(`${LIMITS.textOnlyTurns} text-only answers in a row fail the run early, not at turn ${LIMITS.turns}`,
    e && /text-only answers in a row/.test(e.message) && calls.model.length === LIMITS.textOnlyTurns);
}
{
  const { ctx, calls } = world({ turns: [[{ type: 'text', text: 'a' }], use('redline_read', { path: 'src/b.js' }), [{ type: 'text', text: 'b' }], [{ type: 'text', text: 'c' }], submit(APPROVE)] });
  const r = await runReview(ctx);
  check('a tool call in between resets the text-only count', r.verdict === 'APPROVE' && calls.model.length === 5);
}
{
  const { ctx, calls } = world({ turns: [[{ type: 'text', text: 'Looks  fine\nto me.' }], submit(APPROVE)] });
  const lines = [];
  ctx.log = (l) => lines.push(l);
  const r = await runReview(ctx);
  check('a reply without a tool call is logged with its text, whitespace collapsed', r.verdict === 'APPROVE' && lines[0] === 'turn 1: no tool call; stop=- text="Looks fine to me."');
  check('a reply with a tool call logs no text', lines[1] === 'turn 2: redline_submit; stop=-' && calls.model.length === 2);
}
{
  // Empty replies (dario at its concurrency ceiling, 2026-09-25): not kept as history, and the same early end.
  const { ctx, calls } = world({ turns: [[]] });
  const e = await throws(() => runReview(ctx));
  check('empty replies end the run like text-only ones and never enter the history',
    e && /text-only answers in a row/.test(e.message) && calls.model.length === LIMITS.textOnlyTurns && calls.model.at(-1).messages.length === 1);
}
{
  const { ctx, calls } = world({ turns: [() => undefined] });
  const e = await throws(() => runReview(ctx));
  check('a reply with no content array fails the run at once', e && /no message content/.test(e.message) && calls.model.length === 1);
}
{
  const { ctx, calls } = world({ turns: [submit({ verdict: 'MAYBE', summary: 's', findings: [] }), submit(APPROVE)] });
  const lines = [];
  ctx.log = (l) => lines.push(l);
  const r = await runReview(ctx);
  check('a rejected submission is logged with its reason', lines.some((l) => l.includes('submission rejected: verdict must be')));
  check('a malformed submission is returned as an error and retried', r.verdict === 'APPROVE' && JSON.stringify(calls.model[1].messages.at(-1)).includes('is_error'));
}

{
  const { ctx, calls } = world({ turns: [submit({ ...APPROVE, findings: [GOOD] })] });
  ctx.dryRun = true;
  const r = await runReview(ctx);
  check('a dry run returns the verdict and body and posts nothing', r.outcome === 'dry-run' && r.verdict === 'REQUEST_CHANGES' && r.body.includes('> +export const token') && calls.posted.length === 0);
}

console.log('\n  CLI');
{
  const script = fileURLToPath(new URL('./review.mjs', import.meta.url));
  const r = spawnSync(process.execPath, [script], { env: { PATH: process.env.PATH }, encoding: 'utf8' });
  check('missing configuration exits 2 with an annotation', r.status === 2 && r.stderr.includes('::error::REDLINE_ENV_FILE is not set'));
}

console.log('\n  the reusable workflow');
{
  const wf = readFileSync(fileURLToPath(new URL('../../.github/workflows/redline-review.yml', import.meta.url)), 'utf8');
  check('it is a reusable workflow', /^on:\s*\n\s+workflow_call:/m.test(wf));
  check('the script is fetched at the workflow\'s own commit, not a moving branch', wf.includes('ref: ${{ github.job_workflow_sha }}') && !/ref: main\b/.test(wf));
  check('it runs on the caller\'s self-hosted runner label', /runs-on: \[self-hosted, "\$\{\{ inputs\.runner-label \}\}"\]/.test(wf));
  check('it refuses fork PRs itself', wf.includes('github.event.pull_request.head.repo.full_name == github.repository'));
  check('the PR checkout keeps no credentials', (wf.match(/persist-credentials: false/g) ?? []).length === 2);
  check('the job token is read-only', /permissions:\s*\n\s+contents: read\s*\n\s+pull-requests: read/.test(wf) && !/write/.test(wf.split('permissions:')[1] ?? ''));
  check('third-party actions are pinned by sha', [...wf.matchAll(/uses: ([^\s]+)/g)].every((m) => /@[0-9a-f]{40}$/.test(m[1])));
  check('nothing from the PR is interpolated into a run step', !/run:[^\n]*\$\{\{\s*github\.event\.pull_request\.(title|body|head\.ref)/.test(wf));
}

rmSync(root, { recursive: true, force: true });
rmSync(outside, { recursive: true, force: true });
console.log(`\n  ${pass} pass, ${fail} fail`);
if (fail > 0) process.exit(1);
