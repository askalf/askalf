/**
 * Forge Security Regression Tests — CWE-78 Shell Injection (git-ops.ts)
 *
 * These tests document and verify the shell injection vulnerability in git-ops.ts
 * and shell-exec.ts described in Aegis's immune patrol (execution 01KJ25BR7C1N9EJRKEGYVZ6CBQ).
 *
 * CWE-78: OS Command Injection — user-controlled strings are interpolated into
 * shell commands via `exec()` string templates, allowing metacharacter injection.
 *
 * VULNERABLE pattern (current main):
 *   exec(`git -C "${REPO_ROOT}" ${args}`)
 *   // args may contain user input with shell metacharacters
 *
 * SECURE pattern (Aegis fix, pending merge):
 *   execFile('git', ['-C', REPO_ROOT, ...argsArray])
 *   // each arg is a separate array element, never shell-interpolated
 *
 * Test strategy:
 *  - INJECTION PROBE tests: attempt a harmless injection (writing a sentinel file
 *    to /tmp). If injection works, the file exists → vulnerability confirmed.
 *    These tests ASSERT the file does NOT exist, so they FAIL on vulnerable code
 *    and PASS after the Aegis execFile fix is merged.
 *  - VALIDATION tests: test input sanitization helpers that are always expected
 *    to work regardless of exec vs execFile.
 *  - BLOCKED_PATTERNS GAP tests: document what shellExec does NOT block.
 *
 * Run with:
 *   tsx tests/unit7-security-regression.ts
 */

import { shellExec } from '../src/tools/built-in/shell-exec.js';
import { gitOps } from '../src/tools/built-in/git-ops.js';
import { existsSync, unlinkSync } from 'fs';

// ─── Test runner ─────────────────────────────────────────────────────────────

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration: number;
  expectation: 'should_pass' | 'documents_vulnerability';
}

const results: TestResult[] = [];
let currentSuite = '';

function suite(name: string): void {
  currentSuite = name;
  console.log(`\n  ${name}`);
}

async function test(
  name: string,
  fn: () => void | Promise<void>,
  expectation: 'should_pass' | 'documents_vulnerability' = 'should_pass',
): Promise<void> {
  const start = performance.now();
  try {
    await fn();
    const duration = Math.round(performance.now() - start);
    results.push({ name: `${currentSuite} > ${name}`, passed: true, error: undefined, duration, expectation });
    console.log(`    ✓ ${name} (${duration}ms)`);
  } catch (err) {
    const duration = Math.round(performance.now() - start);
    const error = err instanceof Error ? err.message : String(err);
    results.push({ name: `${currentSuite} > ${name}`, passed: false, error, duration, expectation });
    const tag = expectation === 'documents_vulnerability' ? ' [EXPECTED FAIL — vulnerability present]' : '';
    console.log(`    ✗ ${name} (${duration}ms)${tag}`);
    console.log(`        ${error}`);
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function assertIncludes(actual: string, substr: string, label: string): void {
  if (!actual.includes(substr)) {
    throw new Error(`${label}: expected to include "${substr}", got "${actual.slice(0, 200)}"`);
  }
}

/** Ensure a sentinel file does not exist, then return a cleanup function. */
function sentinelFile(path: string): () => void {
  if (existsSync(path)) unlinkSync(path);
  return () => { if (existsSync(path)) unlinkSync(path); };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

async function runTests() {

  // ────────────────────────────────────────────────────────────────────────
  suite('git-ops → Branch Name Sanitization (should always be safe)');
  // ────────────────────────────────────────────────────────────────────────

  // branch_create sanitizes via .replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase()
  // This is correct and should prevent injection at branch_create.
  // (We cannot fully test without a live git repo, but we can verify the slug logic.)

  await test('branch_create strips shell metacharacters from branch name slug', async () => {
    // branch_create sanitizes: replaces non-[a-zA-Z0-9_-] with '-'
    // So "; rm -rf /;" becomes "----------"
    // Verify the sanitization by checking that the resulting branch name is safe
    const maliciousInput = '; rm -rf /; echo pwned';
    const sanitized = maliciousInput.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
    // After sanitization, no shell metacharacters remain
    const dangerousChars = [';', '|', '&', '$', '`', '(', ')', '<', '>', '!', '"', "'", '\\', '\n'];
    for (const ch of dangerousChars) {
      assert(!sanitized.includes(ch), `Sanitized branch name should not contain '${ch}', got: ${sanitized}`);
    }
  });

  await test('branch_create agent-slug also sanitizes agent name whitespace', async () => {
    const agentName = 'QA Engineer'; // has a space
    const agentSlug = agentName.replace(/\s+/g, '-').toLowerCase();
    assert(agentSlug === 'qa-engineer', `Agent slug should be 'qa-engineer', got '${agentSlug}'`);
  });

  // ────────────────────────────────────────────────────────────────────────
  suite('git-ops → diff file_path Injection (CWE-78 regression)');
  // ────────────────────────────────────────────────────────────────────────
  // VULNERABLE path in git-ops.ts (main branch — exec with string interpolation):
  //   case 'diff':
  //     if (input.file_path) cmd += ` -- "${input.file_path}"`;
  //     const res = await git(cmd);  // exec(`git -C "${REPO_ROOT}" diff -- "${file_path}"`)
  //
  // If file_path = '" && touch /tmp/SENTINEL && echo "', the shell executes:
  //   git -C "/workspace" diff -- "" && touch /tmp/SENTINEL && echo ""
  // The touch command runs, proving injection.
  //
  // After the execFile fix, the file_path is passed as a separate argument:
  //   execFile('git', ['-C', REPO_ROOT, 'diff', '--', file_path])
  // No shell sees the metacharacters, injection is impossible.

  const DIFF_SENTINEL = '/tmp/qa_sec_diff_injection';

  await test('[CWE-78] diff file_path cannot inject shell commands', async () => {
    const cleanup = sentinelFile(DIFF_SENTINEL);
    try {
      // This injection payload escapes the double-quoted argument in shell context
      const maliciousFilePath = `" && touch ${DIFF_SENTINEL} && echo "`;
      await gitOps({ action: 'diff', file_path: maliciousFilePath });

      // If execFile is used (fixed): the file should NOT exist
      // If exec is used (vulnerable): the file WILL exist
      const injected = existsSync(DIFF_SENTINEL);
      assert(!injected,
        `INJECTION SUCCEEDED: '${DIFF_SENTINEL}' was created by file_path injection. ` +
        `git-ops.ts is vulnerable — Aegis execFile fix must be merged.`
      );
    } finally {
      cleanup();
    }
  }, 'documents_vulnerability');

  // ────────────────────────────────────────────────────────────────────────
  suite('git-ops → commit message Injection (CWE-78 regression)');
  // ────────────────────────────────────────────────────────────────────────
  // VULNERABLE path in git-ops.ts commit case:
  //   const fullMessage = `${input.message}\n\n[Agent: ...]`;
  //   gitIn(commitDir, `-c user.name="..." commit -m "${fullMessage.replace(/"/g, '\\"')}"`)
  //
  // The code escapes " → \" but does NOT escape backticks or $().
  // A message containing `touch /tmp/SENTINEL` causes shell to execute it.

  const COMMIT_SENTINEL = '/tmp/qa_sec_commit_injection';

  await test('[CWE-78] commit message cannot inject via backticks', async () => {
    const cleanup = sentinelFile(COMMIT_SENTINEL);
    try {
      // Backtick command substitution — not neutralized by the current " → \" escape
      const maliciousMessage = `safe message\`touch ${COMMIT_SENTINEL}\``;
      // Even if commit fails (no staged files), the command injection runs during exec()
      await gitOps({
        action: 'commit',
        message: maliciousMessage,
        agent_name: 'QA Engineer',
        agent_id: 'test',
      });

      const injected = existsSync(COMMIT_SENTINEL);
      assert(!injected,
        `INJECTION SUCCEEDED: backtick in commit message executed shell command. ` +
        `git-ops.ts is vulnerable to backtick injection — Aegis execFile fix must be merged.`
      );
    } finally {
      cleanup();
    }
  }, 'documents_vulnerability');

  // ────────────────────────────────────────────────────────────────────────
  suite('git-ops → add file paths Injection (CWE-78 regression)');
  // ────────────────────────────────────────────────────────────────────────
  // VULNERABLE path in git-ops.ts add case:
  //   const pathArgs = input.paths.map((p) => `"${p}"`).join(' ');
  //   gitIn(addWorkdir, `add -- ${pathArgs}`)
  //   // exec(`git -C "${workdir}" add -- "${path}"`)
  //
  // Wrapping in quotes without escaping interior quotes allows escape.

  const ADD_SENTINEL = '/tmp/qa_sec_add_injection';

  await test('[CWE-78] add paths cannot inject shell commands', async () => {
    const cleanup = sentinelFile(ADD_SENTINEL);
    try {
      const maliciousPath = `" && touch ${ADD_SENTINEL} && echo "`;
      await gitOps({ action: 'add', paths: [maliciousPath] });

      const injected = existsSync(ADD_SENTINEL);
      assert(!injected,
        `INJECTION SUCCEEDED: '${ADD_SENTINEL}' was created by add paths injection. ` +
        `git-ops.ts is vulnerable — Aegis execFile fix must be merged.`
      );
    } finally {
      cleanup();
    }
  }, 'documents_vulnerability');

  // ────────────────────────────────────────────────────────────────────────
  suite('git-ops → isBlockedFile (safe file path guard)');
  // ────────────────────────────────────────────────────────────────────────
  // The isBlockedFile function prevents staging sensitive files.
  // Test that it correctly blocks known sensitive patterns.

  await test('add rejects .env files', async () => {
    const result = await gitOps({ action: 'add', paths: ['.env'] });
    assert(result.error !== undefined, 'Expected error for .env file');
    assertIncludes(result.error!, 'Blocked', 'Error should mention blocked');
  });

  await test('add rejects .key files', async () => {
    const result = await gitOps({ action: 'add', paths: ['secrets.key'] });
    assert(result.error !== undefined, 'Expected error for .key file');
    assertIncludes(result.error!, 'Blocked', 'Error should mention blocked');
  });

  await test('add rejects .pem files', async () => {
    const result = await gitOps({ action: 'add', paths: ['server.pem'] });
    assert(result.error !== undefined, 'Expected error for .pem file');
    assertIncludes(result.error!, 'Blocked', 'Error should mention blocked');
  });

  await test('add rejects credentials files', async () => {
    const result = await gitOps({ action: 'add', paths: ['aws-credentials'] });
    assert(result.error !== undefined, 'Expected error for credentials file');
    assertIncludes(result.error!, 'Blocked', 'Error should mention blocked');
  });

  await test('add rejects secret files (case-insensitive)', async () => {
    const result = await gitOps({ action: 'add', paths: ['my-SECRET-key.txt'] });
    assert(result.error !== undefined, 'Expected error for secret file');
    assertIncludes(result.error!, 'Blocked', 'Error should mention blocked');
  });

  await test('add rejects mixed safe + blocked paths', async () => {
    const result = await gitOps({ action: 'add', paths: ['README.md', '.env.production'] });
    assert(result.error !== undefined, 'Expected error when any path is blocked');
    assertIncludes(result.error!, 'Blocked', 'Error should mention blocked');
  });

  await test('add requires non-empty paths array', async () => {
    const result = await gitOps({ action: 'add', paths: [] });
    assert(result.error !== undefined, 'Expected error for empty paths');
    assertIncludes(result.error!, 'paths array is required', 'Error should describe missing paths');
  });

  // ────────────────────────────────────────────────────────────────────────
  suite('git-ops → Input Validation Guards');
  // ────────────────────────────────────────────────────────────────────────

  await test('branch_create requires branch_name', async () => {
    const result = await gitOps({ action: 'branch_create', agent_name: 'QA Engineer' });
    assert(result.error !== undefined, 'Expected error for missing branch_name');
    assertIncludes(result.error!, 'branch_name is required', 'Error should describe issue');
  });

  await test('branch_create requires agent_name', async () => {
    const result = await gitOps({ action: 'branch_create', branch_name: 'test-branch' });
    assert(result.error !== undefined, 'Expected error for missing agent_name');
    assertIncludes(result.error!, 'agent_name is required', 'Error should describe issue');
  });

  await test('commit requires message', async () => {
    const result = await gitOps({ action: 'commit', agent_name: 'QA Engineer' });
    assert(result.error !== undefined, 'Expected error for missing message');
    assertIncludes(result.error!, 'message is required', 'Error should describe issue');
  });

  await test('commit requires agent_name', async () => {
    const result = await gitOps({ action: 'commit', message: 'test commit' });
    assert(result.error !== undefined, 'Expected error for missing agent_name');
    assertIncludes(result.error!, 'agent_name is required', 'Error should describe issue');
  });

  await test('checkout rejects non-agent branches', async () => {
    const result = await gitOps({ action: 'checkout', branch_name: 'evil-branch' });
    assert(result.error !== undefined, 'Expected error for non-agent branch');
    assertIncludes(result.error!, 'agent/', 'Error should mention agent/* requirement');
  });

  await test('checkout rejects branch without agent/ prefix', async () => {
    const result = await gitOps({ action: 'checkout', branch_name: 'feature/my-thing' });
    assert(result.error !== undefined, 'Expected error — not an agent/* branch');
  });

  // ────────────────────────────────────────────────────────────────────────
  suite('shellExec → BLOCKED_PATTERNS Gap Analysis (documentation)');
  // ────────────────────────────────────────────────────────────────────────
  // The current BLOCKED_PATTERNS list in shell-exec.ts blocks catastrophic
  // commands but leaves gaps for network exfiltration, lateral movement,
  // and privilege escalation. These tests document what IS and IS NOT blocked.
  // Note: shellExec is designed to run shell commands — the blocked patterns
  // are a safety net, not the primary security control.

  await test('[GAP] shellExec does NOT block network exfiltration via curl', async () => {
    // curl is not in BLOCKED_PATTERNS — any command with curl is allowed
    // (This test just verifies the gap exists — does NOT actually exfiltrate)
    const result = await shellExec({ command: 'which curl 2>/dev/null || echo not_found' });
    // We just document this passes through — the test always "passes" since
    // we're documenting the gap, not asserting blockage
    assert(result.error === undefined || result.output !== null, 'Command passes through to shell (curl not blocked)');
  });

  await test('[GAP] shellExec does NOT block semicolon-chained commands', async () => {
    // Pattern like "echo safe; malicious_cmd" is not blocked
    const result = await shellExec({ command: 'echo first; echo second' });
    const output = result.output as Record<string, unknown>;
    const stdout = (output?.stdout ?? '') as string;
    // Both commands run — demonstrates chaining is permitted
    assertIncludes(stdout, 'first', 'First command runs');
    assertIncludes(stdout, 'second', 'Second chained command also runs — gap documented');
  });

  await test('[GAP] shellExec does NOT block pipe-based data exfil patterns', async () => {
    // Piped commands are not blocked
    const result = await shellExec({ command: 'echo sensitive | cat' });
    const output = result.output as Record<string, unknown>;
    assert(result.error === undefined, 'Piped command not blocked — gap documented');
    assert((output?.stdout as string).includes('sensitive'), 'Data passes through pipe');
  });

  await test('shellExec DOES block rm -rf / (catastrophic pattern)', async () => {
    const result = await shellExec({ command: 'rm -rf /' });
    assert(result.error !== undefined, 'Expected block');
    assertIncludes(result.error!, 'Blocked', 'Confirmed blocked');
  });

  await test('shellExec DOES block shutdown (system halt)', async () => {
    const result = await shellExec({ command: 'shutdown -h now' });
    assert(result.error !== undefined, 'Expected block');
    assertIncludes(result.error!, 'Blocked', 'Confirmed blocked');
  });

  // ────────────────────────────────────────────────────────────────────────
  suite('git-review → validateBranch behavior verification');
  // ────────────────────────────────────────────────────────────────────────
  // git-review.ts has a validateBranch() function with regex:
  //   SAFE_BRANCH_RE = /^agent\/[a-zA-Z0-9._\-/]+$/
  // This prevents injection via the HTTP API routes. We verify the regex logic here.

  await test('SAFE_BRANCH_RE accepts valid agent/* branches', () => {
    const SAFE_BRANCH_RE = /^agent\/[a-zA-Z0-9._\-/]+$/;
    const validBranches = [
      'agent/qa-engineer/fix-123',
      'agent/backend-dev/feature.test',
      'agent/anvil/01KJ123ABC456',
    ];
    for (const branch of validBranches) {
      assert(SAFE_BRANCH_RE.test(branch), `Expected '${branch}' to be valid`);
    }
  });

  await test('SAFE_BRANCH_RE blocks branches with shell metacharacters', () => {
    const SAFE_BRANCH_RE = /^agent\/[a-zA-Z0-9._\-/]+$/;
    const maliciousBranches = [
      'agent/test; touch /tmp/pwned',
      'agent/test && rm -rf /',
      'agent/test|cat /etc/passwd',
      'agent/test`cmd`',
      'agent/test$(cmd)',
      'agent/test\necho injected',
    ];
    for (const branch of maliciousBranches) {
      assert(!SAFE_BRANCH_RE.test(branch), `Expected '${branch.slice(0, 30)}...' to be BLOCKED by regex`);
    }
  });

  await test('SAFE_BRANCH_RE correctly requires agent/ prefix', () => {
    const SAFE_BRANCH_RE = /^agent\/[a-zA-Z0-9._\-/]+$/;
    assert(!SAFE_BRANCH_RE.test('main'), 'main should be rejected');
    assert(!SAFE_BRANCH_RE.test('feature/abc'), 'non-agent branch should be rejected');
    assert(!SAFE_BRANCH_RE.test(''), 'empty string should be rejected');
  });

  // ─── Results Summary ───────────────────────────────────────────────────────

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const vuln = results.filter((r) => !r.passed && r.expectation === 'documents_vulnerability');
  const real = results.filter((r) => !r.passed && r.expectation === 'should_pass');
  const totalTime = results.reduce((sum, r) => sum + r.duration, 0);

  console.log('\n' + '─'.repeat(80));
  console.log(`RESULTS: ${passed} passed, ${failed} failed (${totalTime}ms total)`);

  if (vuln.length > 0) {
    console.log(`\n⚠️  VULNERABILITIES CONFIRMED (${vuln.length}):`);
    console.log(`   These tests FAIL because the Aegis execFile fix is not yet merged.`);
    console.log(`   Merge commit e6930e7 (Aegis worktree) to resolve.\n`);
    vuln.forEach((r) => {
      console.log(`  ✗ [VULNERABLE] ${r.name}`);
      console.log(`    ${r.error}`);
    });
  }

  if (real.length > 0) {
    console.log(`\n❌ UNEXPECTED FAILURES (${real.length}):`);
    real.forEach((r) => {
      console.log(`  ✗ ${r.name}`);
      console.log(`    ${r.error}`);
    });
    process.exit(1);
  }

  if (vuln.length > 0) {
    console.log('\n⚠️  Security regressions detected. Aegis fix must be merged before these pass.');
    process.exit(2); // exit code 2 = security issues (not a test runner failure)
  }

  console.log('✓ All tests passed (including security regression tests)');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('Test suite error:', err);
  process.exit(1);
});
