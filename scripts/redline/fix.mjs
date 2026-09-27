// Redline fix: the first-party answer to a Redline REQUEST_CHANGES, computed as a CI job.
//
// One run answers one review at one head. It reads the review (body findings and inline comments)
// and the PR with the workflow's read-only token, installs the checkout's dependencies once, and
// lets the model read, write and run inside the checkout until it calls finish_fix. The edits
// become one commit on top of the reviewed head, written out as a git bundle; nothing here pushes
// or comments. Forge verifies the artifact and pushes it with the token it already holds, so no
// token that can write ever sits on the runner.
//
// Output, under FIX_OUT (uploaded as the redline-fix artifact):
//   fix.json     { version, repo, pr, base_head, new_head, outcome, commits, files, tests, turns, model, notes }
//                outcome: fixed | no_change | tests_failed | refused. Always written, whatever happened.
//   notes.md     the notes field: markdown for the PR comment forge posts.
//   fix.bundle   outcome fixed, not a dry run: the new commit, `git bundle create <base_head>..HEAD`.
//   diff.patch   a dry run, or tests_failed: the staged diff instead of a commit.
// The process exits 0 only for outcome fixed, so the job's own status says whether there is a fix.
//
// Hardening, each with a reason:
//   - The review must be a CHANGES_REQUESTED review of this PR at this head: an old review, a
//     review on another PR, a moved head or a fork PR is refused before the model is called.
//   - write_file stays inside the checkout (symlinks resolved) and never touches .github/: a
//     workflow change from this lane would run with the PR's own permissions on the next push.
//   - run takes an allowlist only, without a shell: the package.json test, lint, typecheck and
//     build scripts through the detected package manager, and node <file> inside the checkout.
//     Commands run as the runner's account with a scrubbed environment: the GitHub token and the
//     model key are never in a child's environment.
//   - Turns, wall time, files changed and diff size are bounded; past the limits the run is
//     refused, never trimmed into a partial fix.
//   - When the repository has a test script it runs at least once after the last edit; a failing
//     suite is bounced to the model once, then reported as tests_failed with no bundle.
//   - The commit is authored and committed as askalf; its message is one sanitised subject line
//     and a body naming the review, checked for trailers before the bundle is written.
//   - The model key is read from FIX_ENV_FILE and sent in a header; it is never printed and never
//     in argv. The only HTTP made is to api.github.com (reads) and to dario.
//
// CLI (the workflow's fix step):
//   REPO=owner/name PR=<n> HEAD_SHA=<sha> REVIEW_URL=<review html_url> CHECKOUT=<dir> \
//   GH_READ_TOKEN=... FIX_ENV_FILE=/etc/askalf/fix-exec.env FIX_OUT=<dir> [DRY_RUN=1] node fix.mjs
// The env file holds DARIO_API_KEY (the named key first-party-fix), and optionally DARIO_URL
// (default http://127.0.0.1:3456) and FIX_MODEL (default claude-opus-5-5).

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, lstatSync, realpathSync, statSync, readdirSync, appendFileSync, mkdtempSync } from 'node:fs';
import { join, resolve, relative, dirname, sep, posix } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { parseEnvFile, safePath, runTool as readTool, rejectsForcedToolChoice, metaPhrase, gh, ghAll, callModelWith, buildDiff } from './review.mjs';

export const AUTHOR = { name: 'askalf', email: '263217947+askalf@users.noreply.github.com' };
export const DEFAULT_MODEL = 'claude-opus-5-5';
export const FIX_VERSION = 1;
export const OUTCOMES = ['fixed', 'no_change', 'tests_failed', 'refused'];
export const SCRIPTS = ['test', 'lint', 'typecheck', 'build'];
export const PACKAGE_MANAGERS = ['npm', 'pnpm', 'yarn', 'bun'];
export const LIMITS = {
  turns: 40, forceFinishAt: 36, timeMs: 45 * 60_000, files: 30, diffBytes: 400_000, fileBytes: 1_000_000,
  writeBytes: 400_000, runDefaultS: 600, runMaxS: 900, installS: 600, runOutChars: 16_000,
  maxTokens: 16_000, modelTimeoutMs: 240_000, textOnlyTurns: 3, testBounces: 1,
  notesChars: 6_000, bodyChars: 8_000, diffChars: 120_000, subjectChars: 72,
};

// ---------- the review ----------

/** https://github.com/o/r/pull/7#pullrequestreview-123 -> { repo: 'o/r', pr: 7, id: 123 }, else null. */
export function parseReviewUrl(url) {
  const m = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)#pullrequestreview-(\d+)$/.exec(String(url ?? '').trim());
  return m ? { repo: m[1], pr: Number(m[2]), id: Number(m[3]) } : null;
}

function splitPlace(place) {
  const m = /^(.*?):(\d+)$/.exec(String(place).trim());
  return m ? { file: m[1], line: Number(m[2]) } : { file: String(place).trim(), line: null };
}

/**
 * Redline's review body as findings: `### N. Blocking: \`file:line\`` sections (quote lines, the
 * problem, an optional fenced "Suggested fix:"), then the `Minor:` list. Tolerant: a body with
 * neither becomes one blocking finding carrying the whole text, so a hand-written review is still
 * answered. Returns { summary, findings: [{ n, severity, file, line, quote, problem, suggestion }], rule }.
 */
export function parseReviewBody(body) {
  const text = String(body ?? '').replace(/\r\n/g, '\n');
  const findings = [];
  const heads = [...text.matchAll(/^### (\d+)\. (Blocking|Minor): `([^`\n]+)`\s*$/gm)];
  for (let i = 0; i < heads.length; i++) {
    const h = heads[i];
    const end = i + 1 < heads.length ? heads[i + 1].index : text.length;
    let section = text.slice(h.index + h[0].length, end);
    const cut = section.search(/^(?:Minor:\s*$|rule:[a-z0-9-]+\s*$|<!-- redline:head=|_[^_\n]+_\s*$)/m);
    if (cut >= 0) section = section.slice(0, cut);
    const quote = section.split('\n').filter((l) => l.startsWith('>')).map((l) => l.replace(/^> ?/, '')).join('\n').trim();
    let rest = section.split('\n').filter((l) => !l.startsWith('>')).join('\n');
    let suggestion = '';
    const sug = /\n\s*Suggested fix:\s*\n\s*(`{3,})[^\n]*\n([\s\S]*?)\n\1[ \t]*(?:\n|$)/.exec(rest);
    if (sug) { suggestion = sug[2].trim(); rest = rest.slice(0, sug.index); }
    const { file, line } = splitPlace(h[3]);
    findings.push({ n: Number(h[1]), severity: h[2].toLowerCase(), file, line, quote, problem: rest.trim(), suggestion });
  }
  const minorAt = /^Minor:\s*$/m.exec(text);
  if (minorAt) {
    for (const l of text.slice(minorAt.index + minorAt[0].length).split('\n')) {
      const m = /^- `([^`]+)`: (.*)$/.exec(l);
      if (!m) { if (l.trim()) break; continue; }
      const { file, line } = splitPlace(m[1]);
      findings.push({ n: findings.length + 1, severity: 'minor', file, line, quote: '', problem: m[2].trim(), suggestion: '' });
    }
  }
  const summary = (/^\*\*Verdict: [^*\n]+\*\*\s*(.*)$/m.exec(text)?.[1] ?? '').trim();
  const rule = /^rule:([a-z0-9-]+)\s*$/m.exec(text)?.[1] ?? null;
  if (!findings.length) {
    const plain = text.replace(/<!-- redline:head=[0-9a-f]+ -->/g, '').trim();
    if (plain) findings.push({ n: 1, severity: 'blocking', file: null, line: null, quote: '', problem: plain, suggestion: '' });
  }
  return { summary, findings, rule };
}

/** The review's inline comments as items: { path, line, body }; empty bodies dropped. */
export function inlineItems(comments) {
  return (Array.isArray(comments) ? comments : [])
    .map((c) => ({ path: String(c.path ?? ''), line: c.line ?? c.original_line ?? null, body: String(c.body ?? '').trim() }))
    .filter((c) => c.body);
}

export function formatFinding(f) {
  const where = f.file ? ` \`${f.file}${f.line ? `:${f.line}` : ''}\`` : '';
  const parts = [`[${f.n}] ${f.severity}${where}`];
  if (f.quote) parts.push(f.quote.split('\n').map((l) => `> ${l}`).join('\n'));
  parts.push(f.problem || '(no text)');
  if (f.suggestion) parts.push(`Suggested fix:\n${f.suggestion}`);
  return parts.join('\n');
}

// ---------- the toolchain ----------

/**
 * From the checkout's root listing and its package.json: which package manager, which of the
 * SCRIPTS exist, and the install command. No package.json: { pm: null, scripts: [], install: null },
 * and run then takes node <file> only. A `packageManager` field wins over lockfiles.
 */
export function detectRunner(rootFiles, pkg) {
  const files = new Set(rootFiles ?? []);
  if (!pkg || typeof pkg !== 'object') return { pm: null, scripts: [], install: null };
  const declared = /^(npm|pnpm|yarn|bun)@/.exec(String(pkg.packageManager ?? ''))?.[1];
  const pm = declared ?? (files.has('pnpm-lock.yaml') ? 'pnpm' : files.has('yarn.lock') ? 'yarn' : (files.has('bun.lockb') || files.has('bun.lock')) ? 'bun' : 'npm');
  const scripts = SCRIPTS.filter((s) => typeof pkg.scripts?.[s] === 'string' && pkg.scripts[s].trim());
  const install = {
    npm: files.has('package-lock.json') ? ['npm', 'ci', '--no-audit', '--no-fund'] : ['npm', 'install', '--no-audit', '--no-fund'],
    pnpm: ['pnpm', 'install', '--frozen-lockfile'],
    yarn: ['yarn', 'install', '--frozen-lockfile'],
    bun: ['bun', 'install', '--frozen-lockfile'],
  }[pm];
  return { pm, scripts, install };
}

/** The allowlist as the model sees it. */
export function allowedCommands(plan) {
  const out = [];
  if (plan.pm) for (const s of plan.scripts) out.push(s === 'test' ? `${plan.pm} test` : `${plan.pm} run ${s}`);
  out.push('node <file>', 'node --test <file>');
  return out;
}

/**
 * A run command against the allowlist: { argv } or { error }. No shell is ever involved, so the
 * command is split on whitespace and any quoting, redirection, chaining or expansion character
 * is refused outright. node takes one file inside the checkout, optionally after --test.
 */
export function allowedArgv(command, plan, root) {
  const s = String(command ?? '').trim();
  if (!s) return { error: 'command is empty' };
  if (/[;&|<>$`'"(){}\\\n\r*?~!#%^]/.test(s)) return { error: 'the command runs without a shell: no quoting, redirection, chaining or expansion' };
  const [bin, ...rest] = s.split(/\s+/);
  const list = `the allowed commands are: ${allowedCommands(plan).join(', ')}`;
  if (plan.pm && bin === plan.pm) {
    if (rest.length === 1 && rest[0] === 'test' && plan.scripts.includes('test')) return { argv: [bin, 'test'] };
    if (rest.length === 2 && rest[0] === 'run' && SCRIPTS.includes(rest[1]) && plan.scripts.includes(rest[1])) return { argv: [bin, 'run', rest[1]] };
    return { error: `not in the allowlist; ${list}` };
  }
  if (bin === 'node') {
    const flags = rest.slice(0, -1);
    const file = rest.at(-1);
    if (!file || flags.some((f) => f !== '--test')) return { error: 'node takes one file inside the checkout, optionally after --test' };
    let abs;
    try { abs = safePath(root, file); } catch (e) { return { error: e.message }; }
    if (lstatSync(abs).isDirectory()) return { error: 'that is a directory, not a file' };
    return { argv: ['node', ...flags, relative(realpathSync(root), abs).split(sep).join('/')] };
  }
  return { error: `not in the allowlist; ${list}` };
}

// ---------- the filesystem ----------

/**
 * Resolve a path the model wants to write. Inside the checkout, symlinks included; never under
 * .git or node_modules, and never under .github: a workflow or action definition changed by this
 * lane would run with the PR's own permissions on the next push. Returns the absolute path or throws.
 */
export function safeWritePath(root, p) {
  const rel = posix.normalize(String(p ?? '').replace(/\\/g, '/').replace(/^\/+/, ''));
  if (!rel || rel === '.' || rel === '..' || rel.startsWith('../')) throw new Error('path is outside the checkout');
  if (/(^|\/)(?:\.git|node_modules)(?:\/|$)/.test(rel)) throw new Error('path is under .git or node_modules');
  if (/^\.github(?:\/|$)/.test(rel)) throw new Error('nothing under .github/ is written by the fix lane');
  const rootReal = realpathSync(root);
  const abs = resolve(rootReal, rel);
  const inside = (x) => x === rootReal || x.startsWith(rootReal + sep);
  if (!inside(abs)) throw new Error('path is outside the checkout');
  let dir = dirname(abs);
  while (!existsSync(dir)) dir = dirname(dir);
  if (!inside(realpathSync(dir))) throw new Error('path resolves outside the checkout');
  let st = null;
  try { st = lstatSync(abs); } catch { /* a new file */ }
  if (st?.isSymbolicLink()) throw new Error('path is a symlink');
  if (st?.isDirectory()) throw new Error('path is a directory');
  return abs;
}

/**
 * Which changed paths become the commit. Everything the checkout shows as changed is staged
 * (`git add -A`) except: paths under .github/, files over LIMITS.fileBytes, and paths the install
 * step dirtied that the model did not write (a lockfile rewritten by npm is not the fix). Pure:
 * `sizeOf(path)` supplies sizes. Returns { keep, skipped: [{ path, why }] }.
 */
export function stageable(paths, { installDirty = [], written = new Set(), sizeOf = () => 0 } = {}) {
  const keep = [];
  const skipped = [];
  for (const p of paths) {
    if (/^\.github(?:\/|$)/.test(p)) skipped.push({ path: p, why: 'under .github/' });
    else if (installDirty.includes(p) && !written.has(p)) skipped.push({ path: p, why: 'changed by the install, not by the fix' });
    else if (sizeOf(p) > LIMITS.fileBytes) skipped.push({ path: p, why: `larger than ${LIMITS.fileBytes} bytes` });
    else keep.push(p);
  }
  return { keep, skipped };
}

// ---------- public text ----------

/** A trailer or credit line that never goes into a commit or a comment from this lane. */
export const TRAILER_LINE = /^\s*(?:Co-Authored-By|Signed-off-by|Generated (?:with|by)|Made with|Claude-Session|Reviewed-by)\b.*$/i;
/** Words a commit subject from this lane never carries; a subject with one falls back to the default. */
export const SUBJECT_BANNED = /co-authored|signed-off|generated|\bclaude\b|\banthropic\b|\bopenai\b|\bgpt\b|\bcopilot\b|\bcodex\b|\bgemini\b|\bAI\b|\bLLM\b|\bmodel\b|\bprompt\b|\bredline\b/i;
const CLOSERS = /\b(?:fix(?:es|ed)?|close[sd]?|resolve[sd]?)\b\s*:?\s*(?:[\w.-]+\/[\w.-]+)?#\d+/gi;

/**
 * The commit subject: `fix: <one line from the model>`, with the model's own prefix, issue
 * closers and refs, em dashes and trailing punctuation removed, and capped. A line that credits
 * a tool or names the machinery is replaced by the default.
 */
export function commitSubject(line) {
  let s = String(line ?? '').split('\n')[0].trim();
  s = s.replace(/\s*[\u2013\u2014]\s*/g, ', ').replace(/\s+/g, ' ');
  s = s.replace(/^(?:fix|feat|chore|refactor|docs|test|ci|build|perf|style)(?:\([^)]*\))?!?:\s*/i, '');
  s = s.replace(CLOSERS, '').replace(/(?:[\w.-]+\/[\w.-]+)?#\d+/g, '').replace(/https?:\/\/\S+/g, '').replace(/\(\s*\)/g, '');
  s = s.replace(/\s{2,}/g, ' ').replace(/^[\s,:;-]+|[\s.,:;-]+$/g, '');
  if (!s || SUBJECT_BANNED.test(s)) s = 'address the review';
  const max = LIMITS.subjectChars - 'fix: '.length;
  if (s.length > max) s = s.slice(0, max).replace(/\s+\S*$/, '').replace(/[\s.,:;-]+$/, '');
  return `fix: ${s}`;
}

/** Whether a commit message carries an attribution trailer. Checked on the commit itself before the bundle. */
export function hasAttributionTrailer(message) {
  return /^(?:Co-Authored-By|Signed-off-by|Claude|Generated)/im.test(String(message ?? ''));
}

/**
 * A bare `#12` or `owner/repo#12` outside code becomes a code span so the comment links no
 * unrelated issue. Fenced blocks and inline code are left as they are.
 */
export function neutraliseRefs(md) {
  const out = [];
  let fenced = false;
  for (const line of String(md ?? '').split('\n')) {
    if (/^\s*(`{3,}|~{3,})/.test(line)) { fenced = !fenced; out.push(line); continue; }
    if (fenced) { out.push(line); continue; }
    out.push(line.split(/(`+[^`]*`+)/).map((part, i) => (i % 2 ? part : part.replace(/(^|[^\w`&#])((?:[\w.-]+\/[\w.-]+)?#\d+)\b/g, '$1`$2`'))).join(''));
  }
  return out.join('\n');
}

/** Notes fit for the PR comment: no trailer lines, no em dashes, refs neutralised, capped. */
export function cleanNotes(md) {
  let s = String(md ?? '').replace(/\r\n/g, '\n').split('\n').filter((l) => !TRAILER_LINE.test(l)).join('\n');
  s = s.replace(/\s*[\u2013\u2014]\s*/g, ', ');
  s = neutraliseRefs(s).trim();
  if (s.length > LIMITS.notesChars) s = `${s.slice(0, LIMITS.notesChars - 20).trimEnd()}\n\n(truncated)`;
  return s;
}

/** A one-line reading of a test run's output: TAP totals, a jest summary line, else the tail. */
export function summariseTests(out) {
  const s = String(out ?? '');
  const pass = /^# pass (\d+)/m.exec(s)?.[1];
  const failed = /^# fail (\d+)/m.exec(s)?.[1];
  if (pass !== undefined || failed !== undefined) return `${pass ?? 0} pass, ${failed ?? 0} fail`;
  const jest = /^Tests:\s+(.+)$/m.exec(s)?.[1];
  if (jest) return jest.trim();
  const own = /^\s*(\d+) pass, (\d+) fail\b/m.exec(s);
  if (own) return `${own[1]} pass, ${own[2]} fail`;
  return s.trim().split('\n').filter((l) => l.trim()).slice(-3).join(' | ').slice(-300);
}

export function renderNotes({ outcome, summary = '', reason = '', files = [], tests = null, skipped = [] }) {
  const parts = [];
  if (outcome === 'refused') parts.push(reason || 'The fix was refused.');
  else {
    if (summary) parts.push(summary);
    if (outcome === 'no_change') parts.push('No file changed.');
    if (files.length) parts.push(`Files: ${files.map((f) => `\`${f}\``).join(', ')}`);
    if (skipped.length) parts.push(`Left out: ${skipped.map((s) => `\`${s.path}\` (${s.why})`).join(', ')}`);
    if (tests) parts.push(`Tests: \`${tests.command}\` exited ${tests.exit_code}${tests.summary ? ` (${tests.summary})` : ''}`);
    else if (outcome !== 'no_change') parts.push('Tests: no test script in the repository.');
  }
  return cleanNotes(parts.join('\n\n'));
}

// ---------- fix.json ----------

/** fix.json exactly as forge reads it. */
export function fixRecord({ repo, pr, headSha, newHead = null, outcome, commits = [], files = [], tests = null, turns = 0, model = '', notes = '' }) {
  return { version: FIX_VERSION, repo, pr, base_head: headSha, new_head: newHead, outcome, commits, files, tests, turns, model, notes: String(notes ?? '') };
}

/** Why a parsed fix.json is malformed, or null. Forge applies its own checks as well. */
export function fixProblem(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'not an object';
  if (v.version !== FIX_VERSION) return `version must be ${FIX_VERSION}`;
  if (typeof v.repo !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(v.repo)) return 'repo must be owner/name';
  if (!Number.isInteger(v.pr) || v.pr <= 0) return 'pr must be a positive integer';
  if (typeof v.base_head !== 'string' || !/^[0-9a-f]{40}$/.test(v.base_head)) return 'base_head must be a full commit sha';
  if (v.new_head !== null && (typeof v.new_head !== 'string' || !/^[0-9a-f]{40}$/.test(v.new_head))) return 'new_head must be a full commit sha or null';
  if (!OUTCOMES.includes(v.outcome)) return `outcome must be one of ${OUTCOMES.join(', ')}`;
  if (!Array.isArray(v.commits)) return 'commits must be an array';
  for (const [i, c] of v.commits.entries()) {
    if (!c || typeof c.sha !== 'string' || !/^[0-9a-f]{40}$/.test(c.sha) || typeof c.subject !== 'string' || !c.subject.trim()) return `commit ${i + 1} needs sha and subject`;
  }
  if (v.outcome === 'fixed' && v.commits.length > 0 && v.new_head !== v.commits.at(-1).sha) return 'new_head must be the last commit';
  if (v.outcome !== 'fixed' && (v.new_head !== null || v.commits.length)) return `${v.outcome} carries no commit`;
  if (!Array.isArray(v.files) || v.files.some((f) => typeof f !== 'string' || !f)) return 'files must be an array of paths';
  if (v.tests !== null && (!v.tests || typeof v.tests.command !== 'string' || !Number.isInteger(v.tests.exit_code) || typeof v.tests.summary !== 'string')) return 'tests must be null or { command, exit_code, summary }';
  if (!Number.isInteger(v.turns) || v.turns < 0) return 'turns must be a non-negative integer';
  if (typeof v.model !== 'string') return 'model must be a string';
  if (typeof v.notes !== 'string' || v.notes.length > LIMITS.notesChars) return `notes must be a string of at most ${LIMITS.notesChars} characters`;
  if (/[\u2013\u2014]/.test(v.notes)) return 'notes must not contain an em dash';
  return null;
}

/** Write fix.json and notes.md into dir, creating it. */
export function saveFix(dir, record) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'fix.json'), `${JSON.stringify(record, null, 2)}\n`);
  writeFileSync(join(dir, 'notes.md'), `${record.notes}\n`);
}

// ---------- tools ----------

export const TOOLS = [
  { name: 'list_files', description: 'List a directory of the checkout (directories end with /).',
    input_schema: { type: 'object', properties: { path: { type: 'string', description: 'Directory relative to the repo root; default the root.' } } } },
  { name: 'read_file', description: 'Read numbered lines of a file in the checkout. At most 400 lines per call.',
    input_schema: { type: 'object', required: ['path'], properties: { path: { type: 'string' }, start_line: { type: 'integer', minimum: 1 }, end_line: { type: 'integer', minimum: 1 } } } },
  { name: 'search', description: 'Search the checkout with a JavaScript regular expression. At most 80 matches.',
    input_schema: { type: 'object', required: ['pattern'], properties: { pattern: { type: 'string' }, path: { type: 'string', description: 'Directory or file to search; default the root.' } } } },
  { name: 'write_file', description: 'Write a whole file in the checkout (created if absent). Read it first and write it back complete. Never under .github/, .git/ or node_modules/.',
    input_schema: { type: 'object', required: ['path', 'content'], properties: { path: { type: 'string' }, content: { type: 'string' } } } },
  { name: 'run', description: `Run one allowed command in the checkout, without a shell; stdout and stderr together, capped. Default timeout ${LIMITS.runDefaultS}s, at most ${LIMITS.runMaxS}s. The allowed commands are listed in the brief.`,
    input_schema: { type: 'object', required: ['command'], properties: { command: { type: 'string' }, timeout_seconds: { type: 'integer', minimum: 1, maximum: LIMITS.runMaxS } } } },
  { name: 'finish_fix', description: 'Finish. Call exactly once, last, after the tests have run on your edits.',
    input_schema: { type: 'object', required: ['outcome', 'summary'], properties: {
      outcome: { type: 'string', enum: ['fixed', 'refused'], description: 'fixed when the findings are answered in code; refused when none can be.' },
      subject: { type: 'string', description: 'fixed: one line for the commit, imperative, under 60 characters, no prefix, no issue numbers, no trailers.' },
      summary: { type: 'string', description: 'Markdown for the PR comment: per finding, what changed, where, and why it answers it. Plain sentences.' },
      tests_run: { type: 'string', description: 'The test command you ran last and its result.' },
      reason: { type: 'string', description: 'refused: why no finding can be fixed in this PR.' } } } },
];

export const FINISH_REQUIRED = 'The budget is spent. Your next response must be a finish_fix tool call with outcome, subject, summary and '
  + 'tests_run, describing what you changed so far. Do not call any other tool and do not answer in text.';
const TEXT_ONLY_NUDGE = 'That text was discarded: only tool calls act here. Continue with the tools, or call finish_fix.';
const BUDGET_SPENT = 'The budget is spent. Call finish_fix now with what you have.';

/** Put FINISH_REQUIRED in the last user turn, once (the turn about to be sent; nothing answered is edited). */
export function askForFinish(messages) {
  const last = messages.at(-1);
  if (!last || last.role !== 'user') return;
  if (typeof last.content === 'string') {
    if (!last.content.includes(FINISH_REQUIRED)) last.content = `${last.content}\n\n${FINISH_REQUIRED}`;
    return;
  }
  if (Array.isArray(last.content) && !last.content.some((b) => b.type === 'text' && b.text === FINISH_REQUIRED)) {
    last.content.push({ type: 'text', text: FINISH_REQUIRED });
  }
}

/** Validate finish_fix input. Returns { sub } or { error }. Prose that names the machinery is bounced. */
export function checkFinish(input) {
  if (!input || typeof input !== 'object') return { error: 'finish_fix needs an object' };
  const outcome = input.outcome ?? 'fixed';
  if (outcome !== 'fixed' && outcome !== 'refused') return { error: 'outcome must be fixed or refused' };
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  const prose = [];
  if (outcome === 'refused') {
    if (!str(input.reason)) return { error: 'refused needs a reason' };
    prose.push(['reason', input.reason]);
  } else {
    if (!str(input.summary)) return { error: 'summary is required' };
    if (!str(input.subject)) return { error: 'subject is required: one line for the commit' };
    prose.push(['summary', input.summary]);
    if (str(input.tests_run)) prose.push(['tests_run', input.tests_run]);
  }
  for (const [where, text] of prose) {
    const hit = metaPhrase(text);
    if (hit) return { error: `${where} says "${hit}". The comment is public and describes only the change: say what changed, where and why, and never mention attribution, generation, models, rules or lanes. Rewrite and call finish_fix again.` };
  }
  if (outcome === 'refused') return { sub: { outcome, reason: str(input.reason) } };
  return { sub: { outcome, subject: commitSubject(input.subject), summary: str(input.summary), tests_run: str(input.tests_run) } };
}

// ---------- the loop ----------

export function capOutput(text, max = LIMITS.runOutChars) {
  const s = String(text ?? '');
  return s.length > max ? `${s.slice(0, max / 4)}\n(... ${s.length - max} chars omitted ...)\n${s.slice(-(max * 3) / 4)}` : s;
}

/**
 * The model loop with every side effect injected: ctx.call(messages, toolChoice) -> Messages
 * response, ctx.tool(name, input) -> string, ctx.finalize(input) -> { sub } | { error }, ctx.now,
 * ctx.log, ctx.canForce. Returns { sub, turns } or { refused, turns }; throws only on a broken
 * response. Text-only and empty replies are handled as in review.mjs: three in a row end the run,
 * an empty reply is not kept in the history.
 */
export async function runLoop(ctx, brief) {
  const messages = [{ role: 'user', content: `${brief}\n\nAnswer the review and finish with finish_fix.` }];
  const started = ctx.now();
  const canForce = ctx.canForce !== false;
  let textOnly = 0;
  let turns = 0;
  for (let turn = 1; turn <= LIMITS.turns; turn++) {
    turns = turn;
    const force = turn >= LIMITS.forceFinishAt || ctx.now() - started > LIMITS.timeMs;
    if (force && !canForce) askForFinish(messages);
    const res = await ctx.call(messages, !force ? null : canForce ? { type: 'tool', name: 'finish_fix' } : { type: 'auto' });
    if (!Array.isArray(res?.content)) throw new Error(`the model returned no message content: ${JSON.stringify(res ?? null).slice(0, 300)}`);
    const uses = res.content.filter((b) => b.type === 'tool_use');
    const text = res.content.filter((b) => b.type === 'text').map((b) => String(b.text ?? '')).join(' ').replace(/\s+/g, ' ').trim();
    ctx.log?.(`turn ${turn}${force ? (canForce ? ' (forced)' : ' (finish required)') : ''}: ${uses.map((u) => u.name).join(', ') || 'no tool call'}; stop=${res.stop_reason ?? '-'}`
      + (uses.length ? '' : ` text=${JSON.stringify(text.slice(0, 200))}`));
    if (!uses.length) {
      if (++textOnly >= LIMITS.textOnlyTurns) return { refused: `${textOnly} text-only answers in a row: the model did not call finish_fix`, turns };
      if (res.content.length) {
        messages.push({ role: 'assistant', content: res.content });
        messages.push({ role: 'user', content: TEXT_ONLY_NUDGE });
      }
      continue;
    }
    textOnly = 0;
    messages.push({ role: 'assistant', content: res.content });
    const out = [];
    for (const u of uses) {
      if (u.name !== 'finish_fix') {
        out.push(force
          ? { type: 'tool_result', tool_use_id: u.id, is_error: true, content: BUDGET_SPENT }
          : { type: 'tool_result', tool_use_id: u.id, content: String(await ctx.tool(u.name, u.input ?? {})) });
        continue;
      }
      const r = await ctx.finalize(u.input ?? {});
      if (r.sub) return { sub: r.sub, turns };
      ctx.log?.(`  finish_fix bounced: ${String(r.error).split('\n')[0]}`);
      out.push({ type: 'tool_result', tool_use_id: u.id, is_error: true, content: r.error });
    }
    messages.push({ role: 'user', content: out });
  }
  return { refused: `no fix submitted within ${LIMITS.turns} turns`, turns };
}

export function buildBrief({ pr, files, headSha, review, items, plan, installNote, diff }) {
  const findings = review.findings;
  return [
    `Repository: ${pr.base.repo.full_name}`,
    `PR #${pr.number}: ${pr.title}`,
    `${pr.head.ref} -> ${pr.base.ref}; head ${headSha}`,
    '', 'PR description:', String(pr.body ?? '').slice(0, LIMITS.bodyChars) || '(empty)',
    '', `Files the PR changes (${files.length}):`, ...files.map((f) => `- ${f.status} +${f.additions} -${f.deletions} ${f.filename}`),
    '', `Review summary: ${review.summary || '(none)'}`,
    '', `Findings (${findings.length}):`, ...findings.map(formatFinding),
    '', `Inline comments (${items.length}):`, ...items.map((c, i) => `[${i + 1}] ${c.path}${c.line ? `:${c.line}` : ''}\n${c.body}`),
    '', `Toolchain: ${plan.pm ?? 'none'}; install: ${installNote}`,
    `run accepts: ${allowedCommands(plan).join(', ')}`,
    plan.scripts.includes('test') ? `Test script: \`${plan.pm} test\`. Run it after your edits.` : 'No test script in package.json.',
    '', 'PR diff:', diff || '(empty)',
  ].join('\n');
}

// ---------- processes ----------

/**
 * The environment of every child (install, run, git): PATH, a scratch HOME and TMPDIR, CI=1 and
 * nothing else, so the GitHub token and the model key in this process never reach a command the
 * model chose. DARIO_IGNORE_CC_CREDENTIALS keeps dario's own suite from touching the runner's
 * credentials. On Windows the system variables a process needs to start are kept.
 */
export function childEnv(env, home) {
  const out = { PATH: env.PATH ?? env.Path ?? '', HOME: home, TMPDIR: home, LANG: 'C.UTF-8', CI: '1', NO_COLOR: '1', DARIO_IGNORE_CC_CREDENTIALS: '1' };
  if (process.platform === 'win32') {
    for (const k of ['SYSTEMROOT', 'SystemRoot', 'PATHEXT', 'COMSPEC', 'ComSpec']) if (env[k]) out[k] = env[k];
    Object.assign(out, { TEMP: home, TMP: home, USERPROFILE: home });
  }
  return out;
}

/**
 * Run argv in cwd with a hard time cap: coreutils timeout on the runner, node's own elsewhere.
 * argv is already allowlisted, so on Windows (a developer box, never the runner) a package
 * manager's .cmd shim may go through the shell node requires for it.
 */
function run(cwd, env, argv, seconds) {
  const win = process.platform === 'win32';
  const wrapped = win ? argv : ['timeout', '-k', '10', String(seconds), ...argv];
  const r = spawnSync(wrapped[0], wrapped.slice(1), { cwd, env, encoding: 'utf8', timeout: (seconds + 30) * 1000, killSignal: 'SIGKILL', maxBuffer: 64 * 1024 * 1024, shell: win && PACKAGE_MANAGERS.includes(argv[0]) });
  const timedOut = r.status === 124 || r.error?.code === 'ETIMEDOUT';
  const exit = r.status ?? (timedOut ? 124 : r.signal ? 128 : -1);
  return { exit, out: `${r.stdout ?? ''}${r.stderr ?? ''}${r.error && !timedOut ? `\n${r.error.message}` : ''}`, timedOut };
}

function git(cwd, env, args, { allowFail = false } = {}) {
  const r = spawnSync('git', args, { cwd, env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0 && !allowFail) throw new Error(`git ${args[0]} failed: ${(r.stderr || r.stdout || r.error?.message || '').trim().slice(0, 300)}`);
  return r.status === 0 ? String(r.stdout ?? '').replace(/\n$/, '') : null;
}

/** Paths git sees as changed (tracked or untracked, ignored files excluded), forward slashes. */
function changedPaths(root, env) {
  const raw = spawnSync('git', ['status', '--porcelain', '-z', '--untracked-files=all'], { cwd: root, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).stdout ?? '';
  const fields = raw.split('\0').filter((f) => f !== '');
  const out = [];
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    const xy = f.slice(0, 2);
    out.push(f.slice(3));
    if (/[RC]/.test(xy)) i++;
  }
  return out;
}

/** fetch restricted to the origins this script may talk to; anything else is refused before it leaves. */
export function onlyOrigins(fetchFn, urls) {
  const origins = new Set(urls.map((u) => new URL(u).origin));
  return (url, init) => {
    let o = '';
    try { o = new URL(String(url)).origin; } catch { o = ''; }
    return origins.has(o) ? fetchFn(url, init) : Promise.reject(new Error(`no request leaves for ${o || 'an invalid URL'}`));
  };
}

// ---------- the job ----------

/**
 * Answer one review at one head. ctx: { repo, pr, headSha, reviewUrl, checkout, out, readToken,
 * darioUrl, darioKey, model, system, fetch, sleep, now, log, dryRun, env }. Returns { record }, the
 * fix.json record; the bundle or diff is written under ctx.out. Throws only on a broken model
 * response or a git failure; the CLI turns that into a refused record.
 */
export async function runFix(ctx) {
  const { repo, pr: n, headSha, checkout: root, out } = ctx;
  mkdirSync(out, { recursive: true });
  const base = { repo, pr: n, headSha, model: ctx.model };
  const refuse = (why, extra = {}) => ({ record: fixRecord({ ...base, outcome: 'refused', ...extra, notes: renderNotes({ outcome: 'refused', reason: why }) }) });

  const ref = parseReviewUrl(ctx.reviewUrl);
  if (!ref) return refuse(`REVIEW_URL is not a pull request review link: ${String(ctx.reviewUrl ?? '').slice(0, 200)}`);
  if (ref.repo.toLowerCase() !== repo.toLowerCase() || ref.pr !== n) return refuse('the review link names another repository or pull request');
  const pr = await gh(ctx, `/repos/${repo}/pulls/${n}`);
  if (pr.state !== 'open') return refuse(`the pull request is ${pr.state}`);
  if (pr.head.sha !== headSha) return refuse(`the head moved to ${pr.head.sha}; dispatch again at the new head`);
  if (pr.head.repo?.full_name !== repo) return refuse('fork pull requests are not fixed here');
  const reviewRow = await gh(ctx, `/repos/${repo}/pulls/${n}/reviews/${ref.id}`);
  if (reviewRow.state !== 'CHANGES_REQUESTED') return refuse(`the review is ${reviewRow.state}, not CHANGES_REQUESTED`);
  if (reviewRow.commit_id !== headSha) return refuse(`the review is at ${reviewRow.commit_id}, not at the head`);
  const comments = await ghAll(ctx, `/repos/${repo}/pulls/${n}/reviews/${ref.id}/comments`, 3);
  const files = await ghAll(ctx, `/repos/${repo}/pulls/${n}/files`, 3);
  const review = parseReviewBody(reviewRow.body);
  const items = inlineItems(comments);
  if (!review.findings.length && !items.length) return refuse('the review has no finding to answer');

  const home = mkdtempSync(join(tmpdir(), 'redline-fix-home-'));
  const cenv = childEnv(ctx.env ?? process.env, home);
  try {
    if (git(root, cenv, ['rev-parse', 'HEAD'], { allowFail: true }) !== headSha) return refuse('the checkout is not at the reviewed head');
    if (changedPaths(root, cenv).length) return refuse('the checkout is not clean');

    // Toolchain: detected once, installed once, before the model sees anything.
    const rootFiles = readdirSync(root);
    let pkg = null;
    try { pkg = rootFiles.includes('package.json') ? JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) : null; } catch { pkg = null; }
    const plan = detectRunner(rootFiles, pkg);
    let installNote = 'no package.json, nothing installed';
    if (plan.install) {
      const r = run(root, cenv, plan.install, LIMITS.installS);
      installNote = `\`${plan.install.join(' ')}\` exited ${r.exit}${r.exit ? ` (tail: ${r.out.slice(-600).replace(/\s+/g, ' ')})` : ''}`;
      ctx.log?.(`install: ${installNote.slice(0, 200)}`);
    }
    const installDirty = changedPaths(root, cenv);

    const written = new Set();
    // The fix as it would be staged now: everything changed minus what the contract leaves out.
    const sizeOf = (p) => { try { return statSync(join(root, p)).size; } catch { return 0; } };
    const staged = () => stageable(changedPaths(root, cenv), { installDirty, written, sizeOf });
    const runs = [];
    let seq = 0;
    let lastWrite = 0;
    const testArgv = plan.pm && plan.scripts.includes('test') ? [plan.pm, 'test'] : null;
    const isTest = (argv) => testArgv !== null && argv[0] === testArgv[0] && (argv[1] === 'test' || (argv[1] === 'run' && argv[2] === 'test'));
    const record = (argv, r) => { const row = { command: argv.join(' '), exit: r.exit, out: r.out, timedOut: r.timedOut, seq: ++seq, isTest: isTest(argv) }; runs.push(row); return row; };

    const tool = (name, input) => {
      if (name === 'list_files') return readTool(root, 'redline_list', input);
      if (name === 'read_file') return readTool(root, 'redline_read', input);
      if (name === 'search') return readTool(root, 'redline_search', input);
      if (name === 'write_file') {
        try {
          const abs = safeWritePath(root, input.path);
          const content = String(input.content ?? '');
          if (Buffer.byteLength(content) > LIMITS.writeBytes) return `error: content is larger than ${LIMITS.writeBytes} bytes`;
          const rel = relative(realpathSync(root), abs).split(sep).join('/');
          const now = staged().keep;
          if (!now.includes(rel) && now.length >= LIMITS.files) return `error: the fix already changes ${now.length} files, the limit; no further file is written`;
          mkdirSync(dirname(abs), { recursive: true });
          writeFileSync(abs, content);
          written.add(rel);
          lastWrite = ++seq;
          return `wrote ${rel} (${content.split('\n').length} lines)`;
        } catch (e) { return `error: ${e.message}`; }
      }
      if (name === 'run') {
        const a = allowedArgv(input.command, plan, root);
        if (a.error) return `error: ${a.error}`;
        const s = Math.min(LIMITS.runMaxS, Math.max(1, Number(input.timeout_seconds) || LIMITS.runDefaultS));
        const r = record(a.argv, run(root, cenv, a.argv, s));
        return `exit ${r.exit}${r.timedOut ? ' (timed out)' : ''}\n${capOutput(r.out)}`;
      }
      return `error: unknown tool ${name}`;
    };

    let bounces = 0;
    let tests = null;
    const finalize = async (input) => {
      const checked = checkFinish(input);
      if (checked.error) return checked;
      if (checked.sub.outcome === 'refused') return { sub: checked.sub };
      if (testArgv && staged().keep.length) {
        // The suite runs after the last edit, by the model or, failing that, here.
        let t = [...runs].reverse().find((r) => r.isTest && r.seq > lastWrite);
        if (!t) { ctx.log?.('  no test run after the last edit: running the test script'); t = record(testArgv, run(root, cenv, testArgv, LIMITS.runMaxS)); }
        tests = t;
        if (t.exit !== 0 && bounces < LIMITS.testBounces) {
          bounces++;
          return { error: `The test script fails at your change (\`${t.command}\` exited ${t.exit}${t.timedOut ? ', timed out' : ''}):\n${capOutput(t.out, 6_000)}\n\nFix it and run the tests again, then call finish_fix.` };
        }
      }
      return { sub: checked.sub };
    };

    const brief = buildBrief({ pr, files, headSha, review, items, plan, installNote, diff: buildDiff(files, LIMITS.diffChars) });
    const loop = await runLoop({
      call: (messages, toolChoice) => callModelWith(ctx, { system: ctx.system, messages, tools: TOOLS, toolChoice, maxTokens: LIMITS.maxTokens, timeoutMs: LIMITS.modelTimeoutMs }),
      tool: async (name, input) => tool(name, input), finalize, now: ctx.now, log: ctx.log, canForce: !rejectsForcedToolChoice(ctx.model),
    }, brief);
    const turns = loop.turns;
    const testsRecord = tests ? { command: tests.command, exit_code: tests.exit, summary: summariseTests(tests.out) } : null;
    if (loop.refused) return refuse(loop.refused, { turns, tests: testsRecord });
    const sub = loop.sub;
    if (sub.outcome === 'refused') return refuse(sub.reason, { turns, tests: testsRecord });

    const st = staged();
    if (!st.keep.length) {
      return { record: fixRecord({ ...base, outcome: 'no_change', turns, tests: testsRecord, notes: renderNotes({ outcome: 'no_change', summary: sub.summary, skipped: st.skipped, tests: testsRecord }) }) };
    }
    if (st.keep.length > LIMITS.files) return refuse(`the fix changes ${st.keep.length} files; the limit is ${LIMITS.files}`, { turns, tests: testsRecord });
    git(root, cenv, ['add', '-A', '--', ...st.keep]);
    const diff = git(root, cenv, ['diff', '--cached', '--binary', headSha]) ?? '';
    const diffBytes = Buffer.byteLength(diff);
    if (diffBytes > LIMITS.diffBytes) return refuse(`the diff is ${diffBytes} bytes; the limit is ${LIMITS.diffBytes}`, { turns, tests: testsRecord });
    const common = { turns, tests: testsRecord, files: st.keep };
    const notes = (outcome) => renderNotes({ outcome, summary: sub.summary, files: st.keep, skipped: st.skipped, tests: testsRecord });

    if (testsRecord && testsRecord.exit_code !== 0) {
      writeFileSync(join(out, 'diff.patch'), `${diff}\n`);
      return { record: fixRecord({ ...base, ...common, outcome: 'tests_failed', notes: notes('tests_failed') }) };
    }
    if (ctx.dryRun) {
      writeFileSync(join(out, 'diff.patch'), `${diff}\n`);
      return { record: fixRecord({ ...base, ...common, outcome: 'fixed', notes: notes('fixed') }) };
    }

    // One commit as askalf, hooks off, then the message is checked and the bundle written.
    const hooks = join(home, 'no-hooks');
    mkdirSync(hooks, { recursive: true });
    git(root, cenv, ['-c', `user.name=${AUTHOR.name}`, '-c', `user.email=${AUTHOR.email}`, '-c', `core.hooksPath=${hooks}`,
      'commit', '--quiet', '--no-verify', '-m', sub.subject, '-m', `Answers the review at ${ctx.reviewUrl}.`]);
    const message = git(root, cenv, ['log', '-1', '--format=%B']) ?? '';
    if (hasAttributionTrailer(message)) throw new Error('the commit message carries an attribution trailer');
    const newHead = git(root, cenv, ['rev-parse', 'HEAD']);
    const commits = (git(root, cenv, ['log', '--format=%H%x00%s', `${headSha}..HEAD`]) ?? '').split('\n').filter(Boolean)
      .map((l) => { const [sha, subject] = l.split('\0'); return { sha, subject }; }).reverse();
    const bundle = join(out, 'fix.bundle');
    git(root, cenv, ['bundle', 'create', bundle, `${headSha}..HEAD`]);
    git(root, cenv, ['bundle', 'verify', bundle]);
    return { record: fixRecord({ ...base, ...common, outcome: 'fixed', newHead, commits, notes: notes('fixed') }) };
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

// ---------- CLI ----------

async function main() {
  const env = process.env;
  const need = (k, src = env) => { if (!src[k]) { console.error(`::error::${k} is not set`); process.exit(2); } return src[k]; };
  const secrets = parseEnvFile(readFileSync(need('FIX_ENV_FILE'), 'utf8'));
  // The runner's workspace outlives the job, so an earlier run's output is removed before this
  // one can leave anything to be uploaded.
  const out = resolve(need('FIX_OUT'));
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const darioUrl = secrets.DARIO_URL || 'http://127.0.0.1:3456';
  const ctx = {
    repo: need('REPO'), pr: Number(need('PR')), headSha: need('HEAD_SHA'), reviewUrl: need('REVIEW_URL'), checkout: need('CHECKOUT'), out,
    readToken: need('GH_READ_TOKEN'), darioUrl, darioKey: need('DARIO_API_KEY', secrets), model: secrets.FIX_MODEL || DEFAULT_MODEL,
    system: readFileSync(fileURLToPath(new URL('./fix-prompt.md', import.meta.url)), 'utf8'),
    fetch: onlyOrigins(globalThis.fetch, ['https://api.github.com', darioUrl]),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)), now: () => Date.now(),
    dryRun: env.DRY_RUN === '1' || env.DRY_RUN === 'true',
    log: (line) => console.log(line),
  };
  let record;
  try { ({ record } = await runFix(ctx)); } catch (e) {
    console.error(`::error::the fix run could not finish: ${e.message}`);
    record = fixRecord({ ...ctx, outcome: 'refused', notes: renderNotes({ outcome: 'refused', reason: `The fix run could not finish: ${e.message}` }) });
  }
  saveFix(out, record);
  const line = `Redline fix: ${record.outcome}${record.new_head ? ` at ${record.new_head}` : ''}${record.files.length ? ` (${record.files.length} file${record.files.length === 1 ? '' : 's'})` : ''}`;
  console.log(line);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${line}\n\n${record.notes}\n`);
  process.exit(record.outcome === 'fixed' ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
