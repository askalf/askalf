const { Pool } = require('pg');
const vm = require('vm');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL environment variable is required');
  process.exit(1);
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Test cases: shard_name -> array of { input, expect } or { input, contains } or { input, type }
const TEST_CASES = {
  // ═══════════════════════════════════════════════════
  // NEW DEMO SHARDS (51)
  // ═══════════════════════════════════════════════════

  // ── Math Constants ──
  'pi-value': [
    { input: 'what is pi', contains: '3.14159' },
    { input: 'value of pi', contains: '3.14159' },
  ],
  'euler-number': [
    { input: "what is euler's number", contains: '2.718' },
  ],
  'golden-ratio': [
    { input: 'what is the golden ratio', contains: '1.618' },
  ],
  'speed-of-light': [
    { input: 'speed of light', contains: '299' },
  ],
  'absolute-zero-temperature': [
    { input: 'what is absolute zero', contains: '-273' },
  ],
  'speed-of-sound': [
    { input: 'speed of sound', contains: '343' },
  ],
  'avogadro-number': [
    { input: "what is avogadro's number", contains: '6.022' },
  ],

  // ── Earth & Space ──
  'earth-diameter': [
    { input: 'diameter of earth', contains: '12' },
  ],
  'earth-age': [
    { input: 'how old is earth', contains: '4.5' },
  ],
  'distance-to-moon': [
    { input: 'how far is the moon', contains: '384' },
  ],
  'distance-to-sun': [
    { input: 'how far is the sun', contains: '149' },
  ],
  'planets-in-solar-system': [
    { input: 'how many planets in solar system', contains: '8' },
  ],
  'largest-planet': [
    { input: 'what is the largest planet', contains: 'Jupiter' },
  ],
  'tallest-mountain': [
    { input: 'tallest mountain in the world', contains: 'Everest' },
  ],
  'deepest-ocean-point': [
    { input: 'deepest point in the ocean', contains: 'Mariana' },
  ],
  'how-many-continents': [
    { input: 'how many continents are there', contains: '7' },
  ],
  'how-many-oceans': [
    { input: 'how many oceans are there', contains: '5' },
  ],
  'longest-river': [
    { input: 'longest river in the world', contains: 'Nile' },
  ],
  'largest-country': [
    { input: 'largest country in the world', contains: 'Russia' },
  ],

  // ── Science Basics ──
  'boiling-point-of-water': [
    { input: 'boiling point of water', contains: '100' },
  ],
  'freezing-point-of-water': [
    { input: 'freezing point of water', contains: '0' },
  ],
  'what-is-gravity': [
    { input: 'what is gravity on earth', contains: '9.8' },
  ],
  'what-is-photosynthesis': [
    { input: 'what is photosynthesis', contains: 'sunlight' },
  ],
  'what-is-dna': [
    { input: 'what is DNA', contains: 'deoxyribonucleic' },
  ],

  // ── Tech Definitions ──
  'what-is-artificial-intelligence': [
    { input: 'what is artificial intelligence', contains: 'machine' },
  ],
  'what-is-machine-learning': [
    { input: 'what is machine learning', contains: 'learn' },
  ],
  'what-is-an-algorithm': [
    { input: 'what is an algorithm', contains: 'step' },
  ],
  'what-is-blockchain': [
    { input: 'what is blockchain', contains: 'decentralized' },
  ],
  'how-does-the-internet-work': [
    { input: 'what is the internet', contains: 'network' },
  ],
  'what-is-an-api': [
    { input: 'what is an API', contains: 'Application Programming Interface' },
  ],

  // ── About ALF ──
  'who-is-alf': [
    { input: 'who is ALF', contains: 'Autonomous' },
  ],
  'what-can-alf-do': [
    { input: 'what can ALF do', contains: 'shard' },
  ],
  'how-is-alf-different': [
    { input: 'how is ALF different from ChatGPT', contains: 'shard' },
  ],
  'what-is-a-knowledge-shard': [
    { input: 'what is a knowledge shard', contains: 'crystallized' },
  ],
  'how-does-alf-work': [
    { input: 'how does ALF work', contains: 'system' },
  ],

  // ── Fun ──
  'meaning-of-life': [
    { input: 'what is the meaning of life', contains: '42' },
  ],
  'tell-me-a-joke': [
    { input: 'tell me a joke', type: 'string' },
  ],
  'random-fun-fact': [
    { input: 'tell me a fun fact', type: 'string' },
  ],
  'hello-greeting': [
    { input: 'hello', type: 'string' },
    { input: 'hi there', type: 'string' },
  ],

  // ── Unit Conversions ──
  'miles-to-kilometers': [
    { input: 'convert 10 miles to km', contains: '16.09' },
    { input: '5 miles to kilometers', contains: '8.0' },
    { input: '100 miles in km', contains: '160.9' },
  ],
  'feet-to-meters': [
    { input: 'convert 6 feet to meters', contains: '1.8' },
    { input: '100 feet to meters', contains: '30.4' },
  ],
  'gallons-to-liters': [
    { input: 'convert 5 gallons to liters', contains: '18.9' },
  ],
  'kilograms-to-pounds': [
    { input: 'convert 100 kg to lbs', contains: '220' },
    { input: '70 kg to pounds', contains: '154' },
  ],
  'centimeters-to-inches': [
    { input: 'convert 30 cm to inches', contains: '11.8' },
  ],

  // ── Robust Math ──
  'basic-arithmetic': [
    { input: 'what is 2 + 2', contains: '4' },
    { input: 'what is 15 * 3', contains: '45' },
    { input: 'what is 100 / 4', contains: '25' },
    { input: 'what is 50 - 17', contains: '33' },
  ],
  'percentage-calculator': [
    { input: 'what is 20% of 150', contains: '30' },
    { input: 'what is 15% of 200', contains: '30' },
  ],
  'square-root-calculator': [
    { input: 'square root of 144', contains: '12' },
    { input: 'square root of 625', contains: '25' },
  ],

  // ── Date/Time ──
  'current-year': [
    { input: 'what year is it', type: 'string' },
  ],
  'current-date': [
    { input: "what is today's date", type: 'string' },
  ],
  'days-in-year': [
    { input: 'how many days left in the year', type: 'string' },
  ],

  // ═══════════════════════════════════════════════════
  // LEGACY PROMOTED SHARDS (25)
  // ═══════════════════════════════════════════════════

  'binary-to-decimal-converter': [
    { input: 'convert 1010 from binary to decimal', contains: '10' },
    { input: 'what is 1111 in decimal', contains: '15' },
  ],
  'calculate-area-of-circle-from-radius-question': [
    { input: 'area of a circle with radius 5', contains: '78.5' },
    { input: 'what is the area of a circle with radius 10', contains: '314' },
  ],
  'calculate-discounted-price': [
    { input: 'what is the price of a $100 item with 20% discount', contains: '80' },
  ],
  'calculate-rectangle-area': [
    { input: 'area of a rectangle 5 by 10', contains: '50' },
  ],
  'calculate-tip-amount': [
    { input: 'tip on $50 at 20%', contains: '10' },
    { input: 'what is 15% tip on $100', contains: '15' },
  ],
  'capital-city-query': [
    { input: 'what is the capital of France', contains: 'Paris' },
    { input: 'capital of Japan', contains: 'Tokyo' },
  ],
  'celsius-to-fahrenheit-conversion': [
    { input: 'convert 0 celsius to fahrenheit', contains: '32' },
    { input: '100 celsius in fahrenheit', contains: '212' },
  ],
  'convert-hours-to-minutes': [
    { input: 'convert 2 hours to minutes', contains: '120' },
  ],
  'convert-kilometers-to-miles': [
    { input: 'convert 10 km to miles', contains: '6.2' },
  ],
  'decimal-to-hexadecimal-converter': [
    { input: 'convert 255 to hexadecimal', contains: 'FF' },
    { input: 'what is 16 in hex', contains: '10' },
  ],
  'factorial-question-handler': [
    { input: 'what is 5 factorial', contains: '120' },
    { input: 'factorial of 10', contains: '3628800' },
  ],
  'fahrenheit-to-celsius-conversion': [
    { input: 'convert 212 fahrenheit to celsius', contains: '100' },
    { input: '32 fahrenheit in celsius', contains: '0' },
  ],
  'greatest-common-divisor': [
    { input: 'GCD of 12 and 8', contains: '4' },
    { input: 'greatest common divisor of 100 and 75', contains: '25' },
  ],
  'greeting-how-are-you-response': [
    { input: 'how are you', type: 'string' },
  ],
  'hex-to-decimal-converter': [
    { input: 'convert FF to decimal', contains: '255' },
    { input: 'what is 1A in decimal', contains: '26' },
  ],
  'inches-to-centimeters-converter': [
    { input: 'convert 10 inches to cm', contains: '25.4' },
  ],
  'leap-year-checker': [
    { input: 'is 2024 a leap year', contains: 'yes' },
    { input: 'is 2023 a leap year', contains: 'no' },
  ],
  'least-common-multiple-calculator': [
    { input: 'LCM of 4 and 6', contains: '12' },
  ],
  'meters-to-feet': [
    { input: 'convert 10 meters to feet', contains: '32.8' },
  ],
  'nth-fibonacci-number-extractor': [
    { input: 'what is the 10th fibonacci number', contains: '55' },
  ],
  'palindrome-checker': [
    { input: 'is racecar a palindrome', contains: 'yes' },
    { input: 'is hello a palindrome', contains: 'no' },
  ],
  'pounds-to-kilograms-converter': [
    { input: 'convert 100 pounds to kg', contains: '45' },
  ],
  'reverse-string-procedure': [
    { input: 'reverse the string hello', contains: 'olleh' },
  ],
  'simple-interest-calculation': [
    { input: 'simple interest on $1000 at 5% for 2 years', contains: '100' },
  ],
  'title-case-converter': [
    { input: 'convert hello world to title case', contains: 'Hello World' },
  ],
  'triangle-area-calculation': [
    { input: 'area of triangle with base 10 and height 5', contains: '25' },
  ],

  // ═══════════════════════════════════════════════════
  // NEWLY PROMOTED FROM TESTING (9)
  // ═══════════════════════════════════════════════════

  'sun-temperature-info': [
    { input: 'how hot is the sun', contains: '5,500' },
    { input: 'temperature of the sun core', contains: '15 million' },
  ],
  'check-if-number-is-prime': [
    { input: 'is 7 a prime number', contains: 'prime' },
    { input: 'is 12 prime', contains: 'not prime' },
    { input: 'is 97 prime', contains: 'prime number' },
  ],
  'power-calculation': [
    { input: 'what is 2 to the power of 10', contains: '1024' },
    { input: '3^4', contains: '81' },
  ],
  'explain-concept-simply': [
    { input: 'explain quantum computing in simple terms', contains: 'qubit' },
    { input: 'explain blockchain in simple terms', contains: 'ledger' },
  ],
  'haiku-generator': [
    { input: 'write a haiku about coding', type: 'string' },
  ],
  'email-validator': [
    { input: 'is test@example.com a valid email', contains: 'true' },
    { input: 'is notanemail a valid email', contains: 'false' },
  ],
  'modulus-question-parser': [
    { input: 'what is 17 mod 5', contains: '2' },
    { input: '100 modulo 7', contains: '2' },
  ],
  'convert-string-to-uppercase': [
    { input: 'convert hello world to uppercase', contains: 'HELLO WORLD' },
  ],
  'absolute-value-calculator': [
    { input: 'absolute value of -42', contains: '42' },
    { input: 'absolute value of 7', contains: '7' },
  ],

  // ═══════════════════════════════════════════════════
  // NEWLY PROMOTED FROM CANDIDATE (4)
  // ═══════════════════════════════════════════════════

  'find-maximum-number': [
    { input: 'what is the largest number in 3, 7, 1, 9, 5', contains: '9' },
    { input: 'find the max of 10 20 30', contains: '30' },
  ],
  'median-of-numbers-from-natural-language-request': [
    { input: 'median of 1, 3, 5, 7, 9', contains: '5' },
    { input: 'find median of 2, 4, 6, 8', contains: '5' },
  ],
  'remove-duplicates-from-list': [
    { input: 'remove duplicates from apple, banana, apple, cherry, banana', contains: 'cherry' },
  ],
  'sort-numbers-ascending': [
    { input: 'sort these numbers: 5, 3, 8, 1, 9, 2', contains: '1, 2, 3, 5, 8, 9' },
  ],
};

function runShard(logic, input) {
  const code = `
    (function() {
      const input = __input__;
      ${logic}
      if (typeof execute === 'function') { return execute(input); }
      return null;
    })()
  `;
  const sandbox = { __input__: input };
  const ctx = vm.createContext(sandbox);
  return vm.runInContext(code, ctx, { timeout: 5000 });
}

function checkResult(result, testCase) {
  const resultStr = String(result ?? '');
  if (testCase.expect !== undefined) {
    return resultStr.trim() === testCase.expect.trim();
  }
  if (testCase.contains !== undefined) {
    return resultStr.toLowerCase().includes(testCase.contains.toLowerCase());
  }
  if (testCase.type === 'string') {
    return typeof result === 'string' && result.length > 0;
  }
  return result !== null && result !== undefined;
}

async function main() {
  console.log('=== SHARD TEST HARNESS ===\n');

  const { rows: shards } = await pool.query(
    "SELECT id, name, logic, patterns, lifecycle FROM procedural_shards WHERE lifecycle = 'promoted' ORDER BY name"
  );

  console.log(`Found ${shards.length} promoted shards\n`);

  let totalPassed = 0;
  let totalFailed = 0;
  let totalErrors = 0;
  let totalNoTests = 0;
  const failures = [];
  const errors = [];

  for (const shard of shards) {
    const cases = TEST_CASES[shard.name];

    if (!cases || cases.length === 0) {
      try {
        const result = runShard(shard.logic, 'test input');
        if (result !== null && result !== undefined) {
          console.log(`  EXEC  ${shard.name.padEnd(45)} | Runs OK (no test cases)`);
        } else {
          console.log(`  WARN  ${shard.name.padEnd(45)} | Returns null (no test cases)`);
        }
        totalNoTests++;
      } catch (err) {
        console.log(`  ERR!  ${shard.name.padEnd(45)} | ${err.message.substring(0, 60)}`);
        errors.push({ name: shard.name, error: err.message });
        totalErrors++;
      }
      continue;
    }

    let shardPassed = 0;
    let shardFailed = 0;
    const shardFailDetails = [];

    for (const tc of cases) {
      try {
        const result = runShard(shard.logic, tc.input);
        if (checkResult(result, tc)) {
          shardPassed++;
        } else {
          shardFailed++;
          shardFailDetails.push({
            input: tc.input,
            expected: tc.expect || tc.contains || tc.type,
            got: String(result ?? 'null').substring(0, 200),
          });
        }
      } catch (err) {
        shardFailed++;
        shardFailDetails.push({
          input: tc.input,
          error: err.message.substring(0, 200),
        });
      }
    }

    totalPassed += shardPassed;
    totalFailed += shardFailed;

    const icon = shardFailed === 0 ? '  OK  ' : ' FAIL ';
    console.log(`${icon} ${shard.name.padEnd(45)} | ${shardPassed}/${shardPassed + shardFailed} tests`);

    if (shardFailed > 0) {
      for (const d of shardFailDetails) {
        if (d.error) {
          console.log(`        -> INPUT: "${d.input}" ERROR: ${d.error}`);
        } else {
          console.log(`        -> INPUT: "${d.input}" EXPECTED: "${d.expected}" GOT: "${d.got}"`);
        }
      }
      failures.push({ name: shard.name, details: shardFailDetails });
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log(`RESULTS: ${totalPassed} passed, ${totalFailed} failed, ${totalErrors} errors, ${totalNoTests} untested`);
  if (totalPassed + totalFailed > 0) {
    console.log(`Test success rate: ${((totalPassed / (totalPassed + totalFailed)) * 100).toFixed(1)}%`);
  }

  if (failures.length > 0) {
    console.log('\n--- FAILURES ---');
    for (const f of failures) {
      console.log(`\n${f.name}:`);
      for (const d of f.details) {
        if (d.error) {
          console.log(`  "${d.input}" -> ERROR: ${d.error}`);
        } else {
          console.log(`  "${d.input}" -> expected: "${d.expected}", got: "${d.got}"`);
        }
      }
    }
  }

  if (errors.length > 0) {
    console.log('\n--- EXECUTION ERRORS ---');
    for (const e of errors) {
      console.log(`  ${e.name}: ${e.error}`);
    }
  }

  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
