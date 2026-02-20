-- Populate pattern_hash for all 151 promoted shards missing it
-- Using human-readable intent templates matching the existing format

-- Math Constants
UPDATE procedural_shards SET pattern_hash = 'value of pi' WHERE name = 'pi-value' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'value of euler''s number' WHERE name = 'euler-number' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'value of the golden ratio' WHERE name = 'golden-ratio' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'speed of light in m/s' WHERE name = 'speed-of-light' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'absolute zero temperature' WHERE name = 'absolute-zero-temperature' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'speed of sound in m/s' WHERE name = 'speed-of-sound' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'avogadro''s number' WHERE name = 'avogadro-number' AND pattern_hash IS NULL;

-- Earth & Space
UPDATE procedural_shards SET pattern_hash = 'diameter of earth in km' WHERE name = 'earth-diameter' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'age of earth in years' WHERE name = 'earth-age' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'distance from earth to moon' WHERE name = 'distance-to-moon' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'distance from earth to sun' WHERE name = 'distance-to-sun' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'number of planets in solar system' WHERE name = 'planets-in-solar-system' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'largest planet in solar system' WHERE name = 'largest-planet' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'tallest mountain in the world' WHERE name = 'tallest-mountain' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'deepest point in the ocean' WHERE name = 'deepest-ocean-point' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'number of continents on earth' WHERE name = 'how-many-continents' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'number of oceans on earth' WHERE name = 'how-many-oceans' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'longest river in the world' WHERE name = 'longest-river' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'largest country by area' WHERE name = 'largest-country' AND pattern_hash IS NULL;

-- Science Basics
UPDATE procedural_shards SET pattern_hash = 'boiling point of water' WHERE name = 'boiling-point-of-water' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'freezing point of water' WHERE name = 'freezing-point-of-water' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'force of gravity on earth' WHERE name = 'what-is-gravity' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'how photosynthesis works' WHERE name = 'what-is-photosynthesis' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'what is DNA' WHERE name = 'what-is-dna' AND pattern_hash IS NULL;

-- Tech Definitions
UPDATE procedural_shards SET pattern_hash = 'what is artificial intelligence' WHERE name = 'what-is-artificial-intelligence' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'what is machine learning' WHERE name = 'what-is-machine-learning' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'what is an algorithm' WHERE name = 'what-is-an-algorithm' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'what is blockchain' WHERE name = 'what-is-blockchain' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'how does the internet work' WHERE name = 'how-does-the-internet-work' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'what is an API' WHERE name = 'what-is-an-api' AND pattern_hash IS NULL;

-- About ALF
UPDATE procedural_shards SET pattern_hash = 'who is ALF' WHERE name = 'who-is-alf' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'what can ALF do' WHERE name = 'what-can-alf-do' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'how ALF differs from chatbots' WHERE name = 'how-is-alf-different' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'what is a knowledge shard' WHERE name = 'what-is-a-knowledge-shard' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'how ALF works' WHERE name = 'how-does-alf-work' AND pattern_hash IS NULL;

-- Fun
UPDATE procedural_shards SET pattern_hash = 'meaning of life (42)' WHERE name = 'meaning-of-life' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'tell me a joke' WHERE name = 'tell-me-a-joke' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'random fun fact' WHERE name = 'random-fun-fact' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'hello greeting response' WHERE name = 'hello-greeting' AND pattern_hash IS NULL;

-- Unit Conversions
UPDATE procedural_shards SET pattern_hash = 'convert {n} miles to kilometers' WHERE name = 'miles-to-kilometers' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'convert {n} feet to meters' WHERE name = 'feet-to-meters' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'convert {n} gallons to liters' WHERE name = 'gallons-to-liters' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'convert {n} kg to pounds' WHERE name = 'kilograms-to-pounds' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'convert {n} cm to inches' WHERE name = 'centimeters-to-inches' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'convert {n} meters to feet' WHERE name = 'meters-to-feet' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'convert {n} km to miles' WHERE name = 'convert-kilometers-to-miles' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'convert {n} inches to cm' WHERE name = 'inches-to-centimeters-converter' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'convert {n} pounds to kg' WHERE name = 'pounds-to-kilograms-converter' AND pattern_hash IS NULL;

-- Math Operations
UPDATE procedural_shards SET pattern_hash = 'basic arithmetic {a} + - * / {b}' WHERE name = 'basic-arithmetic' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'what is {n}% of {m}' WHERE name = 'percentage-calculator' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'square root of {n}' WHERE name = 'square-root-calculator' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'average of {numbers}' WHERE name = 'average-calculator' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = '{n} to the power of {m}' WHERE name = 'power-calculation' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = '{base}^{exp} exponent' WHERE name = 'exponent-calculator' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = '{n} mod {m} modulus' WHERE name = 'modulus-question-parser' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'absolute value of {n}' WHERE name = 'absolute-value-calculator' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'find maximum in {numbers}' WHERE name = 'find-maximum-number' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'median of {numbers}' WHERE name = 'median-of-numbers-from-natural-language-request' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'sort {numbers} ascending' WHERE name = 'sort-numbers-ascending' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'remove duplicates from {list}' WHERE name = 'remove-duplicates-from-list' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'pythagorean theorem {a} and {b}' WHERE name = 'pythagorean-theorem' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'convert {n} to roman numerals' WHERE name = 'number-to-roman-numeral' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'random number between {min} and {max}' WHERE name = 'random-number-generator' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'compound interest {principal} at {rate}% for {years}' WHERE name = 'compound-interest-calculator' AND pattern_hash IS NULL;

-- Date/Time
UPDATE procedural_shards SET pattern_hash = 'what year is it now' WHERE name = 'current-year' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'today''s date' WHERE name = 'current-date' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'days remaining in the year' WHERE name = 'days-in-year' AND pattern_hash IS NULL;

-- Temperature
UPDATE procedural_shards SET pattern_hash = 'convert {n} celsius to kelvin' WHERE name = 'celsius-to-kelvin' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'convert temperature between F/C/K' WHERE name = 'temperature-converter' AND pattern_hash IS NULL;

-- Promoted from testing
UPDATE procedural_shards SET pattern_hash = 'temperature of the sun' WHERE name = 'sun-temperature-info' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'is {n} a prime number' WHERE name = 'check-if-number-is-prime' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'explain {concept} in simple terms' WHERE name = 'explain-concept-simply' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'write a haiku about {topic}' WHERE name = 'haiku-generator' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'is {email} a valid email' WHERE name = 'email-validator' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'convert {text} to uppercase' WHERE name = 'convert-string-to-uppercase' AND pattern_hash IS NULL;

-- String utilities
UPDATE procedural_shards SET pattern_hash = 'reverse the string {text}' WHERE name = 'reverse-string-procedure' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'is {word} a palindrome' WHERE name = 'palindrome-checker' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'convert {text} to title case' WHERE name = 'title-case-converter' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'count words in {text}' WHERE name = 'word-count-in-text' AND pattern_hash IS NULL;

-- History & People (Wave 2)
UPDATE procedural_shards SET pattern_hash = 'who invented the light bulb' WHERE name = 'who-invented-lightbulb' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'who painted the Mona Lisa' WHERE name = 'who-painted-mona-lisa' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'who discovered gravity' WHERE name = 'who-discovered-gravity' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'when was the internet invented' WHERE name = 'when-was-internet-invented' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'who was Albert Einstein' WHERE name = 'who-was-albert-einstein' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'first person to walk on the moon' WHERE name = 'who-was-first-on-moon' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'who invented the telephone' WHERE name = 'who-invented-telephone' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'when did World War 2 end' WHERE name = 'when-did-ww2-end' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'who wrote Romeo and Juliet' WHERE name = 'who-wrote-romeo-and-juliet' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'Declaration of Independence history' WHERE name = 'declaration-of-independence' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'who invented the airplane' WHERE name = 'who-invented-airplane' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'who discovered America' WHERE name = 'who-discovered-america' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'who discovered electricity' WHERE name = 'who-invented-electricity' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'age of the universe' WHERE name = 'how-old-is-the-universe' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'who is Elon Musk' WHERE name = 'who-is-elon-musk' AND pattern_hash IS NULL;

-- Animals & Nature (Wave 2)
UPDATE procedural_shards SET pattern_hash = 'fastest animal on earth' WHERE name = 'fastest-animal' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'largest animal on earth' WHERE name = 'largest-animal' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'how long do dogs live' WHERE name = 'how-long-do-dogs-live' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'how long do cats live' WHERE name = 'how-long-do-cats-live' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'tallest animal on earth' WHERE name = 'tallest-animal' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'number of species on earth' WHERE name = 'how-many-species-on-earth' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'why is the sky blue' WHERE name = 'why-is-sky-blue' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'why do leaves change color in fall' WHERE name = 'why-do-leaves-change-color' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'how do birds fly' WHERE name = 'how-do-birds-fly' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'biggest dinosaur ever' WHERE name = 'biggest-dinosaur' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'when did dinosaurs go extinct' WHERE name = 'when-did-dinosaurs-go-extinct' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'how do magnets work' WHERE name = 'how-do-magnets-work' AND pattern_hash IS NULL;

-- Human Body & Health (Wave 2)
UPDATE procedural_shards SET pattern_hash = 'normal human body temperature' WHERE name = 'normal-body-temperature' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'number of bones in human body' WHERE name = 'how-many-bones-in-body' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'how much water to drink per day' WHERE name = 'how-much-water-per-day' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'number of muscles in human body' WHERE name = 'how-many-muscles-in-body' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'amount of blood in human body' WHERE name = 'how-much-blood-in-body' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'number of cells in human body' WHERE name = 'how-many-cells-in-body' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'recommended sleep by age' WHERE name = 'how-much-sleep-needed' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'how fast does hair grow' WHERE name = 'how-fast-does-hair-grow' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'normal resting heart rate' WHERE name = 'resting-heart-rate' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'normal blood pressure range' WHERE name = 'normal-blood-pressure' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'daily calorie intake recommendation' WHERE name = 'how-many-calories-per-day' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'BMI calculator {weight} {height}' WHERE name = 'bmi-calculator' AND pattern_hash IS NULL;

-- Chemistry & Physics (Wave 2)
UPDATE procedural_shards SET pattern_hash = 'chemical formula for water (H2O)' WHERE name = 'water-chemical-formula' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'number of elements in periodic table' WHERE name = 'periodic-table-elements' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'E=mc² mass-energy equivalence' WHERE name = 'what-is-e-mc-squared' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'Newton''s three laws of motion' WHERE name = 'newtons-laws-of-motion' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'what is an atom' WHERE name = 'what-is-an-atom' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'states of matter (solid/liquid/gas/plasma)' WHERE name = 'states-of-matter' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'what is a black hole' WHERE name = 'what-is-a-black-hole' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'what is a light-year' WHERE name = 'distance-light-year' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'what is electricity' WHERE name = 'what-is-electricity' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'what causes earthquakes' WHERE name = 'what-causes-earthquakes' AND pattern_hash IS NULL;

-- Programming & Tech (Wave 2)
UPDATE procedural_shards SET pattern_hash = 'HTTP status code lookup' WHERE name = 'http-status-codes' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'what is the Python programming language' WHERE name = 'what-is-python' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'what is JavaScript' WHERE name = 'what-is-javascript' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'what is HTML' WHERE name = 'what-is-html' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'what is CSS' WHERE name = 'what-is-css' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'what is SQL' WHERE name = 'what-is-sql' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'what is Git version control' WHERE name = 'what-is-git' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'what is React framework' WHERE name = 'what-is-react' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'what is Docker containerization' WHERE name = 'what-is-docker' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'what is a REST API' WHERE name = 'what-is-rest-api' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'Big O notation time complexity' WHERE name = 'big-o-notation' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'compiled vs interpreted languages' WHERE name = 'difference-compiled-interpreted' AND pattern_hash IS NULL;

-- Geography & World (Wave 2)
UPDATE procedural_shards SET pattern_hash = 'world population count' WHERE name = 'world-population' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'population of the United States' WHERE name = 'population-of-usa' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'number of countries in the world' WHERE name = 'how-many-countries' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'number of languages in the world' WHERE name = 'how-many-languages' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'largest ocean (Pacific)' WHERE name = 'largest-ocean' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'largest desert in the world' WHERE name = 'largest-desert' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'number of time zones' WHERE name = 'how-many-time-zones' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'smallest country (Vatican City)' WHERE name = 'smallest-country' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'most populated city (Tokyo)' WHERE name = 'most-populated-city' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'number of US states (50)' WHERE name = 'how-many-states-in-usa' AND pattern_hash IS NULL;

-- Common Questions & Trivia (Wave 2)
UPDATE procedural_shards SET pattern_hash = 'how does WiFi work' WHERE name = 'how-does-wifi-work' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'how does GPS work' WHERE name = 'how-does-gps-work' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'what is cryptocurrency/bitcoin' WHERE name = 'what-is-cryptocurrency' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'what is quantum computing' WHERE name = 'what-is-quantum-computing' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'what is climate change' WHERE name = 'what-is-climate-change' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'how does evolution work' WHERE name = 'how-does-evolution-work' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'how do vaccines work' WHERE name = 'how-do-vaccines-work' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'what is cloud computing' WHERE name = 'what-is-the-cloud' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'what is a VPN' WHERE name = 'what-is-vpn' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'what is renewable energy' WHERE name = 'what-is-renewable-energy' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'flip a coin (heads/tails)' WHERE name = 'coin-flip' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'roll {n}d{sides} dice' WHERE name = 'dice-roller' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'rock paper scissors game' WHERE name = 'rock-paper-scissors' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'magic 8-ball fortune' WHERE name = 'magic-8-ball' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'golden hour in photography' WHERE name = 'what-is-the-golden-hour' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'mass/weight of earth' WHERE name = 'how-much-does-earth-weigh' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'distance from earth to Mars' WHERE name = 'how-far-is-mars' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'Fibonacci sequence explained' WHERE name = 'what-is-the-fibonacci-sequence' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'number of stars in the universe' WHERE name = 'how-many-stars-in-universe' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'why do we dream' WHERE name = 'why-do-we-dream' AND pattern_hash IS NULL;

-- Misc remaining
UPDATE procedural_shards SET pattern_hash = 'how are you response' WHERE name = 'greeting-how-are-you-response' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'simple interest {principal} at {rate}% for {years}' WHERE name = 'simple-interest-calculation' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = '{n}th fibonacci number' WHERE name = 'nth-fibonacci-number-extractor' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'area of triangle base {b} height {h}' WHERE name = 'triangle-area-calculation' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'convert {n} fahrenheit to celsius' WHERE name = 'fahrenheit-to-celsius-conversion' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'convert {n} celsius to fahrenheit' WHERE name = 'celsius-to-fahrenheit-conversion' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'convert {n} to hexadecimal' WHERE name = 'decimal-to-hexadecimal-converter' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'GCD of {a} and {b}' WHERE name = 'greatest-common-divisor' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'convert hex {n} to decimal' WHERE name = 'hex-to-decimal-converter' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'LCM of {a} and {b}' WHERE name = 'least-common-multiple-calculator' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'is {year} a leap year' WHERE name = 'leap-year-checker' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = '{n} factorial' WHERE name = 'factorial-question-handler' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'convert {n} binary to decimal' WHERE name = 'binary-to-decimal-converter' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'what is the capital of {country}' WHERE name = 'capital-city-query' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'area of circle with radius {r}' WHERE name = 'calculate-area-of-circle-from-radius-question' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = '{n}% discount on ${price}' WHERE name = 'calculate-discounted-price' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'area of rectangle {l} by {w}' WHERE name = 'calculate-rectangle-area' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = '{p}% tip on ${amount}' WHERE name = 'calculate-tip-amount' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'convert {n} hours to minutes' WHERE name = 'convert-hours-to-minutes' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'convert {n} km to miles' WHERE name = 'convert-kilometers-to-miles' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'convert {n} pounds to kg' WHERE name = 'pounds-to-kilograms-converter' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = 'convert {n} inches to cm' WHERE name = 'inches-to-centimeters-converter' AND pattern_hash IS NULL;
UPDATE procedural_shards SET pattern_hash = '{n} mod {m}' WHERE name = 'modulus-question-parser' AND pattern_hash IS NULL;

-- Verify: how many still missing?
SELECT COUNT(*) as still_missing FROM procedural_shards WHERE lifecycle = 'promoted' AND (pattern_hash IS NULL OR pattern_hash = '');
