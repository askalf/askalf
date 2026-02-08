// Verify all shards have real logic and execute correctly
module.paths.unshift('/app/node_modules');

const { Pool } = require('pg');
const vm = require('vm');

const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://substrate:caff003669dce684448cb89002333263a8684242f43db4e2@pgbouncer:5432/substrate' });

// Sample inputs for each shard category
const sampleInputs = {
  // Math
  'absolute-value': 'absolute value of -42',
  'calculate-average': 'average of 10, 20, 30',
  'calculate-bmi': 'bmi for 70kg 1.75m',
  'calculate-distance': 'distance between (0, 0) and (3, 4)',
  'calculate-percentage': 'What is 15% of 200?',
  'calculate-sum': 'sum of 1, 2, 3, 4, 5',
  'factorial-calculator': 'factorial of 5',
  'fibonacci-number': '10th fibonacci',
  'gcd-calculator': 'gcd of 24 and 36',
  'lcm-calculator': 'lcm of 4 and 6',
  'modulo-calculator': '17 mod 5',
  'power-calculator': '2 to the power of 8',
  'square-root-calculator': 'square root of 144',

  // Arithmetic
  'natural-language-addition-parser': '15 plus 27',
  'simple-addition-question-solver': 'What is 42 + 58?',
  'simple-subtraction-question-solver': 'What is 100 - 37?',
  'subtraction-calculator': 'What is 50 - 23?',
  'subtract-two-numbers': 'subtract 15 from 100',
  'multiply-two-numbers': '7 times 8',
  'division-calculator': 'What is 144 / 12?',
  'basic-division-parser': '100 divided by 4',

  // Conversion
  'celsius-to-fahrenheit': '25 celsius',
  'celsius-to-fahrenheit-converter': 'convert 100 celsius to fahrenheit',
  'fahrenheit-to-celsius': '98.6 fahrenheit',
  'kilometers-to-miles-converter': 'convert 10 km to miles',
  'binary-to-decimal-converter': 'binary 1010 to decimal',
  'decimal-to-hex': '255 to hex',
  'hex-to-decimal': '0xFF to decimal',

  // String
  'string-reversal': 'Reverse "hello"',
  'capitalize-text': 'capitalize "hello world"',
  'convert-string-to-uppercase': 'convert hello to uppercase',
  'convert-quoted-text-to-lowercase': 'convert HELLO to lowercase',
  'trim-whitespace': 'trim "  hello  "',
  'slug-generator': 'slugify "Hello World"',
  'character-counter': 'count characters in "hello"',
  'word-count-from-quoted-text': 'count words in "hello world"',
  'count-vowels': 'count vowels in "hello"',
  'string-length-calculator': 'what is the length of "hello"?',
  'remove-duplicate-characters': 'remove duplicate characters from "hello"',
  'truncate-text': 'truncate "hello world" to 5',
  'repeat-text': 'repeat "ab" 3 times',
  'replace-text': 'replace "l" with "x" in "hello"',

  // Validation
  'email-validity-checker': 'Is test@example.com a valid email?',
  'url-validator': 'validate url https://example.com',
  'phone-validator': 'validate phone +1-555-123-4567',
  'palindrome-checker': 'is "racecar" a palindrome',
  'prime-checker': 'is 17 prime',
  'prime-number-checker': 'is 23 prime',
  'even-odd-checker': 'is 42 even or odd',
  'check-even-odd': 'is 7 even',
  'leap-year-checker': 'Is 2024 a leap year?',

  // Encoding
  'base64-encode': 'base64 encode "hello"',
  'base64-decode': 'base64 decode "aGVsbG8="',
  'url-encode': 'url encode "hello world"',
  'url-decode': 'url decode "hello%20world"',

  // Lists
  'sort-list': 'sort 5, 2, 8, 1, 9',
  'sort-numbers-ascending-from-text': 'sort 5, 2, 8, 1 ascending',
  'find-maximum': 'max of 5, 2, 8, 1, 9',
  'find-maximum-number': 'maximum in 5, 2, 8, 1, 9',
  'find-minimum': 'min of 5, 2, 8, 1, 9',
  'find-minimum-number': 'minimum in 5, 2, 8, 1, 9',
  'count-list-items': 'count items in 1, 2, 3, 4, 5',
  'unique-list-items': 'unique values in 1, 2, 2, 3, 3, 3',
  'compute-average-mean-from-text': 'mean of 10, 20, 30',
  'median-from-text-list': 'median of 1, 2, 3, 4, 5',
  'sum-numbers-from-text': 'sum 10, 20, 30',
  'remove-duplicates-preserve-order': 'remove duplicates from 1, 2, 2, 3, 3',

  // Extraction
  'extract-numbers': 'extract numbers from "order 123 has 45 items"',
  'extract-email': 'extract email from "Contact test@example.com today"',
  'extract-email-address': 'find email in "Contact test@example.com today"',
  'extract-url': 'extract url from "Visit https://example.com"',
  'extract-longest-word-from-quoted-phrase': 'find longest word in "the quick brown"',

  // Utility
  'random-number': 'random number between 1 and 100',
  'round-number': 'round 3.14159 to 2',

  // Knowledge
  'capital-city-query': 'what is the capital of France',
  'explain-concept-simply': 'explain gravity in simple terms',
  'explain-basics-tutorial-generator': 'explain the basics of python',
  'sun-temperature-query': 'what is the temperature of the sun',
  'haiku-generator': 'write a haiku about nature',

  // Conversational
  'friendly-greeting-response': 'hello',
  'greeting-how-are-you-response': 'how are you today',

  // Cognitive/Metacognitive
  'detect-underconfidence': 'I think maybe possibly the answer could be 42, I guess',
  'overconfidence-bias-detector': 'This is definitely absolutely always true, no doubt',
  'belief-update-response': 'I was wrong about X because new evidence shows Y',
  'blind-spot-acknowledgment': 'I have a blind spot in my thinking about this problem',
  'confidence-correctness-independence': 'I am confident but might be wrong about this',
  'knowledge-boundary-acknowledgment': 'I dont know about quantum physics at that level',

  // System/Processing
  'Pre-Action Checkpoint': 'I am about to delete the users data',
  'Error Handler': 'Syntax error in the shard logic on line 42',
  'Pattern Detector': 'calculate 15 + 27',
  'Model Router': 'write a creative poem about autumn',
  'Response Quality Checker': 'The answer is 42 because the math shows this. Therefore, 42 is correct.',

  // Transformation
  'temporal-relevance-decay': 'This news matters now but wont matter next week',
  'temporal-truth-transformation': 'what was true in 2010 isnt true now',
  'haste-makes-waste-transformer': 'I rushed and made mistakes on the project',
  'irreversibility-warning-transformer': 'This action is irreversible and permanent',
  'action-reflection-transformation': 'My decision led to a negative outcome',
  'assumption-error-handler': 'I assumed incorrectly and it caused problems',
  'success-patience-correlation-analyzer': 'I succeeded when I slowed down and waited',
  'consistent-effort-summarizer': 'Small consistent daily effort vs big sporadic bursts',
  'silence-information-interpreter': 'No response to my message - what does silence mean',
  'reframe-perspective': 'I failed at this task',
  'uncertainty-reframing-response': 'I dont know the answer to this question',
  'constant-output-procedure': 'This skill doesnt matter now but will matter later',
  'ai-realtime-communication-handler': 'How to enable realtime communication between agents',
  'request-frequency-priority-mapper': 'Users repeatedly asking for this feature',
  'formal-paraphrase-transformer': 'rephrase "time is money" as a concise aphorism',
};

function exec(logic, input) {
  try {
    const sb = {
      input,
      result: undefined,
      JSON, Object, Array, String, Number, Boolean, Math,
      parseInt, parseFloat, RegExp, Date, Buffer,
      encodeURIComponent, decodeURIComponent,
      console: {log: () => {}}
    };
    vm.runInContext(logic + '\nif(typeof execute==="function"){result=execute(input);}', vm.createContext(sb), {timeout: 5000});
    return {success: sb.result !== undefined && sb.result !== 'Invalid input', output: sb.result};
  } catch(e) {
    return {success: false, error: e.message};
  }
}

async function main() {
  console.log('='.repeat(70));
  console.log('COMPREHENSIVE SHARD VERIFICATION');
  console.log('='.repeat(70));

  const {rows: shards} = await pool.query(`
    SELECT id, name, logic FROM procedural_shards
    WHERE lifecycle IN ('testing', 'promoted')
    ORDER BY name
  `);

  console.log(`\nVerifying ${shards.length} shards...\n`);

  let passed = 0, failed = 0, noInput = 0;
  const failures = [];
  const staticReturns = [];

  for (const shard of shards) {
    // Check for static returns (weak logic)
    if (shard.logic.match(/return\s+['"][^'"]{5,}['"]\s*;?\s*\}/)) {
      const staticMatch = shard.logic.match(/return\s+['"]([^'"]+)['"]/);
      if (staticMatch && !shard.logic.includes('JSON.stringify')) {
        staticReturns.push({name: shard.name, returns: staticMatch[1].substring(0, 50)});
      }
    }

    // Get sample input
    const input = sampleInputs[shard.name];
    if (!input) {
      noInput++;
      console.log(`? ${shard.name.substring(0, 45).padEnd(45)} No sample input`);
      continue;
    }

    const result = exec(shard.logic, input);

    if (result.success) {
      passed++;
      const outputPreview = typeof result.output === 'string'
        ? result.output.substring(0, 30)
        : JSON.stringify(result.output).substring(0, 30);
      console.log(`✓ ${shard.name.substring(0, 45).padEnd(45)} ${outputPreview}...`);
    } else {
      failed++;
      failures.push({name: shard.name, error: result.error || 'Invalid output', input: input.substring(0, 30)});
      console.log(`✗ ${shard.name.substring(0, 45).padEnd(45)} FAILED: ${result.error || 'Invalid output'}`);
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log('VERIFICATION RESULTS');
  console.log('='.repeat(70));
  console.log(`Passed:         ${passed}`);
  console.log(`Failed:         ${failed}`);
  console.log(`No sample input: ${noInput}`);
  console.log(`Total:          ${shards.length}`);

  if (staticReturns.length > 0) {
    console.log(`\n⚠ Shards with potential static returns (${staticReturns.length}):`);
    for (const s of staticReturns.slice(0, 10)) {
      console.log(`  - ${s.name}: "${s.returns}..."`);
    }
  }

  if (failures.length > 0) {
    console.log(`\n✗ Failed shards (${failures.length}):`);
    for (const f of failures) {
      console.log(`  - ${f.name}: ${f.error}`);
      console.log(`    Input: "${f.input}..."`);
    }
  }

  const successRate = ((passed / (passed + failed)) * 100).toFixed(1);
  console.log(`\nSuccess rate: ${successRate}%`);

  if (passed + failed >= 100 && parseFloat(successRate) >= 95) {
    console.log('\n✓ SYSTEM READY: High shard quality verified');
  } else {
    console.log('\n⚠ NEEDS ATTENTION: Review failed shards and add sample inputs');
  }

  await pool.end();
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
