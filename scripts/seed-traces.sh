#!/bin/bash
# SUBSTRATE Procedural Memory Seeding Script
# Exhaustive trace seeding across multiple domains

API="http://localhost:3000/api/v1/traces"
COUNT=0

seed() {
  curl -s "$API" -X POST -H "Content-Type: application/json" -d "{\"input\":\"$1\",\"output\":\"$2\",\"tokensUsed\":${3:-30}}" > /dev/null
  ((COUNT++))
  if ((COUNT % 50 == 0)); then
    echo "Seeded $COUNT traces..."
  fi
}

echo "=== SUBSTRATE Procedural Memory Mass Seeding ==="
echo "Starting at $(date)"
echo ""

# ===========================================
# DOMAIN 1: MATH & ARITHMETIC
# ===========================================
echo "[1/20] Math & Arithmetic..."

# Factorial
seed "Calculate factorial of 6" "720"
seed "Calculate factorial of 8" "40320"
seed "Calculate factorial of 12" "479001600"
seed "Factorial of 4" "24"
seed "What is 9 factorial" "362880"

# Fibonacci
seed "Fibonacci number at position 10" "55"
seed "Fibonacci number at position 15" "610"
seed "Get fibonacci of 20" "6765"
seed "Fibonacci sequence first 8 terms" "[0,1,1,2,3,5,8,13]"
seed "Generate fibonacci up to 100" "[0,1,1,2,3,5,8,13,21,34,55,89]"

# Prime
seed "Is 29 prime" "true"
seed "Is 51 prime" "false"
seed "Check if 97 is prime" "true"
seed "Is 100 a prime number" "false"
seed "Prime check: 2" "true"
seed "Is 1 prime" "false"

# GCD/LCM
seed "GCD of 56 and 98" "14"
seed "Find GCD of 81 and 27" "27"
seed "Greatest common divisor of 120 and 45" "15"
seed "LCM of 12 and 18" "36"
seed "Least common multiple of 7 and 5" "35"
seed "LCM of 15 and 20" "60"

# Powers and roots
seed "Calculate 3^5" "243"
seed "What is 2^16" "65536"
seed "Power of 5 to 4" "625"
seed "Square root of 256" "16"
seed "Cube root of 27" "3"
seed "Square root of 2" "1.414"
seed "4th root of 81" "3"

# Basic arithmetic
seed "Sum of 1 to 100" "5050"
seed "Sum of first 50 natural numbers" "1275"
seed "Product of 1 to 5" "120"
seed "Average of 10, 20, 30, 40, 50" "30"
seed "Median of [1,3,5,7,9]" "5"
seed "Mode of [1,2,2,3,3,3,4]" "3"

# ===========================================
# DOMAIN 2: STRING MANIPULATION
# ===========================================
echo "[2/20] String Manipulation..."

# Reverse
seed "Reverse string: hello" "olleh"
seed "Reverse: programming" "gnimmargorp"
seed "Reverse text: OpenAI" "IAnepO"
seed "Reverse: 12345" "54321"

# Case conversion
seed "Uppercase: hello world" "HELLO WORLD"
seed "Lowercase: HELLO WORLD" "hello world"
seed "Title case: the quick brown fox" "The Quick Brown Fox"
seed "Capitalize: javascript" "Javascript"
seed "Sentence case: hELLO wORLD" "Hello world"

# Camel/Snake/Kebab case
seed "Convert to camelCase: hello_world" "helloWorld"
seed "Convert to snake_case: helloWorld" "hello_world"
seed "Convert to kebab-case: helloWorld" "hello-world"
seed "camelCase: user_first_name" "userFirstName"
seed "snake_case: getUserData" "get_user_data"
seed "PascalCase: get_user_data" "GetUserData"

# Padding
seed "Pad left: 42 to 5 digits with 0" "00042"
seed "Pad right: hello to 10 chars with ." "hello....."
seed "Zero pad: 7 to 3 digits" "007"
seed "Left pad: 123 to 6 with spaces" "   123"

# Truncate
seed "Truncate to 10 chars: Hello World!" "Hello W..."
seed "Truncate: This is a very long string to 15" "This is a ve..."

# Count
seed "Count vowels in: programming" "3"
seed "Count consonants in: hello" "3"
seed "Count words in: The quick brown fox" "4"
seed "Character count: hello world" "11"
seed "Count spaces in: a b c d e" "4"

# Extract
seed "First 5 characters of: JavaScript" "JavaS"
seed "Last 3 characters of: programming" "ing"
seed "Extract substring 2-5 from: abcdefgh" "cdef"

# ===========================================
# DOMAIN 3: ARRAY OPERATIONS
# ===========================================
echo "[3/20] Array Operations..."

# Sort
seed "Sort ascending: [5,2,8,1,9]" "[1,2,5,8,9]"
seed "Sort descending: [5,2,8,1,9]" "[9,8,5,2,1]"
seed "Sort alphabetically: [banana,apple,cherry]" "[apple,banana,cherry]"
seed "Sort numbers: [100,23,45,67,12]" "[12,23,45,67,100]"

# Filter
seed "Filter even numbers: [1,2,3,4,5,6,7,8,9,10]" "[2,4,6,8,10]"
seed "Filter odd numbers: [1,2,3,4,5,6,7,8]" "[1,3,5,7]"
seed "Filter positive: [-5,-2,0,3,7]" "[3,7]"
seed "Filter greater than 5: [1,3,5,7,9,11]" "[7,9,11]"

# Unique
seed "Remove duplicates: [1,2,2,3,3,3,4]" "[1,2,3,4]"
seed "Unique values: [a,b,a,c,b,d]" "[a,b,c,d]"
seed "Deduplicate: [1,1,1,2,2,3]" "[1,2,3]"

# Flatten
seed "Flatten: [[1,2],[3,4],[5,6]]" "[1,2,3,4,5,6]"
seed "Flatten nested: [[1,[2,3]],[4,5]]" "[1,2,3,4,5]"

# Chunk
seed "Chunk [1,2,3,4,5,6] by 2" "[[1,2],[3,4],[5,6]]"
seed "Split [1,2,3,4,5,6,7,8,9] into groups of 3" "[[1,2,3],[4,5,6],[7,8,9]]"

# Zip
seed "Zip [1,2,3] and [a,b,c]" "[[1,a],[2,b],[3,c]]"

# Range
seed "Range from 1 to 5" "[1,2,3,4,5]"
seed "Range 0 to 10 step 2" "[0,2,4,6,8,10]"

# Min/Max
seed "Min of [45,23,78,12,90]" "12"
seed "Max of [45,23,78,12,90]" "90"
seed "Find minimum: [100,200,50,300]" "50"
seed "Find maximum: [-5,-2,-10,-1]" "-1"

# Sum/Product
seed "Sum of [10,20,30,40,50]" "150"
seed "Product of [2,3,4,5]" "120"
seed "Total of [1.5,2.5,3.5,4.5]" "12"

# ===========================================
# DOMAIN 4: UNIT CONVERSIONS
# ===========================================
echo "[4/20] Unit Conversions..."

# Temperature
seed "Convert 32 fahrenheit to celsius" "0"
seed "Convert 100 celsius to fahrenheit" "212"
seed "0 C to F" "32"
seed "98.6 F to C" "37"
seed "Convert 273 kelvin to celsius" "0"
seed "-40 C to F" "-40"

# Length
seed "Convert 1 mile to kilometers" "1.609"
seed "Convert 100 centimeters to meters" "1"
seed "5 feet to inches" "60"
seed "10 inches to centimeters" "25.4"
seed "1 meter to feet" "3.281"
seed "100 yards to meters" "91.44"
seed "1 nautical mile to kilometers" "1.852"

# Weight
seed "Convert 1 kilogram to pounds" "2.205"
seed "Convert 100 pounds to kilograms" "45.36"
seed "1 ounce to grams" "28.35"
seed "1000 grams to pounds" "2.205"
seed "1 ton to kilograms" "907.18"
seed "1 stone to pounds" "14"

# Volume
seed "Convert 1 gallon to liters" "3.785"
seed "1 liter to milliliters" "1000"
seed "1 cup to milliliters" "236.6"
seed "1 quart to liters" "0.946"
seed "1 pint to cups" "2"
seed "1 tablespoon to teaspoons" "3"

# Area
seed "Convert 1 acre to square meters" "4047"
seed "1 hectare to acres" "2.471"
seed "1 square mile to acres" "640"
seed "1 square foot to square meters" "0.093"

# Speed
seed "Convert 60 mph to kph" "96.56"
seed "100 kph to mph" "62.14"
seed "1 knot to mph" "1.151"
seed "Speed of sound in mph" "767"

# ===========================================
# DOMAIN 5: DATE & TIME
# ===========================================
echo "[5/20] Date & Time..."

# Days between
seed "Days between 2024-01-01 and 2024-12-31" "365"
seed "Days between 2024-03-01 and 2024-03-15" "14"
seed "Days until end of year from 2024-07-01" "183"

# Day of week
seed "What day is 2024-01-01" "Monday"
seed "Day of week for 2024-07-04" "Thursday"
seed "What day was 2000-01-01" "Saturday"

# Add/Subtract time
seed "Add 30 days to 2024-01-15" "2024-02-14"
seed "Subtract 7 days from 2024-03-01" "2024-02-23"
seed "Add 2 weeks to 2024-06-01" "2024-06-15"

# Format conversion
seed "Convert 2024-01-15 to MM/DD/YYYY" "01/15/2024"
seed "Convert 01/15/2024 to YYYY-MM-DD" "2024-01-15"
seed "Format 2024-01-15 as Jan 15, 2024" "Jan 15, 2024"

# Time calculations
seed "Convert 3600 seconds to hours" "1"
seed "Convert 2.5 hours to minutes" "150"
seed "Convert 90 minutes to hours and minutes" "1h 30m"
seed "Seconds in a day" "86400"
seed "Minutes in a week" "10080"

# Leap year
seed "Is 2024 a leap year" "true"
seed "Is 2023 a leap year" "false"
seed "Is 2000 a leap year" "true"
seed "Is 1900 a leap year" "false"

# Age calculation
seed "Age if born 1990-01-01 (as of 2024)" "34"
seed "Years between 1985 and 2024" "39"

# ===========================================
# DOMAIN 6: ENCODING & DECODING
# ===========================================
echo "[6/20] Encoding & Decoding..."

# Base64
seed "Base64 encode: hello" "aGVsbG8="
seed "Base64 decode: aGVsbG8=" "hello"
seed "Base64 encode: Hello World" "SGVsbG8gV29ybGQ="
seed "Base64 decode: SGVsbG8gV29ybGQ=" "Hello World"

# URL encoding
seed "URL encode: hello world" "hello%20world"
seed "URL decode: hello%20world" "hello world"
seed "URL encode: a=1&b=2" "a%3D1%26b%3D2"
seed "URL decode: %3F%26%3D" "?&="

# HTML entities
seed "HTML encode: <div>" "&lt;div&gt;"
seed "HTML decode: &lt;script&gt;" "<script>"
seed "HTML encode: \"quotes\"" "&quot;quotes&quot;"
seed "HTML encode: 5 > 3" "5 &gt; 3"

# Hex
seed "Convert hello to hex" "68656c6c6f"
seed "Hex to string: 68656c6c6f" "hello"
seed "Decimal 255 to hex" "ff"
seed "Hex ff to decimal" "255"
seed "Hex 1a2b to decimal" "6699"

# Binary
seed "Decimal 10 to binary" "1010"
seed "Binary 1010 to decimal" "10"
seed "Decimal 255 to binary" "11111111"
seed "Binary 11111111 to decimal" "255"
seed "Decimal 42 to binary" "101010"

# Octal
seed "Decimal 8 to octal" "10"
seed "Octal 777 to decimal" "511"
seed "Decimal 64 to octal" "100"

# ASCII
seed "ASCII code for A" "65"
seed "Character for ASCII 97" "a"
seed "ASCII code for space" "32"
seed "ASCII code for newline" "10"

# ===========================================
# DOMAIN 7: VALIDATION
# ===========================================
echo "[7/20] Validation..."

# Email
seed "Is valid email: test@example.com" "true"
seed "Is valid email: invalid-email" "false"
seed "Validate email: user.name+tag@domain.co" "true"
seed "Validate email: @nodomain.com" "false"

# URL
seed "Is valid URL: https://example.com" "true"
seed "Is valid URL: not-a-url" "false"
seed "Validate URL: http://localhost:3000" "true"
seed "Validate URL: ftp://files.example.com" "true"

# Phone
seed "Is valid phone: +1-555-123-4567" "true"
seed "Validate phone: 555-123-4567" "true"
seed "Is valid phone: 123" "false"

# Credit card (Luhn)
seed "Validate credit card: 4532015112830366" "true"
seed "Is valid card: 1234567890123456" "false"
seed "Luhn check: 79927398713" "true"

# IP Address
seed "Is valid IPv4: 192.168.1.1" "true"
seed "Is valid IPv4: 256.1.1.1" "false"
seed "Is valid IPv6: ::1" "true"
seed "Validate IP: 10.0.0.255" "true"

# JSON
seed "Is valid JSON: {\"key\":\"value\"}" "true"
seed "Is valid JSON: {invalid}" "false"
seed "Validate JSON: [1,2,3]" "true"
seed "Is valid JSON: null" "true"

# UUID
seed "Is valid UUID: 550e8400-e29b-41d4-a716-446655440000" "true"
seed "Validate UUID: not-a-uuid" "false"

# Other
seed "Is palindrome: racecar" "true"
seed "Is palindrome: hello" "false"
seed "Is anagram: listen silent" "true"
seed "Is alphanumeric: abc123" "true"
seed "Is alphanumeric: abc 123" "false"
seed "Contains only digits: 12345" "true"
seed "Contains only letters: abcXYZ" "true"

# ===========================================
# DOMAIN 8: FORMATTING
# ===========================================
echo "[8/20] Formatting..."

# Numbers
seed "Format number: 1234567" "1,234,567"
seed "Format number with 2 decimals: 1234.5" "1,234.50"
seed "Format percentage: 0.856" "85.6%"
seed "Format percentage: 0.12345 with 2 decimals" "12.35%"

# Currency
seed "Format USD: 1234.56" "$1,234.56"
seed "Format EUR: 1234.56" "1.234,56"
seed "Format GBP: 999.99" "999.99"
seed "Format currency: 1000000" "$1,000,000.00"

# Phone
seed "Format phone: 5551234567" "(555) 123-4567"
seed "Format phone: 15551234567" "+1 (555) 123-4567"
seed "Format international: 442012345678" "+44 20 1234 5678"

# Credit card
seed "Mask credit card: 4532015112830366" "****-****-****-0366"
seed "Format card: 4532015112830366" "4532 0151 1283 0366"

# Bytes
seed "Format bytes: 1024" "1 KB"
seed "Format bytes: 1048576" "1 MB"
seed "Format bytes: 1073741824" "1 GB"
seed "Format bytes: 500000" "488.28 KB"

# Duration
seed "Format duration: 3661" "1h 1m 1s"
seed "Format duration: 90" "1m 30s"
seed "Format seconds: 86400" "1 day"
seed "Format milliseconds: 5000" "5 seconds"

# Slug
seed "Create slug: Hello World!" "hello-world"
seed "Slugify: This is a Test" "this-is-a-test"
seed "URL slug: Product Name (2024)" "product-name-2024"

# ===========================================
# DOMAIN 9: TEXT ANALYSIS
# ===========================================
echo "[9/20] Text Analysis..."

# Word operations
seed "Word count: The quick brown fox jumps" "5"
seed "Sentence count: Hello. How are you? Fine." "3"
seed "Paragraph count: Para1\n\nPara2\n\nPara3" "3"
seed "Average word length: hello world test" "4.33"

# Character analysis
seed "Count uppercase: Hello World" "2"
seed "Count lowercase: Hello World" "8"
seed "Count digits: abc123def456" "6"
seed "Count special chars: hello@world.com!" "3"

# Reading time
seed "Reading time for 1000 words" "4 minutes"
seed "Reading time for 250 words" "1 minute"
seed "Speaking time for 500 words" "4 minutes"

# Frequency
seed "Most common word in: the cat and the dog and the bird" "the"
seed "Most common letter in: hello" "l"
seed "Letter frequency in: mississippi" "{i:4,s:4,p:2,m:1}"

# Similarity
seed "Levenshtein distance: kitten sitting" "3"
seed "Levenshtein distance: hello hallo" "1"
seed "Similarity: hello helo" "80%"

# ===========================================
# DOMAIN 10: FINANCIAL CALCULATIONS
# ===========================================
echo "[10/20] Financial Calculations..."

# Interest
seed "Simple interest: principal=1000 rate=5% time=2 years" "100"
seed "Compound interest: principal=1000 rate=5% time=2 years annually" "102.50"
seed "Monthly payment for loan: 200000 at 4% for 30 years" "954.83"

# Percentage
seed "What is 15% of 200" "30"
seed "What percent is 25 of 125" "20%"
seed "Increase 100 by 25%" "125"
seed "Decrease 100 by 20%" "80"
seed "Percentage change from 50 to 75" "50%"

# Tax
seed "Calculate 8.25% tax on 100" "8.25"
seed "Price with 10% tax: 50" "55"
seed "Price before 20% tax if total is 120" "100"
seed "Tip 18% on 75" "13.50"
seed "Split bill 150 between 3 people" "50"

# Discount
seed "Price after 25% discount on 80" "60"
seed "Original price if 30% off gives 70" "100"
seed "Buy 2 get 1 free: 3 items at $10" "20"

# Currency conversion
seed "Convert 100 USD to EUR at rate 0.85" "85"
seed "Convert 100 EUR to USD at rate 1.18" "118"
seed "100 GBP to USD at 1.27" "127"

# ROI
seed "ROI: invested 1000, returned 1500" "50%"
seed "Profit margin: cost 60, sell 100" "40%"
seed "Markup on cost 50 to price 75" "50%"

# ===========================================
# DOMAIN 11: STATISTICS
# ===========================================
echo "[11/20] Statistics..."

# Central tendency
seed "Mean of [10,20,30,40,50]" "30"
seed "Median of [1,2,3,4,5,6,7]" "4"
seed "Median of [1,2,3,4,5,6]" "3.5"
seed "Mode of [1,2,2,3,3,3,4,4]" "3"

# Spread
seed "Range of [5,10,15,20,25]" "20"
seed "Variance of [2,4,4,4,5,5,7,9]" "4"
seed "Standard deviation of [2,4,4,4,5,5,7,9]" "2"
seed "IQR of [1,2,3,4,5,6,7,8,9,10]" "5"

# Percentiles
seed "25th percentile of [1,2,3,4,5,6,7,8,9,10]" "3"
seed "75th percentile of [1,2,3,4,5,6,7,8,9,10]" "8"
seed "90th percentile of [1,2,3,4,5,6,7,8,9,10]" "9"

# Correlation
seed "Correlation: [1,2,3,4,5] and [2,4,6,8,10]" "1"
seed "Correlation: [1,2,3,4,5] and [5,4,3,2,1]" "-1"

# Z-score
seed "Z-score: value=75, mean=70, std=5" "1"
seed "Z-score: value=60, mean=70, std=5" "-2"

# ===========================================
# DOMAIN 12: GEOMETRY
# ===========================================
echo "[12/20] Geometry..."

# Circle
seed "Area of circle with radius 5" "78.54"
seed "Circumference of circle with radius 7" "43.98"
seed "Diameter of circle with circumference 31.42" "10"

# Rectangle
seed "Area of rectangle 5x10" "50"
seed "Perimeter of rectangle 5x10" "30"
seed "Diagonal of rectangle 3x4" "5"

# Triangle
seed "Area of triangle base=10 height=5" "25"
seed "Hypotenuse of right triangle 3x4" "5"
seed "Perimeter of triangle 3,4,5" "12"
seed "Area of equilateral triangle side=6" "15.59"

# Square
seed "Area of square side 8" "64"
seed "Diagonal of square side 10" "14.14"
seed "Side of square with area 144" "12"

# Sphere
seed "Volume of sphere radius 3" "113.1"
seed "Surface area of sphere radius 5" "314.16"

# Cube
seed "Volume of cube side 4" "64"
seed "Surface area of cube side 3" "54"

# Cylinder
seed "Volume of cylinder radius=3 height=5" "141.37"
seed "Surface area of cylinder radius=2 height=4" "75.4"

# Cone
seed "Volume of cone radius=3 height=4" "37.7"
seed "Surface area of cone radius=3 slant=5" "75.4"

# Pyramid
seed "Volume of square pyramid base=4 height=6" "32"

# Distance
seed "Distance between (0,0) and (3,4)" "5"
seed "Distance between (1,2) and (4,6)" "5"
seed "Midpoint between (0,0) and (10,10)" "(5,5)"

# ===========================================
# DOMAIN 13: REGEX PATTERNS
# ===========================================
echo "[13/20] Regex Patterns..."

# Extract
seed "Extract emails from: contact test@example.com for info" "test@example.com"
seed "Extract numbers from: abc123def456" "[123,456]"
seed "Extract URLs from: visit https://example.com today" "https://example.com"
seed "Extract hashtags from: #hello #world" "[#hello,#world]"
seed "Extract mentions from: cc @john @jane" "[@john,@jane]"

# Match
seed "Match phone pattern: 555-123-4567" "true"
seed "Match date pattern YYYY-MM-DD: 2024-01-15" "true"
seed "Match time pattern HH:MM: 14:30" "true"
seed "Match hex color: #FF5733" "true"

# Replace
seed "Replace digits with X: abc123def" "abcXXXdef"
seed "Replace spaces with underscores: hello world" "hello_world"
seed "Remove non-alphanumeric: hello@world.com!" "helloworldcom"

# Split
seed "Split by comma: a,b,c,d" "[a,b,c,d]"
seed "Split by multiple spaces: a  b   c" "[a,b,c]"
seed "Split camelCase: helloWorld" "[hello,World]"

# ===========================================
# DOMAIN 14: HASHING & CHECKSUMS
# ===========================================
echo "[14/20] Hashing & Checksums..."

# Common hashes
seed "MD5 hash of: hello" "5d41402abc4b2a76b9719d911017c592"
seed "SHA1 hash of: hello" "aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d"
seed "SHA256 hash of: hello" "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"

# CRC
seed "CRC32 of: hello" "3610a686"

# Hash verification
seed "Verify MD5 5d41402abc4b2a76b9719d911017c592 matches hello" "true"

# ===========================================
# DOMAIN 15: COLOR OPERATIONS
# ===========================================
echo "[15/20] Color Operations..."

# Hex to RGB
seed "Hex #FF5733 to RGB" "rgb(255,87,51)"
seed "Hex #000000 to RGB" "rgb(0,0,0)"
seed "Hex #FFFFFF to RGB" "rgb(255,255,255)"
seed "Hex #3498DB to RGB" "rgb(52,152,219)"

# RGB to Hex
seed "RGB 255,87,51 to Hex" "#FF5733"
seed "RGB 0,0,0 to Hex" "#000000"
seed "RGB 255,255,255 to Hex" "#FFFFFF"

# HSL
seed "Hex #FF5733 to HSL" "hsl(11,100%,60%)"
seed "RGB 255,0,0 to HSL" "hsl(0,100%,50%)"

# Color names
seed "Color name for #FF0000" "red"
seed "Color name for #00FF00" "lime"
seed "Color name for #0000FF" "blue"
seed "Hex for color: white" "#FFFFFF"
seed "Hex for color: black" "#000000"

# Contrast
seed "Contrast ratio: #000000 vs #FFFFFF" "21:1"
seed "Is accessible contrast: #777 on #FFF" "false"
seed "Is accessible contrast: #000 on #FFF" "true"

# Lighten/Darken
seed "Lighten #3498DB by 20%" "#5DADE2"
seed "Darken #3498DB by 20%" "#2874A6"

# ===========================================
# DOMAIN 16: NETWORK & WEB
# ===========================================
echo "[16/20] Network & Web..."

# URL parsing
seed "Extract domain from: https://www.example.com/path" "example.com"
seed "Extract path from: https://example.com/api/users" "/api/users"
seed "Extract protocol from: https://example.com" "https"
seed "Extract query string from: https://example.com?a=1&b=2" "a=1&b=2"
seed "Parse query string: a=1&b=2" "{a:1,b:2}"

# IP operations
seed "Is private IP: 192.168.1.1" "true"
seed "Is private IP: 8.8.8.8" "false"
seed "IP to decimal: 192.168.1.1" "3232235777"
seed "Decimal to IP: 3232235777" "192.168.1.1"
seed "CIDR to range: 192.168.1.0/24" "192.168.1.0-192.168.1.255"

# Port
seed "Is well-known port: 80" "true"
seed "Is well-known port: 8080" "false"
seed "Service for port 443" "HTTPS"
seed "Service for port 22" "SSH"
seed "Default port for HTTP" "80"
seed "Default port for MySQL" "3306"

# ===========================================
# DOMAIN 17: FILE & PATH OPERATIONS
# ===========================================
echo "[17/20] File & Path Operations..."

# Extension
seed "Get extension: document.pdf" "pdf"
seed "Get extension: archive.tar.gz" "gz"
seed "Get extension: file" ""
seed "Remove extension: image.png" "image"

# Path parts
seed "Get filename: /home/user/document.txt" "document.txt"
seed "Get directory: /home/user/document.txt" "/home/user"
seed "Get basename: /home/user/document.txt" "document"
seed "Join paths: /home /user /docs" "/home/user/docs"

# Normalize
seed "Normalize path: /home//user/../user/./docs" "/home/user/docs"
seed "Is absolute path: /home/user" "true"
seed "Is absolute path: ./relative" "false"

# Size estimation
seed "Estimate size of 1000 words document" "5 KB"
seed "Estimate size of 1920x1080 PNG" "6 MB"

# ===========================================
# DOMAIN 18: JSON OPERATIONS
# ===========================================
echo "[18/20] JSON Operations..."

# Parse/Stringify
seed "Parse JSON: {\"name\":\"John\",\"age\":30}" "{name:John,age:30}"
seed "Stringify object: {name:John,age:30}" "{\"name\":\"John\",\"age\":30}"
seed "Pretty print JSON: {\"a\":1,\"b\":2}" "{\n  \"a\": 1,\n  \"b\": 2\n}"

# Access
seed "Get value at path $.name from {name:John,age:30}" "John"
seed "Get nested value $.address.city from {address:{city:NYC}}" "NYC"
seed "Get array element $[0] from [1,2,3]" "1"

# Transform
seed "Pick keys name,age from {name:John,age:30,city:NYC}" "{name:John,age:30}"
seed "Omit key age from {name:John,age:30}" "{name:John}"
seed "Merge {a:1} and {b:2}" "{a:1,b:2}"

# Flatten
seed "Flatten JSON {a:{b:{c:1}}}" "{a.b.c:1}"
seed "Unflatten {a.b.c:1}" "{a:{b:{c:1}}}"

# ===========================================
# DOMAIN 19: CODE UTILITIES
# ===========================================
echo "[19/20] Code Utilities..."

# UUID/ID generation patterns
seed "Generate UUIDv4 pattern" "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx"
seed "Validate ULID format: 01ARZ3NDEKTSV4RRFFQ69G5FAV" "true"
seed "Nanoid pattern length 21" "^[A-Za-z0-9_-]{21}$"

# Variable naming
seed "Is valid variable name: myVar123" "true"
seed "Is valid variable name: 123var" "false"
seed "Is valid variable name: my-var" "false"
seed "Is reserved word: class" "true"
seed "Is reserved word: myClass" "false"

# Escape/Unescape
seed "Escape for SQL: O'Brien" "O''Brien"
seed "Escape for regex: [test]" "\\[test\\]"
seed "Escape for shell: hello world" "hello\\ world"

# Indent
seed "Indent 2 spaces: function(){}" "  function(){}"
seed "Convert tabs to 2 spaces: \\tcode" "  code"

# Comment syntax
seed "Single line comment style for JavaScript" "//"
seed "Multi line comment style for Python" "\"\"\" \"\"\""
seed "Comment style for SQL" "-- or /* */"

# ===========================================
# DOMAIN 20: MISCELLANEOUS UTILITIES
# ===========================================
echo "[20/20] Miscellaneous Utilities..."

# Roman numerals
seed "Convert 2024 to roman numerals" "MMXXIV"
seed "Convert 49 to roman numerals" "XLIX"
seed "Convert MCMXCIX to number" "1999"
seed "Convert XIV to number" "14"

# Number words
seed "Number to words: 123" "one hundred twenty-three"
seed "Number to words: 1000000" "one million"
seed "Words to number: forty-two" "42"
seed "Ordinal of 1" "1st"
seed "Ordinal of 2" "2nd"
seed "Ordinal of 3" "3rd"
seed "Ordinal of 11" "11th"

# Lorem ipsum
seed "Generate 5 lorem words" "Lorem ipsum dolor sit amet"
seed "Generate 1 lorem sentence" "Lorem ipsum dolor sit amet, consectetur adipiscing elit."

# Password strength
seed "Password strength: password123" "weak"
seed "Password strength: P@ssw0rd!2024" "strong"
seed "Password strength: correcthorsebatterystaple" "medium"

# Phonetic alphabet
seed "NATO phonetic for A" "Alpha"
seed "NATO phonetic for Z" "Zulu"
seed "Spell phonetically: SOS" "Sierra Oscar Sierra"

# Morse code
seed "Morse code for SOS" "... --- ..."
seed "Decode morse: ... --- ..." "SOS"
seed "Morse for HELLO" ".... . .-.. .-.. ---"

# Emoji
seed "Emoji for :smile:" "😄"
seed "Emoji for :heart:" "❤️"
seed "Emoji for :thumbsup:" "👍"

# Dice/Random patterns
seed "Roll 2d6 average" "7"
seed "Probability of heads in coin flip" "50%"
seed "Cards in a standard deck" "52"

echo ""
echo "=== Seeding Complete ==="
echo "Total traces seeded: $COUNT"
echo "Finished at $(date)"
echo ""
echo "Worker will crystallize these into shards overnight."
echo "Check progress: curl http://localhost:3001/api/stats"
