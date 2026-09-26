#!/usr/bin/env node
// Rewrites a Redline caller's redline.yml so it calls redline-review.yml at one commit and has the
// review script fetched at that same commit. The reusable workflow cannot learn its own commit
// (github.job_workflow_sha is not available to expressions), so the caller passes it as the
// redline-ref input, and the two must always name the same sha.
//
// CLI: node scripts/redline/pin.mjs <sha> [note] < redline.yml > redline.yml.new

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const REVIEW_WORKFLOW = 'askalf/askalf/.github/workflows/redline-review.yml';
const SHA = /^[0-9a-f]{40}$/;

const indentOf = (l) => /^ */.exec(l)[0].length;
const blank = (l) => l.trim() === '' || l.trimStart().startsWith('#');

/**
 * The caller's yaml with the uses pin and the redline-ref input both at `sha`. Adds the input,
 * and a `with:` block for it, when the caller has neither. Throws when there is no pinned call.
 * @param {string} yaml
 * @param {string} sha
 * @param {string} [note] the pin's trailing comment, e.g. "main 2026-09-26, askalf/askalf#72"
 */
export function bumpCaller(yaml, sha, note = '') {
  if (!SHA.test(sha)) throw new Error(`not a full commit sha: ${sha}`);
  const lines = yaml.split('\n');
  const usesAt = lines.findIndex((l) => l.trimStart().startsWith(`uses: ${REVIEW_WORKFLOW}@`));
  if (usesAt < 0) throw new Error(`no ${REVIEW_WORKFLOW} call`);
  const pad = indentOf(lines[usesAt]);
  lines[usesAt] = `${' '.repeat(pad)}uses: ${REVIEW_WORKFLOW}@${sha}${note ? ` # ${note}` : ''}`;

  // The job's keys sit at the uses line's indent, between the job name above and the next line
  // indented less.
  let start = usesAt;
  while (start > 0 && (blank(lines[start - 1]) || indentOf(lines[start - 1]) >= pad)) start--;
  let end = usesAt + 1;
  while (end < lines.length && (blank(lines[end]) || indentOf(lines[end]) >= pad)) end++;
  const withAt = lines.findIndex((l, i) => i >= start && i < end && indentOf(l) === pad && /^with:\s*(#.*)?$/.test(l.trim()));

  if (withAt < 0) {
    lines.splice(usesAt + 1, 0, `${' '.repeat(pad)}with:`, `${' '.repeat(pad + 2)}redline-ref: ${sha}`);
    return lines.join('\n');
  }
  let inputEnd = withAt + 1;
  while (inputEnd < end && (blank(lines[inputEnd]) || indentOf(lines[inputEnd]) > pad)) inputEnd++;
  const inputs = lines.slice(withAt + 1, inputEnd);
  const childPad = inputs.find((l) => !blank(l)) ? indentOf(inputs.find((l) => !blank(l))) : pad + 2;
  const refAt = inputs.findIndex((l) => !blank(l) && indentOf(l) === childPad && /^redline-ref:/.test(l.trim()));
  const refLine = `${' '.repeat(childPad)}redline-ref: ${sha}`;
  if (refAt >= 0) lines[withAt + 1 + refAt] = refLine;
  else lines.splice(withAt + 1, 0, refLine);
  return lines.join('\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [sha, note = ''] = process.argv.slice(2);
  try {
    process.stdout.write(bumpCaller(readFileSync(0, 'utf8'), sha ?? '', note));
  } catch (e) {
    console.error(`::error::${e.message}`);
    process.exit(1);
  }
}
