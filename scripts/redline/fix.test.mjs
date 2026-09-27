// Unit and end-to-end tests for scripts/redline/fix.mjs. Run: node scripts/redline/fix.test.mjs
// The model and GitHub are stubbed through ctx.fetch; git is real, on throwaway repositories under
// the temp directory. Nothing leaves the machine.

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  parseReviewUrl, parseReviewBody, inlineItems, formatFinding, detectRunner, allowedCommands, allowedArgv, safeWritePath, stageable,
  commitSubject, hasAttributionTrailer, neutraliseRefs, cleanNotes, summariseTests, renderNotes, fixRecord, fixProblem, saveFix,
  TOOLS, FINISH_REQUIRED, askForFinish, checkFinish, runLoop, buildBrief, childEnv, onlyOrigins, runFix,
  LIMITS, OUTCOMES, AUTHOR, FIX_VERSION, DEFAULT_MODEL, SUBJECT_BANNED,
} from './fix.mjs';
import { bumpCaller, fixCallerYaml, REVIEW_WORKFLOW, FIX_WORKFLOW, CALLERS } from './pin.mjs';

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { console.log(`  ok   ${name}`); pass++; }
  else { console.log(`  FAIL ${name}`); fail++; }
}
async function throws(fn) { try { await fn(); return null; } catch (e) { return e; } }
const SHA = /^[0-9a-f]{40}$/;
const HEAD = '47536435fb5c9540d8cb36fd26d81e101955b364';
const OTHER = '34b7875f46525f7899a4e6601fbca4be75443903';
const REVIEW_URL = 'https://github.com/askalf/r/pull/7#pullrequestreview-99';
const gitOk = spawnSync('git', ['--version'], { encoding: 'utf8' }).status === 0;
const npmOk = spawnSync('npm', ['--version'], { encoding: 'utf8', shell: process.platform === 'win32' }).status === 0;
const bashOk = !spawnSync('bash', ['-c', 'exit 0'], { encoding: 'utf8' }).error;

console.log('\n  the review link');
{
  const r = parseReviewUrl(REVIEW_URL);
  check('owner/name, PR and review id are read', r.repo === 'askalf/r' && r.pr === 7 && r.id === 99);
  check('a PR link without the review fragment is not a review', parseReviewUrl('https://github.com/askalf/r/pull/7') === null);
  check('a comment link is not a review', parseReviewUrl('https://github.com/askalf/r/pull/7#issuecomment-1') === null);
  check('another host is not a review', parseReviewUrl('https://example.com/askalf/r/pull/7#pullrequestreview-99') === null);
  check('padding is tolerated, trailing text is not', parseReviewUrl(` ${REVIEW_URL} `)?.id === 99 && parseReviewUrl(`${REVIEW_URL}x`) === null);
}

console.log('\n  the review body');
const BODY = [
  '**Verdict: request changes.** Two problems in the token handling.',
  '',
  '### 1. Blocking: `src/b.js:1`',
  '',
  '> export const token = process.env.X;',
  '> const y = 2;',
  '',
  'Exports a secret from the environment.',
  '',
  'Suggested fix:',
  '',
  '```',
  'const token = read();',
  '```',
  '',
  '### 2. Blocking: `README.md`',
  '',
  '> Generated with love',
  '',
  'The line credits a tool that is not the committer.',
  '',
  'Minor:',
  '- `src/c.js:4`: unused import',
  '- `src/d.js`: dead branch',
  '',
  '_1 finding(s) dropped: their quotes are not in the diff._',
  '',
  'rule:secret-exposure',
  '',
  `<!-- redline:head=${HEAD} -->`,
].join('\n');
{
  const r = parseReviewBody(BODY);
  check('the summary is the sentence after the verdict', r.summary === 'Two problems in the token handling.');
  check('two blocking and two minor findings', r.findings.length === 4 && r.findings.filter((f) => f.severity === 'blocking').length === 2);
  const [a, b, c, d] = r.findings;
  check('finding 1: file, line, both quote lines, the problem and the fenced suggestion',
    a.n === 1 && a.file === 'src/b.js' && a.line === 1 && a.quote === 'export const token = process.env.X;\nconst y = 2;'
    && a.problem === 'Exports a secret from the environment.' && a.suggestion === 'const token = read();');
  check('finding 2: a place without a line, no suggestion, and the Minor list does not bleed in',
    b.file === 'README.md' && b.line === null && b.quote === 'Generated with love' && b.problem === 'The line credits a tool that is not the committer.' && b.suggestion === '');
  check('minor findings carry their place and text', c.severity === 'minor' && c.file === 'src/c.js' && c.line === 4 && c.problem === 'unused import' && d.file === 'src/d.js' && d.line === null);
  check('the rule slug is read', r.rule === 'secret-exposure');
  check('the note and the head marker are in no finding', !r.findings.some((f) => /dropped|redline:head/.test(f.problem)));
  const crlf = parseReviewBody(BODY.replace(/\n/g, '\r\n'));
  check('CRLF bodies parse the same', crlf.findings.length === 4 && crlf.findings[0].suggestion === 'const token = read();');
  const plain = parseReviewBody(`Please handle the empty page.\n\n<!-- redline:head=${HEAD} -->`);
  check('a body without the shape is one blocking finding with the text, marker dropped', plain.findings.length === 1 && plain.findings[0].severity === 'blocking' && plain.findings[0].problem === 'Please handle the empty page.' && plain.findings[0].file === null);
  check('an empty body has no findings', parseReviewBody('').findings.length === 0 && parseReviewBody(null).findings.length === 0);
  const items = inlineItems([{ path: 'src/b.js', line: 3, body: ' Read it from the config. ' }, { path: 'src/c.js', line: null, original_line: 9, body: 'x' }, { path: 'z', line: 1, body: '  ' }]);
  check('inline comments keep path, line (original_line as a fallback) and trimmed body; empty ones drop',
    items.length === 2 && items[0].body === 'Read it from the config.' && items[0].line === 3 && items[1].line === 9);
  check('inline comments from a non-array are none', inlineItems(null).length === 0);
  const f = formatFinding(a);
  check('a finding is formatted with its place, quoted lines, problem and suggestion', f.startsWith('[1] blocking `src/b.js:1`\n> export const token') && f.includes('\nSuggested fix:\nconst token = read();'));
}

console.log('\n  toolchain detection and the run allowlist');
const root = mkdtempSync(join(tmpdir(), 'redline-fix-'));
const outside = mkdtempSync(join(tmpdir(), 'redline-fix-out-'));
mkdirSync(join(root, 'src'));
mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
writeFileSync(join(root, 'src', 'a.js'), 'export const a = 1;\n');
writeFileSync(join(root, 'test.mjs'), 'process.exit(0);\n');
writeFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'name: ci\n');
writeFileSync(join(outside, 'secret.txt'), 'top secret');
let symlinked = true;
try { symlinkSync(join(outside, 'secret.txt'), join(root, 'leak.txt')); } catch { symlinked = false; }
{
  const npm = detectRunner(['package.json', 'package-lock.json'], { scripts: { test: 'node --test', build: 'tsc', lint: '', release: 'x' } });
  check('npm with a lockfile: npm ci, and only the four scripts that exist and are not empty', npm.pm === 'npm' && npm.install.join(' ') === 'npm ci --no-audit --no-fund' && npm.scripts.join() === 'test,build');
  check('npm without a lockfile installs', detectRunner(['package.json'], { scripts: {} }).install.join(' ') === 'npm install --no-audit --no-fund');
  check('pnpm, yarn and bun are read from their lockfiles', detectRunner(['pnpm-lock.yaml'], {}).pm === 'pnpm' && detectRunner(['yarn.lock'], {}).pm === 'yarn' && detectRunner(['bun.lockb'], {}).pm === 'bun' && detectRunner(['bun.lock'], {}).pm === 'bun');
  check('packageManager wins over a lockfile', detectRunner(['package-lock.json'], { packageManager: 'pnpm@9.1.0' }).pm === 'pnpm');
  check('no package.json: nothing to install, no scripts', detectRunner(['README.md'], null).pm === null && detectRunner(['README.md'], null).install === null);
  const plan = { pm: 'npm', scripts: ['test', 'build'], install: ['npm', 'ci'] };
  check('the allowlist as shown to the model', allowedCommands(plan).join(', ') === 'npm test, npm run build, node <file>, node --test <file>');
  check('npm test is allowed', allowedArgv('npm test', plan, root).argv.join(' ') === 'npm test');
  check('npm run build is allowed', allowedArgv('npm run build', plan, root).argv.join(' ') === 'npm run build');
  check('npm run test is the test script too', allowedArgv('npm run test', plan, root).argv.join(' ') === 'npm run test');
  check('a script that is not in package.json is refused', /allowlist/.test(allowedArgv('npm run lint', plan, root).error));
  check('a script outside the four is refused even if it exists', /allowlist/.test(allowedArgv('npm run release', { ...plan, scripts: ['release'] }, root).error));
  check('npm install is refused', /allowlist/.test(allowedArgv('npm install left-pad', plan, root).error));
  check('another package manager is refused', /allowlist/.test(allowedArgv('pnpm test', plan, root).error));
  check('npx, sh, curl and git are refused', ['npx foo', 'sh -c ls', 'curl http://x', 'git push'].every((c) => /allowlist/.test(allowedArgv(c, plan, root).error)));
  check('shell characters are refused before anything is parsed', ['npm test; rm -rf /', 'npm test && curl x', 'node test.mjs | tee', 'node $(x)', 'node test.mjs > out', 'node "test.mjs"', 'node test.mjs #c']
    .every((c) => /without a shell/.test(allowedArgv(c, plan, root).error)));
  check('node <file> inside the checkout is allowed, path normalised', allowedArgv('node ./test.mjs', plan, root).argv.join(' ') === 'node test.mjs');
  check('node --test <file> is allowed', allowedArgv('node --test test.mjs', plan, root).argv.join(' ') === 'node --test test.mjs');
  check('node with another flag is refused', /one file/.test(allowedArgv('node -e 1', plan, root).error) && /one file/.test(allowedArgv('node --eval test.mjs', plan, root).error));
  check('node with two files is refused', /one file/.test(allowedArgv('node a.mjs test.mjs', plan, root).error));
  check('node on a file outside the checkout is refused', /outside/.test(allowedArgv('node ../x.mjs', plan, root).error));
  check('node on a missing file is refused', /no such file/.test(allowedArgv('node nope.mjs', plan, root).error));
  check('node on a directory is refused', /directory/.test(allowedArgv('node src', plan, root).error));
  if (symlinked) check('node on a symlink out of the checkout is refused', /outside the checkout/.test(allowedArgv('node leak.txt', plan, root).error));
  check('an empty command is refused', /empty/.test(allowedArgv('  ', plan, root).error));
  check('with no package manager only node is allowed', /allowlist/.test(allowedArgv('npm test', { pm: null, scripts: [], install: null }, root).error) && allowedCommands({ pm: null, scripts: [] }).join() === 'node <file>,node --test <file>');
}

console.log('\n  the write sandbox');
{
  const err = (p) => { try { safeWritePath(root, p); return ''; } catch (e) { return e.message; } };
  check('a path inside resolves', safeWritePath(root, 'src/new.js').endsWith('new.js'));
  check('a new file in a new directory resolves', safeWritePath(root, 'src/deep/er/new.js').endsWith('new.js'));
  check('.. is refused', /outside/.test(err('../x')) && /outside/.test(err('src/../../x')));
  check('an absolute path is relative to the checkout, not the host', safeWritePath(root, '/src/a.js').endsWith('a.js'));
  check('backslashes are normalised', safeWritePath(root, 'src\\a.js').endsWith('a.js'));
  check('.github is refused, at any depth', /\.github/.test(err('.github/workflows/ci.yml')) && /\.github/.test(err('.github/CODEOWNERS')) && /\.github/.test(err('.github')));
  check('.git and node_modules are refused', /\.git or node_modules/.test(err('.git/config')) && /\.git or node_modules/.test(err('node_modules/x/index.js')) && /\.git or node_modules/.test(err('a/node_modules/b')));
  check('a directory is refused', /directory/.test(err('src')));
  check('the checkout root itself is refused', /outside/.test(err('')) && /outside/.test(err('.')));
  if (symlinked) check('a symlink is refused', /symlink/.test(err('leak.txt')));
}

console.log('\n  what gets staged');
{
  const big = (p) => (p === 'big.bin' ? LIMITS.fileBytes + 1 : 10);
  const r = stageable(['src/a.js', '.github/workflows/ci.yml', 'package-lock.json', 'big.bin', 'src/new.js'], { installDirty: ['package-lock.json', 'src/new.js'], written: new Set(['src/new.js']), sizeOf: big });
  check('files the fix changed are kept', r.keep.join() === 'src/a.js,src/new.js');
  check('.github, a file over 1 MB and what the install dirtied are left out, each with its reason',
    r.skipped.map((s) => s.path).join() === '.github/workflows/ci.yml,package-lock.json,big.bin'
    && /\.github/.test(r.skipped[0].why) && /install/.test(r.skipped[1].why) && /larger/.test(r.skipped[2].why));
  check('a path the install dirtied that the model then wrote is the fix', r.keep.includes('src/new.js'));
}

console.log('\n  the commit subject');
{
  check('the model line gets the fix: prefix', commitSubject('reset the cursor on an empty page') === 'fix: reset the cursor on an empty page');
  check('a prefix the model added is not doubled', commitSubject('fix: reset the cursor') === 'fix: reset the cursor' && commitSubject('fix(pager)!: reset the cursor') === 'fix: reset the cursor');
  check('em and en dashes become commas', commitSubject('reset the cursor \u2014 twice') === 'fix: reset the cursor, twice' && !/[\u2013\u2014]/.test(commitSubject('a\u2013b')));
  check('issue closers are removed', commitSubject('reset the cursor (fixes #12)') === 'fix: reset the cursor' && commitSubject('Resolves askalf/dario#5: keep the cursor') === 'fix: keep the cursor');
  check('a bare ref and a URL are removed', commitSubject('reset the cursor #12') === 'fix: reset the cursor' && commitSubject('see https://x.y/z reset') === 'fix: see reset');
  check('only the first line counts', commitSubject('reset the cursor\n\nCo-Authored-By: Someone') === 'fix: reset the cursor');
  check('a subject that credits a tool falls back to the default', commitSubject('Fix by Claude') === 'fix: address the review' && commitSubject('Generated with love') === 'fix: address the review' && commitSubject('AI cleanup') === 'fix: address the review');
  check('a subject that names the machinery falls back too', commitSubject('answer the Redline findings') === 'fix: address the review' && commitSubject('as the model suggested') === 'fix: address the review');
  check('an empty line falls back', commitSubject('') === 'fix: address the review' && commitSubject(null) === 'fix: address the review');
  const long = commitSubject(`keep ${'the cursor '.repeat(20)}steady`);
  check(`a long subject is cut at a word under ${LIMITS.subjectChars} characters`, long.length <= LIMITS.subjectChars && !/\s$/.test(long) && long.startsWith('fix: keep the cursor'));
  check('trailing punctuation is dropped', commitSubject('reset the cursor.') === 'fix: reset the cursor');
  check('the banned list catches the shapes forge refuses', ['co-authored', 'signed-off', 'Claude', 'GPT', 'Copilot', 'LLM'].every((w) => SUBJECT_BANNED.test(w)));
  check('an attribution trailer in a message is found', hasAttributionTrailer('fix: x\n\nCo-Authored-By: A <a@b>') && hasAttributionTrailer('x\n\nGenerated with a tool') && hasAttributionTrailer('x\nSigned-off-by: a'));
  check('a clean message has none', !hasAttributionTrailer('fix: reset the cursor\n\nAnswers the review at https://github.com/a/b/pull/1#pullrequestreview-2.'));
}

console.log('\n  notes for the PR comment');
{
  check('a bare ref becomes a code span', neutraliseRefs('see #12 and #345.') === 'see `#12` and `#345`.');
  check('a ref already in code is left alone', neutraliseRefs('see `#12` and ``#13``') === 'see `#12` and ``#13``');
  check('a ref in a fenced block is left alone', neutraliseRefs('a #1\n```\n#2\n```\n#3') === 'a `#1`\n```\n#2\n```\n`#3`');
  check('an owner/repo#N ref is neutralised as a whole', neutraliseRefs('see askalf/dario#5.') === 'see `askalf/dario#5`.');
  check('a word glued to a ref is not a ref', neutraliseRefs('issue#5') === 'issue#5');
  check('an HTML entity and a heading are not refs', neutraliseRefs('&#39; and # heading and c#') === '&#39; and # heading and c#');
  const n = cleanNotes('Done \u2014 twice.\nCo-Authored-By: X <x@y>\nGenerated with tool\nSee #4.\n');
  check('cleanNotes drops trailer lines, replaces dashes and neutralises refs', n === 'Done, twice.\nSee `#4`.');
  check(`cleanNotes caps at ${LIMITS.notesChars}`, cleanNotes('x'.repeat(LIMITS.notesChars + 500)).length <= LIMITS.notesChars && cleanNotes('x'.repeat(LIMITS.notesChars + 500)).endsWith('(truncated)'));
  check('TAP totals are summarised', summariseTests('ok 1\n# tests 3\n# pass 2\n# fail 1\n') === '2 pass, 1 fail');
  check('a jest summary line is summarised', summariseTests('Tests:       3 passed, 3 total\n') === '3 passed, 3 total');
  check('the own-style line is summarised', summariseTests('  12 pass, 0 fail\n') === '12 pass, 0 fail');
  check('anything else is the tail', summariseTests('a\nb\nc\nd\n') === 'b | c | d');
  const r = renderNotes({ outcome: 'fixed', summary: 'Reads the token from the config \u2014 see #3.', files: ['src/b.js'], tests: { command: 'npm test', exit_code: 0, summary: '2 pass, 0 fail' }, skipped: [{ path: '.github/x', why: 'under .github/' }] });
  check('fixed notes: summary, files, what was left out, tests; clean', r.includes('Reads the token from the config, see `#3`.') && r.includes('Files: `src/b.js`') && r.includes('Left out: `.github/x` (under .github/)') && r.includes('Tests: `npm test` exited 0 (2 pass, 0 fail)') && !/[\u2013\u2014]/.test(r));
  check('refused notes are the reason', renderNotes({ outcome: 'refused', reason: 'the head moved' }) === 'the head moved');
  check('no_change notes say so', /No file changed\./.test(renderNotes({ outcome: 'no_change', summary: 's' })));
  check('fixed notes without a test script say so', /no test script/.test(renderNotes({ outcome: 'fixed', summary: 's', files: ['a'] })));
}

console.log('\n  fix.json');
{
  const base = { repo: 'askalf/r', pr: 7, headSha: HEAD, model: 'm' };
  const fixed = fixRecord({ ...base, outcome: 'fixed', newHead: OTHER, commits: [{ sha: OTHER, subject: 'fix: x' }], files: ['a'], tests: { command: 'npm test', exit_code: 0, summary: '1 pass, 0 fail' }, turns: 3, notes: 'n' });
  check('the record has exactly the contract keys', Object.keys(fixed).join() === 'version,repo,pr,base_head,new_head,outcome,commits,files,tests,turns,model,notes');
  check('fixed passes', fixProblem(fixed) === null && fixed.version === FIX_VERSION);
  check('no_change passes with no commit', fixProblem(fixRecord({ ...base, outcome: 'no_change', notes: 'n', turns: 1 })) === null);
  check('tests_failed passes with files and tests and no commit', fixProblem(fixRecord({ ...base, outcome: 'tests_failed', files: ['a'], tests: { command: 'npm test', exit_code: 1, summary: '' }, notes: 'n' })) === null);
  check('refused passes', fixProblem(fixRecord({ ...base, outcome: 'refused', notes: 'why' })) === null);
  check('a dry-run fixed record has files, no commit and no new head', fixProblem(fixRecord({ ...base, outcome: 'fixed', files: ['a'], notes: 'n' })) === null);
  const bad = (patch) => fixProblem({ ...fixed, ...patch });
  check('schema: version', /version/.test(bad({ version: 2 })));
  check('schema: repo, pr, base_head', /repo/.test(bad({ repo: 'x' })) && /pr/.test(bad({ pr: '7' })) && /base_head/.test(bad({ base_head: HEAD.slice(0, 7) })));
  check('schema: new_head is a sha or null', /new_head/.test(bad({ new_head: 'abc' })) && bad({ new_head: null, commits: [] }) === null);
  check('schema: outcome is one of the four', /outcome/.test(bad({ outcome: 'done' })) && OUTCOMES.join() === 'fixed,no_change,tests_failed,refused');
  check('schema: commits need sha and subject', /commit 1/.test(bad({ commits: [{ sha: OTHER }] })));
  check('schema: new_head is the last commit', /last commit/.test(bad({ new_head: HEAD })));
  check('schema: a non-fixed outcome carries no commit', /carries no commit/.test(bad({ outcome: 'refused' })));
  check('schema: files are paths', /files/.test(bad({ files: [''] })) && /files/.test(bad({ files: 'a' })));
  check('schema: tests is null or the triple', /tests/.test(bad({ tests: { command: 'x' } })) && bad({ tests: null }) === null);
  check('schema: turns, model, notes', /turns/.test(bad({ turns: -1 })) && /model/.test(bad({ model: 1 })) && /notes/.test(bad({ notes: 'a \u2014 b' })) && /notes/.test(bad({ notes: 'x'.repeat(LIMITS.notesChars + 1) })));
  check('schema: not an object', /object/.test(fixProblem(null)) && /object/.test(fixProblem([fixed])));
  const dir = mkdtempSync(join(tmpdir(), 'redline-fix-json-'));
  saveFix(join(dir, 'nested'), fixed);
  check('saveFix writes fix.json and notes.md', JSON.stringify(JSON.parse(readFileSync(join(dir, 'nested', 'fix.json'), 'utf8'))) === JSON.stringify(fixed) && readFileSync(join(dir, 'nested', 'notes.md'), 'utf8') === 'n\n');
  rmSync(dir, { recursive: true, force: true });
}

console.log('\n  finish_fix and the loop');
{
  check('the tool set is the contract', TOOLS.map((t) => t.name).join() === 'list_files,read_file,search,write_file,run,finish_fix');
  check('finish_fix needs a summary and, when fixed, a subject', /summary/.test(checkFinish({ outcome: 'fixed' }).error) && /subject/.test(checkFinish({ outcome: 'fixed', summary: 's' }).error));
  check('refused needs a reason', /reason/.test(checkFinish({ outcome: 'refused' }).error) && checkFinish({ outcome: 'refused', reason: 'r' }).sub.reason === 'r');
  check('an unknown outcome is refused', /outcome/.test(checkFinish({ outcome: 'partial', summary: 's', subject: 'x' }).error));
  check('the subject is sanitised on the way in', checkFinish({ outcome: 'fixed', summary: 's', subject: 'Fix: reset \u2014 now (fixes #1)' }).sub.subject === 'fix: reset, now');
  check('machinery narration in the summary is bounced with the phrase', /"AI-generated"/.test(checkFinish({ outcome: 'fixed', summary: 'Removed the AI-generated line.', subject: 'x' }).error));
  check('machinery narration in the reason is bounced', /"gating lane"/.test(checkFinish({ outcome: 'refused', reason: 'The gating lane is wrong.' }).error));
  const m = [{ role: 'user', content: 'brief' }];
  askForFinish(m); askForFinish(m);
  check('askForFinish appends the instruction to the last user turn once', m[0].content === `brief\n\n${FINISH_REQUIRED}`);
  const arr = [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: '1', content: 'x' }] }];
  askForFinish(arr);
  check('and as a text block after tool results', arr[0].content.length === 2 && arr[0].content[1].text === FINISH_REQUIRED);
}
const use = (name, input, id = `${name}-${Math.random()}`) => ({ content: [{ type: 'tool_use', id, name, input }] });
function loopWorld(turns, { canForce = true } = {}) {
  const calls = [];
  const tools = [];
  let t = 0;
  const ctx = {
    call: async (messages, toolChoice) => { calls.push({ messages: JSON.parse(JSON.stringify(messages)), toolChoice }); const step = turns[Math.min(calls.length - 1, turns.length - 1)]; return typeof step === 'function' ? step(messages, toolChoice) : step; },
    tool: async (name, input) => { tools.push([name, input]); return `ran ${name}`; },
    finalize: async (input) => (input.summary ? { sub: { outcome: 'fixed', ...input } } : { error: 'summary is required' }),
    now: () => (t += 1000), log: () => {}, canForce,
  };
  return { ctx, calls, tools };
}
{
  const w = loopWorld([use('read_file', { path: 'a' }), use('finish_fix', { summary: 's', subject: 'x' })]);
  const r = await runLoop(w.ctx, 'brief');
  check('a tool call runs and its result goes back; finish_fix ends the loop', r.sub?.summary === 's' && r.turns === 2 && w.tools[0][0] === 'read_file' && JSON.stringify(w.calls[1].messages.at(-1)).includes('ran read_file'));
  check('the brief is the first user turn, ending with the instruction', w.calls[0].messages[0].content.endsWith('finish with finish_fix.'));
}
{
  const w = loopWorld([use('list_files', {})]);
  const r = await runLoop(w.ctx, 'brief');
  check(`a model that never finishes is refused after ${LIMITS.turns} turns, not thrown`, /within 40 turns/.test(r.refused) && r.turns === LIMITS.turns && w.calls.length === LIMITS.turns);
  check(`tools are refused from turn ${LIMITS.forceFinishAt} on, with a forced tool_choice`, w.calls[LIMITS.forceFinishAt - 1].toolChoice?.name === 'finish_fix' && JSON.stringify(w.calls[LIMITS.forceFinishAt].messages.at(-1)).includes('budget is spent') && w.tools.length === LIMITS.forceFinishAt - 1);
}
{
  const w = loopWorld([(messages, tc) => (tc?.type === 'auto' && JSON.stringify(messages.at(-1)).includes(FINISH_REQUIRED.slice(0, 20)) ? use('finish_fix', { summary: 's', subject: 'x' }) : use('list_files', {}))], { canForce: false });
  const r = await runLoop(w.ctx, 'brief');
  check('a model that rejects a forced choice gets tool_choice auto and the instruction in the user turn, then finishes',
    r.sub && w.calls.length === LIMITS.forceFinishAt && w.calls.every((c) => c.toolChoice?.type !== 'tool') && w.calls.at(-1).toolChoice?.type === 'auto');
}
{
  const w = loopWorld([{ content: [{ type: 'text', text: 'thinking' }] }, use('finish_fix', { summary: 's', subject: 'x' })]);
  const r = await runLoop(w.ctx, 'brief');
  check('a text-only turn is nudged back to the tools', r.sub && /discarded/.test(w.calls[1].messages.at(-1).content));
  const t = loopWorld([{ content: [{ type: 'text', text: 'prose' }] }]);
  const rr = await runLoop(t.ctx, 'brief');
  check(`${LIMITS.textOnlyTurns} text-only answers in a row are refused early`, /text-only/.test(rr.refused) && t.calls.length === LIMITS.textOnlyTurns);
  const e = loopWorld([{ content: [] }]);
  const re = await runLoop(e.ctx, 'brief');
  check('empty replies never enter the history and end the same way', /text-only/.test(re.refused) && e.calls.at(-1).messages.length === 1);
  const n = loopWorld([{}]);
  check('a reply with no content array throws', (await throws(() => runLoop(n.ctx, 'brief')))?.message.includes('no message content'));
}
{
  const w = loopWorld([use('finish_fix', { subject: 'x' }), use('finish_fix', { summary: 's', subject: 'x' })]);
  const r = await runLoop(w.ctx, 'brief');
  check('a bounced finish_fix is returned as an error and retried', r.sub && JSON.stringify(w.calls[1].messages.at(-1)).includes('is_error'));
}
{
  const env = childEnv({ PATH: '/bin', GH_READ_TOKEN: 't', DARIO_API_KEY: 'k', HOME: '/root', SYSTEMROOT: 'C:\\Windows' }, '/scratch');
  check('children get PATH, a scratch HOME and CI, and no token or key', env.PATH === '/bin' && env.HOME === '/scratch' && env.CI === '1' && !('GH_READ_TOKEN' in env) && !('DARIO_API_KEY' in env));
  const f = onlyOrigins(async (u) => `ok ${u}`, ['https://api.github.com', 'http://127.0.0.1:3456/']);
  check('fetch is limited to GitHub and dario', (await f('https://api.github.com/x')) === 'ok https://api.github.com/x' && (await f('http://127.0.0.1:3456/v1/messages')).startsWith('ok') && (await throws(() => f('https://example.com/'))) !== null && (await throws(() => f('nope'))) !== null);
  const brief = buildBrief({ pr: { number: 7, title: 't', body: 'b', head: { ref: 'f' }, base: { ref: 'main', repo: { full_name: 'askalf/r' } } }, files: [{ status: 'modified', additions: 1, deletions: 0, filename: 'src/b.js' }], headSha: HEAD,
    review: parseReviewBody(BODY), items: inlineItems([{ path: 'src/b.js', line: 1, body: 'c' }]), plan: { pm: 'npm', scripts: ['test'] }, installNote: 'ok', diff: '+x' });
  check('the brief carries the PR, the findings, the inline comments, the allowlist and the test script', /PR #7: t/.test(brief) && /\[1\] blocking `src\/b\.js:1`/.test(brief) && /\[1\] src\/b\.js:1\nc/.test(brief) && /run accepts: npm test, node <file>/.test(brief) && /Test script: `npm test`/.test(brief) && /PR diff:\n\+x/.test(brief));
}

// ---------- end to end: a fake GitHub, a fake model, a real repository ----------

function sh(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}
function makeRepo({ pkg = null, testExit = 0 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'redline-fix-repo-'));
  sh(dir, ['init', '-q']);
  sh(dir, ['config', 'core.autocrlf', 'false']);
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'b.js'), 'export const token = process.env.X;\nconst y = 2;\n');
  writeFileSync(join(dir, 'test.mjs'), `process.exit(${testExit});\n`);
  writeFileSync(join(dir, '.gitignore'), 'node_modules/\n');
  if (pkg) writeFileSync(join(dir, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
  sh(dir, ['add', '-A']);
  sh(dir, ['-c', 'user.name=t', '-c', 'user.email=t@x', 'commit', '-q', '-m', 'feat: add token']);
  return { dir, head: sh(dir, ['rev-parse', 'HEAD']) };
}
function world(repo, { turns, prHead, reviewState = 'CHANGES_REQUESTED', reviewCommit, body = BODY, comments = [{ path: 'src/b.js', line: 1, body: 'Read it from the config instead.' }], dryRun = false, model = 'm', reviewUrl = REVIEW_URL } = {}) {
  const calls = { model: [], gh: [] };
  const head = prHead ?? repo.head;
  const json = (b, status = 200) => ({ ok: status < 300, status, json: async () => b, text: async () => JSON.stringify(b) });
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    if (u.pathname.endsWith('/v1/messages')) {
      const b = JSON.parse(init.body);
      calls.model.push({ ...b, key: init.headers['x-api-key'] });
      const step = turns[Math.min(calls.model.length - 1, turns.length - 1)];
      const res = typeof step === 'function' ? step(b) : step;
      return json(res.content ? res : { content: res });
    }
    calls.gh.push(u.pathname);
    const p = u.pathname;
    if (/\/pulls\/7$/.test(p)) return json({ number: 7, state: 'open', title: 'feat: add token', body: 'Adds it.', user: { login: 'askalf' }, head: { sha: head, ref: 'feat/x', repo: { full_name: 'askalf/r' } }, base: { ref: 'main', repo: { full_name: 'askalf/r' } } });
    if (/\/reviews\/99$/.test(p)) return json({ id: 99, state: reviewState, commit_id: reviewCommit ?? repo.head, body, html_url: REVIEW_URL, user: { login: 'sprayberry-redline' } });
    if (/\/reviews\/99\/comments$/.test(p)) return json(u.searchParams.get('page') === '1' ? comments : []);
    if (p.endsWith('/files')) return json(u.searchParams.get('page') === '1' ? [{ filename: 'src/b.js', status: 'modified', additions: 1, deletions: 0, patch: '@@ -1 +1,2 @@\n+export const token = process.env.X;\n const y = 2;' }] : []);
    return json({ message: `unexpected ${p}` }, 404);
  };
  const out = join(repo.dir, '..', `redline-fix-out-${Math.random().toString(36).slice(2)}`);
  let t = 0;
  const ctx = { repo: 'askalf/r', pr: 7, headSha: repo.head, reviewUrl, checkout: repo.dir, out, readToken: 'read', darioUrl: 'http://dario/', darioKey: 'k', model, system: 'sys',
    fetch, sleep: async () => {}, now: () => (t += 1000), log: () => {}, dryRun };
  return { ctx, calls, out };
}
const tool = (name, input) => ({ content: [{ type: 'tool_use', id: `${name}-${Math.random()}`, name, input }] });
const finish = (input) => tool('finish_fix', { outcome: 'fixed', subject: 'read the token from the config', summary: 'Reads the token from the config in `src/b.js` instead of the environment.', tests_run: 'node test.mjs, exit 0', ...input });
const FIXED_B = 'import { read } from "./config.js";\nexport const token = read();\nconst y = 2;\n';

if (!gitOk) {
  console.log('\n  skip the end-to-end tests: no git here');
} else {
  console.log('\n  runFix: a fix');
  {
    const repo = makeRepo();
    const w = world(repo, { turns: [tool('read_file', { path: 'src/b.js' }), tool('write_file', { path: 'src/b.js', content: FIXED_B }), tool('run', { command: 'node test.mjs' }), finish()] });
    const { record: r } = await runFix(w.ctx);
    check('outcome fixed with a new head past the base', r.outcome === 'fixed' && SHA.test(r.new_head) && r.new_head !== repo.head && r.base_head === repo.head);
    check('one commit, the sanitised subject, the file', r.commits.length === 1 && r.commits[0].sha === r.new_head && r.commits[0].subject === 'fix: read the token from the config' && r.files.join() === 'src/b.js');
    check('no test script: tests is null and the notes say so', r.tests === null && /no test script/.test(r.notes));
    check('the record passes the schema and carries the turns and the model', fixProblem(r) === null && r.turns === 4 && r.model === 'm');
    check('the notes are the summary, files and tests, clean', r.notes.startsWith('Reads the token from the config') && r.notes.includes('Files: `src/b.js`') && !/[\u2013\u2014]/.test(r.notes));
    check('the model got the brief with the findings and the tools, the key in a header', w.calls.model[0].messages[0].content.includes('[1] blocking `src/b.js:1`') && w.calls.model[0].tools.length === 6 && w.calls.model[0].key === 'k');
    check('the read went back to the model, the write and run reported', JSON.stringify(w.calls.model[1].messages.at(-1)).includes('export const token') && JSON.stringify(w.calls.model[2].messages.at(-1)).includes('wrote src/b.js') && JSON.stringify(w.calls.model[3].messages.at(-1)).includes('exit 0'));
    const bundle = join(w.out, 'fix.bundle');
    check('fix.bundle exists and verifies against the repo', existsSync(bundle) && spawnSync('git', ['bundle', 'verify', bundle], { cwd: repo.dir, encoding: 'utf8' }).status === 0);
    check('no diff.patch on a real fix', !existsSync(join(w.out, 'diff.patch')));
    const heads = spawnSync('git', ['bundle', 'list-heads', bundle], { encoding: 'utf8' }).stdout;
    check('the bundle carries HEAD at the new commit, requiring the base', heads.includes(`${r.new_head} HEAD`) && spawnSync('git', ['bundle', 'verify', bundle], { cwd: repo.dir, encoding: 'utf8' }).stdout.includes(repo.head));
    const show = sh(repo.dir, ['log', '-1', '--format=%an%n%ae%n%cn%n%ce%n%B', r.new_head]).split('\n');
    check('authored and committed as askalf', show[0] === AUTHOR.name && show[1] === AUTHOR.email && show[2] === AUTHOR.name && show[3] === AUTHOR.email);
    check('the message is the subject and the body naming the review, no trailer', show[4] === 'fix: read the token from the config' && show[5] === '' && show[6] === `Answers the review at ${REVIEW_URL}.` && !hasAttributionTrailer(show.slice(4).join('\n')));
    check('the commit is a fast-forward of the base', sh(repo.dir, ['merge-base', '--is-ancestor', repo.head, r.new_head]) === '');
    const clone = mkdtempSync(join(tmpdir(), 'redline-fix-clone-'));
    sh(clone, ['init', '-q']);
    sh(clone, ['fetch', '-q', repo.dir, repo.head]);
    const fetched = spawnSync('git', ['fetch', '-q', bundle, 'HEAD'], { cwd: clone, encoding: 'utf8' });
    check('another repository at the base can fetch the bundle', fetched.status === 0 && sh(clone, ['rev-parse', 'FETCH_HEAD']) === r.new_head);
    check('the fetched tree has the fix', spawnSync('git', ['show', `${r.new_head}:src/b.js`], { cwd: clone, encoding: 'utf8' }).stdout === FIXED_B);
    rmSync(clone, { recursive: true, force: true });
    rmSync(w.out, { recursive: true, force: true });
    rmSync(repo.dir, { recursive: true, force: true });
  }

  console.log('\n  runFix: a dry run');
  {
    const repo = makeRepo();
    const w = world(repo, { dryRun: true, turns: [tool('write_file', { path: 'src/b.js', content: FIXED_B }), tool('run', { command: 'node test.mjs' }), finish()] });
    const { record: r } = await runFix(w.ctx);
    check('a dry run is fixed with no commit and no new head', r.outcome === 'fixed' && r.new_head === null && r.commits.length === 0 && r.files.join() === 'src/b.js' && fixProblem(r) === null);
    check('diff.patch holds the change and no bundle is written', existsSync(join(w.out, 'diff.patch')) && readFileSync(join(w.out, 'diff.patch'), 'utf8').includes('+export const token = read();') && !existsSync(join(w.out, 'fix.bundle')));
    check('the repository head did not move', sh(repo.dir, ['rev-parse', 'HEAD']) === repo.head);
    rmSync(w.out, { recursive: true, force: true });
    rmSync(repo.dir, { recursive: true, force: true });
  }

  console.log('\n  runFix: the write sandbox and the allowlist, as the model sees them');
  {
    const repo = makeRepo();
    const w = world(repo, { turns: [
      tool('write_file', { path: '../escape.js', content: 'x' }), tool('write_file', { path: '.github/workflows/ci.yml', content: 'x' }),
      tool('write_file', { path: 'src/../../escape.js', content: 'x' }), tool('run', { command: 'npm test' }), tool('run', { command: 'node test.mjs; rm -rf /' }),
      tool('run', { command: 'node ../x.mjs' }), tool('read_file', { path: '../../etc/passwd' }), finish(),
    ] });
    const { record: r } = await runFix(w.ctx);
    const result = (i) => JSON.stringify(w.calls.model[i].messages.at(-1));
    check('a write outside the checkout is refused', /outside the checkout/.test(result(1)));
    check('a write under .github is refused', /\.github/.test(result(2)));
    check('a traversal through a subdirectory is refused', /outside the checkout/.test(result(3)));
    check('a command not in the allowlist is refused (no package.json here)', /allowlist/.test(result(4)));
    check('a shell chain is refused', /without a shell/.test(result(5)));
    check('node on a file outside is refused', /outside/.test(result(6)));
    check('a read outside is refused', /outside/.test(result(7)));
    check('nothing was written, so the outcome is no_change with no bundle', r.outcome === 'no_change' && !existsSync(join(w.out, 'fix.bundle')) && !existsSync(join(repo.dir, '..', 'escape.js')) && fixProblem(r) === null);
    check('no_change notes say so', /No file changed/.test(r.notes));
    rmSync(w.out, { recursive: true, force: true });
    rmSync(repo.dir, { recursive: true, force: true });
  }

  console.log('\n  runFix: limits');
  {
    const repo = makeRepo();
    const w = world(repo, { turns: [tool('list_files', {})] });
    const { record: r } = await runFix(w.ctx);
    check(`turns: refused after ${LIMITS.turns} model calls`, r.outcome === 'refused' && /within 40 turns/.test(r.notes) && r.turns === LIMITS.turns && w.calls.model.length === LIMITS.turns && fixProblem(r) === null);
    rmSync(w.out, { recursive: true, force: true });
    rmSync(repo.dir, { recursive: true, force: true });
  }
  {
    const repo = makeRepo();
    const gen = `import { writeFileSync } from 'node:fs'; for (let i = 0; i < ${LIMITS.files}; i++) writeFileSync('g' + i + '.txt', 'x');\n`;
    const w = world(repo, { turns: [tool('write_file', { path: 'gen.mjs', content: gen }), tool('run', { command: 'node gen.mjs' }), finish()] });
    const { record: r } = await runFix(w.ctx);
    check(`files: more than ${LIMITS.files} changed files is refused, with no bundle`, r.outcome === 'refused' && /files; the limit is 30/.test(r.notes) && !existsSync(join(w.out, 'fix.bundle')) && fixProblem(r) === null);
    rmSync(w.out, { recursive: true, force: true });
    rmSync(repo.dir, { recursive: true, force: true });
  }
  {
    const repo = makeRepo();
    const writes = [];
    for (let i = 0; i < LIMITS.files; i++) writes.push(tool('write_file', { path: `f${i}.txt`, content: 'x' }));
    const w = world(repo, { turns: [...writes, tool('write_file', { path: 'one-more.txt', content: 'x' }), finish()] });
    const { record: r } = await runFix(w.ctx);
    check(`files: the ${LIMITS.files + 1}th write is refused at the tool and the fix stays at the limit`, /the limit; no further file/.test(JSON.stringify(w.calls.model[LIMITS.files + 1].messages.at(-1))) && r.outcome === 'fixed' && r.files.length === LIMITS.files);
    rmSync(w.out, { recursive: true, force: true });
    rmSync(repo.dir, { recursive: true, force: true });
  }
  {
    const repo = makeRepo();
    const half = 'y'.repeat(LIMITS.diffBytes / 2 + 1000);
    const w = world(repo, { turns: [tool('write_file', { path: 'a.txt', content: half }), tool('write_file', { path: 'b.txt', content: half }), finish()] });
    const { record: r } = await runFix(w.ctx);
    check(`size: a diff over ${LIMITS.diffBytes} bytes is refused, with no bundle`, r.outcome === 'refused' && /the diff is \d+ bytes; the limit/.test(r.notes) && !existsSync(join(w.out, 'fix.bundle')));
    const big = world(makeRepo(), { turns: [tool('write_file', { path: 'a.txt', content: 'z'.repeat(LIMITS.writeBytes + 1) }), finish()] });
    const { record: rb } = await runFix(big.ctx);
    check(`size: one write over ${LIMITS.writeBytes} bytes is refused at the tool`, /larger than/.test(JSON.stringify(big.calls.model[1].messages.at(-1))) && rb.outcome === 'no_change');
    rmSync(w.out, { recursive: true, force: true });
    rmSync(repo.dir, { recursive: true, force: true });
    rmSync(big.out, { recursive: true, force: true });
    rmSync(big.ctx.checkout, { recursive: true, force: true });
  }

  console.log('\n  runFix: refusals before the model');
  {
    const repo = makeRepo();
    const cases = [
      ['a review link on another PR', world(repo, { turns: [finish()], reviewUrl: 'https://github.com/askalf/r/pull/8#pullrequestreview-99' }), /another repository or pull request/],
      ['a link that is not a review', world(repo, { turns: [finish()], reviewUrl: 'https://github.com/askalf/r/pull/7' }), /not a pull request review link/],
      ['a head that moved', world(repo, { turns: [finish()], prHead: OTHER }), /head moved/],
      ['a review that is not CHANGES_REQUESTED', world(repo, { turns: [finish()], reviewState: 'APPROVED' }), /not CHANGES_REQUESTED/],
      ['a review at another head', world(repo, { turns: [finish()], reviewCommit: OTHER }), /not at the head/],
      ['a review with nothing to answer', world(repo, { turns: [finish()], body: '', comments: [] }), /no finding/],
    ];
    for (const [name, w, re] of cases) {
      const { record: r } = await runFix(w.ctx);
      check(`${name}: refused, no model call, schema ok`, r.outcome === 'refused' && re.test(r.notes) && w.calls.model.length === 0 && fixProblem(r) === null);
      rmSync(w.out, { recursive: true, force: true });
    }
    const wrongHead = world(repo, { turns: [finish()] });
    wrongHead.ctx.headSha = OTHER;
    wrongHead.ctx.fetch = (u, i) => world(repo, { turns: [finish()], prHead: OTHER, reviewCommit: OTHER }).ctx.fetch(u, i);
    const { record: rh } = await runFix(wrongHead.ctx);
    check('a checkout that is not at the head is refused', rh.outcome === 'refused' && /checkout is not at the reviewed head/.test(rh.notes));
    rmSync(wrongHead.out, { recursive: true, force: true });
    rmSync(repo.dir, { recursive: true, force: true });
  }

  console.log('\n  runFix: the model refuses, or narrates');
  {
    const repo = makeRepo();
    const w = world(repo, { turns: [tool('finish_fix', { outcome: 'refused', reason: 'The finding asks for a behaviour the PR does not add.' })] });
    const { record: r } = await runFix(w.ctx);
    check('a refusal from the model is refused with its reason and no bundle', r.outcome === 'refused' && r.notes === 'The finding asks for a behaviour the PR does not add.' && !existsSync(join(w.out, 'fix.bundle')) && r.turns === 1);
    rmSync(w.out, { recursive: true, force: true });
    const w2 = world(repo, { turns: [tool('write_file', { path: 'src/b.js', content: FIXED_B }), finish({ summary: 'Removed the AI-generated line.' }), finish()] });
    const { record: r2 } = await runFix(w2.ctx);
    const bounced = w2.calls.model[2].messages.at(-1).content[0];
    check('a summary that narrates is bounced with the phrase named, and the clean one lands', r2.outcome === 'fixed' && bounced.is_error === true && /"AI-generated"/.test(bounced.content) && r2.turns === 3);
    rmSync(w2.out, { recursive: true, force: true });
    rmSync(repo.dir, { recursive: true, force: true });
  }

  console.log('\n  runFix: the model that rejects a forced tool_choice');
  {
    const repo = makeRepo();
    const w = world(repo, { model: DEFAULT_MODEL, turns: [(b) => (JSON.stringify(b.messages.at(-1)).includes('budget is spent') ? finish() : tool('list_files', {}))] });
    const { record: r } = await runFix(w.ctx);
    check(`${DEFAULT_MODEL}: no request carries a forced choice, the instruction arrives at turn ${LIMITS.forceFinishAt}, and it finishes`,
      r.outcome === 'no_change' && w.calls.model.every((b) => b.tool_choice?.type !== 'tool') && w.calls.model.length === LIMITS.forceFinishAt && w.calls.model.at(-1).tool_choice?.type === 'auto');
    rmSync(w.out, { recursive: true, force: true });
    rmSync(repo.dir, { recursive: true, force: true });
  }

  if (!npmOk) {
    console.log('\n  skip the test-script runs: no npm on PATH here (they run in CI)');
  } else {
    console.log('\n  runFix: the test script');
    {
      const repo = makeRepo({ pkg: { name: 'r', private: true, scripts: { test: 'node test.mjs' } } });
      const w = world(repo, { turns: [tool('write_file', { path: 'src/b.js', content: FIXED_B }), finish()] });
      const { record: r } = await runFix(w.ctx);
      check('the model skipped the tests: the script ran them after the last edit and recorded them', r.outcome === 'fixed' && r.tests?.command === 'npm test' && r.tests.exit_code === 0 && /Tests: `npm test` exited 0/.test(r.notes) && fixProblem(r) === null);
      check('package.json and package-lock.json from the install are not in the commit', r.files.join() === 'src/b.js');
      rmSync(w.out, { recursive: true, force: true });
      rmSync(repo.dir, { recursive: true, force: true });
    }
    {
      const repo = makeRepo({ pkg: { name: 'r', private: true, scripts: { test: 'node test.mjs' } }, testExit: 1 });
      const w = world(repo, { turns: [tool('write_file', { path: 'src/b.js', content: FIXED_B }), finish(), finish()] });
      const { record: r } = await runFix(w.ctx);
      check('a failing suite is bounced to the model once, then reported as tests_failed', r.outcome === 'tests_failed' && r.tests.exit_code === 1 && JSON.stringify(w.calls.model[2].messages.at(-1)).includes('test script fails') && w.calls.model.length === 3);
      check('tests_failed: diff.patch, no bundle, no commit, schema ok', existsSync(join(w.out, 'diff.patch')) && !existsSync(join(w.out, 'fix.bundle')) && r.new_head === null && sh(repo.dir, ['rev-parse', 'HEAD']) === repo.head && fixProblem(r) === null);
      rmSync(w.out, { recursive: true, force: true });
      rmSync(repo.dir, { recursive: true, force: true });
    }
    {
      const repo = makeRepo({ pkg: { name: 'r', private: true, scripts: { test: 'node test.mjs' } } });
      const w = world(repo, { turns: [tool('write_file', { path: 'src/b.js', content: FIXED_B }), tool('run', { command: 'npm test' }), finish()] });
      const { record: r } = await runFix(w.ctx);
      check('a test run by the model after its edit is the one recorded', r.outcome === 'fixed' && r.tests?.command === 'npm test' && w.calls.model.length === 3 && JSON.stringify(w.calls.model[2].messages.at(-1)).includes('exit 0'));
      rmSync(w.out, { recursive: true, force: true });
      rmSync(repo.dir, { recursive: true, force: true });
    }
  }
}

console.log('\n  CLI');
{
  const script = fileURLToPath(new URL('./fix.mjs', import.meta.url));
  const r = spawnSync(process.execPath, [script], { env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT ?? '' }, encoding: 'utf8' });
  check('missing configuration exits 2 with an annotation', r.status === 2 && r.stderr.includes('::error::FIX_ENV_FILE is not set'));
  const dir = mkdtempSync(join(tmpdir(), 'redline-fix-cli-'));
  const envFile = join(dir, 'fix.env');
  writeFileSync(envFile, 'DARIO_URL=http://127.0.0.1:9\n');
  const outDir = join(dir, 'fix-out');
  mkdirSync(outDir);
  writeFileSync(join(outDir, 'fix.json'), '{"stale":true}\n');
  const s = spawnSync(process.execPath, [script], {
    env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT ?? '', FIX_ENV_FILE: envFile, FIX_OUT: outDir, REPO: 'askalf/r', PR: '7', HEAD_SHA: HEAD, REVIEW_URL, CHECKOUT: dir, GH_READ_TOKEN: 'read' },
    encoding: 'utf8',
  });
  check('the model key is required from the env file, never from the environment', s.status === 2 && s.stderr.includes('::error::DARIO_API_KEY is not set'));
  check('an earlier run\'s output is removed before anything starts', !existsSync(join(outDir, 'fix.json')));
  if (gitOk) {
    const repo = makeRepo();
    writeFileSync(envFile, 'DARIO_API_KEY=dk_test\nDARIO_URL=http://127.0.0.1:9\n');
    const bad = spawnSync(process.execPath, [script], {
      env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT ?? '', FIX_ENV_FILE: envFile, FIX_OUT: outDir, REPO: 'askalf/r', PR: '7', HEAD_SHA: repo.head, REVIEW_URL: 'https://github.com/askalf/r/pull/7', CHECKOUT: repo.dir, GH_READ_TOKEN: 'read' },
      encoding: 'utf8',
    });
    const written = JSON.parse(readFileSync(join(outDir, 'fix.json'), 'utf8'));
    check('a refusal writes fix.json and notes.md and exits 1', bad.status === 1 && written.outcome === 'refused' && /not a pull request review link/.test(written.notes) && readFileSync(join(outDir, 'notes.md'), 'utf8') === `${written.notes}\n` && fixProblem(written) === null);
    check('the key is never printed', !/dk_test/.test(bad.stdout + bad.stderr));
    rmSync(repo.dir, { recursive: true, force: true });
  }
  rmSync(dir, { recursive: true, force: true });
}

console.log('\n  the reusable workflow');
{
  const wf = readFileSync(fileURLToPath(new URL('../../.github/workflows/redline-fix-run.yml', import.meta.url)), 'utf8');
  check('it is a reusable workflow', /^on:\s*\n\s+workflow_call:/m.test(wf));
  const input = (name, type, required) => new RegExp(`\\n      ${name}:\\n(?:        .*\\n)*?        required: ${required}\\n(?:        .*\\n)*?        type: ${type}\\n`).test(wf);
  check('runner-label, redline-ref, pr, head and review are required string inputs', ['runner-label', 'redline-ref', 'pr', 'head', 'review'].every((n) => input(n, 'string', 'true')));
  check('dry_run is an optional boolean, default false', input('dry_run', 'boolean', 'false') && /\n      dry_run:\n(?:        .*\n)*?        default: false\n/.test(wf));
  const steps = wf.split(/\n      - /).slice(1);
  const at = (name) => steps.findIndex((s) => s.startsWith(`name: ${name}\n`));
  const guardAt = at('Check the review ref is a full commit sha');
  const inputsAt = at('Check the head and the review link');
  const mainAt = at('Check the review ref is on askalf/askalf main');
  const fetchAt = at('Fetch the fix script from askalf/askalf');
  const prAt = at('Check out the PR head to fix');
  const headAt = at('Check the checkout is at the head');
  const nodeAt = steps.findIndex((s) => s.startsWith('uses: actions/setup-node@'));
  const fixAt = at('Fix');
  const uploadAt = at('Upload the fix');
  const cleanAt = at('Remove the checkouts');
  check('the sha guard is the first step, the input guard the second, the on-main check third', guardAt === 0 && inputsAt === 1 && mainAt === 2);
  check('then the script fetch, the PR checkout, the head check, node, the fix, the upload and the cleanup, in that order',
    fetchAt === 3 && prAt === 4 && headAt === 5 && nodeAt === 6 && fixAt === 7 && uploadAt === 8 && cleanAt === 9 && steps.length === 10);
  check('the script is fetched at redline-ref, not job_workflow_sha or a branch',
    steps[fetchAt].includes('ref: ${{ inputs.redline-ref }}') && steps[fetchAt].includes('sparse-checkout: scripts/redline') && !/ref: \$\{\{ github\.job_workflow_sha/.test(wf) && !/ref: main\b/.test(wf));
  check('the PR is checked out at the head input, into pr/', steps[prAt].includes('ref: ${{ inputs.head }}') && steps[prAt].includes('path: pr\n'));
  check('no input is interpolated into a run step: everything goes through env', steps.every((s) => !s.includes('run:') || !/\$\{\{\s*inputs\./.test(s.slice(s.indexOf('run:')))));
  check('the head check compares the checkout with HEAD_SHA from env and fails', steps[headAt].includes('HEAD_SHA: ${{ inputs.head }}') && /git -C pr rev-parse HEAD/.test(steps[headAt]) && /exit 1/.test(steps[headAt]));
  const shell = (i) => /run: \|\n((?: {10}.*\n?)+)/.exec(steps[i] ?? '')?.[1].replace(/^ {10}/gm, '') ?? 'exit 0';
  if (!bashOk) {
    console.log('  skip the guards\' shell: no bash here');
  } else {
    const guard = (ref) => spawnSync('bash', ['-e', '-c', shell(guardAt)], { env: { ...process.env, REDLINE_REF: ref }, encoding: 'utf8' }).status;
    check('the sha guard passes a full sha and fails empty, branch, short, uppercase and padded refs',
      guard(HEAD) === 0 && guard('') !== 0 && guard('main') !== 0 && guard(HEAD.slice(0, 7)) !== 0 && guard(HEAD.toUpperCase()) !== 0 && guard(`${HEAD}\nmain`) !== 0);
    const inputs = (env) => spawnSync('bash', ['-e', '-c', shell(inputsAt)], { env: { ...process.env, HEAD_SHA: HEAD, PR: '7', REVIEW_URL: REVIEW_URL, REPO: 'askalf/r', ...env }, encoding: 'utf8' }).status;
    check('the input guard passes a good head, PR and review link', inputs({}) === 0);
    check('the input guard fails a short head, a non-numeric PR and a review link on another repo or PR',
      inputs({ HEAD_SHA: HEAD.slice(0, 7) }) !== 0 && inputs({ PR: 'x' }) !== 0 && inputs({ PR: '07' }) !== 0
      && inputs({ REVIEW_URL: 'https://github.com/askalf/other/pull/7#pullrequestreview-99' }) !== 0 && inputs({ REVIEW_URL: 'https://github.com/askalf/r/pull/8#pullrequestreview-99' }) !== 0
      && inputs({ REVIEW_URL: 'https://github.com/askalf/r/pull/7#issuecomment-99' }) !== 0 && inputs({ REVIEW_URL: `${REVIEW_URL}x` }) !== 0);
    const headCheck = (at2) => spawnSync('bash', ['-e', '-c', shell(headAt).replace('git -C pr rev-parse HEAD', `echo ${at2}`)], { env: { ...process.env, HEAD_SHA: HEAD }, encoding: 'utf8' }).status;
    check('the head check passes the head and fails another sha', headCheck(HEAD) === 0 && headCheck(OTHER) !== 0);
  }
  check('it runs on the caller\'s exec runner label', /runs-on: \[self-hosted, "\$\{\{ inputs\.runner-label \}\}"\]/.test(wf));
  check('both checkouts keep no credentials', (wf.match(/persist-credentials: false/g) ?? []).length === 2);
  const permBlock = /\npermissions:\n((?: {2}.*\n)+)/.exec(wf)?.[1] ?? '';
  check('the job token is read-only', permBlock === '  contents: read\n  pull-requests: read\n' && (wf.match(/^\s*permissions:/gm) ?? []).length === 1);
  check('third-party actions are pinned by sha', [...wf.matchAll(/uses: ([^\s]+)/g)].every((m) => /@[0-9a-f]{40}$/.test(m[1])) && (wf.match(/uses: /g) ?? []).length === 4);
  const fix = steps[fixAt] ?? '';
  check('the fix step runs the fetched script with the contract env', fix.includes('run: node .redline/scripts/redline/fix.mjs') && fix.includes('CHECKOUT: ${{ github.workspace }}/pr') && fix.includes('FIX_OUT: ${{ github.workspace }}/fix-out')
    && fix.includes('FIX_ENV_FILE: /etc/askalf/fix-exec.env') && fix.includes('GH_READ_TOKEN: ${{ github.token }}') && fix.includes('REVIEW_URL: ${{ inputs.review }}') && fix.includes("DRY_RUN: ${{ inputs.dry_run && '1' || '0' }}"));
  check('no secret from GitHub reaches the fix step', !/secrets\./.test(wf));
  const upload = steps[uploadAt] ?? '';
  check('the upload runs whatever the outcome, as redline-fix from fix-out, short-lived, overwriting',
    upload.includes('if: always()\n') && /uses: actions\/upload-artifact@[0-9a-f]{40} # v4\./.test(upload) && upload.includes('name: redline-fix\n') && upload.includes('path: fix-out\n') && /retention-days: [1-7]\n/.test(upload) && upload.includes('overwrite: true'));
  const review = readFileSync(fileURLToPath(new URL('../../.github/workflows/redline-review.yml', import.meta.url)), 'utf8');
  check('the upload action is the version redline-review.yml uses', /uses: actions\/upload-artifact@([0-9a-f]{40})/.exec(upload)?.[1] === /uses: actions\/upload-artifact@([0-9a-f]{40})/.exec(review)?.[1]);
  check('the cleanup removes the PR, the script and the output', /run: rm -rf pr \.redline fix-out\s*$/.test(steps[cleanAt] ?? '') && (steps[cleanAt] ?? '').includes('if: always()'));
  check('the job has a timeout past the fix\'s wall limit', Number(/timeout-minutes: (\d+)/.exec(wf)?.[1]) * 60_000 > LIMITS.timeMs);
  check('the env file comment names the account boundary', /root:gha-exec 640/.test(wf) && /never (?:by )?gha-oss/i.test(wf));
}

console.log('\n  the caller');
{
  const NEW = 'c0ffee0000000000000000000000000000000001';
  const y = fixCallerYaml(NEW, 'dario-exec', 'askalf/askalf#80');
  check('name and run-name', /^name: Redline fix$/m.test(y) && y.includes('run-name: Redline fix ${{ github.repository }}#${{ inputs.pr }} @ ${{ inputs.head }}\n'));
  const on = /\non:\n((?:  .*\n|\n)+?)(?=\S)/.exec(y)?.[1] ?? '';
  check('it runs on workflow_dispatch only', /^  workflow_dispatch:\n/.test(on) && !/pull_request|push|schedule/.test(on));
  const input = (name, type, required) => new RegExp(`\\n      ${name}:\\n(?:        .*\\n)*?        required: ${required}\\n(?:        .*\\n)*?        type: ${type}\\n`).test(y);
  check('pr, head and review are required string inputs; dry_run an optional boolean default false', input('pr', 'string', 'true') && input('head', 'string', 'true') && input('review', 'string', 'true') && input('dry_run', 'boolean', 'false') && /default: false/.test(y));
  check('permissions are read-only', /\npermissions:\n  contents: read\n  pull-requests: read\n\n/.test(y) && !/write/.test(y));
  check('one queued run per PR', y.includes('group: fix-${{ github.repository }}-${{ inputs.pr }}\n') && y.includes('cancel-in-progress: false'));
  const jobs = [...y.slice(y.search(/^jobs:/m)).matchAll(/^  ([\w-]+):$/gm)].map((m) => m[1]);
  check('one job, fix, calling the pinned reusable workflow with redline-ref at the same sha', jobs.join() === 'fix' && y.includes(`uses: ${FIX_WORKFLOW}@${NEW} # askalf/askalf#80\n`) && y.includes(`redline-ref: ${NEW}\n`));
  check('the runner label and every dispatch input are passed through', y.includes('runner-label: dario-exec\n') && y.includes('pr: ${{ inputs.pr }}') && y.includes('head: ${{ inputs.head }}') && y.includes('review: ${{ inputs.review }}') && y.includes('dry_run: ${{ inputs.dry_run }}'));
  check('the caller job has no runs-on of its own', !/runs-on/.test(y));
  check('no em dash', !/[\u2013\u2014]/.test(y));
  check('a bad sha or label is refused', (await throws(() => fixCallerYaml('main', 'dario-exec'))) && (await throws(() => fixCallerYaml(NEW, 'Dario Exec'))));
}

console.log('\n  pin bump, both callers');
{
  const NEW = 'c0ffee0000000000000000000000000000000001';
  const OLD = '116935d3803fc5904d96efb56991b93539c1714c';
  const note = 'main 2026-09-27, askalf/askalf#80';
  const refs = (y) => [...y.matchAll(/redline-ref: (\S+)/g)].map((m) => m[1]);
  check('the two callers are known by workflow and path', CALLERS.map((c) => c.path).join() === '.github/workflows/redline.yml,.github/workflows/redline-fix.yml' && CALLERS[0].workflow === REVIEW_WORKFLOW && CALLERS[1].workflow === FIX_WORKFLOW);
  const fixCaller = fixCallerYaml(OLD, 'dario-exec', 'old');
  const b = bumpCaller(fixCaller, NEW, note);
  check('the fix caller: the pin and redline-ref both move, once each', b.includes(`uses: ${FIX_WORKFLOW}@${NEW} # ${note}\n`) && refs(b).join() === NEW && !b.includes(OLD));
  check('the fix caller: the other inputs stay', b.includes('runner-label: dario-exec\n') && b.includes('review: ${{ inputs.review }}'));
  check('a second bump changes nothing', bumpCaller(b, NEW, note) === b);
  check('the bumped caller is the generated caller', b === fixCallerYaml(NEW, 'dario-exec', note));
  const reviewCaller = `name: Redline\n\non:\n  pull_request:\n\njobs:\n  review:\n    uses: ${REVIEW_WORKFLOW}@${OLD} # old\n    with:\n      redline-ref: ${OLD}\n      runner-label: redline\n`;
  const r = bumpCaller(reviewCaller, NEW, note);
  check('the review caller still bumps', r.includes(`uses: ${REVIEW_WORKFLOW}@${NEW} # ${note}\n`) && refs(r).join() === NEW);
  check('a file that calls neither is refused', (await throws(() => bumpCaller('name: x\n', NEW)))?.message.includes('no askalf/askalf/.github/workflows/redline-review.yml or askalf/askalf/.github/workflows/redline-fix-run.yml call'));
  const bump = readFileSync(fileURLToPath(new URL('../../.github/workflows/redline-pin-bump.yml', import.meta.url)), 'utf8');
  check('the bump workflow rewrites both caller paths with pin.mjs', /CALLER_PATHS: .*redline\.yml .*redline-fix\.yml/.test(bump.replace(/\n\s+/g, ' ')) && bump.includes('node scripts/redline/pin.mjs "$SHA" "$note"') && /redline-\(review\|fix-run\)\.yml/.test(bump));
  check('the bump workflow runs when the fix workflow changes', /- \.github\/workflows\/redline-fix-run\.yml/.test(bump));
  const selfTest = readFileSync(fileURLToPath(new URL('../../.github/workflows/redline-self-test.yml', import.meta.url)), 'utf8');
  check('the self-test runs these tests and watches the fix workflow', selfTest.includes('node scripts/redline/fix.test.mjs') && selfTest.includes('- .github/workflows/redline-fix-run.yml'));
}

rmSync(root, { recursive: true, force: true });
rmSync(outside, { recursive: true, force: true });
console.log(`\n  ${pass} pass, ${fail} fail`);
if (fail > 0) process.exit(1);
