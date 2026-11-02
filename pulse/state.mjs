// The last run's state, kept between scheduled runs as <out>/state.json.
import * as nodeFs from 'node:fs';

// Read in one call, with no separate existence check: a missing file (the first run) is an
// empty state; malformed JSON and any other read failure are thrown to the caller.
export function readState(path, fs = nodeFs) {
  try {
    return JSON.parse(fs.readFileSync(path, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw e;
  }
}
