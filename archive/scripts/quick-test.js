const { Pool } = require('pg');
const vm = require('vm');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function runShard(logic, input) {
  const code = '(function() { const input = __input__; ' + logic + '; if (typeof execute === "function") { return execute(input); } return null; })()';
  const sandbox = { __input__: input };
  const ctx = vm.createContext(sandbox);
  return vm.runInContext(code, ctx, { timeout: 5000 });
}

async function main() {
  const { rows } = await pool.query("SELECT name, logic FROM procedural_shards WHERE lifecycle = 'promoted' ORDER BY name");
  let pass = 0, fail = 0;
  const errors = [];
  for (const s of rows) {
    try {
      const r = runShard(s.logic, 'test input');
      if (r !== null && r !== undefined && String(r).length > 0) { pass++; }
      else { fail++; errors.push(s.name + ': returned empty/null'); }
    } catch (e) {
      fail++; errors.push(s.name + ': ' + e.message.substring(0, 80));
    }
  }
  console.log('TOTAL: ' + rows.length + ' | PASS: ' + pass + ' | FAIL: ' + fail);
  if (errors.length > 0) {
    console.log('\nFAILURES (' + errors.length + '):');
    errors.forEach(e => console.log('  ' + e));
  }
  await pool.end();
}
main();
