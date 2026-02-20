/**
 * Mass Execution Harness for Battle-Testing Shards (CommonJS version)
 * Run inside API container from /app: node /dev/shm/mass-exec.cjs
 */

const TARGET_EXECUTIONS = 100;
const MIN_SUCCESS_RATE = 0.90;

const inputGenerators = {
  addition: (i) => [
    `What is ${i * 7} + ${i * 3}?`,
    `${i * 11} plus ${i * 5}`,
    `add ${i * 13} and ${i * 2}`,
    `${i * 17} + ${i * 9}`,
  ],
  subtraction: (i) => [
    `What is ${i * 10} - ${i * 3}?`,
    `${i * 15} minus ${i * 4}`,
    `subtract ${i * 2} from ${i * 20}`,
  ],
  multiplication: (i) => [
    `What is ${i + 2} * ${i + 3}?`,
    `${i + 5} times ${i + 2}`,
    `multiply ${i + 3} by ${i + 4}`,
  ],
  division: (i) => [
    `What is ${(i + 1) * 12} / ${i + 1}?`,
    `${(i + 2) * 8} divided by ${i + 2}`,
  ],
  percentage: (i) => [
    `What is ${(i % 10) * 10}% of ${i * 10}?`,
    `${(i % 5 + 1) * 5}% of ${i * 20}`,
  ],
  power: (i) => [
    `${i % 10 + 2} to the power of ${i % 4 + 2}`,
    `${i % 8 + 2} ^ ${i % 3 + 2}`,
  ],
  sqrt: (i) => [
    `square root of ${(i + 1) * (i + 1)}`,
    `sqrt ${(i + 2) * (i + 2)}`,
  ],
  factorial: (i) => [
    `factorial of ${i % 12 + 1}`,
    `${i % 10 + 1}!`,
  ],
  fibonacci: (i) => [
    `${i % 20 + 1}th fibonacci`,
    `fibonacci of ${i % 15 + 1}`,
  ],
  modulo: (i) => [
    `${i * 7 + 13} mod ${i % 5 + 2}`,
    `${i * 11 + 7} % ${i % 7 + 3}`,
  ],
  gcd: (i) => [`gcd of ${i * 6 + 12} and ${i * 4 + 8}`],
  lcm: (i) => [`lcm of ${i % 10 + 2} and ${i % 8 + 3}`],
  absolute: (i) => [`absolute value of ${-i * 5 - 3}`, `abs ${-i * 7 - 2}`],
  celsiusToF: (i) => [
    `Convert ${i * 5 - 10} celsius to fahrenheit`,
    `${i * 3 + 5}°C to fahrenheit`,
  ],
  fahrenheitToC: (i) => [
    `Convert ${i * 9 + 32} fahrenheit to celsius`,
    `${i * 7 + 50}°F to celsius`,
  ],
  kmToMiles: (i) => [`Convert ${i * 10 + 5} km to miles`, `${i * 15 + 10} kilometers to miles`],
  milesToKm: (i) => [`Convert ${i * 5 + 3} miles to km`],
  reverse: (i) => {
    const words = ['hello', 'world', 'testing', 'substrate', 'memory', 'shard', 'crystal', 'compute', 'engine', 'algorithm'];
    return [`Reverse "${words[i % words.length]}"`, `reverse the string "${words[(i + 3) % words.length]}"`];
  },
  uppercase: (i) => {
    const words = ['hello', 'world', 'testing', 'substrate', 'convert', 'example', 'data', 'code'];
    return [`Convert "${words[i % words.length]}" to uppercase`, `uppercase "${words[(i + 2) % words.length]}"`];
  },
  lowercase: (i) => {
    const words = ['HELLO', 'WORLD', 'TESTING', 'SUBSTRATE', 'CONVERT'];
    return [`Convert "${words[i % words.length]}" to lowercase`];
  },
  wordCount: (i) => {
    const phrases = ['hello world', 'the quick brown fox', 'testing one two three', 'this is a test'];
    return [`count words in "${phrases[i % phrases.length]}"`];
  },
  charCount: (i) => {
    const texts = ['hello', 'testing', 'substrate', 'memory shard'];
    return [`count characters in "${texts[i % texts.length]}"`];
  },
  slug: (i) => {
    const titles = ['Hello World', 'My Blog Post', 'Testing Shards'];
    return [`slugify "${titles[i % titles.length]}"`];
  },
  binaryToDecimal: (i) => {
    const binaries = ['1010', '1111', '10000', '11001', '101010', '1100100'];
    return [`Convert binary ${binaries[i % binaries.length]} to decimal`];
  },
  decimalToBinary: (i) => [`Convert ${i * 7 + 10} to binary`],
  hexToDecimal: (i) => {
    const hexes = ['FF', '1A', '2B', '3C', '4D', '5E'];
    return [`Convert 0x${hexes[i % hexes.length]} to decimal`];
  },
  decimalToHex: (i) => [`Convert ${i * 17 + 100} to hex`],
  email: (i) => [`is test${i}@example.com a valid email?`, `validate email invalid-email-${i}`],
  capitalize: (i) => {
    const texts = ['hello world', 'testing substrate', 'the quick brown fox'];
    return [`capitalize "${texts[i % texts.length]}"`];
  },
  trim: (i) => [`trim "  hello world  "`, `strip "   testing   "`],
  extractNumbers: (i) => [`extract numbers from "order 123 has 45 items"`],
  countVowels: (i) => {
    const words = ['hello', 'testing', 'algorithm', 'substrate'];
    return [`count vowels in "${words[i % words.length]}"`];
  },
  palindrome: (i) => {
    const words = ['racecar', 'hello', 'madam', 'world', 'level'];
    return [`is "${words[i % words.length]}" a palindrome`];
  },
  prime: (i) => [`is ${i * 7 + 3} prime`, `is ${i * 11 + 2} prime`],
  evenOdd: (i) => [`is ${i * 5 + 1} even or odd`, `is ${i * 3 + 2} even`],
  base64Encode: (i) => {
    const texts = ['hello', 'world', 'testing'];
    return [`base64 encode "${texts[i % texts.length]}"`];
  },
  base64Decode: (i) => {
    const encoded = ['aGVsbG8=', 'd29ybGQ=', 'dGVzdGluZw=='];
    return [`base64 decode "${encoded[i % encoded.length]}"`];
  },
  urlEncode: (i) => [`url encode "hello world"`, `url encode "test?param=value"`],
  urlDecode: (i) => [`url decode "hello%20world"`, `url decode "test%3Fparam%3Dvalue"`],
  sortList: (i) => [`sort 5, 2, 8, 1, 9`, `sort 3, 7, 1, 4, 2`],
  max: (i) => [`max of 5, 2, 8, 1, 9`, `maximum in 3, 7, 1, 4, 2`],
  min: (i) => [`min of 5, 2, 8, 1, 9`, `minimum in 3, 7, 1, 4, 2`],
  average: (i) => [`average of 10, 20, 30, 40, 50`, `mean of 5, 10, 15`],
  sum: (i) => [`sum of 1, 2, 3, 4, 5`, `total of 10, 20, 30`],
  countItems: (i) => [`count items in 1, 2, 3, 4, 5, 6`, `how many elements in 1, 2, 3`],
  unique: (i) => [`unique values in 1, 2, 2, 3, 3, 3`, `dedupe 5, 5, 3, 3, 1`],
  extractEmail: (i) => [`extract email from "Contact us at test@example.com"`],
  extractUrl: (i) => [`extract url from "Visit https://example.com for more"`],
  random: (i) => [`random number between 1 and 100`, `random number between ${i} and ${i + 50}`],
  round: (i) => [`round 3.14159 to 2`, `round ${i}.${i * 7} to 1`],
  distance: (i) => [`distance between (0, 0) and (3, 4)`, `distance between (${i}, 0) and (0, ${i})`],
  bmi: (i) => [`bmi for ${60 + i}kg 1.${70 + i % 20}m`, `calculate bmi ${65 + i}kg ${165 + i}cm`],
  generic: (i, template) => {
    if (!template) return [];
    let input = template;
    const placeholders = template.match(/\{(\w+)\}/g) || [];
    for (const ph of placeholders) {
      const name = ph.slice(1, -1).toLowerCase();
      if (name.includes('num') || name === 'n' || name === 'a' || name === 'b') {
        input = input.replace(ph, String(i * 5 + 3));
      } else {
        input = input.replace(ph, 'test' + i);
      }
    }
    return [input];
  },
};

function getGeneratorForShard(shard) {
  const name = shard.name.toLowerCase();
  const template = (shard.intent_template || '').toLowerCase();

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
  if (name.includes('gcd')) return 'gcd';
  if (name.includes('lcm')) return 'lcm';
  if (name.includes('absolute') || name.includes('abs-')) return 'absolute';
  if (name.includes('celsius') && (name.includes('fahrenheit') || template.includes('fahrenheit'))) return 'celsiusToF';
  if (name.includes('fahrenheit') && (name.includes('celsius') || template.includes('celsius'))) return 'fahrenheitToC';
  if (name.includes('km') && name.includes('mile')) return 'kmToMiles';
  if (name.includes('mile') && name.includes('km')) return 'milesToKm';
  if (name.includes('reverse') || name.includes('reversal')) return 'reverse';
  if (name.includes('uppercase')) return 'uppercase';
  if (name.includes('lowercase')) return 'lowercase';
  if (name.includes('word-count') || name.includes('wordcount')) return 'wordCount';
  if (name.includes('char') && name.includes('count')) return 'charCount';
  if (name.includes('slug')) return 'slug';
  if (name.includes('binary') && name.includes('decimal')) return 'binaryToDecimal';
  if (name.includes('decimal') && name.includes('binary')) return 'decimalToBinary';
  if ((name.includes('hex') || name.includes('hexadecimal')) && name.includes('decimal')) return 'hexToDecimal';
  if (name.includes('decimal') && (name.includes('hex') || name.includes('hexadecimal'))) return 'decimalToHex';
  if (name.includes('email') && name.includes('valid')) return 'email';
  if (name.includes('capitalize')) return 'capitalize';
  if (name.includes('trim')) return 'trim';
  if (name.includes('extract') && name.includes('number')) return 'extractNumbers';
  if (name.includes('vowel')) return 'countVowels';
  if (name.includes('palindrome')) return 'palindrome';
  if (name.includes('prime')) return 'prime';
  if (name.includes('even') || name.includes('odd')) return 'evenOdd';
  if (name.includes('base64') && name.includes('encode')) return 'base64Encode';
  if (name.includes('base64') && name.includes('decode')) return 'base64Decode';
  if (name.includes('url') && name.includes('encode')) return 'urlEncode';
  if (name.includes('url') && name.includes('decode')) return 'urlDecode';
  if (name.includes('sort')) return 'sortList';
  if (name.includes('max') || name.includes('maximum')) return 'max';
  if (name.includes('min') && !name.includes('admin')) return 'min';
  if (name.includes('average') || name.includes('avg') || name.includes('mean')) return 'average';
  if (name.includes('sum') && !name.includes('consumer')) return 'sum';
  if (name.includes('count') && name.includes('list')) return 'countItems';
  if (name.includes('unique') || name.includes('dedupe')) return 'unique';
  if (name.includes('extract') && name.includes('email')) return 'extractEmail';
  if (name.includes('extract') && name.includes('url')) return 'extractUrl';
  if (name.includes('random')) return 'random';
  if (name.includes('round')) return 'round';
  if (name.includes('distance')) return 'distance';
  if (name.includes('bmi')) return 'bmi';

  return 'generic';
}

function generateInputs(shard, count) {
  const generatorName = getGeneratorForShard(shard);
  const generator = inputGenerators[generatorName];
  const inputs = [];

  for (let i = 0; i < count * 2 && inputs.length < count; i++) {
    const batch = generatorName === 'generic'
      ? generator(i, shard.intent_template)
      : generator(i);
    for (const input of batch) {
      if (inputs.length < count && input) {
        inputs.push(input);
      }
    }
  }

  return { inputs, generatorName };
}

async function main() {
  // Import using dynamic import for ESM modules
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
  };

  for (const shard of shards) {
    const currentExecs = shard.execution_count || 0;
    const neededExecs = Math.max(0, TARGET_EXECUTIONS - currentExecs);

    if (neededExecs === 0) {
      const successRate = shard.success_count / shard.execution_count;
      if (successRate >= MIN_SUCCESS_RATE) {
        results.battleTested++;
        console.log(`✓ ${shard.name.substring(0, 35).padEnd(35)} | Battle-tested (${currentExecs} execs, ${(successRate * 100).toFixed(0)}%)`);
      }
      continue;
    }

    console.log(`\n─ Testing: ${shard.name} (need ${neededExecs} more execs)`);

    const { inputs, generatorName } = generateInputs(shard, neededExecs);

    if (inputs.length === 0) {
      console.log(`  ⚠ No generator for: ${generatorName}`);
      results.noGenerator++;
      continue;
    }

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < inputs.length; i++) {
      const input = inputs[i];
      const startTime = Date.now();

      try {
        const result = await execute(shard.logic, input);
        const executionMs = Date.now() - startTime;

        if (result.success && result.output !== 'Invalid input' && result.output !== undefined) {
          successCount++;
          await procedural.recordExecution(shard.id, true, executionMs, 50);
          if (i < 2) console.log(`  ✓ "${input.substring(0, 30)}..." => ${String(result.output).substring(0, 15)}`);
        } else {
          failCount++;
          await procedural.recordExecution(shard.id, false, executionMs, 0);
          if (failCount <= 2) console.log(`  ✗ "${input.substring(0, 30)}..." => ${result.error || result.output}`);
        }
      } catch (err) {
        failCount++;
        await procedural.recordExecution(shard.id, false, Date.now() - startTime, 0);
        if (failCount <= 2) console.log(`  ✗ ERROR: ${err.message}`);
      }
    }

    const totalExecs = currentExecs + successCount + failCount;
    const totalSuccess = (shard.success_count || 0) + successCount;
    const successRate = totalSuccess / totalExecs;

    console.log(`  Result: ${successCount}/${inputs.length} passed (${(successRate * 100).toFixed(0)}% overall)`);

    if (successRate < MIN_SUCCESS_RATE && totalExecs >= 20) {
      console.log(`  ⛔ Archiving due to low success rate`);
      await query(`UPDATE procedural_shards SET lifecycle = 'archived' WHERE id = $1`, [shard.id]);
      results.archived++;
    } else if (totalExecs >= TARGET_EXECUTIONS && successRate >= MIN_SUCCESS_RATE) {
      results.battleTested++;
    } else {
      results.needsMoreTesting++;
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log('FINAL REPORT');
  console.log('='.repeat(70));
  console.log(`Battle-tested (100+ execs, 90%+ success): ${results.battleTested}`);
  console.log(`Needs more testing:                       ${results.needsMoreTesting}`);
  console.log(`Archived (failing):                       ${results.archived}`);
  console.log(`No generator available:                   ${results.noGenerator}`);

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
