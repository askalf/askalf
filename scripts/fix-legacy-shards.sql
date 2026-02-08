-- Fix 12 legacy promoted shards with rigid regex patterns
-- These shards return empty/error on natural language input

-- 1. calculate-discounted-price: handle "$100 with 20% discount", "20% off $100", "price after 20% discount on $100"
UPDATE procedural_shards SET logic = '
function execute(input) {
  let percent, price;
  // "X% discount on $Y" or "X% off $Y"
  let m = input.match(/(\d+(?:\.\d+)?)%\s*(?:discount|off)\s+(?:on\s+)?\$(\d+(?:\.\d+)?)/i);
  if (m) { percent = parseFloat(m[1]); price = parseFloat(m[2]); }
  // "$Y with X% discount/off"
  if (!m) { m = input.match(/\$(\d+(?:\.\d+)?)\s+(?:item\s+)?with\s+(\d+(?:\.\d+)?)%\s*(?:discount|off)/i); }
  if (m && !percent) { price = parseFloat(m[1]); percent = parseFloat(m[2]); }
  // "$Y at X% off"
  if (!percent) { m = input.match(/\$(\d+(?:\.\d+)?)\s+at\s+(\d+(?:\.\d+)?)%\s*off/i); }
  if (m && !percent) { price = parseFloat(m[1]); percent = parseFloat(m[2]); }
  if (!percent || !price) return "Could not parse discount and price from input";
  const discounted = price * (1 - percent / 100);
  return discounted % 1 === 0 ? "$" + discounted : "$" + discounted.toFixed(2);
}
' WHERE name = 'calculate-discounted-price' AND lifecycle = 'promoted';

-- 2. calculate-tip-amount: handle "tip on $50 at 20%", "15% tip on $100", "what is a 20% tip on $50"
UPDATE procedural_shards SET logic = '
function execute(input) {
  let percent, amount;
  // "What is a X% tip on $Y"
  let m = input.match(/(\d+(?:\.\d+)?)%\s*tip\s+on\s+\$(\d+(?:\.\d+)?)/i);
  if (m) { percent = parseFloat(m[1]); amount = parseFloat(m[2]); }
  // "tip on $Y at X%"
  if (!m) { m = input.match(/tip\s+on\s+\$(\d+(?:\.\d+)?)\s+at\s+(\d+(?:\.\d+)?)%/i); }
  if (m && !percent) { amount = parseFloat(m[1]); percent = parseFloat(m[2]); }
  // "$Y at X% tip"
  if (!percent) { m = input.match(/\$(\d+(?:\.\d+)?)\s+at\s+(\d+(?:\.\d+)?)%/i); }
  if (m && !percent) { amount = parseFloat(m[1]); percent = parseFloat(m[2]); }
  if (!percent || !amount) return "Could not parse tip percentage and amount from input";
  const tip = (amount * percent) / 100;
  return "$" + (Math.round(tip * 100) / 100).toString();
}
' WHERE name = 'calculate-tip-amount' AND lifecycle = 'promoted';

-- 3. celsius-to-fahrenheit-conversion: handle "100 celsius in fahrenheit", "100C to F", "100 degrees C to F"
UPDATE procedural_shards SET logic = '
function execute(input) {
  const m = input.match(/(-?\d+(?:\.\d+)?)\s*(?:degrees?\s+)?(?:celsius|c)\s+(?:to|in)\s+(?:fahrenheit|f)/i);
  if (!m) return "Could not parse celsius value from input";
  const celsius = parseFloat(m[1]);
  const fahrenheit = celsius * 9 / 5 + 32;
  return fahrenheit % 1 === 0 ? fahrenheit.toString() : fahrenheit.toFixed(1);
}
' WHERE name = 'celsius-to-fahrenheit-conversion' AND lifecycle = 'promoted';

-- 4. decimal-to-hexadecimal-converter: handle "what is 16 in hex", "255 to hex", "convert 255 to hexadecimal"
UPDATE procedural_shards SET logic = '
function execute(input) {
  let m = input.match(/(?:convert\s+)?(\d+)\s+(?:to|in)\s+(?:hex(?:adecimal)?)/i);
  if (!m) { m = input.match(/(?:what\s+is\s+)?(\d+)\s+in\s+hex/i); }
  if (!m) return "Could not parse number from input";
  const num = parseInt(m[1], 10);
  if (isNaN(num)) return "Invalid number";
  return num.toString(16).toUpperCase();
}
' WHERE name = 'decimal-to-hexadecimal-converter' AND lifecycle = 'promoted';

-- 5. factorial-question-handler: handle "factorial of 10", "10 factorial", "what is 5!"
UPDATE procedural_shards SET logic = '
function execute(input) {
  let m = input.match(/(\d+)\s*(?:factorial|!)/i);
  if (!m) { m = input.match(/factorial\s+(?:of\s+)?(\d+)/i); }
  if (!m) return "Could not parse number from input";
  const n = parseInt(m[1], 10);
  if (isNaN(n) || n < 0) return "Invalid number";
  if (n > 170) return "Number too large for factorial";
  let result = 1;
  for (let i = 2; i <= n; i++) { result *= i; }
  return result.toString();
}
' WHERE name = 'factorial-question-handler' AND lifecycle = 'promoted';

-- 6. fahrenheit-to-celsius-conversion: handle "32 fahrenheit in celsius", "32F to C"
UPDATE procedural_shards SET logic = '
function execute(input) {
  const m = input.match(/(-?\d+(?:\.\d+)?)\s*(?:degrees?\s+)?(?:fahrenheit|f)\s+(?:to|in)\s+(?:celsius|c)/i);
  if (!m) return "Could not parse fahrenheit value from input";
  const fahrenheit = parseFloat(m[1]);
  const celsius = (fahrenheit - 32) * 5 / 9;
  const rounded = Math.abs(celsius - Math.round(celsius)) < 1e-8 ? Math.round(celsius) : Math.round(celsius * 10) / 10;
  return String(rounded);
}
' WHERE name = 'fahrenheit-to-celsius-conversion' AND lifecycle = 'promoted';

-- 7. greatest-common-divisor: handle "greatest common divisor of 100 and 75", "GCD of 12 and 8"
UPDATE procedural_shards SET logic = '
function execute(input) {
  let m = input.match(/(?:GCD|greatest\s+common\s+divisor)\s+(?:of\s+)?(\d+)\s+and\s+(\d+)/i);
  if (!m) { m = input.match(/(\d+)\s+and\s+(\d+)\s+(?:GCD|greatest\s+common\s+divisor)/i); }
  if (!m) return "Could not parse two numbers from input";
  let a = parseInt(m[1]), b = parseInt(m[2]);
  while (b !== 0) { const temp = b; b = a % b; a = temp; }
  return a.toString();
}
' WHERE name = 'greatest-common-divisor' AND lifecycle = 'promoted';

-- 8. hex-to-decimal-converter: handle "convert FF to decimal", "what is 1A in decimal", "FF hex to decimal"
UPDATE procedural_shards SET logic = '
function execute(input) {
  let m = input.match(/(?:convert\s+)?(?:hex\s+)?([0-9A-Fa-f]+)\s+(?:hex\s+)?(?:to|in)\s+decimal/i);
  if (!m) { m = input.match(/hex\s+([0-9A-Fa-f]+)/i); }
  if (!m) { m = input.match(/(?:what\s+is\s+)?([0-9A-Fa-f]{2,})\s+in\s+decimal/i); }
  if (!m) return "Could not parse hex value from input";
  const val = parseInt(m[1], 16);
  if (isNaN(val)) return "Invalid hex value";
  return val.toString();
}
' WHERE name = 'hex-to-decimal-converter' AND lifecycle = 'promoted';

-- 9. inches-to-centimeters-converter: handle "convert 10 inches to cm", "10 inches to centimeters"
UPDATE procedural_shards SET logic = '
function execute(input) {
  const m = input.match(/(\d+(?:\.\d+)?)\s*(?:inches?|in)\s+(?:to|in)\s+(?:centimeters?|cm)/i);
  if (!m) return "Could not parse inches value from input";
  const inches = parseFloat(m[1]);
  const cm = inches * 2.54;
  return cm % 1 === 0 ? cm + " cm" : cm.toFixed(1) + " cm";
}
' WHERE name = 'inches-to-centimeters-converter' AND lifecycle = 'promoted';

-- 10. palindrome-checker: handle "is racecar a palindrome", "is 'racecar' a palindrome", 'Is "hello" a palindrome?'
UPDATE procedural_shards SET logic = '
function execute(input) {
  let str = "";
  // Try quoted string first
  let m = input.match(/["\u0027]([^"\u0027]+)["\u0027]/);
  if (m) { str = m[1]; }
  else {
    // "is X a palindrome"
    m = input.match(/is\s+(.+?)\s+a\s+palindrome/i);
    if (m) { str = m[1]; }
    else {
      // "check if X is a palindrome"
      m = input.match(/check\s+(?:if\s+)?(.+?)\s+is\s+a?\s*palindrome/i);
      if (m) { str = m[1]; }
    }
  }
  if (!str) return "Could not parse word from input";
  const normalized = str.replace(/[^a-z0-9]/gi, "").toLowerCase();
  const reversed = normalized.split("").reverse().join("");
  if (normalized === reversed) {
    return "Yes, \"" + str + "\" is a palindrome.";
  } else {
    return "No, \"" + str + "\" is not a palindrome.";
  }
}
' WHERE name = 'palindrome-checker' AND lifecycle = 'promoted';

-- 11. pounds-to-kilograms-converter: handle "100 pounds to kg", "100 lbs to kg", "convert 100 pounds to kilograms"
UPDATE procedural_shards SET logic = '
function execute(input) {
  const m = input.match(/(\d+(?:\.\d+)?)\s*(?:pounds?|lbs?)\s+(?:to|in)\s+(?:kilograms?|kg)/i);
  if (!m) return "Could not parse pounds value from input";
  const pounds = parseFloat(m[1]);
  const kg = pounds * 0.45359237;
  return kg.toFixed(2) + " kg";
}
' WHERE name = 'pounds-to-kilograms-converter' AND lifecycle = 'promoted';

-- 12. reverse-string-procedure: handle "reverse the string hello", "reverse hello", 'Reverse "hello"'
UPDATE procedural_shards SET logic = '
function execute(input) {
  let str = "";
  // Try quoted string
  let m = input.match(/reverse\s+["\u0027]([^"\u0027]+)["\u0027]/i);
  if (m) { str = m[1]; }
  else {
    // "reverse the string X" or "reverse X"
    m = input.match(/reverse\s+(?:the\s+)?(?:string\s+)?(.+)/i);
    if (m) { str = m[1].trim(); }
  }
  if (!str) return "Could not parse string from input";
  return str.split("").reverse().join("");
}
' WHERE name = 'reverse-string-procedure' AND lifecycle = 'promoted';

-- Verify updates
SELECT name, 'UPDATED' as status FROM procedural_shards
WHERE name IN (
  'calculate-discounted-price', 'calculate-tip-amount', 'celsius-to-fahrenheit-conversion',
  'decimal-to-hexadecimal-converter', 'factorial-question-handler', 'fahrenheit-to-celsius-conversion',
  'greatest-common-divisor', 'hex-to-decimal-converter', 'inches-to-centimeters-converter',
  'palindrome-checker', 'pounds-to-kilograms-converter', 'reverse-string-procedure'
) AND lifecycle = 'promoted'
ORDER BY name;
