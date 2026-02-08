-- Expanded Seed Shards for Production Readiness
-- Covers: Text, Date/Time, Validation, Encoding, Lists, Data Extraction

-- ============================================
-- TEXT MANIPULATION
-- ============================================

-- 1. Capitalize first letter
INSERT INTO procedural_shards (id, name, version, logic, patterns, input_schema, output_schema, intent_template, lifecycle, confidence, execution_count, success_count)
VALUES (
  'shd_capitalize_001',
  'capitalize-text',
  1,
  E'function execute(input) { const match = input.match(/(?:capitalize|cap|title\\s*case)\\s*[\"'']?(.+?)[\"'']?$/i); if (!match) return "Invalid input"; const text = match[1]; return text.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" "); }',
  '["capitalize", "title case", "cap "]',
  '{}', '{}',
  'capitalize {text}',
  'testing', 0.85, 0, 0
) ON CONFLICT (id) DO NOTHING;

-- 2. Trim whitespace
INSERT INTO procedural_shards (id, name, version, logic, patterns, input_schema, output_schema, intent_template, lifecycle, confidence, execution_count, success_count)
VALUES (
  'shd_trim_001',
  'trim-whitespace',
  1,
  E'function execute(input) { const match = input.match(/(?:trim|strip)\\s*[\"''](.+?)[\"'']/i); if (!match) return "Invalid input"; return match[1].trim(); }',
  '["trim", "strip whitespace", "remove spaces"]',
  '{}', '{}',
  'trim {text}',
  'testing', 0.85, 0, 0
) ON CONFLICT (id) DO NOTHING;

-- 3. Extract numbers from text
INSERT INTO procedural_shards (id, name, version, logic, patterns, input_schema, output_schema, intent_template, lifecycle, confidence, execution_count, success_count)
VALUES (
  'shd_extract_nums_001',
  'extract-numbers',
  1,
  E'function execute(input) { const match = input.match(/(?:extract|get|find)\\s*(?:all\\s*)?(?:numbers?|digits?)\\s*(?:from|in)?\\s*[\"'']?(.+?)[\"'']?$/i); if (!match) return "Invalid input"; const nums = match[1].match(/-?\\d+\\.?\\d*/g); return nums ? nums.join(", ") : "No numbers found"; }',
  '["extract numbers", "get numbers", "find digits"]',
  '{}', '{}',
  'extract numbers from {text}',
  'testing', 0.85, 0, 0
) ON CONFLICT (id) DO NOTHING;

-- 4. Count vowels
INSERT INTO procedural_shards (id, name, version, logic, patterns, input_schema, output_schema, intent_template, lifecycle, confidence, execution_count, success_count)
VALUES (
  'shd_count_vowels_001',
  'count-vowels',
  1,
  E'function execute(input) { const match = input.match(/(?:count|how many)\\s*vowels?\\s*(?:in|of)?\\s*[\"'']?(.+?)[\"'']?$/i); if (!match) return "Invalid input"; const text = match[1].toLowerCase(); const vowels = text.match(/[aeiou]/g); return vowels ? vowels.length.toString() : "0"; }',
  '["count vowels", "how many vowels", "vowel count"]',
  '{}', '{}',
  'count vowels in {text}',
  'testing', 0.85, 0, 0
) ON CONFLICT (id) DO NOTHING;

-- 5. Remove duplicates from text
INSERT INTO procedural_shards (id, name, version, logic, patterns, input_schema, output_schema, intent_template, lifecycle, confidence, execution_count, success_count)
VALUES (
  'shd_remove_dup_chars_001',
  'remove-duplicate-characters',
  1,
  E'function execute(input) { const match = input.match(/(?:remove|delete)\\s*(?:duplicate|repeated)\\s*(?:characters?|chars?|letters?)\\s*(?:from|in)?\\s*[\"'']?(.+?)[\"'']?$/i); if (!match) return "Invalid input"; return [...new Set(match[1])].join(""); }',
  '["remove duplicate characters", "unique characters", "dedupe chars"]',
  '{}', '{}',
  'remove duplicate characters from {text}',
  'testing', 0.85, 0, 0
) ON CONFLICT (id) DO NOTHING;

-- 6. Truncate text
INSERT INTO procedural_shards (id, name, version, logic, patterns, input_schema, output_schema, intent_template, lifecycle, confidence, execution_count, success_count)
VALUES (
  'shd_truncate_001',
  'truncate-text',
  1,
  E'function execute(input) { const match = input.match(/(?:truncate|shorten|cut)\\s*[\"''](.+?)[\"'']\\s*(?:to|at)?\\s*(\\d+)/i); if (!match) return "Invalid input"; const text = match[1]; const len = parseInt(match[2]); return text.length > len ? text.slice(0, len) + "..." : text; }',
  '["truncate", "shorten to", "cut to"]',
  '{}', '{}',
  'truncate {text} to {length}',
  'testing', 0.85, 0, 0
) ON CONFLICT (id) DO NOTHING;

-- 7. Repeat text
INSERT INTO procedural_shards (id, name, version, logic, patterns, input_schema, output_schema, intent_template, lifecycle, confidence, execution_count, success_count)
VALUES (
  'shd_repeat_001',
  'repeat-text',
  1,
  E'function execute(input) { const match = input.match(/(?:repeat)\\s*[\"''](.+?)[\"'']\\s*(\\d+)\\s*times?/i) || input.match(/[\"''](.+?)[\"'']\\s*(\\d+)\\s*times?/i); if (!match) return "Invalid input"; const text = match[1]; const times = Math.min(parseInt(match[2]), 100); return text.repeat(times); }',
  '["repeat.*times", "\\d+ times"]',
  '{}', '{}',
  'repeat {text} {n} times',
  'testing', 0.85, 0, 0
) ON CONFLICT (id) DO NOTHING;

-- 8. Replace text
INSERT INTO procedural_shards (id, name, version, logic, patterns, input_schema, output_schema, intent_template, lifecycle, confidence, execution_count, success_count)
VALUES (
  'shd_replace_001',
  'replace-text',
  1,
  E'function execute(input) { const match = input.match(/replace\\s*[\"''](.+?)[\"'']\\s*with\\s*[\"''](.+?)[\"'']\\s*in\\s*[\"''](.+?)[\"'']/i); if (!match) return "Invalid input"; return match[3].replace(new RegExp(match[1], "g"), match[2]); }',
  '["replace.*with.*in"]',
  '{}', '{}',
  'replace {old} with {new} in {text}',
  'testing', 0.85, 0, 0
) ON CONFLICT (id) DO NOTHING;

-- ============================================
-- VALIDATION
-- ============================================

-- 9. Validate URL
INSERT INTO procedural_shards (id, name, version, logic, patterns, input_schema, output_schema, intent_template, lifecycle, confidence, execution_count, success_count)
VALUES (
  'shd_validate_url_001',
  'url-validator',
  1,
  E'function execute(input) { const match = input.match(/(?:valid(?:ate)?|check|is).*?(?:url)?\\s*(https?:\\/\\/[^\\s]+|www\\.[^\\s]+)/i); if (!match) return "No URL found"; try { new URL(match[1].startsWith("www.") ? "https://" + match[1] : match[1]); return "Valid URL"; } catch { return "Invalid URL"; } }',
  '["valid.*url", "check.*url", "is.*url.*valid"]',
  '{}', '{}',
  'validate url {url}',
  'testing', 0.85, 0, 0
) ON CONFLICT (id) DO NOTHING;

-- 10. Validate phone number (basic)
INSERT INTO procedural_shards (id, name, version, logic, patterns, input_schema, output_schema, intent_template, lifecycle, confidence, execution_count, success_count)
VALUES (
  'shd_validate_phone_001',
  'phone-validator',
  1,
  E'function execute(input) { const match = input.match(/(?:valid(?:ate)?|check|is).*?(?:phone)?\\s*([\\d\\s\\-\\(\\)\\+]+)/i); if (!match) return "No phone number found"; const digits = match[1].replace(/\\D/g, ""); if (digits.length >= 10 && digits.length <= 15) return "Valid phone format (" + digits.length + " digits)"; return "Invalid phone format"; }',
  '["valid.*phone", "check.*phone", "is.*phone.*valid"]',
  '{}', '{}',
  'validate phone {number}',
  'testing', 0.85, 0, 0
) ON CONFLICT (id) DO NOTHING;

-- 11. Check palindrome
INSERT INTO procedural_shards (id, name, version, logic, patterns, input_schema, output_schema, intent_template, lifecycle, confidence, execution_count, success_count)
VALUES (
  'shd_palindrome_001',
  'palindrome-checker',
  1,
  E'function execute(input) { const match = input.match(/(?:is|check)\\s*[\"'']?(.+?)[\"'']?\\s*(?:a\\s*)?palindrome/i) || input.match(/palindrome.*[\"''](.+?)[\"'']/i); if (!match) return "Invalid input"; const text = match[1].toLowerCase().replace(/[^a-z0-9]/g, ""); const reversed = text.split("").reverse().join(""); return text === reversed ? "Yes, it is a palindrome" : "No, not a palindrome"; }',
  '["is.*palindrome", "check.*palindrome", "palindrome"]',
  '{}', '{}',
  'is {text} a palindrome',
  'testing', 0.85, 0, 0
) ON CONFLICT (id) DO NOTHING;

-- 12. Check if number is prime
INSERT INTO procedural_shards (id, name, version, logic, patterns, input_schema, output_schema, intent_template, lifecycle, confidence, execution_count, success_count)
VALUES (
  'shd_is_prime_001',
  'prime-checker',
  1,
  E'function execute(input) { const match = input.match(/(?:is\\s*)?(\\d+)\\s*(?:a\\s*)?prime/i) || input.match(/prime.*?(\\d+)/i); if (!match) return "Invalid input"; const n = parseInt(match[1]); if (n < 2) return "No, not prime"; if (n === 2) return "Yes, 2 is prime"; if (n % 2 === 0) return "No, not prime"; for (let i = 3; i <= Math.sqrt(n); i += 2) { if (n % i === 0) return "No, not prime"; } return "Yes, " + n + " is prime"; }',
  '["is.*prime", "prime.*\\d+", "check.*prime"]',
  '{}', '{}',
  'is {n} prime',
  'testing', 0.85, 0, 0
) ON CONFLICT (id) DO NOTHING;

-- 13. Check if number is even/odd
INSERT INTO procedural_shards (id, name, version, logic, patterns, input_schema, output_schema, intent_template, lifecycle, confidence, execution_count, success_count)
VALUES (
  'shd_even_odd_001',
  'even-odd-checker',
  1,
  E'function execute(input) { const match = input.match(/(?:is\\s*)?(\\d+)\\s*(?:even|odd)/i); if (!match) return "Invalid input"; const n = parseInt(match[1]); return n % 2 === 0 ? n + " is even" : n + " is odd"; }',
  '["is.*even", "is.*odd", "even or odd"]',
  '{}', '{}',
  'is {n} even or odd',
  'testing', 0.85, 0, 0
) ON CONFLICT (id) DO NOTHING;

-- ============================================
-- ENCODING
-- ============================================

-- 14. Base64 encode
INSERT INTO procedural_shards (id, name, version, logic, patterns, input_schema, output_schema, intent_template, lifecycle, confidence, execution_count, success_count)
VALUES (
  'shd_base64_encode_001',
  'base64-encode',
  1,
  E'function execute(input) { const match = input.match(/(?:base64|b64)\\s*(?:encode)?\\s*[\"''](.+?)[\"'']/i) || input.match(/encode\\s*[\"''](.+?)[\"'']\\s*(?:to\\s*)?base64/i); if (!match) return "Invalid input"; return Buffer.from(match[1]).toString("base64"); }',
  '["base64 encode", "encode.*base64", "to base64"]',
  '{}', '{}',
  'base64 encode {text}',
  'testing', 0.85, 0, 0
) ON CONFLICT (id) DO NOTHING;

-- 15. Base64 decode
INSERT INTO procedural_shards (id, name, version, logic, patterns, input_schema, output_schema, intent_template, lifecycle, confidence, execution_count, success_count)
VALUES (
  'shd_base64_decode_001',
  'base64-decode',
  1,
  E'function execute(input) { const match = input.match(/(?:base64|b64)\\s*decode\\s*[\"''](.+?)[\"'']/i) || input.match(/decode\\s*[\"''](.+?)[\"'']\\s*(?:from\\s*)?base64/i); if (!match) return "Invalid input"; try { return Buffer.from(match[1], "base64").toString("utf8"); } catch { return "Invalid base64"; } }',
  '["base64 decode", "decode.*base64", "from base64"]',
  '{}', '{}',
  'base64 decode {encoded}',
  'testing', 0.85, 0, 0
) ON CONFLICT (id) DO NOTHING;

-- 16. URL encode
INSERT INTO procedural_shards (id, name, version, logic, patterns, input_schema, output_schema, intent_template, lifecycle, confidence, execution_count, success_count)
VALUES (
  'shd_url_encode_001',
  'url-encode',
  1,
  E'function execute(input) { const match = input.match(/(?:url|uri)\\s*encode\\s*[\"''](.+?)[\"'']/i) || input.match(/encode\\s*[\"''](.+?)[\"'']\\s*(?:for\\s*)?url/i); if (!match) return "Invalid input"; return encodeURIComponent(match[1]); }',
  '["url encode", "uri encode", "encode.*url"]',
  '{}', '{}',
  'url encode {text}',
  'testing', 0.85, 0, 0
) ON CONFLICT (id) DO NOTHING;

-- 17. URL decode
INSERT INTO procedural_shards (id, name, version, logic, patterns, input_schema, output_schema, intent_template, lifecycle, confidence, execution_count, success_count)
VALUES (
  'shd_url_decode_001',
  'url-decode',
  1,
  E'function execute(input) { const match = input.match(/(?:url|uri)\\s*decode\\s*[\"''](.+?)[\"'']/i) || input.match(/decode\\s*[\"''](.+?)[\"'']\\s*(?:from\\s*)?url/i); if (!match) return "Invalid input"; try { return decodeURIComponent(match[1]); } catch { return "Invalid URL encoding"; } }',
  '["url decode", "uri decode", "decode.*url"]',
  '{}', '{}',
  'url decode {encoded}',
  'testing', 0.85, 0, 0
) ON CONFLICT (id) DO NOTHING;

-- ============================================
-- LIST OPERATIONS
-- ============================================

-- 18. Sort list
INSERT INTO procedural_shards (id, name, version, logic, patterns, input_schema, output_schema, intent_template, lifecycle, confidence, execution_count, success_count)
VALUES (
  'shd_sort_list_001',
  'sort-list',
  1,
  E'function execute(input) { const match = input.match(/sort\\s*[:\\[]?\\s*([\\d,\\s]+)/i); if (!match) return "Invalid input"; const nums = match[1].split(/[,\\s]+/).filter(n => n).map(Number).sort((a,b) => a-b); return nums.join(", "); }',
  '["sort.*\\d", "sort list", "order numbers"]',
  '{}', '{}',
  'sort {list}',
  'testing', 0.85, 0, 0
) ON CONFLICT (id) DO NOTHING;

-- 19. Find max in list
INSERT INTO procedural_shards (id, name, version, logic, patterns, input_schema, output_schema, intent_template, lifecycle, confidence, execution_count, success_count)
VALUES (
  'shd_max_001',
  'find-maximum',
  1,
  E'function execute(input) { const match = input.match(/(?:max|maximum|largest|biggest).*?([\\d,\\s]+)/i); if (!match) return "Invalid input"; const nums = match[1].split(/[,\\s]+/).filter(n => n).map(Number); return Math.max(...nums).toString(); }',
  '["max.*\\d", "maximum", "largest", "biggest"]',
  '{}', '{}',
  'max of {list}',
  'testing', 0.85, 0, 0
) ON CONFLICT (id) DO NOTHING;

-- 20. Find min in list
INSERT INTO procedural_shards (id, name, version, logic, patterns, input_schema, output_schema, intent_template, lifecycle, confidence, execution_count, success_count)
VALUES (
  'shd_min_001',
  'find-minimum',
  1,
  E'function execute(input) { const match = input.match(/(?:min|minimum|smallest).*?([\\d,\\s]+)/i); if (!match) return "Invalid input"; const nums = match[1].split(/[,\\s]+/).filter(n => n).map(Number); return Math.min(...nums).toString(); }',
  '["min.*\\d", "minimum", "smallest"]',
  '{}', '{}',
  'min of {list}',
  'testing', 0.85, 0, 0
) ON CONFLICT (id) DO NOTHING;

-- 21. Calculate average
INSERT INTO procedural_shards (id, name, version, logic, patterns, input_schema, output_schema, intent_template, lifecycle, confidence, execution_count, success_count)
VALUES (
  'shd_average_001',
  'calculate-average',
  1,
  E'function execute(input) { const match = input.match(/(?:average|avg|mean).*?([\\d,\\s]+)/i); if (!match) return "Invalid input"; const nums = match[1].split(/[,\\s]+/).filter(n => n).map(Number); const avg = nums.reduce((a,b) => a+b, 0) / nums.length; return avg.toFixed(2); }',
  '["average.*\\d", "avg", "mean of"]',
  '{}', '{}',
  'average of {list}',
  'testing', 0.85, 0, 0
) ON CONFLICT (id) DO NOTHING;

-- 22. Calculate sum
INSERT INTO procedural_shards (id, name, version, logic, patterns, input_schema, output_schema, intent_template, lifecycle, confidence, execution_count, success_count)
VALUES (
  'shd_sum_001',
  'calculate-sum',
  1,
  E'function execute(input) { const match = input.match(/(?:sum|total|add up).*?([\\d,\\s]+)/i); if (!match) return "Invalid input"; const nums = match[1].split(/[,\\s]+/).filter(n => n).map(Number); return nums.reduce((a,b) => a+b, 0).toString(); }',
  '["sum.*\\d", "total of", "add up"]',
  '{}', '{}',
  'sum of {list}',
  'testing', 0.85, 0, 0
) ON CONFLICT (id) DO NOTHING;

-- 23. Count items in list
INSERT INTO procedural_shards (id, name, version, logic, patterns, input_schema, output_schema, intent_template, lifecycle, confidence, execution_count, success_count)
VALUES (
  'shd_count_items_001',
  'count-list-items',
  1,
  E'function execute(input) { const match = input.match(/(?:count|how many)\\s*(?:items?|elements?|numbers?)?\\s*(?:in)?\\s*[:\\[]?\\s*([\\d,\\s]+)/i); if (!match) return "Invalid input"; const items = match[1].split(/[,\\s]+/).filter(n => n); return items.length.toString(); }',
  '["count.*items", "how many.*in", "count.*elements"]',
  '{}', '{}',
  'count items in {list}',
  'testing', 0.85, 0, 0
) ON CONFLICT (id) DO NOTHING;

-- 24. Remove duplicates from list
INSERT INTO procedural_shards (id, name, version, logic, patterns, input_schema, output_schema, intent_template, lifecycle, confidence, execution_count, success_count)
VALUES (
  'shd_unique_001',
  'unique-list-items',
  1,
  E'function execute(input) { const match = input.match(/(?:unique|dedupe|remove duplicates?).*?([\\d,\\s]+)/i); if (!match) return "Invalid input"; const nums = match[1].split(/[,\\s]+/).filter(n => n); return [...new Set(nums)].join(", "); }',
  '["unique", "dedupe", "remove duplicate"]',
  '{}', '{}',
  'unique values in {list}',
  'testing', 0.85, 0, 0
) ON CONFLICT (id) DO NOTHING;

-- ============================================
-- DATA EXTRACTION
-- ============================================

-- 25. Extract email from text
INSERT INTO procedural_shards (id, name, version, logic, patterns, input_schema, output_schema, intent_template, lifecycle, confidence, execution_count, success_count)
VALUES (
  'shd_extract_email_001',
  'extract-email',
  1,
  E'function execute(input) { const match = input.match(/(?:extract|find|get)\\s*(?:the\\s*)?email.*?[\"''](.+?)[\"'']/i) || input.match(/email.*?in\\s*[\"''](.+?)[\"'']/i); if (!match) return "Invalid input"; const email = match[1].match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}/); return email ? email[0] : "No email found"; }',
  '["extract email", "find email", "get email"]',
  '{}', '{}',
  'extract email from {text}',
  'testing', 0.85, 0, 0
) ON CONFLICT (id) DO NOTHING;

-- 26. Extract URL from text
INSERT INTO procedural_shards (id, name, version, logic, patterns, input_schema, output_schema, intent_template, lifecycle, confidence, execution_count, success_count)
VALUES (
  'shd_extract_url_001',
  'extract-url',
  1,
  E'function execute(input) { const match = input.match(/(?:extract|find|get)\\s*(?:the\\s*)?url.*?[\"''](.+?)[\"'']/i); if (!match) return "Invalid input"; const url = match[1].match(/https?:\\/\\/[^\\s]+/); return url ? url[0] : "No URL found"; }',
  '["extract url", "find url", "get url"]',
  '{}', '{}',
  'extract url from {text}',
  'testing', 0.85, 0, 0
) ON CONFLICT (id) DO NOTHING;

-- ============================================
-- MISC UTILITIES
-- ============================================

-- 27. Generate random number
INSERT INTO procedural_shards (id, name, version, logic, patterns, input_schema, output_schema, intent_template, lifecycle, confidence, execution_count, success_count)
VALUES (
  'shd_random_001',
  'random-number',
  1,
  E'function execute(input) { const match = input.match(/random.*?(\\d+).*?(\\d+)/i) || input.match(/number.*?between\\s*(\\d+).*?(\\d+)/i); if (!match) { return Math.floor(Math.random() * 100).toString(); } const min = parseInt(match[1]); const max = parseInt(match[2]); return Math.floor(Math.random() * (max - min + 1) + min).toString(); }',
  '["random number", "random.*between", "generate.*random"]',
  '{}', '{}',
  'random number between {min} and {max}',
  'testing', 0.85, 0, 0
) ON CONFLICT (id) DO NOTHING;

-- 28. Round number
INSERT INTO procedural_shards (id, name, version, logic, patterns, input_schema, output_schema, intent_template, lifecycle, confidence, execution_count, success_count)
VALUES (
  'shd_round_001',
  'round-number',
  1,
  E'function execute(input) { const match = input.match(/round\\s*(-?\\d+\\.\\d+)(?:\\s*to\\s*(\\d+))?/i); if (!match) return "Invalid input"; const num = parseFloat(match[1]); const places = match[2] ? parseInt(match[2]) : 0; return num.toFixed(places); }',
  '["round.*\\d+\\.\\d+"]',
  '{}', '{}',
  'round {number} to {places} decimal places',
  'testing', 0.85, 0, 0
) ON CONFLICT (id) DO NOTHING;

-- 29. Calculate distance (Pythagorean)
INSERT INTO procedural_shards (id, name, version, logic, patterns, input_schema, output_schema, intent_template, lifecycle, confidence, execution_count, success_count)
VALUES (
  'shd_distance_001',
  'calculate-distance',
  1,
  E'function execute(input) { const match = input.match(/distance.*?\\((-?\\d+),\\s*(-?\\d+)\\).*?\\((-?\\d+),\\s*(-?\\d+)\\)/i); if (!match) return "Invalid input"; const [x1,y1,x2,y2] = [match[1],match[2],match[3],match[4]].map(Number); const dist = Math.sqrt(Math.pow(x2-x1,2) + Math.pow(y2-y1,2)); return dist.toFixed(2); }',
  '["distance.*between.*points", "distance.*\\(.*\\).*\\(.*\\)"]',
  '{}', '{}',
  'distance between ({x1}, {y1}) and ({x2}, {y2})',
  'testing', 0.85, 0, 0
) ON CONFLICT (id) DO NOTHING;

-- 30. Calculate BMI
INSERT INTO procedural_shards (id, name, version, logic, patterns, input_schema, output_schema, intent_template, lifecycle, confidence, execution_count, success_count)
VALUES (
  'shd_bmi_001',
  'calculate-bmi',
  1,
  E'function execute(input) { const match = input.match(/bmi.*?(\\d+\\.?\\d*)\\s*(?:kg|kilos?).*?(\\d+\\.?\\d*)\\s*(?:m|meters?|cm)?/i) || input.match(/(\\d+\\.?\\d*)\\s*(?:kg|kilos?).*?(\\d+\\.?\\d*)\\s*(?:m|meters?).*?bmi/i); if (!match) return "Invalid input"; const weight = parseFloat(match[1]); let height = parseFloat(match[2]); if (height > 3) height = height / 100; const bmi = weight / (height * height); let category = ""; if (bmi < 18.5) category = "underweight"; else if (bmi < 25) category = "normal"; else if (bmi < 30) category = "overweight"; else category = "obese"; return bmi.toFixed(1) + " (" + category + ")"; }',
  '["bmi.*kg.*m", "calculate.*bmi", "body mass index"]',
  '{}', '{}',
  'bmi for {weight}kg {height}m',
  'testing', 0.85, 0, 0
) ON CONFLICT (id) DO NOTHING;

-- Summary: 30 new shards added covering text, validation, encoding, lists, and utilities
