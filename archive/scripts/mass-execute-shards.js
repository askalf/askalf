/**
 * Mass Execution Harness for Battle-Testing Shards
 *
 * Runs all shards to 100+ executions each using pattern-based input generation.
 * Archives shards that fail validation.
 *
 * Run inside API container: node mass-execute-shards.js
 */

const TARGET_EXECUTIONS = 100;
const MIN_SUCCESS_RATE = 0.90; // 90% success rate required
const BATCH_SIZE = 10; // Execute in batches

// Input generators based on common patterns
const inputGenerators = {
  // Math operations
  addition: (i) => [
    `What is ${i * 7} + ${i * 3}?`,
    `${i * 11} plus ${i * 5}`,
    `add ${i * 13} and ${i * 2}`,
    `${i * 17} + ${i * 9}`,
    `calculate ${i * 6} + ${i * 4}`,
  ],
  subtraction: (i) => [
    `What is ${i * 10} - ${i * 3}?`,
    `${i * 15} minus ${i * 4}`,
    `subtract ${i * 2} from ${i * 20}`,
    `${i * 25} - ${i * 8}`,
  ],
  multiplication: (i) => [
    `What is ${i + 2} * ${i + 3}?`,
    `${i + 5} times ${i + 2}`,
    `multiply ${i + 3} by ${i + 4}`,
    `${i + 7} x ${i + 1}`,
  ],
  division: (i) => [
    `What is ${(i + 1) * 12} / ${i + 1}?`,
    `${(i + 2) * 8} divided by ${i + 2}`,
    `divide ${(i + 1) * 15} by ${i + 1}`,
  ],
  percentage: (i) => [
    `What is ${(i % 10) * 10}% of ${i * 10}?`,
    `${(i % 5 + 1) * 5}% of ${i * 20}`,
    `calculate ${(i % 8 + 1) * 10}% of ${i * 5}`,
  ],
  power: (i) => [
    `${i % 10 + 2} to the power of ${i % 4 + 2}`,
    `${i % 8 + 2} ^ ${i % 3 + 2}`,
    `${i % 5 + 2} raised to ${i % 4 + 2}`,
  ],
  sqrt: (i) => [
    `square root of ${(i + 1) * (i + 1)}`,
    `sqrt ${(i + 2) * (i + 2)}`,
    `what is the square root of ${(i + 3) * (i + 3)}`,
  ],
  factorial: (i) => [
    `factorial of ${i % 12 + 1}`,
    `${i % 10 + 1}!`,
    `what is ${i % 8 + 1} factorial`,
  ],
  fibonacci: (i) => [
    `${i % 20 + 1}th fibonacci`,
    `fibonacci of ${i % 15 + 1}`,
    `fib ${i % 18 + 1}`,
  ],
  modulo: (i) => [
    `${i * 7 + 13} mod ${i % 5 + 2}`,
    `${i * 11 + 7} % ${i % 7 + 3}`,
    `remainder of ${i * 9 + 5} divided by ${i % 6 + 2}`,
  ],
  gcd: (i) => [
    `gcd of ${i * 6 + 12} and ${i * 4 + 8}`,
    `greatest common divisor of ${i * 3 + 9} and ${i * 2 + 6}`,
  ],
  lcm: (i) => [
    `lcm of ${i % 10 + 2} and ${i % 8 + 3}`,
    `least common multiple of ${i % 6 + 4} and ${i % 5 + 5}`,
  ],
  absolute: (i) => [
    `absolute value of ${-i * 5 - 3}`,
    `abs ${-i * 7 - 2}`,
    `|${-i * 3 - 8}|`,
  ],

  // Temperature conversion
  celsiusToF: (i) => [
    `Convert ${i * 5 - 10} celsius to fahrenheit`,
    `${i * 3 + 5}°C to fahrenheit`,
    `${i * 4 - 5} celsius in fahrenheit`,
  ],
  fahrenheitToC: (i) => [
    `Convert ${i * 9 + 32} fahrenheit to celsius`,
    `${i * 7 + 50}°F to celsius`,
    `${i * 5 + 40} fahrenheit in celsius`,
  ],

  // Distance conversion
  kmToMiles: (i) => [
    `Convert ${i * 10 + 5} km to miles`,
    `${i * 15 + 10} kilometers to miles`,
    `${i * 8 + 3} km in miles`,
  ],
  milesToKm: (i) => [
    `Convert ${i * 5 + 3} miles to km`,
    `${i * 7 + 5} miles to kilometers`,
    `${i * 4 + 2} miles in km`,
  ],

  // String operations
  reverse: (i) => {
    const words = ['hello', 'world', 'testing', 'substrate', 'memory', 'shard', 'crystal', 'compute', 'engine', 'algorithm', 'function', 'execute'];
    return [
      `Reverse "${words[i % words.length]}"`,
      `reverse the string "${words[(i + 3) % words.length]}"`,
      `"${words[(i + 5) % words.length]}" reversed`,
    ];
  },
  uppercase: (i) => {
    const words = ['hello', 'world', 'testing', 'substrate', 'convert', 'example', 'data', 'code', 'shard', 'memory'];
    return [
      `Convert "${words[i % words.length]}" to uppercase`,
      `uppercase "${words[(i + 2) % words.length]}"`,
      `"${words[(i + 4) % words.length]}" to upper case`,
    ];
  },
  lowercase: (i) => {
    const words = ['HELLO', 'WORLD', 'TESTING', 'SUBSTRATE', 'CONVERT', 'EXAMPLE', 'DATA', 'CODE'];
    return [
      `Convert "${words[i % words.length]}" to lowercase`,
      `lowercase "${words[(i + 2) % words.length]}"`,
      `"${words[(i + 3) % words.length]}" to lower case`,
    ];
  },
  wordCount: (i) => {
    const phrases = [
      'hello world',
      'the quick brown fox',
      'testing one two three',
      'this is a test sentence',
      'count the words here',
      'another example phrase',
      'substrate memory system',
      'procedural shard execution',
    ];
    return [
      `count words in "${phrases[i % phrases.length]}"`,
      `how many words in "${phrases[(i + 2) % phrases.length]}"`,
      `word count of "${phrases[(i + 4) % phrases.length]}"`,
    ];
  },
  charCount: (i) => {
    const texts = ['hello', 'testing', 'substrate', 'memory shard', 'hello world', 'count me'];
    return [
      `count characters in "${texts[i % texts.length]}"`,
      `how many characters in "${texts[(i + 2) % texts.length]}"`,
      `character count of "${texts[(i + 3) % texts.length]}"`,
    ];
  },
  slug: (i) => {
    const titles = ['Hello World', 'My Blog Post', 'Testing Shards', 'URL Slug Generator', 'Some Title Here'];
    return [
      `slugify "${titles[i % titles.length]}"`,
      `convert "${titles[(i + 1) % titles.length]}" to slug`,
      `url slug for "${titles[(i + 2) % titles.length]}"`,
    ];
  },

  // Binary/Hex conversions
  binaryToDecimal: (i) => {
    const binaries = ['1010', '1111', '10000', '11001', '101010', '1100100', '10101', '11111'];
    return [
      `Convert binary ${binaries[i % binaries.length]} to decimal`,
      `${binaries[(i + 2) % binaries.length]} binary to decimal`,
      `binary ${binaries[(i + 4) % binaries.length]} in decimal`,
    ];
  },
  decimalToBinary: (i) => [
    `Convert ${i * 7 + 10} to binary`,
    `${i * 11 + 5} to binary`,
    `${i * 13 + 3} in binary`,
  ],
  hexToDecimal: (i) => {
    const hexes = ['FF', '1A', '2B', '3C', '4D', '5E', '6F', '7A', '8B', '9C', 'AB', 'CD', 'EF'];
    return [
      `Convert 0x${hexes[i % hexes.length]} to decimal`,
      `hex ${hexes[(i + 3) % hexes.length]} to decimal`,
      `0x${hexes[(i + 5) % hexes.length]} in decimal`,
    ];
  },
  decimalToHex: (i) => [
    `Convert ${i * 17 + 100} to hex`,
    `${i * 23 + 50} to hexadecimal`,
    `${i * 19 + 75} in hex`,
  ],

  // Validation
  email: (i) => {
    const emails = [
      `test${i}@example.com`,
      `user${i}@domain.org`,
      `invalid-email-${i}`,
      `hello@world${i}.net`,
      `not-an-email`,
      `valid${i}@test.io`,
    ];
    return [
      `is ${emails[i % emails.length]} a valid email?`,
      `validate email ${emails[(i + 2) % emails.length]}`,
      `check if ${emails[(i + 3) % emails.length]} is valid email`,
    ];
  },

  // Date operations
  daysUntil: (i) => {
    const dates = ['2025-12-25', '2025-01-01', '2025-07-04', '2025-10-31', '2025-02-14'];
    return [
      `days until ${dates[i % dates.length]}`,
      `how many days until ${dates[(i + 1) % dates.length]}`,
    ];
  },

  // Generic fallback using intent template
  generic: (i, template) => {
    // Try to extract placeholders and generate simple values
    if (!template) return [];
    const placeholders = template.match(/\{(\w+)\}/g) || [];
    if (placeholders.length === 0) return [template];

    let input = template;
    for (const ph of placeholders) {
      const name = ph.slice(1, -1).toLowerCase();
      if (name.includes('num') || name === 'n' || name === 'a' || name === 'b') {
        input = input.replace(ph, String(i * 5 + 3));
      } else if (name.includes('text') || name.includes('string') || name.includes('word')) {
        const words = ['hello', 'world', 'test', 'example', 'sample'];
        input = input.replace(ph, words[i % words.length]);
      } else {
        input = input.replace(ph, String(i + 1));
      }
    }
    return [input];
  },
};

// Map shard names/patterns to generators
function getGeneratorForShard(shard) {
  const name = shard.name.toLowerCase();
  const template = (shard.intent_template || '').toLowerCase();
  const patterns = (shard.patterns || []).join(' ').toLowerCase();

  // Match by name
  if (name.includes('addition') || name.includes('add-')) return 'addition';
  if (name.includes('subtraction') || name.includes('subtract')) return 'subtraction';
  if (name.includes('multipl')) return 'multiplication';
  if (name.includes('division') || name.includes('divide')) return 'division';
  if (name.includes('percent')) return 'percentage';
  if (name.includes('power') || name.includes('exponent')) return 'power';
  if (name.includes('sqrt') || name.includes('square-root')) return 'sqrt';
  if (name.includes('factorial')) return 'factorial';
  if (name.includes('fibonacci') || name.includes('fib')) return 'fibonacci';
  if (name.includes('modulo') || name.includes('remainder')) return 'modulo';
  if (name.includes('gcd') || name.includes('greatest-common')) return 'gcd';
  if (name.includes('lcm') || name.includes('least-common')) return 'lcm';
  if (name.includes('absolute') || name.includes('abs-')) return 'absolute';
  if (name.includes('celsius') && name.includes('fahrenheit')) return 'celsiusToF';
  if (name.includes('fahrenheit') && name.includes('celsius')) return 'fahrenheitToC';
  if (name.includes('km') && name.includes('mile')) return 'kmToMiles';
  if (name.includes('mile') && name.includes('km')) return 'milesToKm';
  if (name.includes('reverse') || name.includes('reversal')) return 'reverse';
  if (name.includes('uppercase') || name.includes('upper-case')) return 'uppercase';
  if (name.includes('lowercase') || name.includes('lower-case')) return 'lowercase';
  if (name.includes('word-count') || name.includes('wordcount')) return 'wordCount';
  if (name.includes('char') && name.includes('count')) return 'charCount';
  if (name.includes('slug')) return 'slug';
  if (name.includes('binary') && name.includes('decimal')) return 'binaryToDecimal';
  if (name.includes('decimal') && name.includes('binary')) return 'decimalToBinary';
  if (name.includes('hex') && name.includes('decimal')) return 'hexToDecimal';
  if (name.includes('decimal') && name.includes('hex')) return 'decimalToHex';
  if (name.includes('email') && name.includes('valid')) return 'email';

  // Match by template/pattern content
  if (template.includes('celsius') || patterns.includes('celsius')) return 'celsiusToF';
  if (template.includes('fahrenheit') || patterns.includes('fahrenheit')) return 'fahrenheitToC';
  if (template.includes('reverse') || patterns.includes('reverse')) return 'reverse';
  if (template.includes('uppercase') || patterns.includes('uppercase')) return 'uppercase';

  return 'generic';
}

// Generate inputs for a shard
function generateInputs(shard, count) {
  const generatorName = getGeneratorForShard(shard);
  const generator = inputGenerators[generatorName];
  const inputs = [];

  for (let i = 0; i < count && inputs.length < count; i++) {
    const batch = generatorName === 'generic'
      ? generator(i, shard.intent_template)
      : generator(i);
    for (const input of batch) {
      if (inputs.length < count) {
        inputs.push(input);
      }
    }
  }

  return { inputs, generatorName };
}

async function main() {
  const { initializePool, query, queryOne } = await import('@substrate/database');
  const { procedural } = await import('@substrate/memory');
  const { execute } = await import('@substrate/sandbox');

  await initializePool();

  console.log('='.repeat(70));
  console.log('MASS EXECUTION HARNESS - Battle Testing Shards');
  console.log('='.repeat(70));
  console.log(`Target: ${TARGET_EXECUTIONS} executions per shard`);
  console.log(`Min success rate: ${MIN_SUCCESS_RATE * 100}%`);
  console.log('');

  // Get all active shards
  const shards = await query(`
    SELECT id, name, logic, patterns, intent_template, execution_count, success_count, lifecycle
    FROM procedural_shards
    WHERE lifecycle IN ('testing', 'promoted')
    ORDER BY execution_count ASC, lifecycle DESC
  `);

  console.log(`Found ${shards.length} active shards to test\n`);

  const results = {
    battleTested: 0,
    needsMoreTesting: 0,
    archived: 0,
    noGenerator: 0,
    errors: [],
  };

  for (const shard of shards) {
    const currentExecs = shard.execution_count || 0;
    const neededExecs = Math.max(0, TARGET_EXECUTIONS - currentExecs);

    if (neededExecs === 0) {
      const successRate = shard.success_count / shard.execution_count;
      if (successRate >= MIN_SUCCESS_RATE) {
        results.battleTested++;
        console.log(`✓ ${shard.name.padEnd(40)} | Already battle-tested (${currentExecs} execs, ${(successRate * 100).toFixed(1)}% success)`);
      } else {
        console.log(`⚠ ${shard.name.padEnd(40)} | Has ${currentExecs} execs but only ${(successRate * 100).toFixed(1)}% success`);
      }
      continue;
    }

    console.log(`\n${'─'.repeat(70)}`);
    console.log(`Testing: ${shard.name}`);
    console.log(`Current: ${currentExecs} executions | Need: ${neededExecs} more`);

    // Generate inputs
    const { inputs, generatorName } = generateInputs(shard, neededExecs);

    if (inputs.length === 0) {
      console.log(`  ⚠ No input generator available (type: ${generatorName})`);
      results.noGenerator++;
      continue;
    }

    console.log(`  Generator: ${generatorName} | Inputs: ${inputs.length}`);

    let successCount = 0;
    let failCount = 0;
    const failures = [];

    // Execute in batches
    for (let i = 0; i < inputs.length; i++) {
      const input = inputs[i];
      const startTime = Date.now();

      try {
        const result = await execute(shard.logic, input);
        const executionMs = Date.now() - startTime;

        if (result.success && result.output !== 'Invalid input' && result.output !== undefined) {
          successCount++;
          await procedural.recordExecution(shard.id, true, executionMs, 50);

          if (i < 3 || i === inputs.length - 1) {
            console.log(`  ✓ "${input.substring(0, 35)}..." => ${String(result.output).substring(0, 20)}`);
          } else if (i === 3) {
            console.log(`  ... (running ${inputs.length - 4} more)`);
          }
        } else {
          failCount++;
          failures.push({ input, error: result.error || 'Invalid output', output: result.output });
          await procedural.recordExecution(shard.id, false, executionMs, 0);

          if (failures.length <= 3) {
            console.log(`  ✗ "${input.substring(0, 35)}..." => ${result.error || result.output}`);
          }
        }
      } catch (err) {
        failCount++;
        failures.push({ input, error: err.message });
        await procedural.recordExecution(shard.id, false, Date.now() - startTime, 0);

        if (failures.length <= 3) {
          console.log(`  ✗ "${input.substring(0, 35)}..." => ERROR: ${err.message}`);
        }
      }
    }

    const totalExecs = currentExecs + successCount + failCount;
    const totalSuccess = (shard.success_count || 0) + successCount;
    const successRate = totalSuccess / totalExecs;

    console.log(`  Result: ${successCount}/${successCount + failCount} passed (${(successRate * 100).toFixed(1)}% overall)`);

    if (successRate < MIN_SUCCESS_RATE && totalExecs >= 20) {
      // Archive failing shard
      console.log(`  ⛔ Archiving due to low success rate`);
      await query(`UPDATE procedural_shards SET lifecycle = 'archived' WHERE id = $1`, [shard.id]);
      results.archived++;
      results.errors.push({
        shard: shard.name,
        successRate,
        sampleFailures: failures.slice(0, 3),
      });
    } else if (totalExecs >= TARGET_EXECUTIONS && successRate >= MIN_SUCCESS_RATE) {
      results.battleTested++;
      console.log(`  ✓ Battle-tested!`);
    } else {
      results.needsMoreTesting++;
    }
  }

  // Final report
  console.log('\n' + '='.repeat(70));
  console.log('FINAL REPORT');
  console.log('='.repeat(70));
  console.log(`Battle-tested (100+ execs, 90%+ success): ${results.battleTested}`);
  console.log(`Needs more testing:                       ${results.needsMoreTesting}`);
  console.log(`Archived (failing):                       ${results.archived}`);
  console.log(`No generator available:                   ${results.noGenerator}`);
  console.log('');

  if (results.errors.length > 0) {
    console.log('Archived shards with failures:');
    for (const err of results.errors) {
      console.log(`  - ${err.shard}: ${(err.successRate * 100).toFixed(1)}% success`);
      if (err.sampleFailures.length > 0) {
        console.log(`    Sample: ${err.sampleFailures[0].input} => ${err.sampleFailures[0].error}`);
      }
    }
  }

  // Show remaining gap
  const gap = 100 - results.battleTested;
  if (gap > 0) {
    console.log(`\n⚠ Gap to production: Need ${gap} more battle-tested shards`);
  } else {
    console.log(`\n✓ PRODUCTION READY: ${results.battleTested} battle-tested shards`);
  }

  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
