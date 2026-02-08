-- ============================================
-- UNIVERSAL IMMUTABLE FACTS SEED
-- Facts that are eternally true, independently verifiable
-- ============================================

-- Enable pgcrypto for gen_random_uuid if not already
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================
-- MATHEMATICS - Constants
-- ============================================
INSERT INTO knowledge_facts (id, subject, predicate, object, statement, confidence, category, created_at, updated_at) VALUES
('fct_math_pi', 'pi', 'equals', '3.14159265358979323846', 'Pi (π) equals approximately 3.14159265358979323846', 1.0, 'mathematics', NOW(), NOW()),
('fct_math_e', 'euler number', 'equals', '2.71828182845904523536', 'Euler''s number (e) equals approximately 2.71828182845904523536', 1.0, 'mathematics', NOW(), NOW()),
('fct_math_phi', 'golden ratio', 'equals', '1.61803398874989484820', 'The golden ratio (φ) equals approximately 1.61803398874989484820', 1.0, 'mathematics', NOW(), NOW()),
('fct_math_sqrt2', 'square root of 2', 'equals', '1.41421356237309504880', 'The square root of 2 equals approximately 1.41421356237309504880', 1.0, 'mathematics', NOW(), NOW()),
('fct_math_sqrt3', 'square root of 3', 'equals', '1.73205080756887729352', 'The square root of 3 equals approximately 1.73205080756887729352', 1.0, 'mathematics', NOW(), NOW()),
('fct_math_ln2', 'natural log of 2', 'equals', '0.69314718055994530942', 'The natural logarithm of 2 equals approximately 0.69314718055994530942', 1.0, 'mathematics', NOW(), NOW()),
('fct_math_quadratic', 'quadratic formula', 'is', 'x = (-b ± √(b²-4ac)) / 2a', 'The quadratic formula is x = (-b ± √(b²-4ac)) / 2a', 1.0, 'mathematics', NOW(), NOW()),
('fct_math_euler_identity', 'euler identity', 'states', 'e^(iπ) + 1 = 0', 'Euler''s identity states e^(iπ) + 1 = 0', 1.0, 'mathematics', NOW(), NOW()),
('fct_math_arith_series', 'sum of arithmetic series', 'equals', 'n(a₁+aₙ)/2', 'The sum of an arithmetic series equals n(a₁+aₙ)/2', 1.0, 'mathematics', NOW(), NOW()),
('fct_math_geom_series', 'sum of geometric series', 'equals', 'a(1-rⁿ)/(1-r)', 'The sum of a finite geometric series equals a(1-rⁿ)/(1-r) where r≠1', 1.0, 'mathematics', NOW(), NOW()),
('fct_math_inf_geom', 'infinite geometric series', 'equals', 'a/(1-r)', 'An infinite geometric series with |r|<1 equals a/(1-r)', 1.0, 'mathematics', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- PHYSICS - Constants
-- ============================================
INSERT INTO knowledge_facts (id, subject, predicate, object, statement, confidence, category, created_at, updated_at) VALUES
('fct_phys_light', 'speed of light', 'equals', '299792458 m/s', 'The speed of light in a vacuum is exactly 299,792,458 meters per second', 1.0, 'physics', NOW(), NOW()),
('fct_phys_gravity', 'gravitational constant', 'equals', '6.67430×10⁻¹¹ m³/(kg·s²)', 'The gravitational constant G equals 6.67430×10⁻¹¹ m³/(kg·s²)', 1.0, 'physics', NOW(), NOW()),
('fct_phys_planck', 'planck constant', 'equals', '6.62607015×10⁻³⁴ J·s', 'Planck''s constant equals exactly 6.62607015×10⁻³⁴ joule-seconds', 1.0, 'physics', NOW(), NOW()),
('fct_phys_charge', 'elementary charge', 'equals', '1.602176634×10⁻¹⁹ C', 'The elementary charge equals exactly 1.602176634×10⁻¹⁹ coulombs', 1.0, 'physics', NOW(), NOW()),
('fct_phys_boltzmann', 'boltzmann constant', 'equals', '1.380649×10⁻²³ J/K', 'The Boltzmann constant equals exactly 1.380649×10⁻²³ joules per kelvin', 1.0, 'physics', NOW(), NOW()),
('fct_phys_avogadro', 'avogadro number', 'equals', '6.02214076×10²³', 'Avogadro''s number equals exactly 6.02214076×10²³ per mole', 1.0, 'physics', NOW(), NOW()),
('fct_phys_electron', 'electron mass', 'equals', '9.1093837015×10⁻³¹ kg', 'The electron mass equals 9.1093837015×10⁻³¹ kilograms', 1.0, 'physics', NOW(), NOW()),
('fct_phys_proton', 'proton mass', 'equals', '1.67262192369×10⁻²⁷ kg', 'The proton mass equals 1.67262192369×10⁻²⁷ kilograms', 1.0, 'physics', NOW(), NOW()),
('fct_phys_neutron', 'neutron mass', 'equals', '1.67492749804×10⁻²⁷ kg', 'The neutron mass equals 1.67492749804×10⁻²⁷ kilograms', 1.0, 'physics', NOW(), NOW()),
('fct_phys_stdgrav', 'standard gravity', 'equals', '9.80665 m/s²', 'Standard gravity equals exactly 9.80665 meters per second squared', 1.0, 'physics', NOW(), NOW()),
('fct_phys_stdatm', 'standard atmosphere', 'equals', '101325 Pa', 'Standard atmospheric pressure equals exactly 101,325 pascals', 1.0, 'physics', NOW(), NOW()),
('fct_phys_abszero', 'absolute zero', 'equals', '-273.15°C or 0 K', 'Absolute zero equals -273.15 degrees Celsius or 0 Kelvin', 1.0, 'physics', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- CHEMISTRY - Elements
-- ============================================
INSERT INTO knowledge_facts (id, subject, predicate, object, statement, confidence, category, created_at, updated_at) VALUES
('fct_chem_h', 'hydrogen', 'has atomic number', '1', 'Hydrogen has atomic number 1 and symbol H', 1.0, 'chemistry', NOW(), NOW()),
('fct_chem_he', 'helium', 'has atomic number', '2', 'Helium has atomic number 2 and symbol He', 1.0, 'chemistry', NOW(), NOW()),
('fct_chem_li', 'lithium', 'has atomic number', '3', 'Lithium has atomic number 3 and symbol Li', 1.0, 'chemistry', NOW(), NOW()),
('fct_chem_be', 'beryllium', 'has atomic number', '4', 'Beryllium has atomic number 4 and symbol Be', 1.0, 'chemistry', NOW(), NOW()),
('fct_chem_b', 'boron', 'has atomic number', '5', 'Boron has atomic number 5 and symbol B', 1.0, 'chemistry', NOW(), NOW()),
('fct_chem_c', 'carbon', 'has atomic number', '6', 'Carbon has atomic number 6 and symbol C', 1.0, 'chemistry', NOW(), NOW()),
('fct_chem_n', 'nitrogen', 'has atomic number', '7', 'Nitrogen has atomic number 7 and symbol N', 1.0, 'chemistry', NOW(), NOW()),
('fct_chem_o', 'oxygen', 'has atomic number', '8', 'Oxygen has atomic number 8 and symbol O', 1.0, 'chemistry', NOW(), NOW()),
('fct_chem_f', 'fluorine', 'has atomic number', '9', 'Fluorine has atomic number 9 and symbol F', 1.0, 'chemistry', NOW(), NOW()),
('fct_chem_ne', 'neon', 'has atomic number', '10', 'Neon has atomic number 10 and symbol Ne', 1.0, 'chemistry', NOW(), NOW()),
('fct_chem_na', 'sodium', 'has atomic number', '11', 'Sodium has atomic number 11 and symbol Na', 1.0, 'chemistry', NOW(), NOW()),
('fct_chem_mg', 'magnesium', 'has atomic number', '12', 'Magnesium has atomic number 12 and symbol Mg', 1.0, 'chemistry', NOW(), NOW()),
('fct_chem_al', 'aluminum', 'has atomic number', '13', 'Aluminum has atomic number 13 and symbol Al', 1.0, 'chemistry', NOW(), NOW()),
('fct_chem_si', 'silicon', 'has atomic number', '14', 'Silicon has atomic number 14 and symbol Si', 1.0, 'chemistry', NOW(), NOW()),
('fct_chem_p', 'phosphorus', 'has atomic number', '15', 'Phosphorus has atomic number 15 and symbol P', 1.0, 'chemistry', NOW(), NOW()),
('fct_chem_s', 'sulfur', 'has atomic number', '16', 'Sulfur has atomic number 16 and symbol S', 1.0, 'chemistry', NOW(), NOW()),
('fct_chem_cl', 'chlorine', 'has atomic number', '17', 'Chlorine has atomic number 17 and symbol Cl', 1.0, 'chemistry', NOW(), NOW()),
('fct_chem_ar', 'argon', 'has atomic number', '18', 'Argon has atomic number 18 and symbol Ar', 1.0, 'chemistry', NOW(), NOW()),
('fct_chem_k', 'potassium', 'has atomic number', '19', 'Potassium has atomic number 19 and symbol K', 1.0, 'chemistry', NOW(), NOW()),
('fct_chem_ca', 'calcium', 'has atomic number', '20', 'Calcium has atomic number 20 and symbol Ca', 1.0, 'chemistry', NOW(), NOW()),
('fct_chem_fe', 'iron', 'has atomic number', '26', 'Iron has atomic number 26 and symbol Fe', 1.0, 'chemistry', NOW(), NOW()),
('fct_chem_cu', 'copper', 'has atomic number', '29', 'Copper has atomic number 29 and symbol Cu', 1.0, 'chemistry', NOW(), NOW()),
('fct_chem_zn', 'zinc', 'has atomic number', '30', 'Zinc has atomic number 30 and symbol Zn', 1.0, 'chemistry', NOW(), NOW()),
('fct_chem_ag', 'silver', 'has atomic number', '47', 'Silver has atomic number 47 and symbol Ag', 1.0, 'chemistry', NOW(), NOW()),
('fct_chem_au', 'gold', 'has atomic number', '79', 'Gold has atomic number 79 and symbol Au', 1.0, 'chemistry', NOW(), NOW()),
('fct_chem_hg', 'mercury', 'has atomic number', '80', 'Mercury has atomic number 80 and symbol Hg', 1.0, 'chemistry', NOW(), NOW()),
('fct_chem_pb', 'lead', 'has atomic number', '82', 'Lead has atomic number 82 and symbol Pb', 1.0, 'chemistry', NOW(), NOW()),
('fct_chem_u', 'uranium', 'has atomic number', '92', 'Uranium has atomic number 92 and symbol U', 1.0, 'chemistry', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- GEOGRAPHY
-- ============================================
INSERT INTO knowledge_facts (id, subject, predicate, object, statement, confidence, category, created_at, updated_at) VALUES
('fct_geo_continents', 'Earth', 'has continents', '7', 'Earth has 7 continents: Africa, Antarctica, Asia, Australia, Europe, North America, South America', 1.0, 'geography', NOW(), NOW()),
('fct_geo_oceans', 'Earth', 'has oceans', '5', 'Earth has 5 oceans: Pacific, Atlantic, Indian, Southern, Arctic', 1.0, 'geography', NOW(), NOW()),
('fct_geo_asia', 'Asia', 'is largest continent by', 'area and population', 'Asia is the largest continent by both area and population', 1.0, 'geography', NOW(), NOW()),
('fct_geo_pacific', 'Pacific Ocean', 'is largest ocean by', 'area', 'The Pacific Ocean is the largest ocean, covering about 63 million square miles', 1.0, 'geography', NOW(), NOW()),
('fct_geo_everest', 'Mount Everest', 'is tallest mountain at', '8,849 meters', 'Mount Everest is the tallest mountain above sea level at 8,849 meters (29,032 feet)', 1.0, 'geography', NOW(), NOW()),
('fct_geo_mariana', 'Mariana Trench', 'is deepest point at', '10,935 meters', 'The Mariana Trench is the deepest known point in the ocean at approximately 10,935 meters', 1.0, 'geography', NOW(), NOW()),
('fct_geo_nile', 'Nile River', 'is longest river at', '6,650 km', 'The Nile River is the longest river at approximately 6,650 kilometers', 1.0, 'geography', NOW(), NOW()),
('fct_geo_amazon', 'Amazon River', 'has largest discharge', 'by volume', 'The Amazon River has the largest discharge of water by volume', 1.0, 'geography', NOW(), NOW()),
('fct_geo_sahara', 'Sahara Desert', 'is largest hot desert at', '9.2 million km²', 'The Sahara is the largest hot desert at approximately 9.2 million square kilometers', 1.0, 'geography', NOW(), NOW()),
('fct_geo_antarctica', 'Antarctica', 'is largest cold desert at', '14.2 million km²', 'Antarctica is the largest cold desert at approximately 14.2 million square kilometers', 1.0, 'geography', NOW(), NOW()),
('fct_geo_russia', 'Russia', 'is largest country by', 'area', 'Russia is the largest country by area at 17.1 million square kilometers', 1.0, 'geography', NOW(), NOW()),
('fct_geo_vatican', 'Vatican City', 'is smallest country by', 'area', 'Vatican City is the smallest country by area at 0.44 square kilometers', 1.0, 'geography', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- ASTRONOMY
-- ============================================
INSERT INTO knowledge_facts (id, subject, predicate, object, statement, confidence, category, created_at, updated_at) VALUES
('fct_astro_planets', 'Solar System', 'has planets', '8', 'The Solar System has 8 planets: Mercury, Venus, Earth, Mars, Jupiter, Saturn, Uranus, Neptune', 1.0, 'astronomy', NOW(), NOW()),
('fct_astro_sun', 'Sun', 'is classified as', 'G-type main-sequence star', 'The Sun is classified as a G-type main-sequence star (yellow dwarf)', 1.0, 'astronomy', NOW(), NOW()),
('fct_astro_jupiter', 'Jupiter', 'is largest planet in', 'Solar System', 'Jupiter is the largest planet in the Solar System', 1.0, 'astronomy', NOW(), NOW()),
('fct_astro_mercury', 'Mercury', 'is smallest planet in', 'Solar System', 'Mercury is the smallest planet in the Solar System', 1.0, 'astronomy', NOW(), NOW()),
('fct_astro_earth_orbit', 'Earth', 'orbital period', '365.25 days', 'Earth''s orbital period around the Sun is approximately 365.25 days', 1.0, 'astronomy', NOW(), NOW()),
('fct_astro_moon_orbit', 'Moon', 'orbital period around Earth', '27.3 days', 'The Moon''s orbital period around Earth is approximately 27.3 days', 1.0, 'astronomy', NOW(), NOW()),
('fct_astro_lightyear', 'light year', 'equals', '9.461 trillion km', 'One light year equals approximately 9.461 trillion kilometers', 1.0, 'astronomy', NOW(), NOW()),
('fct_astro_au', 'astronomical unit', 'equals', '149.6 million km', 'One astronomical unit (AU) equals approximately 149.6 million kilometers', 1.0, 'astronomy', NOW(), NOW()),
('fct_astro_proxima', 'Proxima Centauri', 'is nearest star at', '4.24 light years', 'Proxima Centauri is the nearest star to the Sun at approximately 4.24 light years', 1.0, 'astronomy', NOW(), NOW()),
('fct_astro_milkyway', 'Milky Way', 'contains approximately', '100-400 billion stars', 'The Milky Way galaxy contains approximately 100-400 billion stars', 1.0, 'astronomy', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- BIOLOGY
-- ============================================
INSERT INTO knowledge_facts (id, subject, predicate, object, statement, confidence, category, created_at, updated_at) VALUES
('fct_bio_dna', 'DNA', 'consists of', '4 nucleotide bases', 'DNA consists of 4 nucleotide bases: adenine (A), thymine (T), guanine (G), cytosine (C)', 1.0, 'biology', NOW(), NOW()),
('fct_bio_genome', 'human genome', 'contains approximately', '3 billion base pairs', 'The human genome contains approximately 3 billion base pairs', 1.0, 'biology', NOW(), NOW()),
('fct_bio_chromosomes', 'human body', 'has chromosomes', '46 (23 pairs)', 'Human cells typically contain 46 chromosomes (23 pairs)', 1.0, 'biology', NOW(), NOW()),
('fct_bio_cell', 'cell', 'is basic unit of', 'life', 'The cell is the basic structural and functional unit of all living organisms', 1.0, 'biology', NOW(), NOW()),
('fct_bio_photosynthesis', 'photosynthesis equation', 'is', '6CO₂ + 6H₂O → C₆H₁₂O₆ + 6O₂', 'The basic photosynthesis equation is 6CO₂ + 6H₂O + light → C₆H₁₂O₆ + 6O₂', 1.0, 'biology', NOW(), NOW()),
('fct_bio_atp', 'ATP', 'is', 'primary energy currency of cells', 'Adenosine triphosphate (ATP) is the primary energy currency of cells', 1.0, 'biology', NOW(), NOW()),
('fct_bio_taxonomy', 'taxonomic ranks', 'are', 'Domain, Kingdom, Phylum, Class, Order, Family, Genus, Species', 'The main taxonomic ranks are Domain, Kingdom, Phylum, Class, Order, Family, Genus, Species', 1.0, 'biology', NOW(), NOW()),
('fct_bio_domains', 'domains of life', 'are', 'Bacteria, Archaea, Eukarya', 'The three domains of life are Bacteria, Archaea, and Eukarya', 1.0, 'biology', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- COMPUTER SCIENCE
-- ============================================
INSERT INTO knowledge_facts (id, subject, predicate, object, statement, confidence, category, created_at, updated_at) VALUES
('fct_cs_bit', 'bit', 'is', 'smallest unit of data', 'A bit is the smallest unit of data in computing, representing 0 or 1', 1.0, 'computer_science', NOW(), NOW()),
('fct_cs_byte', 'byte', 'equals', '8 bits', 'One byte equals 8 bits', 1.0, 'computer_science', NOW(), NOW()),
('fct_cs_binary', 'binary', 'is base', '2', 'Binary is a base-2 numeral system using digits 0 and 1', 1.0, 'computer_science', NOW(), NOW()),
('fct_cs_hex', 'hexadecimal', 'is base', '16', 'Hexadecimal is a base-16 numeral system using 0-9 and A-F', 1.0, 'computer_science', NOW(), NOW()),
('fct_cs_octal', 'octal', 'is base', '8', 'Octal is a base-8 numeral system using digits 0-7', 1.0, 'computer_science', NOW(), NOW()),
('fct_cs_ascii', 'ASCII', 'uses', '7 bits for 128 characters', 'ASCII uses 7 bits to represent 128 characters', 1.0, 'computer_science', NOW(), NOW()),
('fct_cs_utf8', 'UTF-8', 'is', 'variable-width character encoding', 'UTF-8 is a variable-width character encoding using 1-4 bytes per character', 1.0, 'computer_science', NOW(), NOW()),
('fct_cs_o1', 'Big O notation O(1)', 'means', 'constant time', 'O(1) in Big O notation represents constant time complexity', 1.0, 'computer_science', NOW(), NOW()),
('fct_cs_on', 'Big O notation O(n)', 'means', 'linear time', 'O(n) in Big O notation represents linear time complexity', 1.0, 'computer_science', NOW(), NOW()),
('fct_cs_ologn', 'Big O notation O(log n)', 'means', 'logarithmic time', 'O(log n) in Big O notation represents logarithmic time complexity', 1.0, 'computer_science', NOW(), NOW()),
('fct_cs_on2', 'Big O notation O(n²)', 'means', 'quadratic time', 'O(n²) in Big O notation represents quadratic time complexity', 1.0, 'computer_science', NOW(), NOW()),
('fct_cs_http200', 'HTTP status 200', 'means', 'OK', 'HTTP status code 200 means OK (successful request)', 1.0, 'computer_science', NOW(), NOW()),
('fct_cs_http201', 'HTTP status 201', 'means', 'Created', 'HTTP status code 201 means Created', 1.0, 'computer_science', NOW(), NOW()),
('fct_cs_http400', 'HTTP status 400', 'means', 'Bad Request', 'HTTP status code 400 means Bad Request', 1.0, 'computer_science', NOW(), NOW()),
('fct_cs_http401', 'HTTP status 401', 'means', 'Unauthorized', 'HTTP status code 401 means Unauthorized', 1.0, 'computer_science', NOW(), NOW()),
('fct_cs_http403', 'HTTP status 403', 'means', 'Forbidden', 'HTTP status code 403 means Forbidden', 1.0, 'computer_science', NOW(), NOW()),
('fct_cs_http404', 'HTTP status 404', 'means', 'Not Found', 'HTTP status code 404 means Not Found', 1.0, 'computer_science', NOW(), NOW()),
('fct_cs_http500', 'HTTP status 500', 'means', 'Internal Server Error', 'HTTP status code 500 means Internal Server Error', 1.0, 'computer_science', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- LOGIC
-- ============================================
INSERT INTO knowledge_facts (id, subject, predicate, object, statement, confidence, category, created_at, updated_at) VALUES
('fct_logic_and', 'AND operation', 'returns true when', 'both inputs are true', 'Boolean AND returns true only when both inputs are true', 1.0, 'logic', NOW(), NOW()),
('fct_logic_or', 'OR operation', 'returns true when', 'at least one input is true', 'Boolean OR returns true when at least one input is true', 1.0, 'logic', NOW(), NOW()),
('fct_logic_not', 'NOT operation', 'inverts', 'the input value', 'Boolean NOT inverts the input (true becomes false, false becomes true)', 1.0, 'logic', NOW(), NOW()),
('fct_logic_xor', 'XOR operation', 'returns true when', 'inputs differ', 'Boolean XOR returns true when exactly one input is true', 1.0, 'logic', NOW(), NOW()),
('fct_logic_nand', 'NAND operation', 'is', 'NOT AND', 'NAND is the negation of AND, returns false only when both inputs are true', 1.0, 'logic', NOW(), NOW()),
('fct_logic_nor', 'NOR operation', 'is', 'NOT OR', 'NOR is the negation of OR, returns true only when both inputs are false', 1.0, 'logic', NOW(), NOW()),
('fct_logic_demorgan1', 'De Morgan law 1', 'states', 'NOT(A AND B) = NOT A OR NOT B', 'De Morgan''s first law: NOT(A AND B) equals NOT A OR NOT B', 1.0, 'logic', NOW(), NOW()),
('fct_logic_demorgan2', 'De Morgan law 2', 'states', 'NOT(A OR B) = NOT A AND NOT B', 'De Morgan''s second law: NOT(A OR B) equals NOT A AND NOT B', 1.0, 'logic', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- LANGUAGE - Roman Numerals
-- ============================================
INSERT INTO knowledge_facts (id, subject, predicate, object, statement, confidence, category, created_at, updated_at) VALUES
('fct_roman_i', 'Roman numeral I', 'equals', '1', 'Roman numeral I equals 1', 1.0, 'language', NOW(), NOW()),
('fct_roman_v', 'Roman numeral V', 'equals', '5', 'Roman numeral V equals 5', 1.0, 'language', NOW(), NOW()),
('fct_roman_x', 'Roman numeral X', 'equals', '10', 'Roman numeral X equals 10', 1.0, 'language', NOW(), NOW()),
('fct_roman_l', 'Roman numeral L', 'equals', '50', 'Roman numeral L equals 50', 1.0, 'language', NOW(), NOW()),
('fct_roman_c', 'Roman numeral C', 'equals', '100', 'Roman numeral C equals 100', 1.0, 'language', NOW(), NOW()),
('fct_roman_d', 'Roman numeral D', 'equals', '500', 'Roman numeral D equals 500', 1.0, 'language', NOW(), NOW()),
('fct_roman_m', 'Roman numeral M', 'equals', '1000', 'Roman numeral M equals 1000', 1.0, 'language', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- MUSIC
-- ============================================
INSERT INTO knowledge_facts (id, subject, predicate, object, statement, confidence, category, created_at, updated_at) VALUES
('fct_music_octave', 'octave', 'contains', '12 semitones', 'An octave contains 12 semitones', 1.0, 'music', NOW(), NOW()),
('fct_music_a440', 'A4 (concert pitch)', 'equals', '440 Hz', 'Concert pitch A4 is standardized at 440 Hz', 1.0, 'music', NOW(), NOW()),
('fct_music_major', 'major scale', 'has intervals', 'W-W-H-W-W-W-H', 'A major scale follows the interval pattern whole-whole-half-whole-whole-whole-half', 1.0, 'music', NOW(), NOW()),
('fct_music_minor', 'minor scale (natural)', 'has intervals', 'W-H-W-W-H-W-W', 'A natural minor scale follows whole-half-whole-whole-half-whole-whole', 1.0, 'music', NOW(), NOW()),
('fct_music_chromatic', 'chromatic scale', 'contains', '12 notes', 'A chromatic scale contains all 12 notes within an octave', 1.0, 'music', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- FINANCE
-- ============================================
INSERT INTO knowledge_facts (id, subject, predicate, object, statement, confidence, category, created_at, updated_at) VALUES
('fct_fin_compound', 'compound interest formula', 'is', 'A = P(1 + r/n)^(nt)', 'Compound interest: A = P(1 + r/n)^(nt) where P=principal, r=rate, n=compounds/year, t=years', 1.0, 'finance', NOW(), NOW()),
('fct_fin_simple', 'simple interest formula', 'is', 'I = P × r × t', 'Simple interest formula: I = P × r × t where P=principal, r=rate, t=time', 1.0, 'finance', NOW(), NOW()),
('fct_fin_rule72', 'rule of 72', 'estimates', 'doubling time = 72/interest rate', 'The rule of 72: years to double investment ≈ 72 divided by interest rate percentage', 1.0, 'finance', NOW(), NOW()),
('fct_fin_roi', 'ROI formula', 'is', '(gain - cost) / cost × 100', 'Return on Investment (ROI) = (gain - cost) / cost × 100%', 1.0, 'finance', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- Update existing facts to have proper categories
-- ============================================
UPDATE knowledge_facts SET category = 'mathematics' WHERE statement ILIKE '%pi equals%' OR statement ILIKE '%euler%' OR statement ILIKE '%triangle%' OR statement ILIKE '%circle%' OR statement ILIKE '%square%' OR statement ILIKE '%power%' OR statement ILIKE '%factorial%' OR statement ILIKE '%fibonacci%' OR statement ILIKE '%pythagorean%';
UPDATE knowledge_facts SET category = 'physics' WHERE statement ILIKE '%speed of light%' OR statement ILIKE '%boils at%' OR statement ILIKE '%freezes at%' OR statement ILIKE '%celsius%' OR statement ILIKE '%fahrenheit%';
UPDATE knowledge_facts SET category = 'units' WHERE statement ILIKE '%kilometer%' OR statement ILIKE '%mile%' OR statement ILIKE '%inch%' OR statement ILIKE '%pound%' OR statement ILIKE '%kilobyte%' OR statement ILIKE '%megabyte%' OR statement ILIKE '%gigabyte%';
UPDATE knowledge_facts SET category = 'time' WHERE statement ILIKE '%seconds in%' OR statement ILIKE '%minutes in%' OR statement ILIKE '%hours in%' OR statement ILIKE '%days in%' OR statement ILIKE '%months in%';

-- Show final stats
SELECT category, COUNT(*) as count FROM knowledge_facts GROUP BY category ORDER BY count DESC;
SELECT 'Total facts:' as status, COUNT(*) as count FROM knowledge_facts;
