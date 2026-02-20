-- ============================================
-- CLEAN RESEED: Trace seeds for domains only covered by manual shards
-- Each template has 6 traces for proper crystallization clustering
-- ============================================

-- ============================================
-- MATH: Absolute Value (6 traces)
-- ============================================
INSERT INTO reasoning_traces (id, input, output, reasoning, pattern_hash, intent_category, intent_name, intent_template, tokens_used, execution_ms, visibility, timestamp, synthesized) VALUES
('trc_reseed_abs_001', 'What is the absolute value of -15?', '15', 'Absolute value: |-15| = 15', 'reseed_abs', 'math', 'absolute-value', 'absolute value of {n}', 50, 10, 'public', NOW(), false),
('trc_reseed_abs_002', 'What is the absolute value of -42?', '42', 'Absolute value: |-42| = 42', 'reseed_abs', 'math', 'absolute-value', 'absolute value of {n}', 50, 10, 'public', NOW(), false),
('trc_reseed_abs_003', 'What is the absolute value of 7?', '7', 'Absolute value: |7| = 7 (already positive)', 'reseed_abs', 'math', 'absolute-value', 'absolute value of {n}', 50, 10, 'public', NOW(), false),
('trc_reseed_abs_004', 'What is the absolute value of -100?', '100', 'Absolute value: |-100| = 100', 'reseed_abs', 'math', 'absolute-value', 'absolute value of {n}', 50, 10, 'public', NOW(), false),
('trc_reseed_abs_005', 'What is the absolute value of -3.5?', '3.5', 'Absolute value: |-3.5| = 3.5', 'reseed_abs', 'math', 'absolute-value', 'absolute value of {n}', 50, 10, 'public', NOW(), false),
('trc_reseed_abs_006', 'What is the absolute value of 0?', '0', 'Absolute value: |0| = 0', 'reseed_abs', 'math', 'absolute-value', 'absolute value of {n}', 50, 10, 'public', NOW(), false)
ON CONFLICT (id) DO UPDATE SET synthesized = false;

-- ============================================
-- MATH: Factorial (6 traces)
-- ============================================
INSERT INTO reasoning_traces (id, input, output, reasoning, pattern_hash, intent_category, intent_name, intent_template, tokens_used, execution_ms, visibility, timestamp, synthesized) VALUES
('trc_reseed_fact_001', 'What is 5 factorial?', '120', 'Factorial: 5! = 5x4x3x2x1 = 120', 'reseed_fact', 'math', 'factorial', 'what is {n} factorial', 50, 10, 'public', NOW(), false),
('trc_reseed_fact_002', 'What is 6 factorial?', '720', 'Factorial: 6! = 6x5x4x3x2x1 = 720', 'reseed_fact', 'math', 'factorial', 'what is {n} factorial', 50, 10, 'public', NOW(), false),
('trc_reseed_fact_003', 'What is 4 factorial?', '24', 'Factorial: 4! = 4x3x2x1 = 24', 'reseed_fact', 'math', 'factorial', 'what is {n} factorial', 50, 10, 'public', NOW(), false),
('trc_reseed_fact_004', 'What is 7 factorial?', '5040', 'Factorial: 7! = 7x6x5x4x3x2x1 = 5040', 'reseed_fact', 'math', 'factorial', 'what is {n} factorial', 50, 10, 'public', NOW(), false),
('trc_reseed_fact_005', 'What is 3 factorial?', '6', 'Factorial: 3! = 3x2x1 = 6', 'reseed_fact', 'math', 'factorial', 'what is {n} factorial', 50, 10, 'public', NOW(), false),
('trc_reseed_fact_006', 'What is 8 factorial?', '40320', 'Factorial: 8! = 8x7x6x5x4x3x2x1 = 40320', 'reseed_fact', 'math', 'factorial', 'what is {n} factorial', 50, 10, 'public', NOW(), false)
ON CONFLICT (id) DO UPDATE SET synthesized = false;

-- ============================================
-- MATH: Fibonacci (6 traces)
-- ============================================
INSERT INTO reasoning_traces (id, input, output, reasoning, pattern_hash, intent_category, intent_name, intent_template, tokens_used, execution_ms, visibility, timestamp, synthesized) VALUES
('trc_reseed_fib_001', 'What is the 10th Fibonacci number?', '55', 'Fibonacci: 1,1,2,3,5,8,13,21,34,55', 'reseed_fib', 'math', 'fibonacci', 'what is the {n}th fibonacci number', 50, 10, 'public', NOW(), false),
('trc_reseed_fib_002', 'What is the 7th Fibonacci number?', '13', 'Fibonacci: 1,1,2,3,5,8,13', 'reseed_fib', 'math', 'fibonacci', 'what is the {n}th fibonacci number', 50, 10, 'public', NOW(), false),
('trc_reseed_fib_003', 'What is the 5th Fibonacci number?', '5', 'Fibonacci: 1,1,2,3,5', 'reseed_fib', 'math', 'fibonacci', 'what is the {n}th fibonacci number', 50, 10, 'public', NOW(), false),
('trc_reseed_fib_004', 'What is the 12th Fibonacci number?', '144', 'Fibonacci: ...89,144', 'reseed_fib', 'math', 'fibonacci', 'what is the {n}th fibonacci number', 50, 10, 'public', NOW(), false),
('trc_reseed_fib_005', 'What is the 8th Fibonacci number?', '21', 'Fibonacci: 1,1,2,3,5,8,13,21', 'reseed_fib', 'math', 'fibonacci', 'what is the {n}th fibonacci number', 50, 10, 'public', NOW(), false),
('trc_reseed_fib_006', 'What is the 15th Fibonacci number?', '610', 'Fibonacci: ...377,610', 'reseed_fib', 'math', 'fibonacci', 'what is the {n}th fibonacci number', 50, 10, 'public', NOW(), false)
ON CONFLICT (id) DO UPDATE SET synthesized = false;

-- ============================================
-- MATH: GCD (6 traces)
-- ============================================
INSERT INTO reasoning_traces (id, input, output, reasoning, pattern_hash, intent_category, intent_name, intent_template, tokens_used, execution_ms, visibility, timestamp, synthesized) VALUES
('trc_reseed_gcd_001', 'What is the GCD of 48 and 18?', '6', 'GCD(48,18): 48=2x18+12, 18=1x12+6, 12=2x6+0 -> GCD=6', 'reseed_gcd', 'math', 'gcd', 'GCD of {a} and {b}', 50, 10, 'public', NOW(), false),
('trc_reseed_gcd_002', 'What is the GCD of 100 and 75?', '25', 'GCD(100,75): 100=1x75+25, 75=3x25+0 -> GCD=25', 'reseed_gcd', 'math', 'gcd', 'GCD of {a} and {b}', 50, 10, 'public', NOW(), false),
('trc_reseed_gcd_003', 'What is the GCD of 36 and 24?', '12', 'GCD(36,24): 36=1x24+12, 24=2x12+0 -> GCD=12', 'reseed_gcd', 'math', 'gcd', 'GCD of {a} and {b}', 50, 10, 'public', NOW(), false),
('trc_reseed_gcd_004', 'What is the GCD of 56 and 42?', '14', 'GCD(56,42): 56=1x42+14, 42=3x14+0 -> GCD=14', 'reseed_gcd', 'math', 'gcd', 'GCD of {a} and {b}', 50, 10, 'public', NOW(), false),
('trc_reseed_gcd_005', 'What is the GCD of 15 and 10?', '5', 'GCD(15,10): 15=1x10+5, 10=2x5+0 -> GCD=5', 'reseed_gcd', 'math', 'gcd', 'GCD of {a} and {b}', 50, 10, 'public', NOW(), false),
('trc_reseed_gcd_006', 'What is the GCD of 84 and 36?', '12', 'GCD(84,36): 84=2x36+12, 36=3x12+0 -> GCD=12', 'reseed_gcd', 'math', 'gcd', 'GCD of {a} and {b}', 50, 10, 'public', NOW(), false)
ON CONFLICT (id) DO UPDATE SET synthesized = false;

-- ============================================
-- MATH: LCM (6 traces)
-- ============================================
INSERT INTO reasoning_traces (id, input, output, reasoning, pattern_hash, intent_category, intent_name, intent_template, tokens_used, execution_ms, visibility, timestamp, synthesized) VALUES
('trc_reseed_lcm_001', 'What is the LCM of 4 and 6?', '12', 'LCM(4,6) = (4x6)/GCD(4,6) = 24/2 = 12', 'reseed_lcm', 'math', 'lcm', 'LCM of {a} and {b}', 50, 10, 'public', NOW(), false),
('trc_reseed_lcm_002', 'What is the LCM of 12 and 8?', '24', 'LCM(12,8) = (12x8)/GCD(12,8) = 96/4 = 24', 'reseed_lcm', 'math', 'lcm', 'LCM of {a} and {b}', 50, 10, 'public', NOW(), false),
('trc_reseed_lcm_003', 'What is the LCM of 5 and 7?', '35', 'LCM(5,7) = (5x7)/GCD(5,7) = 35/1 = 35', 'reseed_lcm', 'math', 'lcm', 'LCM of {a} and {b}', 50, 10, 'public', NOW(), false),
('trc_reseed_lcm_004', 'What is the LCM of 15 and 20?', '60', 'LCM(15,20) = (15x20)/GCD(15,20) = 300/5 = 60', 'reseed_lcm', 'math', 'lcm', 'LCM of {a} and {b}', 50, 10, 'public', NOW(), false),
('trc_reseed_lcm_005', 'What is the LCM of 9 and 6?', '18', 'LCM(9,6) = (9x6)/GCD(9,6) = 54/3 = 18', 'reseed_lcm', 'math', 'lcm', 'LCM of {a} and {b}', 50, 10, 'public', NOW(), false),
('trc_reseed_lcm_006', 'What is the LCM of 10 and 15?', '30', 'LCM(10,15) = (10x15)/GCD(10,15) = 150/5 = 30', 'reseed_lcm', 'math', 'lcm', 'LCM of {a} and {b}', 50, 10, 'public', NOW(), false)
ON CONFLICT (id) DO UPDATE SET synthesized = false;

-- ============================================
-- MATH: Modulo (6 traces)
-- ============================================
INSERT INTO reasoning_traces (id, input, output, reasoning, pattern_hash, intent_category, intent_name, intent_template, tokens_used, execution_ms, visibility, timestamp, synthesized) VALUES
('trc_reseed_mod_001', 'What is 17 mod 5?', '2', 'Modulo: 17 / 5 = 3 remainder 2', 'reseed_mod', 'math', 'modulo', 'what is {a} mod {b}', 50, 10, 'public', NOW(), false),
('trc_reseed_mod_002', 'What is 100 mod 7?', '2', 'Modulo: 100 / 7 = 14 remainder 2', 'reseed_mod', 'math', 'modulo', 'what is {a} mod {b}', 50, 10, 'public', NOW(), false),
('trc_reseed_mod_003', 'What is 25 mod 4?', '1', 'Modulo: 25 / 4 = 6 remainder 1', 'reseed_mod', 'math', 'modulo', 'what is {a} mod {b}', 50, 10, 'public', NOW(), false),
('trc_reseed_mod_004', 'What is 50 mod 8?', '2', 'Modulo: 50 / 8 = 6 remainder 2', 'reseed_mod', 'math', 'modulo', 'what is {a} mod {b}', 50, 10, 'public', NOW(), false),
('trc_reseed_mod_005', 'What is 33 mod 10?', '3', 'Modulo: 33 / 10 = 3 remainder 3', 'reseed_mod', 'math', 'modulo', 'what is {a} mod {b}', 50, 10, 'public', NOW(), false),
('trc_reseed_mod_006', 'What is 99 mod 11?', '0', 'Modulo: 99 / 11 = 9 remainder 0', 'reseed_mod', 'math', 'modulo', 'what is {a} mod {b}', 50, 10, 'public', NOW(), false)
ON CONFLICT (id) DO UPDATE SET synthesized = false;

-- ============================================
-- MATH: Power / Exponentiation (6 traces)
-- ============================================
INSERT INTO reasoning_traces (id, input, output, reasoning, pattern_hash, intent_category, intent_name, intent_template, tokens_used, execution_ms, visibility, timestamp, synthesized) VALUES
('trc_reseed_pow_001', 'What is 2 to the power of 10?', '1024', 'Power: 2^10 = 1024', 'reseed_pow', 'math', 'power', 'what is {a} to the power of {b}', 50, 10, 'public', NOW(), false),
('trc_reseed_pow_002', 'What is 3 to the power of 4?', '81', 'Power: 3^4 = 81', 'reseed_pow', 'math', 'power', 'what is {a} to the power of {b}', 50, 10, 'public', NOW(), false),
('trc_reseed_pow_003', 'What is 5 to the power of 3?', '125', 'Power: 5^3 = 125', 'reseed_pow', 'math', 'power', 'what is {a} to the power of {b}', 50, 10, 'public', NOW(), false),
('trc_reseed_pow_004', 'What is 10 to the power of 5?', '100000', 'Power: 10^5 = 100000', 'reseed_pow', 'math', 'power', 'what is {a} to the power of {b}', 50, 10, 'public', NOW(), false),
('trc_reseed_pow_005', 'What is 7 to the power of 2?', '49', 'Power: 7^2 = 49', 'reseed_pow', 'math', 'power', 'what is {a} to the power of {b}', 50, 10, 'public', NOW(), false),
('trc_reseed_pow_006', 'What is 4 to the power of 4?', '256', 'Power: 4^4 = 256', 'reseed_pow', 'math', 'power', 'what is {a} to the power of {b}', 50, 10, 'public', NOW(), false)
ON CONFLICT (id) DO UPDATE SET synthesized = false;

-- ============================================
-- MATH: Square Root (6 traces)
-- ============================================
INSERT INTO reasoning_traces (id, input, output, reasoning, pattern_hash, intent_category, intent_name, intent_template, tokens_used, execution_ms, visibility, timestamp, synthesized) VALUES
('trc_reseed_sqrt_001', 'What is the square root of 144?', '12', 'Square root: sqrt(144) = 12', 'reseed_sqrt', 'math', 'square-root', 'square root of {n}', 50, 10, 'public', NOW(), false),
('trc_reseed_sqrt_002', 'What is the square root of 256?', '16', 'Square root: sqrt(256) = 16', 'reseed_sqrt', 'math', 'square-root', 'square root of {n}', 50, 10, 'public', NOW(), false),
('trc_reseed_sqrt_003', 'What is the square root of 81?', '9', 'Square root: sqrt(81) = 9', 'reseed_sqrt', 'math', 'square-root', 'square root of {n}', 50, 10, 'public', NOW(), false),
('trc_reseed_sqrt_004', 'What is the square root of 625?', '25', 'Square root: sqrt(625) = 25', 'reseed_sqrt', 'math', 'square-root', 'square root of {n}', 50, 10, 'public', NOW(), false),
('trc_reseed_sqrt_005', 'What is the square root of 49?', '7', 'Square root: sqrt(49) = 7', 'reseed_sqrt', 'math', 'square-root', 'square root of {n}', 50, 10, 'public', NOW(), false),
('trc_reseed_sqrt_006', 'What is the square root of 400?', '20', 'Square root: sqrt(400) = 20', 'reseed_sqrt', 'math', 'square-root', 'square root of {n}', 50, 10, 'public', NOW(), false)
ON CONFLICT (id) DO UPDATE SET synthesized = false;

-- ============================================
-- CONVERSION: Fahrenheit to Celsius (6 traces)
-- ============================================
INSERT INTO reasoning_traces (id, input, output, reasoning, pattern_hash, intent_category, intent_name, intent_template, tokens_used, execution_ms, visibility, timestamp, synthesized) VALUES
('trc_reseed_f2c_001', 'Convert 212 fahrenheit to celsius', '100', 'Formula: (212 - 32) x 5/9 = 100', 'reseed_f2c', 'conversion', 'fahrenheit-to-celsius', 'convert {n} fahrenheit to celsius', 50, 10, 'public', NOW(), false),
('trc_reseed_f2c_002', 'Convert 98.6 fahrenheit to celsius', '37', 'Formula: (98.6 - 32) x 5/9 = 37', 'reseed_f2c', 'conversion', 'fahrenheit-to-celsius', 'convert {n} fahrenheit to celsius', 50, 10, 'public', NOW(), false),
('trc_reseed_f2c_003', 'Convert 32 fahrenheit to celsius', '0', 'Formula: (32 - 32) x 5/9 = 0', 'reseed_f2c', 'conversion', 'fahrenheit-to-celsius', 'convert {n} fahrenheit to celsius', 50, 10, 'public', NOW(), false),
('trc_reseed_f2c_004', 'Convert 77 fahrenheit to celsius', '25', 'Formula: (77 - 32) x 5/9 = 25', 'reseed_f2c', 'conversion', 'fahrenheit-to-celsius', 'convert {n} fahrenheit to celsius', 50, 10, 'public', NOW(), false),
('trc_reseed_f2c_005', 'Convert -40 fahrenheit to celsius', '-40', 'Formula: (-40 - 32) x 5/9 = -40', 'reseed_f2c', 'conversion', 'fahrenheit-to-celsius', 'convert {n} fahrenheit to celsius', 50, 10, 'public', NOW(), false),
('trc_reseed_f2c_006', 'Convert 68 fahrenheit to celsius', '20', 'Formula: (68 - 32) x 5/9 = 20', 'reseed_f2c', 'conversion', 'fahrenheit-to-celsius', 'convert {n} fahrenheit to celsius', 50, 10, 'public', NOW(), false)
ON CONFLICT (id) DO UPDATE SET synthesized = false;

-- ============================================
-- CONVERSION: Decimal to Hex (6 traces)
-- ============================================
INSERT INTO reasoning_traces (id, input, output, reasoning, pattern_hash, intent_category, intent_name, intent_template, tokens_used, execution_ms, visibility, timestamp, synthesized) VALUES
('trc_reseed_d2h_001', 'Convert 255 to hexadecimal', 'FF', 'Decimal to hex: 255 = FF', 'reseed_d2h', 'conversion', 'decimal-to-hex', 'convert {n} to hexadecimal', 50, 10, 'public', NOW(), false),
('trc_reseed_d2h_002', 'Convert 16 to hexadecimal', '10', 'Decimal to hex: 16 = 10', 'reseed_d2h', 'conversion', 'decimal-to-hex', 'convert {n} to hexadecimal', 50, 10, 'public', NOW(), false),
('trc_reseed_d2h_003', 'Convert 42 to hexadecimal', '2A', 'Decimal to hex: 42 = 2A', 'reseed_d2h', 'conversion', 'decimal-to-hex', 'convert {n} to hexadecimal', 50, 10, 'public', NOW(), false),
('trc_reseed_d2h_004', 'Convert 100 to hexadecimal', '64', 'Decimal to hex: 100 = 64', 'reseed_d2h', 'conversion', 'decimal-to-hex', 'convert {n} to hexadecimal', 50, 10, 'public', NOW(), false),
('trc_reseed_d2h_005', 'Convert 200 to hexadecimal', 'C8', 'Decimal to hex: 200 = C8', 'reseed_d2h', 'conversion', 'decimal-to-hex', 'convert {n} to hexadecimal', 50, 10, 'public', NOW(), false),
('trc_reseed_d2h_006', 'Convert 128 to hexadecimal', '80', 'Decimal to hex: 128 = 80', 'reseed_d2h', 'conversion', 'decimal-to-hex', 'convert {n} to hexadecimal', 50, 10, 'public', NOW(), false)
ON CONFLICT (id) DO UPDATE SET synthesized = false;

-- ============================================
-- CONVERSION: Hex to Decimal (6 traces)
-- ============================================
INSERT INTO reasoning_traces (id, input, output, reasoning, pattern_hash, intent_category, intent_name, intent_template, tokens_used, execution_ms, visibility, timestamp, synthesized) VALUES
('trc_reseed_h2d_001', 'Convert hex FF to decimal', '255', 'Hex to decimal: F=15, FF = 15x16+15 = 255', 'reseed_h2d', 'conversion', 'hex-to-decimal', 'convert hex {n} to decimal', 50, 10, 'public', NOW(), false),
('trc_reseed_h2d_002', 'Convert hex A3 to decimal', '163', 'Hex to decimal: A=10, A3 = 10x16+3 = 163', 'reseed_h2d', 'conversion', 'hex-to-decimal', 'convert hex {n} to decimal', 50, 10, 'public', NOW(), false),
('trc_reseed_h2d_003', 'Convert hex 1F to decimal', '31', 'Hex to decimal: 1F = 1x16+15 = 31', 'reseed_h2d', 'conversion', 'hex-to-decimal', 'convert hex {n} to decimal', 50, 10, 'public', NOW(), false),
('trc_reseed_h2d_004', 'Convert hex C8 to decimal', '200', 'Hex to decimal: C=12, C8 = 12x16+8 = 200', 'reseed_h2d', 'conversion', 'hex-to-decimal', 'convert hex {n} to decimal', 50, 10, 'public', NOW(), false),
('trc_reseed_h2d_005', 'Convert hex 2A to decimal', '42', 'Hex to decimal: 2A = 2x16+10 = 42', 'reseed_h2d', 'conversion', 'hex-to-decimal', 'convert hex {n} to decimal', 50, 10, 'public', NOW(), false),
('trc_reseed_h2d_006', 'Convert hex 64 to decimal', '100', 'Hex to decimal: 64 = 6x16+4 = 100', 'reseed_h2d', 'conversion', 'hex-to-decimal', 'convert hex {n} to decimal', 50, 10, 'public', NOW(), false)
ON CONFLICT (id) DO UPDATE SET synthesized = false;

-- ============================================
-- ENCODING: Base64 Encode (6 traces)
-- ============================================
INSERT INTO reasoning_traces (id, input, output, reasoning, pattern_hash, intent_category, intent_name, intent_template, tokens_used, execution_ms, visibility, timestamp, synthesized) VALUES
('trc_reseed_b64e_001', 'Base64 encode "Hello"', 'SGVsbG8=', 'Base64 encoding: Hello -> SGVsbG8=', 'reseed_b64e', 'encoding', 'base64-encode', 'base64 encode {text}', 50, 10, 'public', NOW(), false),
('trc_reseed_b64e_002', 'Base64 encode "World"', 'V29ybGQ=', 'Base64 encoding: World -> V29ybGQ=', 'reseed_b64e', 'encoding', 'base64-encode', 'base64 encode {text}', 50, 10, 'public', NOW(), false),
('trc_reseed_b64e_003', 'Base64 encode "test"', 'dGVzdA==', 'Base64 encoding: test -> dGVzdA==', 'reseed_b64e', 'encoding', 'base64-encode', 'base64 encode {text}', 50, 10, 'public', NOW(), false),
('trc_reseed_b64e_004', 'Base64 encode "ALF"', 'QUxG', 'Base64 encoding: ALF -> QUxG', 'reseed_b64e', 'encoding', 'base64-encode', 'base64 encode {text}', 50, 10, 'public', NOW(), false),
('trc_reseed_b64e_005', 'Base64 encode "password123"', 'cGFzc3dvcmQxMjM=', 'Base64 encoding: password123 -> cGFzc3dvcmQxMjM=', 'reseed_b64e', 'encoding', 'base64-encode', 'base64 encode {text}', 50, 10, 'public', NOW(), false),
('trc_reseed_b64e_006', 'Base64 encode "data"', 'ZGF0YQ==', 'Base64 encoding: data -> ZGF0YQ==', 'reseed_b64e', 'encoding', 'base64-encode', 'base64 encode {text}', 50, 10, 'public', NOW(), false)
ON CONFLICT (id) DO UPDATE SET synthesized = false;

-- ============================================
-- ENCODING: Base64 Decode (6 traces)
-- ============================================
INSERT INTO reasoning_traces (id, input, output, reasoning, pattern_hash, intent_category, intent_name, intent_template, tokens_used, execution_ms, visibility, timestamp, synthesized) VALUES
('trc_reseed_b64d_001', 'Base64 decode "SGVsbG8="', 'Hello', 'Base64 decoding: SGVsbG8= -> Hello', 'reseed_b64d', 'encoding', 'base64-decode', 'base64 decode {text}', 50, 10, 'public', NOW(), false),
('trc_reseed_b64d_002', 'Base64 decode "V29ybGQ="', 'World', 'Base64 decoding: V29ybGQ= -> World', 'reseed_b64d', 'encoding', 'base64-decode', 'base64 decode {text}', 50, 10, 'public', NOW(), false),
('trc_reseed_b64d_003', 'Base64 decode "dGVzdA=="', 'test', 'Base64 decoding: dGVzdA== -> test', 'reseed_b64d', 'encoding', 'base64-decode', 'base64 decode {text}', 50, 10, 'public', NOW(), false),
('trc_reseed_b64d_004', 'Base64 decode "QUxG"', 'ALF', 'Base64 decoding: QUxG -> ALF', 'reseed_b64d', 'encoding', 'base64-decode', 'base64 decode {text}', 50, 10, 'public', NOW(), false),
('trc_reseed_b64d_005', 'Base64 decode "cGFzc3dvcmQxMjM="', 'password123', 'Base64 decoding: cGFzc3dvcmQxMjM= -> password123', 'reseed_b64d', 'encoding', 'base64-decode', 'base64 decode {text}', 50, 10, 'public', NOW(), false),
('trc_reseed_b64d_006', 'Base64 decode "ZGF0YQ=="', 'data', 'Base64 decoding: ZGF0YQ== -> data', 'reseed_b64d', 'encoding', 'base64-decode', 'base64 decode {text}', 50, 10, 'public', NOW(), false)
ON CONFLICT (id) DO UPDATE SET synthesized = false;

-- ============================================
-- ENCODING: URL Encode (6 traces)
-- ============================================
INSERT INTO reasoning_traces (id, input, output, reasoning, pattern_hash, intent_category, intent_name, intent_template, tokens_used, execution_ms, visibility, timestamp, synthesized) VALUES
('trc_reseed_urle_001', 'URL encode "hello world"', 'hello%20world', 'URL encoding: space -> %20', 'reseed_urle', 'encoding', 'url-encode', 'url encode {text}', 50, 10, 'public', NOW(), false),
('trc_reseed_urle_002', 'URL encode "foo bar"', 'foo%20bar', 'URL encoding: space -> %20', 'reseed_urle', 'encoding', 'url-encode', 'url encode {text}', 50, 10, 'public', NOW(), false),
('trc_reseed_urle_003', 'URL encode "a&b=c"', 'a%26b%3Dc', 'URL encoding: & -> %26, = -> %3D', 'reseed_urle', 'encoding', 'url-encode', 'url encode {text}', 50, 10, 'public', NOW(), false),
('trc_reseed_urle_004', 'URL encode "test@email.com"', 'test%40email.com', 'URL encoding: @ -> %40', 'reseed_urle', 'encoding', 'url-encode', 'url encode {text}', 50, 10, 'public', NOW(), false),
('trc_reseed_urle_005', 'URL encode "price: $50"', 'price%3A%20%2450', 'URL encoding: : -> %3A, space -> %20, $ -> %24', 'reseed_urle', 'encoding', 'url-encode', 'url encode {text}', 50, 10, 'public', NOW(), false),
('trc_reseed_urle_006', 'URL encode "path/to file"', 'path%2Fto%20file', 'URL encoding: / -> %2F, space -> %20', 'reseed_urle', 'encoding', 'url-encode', 'url encode {text}', 50, 10, 'public', NOW(), false)
ON CONFLICT (id) DO UPDATE SET synthesized = false;

-- ============================================
-- ENCODING: URL Decode (6 traces)
-- ============================================
INSERT INTO reasoning_traces (id, input, output, reasoning, pattern_hash, intent_category, intent_name, intent_template, tokens_used, execution_ms, visibility, timestamp, synthesized) VALUES
('trc_reseed_urld_001', 'URL decode "hello%20world"', 'hello world', 'URL decoding: %20 -> space', 'reseed_urld', 'encoding', 'url-decode', 'url decode {text}', 50, 10, 'public', NOW(), false),
('trc_reseed_urld_002', 'URL decode "foo%20bar"', 'foo bar', 'URL decoding: %20 -> space', 'reseed_urld', 'encoding', 'url-decode', 'url decode {text}', 50, 10, 'public', NOW(), false),
('trc_reseed_urld_003', 'URL decode "a%26b%3Dc"', 'a&b=c', 'URL decoding: %26 -> &, %3D -> =', 'reseed_urld', 'encoding', 'url-decode', 'url decode {text}', 50, 10, 'public', NOW(), false),
('trc_reseed_urld_004', 'URL decode "test%40email.com"', 'test@email.com', 'URL decoding: %40 -> @', 'reseed_urld', 'encoding', 'url-decode', 'url decode {text}', 50, 10, 'public', NOW(), false),
('trc_reseed_urld_005', 'URL decode "price%3A%20%2450"', 'price: $50', 'URL decoding: %3A -> :, %20 -> space, %24 -> $', 'reseed_urld', 'encoding', 'url-decode', 'url decode {text}', 50, 10, 'public', NOW(), false),
('trc_reseed_urld_006', 'URL decode "path%2Fto%20file"', 'path/to file', 'URL decoding: %2F -> /, %20 -> space', 'reseed_urld', 'encoding', 'url-decode', 'url decode {text}', 50, 10, 'public', NOW(), false)
ON CONFLICT (id) DO UPDATE SET synthesized = false;

-- ============================================
-- TEXT: Capitalize / Title Case (6 traces)
-- ============================================
INSERT INTO reasoning_traces (id, input, output, reasoning, pattern_hash, intent_category, intent_name, intent_template, tokens_used, execution_ms, visibility, timestamp, synthesized) VALUES
('trc_reseed_cap_001', 'Capitalize "hello world"', 'Hello World', 'Title case: capitalize first letter of each word', 'reseed_cap', 'transform', 'capitalize', 'capitalize {text}', 50, 10, 'public', NOW(), false),
('trc_reseed_cap_002', 'Capitalize "the quick brown fox"', 'The Quick Brown Fox', 'Title case: capitalize first letter of each word', 'reseed_cap', 'transform', 'capitalize', 'capitalize {text}', 50, 10, 'public', NOW(), false),
('trc_reseed_cap_003', 'Capitalize "data science"', 'Data Science', 'Title case: capitalize first letter of each word', 'reseed_cap', 'transform', 'capitalize', 'capitalize {text}', 50, 10, 'public', NOW(), false),
('trc_reseed_cap_004', 'Capitalize "machine learning basics"', 'Machine Learning Basics', 'Title case: capitalize first letter of each word', 'reseed_cap', 'transform', 'capitalize', 'capitalize {text}', 50, 10, 'public', NOW(), false),
('trc_reseed_cap_005', 'Capitalize "open source software"', 'Open Source Software', 'Title case: capitalize first letter of each word', 'reseed_cap', 'transform', 'capitalize', 'capitalize {text}', 50, 10, 'public', NOW(), false),
('trc_reseed_cap_006', 'Capitalize "artificial intelligence"', 'Artificial Intelligence', 'Title case: capitalize first letter of each word', 'reseed_cap', 'transform', 'capitalize', 'capitalize {text}', 50, 10, 'public', NOW(), false)
ON CONFLICT (id) DO UPDATE SET synthesized = false;

-- ============================================
-- TEXT: Slug Generator (6 traces)
-- ============================================
INSERT INTO reasoning_traces (id, input, output, reasoning, pattern_hash, intent_category, intent_name, intent_template, tokens_used, execution_ms, visibility, timestamp, synthesized) VALUES
('trc_reseed_slug_001', 'Convert "Hello World" to a slug', 'hello-world', 'Slug: lowercase, replace spaces with hyphens', 'reseed_slug', 'transform', 'to-slug', 'convert {text} to a slug', 50, 10, 'public', NOW(), false),
('trc_reseed_slug_002', 'Convert "My Blog Post Title" to a slug', 'my-blog-post-title', 'Slug: lowercase, replace spaces with hyphens', 'reseed_slug', 'transform', 'to-slug', 'convert {text} to a slug', 50, 10, 'public', NOW(), false),
('trc_reseed_slug_003', 'Convert "User Profile Settings" to a slug', 'user-profile-settings', 'Slug: lowercase, replace spaces with hyphens', 'reseed_slug', 'transform', 'to-slug', 'convert {text} to a slug', 50, 10, 'public', NOW(), false),
('trc_reseed_slug_004', 'Convert "Data Science Tutorial" to a slug', 'data-science-tutorial', 'Slug: lowercase, replace spaces with hyphens', 'reseed_slug', 'transform', 'to-slug', 'convert {text} to a slug', 50, 10, 'public', NOW(), false),
('trc_reseed_slug_005', 'Convert "API Design Guide" to a slug', 'api-design-guide', 'Slug: lowercase, replace spaces with hyphens', 'reseed_slug', 'transform', 'to-slug', 'convert {text} to a slug', 50, 10, 'public', NOW(), false),
('trc_reseed_slug_006', 'Convert "Getting Started Now" to a slug', 'getting-started-now', 'Slug: lowercase, replace spaces with hyphens', 'reseed_slug', 'transform', 'to-slug', 'convert {text} to a slug', 50, 10, 'public', NOW(), false)
ON CONFLICT (id) DO UPDATE SET synthesized = false;

-- ============================================
-- TEXT: Count Vowels (6 traces)
-- ============================================
INSERT INTO reasoning_traces (id, input, output, reasoning, pattern_hash, intent_category, intent_name, intent_template, tokens_used, execution_ms, visibility, timestamp, synthesized) VALUES
('trc_reseed_vowel_001', 'Count vowels in "education"', '5', 'Vowels: e,u,a,i,o = 5 vowels', 'reseed_vowel', 'analysis', 'count-vowels', 'count vowels in {text}', 50, 10, 'public', NOW(), false),
('trc_reseed_vowel_002', 'Count vowels in "hello"', '2', 'Vowels: e,o = 2 vowels', 'reseed_vowel', 'analysis', 'count-vowels', 'count vowels in {text}', 50, 10, 'public', NOW(), false),
('trc_reseed_vowel_003', 'Count vowels in "algorithm"', '3', 'Vowels: a,o,i = 3 vowels', 'reseed_vowel', 'analysis', 'count-vowels', 'count vowels in {text}', 50, 10, 'public', NOW(), false),
('trc_reseed_vowel_004', 'Count vowels in "programming"', '3', 'Vowels: o,a,i = 3 vowels', 'reseed_vowel', 'analysis', 'count-vowels', 'count vowels in {text}', 50, 10, 'public', NOW(), false),
('trc_reseed_vowel_005', 'Count vowels in "universe"', '4', 'Vowels: u,i,e,e = 4 vowels', 'reseed_vowel', 'analysis', 'count-vowels', 'count vowels in {text}', 50, 10, 'public', NOW(), false),
('trc_reseed_vowel_006', 'Count vowels in "sky"', '0', 'No vowels found', 'reseed_vowel', 'analysis', 'count-vowels', 'count vowels in {text}', 50, 10, 'public', NOW(), false)
ON CONFLICT (id) DO UPDATE SET synthesized = false;

-- ============================================
-- TEXT: Extract Numbers (6 traces)
-- ============================================
INSERT INTO reasoning_traces (id, input, output, reasoning, pattern_hash, intent_category, intent_name, intent_template, tokens_used, execution_ms, visibility, timestamp, synthesized) VALUES
('trc_reseed_extn_001', 'Extract numbers from "I have 3 cats and 2 dogs"', '3, 2', 'Number extraction: found 3 and 2', 'reseed_extn', 'analysis', 'extract-numbers', 'extract numbers from {text}', 50, 10, 'public', NOW(), false),
('trc_reseed_extn_002', 'Extract numbers from "Room 404 on floor 5"', '404, 5', 'Number extraction: found 404 and 5', 'reseed_extn', 'analysis', 'extract-numbers', 'extract numbers from {text}', 50, 10, 'public', NOW(), false),
('trc_reseed_extn_003', 'Extract numbers from "Price is $29.99 with 10% off"', '29.99, 10', 'Number extraction: found 29.99 and 10', 'reseed_extn', 'analysis', 'extract-numbers', 'extract numbers from {text}', 50, 10, 'public', NOW(), false),
('trc_reseed_extn_004', 'Extract numbers from "Born in 1990, age 35"', '1990, 35', 'Number extraction: found 1990 and 35', 'reseed_extn', 'analysis', 'extract-numbers', 'extract numbers from {text}', 50, 10, 'public', NOW(), false),
('trc_reseed_extn_005', 'Extract numbers from "100 meters in 9.58 seconds"', '100, 9.58', 'Number extraction: found 100 and 9.58', 'reseed_extn', 'analysis', 'extract-numbers', 'extract numbers from {text}', 50, 10, 'public', NOW(), false),
('trc_reseed_extn_006', 'Extract numbers from "Chapter 7 page 142"', '7, 142', 'Number extraction: found 7 and 142', 'reseed_extn', 'analysis', 'extract-numbers', 'extract numbers from {text}', 50, 10, 'public', NOW(), false)
ON CONFLICT (id) DO UPDATE SET synthesized = false;

-- ============================================
-- GEOMETRY: Circle Area (6 traces)
-- ============================================
INSERT INTO reasoning_traces (id, input, output, reasoning, pattern_hash, intent_category, intent_name, intent_template, tokens_used, execution_ms, visibility, timestamp, synthesized) VALUES
('trc_reseed_carea_001', 'What is the area of a circle with radius 5?', '78.54', 'Circle area: pi x r^2 = 3.14159 x 25 = 78.54', 'reseed_carea', 'geometry', 'circle-area', 'area of a circle with radius {r}', 50, 10, 'public', NOW(), false),
('trc_reseed_carea_002', 'What is the area of a circle with radius 10?', '314.16', 'Circle area: pi x r^2 = 3.14159 x 100 = 314.16', 'reseed_carea', 'geometry', 'circle-area', 'area of a circle with radius {r}', 50, 10, 'public', NOW(), false),
('trc_reseed_carea_003', 'What is the area of a circle with radius 3?', '28.27', 'Circle area: pi x r^2 = 3.14159 x 9 = 28.27', 'reseed_carea', 'geometry', 'circle-area', 'area of a circle with radius {r}', 50, 10, 'public', NOW(), false),
('trc_reseed_carea_004', 'What is the area of a circle with radius 7?', '153.94', 'Circle area: pi x r^2 = 3.14159 x 49 = 153.94', 'reseed_carea', 'geometry', 'circle-area', 'area of a circle with radius {r}', 50, 10, 'public', NOW(), false),
('trc_reseed_carea_005', 'What is the area of a circle with radius 1?', '3.14', 'Circle area: pi x r^2 = 3.14159 x 1 = 3.14', 'reseed_carea', 'geometry', 'circle-area', 'area of a circle with radius {r}', 50, 10, 'public', NOW(), false),
('trc_reseed_carea_006', 'What is the area of a circle with radius 12?', '452.39', 'Circle area: pi x r^2 = 3.14159 x 144 = 452.39', 'reseed_carea', 'geometry', 'circle-area', 'area of a circle with radius {r}', 50, 10, 'public', NOW(), false)
ON CONFLICT (id) DO UPDATE SET synthesized = false;

-- ============================================
-- GEOMETRY: Triangle Area (6 traces)
-- ============================================
INSERT INTO reasoning_traces (id, input, output, reasoning, pattern_hash, intent_category, intent_name, intent_template, tokens_used, execution_ms, visibility, timestamp, synthesized) VALUES
('trc_reseed_tarea_001', 'What is the area of a triangle with base 10 and height 6?', '30', 'Triangle: (base x height) / 2 = (10 x 6) / 2 = 30', 'reseed_tarea', 'geometry', 'triangle-area', 'area of a triangle with base {b} and height {h}', 50, 10, 'public', NOW(), false),
('trc_reseed_tarea_002', 'What is the area of a triangle with base 8 and height 5?', '20', 'Triangle: (8 x 5) / 2 = 20', 'reseed_tarea', 'geometry', 'triangle-area', 'area of a triangle with base {b} and height {h}', 50, 10, 'public', NOW(), false),
('trc_reseed_tarea_003', 'What is the area of a triangle with base 12 and height 9?', '54', 'Triangle: (12 x 9) / 2 = 54', 'reseed_tarea', 'geometry', 'triangle-area', 'area of a triangle with base {b} and height {h}', 50, 10, 'public', NOW(), false),
('trc_reseed_tarea_004', 'What is the area of a triangle with base 20 and height 15?', '150', 'Triangle: (20 x 15) / 2 = 150', 'reseed_tarea', 'geometry', 'triangle-area', 'area of a triangle with base {b} and height {h}', 50, 10, 'public', NOW(), false),
('trc_reseed_tarea_005', 'What is the area of a triangle with base 7 and height 4?', '14', 'Triangle: (7 x 4) / 2 = 14', 'reseed_tarea', 'geometry', 'triangle-area', 'area of a triangle with base {b} and height {h}', 50, 10, 'public', NOW(), false),
('trc_reseed_tarea_006', 'What is the area of a triangle with base 15 and height 10?', '75', 'Triangle: (15 x 10) / 2 = 75', 'reseed_tarea', 'geometry', 'triangle-area', 'area of a triangle with base {b} and height {h}', 50, 10, 'public', NOW(), false)
ON CONFLICT (id) DO UPDATE SET synthesized = false;

-- ============================================
-- GEOMETRY: Rectangle Area (6 traces)
-- ============================================
INSERT INTO reasoning_traces (id, input, output, reasoning, pattern_hash, intent_category, intent_name, intent_template, tokens_used, execution_ms, visibility, timestamp, synthesized) VALUES
('trc_reseed_rarea_001', 'What is the area of a rectangle 8 by 5?', '40', 'Rectangle: length x width = 8 x 5 = 40', 'reseed_rarea', 'geometry', 'rectangle-area', 'area of a rectangle {l} by {w}', 50, 10, 'public', NOW(), false),
('trc_reseed_rarea_002', 'What is the area of a rectangle 12 by 7?', '84', 'Rectangle: 12 x 7 = 84', 'reseed_rarea', 'geometry', 'rectangle-area', 'area of a rectangle {l} by {w}', 50, 10, 'public', NOW(), false),
('trc_reseed_rarea_003', 'What is the area of a rectangle 15 by 10?', '150', 'Rectangle: 15 x 10 = 150', 'reseed_rarea', 'geometry', 'rectangle-area', 'area of a rectangle {l} by {w}', 50, 10, 'public', NOW(), false),
('trc_reseed_rarea_004', 'What is the area of a rectangle 20 by 3?', '60', 'Rectangle: 20 x 3 = 60', 'reseed_rarea', 'geometry', 'rectangle-area', 'area of a rectangle {l} by {w}', 50, 10, 'public', NOW(), false),
('trc_reseed_rarea_005', 'What is the area of a rectangle 6 by 6?', '36', 'Rectangle: 6 x 6 = 36', 'reseed_rarea', 'geometry', 'rectangle-area', 'area of a rectangle {l} by {w}', 50, 10, 'public', NOW(), false),
('trc_reseed_rarea_006', 'What is the area of a rectangle 25 by 4?', '100', 'Rectangle: 25 x 4 = 100', 'reseed_rarea', 'geometry', 'rectangle-area', 'area of a rectangle {l} by {w}', 50, 10, 'public', NOW(), false)
ON CONFLICT (id) DO UPDATE SET synthesized = false;

-- ============================================
-- FINANCE: Simple Interest (6 traces)
-- ============================================
INSERT INTO reasoning_traces (id, input, output, reasoning, pattern_hash, intent_category, intent_name, intent_template, tokens_used, execution_ms, visibility, timestamp, synthesized) VALUES
('trc_reseed_sint_001', 'Simple interest on $1000 at 5% for 3 years?', '$150', 'SI = P x r x t = 1000 x 0.05 x 3 = $150', 'reseed_sint', 'finance', 'simple-interest', 'simple interest on {principal} at {rate} for {time}', 50, 10, 'public', NOW(), false),
('trc_reseed_sint_002', 'Simple interest on $5000 at 3% for 2 years?', '$300', 'SI = 5000 x 0.03 x 2 = $300', 'reseed_sint', 'finance', 'simple-interest', 'simple interest on {principal} at {rate} for {time}', 50, 10, 'public', NOW(), false),
('trc_reseed_sint_003', 'Simple interest on $2000 at 8% for 1 year?', '$160', 'SI = 2000 x 0.08 x 1 = $160', 'reseed_sint', 'finance', 'simple-interest', 'simple interest on {principal} at {rate} for {time}', 50, 10, 'public', NOW(), false),
('trc_reseed_sint_004', 'Simple interest on $10000 at 4% for 5 years?', '$2000', 'SI = 10000 x 0.04 x 5 = $2000', 'reseed_sint', 'finance', 'simple-interest', 'simple interest on {principal} at {rate} for {time}', 50, 10, 'public', NOW(), false),
('trc_reseed_sint_005', 'Simple interest on $500 at 10% for 2 years?', '$100', 'SI = 500 x 0.10 x 2 = $100', 'reseed_sint', 'finance', 'simple-interest', 'simple interest on {principal} at {rate} for {time}', 50, 10, 'public', NOW(), false),
('trc_reseed_sint_006', 'Simple interest on $3000 at 6% for 4 years?', '$720', 'SI = 3000 x 0.06 x 4 = $720', 'reseed_sint', 'finance', 'simple-interest', 'simple interest on {principal} at {rate} for {time}', 50, 10, 'public', NOW(), false)
ON CONFLICT (id) DO UPDATE SET synthesized = false;

-- ============================================
-- FINANCE: Tip Calculator (6 traces)
-- ============================================
INSERT INTO reasoning_traces (id, input, output, reasoning, pattern_hash, intent_category, intent_name, intent_template, tokens_used, execution_ms, visibility, timestamp, synthesized) VALUES
('trc_reseed_tip_001', 'What is a 20% tip on $50?', '$10', 'Tip: 20% of $50 = 0.20 x 50 = $10', 'reseed_tip', 'finance', 'calculate-tip', 'what is a {p}% tip on {amount}', 50, 10, 'public', NOW(), false),
('trc_reseed_tip_002', 'What is a 15% tip on $80?', '$12', 'Tip: 15% of $80 = 0.15 x 80 = $12', 'reseed_tip', 'finance', 'calculate-tip', 'what is a {p}% tip on {amount}', 50, 10, 'public', NOW(), false),
('trc_reseed_tip_003', 'What is a 18% tip on $100?', '$18', 'Tip: 18% of $100 = 0.18 x 100 = $18', 'reseed_tip', 'finance', 'calculate-tip', 'what is a {p}% tip on {amount}', 50, 10, 'public', NOW(), false),
('trc_reseed_tip_004', 'What is a 20% tip on $35?', '$7', 'Tip: 20% of $35 = 0.20 x 35 = $7', 'reseed_tip', 'finance', 'calculate-tip', 'what is a {p}% tip on {amount}', 50, 10, 'public', NOW(), false),
('trc_reseed_tip_005', 'What is a 25% tip on $60?', '$15', 'Tip: 25% of $60 = 0.25 x 60 = $15', 'reseed_tip', 'finance', 'calculate-tip', 'what is a {p}% tip on {amount}', 50, 10, 'public', NOW(), false),
('trc_reseed_tip_006', 'What is a 10% tip on $120?', '$12', 'Tip: 10% of $120 = 0.10 x 120 = $12', 'reseed_tip', 'finance', 'calculate-tip', 'what is a {p}% tip on {amount}', 50, 10, 'public', NOW(), false)
ON CONFLICT (id) DO UPDATE SET synthesized = false;

-- ============================================
-- FINANCE: Discount Calculator (6 traces)
-- ============================================
INSERT INTO reasoning_traces (id, input, output, reasoning, pattern_hash, intent_category, intent_name, intent_template, tokens_used, execution_ms, visibility, timestamp, synthesized) VALUES
('trc_reseed_disc_001', 'Price after 30% discount on $150?', '$105', 'Discount: $150 - (0.30 x $150) = $150 - $45 = $105', 'reseed_disc', 'finance', 'apply-discount', 'price after {p}% discount on {price}', 50, 10, 'public', NOW(), false),
('trc_reseed_disc_002', 'Price after 20% discount on $80?', '$64', 'Discount: $80 - (0.20 x $80) = $80 - $16 = $64', 'reseed_disc', 'finance', 'apply-discount', 'price after {p}% discount on {price}', 50, 10, 'public', NOW(), false),
('trc_reseed_disc_003', 'Price after 50% discount on $200?', '$100', 'Discount: $200 - (0.50 x $200) = $200 - $100 = $100', 'reseed_disc', 'finance', 'apply-discount', 'price after {p}% discount on {price}', 50, 10, 'public', NOW(), false),
('trc_reseed_disc_004', 'Price after 10% discount on $50?', '$45', 'Discount: $50 - (0.10 x $50) = $50 - $5 = $45', 'reseed_disc', 'finance', 'apply-discount', 'price after {p}% discount on {price}', 50, 10, 'public', NOW(), false),
('trc_reseed_disc_005', 'Price after 25% discount on $120?', '$90', 'Discount: $120 - (0.25 x $120) = $120 - $30 = $90', 'reseed_disc', 'finance', 'apply-discount', 'price after {p}% discount on {price}', 50, 10, 'public', NOW(), false),
('trc_reseed_disc_006', 'Price after 15% discount on $60?', '$51', 'Discount: $60 - (0.15 x $60) = $60 - $9 = $51', 'reseed_disc', 'finance', 'apply-discount', 'price after {p}% discount on {price}', 50, 10, 'public', NOW(), false)
ON CONFLICT (id) DO UPDATE SET synthesized = false;

-- ============================================
-- TIME: Hours to Minutes (6 traces)
-- ============================================
INSERT INTO reasoning_traces (id, input, output, reasoning, pattern_hash, intent_category, intent_name, intent_template, tokens_used, execution_ms, visibility, timestamp, synthesized) VALUES
('trc_reseed_h2m_001', 'Convert 2.5 hours to minutes', '150 minutes', 'Time: 2.5 x 60 = 150 minutes', 'reseed_h2m', 'conversion', 'hours-to-minutes', 'convert {n} hours to minutes', 50, 10, 'public', NOW(), false),
('trc_reseed_h2m_002', 'Convert 3 hours to minutes', '180 minutes', 'Time: 3 x 60 = 180 minutes', 'reseed_h2m', 'conversion', 'hours-to-minutes', 'convert {n} hours to minutes', 50, 10, 'public', NOW(), false),
('trc_reseed_h2m_003', 'Convert 1.5 hours to minutes', '90 minutes', 'Time: 1.5 x 60 = 90 minutes', 'reseed_h2m', 'conversion', 'hours-to-minutes', 'convert {n} hours to minutes', 50, 10, 'public', NOW(), false),
('trc_reseed_h2m_004', 'Convert 0.5 hours to minutes', '30 minutes', 'Time: 0.5 x 60 = 30 minutes', 'reseed_h2m', 'conversion', 'hours-to-minutes', 'convert {n} hours to minutes', 50, 10, 'public', NOW(), false),
('trc_reseed_h2m_005', 'Convert 8 hours to minutes', '480 minutes', 'Time: 8 x 60 = 480 minutes', 'reseed_h2m', 'conversion', 'hours-to-minutes', 'convert {n} hours to minutes', 50, 10, 'public', NOW(), false),
('trc_reseed_h2m_006', 'Convert 4.25 hours to minutes', '255 minutes', 'Time: 4.25 x 60 = 255 minutes', 'reseed_h2m', 'conversion', 'hours-to-minutes', 'convert {n} hours to minutes', 50, 10, 'public', NOW(), false)
ON CONFLICT (id) DO UPDATE SET synthesized = false;

-- ============================================
-- WEIGHT: Pounds to KG (6 traces)
-- ============================================
INSERT INTO reasoning_traces (id, input, output, reasoning, pattern_hash, intent_category, intent_name, intent_template, tokens_used, execution_ms, visibility, timestamp, synthesized) VALUES
('trc_reseed_lb2kg_001', 'Convert 150 pounds to kilograms', '68.04 kg', 'Weight: 150 x 0.4536 = 68.04 kg', 'reseed_lb2kg', 'conversion', 'pounds-to-kg', 'convert {n} pounds to kilograms', 50, 10, 'public', NOW(), false),
('trc_reseed_lb2kg_002', 'Convert 200 pounds to kilograms', '90.72 kg', 'Weight: 200 x 0.4536 = 90.72 kg', 'reseed_lb2kg', 'conversion', 'pounds-to-kg', 'convert {n} pounds to kilograms', 50, 10, 'public', NOW(), false),
('trc_reseed_lb2kg_003', 'Convert 100 pounds to kilograms', '45.36 kg', 'Weight: 100 x 0.4536 = 45.36 kg', 'reseed_lb2kg', 'conversion', 'pounds-to-kg', 'convert {n} pounds to kilograms', 50, 10, 'public', NOW(), false),
('trc_reseed_lb2kg_004', 'Convert 175 pounds to kilograms', '79.38 kg', 'Weight: 175 x 0.4536 = 79.38 kg', 'reseed_lb2kg', 'conversion', 'pounds-to-kg', 'convert {n} pounds to kilograms', 50, 10, 'public', NOW(), false),
('trc_reseed_lb2kg_005', 'Convert 220 pounds to kilograms', '99.79 kg', 'Weight: 220 x 0.4536 = 99.79 kg', 'reseed_lb2kg', 'conversion', 'pounds-to-kg', 'convert {n} pounds to kilograms', 50, 10, 'public', NOW(), false),
('trc_reseed_lb2kg_006', 'Convert 130 pounds to kilograms', '58.97 kg', 'Weight: 130 x 0.4536 = 58.97 kg', 'reseed_lb2kg', 'conversion', 'pounds-to-kg', 'convert {n} pounds to kilograms', 50, 10, 'public', NOW(), false)
ON CONFLICT (id) DO UPDATE SET synthesized = false;

-- ============================================
-- LENGTH: Inches to CM (6 traces)
-- ============================================
INSERT INTO reasoning_traces (id, input, output, reasoning, pattern_hash, intent_category, intent_name, intent_template, tokens_used, execution_ms, visibility, timestamp, synthesized) VALUES
('trc_reseed_in2cm_001', 'Convert 12 inches to centimeters', '30.48 cm', 'Length: 12 x 2.54 = 30.48 cm', 'reseed_in2cm', 'conversion', 'inches-to-cm', 'convert {n} inches to centimeters', 50, 10, 'public', NOW(), false),
('trc_reseed_in2cm_002', 'Convert 6 inches to centimeters', '15.24 cm', 'Length: 6 x 2.54 = 15.24 cm', 'reseed_in2cm', 'conversion', 'inches-to-cm', 'convert {n} inches to centimeters', 50, 10, 'public', NOW(), false),
('trc_reseed_in2cm_003', 'Convert 24 inches to centimeters', '60.96 cm', 'Length: 24 x 2.54 = 60.96 cm', 'reseed_in2cm', 'conversion', 'inches-to-cm', 'convert {n} inches to centimeters', 50, 10, 'public', NOW(), false),
('trc_reseed_in2cm_004', 'Convert 36 inches to centimeters', '91.44 cm', 'Length: 36 x 2.54 = 91.44 cm', 'reseed_in2cm', 'conversion', 'inches-to-cm', 'convert {n} inches to centimeters', 50, 10, 'public', NOW(), false),
('trc_reseed_in2cm_005', 'Convert 5 inches to centimeters', '12.7 cm', 'Length: 5 x 2.54 = 12.7 cm', 'reseed_in2cm', 'conversion', 'inches-to-cm', 'convert {n} inches to centimeters', 50, 10, 'public', NOW(), false),
('trc_reseed_in2cm_006', 'Convert 18 inches to centimeters', '45.72 cm', 'Length: 18 x 2.54 = 45.72 cm', 'reseed_in2cm', 'conversion', 'inches-to-cm', 'convert {n} inches to centimeters', 50, 10, 'public', NOW(), false)
ON CONFLICT (id) DO UPDATE SET synthesized = false;

-- ============================================
-- Verify: Show new trace clusters ready for crystallization
-- ============================================
SELECT intent_template, COUNT(*) as traces
FROM reasoning_traces
WHERE synthesized = false AND id LIKE 'trc_reseed_%'
GROUP BY intent_template
ORDER BY intent_template;
