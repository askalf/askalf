// Test cognitive shards with meaningful inputs
module.paths.unshift('/app/node_modules');

const { Pool } = require('pg');
const vm = require('vm');

const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://substrate:caff003669dce684448cb89002333263a8684242f43db4e2@pgbouncer:5432/substrate' });

// Test cases that exercise real cognitive logic
const testCases = {
  'detect-underconfidence': [
    "I'm not sure, but maybe possibly the answer could be 42, I guess",
    "Sorry if this is wrong, but I think it might be correct, don't quote me",
    "Studies show this is effective, but I'm probably wrong about it",
    "The data clearly indicates X, though what do I know",
    "This is definitely the answer based on the research",  // should NOT detect
    "I believe this is correct given the evidence"  // borderline
  ],
  'overconfidence-bias-detector': [
    "I heard someone say this, so it's definitely always true",
    "Obviously anyone knows this is absolutely certain",
    "In my experience, this will definitely happen, no doubt",
    "Studies suggest this might be the case",  // should NOT detect
    "The evidence indicates this is likely true"  // should NOT detect
  ],
  'Pre-Action Checkpoint': [
    "I'm about to make an API call to delete the user's data",
    "Going to send an email to all customers about the outage",
    "About to deploy the new version to production",
    "Making a payment of $500 to the vendor",
    "Running a simple database query to read data"
  ],
  'Error Handler': [
    "Timeout error occurred again in the API call",
    "Syntax error in the shard logic on line 42",
    "TypeError: cannot read property of null",
    "Network error when connecting to external service",
    "Recurring validation error on user input"
  ],
  'Pattern Detector': [
    "calculate 15 + 27",
    "convert 100 celsius to fahrenheit",
    "reverse the string hello",
    "validate if test@example.com is a valid email",
    "explain how photosynthesis works",
    "reframe this negative thought into a positive perspective"
  ],
  'Model Router': [
    "calculate the factorial of 20",
    "write a creative poem about autumn leaves",
    "debug this JavaScript function that returns undefined",
    "quick, what's 2+2?",
    "step by step, analyze why the Roman Empire fell and explain each factor in detail"
  ],
  'Response Quality Checker': [
    "The answer is 42 because the math shows that when you add 20 and 22, you get 42. Therefore, 42 is correct.",
    "Maybe possibly it could be 42 or something I guess",
    "42",
    "This is definitely absolutely certainly the only correct answer and anyone who disagrees is wrong"
  ],
  'belief-update-response': [
    "I was wrong about X because new evidence shows Y",
    "The data makes me more confident in my original belief",
    "Someone told me something that contradicts what I thought",
    "My experience yesterday changed my view on this"
  ],
  'knowledge-boundary-acknowledgment': [
    "I don't know about quantum physics at that level",
    "My understanding of cultural norms in Japan is limited",
    "I can't predict what will happen in 2050",
    "I haven't experienced what that tastes like"
  ]
};

function exec(logic, input) {
  try {
    const sb = {input, result:undefined, JSON, Object, Array, String, Number, Boolean, Math, parseInt, parseFloat, RegExp, console:{log:()=>{}}};
    vm.runInContext(logic+'\nif(typeof execute==="function"){result=execute(input);}', vm.createContext(sb), {timeout:5000});
    if (sb.result===undefined) return {success:false, error:'undefined result'};
    return {success:true, output:sb.result};
  } catch(e) { return {success:false, error:e.message}; }
}

async function main() {
  console.log('='.repeat(70));
  console.log('COGNITIVE SHARD TESTING');
  console.log('='.repeat(70));

  for (const [shardName, inputs] of Object.entries(testCases)) {
    console.log(`\n${'─'.repeat(70)}`);
    console.log(`Testing: ${shardName}`);
    console.log('─'.repeat(70));

    const {rows} = await pool.query('SELECT id, logic FROM procedural_shards WHERE name = $1 LIMIT 1', [shardName]);
    if (rows.length === 0) {
      console.log('  ⚠ Shard not found');
      continue;
    }

    const shard = rows[0];
    let success = 0, fail = 0;

    for (const input of inputs) {
      const result = exec(shard.logic, input);
      const inputPreview = input.substring(0, 50) + (input.length > 50 ? '...' : '');

      if (result.success) {
        success++;
        await pool.query('UPDATE procedural_shards SET execution_count=execution_count+1, success_count=success_count+1 WHERE id=$1', [shard.id]);

        // Parse and display the cognitive output
        try {
          const output = typeof result.output === 'string' ? JSON.parse(result.output) : result.output;
          console.log(`\n  ✓ Input: "${inputPreview}"`);
          console.log(`    Output: ${JSON.stringify(output, null, 2).split('\n').map((l,i) => i===0 ? l : '    '+l).join('\n')}`);
        } catch {
          console.log(`\n  ✓ Input: "${inputPreview}"`);
          console.log(`    Output: ${result.output}`);
        }
      } else {
        fail++;
        await pool.query('UPDATE procedural_shards SET execution_count=execution_count+1, failure_count=failure_count+1 WHERE id=$1', [shard.id]);
        console.log(`\n  ✗ Input: "${inputPreview}"`);
        console.log(`    Error: ${result.error}`);
      }
    }

    console.log(`\n  Result: ${success}/${inputs.length} passed`);
  }

  // Summary
  console.log('\n' + '='.repeat(70));
  const {rows: summary} = await pool.query(`
    SELECT name, execution_count, success_count,
           ROUND(success_count::numeric/NULLIF(execution_count,0)*100) as rate
    FROM procedural_shards
    WHERE name = ANY($1)
    ORDER BY name
  `, [Object.keys(testCases)]);

  console.log('COGNITIVE SHARD SUMMARY');
  console.log('='.repeat(70));
  for (const row of summary) {
    console.log(`${row.name.padEnd(35)} ${row.execution_count} execs, ${row.rate || 0}% success`);
  }

  await pool.end();
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
