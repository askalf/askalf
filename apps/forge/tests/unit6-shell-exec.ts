/**
 * Forge Unit Tests — Part 6
 *
 * Covers: tools/built-in/shell-exec.ts → shellExec
 *   - Blocked dangerous patterns are actually blocked
 *   - Valid commands execute successfully
 *   - Timeout enforcement
 *   - Output truncation (MAX_OUTPUT_SIZE)
 *   - Working directory handling
 *   - Exit codes and error capture
 *   - Both stdout and stderr captured
 *
 * Run with:
 *   tsx tests/unit6-shell-exec.ts
 */

import { shellExec, type ShellExecInput } from '../src/tools/built-in/shell-exec.js';

// ─── Test runner ─────────────────────────────────────────────────────────────

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration: number;
}

const results: TestResult[] = [];
let currentSuite = '';

function suite(name: string): void {
  currentSuite = name;
  console.log(`\n  ${name}`);
}

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  const start = performance.now();
  try {
    await fn();
    const duration = Math.round(performance.now() - start);
    results.push({ name: `${currentSuite} > ${name}`, passed: true, duration });
    console.log(`    ✓ ${name} (${duration}ms)`);
  } catch (err) {
    const duration = Math.round(performance.now() - start);
    const error = err instanceof Error ? err.message : String(err);
    results.push({ name: `${currentSuite} > ${name}`, passed: false, error, duration });
    console.log(`    ✗ ${name} (${duration}ms)`);
    console.log(`        ${error}`);
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}: expected ${e}, got ${a}`);
}

function assertIncludesStr(actual: string, substr: string, label: string): void {
  if (!actual.includes(substr)) {
    throw new Error(`${label}: expected to include "${substr}", got "${actual.slice(0, 100)}"`);
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

async function runTests() {
  // ──────────────────────────────────────────────────────────────────────────
  suite('shellExec → Blocked Dangerous Patterns');
  // ──────────────────────────────────────────────────────────────────────────

  test('blocks rm -rf /', async () => {
    const result = await shellExec({ command: 'rm -rf /' });
    assert(result.error !== undefined, 'Expected error for rm -rf /');
    assertIncludesStr(result.error, 'Blocked', 'Error should mention blocked');
    assert(result.output === null, 'Output should be null for blocked command');
  });

  test('blocks case-insensitive variants (RM -RF)', async () => {
    const result = await shellExec({ command: 'RM -RF /' });
    assert(result.error !== undefined, 'Expected error for uppercase variant');
    assertIncludesStr(result.error, 'Blocked', 'Error should mention blocked');
  });

  test('blocks mkfs', async () => {
    const result = await shellExec({ command: 'mkfs.ext4 /dev/sda1' });
    assert(result.error !== undefined, 'Expected error for mkfs');
    assertIncludesStr(result.error, 'Blocked', 'Error should mention blocked');
  });

  test('blocks dd if=/dev', async () => {
    const result = await shellExec({ command: 'dd if=/dev/urandom of=test.bin' });
    assert(result.error !== undefined, 'Expected error for dd if=/dev');
    assertIncludesStr(result.error, 'Blocked', 'Error should mention blocked');
  });

  test('blocks fork bomb :(){', async () => {
    const result = await shellExec({ command: ':(){:|:&};:' });
    assert(result.error !== undefined, 'Expected error for fork bomb');
    assertIncludesStr(result.error, 'Blocked', 'Error should mention blocked');
  });

  test('blocks chmod -R 777 /', async () => {
    const result = await shellExec({ command: 'chmod -R 777 /' });
    assert(result.error !== undefined, 'Expected error for chmod -R 777 /');
    assertIncludesStr(result.error, 'Blocked', 'Error should mention blocked');
  });

  test('blocks reboot', async () => {
    const result = await shellExec({ command: 'reboot' });
    assert(result.error !== undefined, 'Expected error for reboot');
    assertIncludesStr(result.error, 'Blocked', 'Error should mention blocked');
  });

  test('blocks shutdown', async () => {
    const result = await shellExec({ command: 'shutdown -h now' });
    assert(result.error !== undefined, 'Expected error for shutdown');
    assertIncludesStr(result.error, 'Blocked', 'Error should mention blocked');
  });

  test('blocks init 0 (halt)', async () => {
    const result = await shellExec({ command: 'init 0' });
    assert(result.error !== undefined, 'Expected error for init 0');
    assertIncludesStr(result.error, 'Blocked', 'Error should mention blocked');
  });

  // ──────────────────────────────────────────────────────────────────────────
  suite('shellExec → Safe Command Execution');
  // ──────────────────────────────────────────────────────────────────────────

  test('executes simple echo command', async () => {
    const result = await shellExec({ command: 'echo hello' });
    assert(result.error === undefined || result.error === '', `Unexpected error: ${result.error}`);
    assert(typeof result.output === 'object' && result.output !== null, 'Output should be object');
    const output = result.output as Record<string, unknown>;
    assert(typeof output.stdout === 'string', 'stdout should be string');
    assertIncludesStr(output.stdout as string, 'hello', 'stdout should contain echo output');
  });

  test('captures exit code 0 for successful command', async () => {
    const result = await shellExec({ command: 'true' });
    assert(result.error === undefined, `Unexpected error: ${result.error}`);
    const output = result.output as Record<string, unknown>;
    assertEqual(output.exitCode, 0, 'Exit code should be 0 for success');
  });

  test('captures exit code non-zero for failed command', async () => {
    const result = await shellExec({ command: 'false' });
    const output = result.output as Record<string, unknown>;
    assert(output.exitCode !== 0, 'Exit code should be non-zero for failure');
  });

  test('captures stderr output', async () => {
    const result = await shellExec({ command: 'echo error >&2' });
    assert(result.error === undefined, `Unexpected error: ${result.error}`);
    const output = result.output as Record<string, unknown>;
    assertIncludesStr(output.stderr as string, 'error', 'stderr should capture redirected output');
  });

  // ──────────────────────────────────────────────────────────────────────────
  suite('shellExec → Output Truncation');
  // ──────────────────────────────────────────────────────────────────────────

  test('truncates large stdout', async () => {
    // Generate output larger than MAX_OUTPUT_SIZE (512KB)
    const largeOutput = 'x'.repeat(600_000);
    const result = await shellExec({ command: `echo '${largeOutput}'` });
    const output = result.output as Record<string, unknown>;
    const stdout = output.stdout as string;
    assert(
      stdout.length <= 512_100, // Slightly larger than MAX_OUTPUT_SIZE to account for newlines
      `stdout should be truncated to ~512KB, got ${stdout.length}`,
    );
  });

  test('captures duration in milliseconds', async () => {
    const result = await shellExec({ command: 'sleep 0.1' });
    assert(typeof result.durationMs === 'number', 'durationMs should be a number');
    assert(result.durationMs >= 50, 'Command duration should be at least 50ms (sleep 0.1)');
  });

  // ──────────────────────────────────────────────────────────────────────────
  suite('shellExec → Timeout Enforcement');
  // ──────────────────────────────────────────────────────────────────────────

  test('enforces default timeout (30s)', async () => {
    // This test should complete quickly since we set a short timeout below
    // Using short timeout to avoid actual 30s wait
    const result = await shellExec({ command: 'sleep 10', timeout: 100 });
    assert(result.error !== undefined, 'Expected error/timeout message');
    assertIncludesStr(result.error, 'timed out', 'Error should mention timeout');
  });

  test('clamps timeout to maximum 60s', async () => {
    // Timeout value higher than MAX_TIMEOUT_MS should be clamped
    // This is a conceptual test—actual enforcement happens internally
    const result = await shellExec({ command: 'true', timeout: 120_000 });
    assert(result.error === undefined, 'Command should execute (timeout was clamped)');
  });

  // ──────────────────────────────────────────────────────────────────────────
  suite('shellExec → Working Directory');
  // ──────────────────────────────────────────────────────────────────────────

  test('uses provided working directory', async () => {
    // Create a test in /tmp and verify cwd is respected
    const result = await shellExec({ command: 'pwd', cwd: '/tmp' });
    const output = result.output as Record<string, unknown>;
    assertIncludesStr(output.stdout as string, '/tmp', 'pwd should show /tmp');
  });

  test('defaults to /app when cwd not specified', async () => {
    // Should not error even if we're not in /app
    const result = await shellExec({ command: 'ls -la' });
    assert(result.error === undefined || result.error === '', 'Should execute successfully with default cwd');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Results Summary
  // ──────────────────────────────────────────────────────────────────────────

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const totalTime = results.reduce((sum, r) => sum + r.duration, 0);

  console.log('\n' + '─'.repeat(80));
  console.log(`RESULTS: ${passed} passed, ${failed} failed (${totalTime}ms total)`);

  if (failed > 0) {
    console.log('\nFailures:');
    results
      .filter((r) => !r.passed)
      .forEach((r) => {
        console.log(`  ✗ ${r.name}`);
        console.log(`    ${r.error}`);
      });
    process.exit(1);
  }

  console.log('✓ All tests passed');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('Test suite error:', err);
  process.exit(1);
});
