// Redline: the gating code review, run as a CI job on a pull request.
//
// One run reviews one head. It reads the PR (metadata, commits, per-file patches) with the
// workflow's read-only token, lets the model read the PR checkout through read-only tools
// (list_files, read_file, grep; nothing executes), and ends when the model calls submit_review.
// The review is posted as sprayberry-redline with commit_id pinned to the head it read, and the
// process exits 0 on APPROVE and 1 on REQUEST_CHANGES, so the job's own check is the verdict.
//
// Hardening, each with a reason:
//   - A verdict already posted at this head is reused, never posted twice (re-runs are free).
//   - The head is re-read before posting; a head that moved gets no review (the newer run owns it).
//   - Every path a tool touches must resolve inside the checkout, symlinks included.
//   - Findings must quote text that is in the diff, the PR text or a commit message. One repair
//     round is offered; findings still ungrounded are dropped, and a REQUEST_CHANGES left with no
//     grounded finding fails closed with a note rather than approving.
//   - Blocking findings force REQUEST_CHANGES whatever verdict the model named.
//   - Turns, wall time, tool output and diff size are all bounded; near the end the model is
//     forced to submit.
//
// CLI (the workflow's review step):
//   REPO=owner/name PR=<n> HEAD_SHA=<sha> CHECKOUT=<dir> GH_READ_TOKEN=... \
//   REDLINE_ENV_FILE=/etc/askalf/redline.env node review.mjs
// The env file holds DARIO_API_KEY and REDLINE_GITHUB_TOKEN (or GITHUB_PAT_REVIEWER), and optionally
// DARIO_URL (default http://127.0.0.1:3456) and REDLINE_MODEL.

import { readFileSync, readdirSync, lstatSync, realpathSync, appendFileSync, openSync, readSync, closeSync } from 'node:fs';
import { join, resolve, relative, isAbsolute, sep } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

export const REVIEWER_LOGIN = 'sprayberry-redline';
export const HEADER = 'Automated review from the Sprayberry Labs fleet code reviewer.\n\nReviewed by the gating lane (gating review).';
export const DEFAULT_MODEL = 'claude-fable-5-1';
export const LIMITS = {
  diffChars: 180_000, bodyChars: 8_000, commitChars: 600, commits: 100,
  readLines: 400, readBytes: 64_000, listEntries: 400,
  grepResults: 80, grepFiles: 5_000, grepFileBytes: 1_000_000, grepPattern: 200,
  turns: 30, forceSubmitAt: 24, timeMs: 12 * 60_000, maxTokens: 8_000, modelTimeoutMs: 240_000,
};
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', 'vendor', '.next']);

// ---------- pure helpers ----------

/** KEY=VALUE lines; blank lines and # comments ignored; one layer of matching quotes stripped. */
export function parseEnvFile(text) {
  const out = {};
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    let v = line.slice(eq + 1).trim();
    if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v.at(-1) === v[0]) v = v.slice(1, -1);
    out[line.slice(0, eq).trim()] = v;
  }
  return out;
}

/** Resolve p under root, refusing anything (including a symlink) that lands outside it. */
export function safePath(root, p) {
  const rootReal = realpathSync(root);
  const abs = resolve(rootReal, String(p ?? '.').replace(/^\/+/, ''));
  const rel = relative(rootReal, abs);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('path is outside the checkout');
  let real;
  try { real = realpathSync(abs); } catch { throw new Error('no such file or directory'); }
  if (real !== rootReal && !real.startsWith(rootReal + sep)) throw new Error('path resolves outside the checkout');
  return real;
}

function isBinary(file) {
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(8192);
    const n = readSync(fd, buf, 0, buf.length, 0);
    return buf.subarray(0, n).includes(0);
  } finally { closeSync(fd); }
}

/** The PR's per-file patches as one unified diff, capped; files without a patch are named. */
export function buildDiff(files, cap = LIMITS.diffChars) {
  let out = '';
  const omitted = [];
  for (const f of files) {
    const head = `diff --git a/${f.previous_filename ?? f.filename} b/${f.filename}\n`;
    const part = f.patch ? `${head}${f.patch}\n` : `${head}(no patch: binary, too large, or a rename without changes)\n`;
    if (out.length + part.length > cap) { omitted.push(f.filename); continue; }
    out += part;
  }
  if (omitted.length) out += `\n(diff cap reached; not shown, read them with read_file: ${omitted.join(', ')})\n`;
  return out;
}

const norm = (s) => String(s).replace(/\s+/g, ' ').trim();

/**
 * Every non-empty quoted line must appear in the corpus, whitespace-normalised. A leading diff
 * marker may or may not be copied, so each quoted line matches with or without its first + - or space.
 */
export function quoteIsGrounded(quote, corpusLines) {
  const lines = String(quote ?? '').split('\n').filter((l) => norm(l));
  // A fragment this short matches almost anything, so it proves nothing.
  if (norm(lines.join(' ')).length < 8) return false;
  return lines.every((l) => {
    const forms = [norm(l), norm(l.replace(/^[+\- ]/, ''))].filter(Boolean);
    return forms.some((q) => corpusLines.some((c) => c.includes(q)));
  });
}

/** The brief's lines, each both as written and without a leading diff marker, normalised. */
export function corpusOf(brief) {
  const out = [];
  for (const l of brief.split('\n')) {
    const a = norm(l);
    if (a) out.push(a);
    const b = norm(l.replace(/^[+\- ]/, ''));
    if (b && b !== a) out.push(b);
  }
  return out;
}

/** Validate submit_review input; returns { review } or { error }. */
export function checkSubmission(input) {
  if (!input || typeof input !== 'object') return { error: 'submit_review needs an object' };
  if (input.verdict !== 'APPROVE' && input.verdict !== 'REQUEST_CHANGES') return { error: 'verdict must be APPROVE or REQUEST_CHANGES' };
  if (typeof input.summary !== 'string' || !input.summary.trim()) return { error: 'summary is required' };
  const findings = Array.isArray(input.findings) ? input.findings : [];
  for (const [i, f] of findings.entries()) {
    if (!f || (f.severity !== 'blocking' && f.severity !== 'minor')) return { error: `finding ${i + 1}: severity must be blocking or minor` };
    for (const k of ['file', 'quote', 'problem']) if (typeof f[k] !== 'string' || !f[k].trim()) return { error: `finding ${i + 1}: ${k} is required` };
  }
  const rule = typeof input.rule === 'string' && /^[a-z0-9-]{1,40}$/.test(input.rule) ? input.rule : 'none';
  return { review: { verdict: input.verdict, summary: input.summary.trim(), findings, rule } };
}

/** Findings the corpus does not back. */
export function ungrounded(review, corpusLines) {
  return review.findings.filter((f) => !quoteIsGrounded(f.quote, corpusLines));
}

/** Final verdict: blocking findings always request changes. */
export function finalVerdict(review) {
  return review.findings.some((f) => f.severity === 'blocking') ? 'REQUEST_CHANGES' : review.verdict;
}

const fence = (s) => { const t = String(s); const n = Math.max(3, ...(t.match(/`+/g) ?? []).map((m) => m.length + 1)); return '`'.repeat(n); };

export function renderBody(review, verdict, headSha, notes = []) {
  const parts = [HEADER, `**Verdict: ${verdict === 'APPROVE' ? 'approve' : 'request changes'}.** ${review.summary}`];
  const blocking = review.findings.filter((f) => f.severity === 'blocking');
  const minor = review.findings.filter((f) => f.severity === 'minor');
  blocking.forEach((f, i) => {
    const where = f.line ? `${f.file}:${f.line}` : f.file;
    let s = `### ${i + 1}. Blocking: \`${where}\`\n\n${String(f.quote).split('\n').map((l) => `> ${l}`).join('\n')}\n\n${f.problem.trim()}`;
    if (f.suggestion && String(f.suggestion).trim()) { const fc = fence(f.suggestion); s += `\n\nSuggested fix:\n\n${fc}\n${String(f.suggestion).trim()}\n${fc}`; }
    parts.push(s);
  });
  if (minor.length) parts.push(`Minor:\n${minor.map((f) => `- \`${f.line ? `${f.file}:${f.line}` : f.file}\`: ${norm(f.problem)}`).join('\n')}`);
  for (const n of notes) parts.push(`_${n}_`);
  if (verdict === 'REQUEST_CHANGES') parts.push(`rule:${review.rule}`);
  parts.push(`<!-- redline:head=${headSha} -->`);
  return parts.join('\n\n');
}

/** The standing Redline verdict at this head, or null. */
export function verdictAtHead(reviews, headSha) {
  let v = null;
  for (const r of reviews) {
    if ((r.user?.login ?? '') !== REVIEWER_LOGIN || r.commit_id !== headSha) continue;
    if (r.state === 'APPROVED' || r.state === 'CHANGES_REQUESTED') v = r;
  }
  return v;
}

// ---------- tools over the checkout ----------

export const TOOLS = [
  { name: 'list_files', description: 'List a directory of the PR checkout (directories end with /).',
    input_schema: { type: 'object', properties: { path: { type: 'string', description: 'Directory relative to the repo root; default the root.' } } } },
  { name: 'read_file', description: `Read lines of a file in the PR checkout, numbered. At most ${LIMITS.readLines} lines per call.`,
    input_schema: { type: 'object', properties: { path: { type: 'string' }, start_line: { type: 'integer', minimum: 1 }, end_line: { type: 'integer', minimum: 1 } }, required: ['path'] } },
  { name: 'grep', description: `Search the PR checkout with a JavaScript regular expression. At most ${LIMITS.grepResults} matches.`,
    input_schema: { type: 'object', properties: { pattern: { type: 'string' }, path: { type: 'string', description: 'Directory or file to search; default the root.' } }, required: ['pattern'] } },
  { name: 'submit_review', description: 'Submit the review. Call exactly once, last.',
    input_schema: { type: 'object', required: ['verdict', 'summary', 'findings'], properties: {
      verdict: { type: 'string', enum: ['APPROVE', 'REQUEST_CHANGES'] },
      summary: { type: 'string', description: 'One short paragraph: the verdict in a sentence and what you checked.' },
      rule: { type: 'string', description: 'For REQUEST_CHANGES: the most severe blocking finding\'s rule slug, or none.' },
      findings: { type: 'array', items: { type: 'object', required: ['severity', 'file', 'quote', 'problem'], properties: {
        severity: { type: 'string', enum: ['blocking', 'minor'] },
        file: { type: 'string' }, line: { type: 'integer' },
        quote: { type: 'string', description: 'The exact lines, copied from the diff, PR text or a commit message.' },
        problem: { type: 'string', description: 'What is wrong: the input or state, and the wrong result.' },
        suggestion: { type: 'string' } } } } } } },
];

export function runTool(root, name, input = {}) {
  try {
    if (name === 'list_files') {
      const dir = safePath(root, input.path);
      const rows = readdirSync(dir, { withFileTypes: true }).filter((e) => e.name !== '.git')
        .map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).sort();
      return rows.length > LIMITS.listEntries ? `${rows.slice(0, LIMITS.listEntries).join('\n')}\n(${rows.length - LIMITS.listEntries} more not shown)` : rows.join('\n') || '(empty)';
    }
    if (name === 'read_file') {
      const file = safePath(root, input.path);
      if (lstatSync(file).isDirectory()) return 'error: that is a directory; use list_files';
      if (isBinary(file)) return 'error: binary file, not readable as text';
      const lines = readFileSync(file, 'utf8').split('\n');
      const start = Math.max(1, Number(input.start_line) || 1);
      const end = Math.min(lines.length, Number(input.end_line) || start + LIMITS.readLines - 1, start + LIMITS.readLines - 1);
      let out = '';
      for (let i = start; i <= end; i++) {
        const row = `${i}\t${lines[i - 1]}\n`;
        if (out.length + row.length > LIMITS.readBytes) { out += `(output cap reached at line ${i - 1})\n`; break; }
        out += row;
      }
      return `${out}(file has ${lines.length} lines)`;
    }
    if (name === 'grep') {
      const pat = String(input.pattern ?? '');
      if (!pat || pat.length > LIMITS.grepPattern) return `error: pattern must be 1-${LIMITS.grepPattern} characters`;
      let re;
      try { re = new RegExp(pat); } catch (e) { return `error: bad pattern: ${e.message}`; }
      const start = safePath(root, input.path);
      const rootReal = realpathSync(root);
      const hits = [];
      let files = 0;
      const walk = (p) => {
        if (hits.length >= LIMITS.grepResults || files >= LIMITS.grepFiles) return;
        const st = lstatSync(p);
        if (st.isSymbolicLink()) return;
        if (st.isDirectory()) {
          for (const e of readdirSync(p).sort()) if (!SKIP_DIRS.has(e)) walk(join(p, e));
          return;
        }
        files++;
        if (st.size > LIMITS.grepFileBytes || isBinary(p)) return;
        const lines = readFileSync(p, 'utf8').split('\n');
        for (let i = 0; i < lines.length && hits.length < LIMITS.grepResults; i++) {
          if (re.test(lines[i])) hits.push(`${relative(rootReal, p).split(sep).join('/')}:${i + 1}: ${lines[i].slice(0, 300)}`);
        }
      };
      walk(start);
      return hits.length ? hits.join('\n') + (hits.length >= LIMITS.grepResults ? '\n(match cap reached)' : '') : '(no matches)';
    }
    return `error: unknown tool ${name}`;
  } catch (e) {
    return `error: ${e.message}`;
  }
}

// ---------- GitHub and the model ----------

async function withRetry(ctx, what, fn) {
  const waits = [5_000, 15_000, 45_000];
  for (let attempt = 0; ; attempt++) {
    let res;
    try { res = await fn(); } catch (e) {
      if (attempt >= waits.length) throw new Error(`${what}: ${e.message}`);
      await ctx.sleep(waits[attempt]); continue;
    }
    if (res.ok) return res;
    if ((res.status === 429 || res.status >= 500) && attempt < waits.length) { await ctx.sleep(waits[attempt]); continue; }
    throw new Error(`${what}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  }
}

function gh(ctx, path, { token = ctx.readToken, method = 'GET', body } = {}) {
  return withRetry(ctx, `GitHub ${method} ${path.split('?')[0]}`, () => ctx.fetch(`https://api.github.com${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30_000),
  })).then((r) => r.json());
}

async function ghAll(ctx, path, max = 30) {
  const out = [];
  for (let page = 1; page <= max; page++) {
    const rows = await gh(ctx, `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    out.push(...rows);
    if (rows.length < 100) break;
  }
  return out;
}

async function callModel(ctx, system, messages, force) {
  const res = await withRetry(ctx, 'model', () => ctx.fetch(`${ctx.darioUrl.replace(/\/+$/, '')}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': ctx.darioKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: ctx.model, max_tokens: LIMITS.maxTokens, system, messages, tools: TOOLS,
      ...(force ? { tool_choice: { type: 'tool', name: 'submit_review' } } : {}),
    }),
    signal: AbortSignal.timeout(LIMITS.modelTimeoutMs),
  }));
  return res.json();
}

export function buildBrief(pr, files, commits, diff) {
  const body = (pr.body ?? '').slice(0, LIMITS.bodyChars);
  const commitLines = commits.slice(0, LIMITS.commits).map((c) => `- ${c.sha.slice(0, 7)} ${String(c.commit?.message ?? '').slice(0, LIMITS.commitChars).replace(/\n/g, '\n  ')}`);
  return [
    `Repository: ${pr.base.repo.full_name}`,
    `PR #${pr.number}: ${pr.title}`,
    `Author: ${pr.user?.login}; ${pr.head.ref} -> ${pr.base.ref}; head ${pr.head.sha}`,
    '', 'PR description:', body || '(empty)',
    '', `Commits (${commits.length}):`, ...commitLines,
    '', `Changed files (${files.length}):`, ...files.map((f) => `- ${f.status} +${f.additions} -${f.deletions} ${f.filename}`),
    '', 'Diff:', diff,
  ].join('\n');
}

/**
 * Review one PR head. ctx: { repo, pr, headSha, checkout, readToken, reviewToken, darioUrl, darioKey,
 * model, system, fetch, sleep, now, log }.
 * Returns { outcome: 'posted'|'existing'|'skipped', verdict?, url?, reason? }.
 */
export async function runReview(ctx) {
  const { repo, pr: n, headSha } = ctx;
  const pr = await gh(ctx, `/repos/${repo}/pulls/${n}`);
  if (pr.state !== 'open') return { outcome: 'skipped', reason: `PR is ${pr.state}` };
  if (pr.head.sha !== headSha) return { outcome: 'skipped', reason: `head moved to ${pr.head.sha.slice(0, 7)}` };
  if (pr.head.repo?.full_name !== repo) return { outcome: 'skipped', reason: 'fork PR' };

  const standing = verdictAtHead(await ghAll(ctx, `/repos/${repo}/pulls/${n}/reviews`), headSha);
  if (standing) return { outcome: 'existing', verdict: standing.state === 'APPROVED' ? 'APPROVE' : 'REQUEST_CHANGES', url: standing.html_url };

  const files = await ghAll(ctx, `/repos/${repo}/pulls/${n}/files`);
  const commits = await ghAll(ctx, `/repos/${repo}/pulls/${n}/commits`, 3);
  const brief = buildBrief(pr, files, commits, buildDiff(files));
  const corpus = corpusOf(brief);

  const messages = [{ role: 'user', content: `${brief}\n\nReview this change and finish with submit_review.` }];
  const started = ctx.now();
  let review = null;
  let repaired = false;
  const notes = [];
  for (let turn = 1; turn <= LIMITS.turns && !review; turn++) {
    const force = turn >= LIMITS.forceSubmitAt || ctx.now() - started > LIMITS.timeMs;
    const res = await callModel(ctx, ctx.system, messages, force);
    messages.push({ role: 'assistant', content: res.content });
    const uses = (res.content ?? []).filter((b) => b.type === 'tool_use');
    ctx.log?.(`turn ${turn}${force ? ' (forced)' : ''}: ${uses.map((u) => u.name).join(', ') || 'no tool call'}; stop=${res.stop_reason ?? '-'}`);
    if (!uses.length) { messages.push({ role: 'user', content: 'Use the tools, and finish with submit_review.' }); continue; }
    const results = [];
    for (const u of uses) {
      if (u.name !== 'submit_review') {
        // Past the forced turn a read is refused, not run, so the model cannot keep reading whether or
        // not a gateway kept tool_choice (dario#1423, 2026-09-25: 30 turns of reading past it).
        results.push(force
          ? { type: 'tool_result', tool_use_id: u.id, is_error: true, content: 'The read budget is spent. Call submit_review now with what you have read.' }
          : { type: 'tool_result', tool_use_id: u.id, content: runTool(ctx.checkout, u.name, u.input) });
        continue;
      }
      const checked = checkSubmission(u.input);
      if (checked.error) {
        ctx.log?.(`  submission rejected: ${checked.error}`);
        results.push({ type: 'tool_result', tool_use_id: u.id, is_error: true, content: checked.error });
        continue;
      }
      const bad = ungrounded(checked.review, corpus);
      if (bad.length && !repaired && turn < LIMITS.turns) {
        repaired = true;
        ctx.log?.(`  ${bad.length} ungrounded finding(s): one repair round offered`);
        results.push({ type: 'tool_result', tool_use_id: u.id, is_error: true, content:
          `These findings quote text that is not in the diff, the PR text or a commit message: ${bad.map((f) => `${f.file} ("${norm(f.quote).slice(0, 80)}")`).join('; ')}. Copy the quote exactly from the diff, or drop the finding, then call submit_review again.` });
        continue;
      }
      if (bad.length) {
        checked.review.findings = checked.review.findings.filter((f) => !bad.includes(f));
        notes.push(`${bad.length} finding(s) dropped: their quotes are not in the diff.`);
        if (checked.review.verdict === 'REQUEST_CHANGES' && !checked.review.findings.some((f) => f.severity === 'blocking')) {
          notes.push('The review asked for changes but none of its blocking findings could be grounded in the diff. Re-run the check.');
        }
      }
      review = checked.review;
      break;
    }
    if (!review) messages.push({ role: 'user', content: results });
  }
  if (!review) throw new Error(`no review submitted within ${LIMITS.turns} turns`);

  const verdict = finalVerdict(review);
  if (ctx.dryRun) return { outcome: 'dry-run', verdict, body: renderBody(review, verdict, headSha, notes) };
  const now = await gh(ctx, `/repos/${repo}/pulls/${n}`);
  if (now.head.sha !== headSha) return { outcome: 'skipped', reason: `head moved to ${now.head.sha.slice(0, 7)} during the review` };
  const posted = await gh(ctx, `/repos/${repo}/pulls/${n}/reviews`, {
    token: ctx.reviewToken, method: 'POST',
    body: { commit_id: headSha, event: verdict, body: renderBody(review, verdict, headSha, notes) },
  });
  return { outcome: 'posted', verdict, url: posted.html_url };
}

// ---------- CLI ----------

async function main() {
  const env = process.env;
  const need = (k, src = env) => { if (!src[k]) { console.error(`::error::${k} is not set`); process.exit(2); } return src[k]; };
  const secrets = parseEnvFile(readFileSync(need('REDLINE_ENV_FILE'), 'utf8'));
  const ctx = {
    repo: need('REPO'), pr: Number(need('PR')), headSha: need('HEAD_SHA'), checkout: need('CHECKOUT'),
    readToken: need('GH_READ_TOKEN'),
    reviewToken: secrets.REDLINE_GITHUB_TOKEN || need('GITHUB_PAT_REVIEWER', secrets),
    darioUrl: secrets.DARIO_URL || 'http://127.0.0.1:3456', darioKey: need('DARIO_API_KEY', secrets),
    model: secrets.REDLINE_MODEL || DEFAULT_MODEL,
    system: readFileSync(fileURLToPath(new URL('./prompt.md', import.meta.url)), 'utf8'),
    fetch: globalThis.fetch, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), now: () => Date.now(),
    dryRun: env.REDLINE_DRY_RUN === '1',
    log: (line) => console.log(line),
  };
  let result;
  try { result = await runReview(ctx); } catch (e) {
    console.error(`::error::Redline could not finish the review: ${e.message}`);
    process.exit(2);
  }
  const line = result.outcome === 'skipped' ? `Redline skipped: ${result.reason}`
    : result.outcome === 'dry-run' ? `Redline dry run (nothing posted): ${result.verdict}`
      : `Redline ${result.outcome === 'existing' ? 'already reviewed' : 'posted'}: ${result.verdict} ${result.url ?? ''}`;
  console.log(line);
  if (result.body) console.log(`\n${result.body}`);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${line}\n`);
  process.exit(result.verdict === 'REQUEST_CHANGES' ? 1 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
