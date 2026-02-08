-- Expand patterns for all promoted shards that have narrow coverage
-- Goal: catch more natural language phrasings

-- ═══════════════════════════════════════════════════
-- LEGACY SHARDS WITH ONLY 1-2 PATTERNS (11)
-- ═══════════════════════════════════════════════════

UPDATE procedural_shards SET patterns = '["(?:calculate|what is|price|cost).*(?:\\d+%|percent).*discount", "(?:\\d+%|percent).*(?:off|discount).*\\$?\\d+", "\\$\\d+.*(?:with|after|at).*\\d+%", "discount.*price", "how much.*after.*discount"]'
WHERE name = 'calculate-discounted-price' AND lifecycle = 'promoted';

UPDATE procedural_shards SET patterns = '["convert.*celsius.*(?:to|in).*fahrenheit", "\\d+.*(?:celsius|°c|degrees? c).*(?:to|in|=).*(?:fahrenheit|°f|f)", "celsius to fahrenheit", "c to f", "how (?:much|many).*fahrenheit.*\\d+.*celsius"]'
WHERE name = 'celsius-to-fahrenheit-conversion' AND lifecycle = 'promoted';

UPDATE procedural_shards SET patterns = '["convert.*hours?.*(?:to|in).*minutes?", "\\d+.*hours?.*(?:to|in|=).*minutes?", "how many minutes.*\\d+.*hours?", "hours? to minutes?"]'
WHERE name = 'convert-hours-to-minutes' AND lifecycle = 'promoted';

UPDATE procedural_shards SET patterns = '["convert.*(?:km|kilometers?).*(?:to|in).*miles?", "\\d+.*(?:km|kilometers?).*(?:to|in|=).*miles?", "how many miles.*\\d+.*(?:km|kilometers?)", "(?:km|kilometers?) to miles?"]'
WHERE name = 'convert-kilometers-to-miles' AND lifecycle = 'promoted';

UPDATE procedural_shards SET patterns = '["convert.*(?:to|in).*(?:hex(?:adecimal)?)", "\\d+.*(?:to|in).*hex(?:adecimal)?", "(?:what is|convert).*\\d+.*hex", "decimal to hex", "number to hex"]'
WHERE name = 'decimal-to-hexadecimal-converter' AND lifecycle = 'promoted';

UPDATE procedural_shards SET patterns = '["convert.*fahrenheit.*(?:to|in).*celsius", "\\d+.*(?:fahrenheit|°f|degrees? f).*(?:to|in|=).*(?:celsius|°c|c)", "fahrenheit to celsius", "f to c", "how (?:much|many).*celsius.*\\d+.*fahrenheit"]'
WHERE name = 'fahrenheit-to-celsius-conversion' AND lifecycle = 'promoted';

UPDATE procedural_shards SET patterns = '["\\d+\\s*(?:mod|modulo|%)\\s*\\d+", "(?:what is|calculate).*\\d+.*(?:mod|modulo).*\\d+", "remainder.*\\d+.*(?:divided|by).*\\d+", "modulus.*\\d+.*\\d+", "mod of"]'
WHERE name = 'modulus-question-parser' AND lifecycle = 'promoted';

UPDATE procedural_shards SET patterns = '["(?:what is|find|calculate).*(?:fibonacci|fib).*(?:number|#|num)", "\\d+(?:th|st|nd|rd).*fibonacci", "fibonacci.*\\d+", "fibonacci.*sequence.*\\d+", "fib\\(\\d+\\)"]'
WHERE name = 'nth-fibonacci-number-extractor' AND lifecycle = 'promoted';

UPDATE procedural_shards SET patterns = '["is.*palindrome", "palindrome.*check", "check.*palindrome", ".*palindrome\\??$", "reverse.*same"]'
WHERE name = 'palindrome-checker' AND lifecycle = 'promoted';

UPDATE procedural_shards SET patterns = '["simple interest.*\\$?\\d+.*\\d+%.*\\d+.*year", "calculate.*simple interest", "interest on.*at.*for.*year", "simple interest.*calculator", "\\$\\d+.*\\d+%.*\\d+.*year"]'
WHERE name = 'simple-interest-calculation' AND lifecycle = 'promoted';

UPDATE procedural_shards SET patterns = '["area.*triangle.*(?:base|height|\\d+)", "triangle.*area.*\\d+", "calculate.*area.*triangle", "(?:base|height).*triangle.*\\d+", "triangle.*base.*height"]'
WHERE name = 'triangle-area-calculation' AND lifecycle = 'promoted';

-- ═══════════════════════════════════════════════════
-- WAVE 2 SHARDS: ADD MORE VARIATIONS
-- ═══════════════════════════════════════════════════

-- History shards - add "tell me about", "when was", "who created" etc
UPDATE procedural_shards SET patterns = '["who (?:invented|created|made) the (?:light ?bulb|lightbulb)", "invention of the (?:light ?bulb|lightbulb)", "edison.*(?:light|bulb|lamp)", "(?:light ?bulb|lightbulb).*invent", "tell me about.*(?:light ?bulb|lightbulb).*invention"]'
WHERE name = 'who-invented-lightbulb' AND lifecycle = 'promoted';

UPDATE procedural_shards SET patterns = '["who (?:painted|drew|created|made) the mona lisa", "mona lisa.*(?:paint|artist|who)", "leonardo.*mona lisa", "da vinci.*mona lisa", "tell me about the mona lisa"]'
WHERE name = 'who-painted-mona-lisa' AND lifecycle = 'promoted';

UPDATE procedural_shards SET patterns = '["who (?:discovered|figured out|formulated) gravity", "newton.*gravity", "law of (?:universal )?gravity", "gravity.*(?:discover|who)", "tell me about.*discovery of gravity"]'
WHERE name = 'who-discovered-gravity' AND lifecycle = 'promoted';

UPDATE procedural_shards SET patterns = '["when was the internet (?:invented|created|born|started)", "who (?:invented|created) the internet", "history of the internet", "origin of the internet", "arpanet", "tim berners.lee.*web", "how did the internet start"]'
WHERE name = 'when-was-internet-invented' AND lifecycle = 'promoted';

UPDATE procedural_shards SET patterns = '["who (?:was|is) (?:albert )?einstein", "tell me about einstein", "einstein.*(?:physicist|scientist|theory|relativity)", "theory of relativity.*who", "e.?mc.?2?.*who"]'
WHERE name = 'who-was-albert-einstein' AND lifecycle = 'promoted';

UPDATE procedural_shards SET patterns = '["(?:who|first).*(?:walk|step|land).*(?:on )?(?:the )?moon", "first (?:person|man|human|astronaut).*moon", "neil armstrong", "apollo 11", "moon landing.*who", "1969.*moon"]'
WHERE name = 'who-was-first-on-moon' AND lifecycle = 'promoted';

UPDATE procedural_shards SET patterns = '["who (?:invented|created|made) the (?:telephone|phone)", "alexander graham bell", "invention of the (?:telephone|phone)", "(?:telephone|phone).*invent", "first (?:telephone|phone) call"]'
WHERE name = 'who-invented-telephone' AND lifecycle = 'promoted';

UPDATE procedural_shards SET patterns = '["when did (?:ww2|world war (?:2|ii|two)) (?:end|finish)", "end of (?:ww2|world war)", "(?:ww2|world war).*(?:end|over)", "1945.*war.*end", "v.?e day", "v.?j day", "when.*world war.*over"]'
WHERE name = 'when-did-ww2-end' AND lifecycle = 'promoted';

UPDATE procedural_shards SET patterns = '["who wrote (?:romeo and juliet|hamlet|macbeth|othello)", "shakespeare.*(?:wrote|author|play)", "romeo and juliet.*(?:author|who|wrote)", "william shakespeare", "tell me about shakespeare", "hamlet.*who wrote"]'
WHERE name = 'who-wrote-romeo-and-juliet' AND lifecycle = 'promoted';

UPDATE procedural_shards SET patterns = '["declaration of independence.*(?:when|who|date|year|written|signed)", "who wrote the declaration", "july 4.*1776", "thomas jefferson.*declaration", "when was america (?:founded|born|created|established)", "independence day.*history"]'
WHERE name = 'declaration-of-independence' AND lifecycle = 'promoted';

UPDATE procedural_shards SET patterns = '["who (?:invented|built|created|made) the (?:airplane|plane|aeroplane|aircraft)", "wright brothers", "first (?:flight|airplane|plane)", "(?:airplane|plane|flight).*invent", "kitty hawk", "history of (?:flight|aviation)"]'
WHERE name = 'who-invented-airplane' AND lifecycle = 'promoted';

UPDATE procedural_shards SET patterns = '["who (?:discovered|found) america", "christopher columbus.*(?:america|1492|discover)", "columbus.*new world", "who (?:found|reached) the (?:new world|americas)", "1492.*discover", "leif erikson.*america"]'
WHERE name = 'who-discovered-america' AND lifecycle = 'promoted';

UPDATE procedural_shards SET patterns = '["who (?:invented|discovered) electricity", "benjamin franklin.*(?:electricity|lightning|kite)", "history of electricity", "nikola tesla.*electricity", "electricity.*(?:discover|invent|who)", "michael faraday.*electric"]'
WHERE name = 'who-invented-electricity' AND lifecycle = 'promoted';

UPDATE procedural_shards SET patterns = '["how old is the universe", "age of the universe", "when (?:did|was) the (?:universe|big bang) (?:begin|start|born|created)", "big bang.*(?:when|how long)", "universe.*(?:age|old|billion)", "13.?8? billion.*year"]'
WHERE name = 'how-old-is-the-universe' AND lifecycle = 'promoted';

UPDATE procedural_shards SET patterns = '["who is elon musk", "tell me about elon musk", "elon musk.*(?:who|what|ceo|tesla|spacex)", "what (?:does|did) elon musk (?:do|own|run)", "musk.*(?:tesla|spacex|twitter|x\\.com)"]'
WHERE name = 'who-is-elon-musk' AND lifecycle = 'promoted';

-- Animal shards
UPDATE procedural_shards SET patterns = '["fastest (?:animal|creature|bird|land animal)", "what is the fastest (?:animal|creature)", "how fast.*(?:cheetah|peregrine|falcon)", "speed.*(?:cheetah|falcon|marlin)", "fastest.*(?:on earth|in the world)"]'
WHERE name = 'fastest-animal' AND lifecycle = 'promoted';

UPDATE procedural_shards SET patterns = '["(?:largest|biggest) (?:animal|creature)(?:.*(?:earth|world|ever))?", "blue whale.*(?:size|big|large|heavy|long)", "how (?:big|large|heavy|long).*blue whale", "biggest.*(?:animal|creature).*ever"]'
WHERE name = 'largest-animal' AND lifecycle = 'promoted';

UPDATE procedural_shards SET patterns = '["how long do dogs (?:live|last)", "dog.*(?:lifespan|life expectancy|life span)", "(?:average|typical).*dog.*(?:life|age|old)", "how old (?:do|can) dogs (?:live|get)", "oldest dog.*(?:ever|record)"]'
WHERE name = 'how-long-do-dogs-live' AND lifecycle = 'promoted';

UPDATE procedural_shards SET patterns = '["how long do cats (?:live|last)", "cat.*(?:lifespan|life expectancy|life span)", "(?:average|typical).*cat.*(?:life|age|old)", "how old (?:do|can) cats (?:live|get)", "oldest cat.*(?:ever|record)"]'
WHERE name = 'how-long-do-cats-live' AND lifecycle = 'promoted';

-- Science shards
UPDATE procedural_shards SET patterns = '["why is the sky blue", "(?:sky|atmosphere).*(?:blue|color).*why", "what makes the sky blue", "rayleigh scattering", "sky.*(?:appear|look).*blue"]'
WHERE name = 'why-is-sky-blue' AND lifecycle = 'promoted';

UPDATE procedural_shards SET patterns = '["what is a black hole", "how (?:do|does|are) black holes? (?:form|work|created|made)", "black hole.*explain", "explain black holes?", "tell me about black holes?", "inside.*black hole"]'
WHERE name = 'what-is-a-black-hole' AND lifecycle = 'promoted';

UPDATE procedural_shards SET patterns = '["what is (?:a )?light.?year", "how (?:far|long) is a light.?year", "light.?year.*(?:distance|miles|km|kilometers)", "define light.?year", "light.?year.*(?:mean|equal|measure)"]'
WHERE name = 'distance-light-year' AND lifecycle = 'promoted';

UPDATE procedural_shards SET patterns = '["newton.?s (?:three |3 )?laws?(?:of motion)?", "laws? of motion", "first law of motion", "second law of motion", "third law of motion", "f.?=.?ma", "what (?:are|is) newton"]'
WHERE name = 'newtons-laws-of-motion' AND lifecycle = 'promoted';

UPDATE procedural_shards SET patterns = '["what is e.?=.?mc", "e equals mc squared", "einstein.?s (?:equation|formula)", "mass.energy equivalence", "what does e.?mc.?2 mean", "explain e.?=.?mc"]'
WHERE name = 'what-is-e-mc-squared' AND lifecycle = 'promoted';

-- Programming shards
UPDATE procedural_shards SET patterns = '["http.*status.*code", "what (?:is|does).*http.*\\d{3}", "status code \\d{3}", "http \\d{3}", "\\d{3}.*(?:status|error|response).*code", "list.*http.*codes"]'
WHERE name = 'http-status-codes' AND lifecycle = 'promoted';

UPDATE procedural_shards SET patterns = '["what is python(?:.*(?:language|programming))?", "tell me about python.*programming", "python programming language", "what is python used for", "explain python(?:.*language)?", "python vs"]'
WHERE name = 'what-is-python' AND lifecycle = 'promoted';

UPDATE procedural_shards SET patterns = '["what is javascript(?:.*(?:language|programming))?", "tell me about javascript", "javascript programming", "what is js(?:.*used for)?", "explain javascript", "javascript vs"]'
WHERE name = 'what-is-javascript' AND lifecycle = 'promoted';

UPDATE procedural_shards SET patterns = '["what is html", "explain html", "html.*(?:language|markup|web)", "what does html stand for", "hypertext markup", "html.*basics"]'
WHERE name = 'what-is-html' AND lifecycle = 'promoted';

UPDATE procedural_shards SET patterns = '["what is css", "explain css", "css.*(?:style|web|design)", "what does css stand for", "cascading style sheets?", "css.*basics"]'
WHERE name = 'what-is-css' AND lifecycle = 'promoted';

UPDATE procedural_shards SET patterns = '["what is sql", "explain sql", "sql.*(?:database|query|language)", "what does sql stand for", "structured query language", "sql.*basics"]'
WHERE name = 'what-is-sql' AND lifecycle = 'promoted';

UPDATE procedural_shards SET patterns = '["what is git(?:hub)?", "explain git", "git.*version control", "how does git work", "what is github", "git.*basics", "version control.*git"]'
WHERE name = 'what-is-git' AND lifecycle = 'promoted';

UPDATE procedural_shards SET patterns = '["what is react(?:js)?", "explain react", "react.*(?:framework|library|javascript)", "how does react work", "react.*basics", "react vs", "tell me about react"]'
WHERE name = 'what-is-react' AND lifecycle = 'promoted';

UPDATE procedural_shards SET patterns = '["what is docker", "explain docker", "docker.*container", "how does docker work", "what (?:is|are) containers?", "docker.*basics", "docker vs.*(?:vm|virtual)"]'
WHERE name = 'what-is-docker' AND lifecycle = 'promoted';

UPDATE procedural_shards SET patterns = '["what is (?:a )?rest(?:ful)? api", "explain rest(?:ful)?", "rest.*(?:architecture|api|web)", "how.*rest api.*work", "rest.*basics", "get post put delete"]'
WHERE name = 'what-is-rest-api' AND lifecycle = 'promoted';

UPDATE procedural_shards SET patterns = '["big o notation", "what is big o", "time complexity", "algorithm.*complexity", "big o.*explain", "o\\(n\\)|o\\(1\\)|o\\(log|o\\(n.2", "complexity.*algorithm"]'
WHERE name = 'big-o-notation' AND lifecycle = 'promoted';

-- Geography shards
UPDATE procedural_shards SET patterns = '["world population", "how many people.*(?:world|earth|planet)", "population of (?:the )?(?:world|earth)", "global population", "earth.*population", "how many humans"]'
WHERE name = 'world-population' AND lifecycle = 'promoted';

UPDATE procedural_shards SET patterns = '["population of (?:the )?(?:us(?:a)?|united states|america)", "how many people.*(?:us(?:a)?|united states|america)", "(?:us(?:a)?|united states|america).*population", "how many americans"]'
WHERE name = 'population-of-usa' AND lifecycle = 'promoted';

UPDATE procedural_shards SET patterns = '["how many countries", "number of countries", "countries in the world", "how many nations", "total (?:number of )?countries", "195 countries"]'
WHERE name = 'how-many-countries' AND lifecycle = 'promoted';

UPDATE procedural_shards SET patterns = '["how many (?:states|us states)(?:.*(?:us|usa|america|united states))?", "number of (?:us )?states", "(?:50|fifty) states", "states in (?:the )?(?:us|usa|america|united states)", "how many states does america have"]'
WHERE name = 'how-many-states-in-usa' AND lifecycle = 'promoted';

-- Health shards
UPDATE procedural_shards SET patterns = '["normal (?:body |human )?temperature", "(?:body|human) temperature.*normal", "what is (?:normal|average|healthy) (?:body )?temperature", "98\\.6|37.*celsius.*body", "do i have a fever"]'
WHERE name = 'normal-body-temperature' AND lifecycle = 'promoted';

UPDATE procedural_shards SET patterns = '["how many bones.*(?:human|body|we|person)", "number of bones", "bones in the.*(?:body|skeleton)", "how many bones (?:do|does) (?:a |the )?(?:human|body|person|we) have", "206 bones", "human skeleton.*bones"]'
WHERE name = 'how-many-bones-in-body' AND lifecycle = 'promoted';

UPDATE procedural_shards SET patterns = '["how much (?:water|fluid) (?:should|do|to) (?:i|you|we|a person).*drink", "daily water (?:intake|requirement|recommendation)", "how many (?:cups|glasses|liters|ounces).*water.*(?:day|daily)", "8 (?:cups|glasses).*water", "recommended water"]'
WHERE name = 'how-much-water-per-day' AND lifecycle = 'promoted';

UPDATE procedural_shards SET patterns = '["how much sleep (?:do|should|does) (?:i|you|we|a person|an adult|adults?) (?:need|require|get)", "how many hours.*sleep", "recommended.*sleep.*(?:hours|amount)", "sleep.*per night", "how long should (?:i|you|we) sleep"]'
WHERE name = 'how-much-sleep-needed' AND lifecycle = 'promoted';

UPDATE procedural_shards SET patterns = '["how many calories.*(?:day|daily|need|eat|consume)", "daily calorie.*(?:intake|requirement|need)", "calories per day", "recommended calories", "how (?:much|many).*(?:calories|cal).*(?:should|need|day)"]'
WHERE name = 'how-many-calories-per-day' AND lifecycle = 'promoted';

UPDATE procedural_shards SET patterns = '["(?:calculate|compute|what is|find) (?:my )?bmi", "body mass index", "bmi (?:for|calculator|of)", "bmi.*(?:\\d+.*(?:lb|kg|pound|kilo))", "(?:am i|is.*) (?:overweight|obese|underweight|normal weight)"]'
WHERE name = 'bmi-calculator' AND lifecycle = 'promoted';

-- Fun/interactive shards
UPDATE procedural_shards SET patterns = '["flip (?:a )?coin", "coin flip", "heads or tails", "toss (?:a )?coin", "coin toss", "flip.*coin.*for me"]'
WHERE name = 'coin-flip' AND lifecycle = 'promoted';

UPDATE procedural_shards SET patterns = '["roll (?:a |the )?(?:di(?:ce|e)|d\\d+)", "dice roll", "\\d*d\\d+", "throw (?:a |the )?(?:di(?:ce|e))", "roll.*(?:sided|side)", "roll for me"]'
WHERE name = 'dice-roller' AND lifecycle = 'promoted';

UPDATE procedural_shards SET patterns = '["rock paper scissors", "play (?:rock paper|rps)", "(?:i (?:choose|pick|play) )?(?:rock|paper|scissors)", "rps.*(?:rock|paper|scissors)", "lets? play.*(?:rock|rps)"]'
WHERE name = 'rock-paper-scissors' AND lifecycle = 'promoted';

UPDATE procedural_shards SET patterns = '["magic 8.?ball", "8.?ball", "shake.*(?:8|eight).?ball", "ask.*(?:8|eight).?ball", "fortune.*ball", "(?:8|eight) ball.*(?:say|predict|answer)"]'
WHERE name = 'magic-8-ball' AND lifecycle = 'promoted';

-- Common question shards
UPDATE procedural_shards SET patterns = '["how does (?:wi-?fi|wifi) work", "what is (?:wi-?fi|wifi)", "explain (?:wi-?fi|wifi)", "(?:wi-?fi|wifi).*(?:work|explain|mean)", "wireless.*internet.*work"]'
WHERE name = 'how-does-wifi-work' AND lifecycle = 'promoted';

UPDATE procedural_shards SET patterns = '["how does gps work", "what is gps", "explain gps", "gps.*(?:work|satellite|explained)", "global positioning system", "how.*gps.*accurate"]'
WHERE name = 'how-does-gps-work' AND lifecycle = 'promoted';

UPDATE procedural_shards SET patterns = '["what is crypt(?:o|ocurrency)", "explain crypt(?:o|ocurrency)", "how does (?:crypto|bitcoin) work", "what is bitcoin", "bitcoin.*explain", "cryptocurrency.*(?:work|mean|explain)"]'
WHERE name = 'what-is-cryptocurrency' AND lifecycle = 'promoted';

UPDATE procedural_shards SET patterns = '["what is quantum comput(?:ing|er)", "explain quantum comput", "how.*quantum comput.*work", "quantum computer.*(?:explain|work)", "qubit", "quantum.*(?:supremacy|advantage)"]'
WHERE name = 'what-is-quantum-computing' AND lifecycle = 'promoted';

UPDATE procedural_shards SET patterns = '["what is (?:climate change|global warming)", "explain climate change", "global warming.*(?:cause|explain|mean)", "what causes climate change", "greenhouse.*(?:effect|gas)", "is climate change real"]'
WHERE name = 'what-is-climate-change' AND lifecycle = 'promoted';

UPDATE procedural_shards SET patterns = '["what is (?:a )?vpn", "how does (?:a )?vpn work", "explain vpn", "virtual private network", "vpn.*(?:work|mean|explain|do)", "why.*use.*vpn", "do i need.*vpn"]'
WHERE name = 'what-is-vpn' AND lifecycle = 'promoted';

UPDATE procedural_shards SET patterns = '["what is (?:the )?cloud(?:.*comput)?", "explain.*cloud comput", "how does the cloud work", "cloud.*(?:computing|storage|server)", "aws|azure|google cloud", "what.*cloud.*mean"]'
WHERE name = 'what-is-the-cloud' AND lifecycle = 'promoted';

-- Verify pattern counts after update
SELECT name, jsonb_array_length(patterns) as pattern_count
FROM procedural_shards
WHERE lifecycle = 'promoted' AND jsonb_array_length(patterns) <= 2
ORDER BY pattern_count, name;
