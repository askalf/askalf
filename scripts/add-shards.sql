-- New shards to expand SUBSTRATE capabilities

-- 1. Celsius to Fahrenheit
INSERT INTO procedural_shards (id, name, version, logic, patterns, input_schema, output_schema, intent_template, lifecycle, confidence)
VALUES (
  'shd_celsius_to_f_001',
  'celsius-to-fahrenheit',
  1,
  E'function execute(input) { const match = input.match(/(-?\\d+(?:\\.\\d+)?)\\s*(?:c|celsius|°c)/i); if (!match) { return "Invalid input"; } const c = parseFloat(match[1]); const f = (c * 9/5) + 32; return f.toFixed(1) + "°F"; }',
  '["\\d+\\s*(?:c|celsius)", "convert.*celsius.*fahrenheit", "celsius to fahrenheit"]',
  '{}',
  '{}',
  'convert {celsius} to fahrenheit',
  'promoted',
  0.95
);

-- 2. Fahrenheit to Celsius
INSERT INTO procedural_shards (id, name, version, logic, patterns, input_schema, output_schema, intent_template, lifecycle, confidence)
VALUES (
  'shd_fahrenheit_to_c_001',
  'fahrenheit-to-celsius',
  1,
  E'function execute(input) { const match = input.match(/(-?\\d+(?:\\.\\d+)?)\\s*(?:f|fahrenheit|°f)/i); if (!match) { return "Invalid input"; } const f = parseFloat(match[1]); const c = (f - 32) * 5/9; return c.toFixed(1) + "°C"; }',
  '["\\d+\\s*(?:f|fahrenheit)", "convert.*fahrenheit.*celsius", "fahrenheit to celsius"]',
  '{}',
  '{}',
  'convert {fahrenheit} to celsius',
  'promoted',
  0.95
);

-- 3. Fibonacci calculator
INSERT INTO procedural_shards (id, name, version, logic, patterns, input_schema, output_schema, intent_template, lifecycle, confidence)
VALUES (
  'shd_fibonacci_001',
  'fibonacci-number',
  1,
  E'function execute(input) { const match = input.match(/(\\d+)(?:th|st|nd|rd)?\\s*(?:fibonacci|fib)/i) || input.match(/fibonacci\\s*(?:of|number)?\\s*(\\d+)/i); if (!match) { return "Invalid input"; } const n = parseInt(match[1]); if (n > 50) return "Number too large"; let a = 0, b = 1; for (let i = 0; i < n; i++) { [a, b] = [b, a + b]; } return a.toString(); }',
  '["fibonacci.*\\d+", "\\d+.*fibonacci", "fib\\s*\\d+"]',
  '{}',
  '{}',
  'fibonacci of {n}',
  'promoted',
  0.95
);

-- 4. Factorial calculator
INSERT INTO procedural_shards (id, name, version, logic, patterns, input_schema, output_schema, intent_template, lifecycle, confidence)
VALUES (
  'shd_factorial_001',
  'factorial-calculator',
  1,
  E'function execute(input) { const match = input.match(/(?:factorial\\s*(?:of)?\\s*)?(\\d+)(?:\\s*factorial|!)?/i); if (!match) { return "Invalid input"; } const n = parseInt(match[1]); if (n > 20) return "Number too large"; let result = 1; for (let i = 2; i <= n; i++) result *= i; return result.toString(); }',
  '["factorial.*\\d+", "\\d+\\s*factorial", "\\d+!"]',
  '{}',
  '{}',
  'factorial of {n}',
  'promoted',
  0.95
);

-- 5. Power/exponent calculator
INSERT INTO procedural_shards (id, name, version, logic, patterns, input_schema, output_schema, intent_template, lifecycle, confidence)
VALUES (
  'shd_power_001',
  'power-calculator',
  1,
  E'function execute(input) { const match = input.match(/(\\d+(?:\\.\\d+)?)\\s*(?:\\^|to the power of|raised to|pow(?:er)?)\\s*(\\d+(?:\\.\\d+)?)/i); if (!match) { return "Invalid input"; } const base = parseFloat(match[1]); const exp = parseFloat(match[2]); const result = Math.pow(base, exp); return result.toString(); }',
  '["\\d+\\s*\\^\\s*\\d+", "\\d+.*power.*\\d+", "\\d+.*raised.*\\d+"]',
  '{}',
  '{}',
  '{base} to the power of {exponent}',
  'promoted',
  0.95
);

-- 6. Square root calculator
INSERT INTO procedural_shards (id, name, version, logic, patterns, input_schema, output_schema, intent_template, lifecycle, confidence)
VALUES (
  'shd_sqrt_001',
  'square-root-calculator',
  1,
  E'function execute(input) { const match = input.match(/(?:square\\s*root\\s*(?:of)?|sqrt)\\s*(\\d+(?:\\.\\d+)?)/i); if (!match) { return "Invalid input"; } const n = parseFloat(match[1]); if (n < 0) return "Cannot compute square root of negative number"; const result = Math.sqrt(n); return result.toFixed(4).replace(/\\.?0+$/, ""); }',
  '["square\\s*root.*\\d+", "sqrt.*\\d+"]',
  '{}',
  '{}',
  'square root of {number}',
  'promoted',
  0.95
);

-- 7. Modulo/remainder calculator
INSERT INTO procedural_shards (id, name, version, logic, patterns, input_schema, output_schema, intent_template, lifecycle, confidence)
VALUES (
  'shd_modulo_001',
  'modulo-calculator',
  1,
  E'function execute(input) { const match = input.match(/(\\d+)\\s*(?:mod|modulo|%|remainder)\\s*(\\d+)/i); if (!match) { return "Invalid input"; } const a = parseInt(match[1]); const b = parseInt(match[2]); if (b === 0) return "Cannot divide by zero"; return (a % b).toString(); }',
  '["\\d+\\s*(?:mod|%)\\s*\\d+", "remainder.*\\d+.*\\d+", "modulo"]',
  '{}',
  '{}',
  '{a} mod {b}',
  'promoted',
  0.95
);

-- 8. Absolute value
INSERT INTO procedural_shards (id, name, version, logic, patterns, input_schema, output_schema, intent_template, lifecycle, confidence)
VALUES (
  'shd_abs_001',
  'absolute-value',
  1,
  E'function execute(input) { const match = input.match(/(?:absolute\\s*value\\s*(?:of)?|abs)\\s*(-?\\d+(?:\\.\\d+)?)/i); if (!match) { return "Invalid input"; } const n = parseFloat(match[1]); return Math.abs(n).toString(); }',
  '["absolute.*-?\\d+", "abs.*-?\\d+"]',
  '{}',
  '{}',
  'absolute value of {number}',
  'promoted',
  0.95
);

-- 9. GCD (Greatest Common Divisor)
INSERT INTO procedural_shards (id, name, version, logic, patterns, input_schema, output_schema, intent_template, lifecycle, confidence)
VALUES (
  'shd_gcd_001',
  'gcd-calculator',
  1,
  E'function execute(input) { const match = input.match(/(?:gcd|greatest\\s*common\\s*divisor).*?(\\d+).*?(\\d+)/i); if (!match) { return "Invalid input"; } let a = parseInt(match[1]), b = parseInt(match[2]); while (b) { [a, b] = [b, a % b]; } return a.toString(); }',
  '["gcd.*\\d+.*\\d+", "greatest common divisor"]',
  '{}',
  '{}',
  'gcd of {a} and {b}',
  'promoted',
  0.95
);

-- 10. LCM (Least Common Multiple)
INSERT INTO procedural_shards (id, name, version, logic, patterns, input_schema, output_schema, intent_template, lifecycle, confidence)
VALUES (
  'shd_lcm_001',
  'lcm-calculator',
  1,
  E'function execute(input) { const match = input.match(/(?:lcm|least\\s*common\\s*multiple).*?(\\d+).*?(\\d+)/i); if (!match) { return "Invalid input"; } let a = parseInt(match[1]), b = parseInt(match[2]); const gcd = (x, y) => { while (y) { [x, y] = [y, x % y]; } return x; }; return ((a * b) / gcd(a, b)).toString(); }',
  '["lcm.*\\d+.*\\d+", "least common multiple"]',
  '{}',
  '{}',
  'lcm of {a} and {b}',
  'promoted',
  0.95
);

-- 11. Character counter
INSERT INTO procedural_shards (id, name, version, logic, patterns, input_schema, output_schema, intent_template, lifecycle, confidence)
VALUES (
  'shd_charcount_001',
  'character-counter',
  1,
  E'function execute(input) { const match = input.match(/(?:count|how many)\\s*(?:characters?|chars?|letters?)\\s*(?:in|of)?\\s*[\"'']?(.+?)[\"'']?$/i); if (!match) { return "Invalid input"; } const text = match[1].trim(); const withSpaces = text.length; const withoutSpaces = text.replace(/\\s/g, "").length; return withSpaces + " characters (" + withoutSpaces + " without spaces)"; }',
  '["count.*characters", "how many.*characters", "character count"]',
  '{}',
  '{}',
  'count characters in {text}',
  'promoted',
  0.95
);

-- 12. Generate URL slug
INSERT INTO procedural_shards (id, name, version, logic, patterns, input_schema, output_schema, intent_template, lifecycle, confidence)
VALUES (
  'shd_slug_001',
  'slug-generator',
  1,
  E'function execute(input) { const match = input.match(/(?:slugify|slug|url.*slug)\\s*[\"'']?(.+?)[\"'']?$/i); if (!match) { return "Invalid input"; } const text = match[1]; return text.toLowerCase().trim().replace(/[^\\w\\s-]/g, "").replace(/[\\s_-]+/g, "-").replace(/^-+|-+$/g, ""); }',
  '["slugify", "convert.*slug", "url slug", "make.*slug"]',
  '{}',
  '{}',
  'slugify {text}',
  'promoted',
  0.95
);

-- 13. Hexadecimal to decimal
INSERT INTO procedural_shards (id, name, version, logic, patterns, input_schema, output_schema, intent_template, lifecycle, confidence)
VALUES (
  'shd_hex2dec_001',
  'hex-to-decimal',
  1,
  E'function execute(input) { const match = input.match(/(?:0x)?([0-9a-fA-F]+)\\s*(?:to\\s*decimal|in\\s*decimal)/i); if (!match) { return "Invalid input"; } const hex = match[1]; return parseInt(hex, 16).toString(); }',
  '["0x[0-9a-f]+.*decimal", "hex.*decimal", "convert.*hex.*decimal"]',
  '{}',
  '{}',
  'convert {hex} to decimal',
  'promoted',
  0.95
);

-- 14. Decimal to hexadecimal
INSERT INTO procedural_shards (id, name, version, logic, patterns, input_schema, output_schema, intent_template, lifecycle, confidence)
VALUES (
  'shd_dec2hex_001',
  'decimal-to-hex',
  1,
  E'function execute(input) { const match = input.match(/(\\d+)\\s*(?:to\\s*hex|in\\s*hex|to\\s*hexadecimal)/i); if (!match) { return "Invalid input"; } const dec = parseInt(match[1]); return "0x" + dec.toString(16).toUpperCase(); }',
  '["\\d+.*(?:to|in)\\s*hex", "decimal.*hex", "convert.*decimal.*hex"]',
  '{}',
  '{}',
  'convert {decimal} to hex',
  'promoted',
  0.95
);

-- 15. Binary to decimal
INSERT INTO procedural_shards (id, name, version, logic, patterns, input_schema, output_schema, intent_template, lifecycle, confidence)
VALUES (
  'shd_bin2dec_001',
  'binary-to-decimal',
  1,
  E'function execute(input) { const match = input.match(/(?:0b)?([01]+)\\s*(?:to\\s*decimal|in\\s*decimal)/i); if (!match) { return "Invalid input"; } const bin = match[1]; return parseInt(bin, 2).toString(); }',
  '["[01]+.*decimal", "binary.*decimal", "convert.*binary.*decimal"]',
  '{}',
  '{}',
  'convert {binary} to decimal',
  'promoted',
  0.95
);
