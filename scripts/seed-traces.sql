-- ============================================
-- HIGH-VALUE REASONING TRACES SEED
-- Traces that can be crystallized into shards
-- ============================================

-- ============================================
-- MATH - Arithmetic Operations
-- ============================================
INSERT INTO reasoning_traces (id, input, output, reasoning, pattern_hash, intent_category, intent_name, intent_template, tokens_used, execution_ms, visibility, timestamp) VALUES
('trc_seed_add_001', 'What is 15 + 27?', '42', 'Simple addition: 15 + 27 = 42', 'add_two_numbers_001', 'math', 'add-numbers', 'What is {a} + {b}?', 50, 10, 'public', NOW()),
('trc_seed_add_002', 'Add 123 and 456', '579', 'Addition: 123 + 456 = 579', 'add_two_numbers_002', 'math', 'add-numbers', 'Add {a} and {b}', 50, 10, 'public', NOW()),
('trc_seed_add_003', 'Calculate 999 + 1', '1000', 'Addition: 999 + 1 = 1000', 'add_two_numbers_003', 'math', 'add-numbers', 'Calculate {a} + {b}', 50, 10, 'public', NOW()),
('trc_seed_sub_001', 'What is 100 - 37?', '63', 'Subtraction: 100 - 37 = 63', 'sub_two_numbers_001', 'math', 'subtract-numbers', 'What is {a} - {b}?', 50, 10, 'public', NOW()),
('trc_seed_sub_002', 'Subtract 45 from 200', '155', 'Subtraction: 200 - 45 = 155', 'sub_two_numbers_002', 'math', 'subtract-numbers', 'Subtract {a} from {b}', 50, 10, 'public', NOW()),
('trc_seed_mult_001', 'What is 12 × 12?', '144', 'Multiplication: 12 × 12 = 144', 'mult_two_numbers_001', 'math', 'multiply-numbers', 'What is {a} × {b}?', 50, 10, 'public', NOW()),
('trc_seed_mult_002', 'Multiply 25 by 4', '100', 'Multiplication: 25 × 4 = 100', 'mult_two_numbers_002', 'math', 'multiply-numbers', 'Multiply {a} by {b}', 50, 10, 'public', NOW()),
('trc_seed_div_001', 'What is 144 ÷ 12?', '12', 'Division: 144 ÷ 12 = 12', 'div_two_numbers_001', 'math', 'divide-numbers', 'What is {a} ÷ {b}?', 50, 10, 'public', NOW()),
('trc_seed_div_002', 'Divide 1000 by 8', '125', 'Division: 1000 ÷ 8 = 125', 'div_two_numbers_002', 'math', 'divide-numbers', 'Divide {a} by {b}', 50, 10, 'public', NOW()),
('trc_seed_mod_001', 'What is 17 mod 5?', '2', 'Modulo: 17 mod 5 = 2 (remainder)', 'mod_two_numbers_001', 'math', 'modulo', 'What is {a} mod {b}?', 50, 10, 'public', NOW()),
('trc_seed_pow_001', 'What is 2 to the power of 10?', '1024', 'Exponentiation: 2^10 = 1024', 'power_001', 'math', 'power', 'What is {a} to the power of {b}?', 50, 10, 'public', NOW()),
('trc_seed_sqrt_001', 'What is the square root of 256?', '16', 'Square root: √256 = 16', 'sqrt_001', 'math', 'square-root', 'What is the square root of {n}?', 50, 10, 'public', NOW()),
('trc_seed_fact_001', 'What is 5 factorial?', '120', 'Factorial: 5! = 5×4×3×2×1 = 120', 'factorial_001', 'math', 'factorial', 'What is {n} factorial?', 50, 10, 'public', NOW()),
('trc_seed_fib_001', 'What is the 10th Fibonacci number?', '55', 'Fibonacci sequence: 1,1,2,3,5,8,13,21,34,55', 'fibonacci_001', 'math', 'fibonacci', 'What is the {n}th Fibonacci number?', 50, 10, 'public', NOW()),
('trc_seed_prime_001', 'Is 17 a prime number?', 'Yes, 17 is prime', 'Prime check: 17 has no divisors other than 1 and itself', 'prime_check_001', 'math', 'is-prime', 'Is {n} a prime number?', 50, 10, 'public', NOW()),
('trc_seed_prime_002', 'Is 24 prime?', 'No, 24 is not prime (divisible by 2, 3, 4, 6, 8, 12)', 'Prime check: 24 = 2×12 = 3×8 = 4×6', 'prime_check_002', 'math', 'is-prime', 'Is {n} prime?', 50, 10, 'public', NOW()),
('trc_seed_gcd_001', 'What is the GCD of 48 and 18?', '6', 'GCD(48,18) = 6 using Euclidean algorithm', 'gcd_001', 'math', 'gcd', 'What is the GCD of {a} and {b}?', 50, 10, 'public', NOW()),
('trc_seed_lcm_001', 'What is the LCM of 4 and 6?', '12', 'LCM(4,6) = 12 (smallest common multiple)', 'lcm_001', 'math', 'lcm', 'What is the LCM of {a} and {b}?', 50, 10, 'public', NOW())
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- MATH - Percentages & Ratios
-- ============================================
INSERT INTO reasoning_traces (id, input, output, reasoning, pattern_hash, intent_category, intent_name, intent_template, tokens_used, execution_ms, visibility, timestamp) VALUES
('trc_seed_pct_001', 'What is 15% of 200?', '30', 'Percentage: 15% × 200 = 0.15 × 200 = 30', 'percentage_of_001', 'math', 'percentage-of', 'What is {p}% of {n}?', 50, 10, 'public', NOW()),
('trc_seed_pct_002', 'Calculate 25% of 80', '20', 'Percentage: 25% × 80 = 0.25 × 80 = 20', 'percentage_of_002', 'math', 'percentage-of', 'Calculate {p}% of {n}', 50, 10, 'public', NOW()),
('trc_seed_pct_003', 'What percentage is 45 of 180?', '25%', 'Percentage: (45/180) × 100 = 25%', 'what_percentage_001', 'math', 'what-percentage', 'What percentage is {a} of {b}?', 50, 10, 'public', NOW()),
('trc_seed_tip_001', 'What is a 20% tip on $85?', '$17', 'Tip calculation: 20% × $85 = $17', 'tip_calc_001', 'math', 'calculate-tip', 'What is a {p}% tip on ${amount}?', 50, 10, 'public', NOW()),
('trc_seed_disc_001', 'What is the price after a 30% discount on $150?', '$105', 'Discount: $150 - (30% × $150) = $150 - $45 = $105', 'discount_001', 'math', 'apply-discount', 'What is the price after a {p}% discount on ${price}?', 50, 10, 'public', NOW())
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- CONVERSION - Units
-- ============================================
INSERT INTO reasoning_traces (id, input, output, reasoning, pattern_hash, intent_category, intent_name, intent_template, tokens_used, execution_ms, visibility, timestamp) VALUES
('trc_seed_km_mi_001', 'Convert 100 kilometers to miles', '62.14 miles', 'Conversion: 100 km × 0.6214 = 62.14 miles', 'km_to_miles_001', 'conversion', 'km-to-miles', 'Convert {n} kilometers to miles', 50, 10, 'public', NOW()),
('trc_seed_mi_km_001', 'Convert 50 miles to kilometers', '80.47 km', 'Conversion: 50 mi × 1.6093 = 80.47 km', 'miles_to_km_001', 'conversion', 'miles-to-km', 'Convert {n} miles to kilometers', 50, 10, 'public', NOW()),
('trc_seed_c_f_001', 'Convert 25°C to Fahrenheit', '77°F', 'Conversion: (25 × 9/5) + 32 = 77°F', 'c_to_f_001', 'conversion', 'celsius-to-fahrenheit', 'Convert {n}°C to Fahrenheit', 50, 10, 'public', NOW()),
('trc_seed_f_c_001', 'Convert 98.6°F to Celsius', '37°C', 'Conversion: (98.6 - 32) × 5/9 = 37°C', 'f_to_c_001', 'conversion', 'fahrenheit-to-celsius', 'Convert {n}°F to Celsius', 50, 10, 'public', NOW()),
('trc_seed_lb_kg_001', 'Convert 150 pounds to kilograms', '68.04 kg', 'Conversion: 150 lb × 0.4536 = 68.04 kg', 'lb_to_kg_001', 'conversion', 'pounds-to-kg', 'Convert {n} pounds to kilograms', 50, 10, 'public', NOW()),
('trc_seed_kg_lb_001', 'Convert 70 kg to pounds', '154.32 lbs', 'Conversion: 70 kg × 2.2046 = 154.32 lbs', 'kg_to_lb_001', 'conversion', 'kg-to-pounds', 'Convert {n} kg to pounds', 50, 10, 'public', NOW()),
('trc_seed_in_cm_001', 'Convert 12 inches to centimeters', '30.48 cm', 'Conversion: 12 in × 2.54 = 30.48 cm', 'in_to_cm_001', 'conversion', 'inches-to-cm', 'Convert {n} inches to centimeters', 50, 10, 'public', NOW()),
('trc_seed_cm_in_001', 'Convert 100 cm to inches', '39.37 inches', 'Conversion: 100 cm ÷ 2.54 = 39.37 in', 'cm_to_in_001', 'conversion', 'cm-to-inches', 'Convert {n} cm to inches', 50, 10, 'public', NOW()),
('trc_seed_ft_m_001', 'Convert 6 feet to meters', '1.83 meters', 'Conversion: 6 ft × 0.3048 = 1.83 m', 'ft_to_m_001', 'conversion', 'feet-to-meters', 'Convert {n} feet to meters', 50, 10, 'public', NOW()),
('trc_seed_gal_l_001', 'Convert 5 gallons to liters', '18.93 liters', 'Conversion: 5 gal × 3.7854 = 18.93 L', 'gal_to_l_001', 'conversion', 'gallons-to-liters', 'Convert {n} gallons to liters', 50, 10, 'public', NOW()),
('trc_seed_oz_g_001', 'Convert 8 ounces to grams', '226.8 grams', 'Conversion: 8 oz × 28.35 = 226.8 g', 'oz_to_g_001', 'conversion', 'ounces-to-grams', 'Convert {n} ounces to grams', 50, 10, 'public', NOW())
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- CONVERSION - Number Systems
-- ============================================
INSERT INTO reasoning_traces (id, input, output, reasoning, pattern_hash, intent_category, intent_name, intent_template, tokens_used, execution_ms, visibility, timestamp) VALUES
('trc_seed_dec_bin_001', 'Convert 42 to binary', '101010', 'Decimal to binary: 42 = 32+8+2 = 101010', 'dec_to_bin_001', 'conversion', 'decimal-to-binary', 'Convert {n} to binary', 50, 10, 'public', NOW()),
('trc_seed_bin_dec_001', 'Convert binary 11001 to decimal', '25', 'Binary to decimal: 16+8+1 = 25', 'bin_to_dec_001', 'conversion', 'binary-to-decimal', 'Convert binary {n} to decimal', 50, 10, 'public', NOW()),
('trc_seed_dec_hex_001', 'Convert 255 to hexadecimal', 'FF', 'Decimal to hex: 255 = FF', 'dec_to_hex_001', 'conversion', 'decimal-to-hex', 'Convert {n} to hexadecimal', 50, 10, 'public', NOW()),
('trc_seed_hex_dec_001', 'Convert hex A3 to decimal', '163', 'Hex to decimal: A3 = 10×16 + 3 = 163', 'hex_to_dec_001', 'conversion', 'hex-to-decimal', 'Convert hex {n} to decimal', 50, 10, 'public', NOW()),
('trc_seed_dec_oct_001', 'Convert 64 to octal', '100', 'Decimal to octal: 64 = 100 (base 8)', 'dec_to_oct_001', 'conversion', 'decimal-to-octal', 'Convert {n} to octal', 50, 10, 'public', NOW())
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- CONVERSION - Time
-- ============================================
INSERT INTO reasoning_traces (id, input, output, reasoning, pattern_hash, intent_category, intent_name, intent_template, tokens_used, execution_ms, visibility, timestamp) VALUES
('trc_seed_hr_min_001', 'Convert 2.5 hours to minutes', '150 minutes', 'Time conversion: 2.5 × 60 = 150 minutes', 'hr_to_min_001', 'conversion', 'hours-to-minutes', 'Convert {n} hours to minutes', 50, 10, 'public', NOW()),
('trc_seed_min_sec_001', 'Convert 45 minutes to seconds', '2700 seconds', 'Time conversion: 45 × 60 = 2700 seconds', 'min_to_sec_001', 'conversion', 'minutes-to-seconds', 'Convert {n} minutes to seconds', 50, 10, 'public', NOW()),
('trc_seed_day_hr_001', 'How many hours in 3 days?', '72 hours', 'Time conversion: 3 × 24 = 72 hours', 'day_to_hr_001', 'conversion', 'days-to-hours', 'How many hours in {n} days?', 50, 10, 'public', NOW()),
('trc_seed_wk_day_001', 'How many days in 4 weeks?', '28 days', 'Time conversion: 4 × 7 = 28 days', 'wk_to_day_001', 'conversion', 'weeks-to-days', 'How many days in {n} weeks?', 50, 10, 'public', NOW())
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- TEXT TRANSFORMATION
-- ============================================
INSERT INTO reasoning_traces (id, input, output, reasoning, pattern_hash, intent_category, intent_name, intent_template, tokens_used, execution_ms, visibility, timestamp) VALUES
('trc_seed_upper_001', 'Convert "hello world" to uppercase', 'HELLO WORLD', 'String transformation: uppercase', 'to_upper_001', 'transformation', 'to-uppercase', 'Convert "{text}" to uppercase', 50, 10, 'public', NOW()),
('trc_seed_lower_001', 'Convert "TESTING" to lowercase', 'testing', 'String transformation: lowercase', 'to_lower_001', 'transformation', 'to-lowercase', 'Convert "{text}" to lowercase', 50, 10, 'public', NOW()),
('trc_seed_reverse_001', 'Reverse the string "algorithm"', 'mhtirogla', 'String transformation: reverse characters', 'reverse_str_001', 'transformation', 'reverse-string', 'Reverse the string "{text}"', 50, 10, 'public', NOW()),
('trc_seed_title_001', 'Convert "the quick brown fox" to title case', 'The Quick Brown Fox', 'String transformation: capitalize each word', 'to_title_001', 'transformation', 'to-title-case', 'Convert "{text}" to title case', 50, 10, 'public', NOW()),
('trc_seed_slug_001', 'Convert "Hello World Example" to a URL slug', 'hello-world-example', 'String transformation: lowercase, replace spaces with hyphens', 'to_slug_001', 'transformation', 'to-slug', 'Convert "{text}" to a URL slug', 50, 10, 'public', NOW()),
('trc_seed_camel_001', 'Convert "user profile settings" to camelCase', 'userProfileSettings', 'String transformation: camelCase', 'to_camel_001', 'transformation', 'to-camel-case', 'Convert "{text}" to camelCase', 50, 10, 'public', NOW()),
('trc_seed_snake_001', 'Convert "UserProfileSettings" to snake_case', 'user_profile_settings', 'String transformation: snake_case', 'to_snake_001', 'transformation', 'to-snake-case', 'Convert "{text}" to snake_case', 50, 10, 'public', NOW())
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- TEXT ANALYSIS
-- ============================================
INSERT INTO reasoning_traces (id, input, output, reasoning, pattern_hash, intent_category, intent_name, intent_template, tokens_used, execution_ms, visibility, timestamp) VALUES
('trc_seed_len_001', 'What is the length of "programming"?', '11 characters', 'String analysis: count characters', 'str_length_001', 'analysis', 'string-length', 'What is the length of "{text}"?', 50, 10, 'public', NOW()),
('trc_seed_wc_001', 'Count the words in "The quick brown fox jumps"', '5 words', 'String analysis: count words', 'word_count_001', 'analysis', 'word-count', 'Count the words in "{text}"', 50, 10, 'public', NOW()),
('trc_seed_vowel_001', 'Count vowels in "education"', '5 vowels (e, u, a, i, o)', 'String analysis: count vowels', 'vowel_count_001', 'analysis', 'count-vowels', 'Count vowels in "{text}"', 50, 10, 'public', NOW())
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- VALIDATION
-- ============================================
INSERT INTO reasoning_traces (id, input, output, reasoning, pattern_hash, intent_category, intent_name, intent_template, tokens_used, execution_ms, visibility, timestamp) VALUES
('trc_seed_pal_001', 'Is "racecar" a palindrome?', 'Yes, "racecar" is a palindrome', 'Palindrome check: reads same forwards and backwards', 'is_palindrome_001', 'validation', 'is-palindrome', 'Is "{text}" a palindrome?', 50, 10, 'public', NOW()),
('trc_seed_pal_002', 'Is "hello" a palindrome?', 'No, "hello" is not a palindrome', 'Palindrome check: "hello" reversed is "olleh"', 'is_palindrome_002', 'validation', 'is-palindrome', 'Is "{text}" a palindrome?', 50, 10, 'public', NOW()),
('trc_seed_even_001', 'Is 42 even or odd?', '42 is even', 'Even/odd check: 42 ÷ 2 = 21 (no remainder)', 'is_even_001', 'validation', 'is-even-odd', 'Is {n} even or odd?', 50, 10, 'public', NOW()),
('trc_seed_leap_001', 'Is 2024 a leap year?', 'Yes, 2024 is a leap year', 'Leap year check: divisible by 4, not by 100 unless by 400', 'is_leap_001', 'validation', 'is-leap-year', 'Is {year} a leap year?', 50, 10, 'public', NOW()),
('trc_seed_leap_002', 'Is 2100 a leap year?', 'No, 2100 is not a leap year', 'Leap year check: divisible by 100 but not 400', 'is_leap_002', 'validation', 'is-leap-year', 'Is {year} a leap year?', 50, 10, 'public', NOW()),
('trc_seed_email_001', 'Is "test@example.com" a valid email?', 'Yes, valid email format', 'Email validation: has @ and domain', 'is_email_001', 'validation', 'is-valid-email', 'Is "{email}" a valid email?', 50, 10, 'public', NOW())
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- DATA OPERATIONS
-- ============================================
INSERT INTO reasoning_traces (id, input, output, reasoning, pattern_hash, intent_category, intent_name, intent_template, tokens_used, execution_ms, visibility, timestamp) VALUES
('trc_seed_min_001', 'What is the minimum of 5, 12, 3, 8, 15?', '3', 'Find minimum: smallest value is 3', 'find_min_001', 'data', 'find-minimum', 'What is the minimum of {numbers}?', 50, 10, 'public', NOW()),
('trc_seed_max_001', 'What is the maximum of 23, 7, 45, 12, 38?', '45', 'Find maximum: largest value is 45', 'find_max_001', 'data', 'find-maximum', 'What is the maximum of {numbers}?', 50, 10, 'public', NOW()),
('trc_seed_avg_001', 'What is the average of 10, 20, 30, 40, 50?', '30', 'Average: (10+20+30+40+50)/5 = 150/5 = 30', 'find_avg_001', 'data', 'find-average', 'What is the average of {numbers}?', 50, 10, 'public', NOW()),
('trc_seed_sum_001', 'What is the sum of 15, 25, 35, 45?', '120', 'Sum: 15+25+35+45 = 120', 'find_sum_001', 'data', 'find-sum', 'What is the sum of {numbers}?', 50, 10, 'public', NOW()),
('trc_seed_sort_001', 'Sort these numbers ascending: 8, 3, 9, 1, 5', '[1, 3, 5, 8, 9]', 'Sort ascending: arrange from smallest to largest', 'sort_asc_001', 'data', 'sort-ascending', 'Sort these numbers ascending: {numbers}', 50, 10, 'public', NOW()),
('trc_seed_sort_002', 'Sort these numbers descending: 4, 9, 2, 7, 5', '[9, 7, 5, 4, 2]', 'Sort descending: arrange from largest to smallest', 'sort_desc_001', 'data', 'sort-descending', 'Sort these numbers descending: {numbers}', 50, 10, 'public', NOW()),
('trc_seed_median_001', 'What is the median of 3, 7, 9, 12, 15?', '9', 'Median: middle value of sorted list', 'find_median_001', 'data', 'find-median', 'What is the median of {numbers}?', 50, 10, 'public', NOW()),
('trc_seed_range_001', 'What is the range of 5, 12, 3, 20, 8?', '17', 'Range: max - min = 20 - 3 = 17', 'find_range_001', 'data', 'find-range', 'What is the range of {numbers}?', 50, 10, 'public', NOW())
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- DATE/TIME CALCULATIONS
-- ============================================
INSERT INTO reasoning_traces (id, input, output, reasoning, pattern_hash, intent_category, intent_name, intent_template, tokens_used, execution_ms, visibility, timestamp) VALUES
('trc_seed_dow_001', 'What day of the week is January 1, 2025?', 'Wednesday', 'Date calculation using calendar algorithm', 'day_of_week_001', 'datetime', 'day-of-week', 'What day of the week is {date}?', 50, 10, 'public', NOW()),
('trc_seed_daysbet_001', 'How many days between January 1 and March 15?', '73 days', 'Date difference: Jan(31) + Feb(28) + 15 - 1 = 73', 'days_between_001', 'datetime', 'days-between', 'How many days between {date1} and {date2}?', 50, 10, 'public', NOW()),
('trc_seed_age_001', 'If someone was born in 1990, how old are they in 2024?', '34 years old', 'Age calculation: 2024 - 1990 = 34', 'calc_age_001', 'datetime', 'calculate-age', 'If someone was born in {year}, how old are they in {current_year}?', 50, 10, 'public', NOW())
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- GEOMETRY
-- ============================================
INSERT INTO reasoning_traces (id, input, output, reasoning, pattern_hash, intent_category, intent_name, intent_template, tokens_used, execution_ms, visibility, timestamp) VALUES
('trc_seed_circ_area_001', 'What is the area of a circle with radius 5?', '78.54 square units', 'Circle area: π × r² = 3.14159 × 25 ≈ 78.54', 'circle_area_001', 'geometry', 'circle-area', 'What is the area of a circle with radius {r}?', 50, 10, 'public', NOW()),
('trc_seed_circ_circ_001', 'What is the circumference of a circle with radius 10?', '62.83 units', 'Circumference: 2 × π × r = 2 × 3.14159 × 10 ≈ 62.83', 'circle_circum_001', 'geometry', 'circle-circumference', 'What is the circumference of a circle with radius {r}?', 50, 10, 'public', NOW()),
('trc_seed_rect_area_001', 'What is the area of a rectangle 8 by 5?', '40 square units', 'Rectangle area: length × width = 8 × 5 = 40', 'rect_area_001', 'geometry', 'rectangle-area', 'What is the area of a rectangle {l} by {w}?', 50, 10, 'public', NOW()),
('trc_seed_tri_area_001', 'What is the area of a triangle with base 10 and height 6?', '30 square units', 'Triangle area: (base × height) / 2 = (10 × 6) / 2 = 30', 'tri_area_001', 'geometry', 'triangle-area', 'What is the area of a triangle with base {b} and height {h}?', 50, 10, 'public', NOW()),
('trc_seed_pyth_001', 'In a right triangle with legs 3 and 4, what is the hypotenuse?', '5', 'Pythagorean theorem: √(3² + 4²) = √(9 + 16) = √25 = 5', 'pythagorean_001', 'geometry', 'pythagorean', 'In a right triangle with legs {a} and {b}, what is the hypotenuse?', 50, 10, 'public', NOW()),
('trc_seed_sphere_vol_001', 'What is the volume of a sphere with radius 3?', '113.1 cubic units', 'Sphere volume: (4/3) × π × r³ = (4/3) × 3.14159 × 27 ≈ 113.1', 'sphere_vol_001', 'geometry', 'sphere-volume', 'What is the volume of a sphere with radius {r}?', 50, 10, 'public', NOW()),
('trc_seed_cyl_vol_001', 'What is the volume of a cylinder with radius 4 and height 10?', '502.65 cubic units', 'Cylinder volume: π × r² × h = 3.14159 × 16 × 10 ≈ 502.65', 'cyl_vol_001', 'geometry', 'cylinder-volume', 'What is the volume of a cylinder with radius {r} and height {h}?', 50, 10, 'public', NOW())
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- ENCODING/DECODING
-- ============================================
INSERT INTO reasoning_traces (id, input, output, reasoning, pattern_hash, intent_category, intent_name, intent_template, tokens_used, execution_ms, visibility, timestamp) VALUES
('trc_seed_b64_enc_001', 'Encode "Hello" in base64', 'SGVsbG8=', 'Base64 encoding of ASCII bytes', 'base64_encode_001', 'encoding', 'base64-encode', 'Encode "{text}" in base64', 50, 10, 'public', NOW()),
('trc_seed_b64_dec_001', 'Decode base64 "V29ybGQ="', 'World', 'Base64 decoding to ASCII', 'base64_decode_001', 'encoding', 'base64-decode', 'Decode base64 "{encoded}"', 50, 10, 'public', NOW()),
('trc_seed_url_enc_001', 'URL encode "hello world"', 'hello%20world', 'URL encoding: space becomes %20', 'url_encode_001', 'encoding', 'url-encode', 'URL encode "{text}"', 50, 10, 'public', NOW()),
('trc_seed_ascii_001', 'What is the ASCII code for "A"?', '65', 'ASCII lookup: A = 65', 'ascii_code_001', 'encoding', 'ascii-code', 'What is the ASCII code for "{char}"?', 50, 10, 'public', NOW()),
('trc_seed_chr_001', 'What character is ASCII code 97?', 'a', 'ASCII to character: 97 = a', 'ascii_char_001', 'encoding', 'ascii-to-char', 'What character is ASCII code {n}?', 50, 10, 'public', NOW())
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- FINANCE CALCULATIONS
-- ============================================
INSERT INTO reasoning_traces (id, input, output, reasoning, pattern_hash, intent_category, intent_name, intent_template, tokens_used, execution_ms, visibility, timestamp) VALUES
('trc_seed_interest_001', 'What is the simple interest on $1000 at 5% for 3 years?', '$150', 'Simple interest: P × r × t = 1000 × 0.05 × 3 = $150', 'simple_interest_001', 'finance', 'simple-interest', 'What is the simple interest on ${principal} at {rate}% for {time} years?', 50, 10, 'public', NOW()),
('trc_seed_compound_001', 'Compound interest on $1000 at 5% for 2 years compounded annually?', '$1102.50', 'Compound interest: P(1+r)^t = 1000(1.05)² = $1102.50', 'compound_interest_001', 'finance', 'compound-interest', 'Compound interest on ${principal} at {rate}% for {time} years?', 50, 10, 'public', NOW()),
('trc_seed_roi_001', 'What is the ROI if I invested $500 and made $650?', '30%', 'ROI: (650-500)/500 × 100 = 30%', 'calc_roi_001', 'finance', 'calculate-roi', 'What is the ROI if I invested ${cost} and made ${return}?', 50, 10, 'public', NOW())
ON CONFLICT (id) DO NOTHING;

-- Show final stats
SELECT intent_category, COUNT(*) as count FROM reasoning_traces GROUP BY intent_category ORDER BY count DESC;
SELECT 'Total traces:' as status, COUNT(*) as count FROM reasoning_traces;
