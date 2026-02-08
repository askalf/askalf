-- ============================================
-- CRYSTALLIZATION SEED
-- Traces designed to trigger crystallization
-- Requires 5+ traces per intent_template cluster
-- ============================================

-- ============================================
-- ADDITION - Same template, 6 variations
-- ============================================
INSERT INTO reasoning_traces (id, input, output, reasoning, pattern_hash, intent_category, intent_name, intent_template, tokens_used, execution_ms, visibility, timestamp, synthesized) VALUES
('trc_cryst_add_001', 'What is 15 + 27?', '42', 'Addition: 15 + 27 = 42', 'cryst_add', 'math', 'addition', 'add {a} + {b}', 50, 10, 'public', NOW(), false),
('trc_cryst_add_002', 'What is 100 + 250?', '350', 'Addition: 100 + 250 = 350', 'cryst_add', 'math', 'addition', 'add {a} + {b}', 50, 10, 'public', NOW(), false),
('trc_cryst_add_003', 'What is 7 + 8?', '15', 'Addition: 7 + 8 = 15', 'cryst_add', 'math', 'addition', 'add {a} + {b}', 50, 10, 'public', NOW(), false),
('trc_cryst_add_004', 'What is 999 + 1?', '1000', 'Addition: 999 + 1 = 1000', 'cryst_add', 'math', 'addition', 'add {a} + {b}', 50, 10, 'public', NOW(), false),
('trc_cryst_add_005', 'What is 50 + 50?', '100', 'Addition: 50 + 50 = 100', 'cryst_add', 'math', 'addition', 'add {a} + {b}', 50, 10, 'public', NOW(), false),
('trc_cryst_add_006', 'What is 123 + 456?', '579', 'Addition: 123 + 456 = 579', 'cryst_add', 'math', 'addition', 'add {a} + {b}', 50, 10, 'public', NOW(), false)
ON CONFLICT (id) DO UPDATE SET synthesized = false;

-- ============================================
-- SUBTRACTION - Same template, 6 variations
-- ============================================
INSERT INTO reasoning_traces (id, input, output, reasoning, pattern_hash, intent_category, intent_name, intent_template, tokens_used, execution_ms, visibility, timestamp, synthesized) VALUES
('trc_cryst_sub_001', 'What is 100 - 37?', '63', 'Subtraction: 100 - 37 = 63', 'cryst_sub', 'math', 'subtraction', 'subtract {a} - {b}', 50, 10, 'public', NOW(), false),
('trc_cryst_sub_002', 'What is 500 - 123?', '377', 'Subtraction: 500 - 123 = 377', 'cryst_sub', 'math', 'subtraction', 'subtract {a} - {b}', 50, 10, 'public', NOW(), false),
('trc_cryst_sub_003', 'What is 1000 - 1?', '999', 'Subtraction: 1000 - 1 = 999', 'cryst_sub', 'math', 'subtraction', 'subtract {a} - {b}', 50, 10, 'public', NOW(), false),
('trc_cryst_sub_004', 'What is 75 - 25?', '50', 'Subtraction: 75 - 25 = 50', 'cryst_sub', 'math', 'subtraction', 'subtract {a} - {b}', 50, 10, 'public', NOW(), false),
('trc_cryst_sub_005', 'What is 200 - 50?', '150', 'Subtraction: 200 - 50 = 150', 'cryst_sub', 'math', 'subtraction', 'subtract {a} - {b}', 50, 10, 'public', NOW(), false),
('trc_cryst_sub_006', 'What is 88 - 11?', '77', 'Subtraction: 88 - 11 = 77', 'cryst_sub', 'math', 'subtraction', 'subtract {a} - {b}', 50, 10, 'public', NOW(), false)
ON CONFLICT (id) DO UPDATE SET synthesized = false;

-- ============================================
-- MULTIPLICATION - Same template, 6 variations
-- ============================================
INSERT INTO reasoning_traces (id, input, output, reasoning, pattern_hash, intent_category, intent_name, intent_template, tokens_used, execution_ms, visibility, timestamp, synthesized) VALUES
('trc_cryst_mult_001', 'What is 12 * 12?', '144', 'Multiplication: 12 * 12 = 144', 'cryst_mult', 'math', 'multiplication', 'multiply {a} * {b}', 50, 10, 'public', NOW(), false),
('trc_cryst_mult_002', 'What is 25 * 4?', '100', 'Multiplication: 25 * 4 = 100', 'cryst_mult', 'math', 'multiplication', 'multiply {a} * {b}', 50, 10, 'public', NOW(), false),
('trc_cryst_mult_003', 'What is 7 * 8?', '56', 'Multiplication: 7 * 8 = 56', 'cryst_mult', 'math', 'multiplication', 'multiply {a} * {b}', 50, 10, 'public', NOW(), false),
('trc_cryst_mult_004', 'What is 100 * 10?', '1000', 'Multiplication: 100 * 10 = 1000', 'cryst_mult', 'math', 'multiplication', 'multiply {a} * {b}', 50, 10, 'public', NOW(), false),
('trc_cryst_mult_005', 'What is 9 * 9?', '81', 'Multiplication: 9 * 9 = 81', 'cryst_mult', 'math', 'multiplication', 'multiply {a} * {b}', 50, 10, 'public', NOW(), false),
('trc_cryst_mult_006', 'What is 15 * 3?', '45', 'Multiplication: 15 * 3 = 45', 'cryst_mult', 'math', 'multiplication', 'multiply {a} * {b}', 50, 10, 'public', NOW(), false)
ON CONFLICT (id) DO UPDATE SET synthesized = false;

-- ============================================
-- DIVISION - Same template, 6 variations
-- ============================================
INSERT INTO reasoning_traces (id, input, output, reasoning, pattern_hash, intent_category, intent_name, intent_template, tokens_used, execution_ms, visibility, timestamp, synthesized) VALUES
('trc_cryst_div_001', 'What is 144 / 12?', '12', 'Division: 144 / 12 = 12', 'cryst_div', 'math', 'division', 'divide {a} / {b}', 50, 10, 'public', NOW(), false),
('trc_cryst_div_002', 'What is 100 / 4?', '25', 'Division: 100 / 4 = 25', 'cryst_div', 'math', 'division', 'divide {a} / {b}', 50, 10, 'public', NOW(), false),
('trc_cryst_div_003', 'What is 1000 / 8?', '125', 'Division: 1000 / 8 = 125', 'cryst_div', 'math', 'division', 'divide {a} / {b}', 50, 10, 'public', NOW(), false),
('trc_cryst_div_004', 'What is 81 / 9?', '9', 'Division: 81 / 9 = 9', 'cryst_div', 'math', 'division', 'divide {a} / {b}', 50, 10, 'public', NOW(), false),
('trc_cryst_div_005', 'What is 200 / 5?', '40', 'Division: 200 / 5 = 40', 'cryst_div', 'math', 'division', 'divide {a} / {b}', 50, 10, 'public', NOW(), false),
('trc_cryst_div_006', 'What is 90 / 3?', '30', 'Division: 90 / 3 = 30', 'cryst_div', 'math', 'division', 'divide {a} / {b}', 50, 10, 'public', NOW(), false)
ON CONFLICT (id) DO UPDATE SET synthesized = false;

-- ============================================
-- CELSIUS TO FAHRENHEIT - Same template, 6 variations
-- ============================================
INSERT INTO reasoning_traces (id, input, output, reasoning, pattern_hash, intent_category, intent_name, intent_template, tokens_used, execution_ms, visibility, timestamp, synthesized) VALUES
('trc_cryst_c2f_001', 'Convert 0 celsius to fahrenheit', '32', 'Formula: (0 * 9/5) + 32 = 32', 'cryst_c2f', 'conversion', 'celsius-to-fahrenheit', 'convert {n} celsius to fahrenheit', 50, 10, 'public', NOW(), false),
('trc_cryst_c2f_002', 'Convert 100 celsius to fahrenheit', '212', 'Formula: (100 * 9/5) + 32 = 212', 'cryst_c2f', 'conversion', 'celsius-to-fahrenheit', 'convert {n} celsius to fahrenheit', 50, 10, 'public', NOW(), false),
('trc_cryst_c2f_003', 'Convert 25 celsius to fahrenheit', '77', 'Formula: (25 * 9/5) + 32 = 77', 'cryst_c2f', 'conversion', 'celsius-to-fahrenheit', 'convert {n} celsius to fahrenheit', 50, 10, 'public', NOW(), false),
('trc_cryst_c2f_004', 'Convert 37 celsius to fahrenheit', '98.6', 'Formula: (37 * 9/5) + 32 = 98.6', 'cryst_c2f', 'conversion', 'celsius-to-fahrenheit', 'convert {n} celsius to fahrenheit', 50, 10, 'public', NOW(), false),
('trc_cryst_c2f_005', 'Convert -40 celsius to fahrenheit', '-40', 'Formula: (-40 * 9/5) + 32 = -40', 'cryst_c2f', 'conversion', 'celsius-to-fahrenheit', 'convert {n} celsius to fahrenheit', 50, 10, 'public', NOW(), false),
('trc_cryst_c2f_006', 'Convert 20 celsius to fahrenheit', '68', 'Formula: (20 * 9/5) + 32 = 68', 'cryst_c2f', 'conversion', 'celsius-to-fahrenheit', 'convert {n} celsius to fahrenheit', 50, 10, 'public', NOW(), false)
ON CONFLICT (id) DO UPDATE SET synthesized = false;

-- ============================================
-- KM TO MILES - Same template, 6 variations
-- ============================================
INSERT INTO reasoning_traces (id, input, output, reasoning, pattern_hash, intent_category, intent_name, intent_template, tokens_used, execution_ms, visibility, timestamp, synthesized) VALUES
('trc_cryst_km2mi_001', 'Convert 100 km to miles', '62.14', 'Formula: 100 * 0.6214 = 62.14 miles', 'cryst_km2mi', 'conversion', 'km-to-miles', 'convert {n} km to miles', 50, 10, 'public', NOW(), false),
('trc_cryst_km2mi_002', 'Convert 50 km to miles', '31.07', 'Formula: 50 * 0.6214 = 31.07 miles', 'cryst_km2mi', 'conversion', 'km-to-miles', 'convert {n} km to miles', 50, 10, 'public', NOW(), false),
('trc_cryst_km2mi_003', 'Convert 10 km to miles', '6.21', 'Formula: 10 * 0.6214 = 6.21 miles', 'cryst_km2mi', 'conversion', 'km-to-miles', 'convert {n} km to miles', 50, 10, 'public', NOW(), false),
('trc_cryst_km2mi_004', 'Convert 1 km to miles', '0.62', 'Formula: 1 * 0.6214 = 0.62 miles', 'cryst_km2mi', 'conversion', 'km-to-miles', 'convert {n} km to miles', 50, 10, 'public', NOW(), false),
('trc_cryst_km2mi_005', 'Convert 200 km to miles', '124.27', 'Formula: 200 * 0.6214 = 124.27 miles', 'cryst_km2mi', 'conversion', 'km-to-miles', 'convert {n} km to miles', 50, 10, 'public', NOW(), false),
('trc_cryst_km2mi_006', 'Convert 42 km to miles', '26.10', 'Formula: 42 * 0.6214 = 26.10 miles (marathon)', 'cryst_km2mi', 'conversion', 'km-to-miles', 'convert {n} km to miles', 50, 10, 'public', NOW(), false)
ON CONFLICT (id) DO UPDATE SET synthesized = false;

-- ============================================
-- UPPERCASE - Same template, 6 variations
-- ============================================
INSERT INTO reasoning_traces (id, input, output, reasoning, pattern_hash, intent_category, intent_name, intent_template, tokens_used, execution_ms, visibility, timestamp, synthesized) VALUES
('trc_cryst_upper_001', 'Convert "hello" to uppercase', 'HELLO', 'String transform: toUpperCase()', 'cryst_upper', 'transform', 'to-uppercase', 'convert {text} to uppercase', 50, 10, 'public', NOW(), false),
('trc_cryst_upper_002', 'Convert "world" to uppercase', 'WORLD', 'String transform: toUpperCase()', 'cryst_upper', 'transform', 'to-uppercase', 'convert {text} to uppercase', 50, 10, 'public', NOW(), false),
('trc_cryst_upper_003', 'Convert "testing" to uppercase', 'TESTING', 'String transform: toUpperCase()', 'cryst_upper', 'transform', 'to-uppercase', 'convert {text} to uppercase', 50, 10, 'public', NOW(), false),
('trc_cryst_upper_004', 'Convert "substrate" to uppercase', 'SUBSTRATE', 'String transform: toUpperCase()', 'cryst_upper', 'transform', 'to-uppercase', 'convert {text} to uppercase', 50, 10, 'public', NOW(), false),
('trc_cryst_upper_005', 'Convert "data" to uppercase', 'DATA', 'String transform: toUpperCase()', 'cryst_upper', 'transform', 'to-uppercase', 'convert {text} to uppercase', 50, 10, 'public', NOW(), false),
('trc_cryst_upper_006', 'Convert "example" to uppercase', 'EXAMPLE', 'String transform: toUpperCase()', 'cryst_upper', 'transform', 'to-uppercase', 'convert {text} to uppercase', 50, 10, 'public', NOW(), false)
ON CONFLICT (id) DO UPDATE SET synthesized = false;

-- ============================================
-- PERCENTAGE OF - Same template, 6 variations
-- ============================================
INSERT INTO reasoning_traces (id, input, output, reasoning, pattern_hash, intent_category, intent_name, intent_template, tokens_used, execution_ms, visibility, timestamp, synthesized) VALUES
('trc_cryst_pct_001', 'What is 10% of 100?', '10', 'Percentage: 10/100 * 100 = 10', 'cryst_pct', 'math', 'percentage-of', 'what is {p}% of {n}', 50, 10, 'public', NOW(), false),
('trc_cryst_pct_002', 'What is 25% of 200?', '50', 'Percentage: 25/100 * 200 = 50', 'cryst_pct', 'math', 'percentage-of', 'what is {p}% of {n}', 50, 10, 'public', NOW(), false),
('trc_cryst_pct_003', 'What is 50% of 80?', '40', 'Percentage: 50/100 * 80 = 40', 'cryst_pct', 'math', 'percentage-of', 'what is {p}% of {n}', 50, 10, 'public', NOW(), false),
('trc_cryst_pct_004', 'What is 15% of 300?', '45', 'Percentage: 15/100 * 300 = 45', 'cryst_pct', 'math', 'percentage-of', 'what is {p}% of {n}', 50, 10, 'public', NOW(), false),
('trc_cryst_pct_005', 'What is 20% of 50?', '10', 'Percentage: 20/100 * 50 = 10', 'cryst_pct', 'math', 'percentage-of', 'what is {p}% of {n}', 50, 10, 'public', NOW(), false),
('trc_cryst_pct_006', 'What is 75% of 120?', '90', 'Percentage: 75/100 * 120 = 90', 'cryst_pct', 'math', 'percentage-of', 'what is {p}% of {n}', 50, 10, 'public', NOW(), false)
ON CONFLICT (id) DO UPDATE SET synthesized = false;

-- ============================================
-- REVERSE STRING - Same template, 6 variations
-- ============================================
INSERT INTO reasoning_traces (id, input, output, reasoning, pattern_hash, intent_category, intent_name, intent_template, tokens_used, execution_ms, visibility, timestamp, synthesized) VALUES
('trc_cryst_rev_001', 'Reverse "hello"', 'olleh', 'String reverse: split, reverse, join', 'cryst_rev', 'transform', 'reverse-string', 'reverse {text}', 50, 10, 'public', NOW(), false),
('trc_cryst_rev_002', 'Reverse "world"', 'dlrow', 'String reverse: split, reverse, join', 'cryst_rev', 'transform', 'reverse-string', 'reverse {text}', 50, 10, 'public', NOW(), false),
('trc_cryst_rev_003', 'Reverse "testing"', 'gnitset', 'String reverse: split, reverse, join', 'cryst_rev', 'transform', 'reverse-string', 'reverse {text}', 50, 10, 'public', NOW(), false),
('trc_cryst_rev_004', 'Reverse "algorithm"', 'mhtirogla', 'String reverse: split, reverse, join', 'cryst_rev', 'transform', 'reverse-string', 'reverse {text}', 50, 10, 'public', NOW(), false),
('trc_cryst_rev_005', 'Reverse "data"', 'atad', 'String reverse: split, reverse, join', 'cryst_rev', 'transform', 'reverse-string', 'reverse {text}', 50, 10, 'public', NOW(), false),
('trc_cryst_rev_006', 'Reverse "substrate"', 'etartsbus', 'String reverse: split, reverse, join', 'cryst_rev', 'transform', 'reverse-string', 'reverse {text}', 50, 10, 'public', NOW(), false)
ON CONFLICT (id) DO UPDATE SET synthesized = false;

-- ============================================
-- BINARY TO DECIMAL - Same template, 6 variations
-- ============================================
INSERT INTO reasoning_traces (id, input, output, reasoning, pattern_hash, intent_category, intent_name, intent_template, tokens_used, execution_ms, visibility, timestamp, synthesized) VALUES
('trc_cryst_bin_001', 'Convert binary 1010 to decimal', '10', 'Binary: 8+0+2+0 = 10', 'cryst_bin', 'conversion', 'binary-to-decimal', 'convert binary {n} to decimal', 50, 10, 'public', NOW(), false),
('trc_cryst_bin_002', 'Convert binary 1111 to decimal', '15', 'Binary: 8+4+2+1 = 15', 'cryst_bin', 'conversion', 'binary-to-decimal', 'convert binary {n} to decimal', 50, 10, 'public', NOW(), false),
('trc_cryst_bin_003', 'Convert binary 10000 to decimal', '16', 'Binary: 16+0+0+0+0 = 16', 'cryst_bin', 'conversion', 'binary-to-decimal', 'convert binary {n} to decimal', 50, 10, 'public', NOW(), false),
('trc_cryst_bin_004', 'Convert binary 11001 to decimal', '25', 'Binary: 16+8+0+0+1 = 25', 'cryst_bin', 'conversion', 'binary-to-decimal', 'convert binary {n} to decimal', 50, 10, 'public', NOW(), false),
('trc_cryst_bin_005', 'Convert binary 101010 to decimal', '42', 'Binary: 32+0+8+0+2+0 = 42', 'cryst_bin', 'conversion', 'binary-to-decimal', 'convert binary {n} to decimal', 50, 10, 'public', NOW(), false),
('trc_cryst_bin_006', 'Convert binary 1100100 to decimal', '100', 'Binary: 64+32+0+0+4+0+0 = 100', 'cryst_bin', 'conversion', 'binary-to-decimal', 'convert binary {n} to decimal', 50, 10, 'public', NOW(), false)
ON CONFLICT (id) DO UPDATE SET synthesized = false;

-- ============================================
-- Verify counts
-- ============================================
-- SELECT intent_template, count(*) as trace_count
-- FROM reasoning_traces
-- WHERE synthesized = false
-- GROUP BY intent_template
-- HAVING count(*) >= 5
-- ORDER BY trace_count DESC;
