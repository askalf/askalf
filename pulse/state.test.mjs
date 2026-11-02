// node --test pulse/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readState } from './state.mjs';

const scratch = () => mkdtempSync(join(tmpdir(), 'pulse-state-'));
const fsError = (code) => Object.assign(new Error(code), { code });

test('state reads the previous run from valid JSON', (t) => {
  const dir = scratch();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'state.json');
  writeFileSync(path, JSON.stringify({ lastEventId: '30', sources: { events: 'live' } }));
  assert.deepEqual(readState(path), { lastEventId: '30', sources: { events: 'live' } });
});

test('a missing state file is the first run: an empty state', (t) => {
  const dir = scratch();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.deepEqual(readState(join(dir, 'state.json')), {});
});

test('malformed state JSON is thrown, not read as a first run', (t) => {
  const dir = scratch();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'state.json');
  writeFileSync(path, '{"lastEventId": ');
  assert.throws(() => readState(path), SyntaxError);
});

test('a read failure other than a missing file is thrown', (t) => {
  const dir = scratch();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'state.json');
  mkdirSync(path);
  assert.throws(() => readState(path), (e) => e.code === 'EISDIR');
  const denied = { readFileSync: () => { throw fsError('EACCES'); } };
  assert.throws(() => readState(path, denied), (e) => e.code === 'EACCES');
});

test('state is read in one call with no existence probe', () => {
  const calls = [];
  const probe = (name) => () => { calls.push(name); throw new Error(`${name} must not be called`); };
  const fs = {
    existsSync: probe('existsSync'),
    statSync: probe('statSync'),
    accessSync: probe('accessSync'),
    readFileSync: (path, enc) => { calls.push(`readFileSync ${path} ${enc}`); throw fsError('ENOENT'); },
  };
  assert.deepEqual(readState('/out/state.json', fs), {});
  assert.deepEqual(calls, ['readFileSync /out/state.json utf8']);

  calls.length = 0;
  fs.readFileSync = (path, enc) => { calls.push(`readFileSync ${path} ${enc}`); return '{"a":1}'; };
  assert.deepEqual(readState('/out/state.json', fs), { a: 1 });
  assert.deepEqual(calls, ['readFileSync /out/state.json utf8']);
});
