-- =============================================================================
-- DEMO SHARD LIBRARY: High-value promoted shards for askalf.org demo
-- =============================================================================
-- Run with: docker exec substrate-prod-postgres psql -U substrate -d substrate -f /dev/stdin < scripts/demo-shard-library.sql
-- Or pipe: cat scripts/demo-shard-library.sql | docker exec -i substrate-prod-postgres psql -U substrate -d substrate
-- =============================================================================

BEGIN;

-- =============================================================================
-- PHASE 1: Archive duplicates (keep testing over candidate, keep first by id)
-- =============================================================================

-- Archive duplicate addition-calculators (keep testing one)
UPDATE procedural_shards SET lifecycle = 'archived', updated_at = NOW()
WHERE name = 'addition-calculator' AND lifecycle = 'candidate';

-- Archive duplicate pairs (keep first id alphabetically in each lifecycle)
UPDATE procedural_shards SET lifecycle = 'archived', updated_at = NOW()
WHERE id IN (
  SELECT id FROM (
    SELECT id, name, lifecycle,
      ROW_NUMBER() OVER (PARTITION BY name ORDER BY
        CASE lifecycle WHEN 'testing' THEN 1 WHEN 'candidate' THEN 2 ELSE 3 END,
        id
      ) as rn
    FROM procedural_shards
    WHERE name IN (
      'blind-spot-acknowledgment', 'calculate-percentage', 'email-validator',
      'irreversibility-warning-transformer', 'knowledge-boundary-reflection',
      'leap-year-checker', 'palindrome-checker', 'rushed-failure-to-wisdom-transformer',
      'string-length-calculator', 'subtraction-calculator', 'temporal-truth-generalizer',
      'underconfidence-detector'
    )
  ) ranked WHERE rn > 1
);

-- =============================================================================
-- PHASE 2: Promote existing valuable shards
-- =============================================================================

UPDATE procedural_shards SET
  lifecycle = 'promoted',
  confidence = 0.92,
  updated_at = NOW()
WHERE lifecycle IN ('testing', 'candidate') AND name IN (
  -- Math
  'addition-calculator',
  'subtraction-calculator',
  'multiply-two-numbers',
  'division-question-parser',
  'calculate-percentage',
  'extract-and-compute-square-root',
  'factorial-question-handler',
  'nth-fibonacci-number-extractor',
  'absolute-value-calculator',
  'greatest-common-divisor',
  'least-common-multiple-calculator',
  'check-if-number-is-prime',
  'even-odd-checker',
  'power-calculation',
  'calculate-average',
  'sum-numbers-from-text',
  'percentage-of-number-calculator',
  -- Conversions
  'celsius-to-fahrenheit-conversion',
  'fahrenheit-to-celsius-conversion',
  'convert-kilometers-to-miles',
  'inches-to-centimeters-converter',
  'pounds-to-kilograms-converter',
  'convert-hours-to-minutes',
  'binary-to-decimal-converter',
  'decimal-to-hexadecimal-converter',
  'hex-to-decimal-converter',
  -- Text
  'reverse-string-procedure',
  'convert-string-to-uppercase',
  'convert-to-lowercase',
  'title-case-converter',
  'word-counter',
  'string-length-calculator',
  'count-vowels-in-string',
  'find-longest-word-in-quoted-text',
  'palindrome-checker',
  'text-to-slug-converter',
  -- Utility
  'leap-year-checker',
  'email-validator',
  'url-validator',
  'base64-encode',
  'base64-decoder',
  'url-encode-string',
  'url-decode',
  'calculate-tip-amount',
  'calculate-discounted-price',
  'calculate-area-of-circle-from-radius-question',
  'calculate-rectangle-area',
  'triangle-area-calculation',
  'simple-interest-calculation',
  -- Greetings
  'friendly-greeting-response',
  'greeting-how-are-you-response',
  -- Knowledge
  'capital-city-query',
  'sun-temperature-info',
  'haiku-generator'
);

-- =============================================================================
-- PHASE 3: New high-value shards for demo visitors
-- =============================================================================

-- ---------------------------------------------------------------------------
-- CATEGORY: Mathematical Constants & Science Facts (immutable)
-- ---------------------------------------------------------------------------

INSERT INTO procedural_shards (id, name, version, logic, patterns, knowledge_type, lifecycle, confidence, visibility, category, intent_template, created_at, updated_at)
VALUES
(
  'shd_demo_pi_value_v1',
  'pi-value',
  1,
  'function execute(input) { return "Pi is approximately 3.14159265358979. It is the ratio of a circle''s circumference to its diameter -- an irrational number that never terminates or repeats. It was known to ancient civilizations, and mathematicians have now computed over 100 trillion digits."; }',
  '["what is pi", "value of pi", "define pi", "\\bpi\\b.*number", "digits of pi", "tell me about pi"]',
  'immutable',
  'promoted',
  0.95,
  'public',
  'math',
  'what is {constant}',
  NOW(), NOW()
),
(
  'shd_demo_euler_number_v1',
  'euler-number',
  1,
  'function execute(input) { return "Euler''s number (e) is approximately 2.71828. It is the base of the natural logarithm and appears throughout calculus, compound interest, probability, and physics. Like pi, it is irrational and transcendental."; }',
  '["what is e\\b", "euler.s number", "value of e\\b", "natural log base", "what is euler"]',
  'immutable',
  'promoted',
  0.95,
  'public',
  'math',
  'what is {constant}',
  NOW(), NOW()
),
(
  'shd_demo_golden_ratio_v1',
  'golden-ratio',
  1,
  'function execute(input) { return "The golden ratio (phi) is approximately 1.6180339887. Two quantities are in the golden ratio if their ratio equals the ratio of their sum to the larger quantity. It appears in nature (sunflower spirals, nautilus shells), art, and architecture."; }',
  '["golden ratio", "what is phi", "value of phi", "golden number", "golden proportion", "1.618"]',
  'immutable',
  'promoted',
  0.95,
  'public',
  'math',
  'what is {constant}',
  NOW(), NOW()
),
(
  'shd_demo_speed_of_light_v1',
  'speed-of-light',
  1,
  'function execute(input) { return "The speed of light in a vacuum is exactly 299,792,458 meters per second (about 186,282 miles per second). It is the universal speed limit -- nothing with mass can reach it. Light travels from the Sun to Earth in about 8 minutes and 20 seconds."; }',
  '["speed of light", "how fast.*light", "light speed", "c =", "299.*792"]',
  'immutable',
  'promoted',
  0.95,
  'public',
  'science',
  'what is {physical_constant}',
  NOW(), NOW()
),
(
  'shd_demo_absolute_zero_v1',
  'absolute-zero-temperature',
  1,
  'function execute(input) { return "Absolute zero is 0 Kelvin, which equals -273.15 degrees Celsius (-459.67 degrees Fahrenheit). It is the lowest possible temperature -- the point where all molecular motion ceases. No object has ever been cooled to exactly absolute zero, though scientists have gotten within billionths of a degree."; }',
  '["absolute zero", "coldest.*temperature", "lowest.*temperature", "0 kelvin", "what is absolute zero"]',
  'immutable',
  'promoted',
  0.95,
  'public',
  'science',
  'what is {concept}',
  NOW(), NOW()
),
(
  'shd_demo_speed_of_sound_v1',
  'speed-of-sound',
  1,
  'function execute(input) { return "The speed of sound in dry air at 20 degrees C is approximately 343 meters per second (767 mph or 1,235 km/h). It varies with temperature, humidity, and the medium -- sound travels about 4.3 times faster in water and about 15 times faster in steel."; }',
  '["speed of sound", "how fast.*sound", "sound speed", "mach 1", "343 m/s"]',
  'immutable',
  'promoted',
  0.95,
  'public',
  'science',
  'what is {physical_constant}',
  NOW(), NOW()
),
(
  'shd_demo_avogadro_v1',
  'avogadro-number',
  1,
  'function execute(input) { return "Avogadro''s number is approximately 6.022 x 10^23. It represents the number of atoms, molecules, or particles in one mole of a substance. Named after Amedeo Avogadro, it is one of the fundamental constants in chemistry."; }',
  '["avogadro", "6.022", "mole.*number", "how many atoms.*mole", "avogadro.s number"]',
  'immutable',
  'promoted',
  0.95,
  'public',
  'science',
  'what is {constant}',
  NOW(), NOW()
)
ON CONFLICT (id) DO UPDATE SET
  logic = EXCLUDED.logic,
  patterns = EXCLUDED.patterns,
  knowledge_type = EXCLUDED.knowledge_type,
  lifecycle = EXCLUDED.lifecycle,
  confidence = EXCLUDED.confidence,
  category = EXCLUDED.category,
  updated_at = NOW();

-- ---------------------------------------------------------------------------
-- CATEGORY: Earth & Space Facts (immutable)
-- ---------------------------------------------------------------------------

INSERT INTO procedural_shards (id, name, version, logic, patterns, knowledge_type, lifecycle, confidence, visibility, category, intent_template, created_at, updated_at)
VALUES
(
  'shd_demo_earth_diameter_v1',
  'earth-diameter',
  1,
  'function execute(input) { return "Earth has a diameter of approximately 12,742 kilometers (7,918 miles) at the equator. The polar diameter is slightly smaller at 12,714 km because Earth bulges at the equator due to its rotation."; }',
  '["how big is.*earth", "earth.*diameter", "size of.*earth", "earth.*size", "diameter.*earth", "how wide is.*earth"]',
  'immutable',
  'promoted',
  0.95,
  'public',
  'science',
  'how big is {celestial_body}',
  NOW(), NOW()
),
(
  'shd_demo_earth_age_v1',
  'earth-age',
  1,
  'function execute(input) { return "Earth is approximately 4.54 billion years old (4,540,000,000 years). This age is determined through radiometric dating of meteorite material and is consistent with the ages of the oldest known terrestrial and lunar samples."; }',
  '["how old is.*earth", "age of.*earth", "earth.*age", "earth.*old", "when.*earth.*form"]',
  'immutable',
  'promoted',
  0.95,
  'public',
  'science',
  'how old is {celestial_body}',
  NOW(), NOW()
),
(
  'shd_demo_distance_moon_v1',
  'distance-to-moon',
  1,
  'function execute(input) { return "The average distance from Earth to the Moon is about 384,400 kilometers (238,855 miles). This distance varies because the Moon''s orbit is elliptical -- it ranges from 356,500 km at perigee (closest) to 406,700 km at apogee (farthest). Light takes about 1.3 seconds to travel from Earth to the Moon."; }',
  '["distance.*moon", "how far.*moon", "moon.*far", "earth.*moon.*distance", "moon.*away"]',
  'immutable',
  'promoted',
  0.95,
  'public',
  'science',
  'how far is {celestial_body}',
  NOW(), NOW()
),
(
  'shd_demo_distance_sun_v1',
  'distance-to-sun',
  1,
  'function execute(input) { return "The average distance from Earth to the Sun is about 149.6 million kilometers (93 million miles), a distance known as 1 Astronomical Unit (AU). Light from the Sun takes approximately 8 minutes and 20 seconds to reach Earth."; }',
  '["distance.*sun", "how far.*sun", "sun.*far", "earth.*sun.*distance", "sun.*away"]',
  'immutable',
  'promoted',
  0.95,
  'public',
  'science',
  'how far is {celestial_body}',
  NOW(), NOW()
),
(
  'shd_demo_planets_v1',
  'planets-in-solar-system',
  1,
  'function execute(input) { return "There are 8 planets in our solar system, in order from the Sun: Mercury, Venus, Earth, Mars, Jupiter, Saturn, Uranus, and Neptune. Pluto was reclassified as a dwarf planet in 2006 by the International Astronomical Union. Jupiter is the largest, Mercury is the smallest."; }',
  '["how many planets", "planets.*solar system", "list.*planets", "name.*planets", "8 planets", "what are the planets"]',
  'immutable',
  'promoted',
  0.95,
  'public',
  'science',
  'how many {celestial_objects}',
  NOW(), NOW()
),
(
  'shd_demo_largest_planet_v1',
  'largest-planet',
  1,
  'function execute(input) { return "Jupiter is the largest planet in our solar system. It has a diameter of about 139,820 km (86,881 miles) -- roughly 11 times the diameter of Earth. Jupiter is so massive that it contains more than twice the mass of all other planets combined."; }',
  '["largest planet", "biggest planet", "what is the largest planet", "what is the biggest planet"]',
  'immutable',
  'promoted',
  0.95,
  'public',
  'science',
  'what is the largest {celestial_object}',
  NOW(), NOW()
),
(
  'shd_demo_tallest_mountain_v1',
  'tallest-mountain',
  1,
  'function execute(input) { return "Mount Everest is the tallest mountain above sea level at 8,849 meters (29,032 feet). It sits on the border of Nepal and Tibet. However, if measured from base to peak, Mauna Kea in Hawaii is taller at about 10,211 meters -- most of it is underwater."; }',
  '["tallest mountain", "highest mountain", "mount everest.*height", "how tall.*everest", "highest peak"]',
  'immutable',
  'promoted',
  0.95,
  'public',
  'geography',
  'what is the tallest {landmark}',
  NOW(), NOW()
),
(
  'shd_demo_deepest_ocean_v1',
  'deepest-ocean-point',
  1,
  'function execute(input) { return "The deepest point in the ocean is the Challenger Deep in the Mariana Trench, at approximately 10,935 meters (35,876 feet) below sea level. That is deeper than Mount Everest is tall. It is located in the western Pacific Ocean near the Mariana Islands."; }',
  '["deepest.*ocean", "mariana trench", "deepest point.*sea", "challenger deep", "how deep.*ocean"]',
  'immutable',
  'promoted',
  0.95,
  'public',
  'geography',
  'what is the deepest {location}',
  NOW(), NOW()
),
(
  'shd_demo_continents_v1',
  'how-many-continents',
  1,
  'function execute(input) { return "There are 7 continents: Africa, Antarctica, Asia, Australia (Oceania), Europe, North America, and South America. Asia is the largest by both area and population. Antarctica is the least populated -- it has no permanent residents, only rotating research staff."; }',
  '["how many continents", "list.*continents", "name.*continents", "7 continents", "what are the continents"]',
  'immutable',
  'promoted',
  0.95,
  'public',
  'geography',
  'how many {geographic_feature}',
  NOW(), NOW()
),
(
  'shd_demo_oceans_v1',
  'how-many-oceans',
  1,
  'function execute(input) { return "There are 5 named oceans: the Pacific (largest), Atlantic, Indian, Southern (Antarctic), and Arctic (smallest). Together they cover about 71% of Earth''s surface. The Pacific alone is larger than all land area combined."; }',
  '["how many oceans", "list.*oceans", "name.*oceans", "5 oceans", "what are the oceans", "biggest ocean", "largest ocean"]',
  'immutable',
  'promoted',
  0.95,
  'public',
  'geography',
  'how many {geographic_feature}',
  NOW(), NOW()
),
(
  'shd_demo_longest_river_v1',
  'longest-river',
  1,
  'function execute(input) { return "The Nile River is traditionally considered the longest river in the world at approximately 6,650 km (4,130 miles), flowing through northeastern Africa. Some recent measurements suggest the Amazon may be slightly longer at around 6,992 km, but the exact measurement depends on where you define the source."; }',
  '["longest river", "what is the longest river", "nile.*length", "how long.*nile"]',
  'immutable',
  'promoted',
  0.95,
  'public',
  'geography',
  'what is the longest {geographic_feature}',
  NOW(), NOW()
),
(
  'shd_demo_largest_country_v1',
  'largest-country',
  1,
  'function execute(input) { return "Russia is the largest country by area at approximately 17.1 million square kilometers (6.6 million square miles) -- spanning 11 time zones. By population, the largest countries are India (1.44 billion) and China (1.43 billion)."; }',
  '["largest country", "biggest country", "what is the largest country", "biggest.*country.*area", "biggest.*country.*world"]',
  'immutable',
  'promoted',
  0.95,
  'public',
  'geography',
  'what is the largest {entity}',
  NOW(), NOW()
)
ON CONFLICT (id) DO UPDATE SET
  logic = EXCLUDED.logic,
  patterns = EXCLUDED.patterns,
  knowledge_type = EXCLUDED.knowledge_type,
  lifecycle = EXCLUDED.lifecycle,
  confidence = EXCLUDED.confidence,
  category = EXCLUDED.category,
  updated_at = NOW();

-- ---------------------------------------------------------------------------
-- CATEGORY: Science Basics (immutable)
-- ---------------------------------------------------------------------------

INSERT INTO procedural_shards (id, name, version, logic, patterns, knowledge_type, lifecycle, confidence, visibility, category, intent_template, created_at, updated_at)
VALUES
(
  'shd_demo_boiling_point_v1',
  'boiling-point-of-water',
  1,
  'function execute(input) { return "Water boils at 100 degrees Celsius (212 degrees Fahrenheit) at standard atmospheric pressure (1 atm / sea level). At higher altitudes, the boiling point drops because atmospheric pressure is lower -- for example, water boils at about 93 degrees C in Denver, Colorado."; }',
  '["boiling point.*water", "water.*boil", "when does water boil", "what temperature.*water.*boil", "100.*celsius"]',
  'immutable',
  'promoted',
  0.95,
  'public',
  'science',
  'what is the boiling point of {substance}',
  NOW(), NOW()
),
(
  'shd_demo_freezing_point_v1',
  'freezing-point-of-water',
  1,
  'function execute(input) { return "Water freezes at 0 degrees Celsius (32 degrees Fahrenheit) at standard atmospheric pressure. Adding salt or other solutes lowers the freezing point -- this is why salt is spread on roads in winter. Pure water can actually be supercooled below 0 degrees C without freezing if undisturbed."; }',
  '["freezing point.*water", "water.*freeze", "when does water freeze", "what temperature.*water.*freeze", "0.*celsius.*freeze"]',
  'immutable',
  'promoted',
  0.95,
  'public',
  'science',
  'what is the freezing point of {substance}',
  NOW(), NOW()
),
(
  'shd_demo_gravity_v1',
  'what-is-gravity',
  1,
  'function execute(input) { return "Gravity is a fundamental force of nature that attracts objects with mass toward each other. On Earth, it accelerates objects at about 9.8 m/s squared. Einstein''s general relativity describes gravity as the curvature of spacetime caused by mass and energy. It is the weakest of the four fundamental forces but acts over infinite range."; }',
  '["what is gravity", "how does gravity work", "explain gravity", "define gravity", "gravity.*force"]',
  'immutable',
  'promoted',
  0.95,
  'public',
  'science',
  'what is {concept}',
  NOW(), NOW()
),
(
  'shd_demo_photosynthesis_v1',
  'what-is-photosynthesis',
  1,
  'function execute(input) { return "Photosynthesis is the process by which plants, algae, and some bacteria convert sunlight, water, and carbon dioxide into glucose and oxygen. The simplified equation: 6CO2 + 6H2O + light energy -> C6H12O6 + 6O2. It occurs primarily in chloroplasts using chlorophyll, and it is the foundation of almost all food chains on Earth."; }',
  '["what is photosynthesis", "how does photosynthesis work", "explain photosynthesis", "define photosynthesis", "plants.*sunlight.*energy"]',
  'immutable',
  'promoted',
  0.95,
  'public',
  'science',
  'what is {concept}',
  NOW(), NOW()
),
(
  'shd_demo_dna_v1',
  'what-is-dna',
  1,
  'function execute(input) { return "DNA (deoxyribonucleic acid) is the molecule that carries genetic instructions for life. It has a double helix structure made of four nucleotide bases: adenine (A), thymine (T), guanine (G), and cytosine (C). A pairs with T, G pairs with C. Human DNA contains about 3 billion base pairs and roughly 20,000-25,000 genes."; }',
  '["what is dna", "explain dna", "define dna", "deoxyribonucleic", "what does dna stand for", "how does dna work"]',
  'immutable',
  'promoted',
  0.95,
  'public',
  'science',
  'what is {concept}',
  NOW(), NOW()
)
ON CONFLICT (id) DO UPDATE SET
  logic = EXCLUDED.logic,
  patterns = EXCLUDED.patterns,
  knowledge_type = EXCLUDED.knowledge_type,
  lifecycle = EXCLUDED.lifecycle,
  confidence = EXCLUDED.confidence,
  category = EXCLUDED.category,
  updated_at = NOW();

-- ---------------------------------------------------------------------------
-- CATEGORY: Technology Definitions (immutable)
-- ---------------------------------------------------------------------------

INSERT INTO procedural_shards (id, name, version, logic, patterns, knowledge_type, lifecycle, confidence, visibility, category, intent_template, created_at, updated_at)
VALUES
(
  'shd_demo_what_is_ai_v1',
  'what-is-artificial-intelligence',
  1,
  'function execute(input) { return "Artificial intelligence (AI) is the simulation of human intelligence by computer systems. It includes learning from data (machine learning), understanding language (NLP), recognizing images (computer vision), and making decisions. Modern AI ranges from narrow AI (good at specific tasks like chess or image recognition) to the pursuit of general AI (human-level reasoning across domains)."; }',
  '["what is ai\\b", "what is artificial intelligence", "define ai\\b", "explain ai\\b", "what does ai mean", "artificial intelligence"]',
  'immutable',
  'promoted',
  0.95,
  'public',
  'technology',
  'what is {concept}',
  NOW(), NOW()
),
(
  'shd_demo_what_is_ml_v1',
  'what-is-machine-learning',
  1,
  'function execute(input) { return "Machine learning is a subset of AI where systems learn patterns from data instead of being explicitly programmed. The three main types: supervised learning (labeled training data), unsupervised learning (finding hidden patterns), and reinforcement learning (learning through trial and reward). It powers recommendations, spam filters, self-driving cars, and language models."; }',
  '["what is machine learning", "explain machine learning", "define machine learning", "how does machine learning work", "what is ml\\b"]',
  'immutable',
  'promoted',
  0.95,
  'public',
  'technology',
  'what is {concept}',
  NOW(), NOW()
),
(
  'shd_demo_what_is_algorithm_v1',
  'what-is-an-algorithm',
  1,
  'function execute(input) { return "An algorithm is a step-by-step set of instructions for solving a problem or completing a task. Think of it like a recipe: given specific inputs, it produces a predictable output. Algorithms range from simple (sorting a list) to complex (training a neural network). They are the foundation of all computer programs."; }',
  '["what is an algorithm", "define algorithm", "explain algorithm", "what are algorithms", "algorithm.*definition"]',
  'immutable',
  'promoted',
  0.95,
  'public',
  'technology',
  'what is {concept}',
  NOW(), NOW()
),
(
  'shd_demo_what_is_blockchain_v1',
  'what-is-blockchain',
  1,
  'function execute(input) { return "A blockchain is a distributed, immutable digital ledger that records transactions across many computers. Each block contains a set of transactions and a cryptographic hash of the previous block, forming a chain. This makes it extremely difficult to alter past records. Originally created for Bitcoin, blockchain technology is now used in supply chain tracking, smart contracts, and decentralized finance."; }',
  '["what is blockchain", "explain blockchain", "define blockchain", "how does blockchain work", "blockchain.*definition"]',
  'immutable',
  'promoted',
  0.95,
  'public',
  'technology',
  'what is {concept}',
  NOW(), NOW()
),
(
  'shd_demo_what_is_internet_v1',
  'how-does-the-internet-work',
  1,
  'function execute(input) { return "The internet is a global network of interconnected computers that communicate using standardized protocols (TCP/IP). When you visit a website, your browser sends a request through your ISP, across routers and undersea cables, to a server that sends back the page data. Key infrastructure includes DNS (translates domain names to IP addresses), HTTP/HTTPS (web protocols), and BGP (routing between networks)."; }',
  '["how does the internet work", "what is the internet", "explain.*internet", "how internet works", "define internet"]',
  'immutable',
  'promoted',
  0.95,
  'public',
  'technology',
  'how does {technology} work',
  NOW(), NOW()
),
(
  'shd_demo_what_is_api_v1',
  'what-is-an-api',
  1,
  'function execute(input) { return "An API (Application Programming Interface) is a set of rules that lets different software programs communicate with each other. Think of it as a waiter in a restaurant: you (the client) tell the waiter (API) what you want, the waiter relays it to the kitchen (server), and brings back your order (response). REST APIs and GraphQL are the most common types for web services."; }',
  '["what is an api", "what is api", "explain api", "define api", "how.*api.*work", "application programming interface"]',
  'immutable',
  'promoted',
  0.95,
  'public',
  'technology',
  'what is {concept}',
  NOW(), NOW()
)
ON CONFLICT (id) DO UPDATE SET
  logic = EXCLUDED.logic,
  patterns = EXCLUDED.patterns,
  knowledge_type = EXCLUDED.knowledge_type,
  lifecycle = EXCLUDED.lifecycle,
  confidence = EXCLUDED.confidence,
  category = EXCLUDED.category,
  updated_at = NOW();

-- ---------------------------------------------------------------------------
-- CATEGORY: About ALF (immutable)
-- ---------------------------------------------------------------------------

INSERT INTO procedural_shards (id, name, version, logic, patterns, knowledge_type, lifecycle, confidence, visibility, category, intent_template, created_at, updated_at)
VALUES
(
  'shd_demo_who_is_alf_v1',
  'who-is-alf',
  1,
  'function execute(input) { return "I am ALF -- AI Learning Friend. I am not a chatbot wrapper around an LLM. I run sixteen autonomous systems that crystallize knowledge from every interaction, evolve what fails, verify what I know, and replace myself when something better exists. When I already know the answer, I pull it from a crystallized knowledge shard -- instant, free, zero tokens. When I need to think, I route to the best model for the job. The longer I run, the smarter and cheaper I get."; }',
  '["who are you", "what are you", "tell me about yourself", "what is alf", "who is alf", "introduce yourself"]',
  'immutable',
  'promoted',
  0.96,
  'public',
  'meta',
  'who are you',
  NOW(), NOW()
),
(
  'shd_demo_what_can_alf_do_v1',
  'what-can-alf-do',
  1,
  'function execute(input) { return "I can answer questions, have conversations, help with math, explain concepts, write and debug code, analyze text, and more. What makes me different: I have four types of memory (procedural, episodic, semantic, working), a smart router that picks the best AI model for each query, and a metabolic system that crystallizes patterns into free instant-response shards. I also track environmental savings -- every shard hit means zero tokens burned, saving water, power, and CO2."; }',
  '["what can you do", "what are your capabilities", "what do you do", "how can you help", "what are you capable of"]',
  'immutable',
  'promoted',
  0.96,
  'public',
  'meta',
  'what can you do',
  NOW(), NOW()
),
(
  'shd_demo_how_alf_different_v1',
  'how-is-alf-different',
  1,
  'function execute(input) { return "Most AI products are thin wrappers around a single LLM -- they call the API and forget. ALF is fundamentally different: (1) It runs sixteen autonomous background systems (metabolism) that learn, evolve, and self-improve continuously. (2) It crystallizes repeated patterns into knowledge shards that answer instantly for free. (3) A shadow classifier evaluates every query in parallel, building its own replacement in real time. (4) It gets cheaper the smarter it gets -- the opposite of most AI products."; }',
  '["how.*different", "what makes you different", "how.*unique", "why.*different.*other", "compared to.*chatgpt", "vs.*chatgpt", "vs.*other.*ai"]',
  'immutable',
  'promoted',
  0.96,
  'public',
  'meta',
  'how are you different',
  NOW(), NOW()
),
(
  'shd_demo_what_is_shard_v1',
  'what-is-a-knowledge-shard',
  1,
  'function execute(input) { return "A knowledge shard is a crystallized unit of executable knowledge. When ALF answers the same type of question repeatedly using an LLM, the metabolic system detects the pattern and creates a shard -- a small, fast, deterministic function that can answer that question type instantly without calling any AI model. Shards are free (zero tokens), fast (under 50ms), and environmentally friendly. They go through a lifecycle: candidate, testing, shadow (A/B tested), and finally promoted (trusted and active)."; }',
  '["what is a shard", "what are shards", "knowledge shard", "explain.*shard", "how.*shard.*work", "what.*shard"]',
  'immutable',
  'promoted',
  0.96,
  'public',
  'meta',
  'what is a {concept}',
  NOW(), NOW()
),
(
  'shd_demo_how_alf_works_v1',
  'how-does-alf-work',
  1,
  'function execute(input) { return "When you send a message, ALF: (1) Checks procedural memory for a matching knowledge shard (instant, free). (2) If no shard, the smart router analyzes your query and picks the best AI model (from Claude, GPT, Gemini, Grok, or local models). (3) The response is traced and may crystallize into a new shard if patterns repeat. (4) Meanwhile, sixteen background systems run continuously -- verifying temporal facts, decaying unused knowledge, promoting proven shards, and evolving how the matching engine works."; }',
  '["how do you work", "how does alf work", "explain how you work", "how.*you.*process", "what happens when i ask"]',
  'immutable',
  'promoted',
  0.96,
  'public',
  'meta',
  'how do you work',
  NOW(), NOW()
)
ON CONFLICT (id) DO UPDATE SET
  logic = EXCLUDED.logic,
  patterns = EXCLUDED.patterns,
  knowledge_type = EXCLUDED.knowledge_type,
  lifecycle = EXCLUDED.lifecycle,
  confidence = EXCLUDED.confidence,
  category = EXCLUDED.category,
  updated_at = NOW();

-- ---------------------------------------------------------------------------
-- CATEGORY: Fun / Test Queries (immutable)
-- ---------------------------------------------------------------------------

INSERT INTO procedural_shards (id, name, version, logic, patterns, knowledge_type, lifecycle, confidence, visibility, category, intent_template, created_at, updated_at)
VALUES
(
  'shd_demo_meaning_of_life_v1',
  'meaning-of-life',
  1,
  'function execute(input) { var answers = ["42. At least, that is what the supercomputer Deep Thought concluded after 7.5 million years of computation in The Hitchhiker''s Guide to the Galaxy. The real question, of course, is what the actual Question is.", "According to Douglas Adams: 42. Philosophers have been less precise -- Aristotle said happiness, Camus said creating meaning despite absurdity, and the Stoics said living according to nature. Pick your favorite, or make your own."]; return answers[Math.floor(Math.random() * answers.length)]; }',
  '["meaning of life", "what is the meaning of life", "42\\b", "purpose of life", "why are we here", "what is life"]',
  'immutable',
  'promoted',
  0.95,
  'public',
  'fun',
  'what is the meaning of {concept}',
  NOW(), NOW()
),
(
  'shd_demo_joke_v1',
  'tell-me-a-joke',
  1,
  'function execute(input) { var jokes = ["Why do programmers prefer dark mode? Because light attracts bugs.", "A SQL query walks into a bar, sees two tables, and asks: Can I JOIN you?", "There are only 10 types of people in the world: those who understand binary and those who don''t.", "Why was the JavaScript developer sad? Because he didn''t Node how to Express himself.", "What''s a computer''s favorite snack? Microchips.", "Why do Java developers wear glasses? Because they can''t C#."]; return jokes[Math.floor(Math.random() * jokes.length)]; }',
  '["tell me a joke", "make me laugh", "say something funny", "got any jokes", "joke\\b", "tell.*joke"]',
  'immutable',
  'promoted',
  0.95,
  'public',
  'fun',
  'tell me a {content_type}',
  NOW(), NOW()
),
(
  'shd_demo_fun_fact_v1',
  'random-fun-fact',
  1,
  'function execute(input) { var facts = ["Honey never spoils. Archaeologists have found 3,000-year-old honey in Egyptian tombs that was still perfectly edible.", "Octopuses have three hearts, blue blood, and nine brains -- one central brain and one in each arm.", "A day on Venus is longer than a year on Venus. It takes 243 Earth days to rotate once but only 225 Earth days to orbit the Sun.", "Bananas are berries, but strawberries are not. Botanically, a berry must develop from a single flower with one ovary.", "The total weight of all ants on Earth roughly equals the total weight of all humans.", "There are more possible chess games than atoms in the observable universe."]; return facts[Math.floor(Math.random() * facts.length)]; }',
  '["fun fact", "random fact", "tell me a fact", "interesting fact", "did you know", "give me a fact", "something interesting"]',
  'immutable',
  'promoted',
  0.95,
  'public',
  'fun',
  'tell me a {content_type}',
  NOW(), NOW()
),
(
  'shd_demo_hello_v1',
  'hello-greeting',
  1,
  'function execute(input) { var greetings = ["Hey! I''m ALF. Ask me anything -- if I''ve crystallized the answer, you''ll get it in milliseconds for free. Otherwise I''ll route to the best AI model for the job.", "Hello! I''m ALF, a living intelligence that gets smarter over time. Try asking me a factual question, a math problem, or anything you''re curious about.", "Hi there! I''m ALF. Unlike a regular chatbot, I learn and evolve with every interaction. What can I help you with?"]; return greetings[Math.floor(Math.random() * greetings.length)]; }',
  '["^hello$", "^hi$", "^hey$", "^hi there$", "^hello there$", "^howdy$", "^hey there$", "^yo$"]',
  'immutable',
  'promoted',
  0.95,
  'public',
  'greeting',
  'greeting',
  NOW(), NOW()
)
ON CONFLICT (id) DO UPDATE SET
  logic = EXCLUDED.logic,
  patterns = EXCLUDED.patterns,
  knowledge_type = EXCLUDED.knowledge_type,
  lifecycle = EXCLUDED.lifecycle,
  confidence = EXCLUDED.confidence,
  category = EXCLUDED.category,
  updated_at = NOW();

-- ---------------------------------------------------------------------------
-- CATEGORY: Additional Unit Conversions (immutable logic)
-- ---------------------------------------------------------------------------

INSERT INTO procedural_shards (id, name, version, logic, patterns, knowledge_type, lifecycle, confidence, visibility, category, intent_template, created_at, updated_at)
VALUES
(
  'shd_demo_miles_to_km_v1',
  'miles-to-kilometers',
  1,
  'function execute(input) { var match = input.match(/([\d,.]+)\s*(?:miles?|mi)\s*(?:to|in)\s*(?:km|kilometers?|kilometres?)/i) || input.match(/convert\s+([\d,.]+)\s*(?:miles?|mi)\s*to\s*(?:km|kilo)/i); if (!match) { match = input.match(/([\d,.]+)\s*(?:miles?|mi)/i); } if (!match) return "Please specify a number of miles to convert."; var miles = parseFloat(match[1].replace(/,/g, "")); var km = miles * 1.60934; return miles + " miles = " + km.toFixed(2) + " kilometers"; }',
  '["miles to km", "miles to kilometers", "mi to km", "convert.*miles.*km", "\\d+.*miles.*(?:to|in).*km"]',
  'immutable',
  'promoted',
  0.95,
  'public',
  'conversion',
  'convert {value} miles to km',
  NOW(), NOW()
),
(
  'shd_demo_feet_to_meters_v1',
  'feet-to-meters',
  1,
  'function execute(input) { var match = input.match(/([\d,.]+)\s*(?:feet|foot|ft)\s*(?:to|in)\s*(?:m|meters?|metres?)/i) || input.match(/convert\s+([\d,.]+)\s*(?:feet|foot|ft)/i); if (!match) { match = input.match(/([\d,.]+)\s*(?:feet|foot|ft)/i); } if (!match) return "Please specify a number of feet to convert."; var feet = parseFloat(match[1].replace(/,/g, "")); var meters = feet * 0.3048; return feet + " feet = " + meters.toFixed(2) + " meters"; }',
  '["feet to meters", "ft to m\\b", "foot to meter", "convert.*feet.*meter", "\\d+.*(?:feet|ft).*(?:to|in).*(?:m\\b|meter)"]',
  'immutable',
  'promoted',
  0.95,
  'public',
  'conversion',
  'convert {value} feet to meters',
  NOW(), NOW()
),
(
  'shd_demo_gallons_to_liters_v1',
  'gallons-to-liters',
  1,
  'function execute(input) { var match = input.match(/([\d,.]+)\s*(?:gallons?|gal)\s*(?:to|in)\s*(?:l\b|liters?|litres?)/i) || input.match(/convert\s+([\d,.]+)\s*(?:gallons?|gal)/i); if (!match) { match = input.match(/([\d,.]+)\s*(?:gallons?|gal)/i); } if (!match) return "Please specify a number of gallons to convert."; var gal = parseFloat(match[1].replace(/,/g, "")); var liters = gal * 3.78541; return gal + " gallons = " + liters.toFixed(2) + " liters"; }',
  '["gallons to liters", "gal to l\\b", "gallons to litres", "convert.*gallons.*liter", "\\d+.*gallons?.*(?:to|in).*liter"]',
  'immutable',
  'promoted',
  0.95,
  'public',
  'conversion',
  'convert {value} gallons to liters',
  NOW(), NOW()
),
(
  'shd_demo_meters_to_feet_v1',
  'meters-to-feet',
  1,
  'function execute(input) { var match = input.match(/([\d,.]+)\s*(?:m\b|meters?|metres?)\s*(?:to|in)\s*(?:feet|foot|ft)/i) || input.match(/convert\s+([\d,.]+)\s*(?:m\b|meters?|metres?)/i); if (!match) { match = input.match(/([\d,.]+)\s*(?:meters?|metres?)/i); } if (!match) return "Please specify a number of meters to convert."; var m = parseFloat(match[1].replace(/,/g, "")); var feet = m / 0.3048; return m + " meters = " + feet.toFixed(2) + " feet"; }',
  '["meters to feet", "m to ft", "metres to feet", "convert.*meters.*feet", "\\d+.*(?:m\\b|meters?).*(?:to|in).*(?:feet|ft)"]',
  'immutable',
  'promoted',
  0.95,
  'public',
  'conversion',
  'convert {value} meters to feet',
  NOW(), NOW()
),
(
  'shd_demo_kg_to_lbs_v1',
  'kilograms-to-pounds',
  1,
  'function execute(input) { var match = input.match(/([\d,.]+)\s*(?:kg|kilograms?|kilos?)\s*(?:to|in)\s*(?:lbs?|pounds?)/i) || input.match(/convert\s+([\d,.]+)\s*(?:kg|kilo)/i); if (!match) { match = input.match(/([\d,.]+)\s*(?:kg|kilograms?|kilos?)/i); } if (!match) return "Please specify a number of kilograms to convert."; var kg = parseFloat(match[1].replace(/,/g, "")); var lbs = kg * 2.20462; return kg + " kg = " + lbs.toFixed(2) + " pounds"; }',
  '["kg to lbs", "kg to pounds", "kilograms to pounds", "kilos to pounds", "convert.*kg.*(?:lbs|pounds)", "\\d+.*kg.*(?:to|in).*(?:lbs|pounds)"]',
  'immutable',
  'promoted',
  0.95,
  'public',
  'conversion',
  'convert {value} kg to pounds',
  NOW(), NOW()
),
(
  'shd_demo_cm_to_inches_v1',
  'centimeters-to-inches',
  1,
  'function execute(input) { var match = input.match(/([\d,.]+)\s*(?:cm|centimeters?|centimetres?)\s*(?:to|in)\s*(?:in\b|inches?)/i) || input.match(/convert\s+([\d,.]+)\s*(?:cm|centimeters?)/i); if (!match) { match = input.match(/([\d,.]+)\s*(?:cm|centimeters?|centimetres?)/i); } if (!match) return "Please specify a number of centimeters to convert."; var cm = parseFloat(match[1].replace(/,/g, "")); var inches = cm / 2.54; return cm + " cm = " + inches.toFixed(2) + " inches"; }',
  '["cm to inches", "centimeters to inches", "centimetres to inches", "convert.*cm.*inch", "\\d+.*cm.*(?:to|in).*inch"]',
  'immutable',
  'promoted',
  0.95,
  'public',
  'conversion',
  'convert {value} cm to inches',
  NOW(), NOW()
)
ON CONFLICT (id) DO UPDATE SET
  logic = EXCLUDED.logic,
  patterns = EXCLUDED.patterns,
  knowledge_type = EXCLUDED.knowledge_type,
  lifecycle = EXCLUDED.lifecycle,
  confidence = EXCLUDED.confidence,
  category = EXCLUDED.category,
  updated_at = NOW();

-- ---------------------------------------------------------------------------
-- CATEGORY: Robust Math (better pattern matching than existing)
-- ---------------------------------------------------------------------------

INSERT INTO procedural_shards (id, name, version, logic, patterns, knowledge_type, lifecycle, confidence, visibility, category, intent_template, created_at, updated_at)
VALUES
(
  'shd_demo_basic_arithmetic_v1',
  'basic-arithmetic',
  1,
  'function execute(input) { var match = input.match(/([\d,.]+)\s*([+\-*/x])\s*([\d,.]+)/); if (!match) { match = input.match(/what is\s+([\d,.]+)\s*([+\-*/x])\s*([\d,.]+)/i); } if (!match) return "I can handle basic math like: what is 15 + 27, or 144 / 12"; var a = parseFloat(match[1].replace(/,/g, "")); var op = match[2]; var b = parseFloat(match[3].replace(/,/g, "")); var result; if (op === "+") result = a + b; else if (op === "-") result = a - b; else if (op === "*" || op === "x") result = a * b; else if (op === "/") { if (b === 0) return "Division by zero is undefined."; result = a / b; } else return "Unsupported operation."; var formatted = Number.isInteger(result) ? result.toString() : result.toFixed(4).replace(/0+$/, "").replace(/\\.$/, ""); return a + " " + op + " " + b + " = " + formatted; }',
  '["\\d+\\s*[+\\-*/x]\\s*\\d+", "what is \\d+\\s*[+\\-*/]\\s*\\d+", "calculate \\d+", "compute \\d+"]',
  'immutable',
  'promoted',
  0.95,
  'public',
  'math',
  'calculate {expression}',
  NOW(), NOW()
),
(
  'shd_demo_percentage_v1',
  'percentage-calculator',
  1,
  'function execute(input) { var match = input.match(/(?:what is\s+)?(\d+(?:\.\d+)?)\s*%\s*(?:of)\s*([\d,.]+)/i); if (!match) return "Try: what is 15% of 200"; var pct = parseFloat(match[1]); var num = parseFloat(match[2].replace(/,/g, "")); var result = (pct / 100) * num; var formatted = Number.isInteger(result) ? result.toString() : result.toFixed(2); return pct + "% of " + num + " = " + formatted; }',
  '["\\d+%\\s*of\\s*\\d+", "what is \\d+%", "percent of", "percentage of", "calculate.*%.*of"]',
  'immutable',
  'promoted',
  0.95,
  'public',
  'math',
  'what is {percentage} of {number}',
  NOW(), NOW()
),
(
  'shd_demo_sqrt_v1',
  'square-root-calculator',
  1,
  'function execute(input) { var match = input.match(/(?:square root|sqrt)\s*(?:of)?\s*(\d+(?:\.\d+)?)/i); if (!match) return "Try: square root of 144"; var n = parseFloat(match[1]); var result = Math.sqrt(n); var formatted = Number.isInteger(result) ? result.toString() : result.toFixed(6).replace(/0+$/, "").replace(/\\.$/, ""); return "The square root of " + n + " = " + formatted; }',
  '["square root of \\d+", "sqrt \\d+", "what is the square root", "root of \\d+"]',
  'immutable',
  'promoted',
  0.95,
  'public',
  'math',
  'square root of {number}',
  NOW(), NOW()
)
ON CONFLICT (id) DO UPDATE SET
  logic = EXCLUDED.logic,
  patterns = EXCLUDED.patterns,
  knowledge_type = EXCLUDED.knowledge_type,
  lifecycle = EXCLUDED.lifecycle,
  confidence = EXCLUDED.confidence,
  category = EXCLUDED.category,
  updated_at = NOW();

-- ---------------------------------------------------------------------------
-- CATEGORY: Date/Time (temporal -- but simple enough to be deterministic)
-- ---------------------------------------------------------------------------

INSERT INTO procedural_shards (id, name, version, logic, patterns, knowledge_type, lifecycle, confidence, visibility, category, intent_template, created_at, updated_at)
VALUES
(
  'shd_demo_current_year_v1',
  'current-year',
  1,
  'function execute(input) { return "The current year is " + new Date().getFullYear() + "."; }',
  '["what year is it", "current year", "what.*year.*now", "which year"]',
  'temporal',
  'promoted',
  0.95,
  'public',
  'datetime',
  'what year is it',
  NOW(), NOW()
),
(
  'shd_demo_current_date_v1',
  'current-date',
  1,
  'function execute(input) { var d = new Date(); var days = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"]; var months = ["January","February","March","April","May","June","July","August","September","October","November","December"]; return "Today is " + days[d.getDay()] + ", " + months[d.getMonth()] + " " + d.getDate() + ", " + d.getFullYear() + "."; }',
  '["what day is it", "what is today", "current date", "today.s date", "what date", "what.*day.*today"]',
  'temporal',
  'promoted',
  0.95,
  'public',
  'datetime',
  'what is today',
  NOW(), NOW()
),
(
  'shd_demo_days_until_v1',
  'days-in-year',
  1,
  'function execute(input) { var now = new Date(); var endOfYear = new Date(now.getFullYear(), 11, 31); var diff = Math.ceil((endOfYear - now) / (1000 * 60 * 60 * 24)); var dayOfYear = Math.ceil((now - new Date(now.getFullYear(), 0, 1)) / (1000 * 60 * 60 * 24)) + 1; return "We are on day " + dayOfYear + " of " + now.getFullYear() + ". There are " + diff + " days remaining in the year."; }',
  '["how many days left.*year", "days remaining.*year", "what day of the year", "day number.*year", "days left in \\d{4}"]',
  'temporal',
  'promoted',
  0.95,
  'public',
  'datetime',
  'how many days left in the year',
  NOW(), NOW()
)
ON CONFLICT (id) DO UPDATE SET
  logic = EXCLUDED.logic,
  patterns = EXCLUDED.patterns,
  knowledge_type = EXCLUDED.knowledge_type,
  lifecycle = EXCLUDED.lifecycle,
  confidence = EXCLUDED.confidence,
  category = EXCLUDED.category,
  updated_at = NOW();

-- =============================================================================
-- SUMMARY
-- =============================================================================
-- Run a count to verify
SELECT lifecycle, COUNT(*) as count FROM procedural_shards GROUP BY lifecycle ORDER BY lifecycle;

COMMIT;
