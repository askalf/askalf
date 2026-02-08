-- WAVE 2: 100 new high-value demo shards
-- Target: common questions demo visitors will actually ask

-- ═══════════════════════════════════════════════════
-- HISTORY & FAMOUS PEOPLE (15)
-- ═══════════════════════════════════════════════════

INSERT INTO procedural_shards (id, name, version, logic, patterns, knowledge_type, visibility, lifecycle, confidence, synthesis_method, synthesis_confidence, description, category, estimated_tokens)
VALUES
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'who-invented-lightbulb',
  1,
  'function execute(input) { return "Thomas Edison is widely credited with inventing the practical incandescent light bulb in 1879. However, many inventors contributed to the concept, including Humphry Davy, Warren de la Rue, and Joseph Swan. Edison''s key innovation was creating a long-lasting filament and a commercially viable system."; }',
  '["who invented the light ?bulb", "who made the light ?bulb", "invention of the light ?bulb", "edison.*light ?bulb"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'Who invented the light bulb',
  'history',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'who-painted-mona-lisa',
  1,
  'function execute(input) { return "The Mona Lisa was painted by Leonardo da Vinci, likely between 1503 and 1519. It''s believed to depict Lisa Gherardini, wife of Florentine merchant Francesco del Giocondo. The painting hangs in the Louvre Museum in Paris and is arguably the most famous painting in the world."; }',
  '["who painted the mona lisa", "mona lisa.*paint", "mona lisa.*artist", "who made the mona lisa"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'Who painted the Mona Lisa',
  'history',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'who-discovered-gravity',
  1,
  'function execute(input) { return "Sir Isaac Newton formulated the law of universal gravitation in 1687, published in his Principia Mathematica. The famous (likely apocryphal) story says he was inspired by watching an apple fall from a tree. His law states that every mass attracts every other mass with a force proportional to the product of their masses and inversely proportional to the square of the distance between them."; }',
  '["who discovered gravity", "newton.*gravity", "law of gravity.*who", "who figured out gravity"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'Who discovered gravity',
  'history',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'when-was-internet-invented',
  1,
  'function execute(input) { return "The internet evolved over decades. ARPANET, its predecessor, sent its first message in 1969. TCP/IP was standardized in 1983 (often considered the internet''s birthday). Tim Berners-Lee invented the World Wide Web in 1989 at CERN. The first web browser went public in 1991, and the internet became mainstream in the mid-1990s."; }',
  '["when was the internet invented", "who invented the internet", "history of the internet", "when did the internet start", "origin of the internet"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'When was the internet invented',
  'history',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'who-was-albert-einstein',
  1,
  'function execute(input) { return "Albert Einstein (1879–1955) was a German-born theoretical physicist, widely regarded as one of the greatest scientists in history. He developed the theory of special relativity (1905) and general relativity (1915), and his equation E=mc² showed that mass and energy are equivalent. He won the Nobel Prize in Physics in 1921 for his explanation of the photoelectric effect."; }',
  '["who was albert einstein", "who is albert einstein", "tell me about einstein", "einstein.*physicist"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'Who was Albert Einstein',
  'history',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'who-was-first-on-moon',
  1,
  'function execute(input) { return "Neil Armstrong was the first human to walk on the Moon on July 20, 1969, during the Apollo 11 mission. His famous words were: \"That''s one small step for man, one giant leap for mankind.\" Buzz Aldrin joined him on the surface shortly after, while Michael Collins orbited above in the command module."; }',
  '["who was first on the moon", "first person on the moon", "first man on the moon", "who walked on the moon first", "neil armstrong.*moon", "apollo 11"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'First person on the Moon',
  'history',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'who-invented-telephone',
  1,
  'function execute(input) { return "Alexander Graham Bell is credited with patenting the first practical telephone in 1876. He made the first successful call to his assistant Thomas Watson, saying \"Mr. Watson, come here, I want to see you.\" However, other inventors like Elisha Gray and Antonio Meucci also made significant contributions to telephone technology."; }',
  '["who invented the telephone", "who invented the phone", "alexander graham bell.*telephone", "invention of the telephone"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'Who invented the telephone',
  'history',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'when-did-ww2-end',
  1,
  'function execute(input) { return "World War II ended in 1945. Germany surrendered on May 8, 1945 (V-E Day, Victory in Europe). Japan surrendered on August 15, 1945 (V-J Day) following the atomic bombings of Hiroshima (August 6) and Nagasaki (August 9). The formal surrender was signed on September 2, 1945, aboard the USS Missouri in Tokyo Bay."; }',
  '["when did ww2 end", "when did world war 2 end", "when did world war ii end", "end of ww2", "end of world war"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'When did World War 2 end',
  'history',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'who-wrote-romeo-and-juliet',
  1,
  'function execute(input) { return "Romeo and Juliet was written by William Shakespeare, believed to have been composed between 1591 and 1596. It''s one of the most famous love stories ever told, about two young lovers from feuding families in Verona, Italy. Shakespeare also wrote Hamlet, Macbeth, Othello, A Midsummer Night''s Dream, and about 37 plays in total."; }',
  '["who wrote romeo and juliet", "shakespeare.*romeo", "romeo and juliet.*author", "who wrote hamlet", "who was shakespeare"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'Who wrote Romeo and Juliet',
  'history',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'declaration-of-independence',
  1,
  'function execute(input) { return "The United States Declaration of Independence was adopted on July 4, 1776. It was primarily authored by Thomas Jefferson, with contributions from Benjamin Franklin, John Adams, Roger Sherman, and Robert Livingston. It declared the thirteen American colonies free from British rule and established the principles of individual liberty and government by consent of the governed."; }',
  '["when was.*declaration of independence", "who wrote the declaration of independence", "declaration of independence.*date", "july 4.*1776", "when was america founded"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'Declaration of Independence facts',
  'history',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'who-invented-airplane',
  1,
  'function execute(input) { return "The Wright brothers — Orville and Wilbur Wright — made the first sustained, controlled, powered heavier-than-air flight on December 17, 1903, at Kitty Hawk, North Carolina. Their first flight lasted 12 seconds and covered 120 feet. They made four flights that day, the longest lasting 59 seconds and covering 852 feet."; }',
  '["who invented the airplane", "who invented the plane", "wright brothers", "first flight.*airplane", "who invented flight"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'Who invented the airplane',
  'history',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'who-discovered-america',
  1,
  'function execute(input) { return "Christopher Columbus reached the Americas on October 12, 1492, landing in the Bahamas. However, the Americas were already home to millions of Indigenous peoples. Norse explorer Leif Erikson reached North America around 1000 AD, roughly 500 years before Columbus. The continent was named after Amerigo Vespucci, who recognized it as a separate landmass."; }',
  '["who discovered america", "christopher columbus.*america", "columbus.*1492", "who found america"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'Who discovered America',
  'history',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'who-invented-electricity',
  1,
  'function execute(input) { return "Electricity wasn''t invented — it''s a natural phenomenon. However, Benjamin Franklin proved lightning was electrical in 1752 with his famous kite experiment. Michael Faraday discovered electromagnetic induction in 1831, enabling electric generators. Thomas Edison built the first practical electrical distribution system in 1882. Nikola Tesla developed alternating current (AC) systems that became the standard for power transmission."; }',
  '["who invented electricity", "who discovered electricity", "benjamin franklin.*electricity", "history of electricity"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'Who invented electricity',
  'history',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'how-old-is-the-universe',
  1,
  'function execute(input) { return "The universe is approximately 13.8 billion years old, based on observations of the cosmic microwave background radiation by the Planck satellite and WMAP. The Big Bang — the event that started the expansion of the universe — occurred about 13.787 billion years ago. For perspective, our solar system is about 4.6 billion years old, making it roughly one-third the age of the universe."; }',
  '["how old is the universe", "age of the universe", "when did the universe begin", "when was the big bang", "how old.*universe"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'Age of the universe',
  'science',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'who-is-elon-musk',
  1,
  'function execute(input) { return "Elon Musk (born 1971) is a South African-born entrepreneur and business magnate. He is the CEO of Tesla (electric vehicles), SpaceX (space exploration), and owner of X (formerly Twitter). He also co-founded PayPal, Neuralink (brain-computer interfaces), and The Boring Company (tunnel construction). He is one of the wealthiest people in the world."; }',
  '["who is elon musk", "tell me about elon musk", "elon musk.*who", "what does elon musk do"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'Who is Elon Musk',
  'general',
  0
);

-- ═══════════════════════════════════════════════════
-- ANIMALS & NATURE (12)
-- ═══════════════════════════════════════════════════

INSERT INTO procedural_shards (id, name, version, logic, patterns, knowledge_type, visibility, lifecycle, confidence, synthesis_method, synthesis_confidence, description, category, estimated_tokens)
VALUES
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'fastest-animal',
  1,
  'function execute(input) { return "The peregrine falcon is the fastest animal on Earth, reaching speeds over 240 mph (386 km/h) during its hunting dive (stoop). On land, the cheetah is the fastest, reaching 70 mph (112 km/h) in short bursts. In water, the black marlin can reach 80 mph (129 km/h)."; }',
  '["fastest animal", "what is the fastest animal", "fastest creature", "fastest bird", "fastest land animal"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'Fastest animal on Earth',
  'animals',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'largest-animal',
  1,
  'function execute(input) { return "The blue whale is the largest animal ever known to have existed on Earth. Adults can reach up to 100 feet (30 meters) long and weigh up to 200 tons (181 metric tonnes). Their heart alone is about the size of a small car, and their tongue can weigh as much as an elephant."; }',
  '["largest animal", "biggest animal", "what is the largest animal", "what is the biggest animal", "blue whale.*size"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'Largest animal on Earth',
  'animals',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'how-long-do-dogs-live',
  1,
  'function execute(input) { return "Dogs typically live 10–13 years on average, though this varies significantly by breed and size. Small breeds (like Chihuahuas) often live 14–16 years, while large breeds (like Great Danes) may only live 7–10 years. The oldest recorded dog, an Australian Cattle Dog named Bluey, lived to 29 years and 5 months."; }',
  '["how long do dogs live", "dog.*lifespan", "average.*dog.*life", "how old do dogs live", "dog life expectancy"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'Dog lifespan',
  'animals',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'how-long-do-cats-live',
  1,
  'function execute(input) { return "Indoor cats typically live 12–18 years, with some reaching their early 20s. Outdoor cats tend to have shorter lifespans of 5–10 years due to risks from traffic, predators, and disease. The oldest recorded cat, Creme Puff from Austin, Texas, lived to be 38 years and 3 days old."; }',
  '["how long do cats live", "cat.*lifespan", "average.*cat.*life", "how old do cats live", "cat life expectancy"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'Cat lifespan',
  'animals',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'tallest-animal',
  1,
  'function execute(input) { return "The giraffe is the tallest living animal. Adult males can stand up to 18 feet (5.5 meters) tall, with their necks alone measuring about 6 feet (1.8 meters). Despite having such long necks, giraffes have the same number of neck vertebrae as humans — just seven, but each one can be over 10 inches long."; }',
  '["tallest animal", "what is the tallest animal", "how tall.*giraffe", "tallest creature"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'Tallest animal',
  'animals',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'how-many-species-on-earth',
  1,
  'function execute(input) { return "Scientists estimate there are approximately 8.7 million species on Earth, though only about 1.2 million have been identified and described. Roughly 86% of land species and 91% of marine species remain undiscovered. About 15,000–18,000 new species are described each year. Insects alone may account for over 5 million species."; }',
  '["how many species", "number of species", "species on earth", "how many.*animals.*earth", "how many types of animals"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'Number of species on Earth',
  'science',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'why-is-sky-blue',
  1,
  'function execute(input) { return "The sky appears blue due to Rayleigh scattering. When sunlight enters the atmosphere, it collides with gas molecules and gets scattered in all directions. Blue light has a shorter wavelength than other visible colors, so it gets scattered much more than red or yellow light. This scattered blue light reaches your eyes from all directions, making the sky appear blue. At sunset, light travels through more atmosphere, scattering away blue light and letting red/orange through."; }',
  '["why is the sky blue", "sky.*blue.*why", "what makes the sky blue", "why.*sky.*color"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'Why the sky is blue',
  'science',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'why-do-leaves-change-color',
  1,
  'function execute(input) { return "Leaves change color in autumn because trees stop producing chlorophyll (the green pigment) as days shorten and temperatures drop. Without green chlorophyll masking them, other pigments become visible: carotenoids produce yellow and orange, while anthocyanins (produced from trapped sugars) create red and purple. The tree reabsorbs nutrients before dropping leaves to conserve energy through winter."; }',
  '["why do leaves change color", "why.*leaves.*fall", "autumn.*leaves.*color", "why.*leaves.*red", "why.*leaves.*yellow"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'Why leaves change color',
  'science',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'how-do-birds-fly',
  1,
  'function execute(input) { return "Birds fly using a combination of lift, thrust, drag, and gravity. Their wings are curved on top (airfoil shape), creating lower air pressure above and higher pressure below — generating lift. Birds flap their wings to create thrust. Hollow bones reduce weight, while strong chest muscles power flight. Some birds can also soar using thermals (rising warm air columns) to stay airborne with minimal effort."; }',
  '["how do birds fly", "why can birds fly", "how.*birds.*flight", "bird.*fly.*how"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'How birds fly',
  'science',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'biggest-dinosaur',
  1,
  'function execute(input) { return "The largest known dinosaur is Argentinosaurus, which lived about 94–97 million years ago. It measured roughly 100–130 feet (30–40 meters) long and weighed an estimated 70–100 tons. Other contenders for the title include Patagotitan (69 tons) and Dreadnoughtus (65 tons). The largest carnivorous dinosaur was Spinosaurus, at about 50 feet long."; }',
  '["biggest dinosaur", "largest dinosaur", "what was the biggest dinosaur", "what was the largest dinosaur", "heaviest dinosaur"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'Biggest dinosaur',
  'science',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'when-did-dinosaurs-go-extinct',
  1,
  'function execute(input) { return "Dinosaurs went extinct approximately 66 million years ago at the end of the Cretaceous period. The leading theory is that a massive asteroid, about 7.5 miles (12 km) wide, struck what is now the Yucatan Peninsula in Mexico, creating the Chicxulub crater. The impact caused massive fires, a \"nuclear winter\" effect from dust blocking sunlight, and acid rain, leading to the extinction of about 75% of all species on Earth."; }',
  '["when did dinosaurs go extinct", "when did dinosaurs die", "what killed the dinosaurs", "dinosaur.*extinct", "dinosaur.*asteroid"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'When dinosaurs went extinct',
  'science',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'how-do-magnets-work',
  1,
  'function execute(input) { return "Magnets work because of the alignment of electrons within their atoms. Every electron generates a tiny magnetic field as it orbits the nucleus and spins on its axis. In most materials, these fields point randomly and cancel out. In magnetic materials like iron, regions called domains align their electron spins in the same direction, creating a net magnetic field. Opposite poles (north and south) attract because their magnetic field lines connect, while like poles repel because their fields push against each other."; }',
  '["how do magnets work", "why do magnets attract", "what makes magnets magnetic", "magnet.*how.*work", "how does magnetism work"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'How magnets work',
  'science',
  0
);

-- ═══════════════════════════════════════════════════
-- HUMAN BODY & HEALTH (12)
-- ═══════════════════════════════════════════════════

INSERT INTO procedural_shards (id, name, version, logic, patterns, knowledge_type, visibility, lifecycle, confidence, synthesis_method, synthesis_confidence, description, category, estimated_tokens)
VALUES
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'normal-body-temperature',
  1,
  'function execute(input) { return "Normal human body temperature is approximately 98.6°F (37°C), though it can vary between 97°F and 99°F (36.1°C–37.2°C) throughout the day. Body temperature is typically lowest in the early morning and highest in the late afternoon. A fever is generally defined as a temperature above 100.4°F (38°C)."; }',
  '["normal body temperature", "body temperature.*normal", "what is normal.*temperature", "human.*temperature", "average body temperature"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'Normal human body temperature',
  'health',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'how-many-bones-in-body',
  1,
  'function execute(input) { return "An adult human body has 206 bones. Babies are born with about 270 bones, but many fuse together as they grow. The smallest bone is the stapes (stirrup bone) in the middle ear, measuring about 3mm. The largest bone is the femur (thighbone). More than half of the body''s bones are in the hands (54) and feet (52)."; }',
  '["how many bones.*human", "how many bones.*body", "number of bones", "bones in the.*body", "how many bones do we have"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'Number of bones in the human body',
  'health',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'how-much-water-per-day',
  1,
  'function execute(input) { return "The general recommendation is about 8 cups (64 oz / 2 liters) of water per day, often called the \"8x8 rule.\" However, the National Academies of Sciences recommends about 3.7 liters (125 oz) for men and 2.7 liters (91 oz) for women from all beverages and food combined. Actual needs vary based on activity level, climate, body size, and overall health."; }',
  '["how much water.*drink", "how much water.*per day", "daily water intake", "how many.*water.*day", "recommended water.*day"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'Daily water intake recommendation',
  'health',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'how-many-muscles-in-body',
  1,
  'function execute(input) { return "The human body has approximately 600 skeletal muscles. There are three types of muscle: skeletal (voluntary, attached to bones), smooth (involuntary, in organs), and cardiac (heart). The largest muscle is the gluteus maximus. The smallest is the stapedius in the middle ear. Muscles make up about 40% of total body weight."; }',
  '["how many muscles.*body", "how many muscles.*human", "number of muscles", "muscles in the body"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'Number of muscles in the body',
  'health',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'how-much-blood-in-body',
  1,
  'function execute(input) { return "The average adult has about 1.2–1.5 gallons (4.5–5.7 liters) of blood in their body, roughly 7% of body weight. Blood is made up of red blood cells (carry oxygen), white blood cells (fight infection), platelets (clotting), and plasma (the liquid portion). Your heart pumps this entire volume through your body about once every minute."; }',
  '["how much blood.*body", "how much blood.*human", "amount of blood", "liters of blood", "gallons of blood"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'Amount of blood in the human body',
  'health',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'how-many-cells-in-body',
  1,
  'function execute(input) { return "The human body contains approximately 37.2 trillion cells. Red blood cells are the most numerous at about 70%, followed by platelets. The largest human cell is the egg cell (ovum), visible to the naked eye at about 0.1mm. The smallest is the sperm cell. Cells are constantly being replaced — you produce roughly 3.8 million new cells every second."; }',
  '["how many cells.*body", "how many cells.*human", "number of cells", "cells in the body", "how many cells do we have"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'Number of cells in the body',
  'health',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'how-much-sleep-needed',
  1,
  'function execute(input) { return "Sleep recommendations by age: Newborns (0-3 months): 14-17 hours. Infants (4-11 months): 12-15 hours. Toddlers (1-2 years): 11-14 hours. Preschoolers (3-5): 10-13 hours. School-age (6-13): 9-11 hours. Teenagers (14-17): 8-10 hours. Adults (18-64): 7-9 hours. Older adults (65+): 7-8 hours. Consistently getting less than the recommended amount is linked to increased health risks."; }',
  '["how much sleep.*need", "how many hours.*sleep", "recommended.*sleep", "how much sleep.*adult", "sleep.*per night"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'Recommended sleep amounts',
  'health',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'how-fast-does-hair-grow',
  1,
  'function execute(input) { return "Human hair grows at an average rate of about 0.5 inches (1.25 cm) per month, or roughly 6 inches (15 cm) per year. Hair grows from follicles in the skin and goes through three phases: anagen (active growth, 2-7 years), catagen (transition, 2-3 weeks), and telogen (rest, 3 months before shedding). You lose about 50-100 hairs per day naturally."; }',
  '["how fast does hair grow", "hair growth rate", "how quickly.*hair grow", "how much.*hair grow.*month"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'Hair growth rate',
  'health',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'resting-heart-rate',
  1,
  'function execute(input) { return "A normal resting heart rate for adults is between 60–100 beats per minute (bpm). Well-trained athletes may have resting heart rates as low as 40 bpm. Children tend to have higher resting rates. A consistently high resting heart rate (above 100 bpm, called tachycardia) or low rate (below 60 bpm, called bradycardia) may warrant medical attention."; }',
  '["normal heart rate", "resting heart rate", "average heart rate", "heart.*beats per minute", "how fast.*heart beat"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'Normal resting heart rate',
  'health',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'normal-blood-pressure',
  1,
  'function execute(input) { return "Normal blood pressure for adults is around 120/80 mmHg. The top number (systolic) measures pressure when the heart beats; the bottom (diastolic) measures pressure between beats. Categories: Normal: below 120/80. Elevated: 120-129/below 80. High (Stage 1): 130-139/80-89. High (Stage 2): 140+/90+. Crisis: above 180/120. Regular monitoring is recommended."; }',
  '["normal blood pressure", "blood pressure.*normal", "what is normal blood pressure", "healthy blood pressure", "blood pressure range"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'Normal blood pressure',
  'health',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'how-many-calories-per-day',
  1,
  'function execute(input) { return "General daily calorie recommendations: Adult women: 1,600–2,400 calories. Adult men: 2,000–3,000 calories. The exact amount depends on age, activity level, height, weight, and metabolism. Sedentary individuals need fewer calories; active people need more. These are general guidelines — individual needs vary. To lose weight, you typically need a deficit of about 500 calories/day to lose 1 pound per week."; }',
  '["how many calories.*day", "daily calorie.*intake", "calories.*per day", "recommended.*calories", "how many calories.*need"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'Daily calorie intake',
  'health',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'bmi-calculator',
  1,
  'function execute(input) {
    var m = input.match(/(\d+(?:\.\d+)?)\s*(?:lbs?|pounds?)\s+(\d+)[\''"]?\s*(\d+)?[\''"]?/i);
    if (m) {
      var lbs = parseFloat(m[1]);
      var feet = parseInt(m[2]);
      var inches = m[3] ? parseInt(m[3]) : 0;
      var totalInches = feet * 12 + inches;
      var bmi = (lbs * 703) / (totalInches * totalInches);
      var cat = bmi < 18.5 ? "underweight" : bmi < 25 ? "normal weight" : bmi < 30 ? "overweight" : "obese";
      return "BMI: " + bmi.toFixed(1) + " (" + cat + "). BMI categories: <18.5 underweight, 18.5-24.9 normal, 25-29.9 overweight, 30+ obese.";
    }
    m = input.match(/(\d+(?:\.\d+)?)\s*(?:kg|kilograms?)\s+(\d+(?:\.\d+)?)\s*(?:cm|m|meters?)/i);
    if (m) {
      var kg = parseFloat(m[1]);
      var height = parseFloat(m[2]);
      if (height > 3) height = height / 100;
      var bmi = kg / (height * height);
      var cat = bmi < 18.5 ? "underweight" : bmi < 25 ? "normal weight" : bmi < 30 ? "overweight" : "obese";
      return "BMI: " + bmi.toFixed(1) + " (" + cat + "). BMI categories: <18.5 underweight, 18.5-24.9 normal, 25-29.9 overweight, 30+ obese.";
    }
    return "To calculate BMI, provide weight and height. Example: ''BMI for 150 lbs 5''8'' or ''BMI for 70 kg 175 cm''";
  }',
  '["bmi.*calculator", "calculate.*bmi", "what is my bmi", "bmi for", "body mass index"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'BMI calculator',
  'health',
  0
);

-- ═══════════════════════════════════════════════════
-- CHEMISTRY & PHYSICS (10)
-- ═══════════════════════════════════════════════════

INSERT INTO procedural_shards (id, name, version, logic, patterns, knowledge_type, visibility, lifecycle, confidence, synthesis_method, synthesis_confidence, description, category, estimated_tokens)
VALUES
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'water-chemical-formula',
  1,
  'function execute(input) { return "The chemical formula for water is H2O — two hydrogen atoms bonded to one oxygen atom. Water is a polar molecule, meaning it has a slight positive charge on the hydrogen side and a slight negative charge on the oxygen side. This polarity makes water an excellent solvent, earning it the nickname \"the universal solvent.\" Water covers about 71% of Earth''s surface."; }',
  '["chemical formula.*water", "formula.*water", "what is h2o", "h2o.*formula", "water.*formula"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'Chemical formula of water',
  'chemistry',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'periodic-table-elements',
  1,
  'function execute(input) { return "The periodic table contains 118 confirmed elements. Key groups include: Hydrogen (H, 1), Helium (He, 2), Carbon (C, 6), Nitrogen (N, 7), Oxygen (O, 8), Iron (Fe, 26), Gold (Au, 79), Silver (Ag, 47), Uranium (U, 92). Elements are organized by atomic number (protons) and grouped by similar chemical properties. The most recent additions (2016): Nihonium (113), Moscovium (115), Tennessine (117), Oganesson (118)."; }',
  '["how many elements.*periodic table", "periodic table.*elements", "number of elements", "elements.*chemistry", "how many chemical elements"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'Periodic table element count',
  'chemistry',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'what-is-e-mc-squared',
  1,
  'function execute(input) { return "E=mc² is Einstein''s mass-energy equivalence equation, published in 1905. E is energy, m is mass, and c is the speed of light (approximately 300 million meters per second). It means that mass can be converted into an enormous amount of energy — even a small amount of mass contains tremendous energy because c² is such a huge number (~9×10¹⁶). This principle underlies nuclear energy and nuclear weapons."; }',
  '["what is e ?= ?mc", "e equals mc squared", "einstein.*equation", "mass.energy equivalence", "what does e=mc2 mean"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'E=mc² explanation',
  'physics',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'newtons-laws-of-motion',
  1,
  'function execute(input) { return "Newton''s Three Laws of Motion:\n\n1. **Law of Inertia**: An object at rest stays at rest, and an object in motion stays in motion at constant velocity, unless acted upon by an external force.\n\n2. **F = ma**: Force equals mass times acceleration. The greater the mass, the more force needed to accelerate it.\n\n3. **Action-Reaction**: For every action, there is an equal and opposite reaction. When you push against a wall, the wall pushes back with equal force.\n\nPublished in 1687 in Principia Mathematica."; }',
  '["newton.s laws", "laws of motion", "newton.s three laws", "what are newton.s laws", "first law of motion", "second law of motion", "third law of motion"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'Newton''s laws of motion',
  'physics',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'what-is-an-atom',
  1,
  'function execute(input) { return "An atom is the basic building block of all matter. It consists of a dense nucleus (containing positively charged protons and neutral neutrons) surrounded by a cloud of negatively charged electrons. Atoms are incredibly small — about 1-5 angstroms (0.1-0.5 nanometers) in diameter. The number of protons determines which element an atom is (e.g., 1 proton = hydrogen, 6 = carbon, 79 = gold)."; }',
  '["what is an atom", "explain atoms", "atom.*made of", "structure of an atom", "what are atoms"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'What is an atom',
  'chemistry',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'states-of-matter',
  1,
  'function execute(input) { return "There are four common states of matter:\n\n1. **Solid**: Fixed shape and volume. Molecules are tightly packed (e.g., ice, rock).\n2. **Liquid**: Fixed volume but takes shape of container. Molecules flow freely (e.g., water, oil).\n3. **Gas**: No fixed shape or volume. Molecules spread to fill space (e.g., air, steam).\n4. **Plasma**: Superheated gas with ionized particles. Found in stars, lightning, neon signs.\n\nThere are also exotic states like Bose-Einstein condensates (near absolute zero) and fermionic condensates."; }',
  '["states of matter", "how many states of matter", "what are the states of matter", "solid liquid gas", "phases of matter"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'States of matter',
  'chemistry',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'what-is-a-black-hole',
  1,
  'function execute(input) { return "A black hole is a region of spacetime where gravity is so strong that nothing — not even light — can escape once it crosses the boundary called the event horizon. They form when massive stars (at least 20-25 times the mass of our Sun) collapse at the end of their lives. Supermassive black holes (millions to billions of solar masses) exist at the centers of most galaxies, including our Milky Way (Sagittarius A*, about 4 million solar masses)."; }',
  '["what is a black hole", "how.*black hole.*form", "black hole.*explained", "explain black holes", "how do black holes work"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'What is a black hole',
  'physics',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'distance-light-year',
  1,
  'function execute(input) { return "A light-year is the distance light travels in one year in a vacuum — approximately 5.88 trillion miles (9.46 trillion kilometers). The nearest star to our Sun, Proxima Centauri, is about 4.24 light-years away. The Milky Way galaxy is about 100,000 light-years across. The observable universe has a radius of about 46.5 billion light-years."; }',
  '["what is a light.year", "how far is a light.year", "light year.*distance", "how long is a light.year", "distance.*light.year"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'What is a light-year',
  'physics',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'what-is-electricity',
  1,
  'function execute(input) { return "Electricity is the flow of electric charge, typically carried by electrons through a conductor like copper wire. Key concepts: Voltage (V) is the \"pressure\" pushing electrons (measured in volts). Current (I) is the rate of electron flow (measured in amps). Resistance (R) opposes the flow (measured in ohms). Ohm''s Law ties them together: V = I × R. Power = Voltage × Current, measured in watts."; }',
  '["what is electricity", "how does electricity work", "explain electricity", "electricity.*explained", "how.*electricity.*work"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'What is electricity',
  'physics',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'what-causes-earthquakes',
  1,
  'function execute(input) { return "Earthquakes are caused by the sudden release of energy in the Earth''s crust, usually due to tectonic plate movement. The Earth''s lithosphere is divided into plates that float on the semi-fluid asthenosphere. When plates push against, pull apart, or slide past each other, stress builds up at fault lines. When the stress exceeds the friction holding the rocks together, the rocks break and shift suddenly, releasing energy as seismic waves — an earthquake."; }',
  '["what causes earthquakes", "why do earthquakes happen", "how.*earthquakes.*caused", "earthquake.*cause", "what makes earthquakes"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'What causes earthquakes',
  'science',
  0
);

-- ═══════════════════════════════════════════════════
-- PROGRAMMING & TECH (12)
-- ═══════════════════════════════════════════════════

INSERT INTO procedural_shards (id, name, version, logic, patterns, knowledge_type, visibility, lifecycle, confidence, synthesis_method, synthesis_confidence, description, category, estimated_tokens)
VALUES
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'http-status-codes',
  1,
  'function execute(input) {
    var codes = { 200: "OK - Request succeeded", 201: "Created - Resource created", 204: "No Content - Success with no body", 301: "Moved Permanently - URL changed permanently", 302: "Found - Temporary redirect", 400: "Bad Request - Invalid syntax", 401: "Unauthorized - Authentication required", 403: "Forbidden - Server refuses request", 404: "Not Found - Resource doesn''t exist", 405: "Method Not Allowed", 408: "Request Timeout", 429: "Too Many Requests - Rate limited", 500: "Internal Server Error", 502: "Bad Gateway", 503: "Service Unavailable", 504: "Gateway Timeout" };
    var m = input.match(/(\d{3})/);
    if (m && codes[parseInt(m[1])]) { return "HTTP " + m[1] + ": " + codes[parseInt(m[1])]; }
    return "Common HTTP status codes:\\n200 OK, 201 Created, 301 Redirect, 400 Bad Request, 401 Unauthorized, 403 Forbidden, 404 Not Found, 429 Rate Limited, 500 Server Error, 502 Bad Gateway, 503 Unavailable";
  }',
  '["http.*status.*code", "what is.*http.*\\d{3}", "what does.*\\d{3}.*mean", "status code.*\\d{3}", "http \\d{3}"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'HTTP status code lookup',
  'programming',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'what-is-python',
  1,
  'function execute(input) { return "Python is a high-level, interpreted programming language created by Guido van Rossum in 1991. It emphasizes code readability with its clean syntax and significant whitespace. Python is widely used for web development (Django, Flask), data science (pandas, NumPy), machine learning (TensorFlow, PyTorch), automation, and scripting. It''s consistently ranked among the most popular programming languages and is often recommended as a first language for beginners."; }',
  '["what is python.*language", "tell me about python.*programming", "python programming language", "what is python used for"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'What is Python',
  'programming',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'what-is-javascript',
  1,
  'function execute(input) { return "JavaScript is a high-level, dynamic programming language primarily used for web development. Created by Brendan Eich in 1995 (in just 10 days), it runs in every web browser and on servers via Node.js. JavaScript enables interactive web pages, handles user events, manipulates the DOM, and powers frameworks like React, Vue, and Angular. It''s the most widely used programming language in the world."; }',
  '["what is javascript", "tell me about javascript", "javascript programming", "what is js used for"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'What is JavaScript',
  'programming',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'what-is-html',
  1,
  'function execute(input) { return "HTML (HyperText Markup Language) is the standard markup language for creating web pages. It defines the structure of web content using elements (tags) like <h1> for headings, <p> for paragraphs, <a> for links, <img> for images, and <div> for sections. HTML was created by Tim Berners-Lee in 1993. Current version is HTML5, which added semantic elements, audio/video support, canvas, and more."; }',
  '["what is html", "explain html", "html.*language", "what does html stand for"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'What is HTML',
  'programming',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'what-is-css',
  1,
  'function execute(input) { return "CSS (Cascading Style Sheets) is a stylesheet language used to control the visual presentation of HTML documents. It handles layout, colors, fonts, spacing, animations, and responsive design. CSS uses selectors to target HTML elements and apply styles. Key features include Flexbox and Grid for layout, media queries for responsive design, custom properties (variables), and transitions/animations. CSS3 is the current version."; }',
  '["what is css", "explain css", "css.*style", "what does css stand for", "cascading style sheets"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'What is CSS',
  'programming',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'what-is-sql',
  1,
  'function execute(input) { return "SQL (Structured Query Language) is a standard language for managing and querying relational databases. Key commands: SELECT (read data), INSERT (add data), UPDATE (modify data), DELETE (remove data), CREATE TABLE (make tables). Popular databases using SQL: PostgreSQL, MySQL, SQLite, Microsoft SQL Server, Oracle. SQL was developed at IBM in the 1970s and standardized by ANSI in 1986."; }',
  '["what is sql", "explain sql", "sql.*database", "what does sql stand for", "structured query language"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'What is SQL',
  'programming',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'what-is-git',
  1,
  'function execute(input) { return "Git is a distributed version control system created by Linus Torvalds in 2005 (who also created Linux). It tracks changes in source code, enabling multiple developers to collaborate. Key concepts: commits (snapshots), branches (parallel development lines), merging (combining branches), and pull requests (code review). GitHub, GitLab, and Bitbucket are popular platforms for hosting Git repositories."; }',
  '["what is git", "explain git", "git.*version control", "how does git work", "what is github"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'What is Git',
  'programming',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'what-is-react',
  1,
  'function execute(input) { return "React is a JavaScript library for building user interfaces, created by Meta (Facebook) in 2013. It uses a component-based architecture where UIs are built from reusable pieces. Key features: JSX (HTML-like syntax in JavaScript), virtual DOM (efficient rendering), hooks (state and lifecycle management), and one-way data flow. React is the most popular frontend framework, used by Facebook, Instagram, Netflix, Airbnb, and many others."; }',
  '["what is react", "explain react", "react.*framework", "react.*javascript", "reactjs"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'What is React',
  'programming',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'what-is-docker',
  1,
  'function execute(input) { return "Docker is a platform for developing, shipping, and running applications in containers. Containers are lightweight, standalone packages that include everything needed to run software: code, runtime, libraries, and settings. Unlike virtual machines, containers share the host OS kernel, making them much faster and more efficient. Key concepts: Dockerfile (build instructions), images (templates), containers (running instances), Docker Compose (multi-container apps)."; }',
  '["what is docker", "explain docker", "docker.*container", "how does docker work", "what are containers"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'What is Docker',
  'programming',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'what-is-rest-api',
  1,
  'function execute(input) { return "REST (Representational State Transfer) is an architectural style for building web APIs. RESTful APIs use standard HTTP methods: GET (read), POST (create), PUT (update), PATCH (partial update), DELETE (remove). Key principles: statelessness (each request contains all needed info), resource-based URLs (/users/123), standard HTTP status codes, and JSON as the typical data format. REST APIs power most modern web and mobile applications."; }',
  '["what is rest api", "what is a rest api", "explain rest", "restful api", "rest.*architecture"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'What is a REST API',
  'programming',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'big-o-notation',
  1,
  'function execute(input) { return "Big O notation describes algorithm efficiency as input size grows:\\n\\n- O(1): Constant — array lookup\\n- O(log n): Logarithmic — binary search\\n- O(n): Linear — simple loop\\n- O(n log n): Linearithmic — merge sort, quicksort\\n- O(n²): Quadratic — nested loops, bubble sort\\n- O(2ⁿ): Exponential — recursive Fibonacci\\n- O(n!): Factorial — permutations\\n\\nLower is better. O(n log n) is generally the best achievable for comparison-based sorting."; }',
  '["big o notation", "what is big o", "time complexity", "algorithm complexity", "big o.*explained"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'Big O notation explained',
  'programming',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'difference-compiled-interpreted',
  1,
  'function execute(input) { return "Compiled languages (C, C++, Rust, Go) are translated entirely into machine code before running. They''re typically faster but need recompilation for each platform.\\n\\nInterpreted languages (Python, JavaScript, Ruby) are executed line-by-line by an interpreter at runtime. They''re more flexible and portable but generally slower.\\n\\nSome languages use both: Java compiles to bytecode, then the JVM interprets/JIT-compiles it. JavaScript engines like V8 also use JIT compilation for performance."; }',
  '["compiled vs interpreted", "difference.*compiled.*interpreted", "what is.*compiled language", "what is.*interpreted language", "compiled.*or.*interpreted"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'Compiled vs interpreted languages',
  'programming',
  0
);

-- ═══════════════════════════════════════════════════
-- GEOGRAPHY & WORLD (10)
-- ═══════════════════════════════════════════════════

INSERT INTO procedural_shards (id, name, version, logic, patterns, knowledge_type, visibility, lifecycle, confidence, synthesis_method, synthesis_confidence, description, category, estimated_tokens)
VALUES
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'world-population',
  1,
  'function execute(input) { return "The world population is approximately 8.1 billion people (as of 2024). The most populous countries are: 1. India (~1.44 billion), 2. China (~1.42 billion), 3. United States (~340 million), 4. Indonesia (~277 million), 5. Pakistan (~240 million). The global population is growing at about 0.9% per year and is projected to reach approximately 10.4 billion by 2100."; }',
  '["world population", "how many people.*world", "how many people.*earth", "population of the world", "global population"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'World population',
  'geography',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'population-of-usa',
  1,
  'function execute(input) { return "The United States has a population of approximately 340 million people (2024). It''s the third most populous country after India and China. The most populous states are California (~39 million), Texas (~30 million), and Florida (~22 million). The U.S. has 50 states, one federal district (Washington D.C.), and several territories."; }',
  '["population of.*us(?:a)?(?:\\s|$)", "how many people.*(?:us(?:a)?|united states|america)", "us(?:a)?.*population", "united states.*population", "america.*population"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'US population',
  'geography',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'how-many-countries',
  1,
  'function execute(input) { return "There are 195 countries in the world: 193 member states of the United Nations plus 2 observer states (the Holy See/Vatican City and Palestine). However, the exact count varies depending on how you define a country — there are also several territories, disputed regions, and de facto states (like Taiwan, Kosovo, Western Sahara) that are recognized by some but not all nations."; }',
  '["how many countries", "number of countries", "countries in the world", "how many nations", "total countries"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'Number of countries in the world',
  'geography',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'how-many-languages',
  1,
  'function execute(input) { return "There are approximately 7,000 languages spoken in the world today. The most spoken languages by total speakers: 1. English (~1.5 billion), 2. Mandarin Chinese (~1.1 billion), 3. Hindi (~609 million), 4. Spanish (~559 million), 5. French (~310 million). About 40% of languages are endangered, with fewer than 1,000 speakers each. Papua New Guinea has the most languages of any country (~840)."; }',
  '["how many languages", "number of languages", "languages in the world", "most spoken language", "how many languages.*world"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'Number of languages in the world',
  'geography',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'largest-ocean',
  1,
  'function execute(input) { return "The Pacific Ocean is the largest and deepest ocean, covering about 63.8 million square miles (165.25 million km²) — more than all the land area on Earth combined. The five oceans by size: 1. Pacific (165.25M km²), 2. Atlantic (106.46M km²), 3. Indian (70.56M km²), 4. Southern/Antarctic (21.96M km²), 5. Arctic (14.06M km²)."; }',
  '["largest ocean", "biggest ocean", "what is the largest ocean", "what is the biggest ocean", "pacific ocean.*size"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'Largest ocean',
  'geography',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'largest-desert',
  1,
  'function execute(input) { return "The Antarctic Desert is actually the world''s largest desert at 5.5 million square miles (14.2M km²), followed by the Arctic Desert at 5.4 million square miles. A desert is defined by low precipitation, not heat. The Sahara is the largest hot desert at 3.6 million square miles (9.2M km²), covering most of North Africa — roughly the size of the United States."; }',
  '["largest desert", "biggest desert", "what is the largest desert", "what is the biggest desert", "sahara.*size"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'Largest desert in the world',
  'geography',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'how-many-time-zones',
  1,
  'function execute(input) { return "There are 24 standard time zones in the world, each roughly 15 degrees of longitude wide. However, many countries use offsets like UTC+5:30 (India) or UTC+5:45 (Nepal), bringing the practical total to over 37 different local times. China, despite spanning 5 geographic time zones, uses a single time zone (UTC+8). Russia has the most time zones of any country with 11."; }',
  '["how many time zones", "number of time zones", "time zones in the world", "how many.*time zone"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'Number of time zones',
  'geography',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'smallest-country',
  1,
  'function execute(input) { return "Vatican City is the smallest country in the world, at just 0.17 square miles (0.44 km²) with a population of about 800 people. It''s an independent city-state surrounded by Rome, Italy, and is the headquarters of the Roman Catholic Church. The second smallest is Monaco at 0.78 square miles. The smallest by population is also Vatican City."; }',
  '["smallest country", "what is the smallest country", "tiniest country", "smallest nation"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'Smallest country',
  'geography',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'most-populated-city',
  1,
  'function execute(input) { return "The most populated city in the world is Tokyo, Japan, with a metropolitan area population of about 37 million people. Other mega-cities by metro population: Delhi (~32M), Shanghai (~29M), Beijing (~21M), Mumbai (~21M), São Paulo (~22M), Mexico City (~22M), Cairo (~21M), New York City (~20M). Over 55% of the world''s population now lives in urban areas."; }',
  '["most populated city", "biggest city.*world", "largest city.*world", "most populous city", "most populated city.*world"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'Most populated city in the world',
  'geography',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'how-many-states-in-usa',
  1,
  'function execute(input) { return "There are 50 states in the United States. The last two states admitted were Alaska and Hawaii, both in 1959. The largest state by area is Alaska (665,384 sq mi), and the smallest is Rhode Island (1,545 sq mi). The most populous state is California (~39 million) and the least populous is Wyoming (~577,000). Washington D.C. is the federal capital district but is not a state."; }',
  '["how many states.*us(?:a)?", "how many states.*america", "number of states.*us", "states in america", "us(?:a)?.*how many states"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'Number of US states',
  'geography',
  0
);

-- ═══════════════════════════════════════════════════
-- FINANCIAL & MATH (10)
-- ═══════════════════════════════════════════════════

INSERT INTO procedural_shards (id, name, version, logic, patterns, knowledge_type, visibility, lifecycle, confidence, synthesis_method, synthesis_confidence, description, category, estimated_tokens)
VALUES
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'compound-interest-calculator',
  1,
  'function execute(input) {
    var m = input.match(/\$?([\d,]+(?:\.\d+)?)\s*(?:at|@)\s*(\d+(?:\.\d+)?)%\s*(?:for|over|in)\s*(\d+)\s*year/i);
    if (!m) return "To calculate compound interest, provide: amount at rate% for N years. Example: ''compound interest on $1000 at 5% for 10 years''";
    var principal = parseFloat(m[1].replace(/,/g, ""));
    var rate = parseFloat(m[2]) / 100;
    var years = parseInt(m[3]);
    var total = principal * Math.pow(1 + rate, years);
    var interest = total - principal;
    return "$" + principal.toLocaleString() + " at " + (rate*100) + "% for " + years + " years = $" + total.toFixed(2) + " (interest earned: $" + interest.toFixed(2) + ")";
  }',
  '["compound interest", "compound interest.*calculator", "calculate compound interest", "compound.*\\$.*%.*year"]',
  'procedural',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'Compound interest calculator',
  'finance',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'celsius-to-kelvin',
  1,
  'function execute(input) {
    var m = input.match(/(-?\d+(?:\.\d+)?)\s*(?:degrees?\s+)?(?:celsius|c)\s+(?:to|in)\s+(?:kelvin|k)/i);
    if (!m) return "Provide a celsius value. Example: ''convert 100 celsius to kelvin''";
    var c = parseFloat(m[1]);
    var k = c + 273.15;
    return c + "°C = " + k.toFixed(2) + " K";
  }',
  '["celsius to kelvin", "convert.*celsius.*kelvin", "\\d+.*c.*to.*k(?:elvin)?"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'Celsius to Kelvin converter',
  'science',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'random-number-generator',
  1,
  'function execute(input) {
    var m = input.match(/(?:between|from)\s+(\d+)\s+(?:and|to)\s+(\d+)/i);
    var min = m ? parseInt(m[1]) : 1;
    var max = m ? parseInt(m[2]) : 100;
    if (min > max) { var t = min; min = max; max = t; }
    var num = Math.floor(Math.random() * (max - min + 1)) + min;
    return "Random number between " + min + " and " + max + ": " + num;
  }',
  '["random number", "generate.*random", "pick.*random.*number", "random.*between.*and"]',
  'procedural',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'Random number generator',
  'math',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'number-to-roman-numeral',
  1,
  'function execute(input) {
    var m = input.match(/(\d+)/);
    if (!m) return "Provide a number to convert. Example: ''convert 42 to roman numerals''";
    var num = parseInt(m[1]);
    if (num < 1 || num > 3999) return "Roman numerals only support 1-3999.";
    var vals = [1000,900,500,400,100,90,50,40,10,9,5,4,1];
    var syms = ["M","CM","D","CD","C","XC","L","XL","X","IX","V","IV","I"];
    var result = "";
    for (var i = 0; i < vals.length; i++) {
      while (num >= vals[i]) { result += syms[i]; num -= vals[i]; }
    }
    return parseInt(m[1]) + " in Roman numerals is " + result;
  }',
  '["roman numeral", "convert.*to.*roman", "what is.*in roman", "roman.*number"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'Number to Roman numeral converter',
  'math',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'pythagorean-theorem',
  1,
  'function execute(input) {
    var m = input.match(/(\d+(?:\.\d+)?)\s+(?:and|,)\s+(\d+(?:\.\d+)?)/);
    if (m) {
      var a = parseFloat(m[1]);
      var b = parseFloat(m[2]);
      var c = Math.sqrt(a*a + b*b);
      return "For a right triangle with sides " + a + " and " + b + ", the hypotenuse is " + c.toFixed(4) + ". (a² + b² = c²: " + a + "² + " + b + "² = " + (a*a+b*b) + ", √" + (a*a+b*b) + " = " + c.toFixed(4) + ")";
    }
    return "The Pythagorean theorem states that in a right triangle, a² + b² = c², where c is the hypotenuse. Provide two sides to calculate: ''hypotenuse of 3 and 4''";
  }',
  '["pythagorean theorem", "hypotenuse.*\\d+.*\\d+", "a squared.*b squared", "pythagorean.*calculate"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'Pythagorean theorem calculator',
  'math',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'average-calculator',
  1,
  'function execute(input) {
    var m = input.match(/(?:average|mean)\s+(?:of\s+)?(.+)/i);
    if (!m) return "Provide numbers to average. Example: ''average of 10, 20, 30''";
    var nums = m[1].match(/-?\d+\.?\d*/g);
    if (!nums || nums.length === 0) return "No numbers found";
    var values = nums.map(Number);
    var sum = values.reduce(function(a,b){return a+b;}, 0);
    var avg = sum / values.length;
    return "The average of [" + values.join(", ") + "] is " + (avg % 1 === 0 ? avg : avg.toFixed(2)) + ".";
  }',
  '["(?:calculate|compute|find|what is) (?:the )?(?:average|mean) (?:of )?", "average of \\d", "mean of \\d"]',
  'procedural',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'Average/mean calculator',
  'math',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'exponent-calculator',
  1,
  'function execute(input) {
    var m = input.match(/(\d+(?:\.\d+)?)\s*(?:\\^|\*\*|raised to|to the)\s*(\d+(?:\.\d+)?)/i);
    if (!m) { m = input.match(/(\d+(?:\.\d+)?)\s+(?:squared|cubed)/i); }
    if (!m) return "Provide a base and exponent. Example: ''2^10'' or ''5 squared''";
    var base = parseFloat(m[1]);
    var exp = input.includes("squared") ? 2 : input.includes("cubed") ? 3 : parseFloat(m[2]);
    var result = Math.pow(base, exp);
    return base + "^" + exp + " = " + result;
  }',
  '["\\d+\\s*squared", "\\d+\\s*cubed", "\\d+\\s*\\^\\s*\\d+", "\\d+\\s*\\*\\*\\s*\\d+", "\\d+\\s+raised to\\s+\\d+"]',
  'procedural',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'Exponent/power calculator',
  'math',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'temperature-converter',
  1,
  'function execute(input) {
    var m = input.match(/(-?\d+(?:\.\d+)?)\s*°?\s*(f(?:ahrenheit)?|c(?:elsius)?|k(?:elvin)?)/i);
    if (!m) return "Provide a temperature with unit. Example: ''convert 72°F'' or ''what is 100C in F''";
    var val = parseFloat(m[1]);
    var unit = m[2].toLowerCase().charAt(0);
    if (unit === "f") {
      var c = (val - 32) * 5/9;
      var k = c + 273.15;
      return val + "°F = " + c.toFixed(1) + "°C = " + k.toFixed(1) + " K";
    } else if (unit === "c") {
      var f = val * 9/5 + 32;
      var k = val + 273.15;
      return val + "°C = " + f.toFixed(1) + "°F = " + k.toFixed(1) + " K";
    } else if (unit === "k") {
      var c = val - 273.15;
      var f = c * 9/5 + 32;
      return val + " K = " + c.toFixed(1) + "°C = " + f.toFixed(1) + "°F";
    }
    return "Unrecognized unit";
  }',
  '["convert.*(?:°|degrees?).*(?:to|in)", "(?:what is |convert )-?\\d+.*(?:fahrenheit|celsius|kelvin|°f|°c)", "temperature.*convert"]',
  'procedural',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'Universal temperature converter',
  'science',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'word-count-in-text',
  1,
  'function execute(input) {
    var m = input.match(/(?:count|how many)\s+words?\s+(?:in|are in)\s+["\u0027]([^"\u0027]+)["\u0027]/i);
    if (m) {
      var words = m[1].trim().split(/\\s+/).filter(function(w){return w.length > 0;});
      return "\"" + m[1] + "\" contains " + words.length + " words.";
    }
    m = input.match(/(?:count|how many)\s+words?\s+(?:in|are in)\s+(.+)/i);
    if (m) {
      var text = m[1].trim().replace(/^["\u0027]|["\u0027]$/g, "");
      var words = text.split(/\\s+/).filter(function(w){return w.length > 0;});
      return "\"" + text + "\" contains " + words.length + " words.";
    }
    return "Provide text to count words. Example: ''count words in \\\"hello world\\\"''";
  }',
  '["count.*words?.*in", "how many words", "word count.*in"]',
  'procedural',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'Word count in text',
  'utility',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'coin-flip',
  1,
  'function execute(input) {
    var result = Math.random() < 0.5 ? "Heads" : "Tails";
    return "Coin flip result: " + result + "!";
  }',
  '["flip a coin", "coin flip", "heads or tails", "toss a coin", "flip.*coin"]',
  'procedural',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'Coin flip simulator',
  'fun',
  0
);

-- ═══════════════════════════════════════════════════
-- COMMON QUESTIONS & TRIVIA (19)
-- ═══════════════════════════════════════════════════

INSERT INTO procedural_shards (id, name, version, logic, patterns, knowledge_type, visibility, lifecycle, confidence, synthesis_method, synthesis_confidence, description, category, estimated_tokens)
VALUES
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'how-does-wifi-work',
  1,
  'function execute(input) { return "Wi-Fi uses radio waves to transmit data between a router and your devices. The router converts internet data from your modem into radio signals at 2.4 GHz or 5 GHz frequencies. Your device''s wireless adapter receives these signals and converts them back to data. Wi-Fi follows IEEE 802.11 standards — the latest is Wi-Fi 7 (802.11be). Range is typically 150-300 feet indoors, affected by walls and interference."; }',
  '["how does wifi work", "how does wi-fi work", "what is wifi", "how.*wifi.*work", "explain wifi"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'How WiFi works',
  'tech',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'how-does-gps-work',
  1,
  'function execute(input) { return "GPS (Global Positioning System) uses a constellation of at least 24 satellites orbiting Earth at about 12,550 miles altitude. Your GPS receiver picks up signals from at least 4 satellites simultaneously, each broadcasting its position and the exact time. By measuring how long each signal takes to arrive (traveling at the speed of light), the receiver calculates its distance from each satellite and uses trilateration to determine your exact position — accurate to within about 3-5 meters."; }',
  '["how does gps work", "what is gps", "how.*gps.*work", "explain gps", "global positioning system"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'How GPS works',
  'tech',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'what-is-cryptocurrency',
  1,
  'function execute(input) { return "Cryptocurrency is a digital or virtual currency secured by cryptography, making it nearly impossible to counterfeit. Most operate on decentralized blockchain networks. Bitcoin, created in 2009 by the pseudonymous Satoshi Nakamoto, was the first cryptocurrency. Other major cryptocurrencies include Ethereum (smart contracts), Solana, and XRP. Cryptocurrencies enable peer-to-peer transactions without intermediaries like banks, though they''re known for price volatility."; }',
  '["what is cryptocurrency", "what is crypto", "explain cryptocurrency", "how does crypto work", "what is bitcoin"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'What is cryptocurrency',
  'finance',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'what-is-quantum-computing',
  1,
  'function execute(input) { return "Quantum computing uses quantum mechanics to process information fundamentally differently from classical computers. Instead of bits (0 or 1), quantum computers use qubits that can exist in superposition (both 0 and 1 simultaneously). Combined with entanglement (linked qubits that affect each other instantly) and interference, this allows quantum computers to explore many solutions in parallel. They excel at specific problems like cryptography, drug discovery, and optimization, but aren''t faster for everyday tasks."; }',
  '["what is quantum computing", "explain quantum comput", "how.*quantum comput.*work", "quantum computer.*explained"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'What is quantum computing',
  'tech',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'what-is-climate-change',
  1,
  'function execute(input) { return "Climate change refers to long-term shifts in global temperatures and weather patterns. While natural factors exist, since the 1800s, human activities — primarily burning fossil fuels (coal, oil, gas) — have been the main driver. This releases greenhouse gases (CO₂, methane) that trap heat in the atmosphere. Effects include rising sea levels, more extreme weather events, melting ice caps, ocean acidification, and ecosystem disruption. Global average temperature has risen about 1.1°C since pre-industrial times."; }',
  '["what is climate change", "explain climate change", "global warming", "what causes climate change", "climate change.*explained"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'What is climate change',
  'science',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'how-does-evolution-work',
  1,
  'function execute(input) { return "Evolution is the process by which species change over time through natural selection, first described by Charles Darwin in 1859. The mechanism: 1) Individuals in a population vary genetically. 2) Some variations improve survival and reproduction. 3) These advantageous traits are passed to offspring more frequently. 4) Over many generations, the population shifts toward those traits. Evolution doesn''t have a goal or direction — it''s the result of environmental pressures acting on random genetic variation."; }',
  '["how does evolution work", "what is evolution", "explain evolution", "theory of evolution", "natural selection"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'How evolution works',
  'science',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'how-do-vaccines-work',
  1,
  'function execute(input) { return "Vaccines work by training your immune system to recognize and fight specific pathogens without causing the disease. They contain weakened, inactivated, or fragment versions of a virus/bacteria (or instructions to make a fragment, like mRNA vaccines). Your immune system responds by producing antibodies and memory cells. If you later encounter the real pathogen, your immune system recognizes it and responds quickly. This is why vaccines prevent or reduce severity of disease."; }',
  '["how do vaccines work", "what is a vaccine", "how.*vaccine.*work", "explain vaccines", "vaccine.*explained"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'How vaccines work',
  'science',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'what-is-the-cloud',
  1,
  'function execute(input) { return "\"The cloud\" refers to servers accessed over the internet, rather than local hardware. Cloud computing provides on-demand resources — storage, processing power, applications — hosted in massive data centers run by companies like AWS (Amazon), Azure (Microsoft), and Google Cloud. Benefits: no hardware to maintain, scales up/down easily, pay-for-what-you-use, accessible from anywhere. Services range from file storage (Dropbox, Google Drive) to full infrastructure for running applications."; }',
  '["what is the cloud", "cloud computing", "explain.*cloud computing", "how does the cloud work", "what is cloud"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'What is cloud computing',
  'tech',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'what-is-vpn',
  1,
  'function execute(input) { return "A VPN (Virtual Private Network) creates an encrypted tunnel between your device and a remote server. All your internet traffic passes through this tunnel, hiding your activity from your ISP, public Wi-Fi snoopers, and websites (which see the VPN server''s IP address instead of yours). VPNs are used for privacy, security on public networks, bypassing geographic restrictions, and remote access to corporate networks. Popular VPN services include NordVPN, ExpressVPN, and Mullvad."; }',
  '["what is a vpn", "what is vpn", "how does.*vpn work", "explain vpn", "virtual private network"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'What is a VPN',
  'tech',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'what-is-renewable-energy',
  1,
  'function execute(input) { return "Renewable energy comes from naturally replenishing sources: Solar (photovoltaic cells convert sunlight to electricity), Wind (turbines convert wind kinetic energy), Hydroelectric (flowing water drives turbines), Geothermal (Earth''s internal heat), and Biomass (organic matter). Renewables accounted for about 30% of global electricity generation in 2023. Solar and wind are the fastest-growing energy sources, with costs dropping dramatically — solar costs fell ~90% since 2010."; }',
  '["what is renewable energy", "types of renewable energy", "renewable energy.*explained", "clean energy", "green energy"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'What is renewable energy',
  'science',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'dice-roller',
  1,
  'function execute(input) {
    var m = input.match(/(\d+)?d(\d+)/i);
    if (!m) { m = input.match(/roll\s+(?:a\s+)?(\d+)?.*?(\d+).*?(?:sided|side)/i); }
    var count = m && m[1] ? parseInt(m[1]) : 1;
    var sides = m && m[2] ? parseInt(m[2]) : 6;
    if (count > 100) count = 100;
    if (sides > 1000) sides = 1000;
    var results = [];
    var total = 0;
    for (var i = 0; i < count; i++) {
      var roll = Math.floor(Math.random() * sides) + 1;
      results.push(roll);
      total += roll;
    }
    if (count === 1) return "Rolled a d" + sides + ": " + results[0];
    return "Rolled " + count + "d" + sides + ": [" + results.join(", ") + "] Total: " + total;
  }',
  '["roll.*di(?:ce|e)", "roll.*d\\d+", "\\d+d\\d+", "throw.*di(?:ce|e)", "dice roll"]',
  'procedural',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'Dice roller',
  'fun',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'rock-paper-scissors',
  1,
  'function execute(input) {
    var choices = ["rock", "paper", "scissors"];
    var userChoice = input.toLowerCase().match(/rock|paper|scissors/);
    var aiChoice = choices[Math.floor(Math.random() * 3)];
    if (!userChoice) return "Choose rock, paper, or scissors! Example: ''play rock paper scissors: rock''";
    userChoice = userChoice[0];
    if (userChoice === aiChoice) return "You chose " + userChoice + ", I chose " + aiChoice + ". It''s a tie!";
    var wins = { rock: "scissors", paper: "rock", scissors: "paper" };
    if (wins[userChoice] === aiChoice) return "You chose " + userChoice + ", I chose " + aiChoice + ". You win!";
    return "You chose " + userChoice + ", I chose " + aiChoice + ". I win!";
  }',
  '["rock paper scissors", "play rock paper", "rps.*(?:rock|paper|scissors)", "(?:rock|paper|scissors).*(?:rock|paper|scissors)"]',
  'procedural',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'Rock paper scissors game',
  'fun',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'magic-8-ball',
  1,
  'function execute(input) {
    var answers = ["It is certain.", "Without a doubt.", "Yes, definitely.", "You may rely on it.", "As I see it, yes.", "Most likely.", "Outlook good.", "Yes.", "Signs point to yes.", "Reply hazy, try again.", "Ask again later.", "Better not tell you now.", "Cannot predict now.", "Concentrate and ask again.", "Don''t count on it.", "My reply is no.", "My sources say no.", "Outlook not so good.", "Very doubtful."];
    return "🎱 " + answers[Math.floor(Math.random() * answers.length)];
  }',
  '["magic 8.?ball", "8.?ball", "shake.*8.?ball", "ask.*8.?ball", "fortune.*ball"]',
  'procedural',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'Magic 8-ball',
  'fun',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'what-is-the-golden-hour',
  1,
  'function execute(input) { return "The golden hour in photography is the period shortly after sunrise or before sunset when daylight is softer, warmer, and more diffused. The sun''s low angle creates long shadows and a golden-red tone that''s especially flattering for portraits and landscapes. It typically lasts about 20-60 minutes. The \"blue hour\" occurs just before sunrise or after sunset, producing a cooler, blue-toned light."; }',
  '["what is.*golden hour", "golden hour.*photography", "best time.*photograph", "golden hour.*explained"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'Golden hour in photography',
  'general',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'how-much-does-earth-weigh',
  1,
  'function execute(input) { return "Earth''s mass is approximately 5.972 × 10²⁴ kilograms (about 13.17 × 10²⁴ pounds, or roughly 6 sextillion metric tons). Technically, Earth doesn''t \"weigh\" anything since weight requires gravity acting on an object, but its mass is constant. Earth gains about 40,000 tonnes of dust from space annually but loses hydrogen and helium from the upper atmosphere."; }',
  '["how much does.*earth weigh", "weight of.*earth", "mass of.*earth", "how heavy is.*earth", "earth.*weight"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'Weight/mass of Earth',
  'science',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'how-far-is-mars',
  1,
  'function execute(input) { return "The distance from Earth to Mars varies dramatically as both planets orbit the Sun. At closest approach (opposition): about 33.9 million miles (54.6 million km). At farthest (conjunction): about 250 million miles (401 million km). Average distance: roughly 140 million miles (225 million km). A spacecraft typically takes 7-9 months to reach Mars. Light takes 3-22 minutes to travel between the two planets depending on their positions."; }',
  '["how far is mars", "distance to mars", "how far.*earth.*mars", "mars.*distance", "how long.*get to mars"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'Distance to Mars',
  'science',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'what-is-the-fibonacci-sequence',
  1,
  'function execute(input) { return "The Fibonacci sequence is a series of numbers where each number is the sum of the two preceding ones: 0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377... It was introduced to Western mathematics by Leonardo Fibonacci in 1202. The ratio between consecutive Fibonacci numbers approaches the golden ratio (1.618...) as the numbers get larger. Fibonacci patterns appear throughout nature: flower petals, pinecone spirals, shell shapes, and branching patterns."; }',
  '["what is.*fibonacci", "fibonacci sequence", "fibonacci numbers", "explain fibonacci", "fibonacci.*explained"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'Fibonacci sequence explained',
  'math',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'how-many-stars-in-universe',
  1,
  'function execute(input) { return "There are an estimated 200 billion to 2 trillion galaxies in the observable universe, each containing hundreds of billions of stars. A rough estimate puts the total number of stars at around 10²⁴ (1 septillion) — that''s about 200 sextillion, or 200,000,000,000,000,000,000,000. Our Milky Way alone contains 100-400 billion stars. There are more stars in the universe than grains of sand on all of Earth''s beaches."; }',
  '["how many stars", "number of stars", "stars in the universe", "how many stars.*universe", "stars in the sky"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'Number of stars in the universe',
  'science',
  0
),
(
  'shd_w2_' || substr(md5(random()::text), 1, 20),
  'why-do-we-dream',
  1,
  'function execute(input) { return "The exact purpose of dreams is still debated in science, but leading theories include: 1) Memory consolidation — dreams help process and store information from the day. 2) Emotional regulation — dreams help us work through difficult emotions. 3) Threat simulation — dreams may prepare us for real-world challenges. 4) Brain housekeeping — clearing neural waste during sleep. Most vivid dreams occur during REM (Rapid Eye Movement) sleep. You typically dream 3-6 times per night but forget most dreams within minutes of waking."; }',
  '["why do we dream", "what causes dreams", "purpose of dreams", "why.*people dream", "what are dreams"]',
  'immutable',
  'public',
  'promoted',
  0.95,
  'manual',
  0.95,
  'Why we dream',
  'science',
  0
);

-- ═══════════════════════════════════════════════════
-- VERIFICATION
-- ═══════════════════════════════════════════════════

SELECT lifecycle, COUNT(*) as count FROM procedural_shards GROUP BY lifecycle ORDER BY lifecycle;
