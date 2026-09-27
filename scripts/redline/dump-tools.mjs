// Writes the tools Redline hands the model (TOOLS in review.mjs) to tools.json, where
// truecopy.lock pins them next to prompt.md. The descriptions are what the reviewing model reads
// and acts on, so a change to one has to be regenerated and re-pinned on purpose, and is
// poison-scanned when it is.
//
//   node scripts/redline/dump-tools.mjs           regenerate tools.json
//   node scripts/redline/dump-tools.mjs --check   exit 1 if tools.json no longer matches TOOLS
//
// The entries are written exactly as the Messages API receives them (input_schema, not MCP's
// inputSchema); truecopy scans the whole tool object either way.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TOOLS } from './review.mjs';

const file = fileURLToPath(new URL('./tools.json', import.meta.url));
const tools = TOOLS.slice().sort((a, b) => a.name.localeCompare(b.name));
const rendered = JSON.stringify({ name: 'redline', tools }, null, 2) + '\n';

if (process.argv.includes('--check')) {
  let committed = '';
  try { committed = readFileSync(file, 'utf8').replace(/\r\n/g, '\n'); } catch { /* missing counts as stale */ }
  if (committed !== rendered) {
    console.error('scripts/redline/tools.json is stale: TOOLS in review.mjs changed.');
    console.error('Regenerate with `node scripts/redline/dump-tools.mjs`, review the diff, and re-pin with '
      + '`truecopy add scripts/redline/tools.json`.');
    process.exit(1);
  }
  console.log(`scripts/redline/tools.json matches TOOLS (${tools.length} tools)`);
} else {
  writeFileSync(file, rendered);
  console.log(`wrote scripts/redline/tools.json (${tools.length} tools)`);
}
