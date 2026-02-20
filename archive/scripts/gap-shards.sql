-- Shards for detected capability gaps

-- Sentiment Analysis (basic rule-based for procedural execution)
INSERT INTO procedural_shards (id, name, description, logic, lifecycle, visibility, category, execution_count, success_count, failure_count)
VALUES (
  'shd_sentiment_001',
  'sentiment-analyzer',
  'Analyzes text sentiment using lexicon-based approach - returns positive, negative, or neutral with confidence score',
  $LOGIC$function execute(input) {
  const text = (typeof input === "string" ? input : input.text || "").toLowerCase();

  const positiveWords = ["good", "great", "excellent", "amazing", "wonderful", "fantastic", "love", "happy", "joy", "beautiful", "perfect", "best", "awesome", "brilliant", "outstanding", "superb", "delightful", "pleasant", "satisfied", "grateful", "excited", "thrilled", "impressed", "recommend", "enjoy"];
  const negativeWords = ["bad", "terrible", "awful", "horrible", "hate", "sad", "angry", "disappointed", "poor", "worst", "disgusting", "pathetic", "annoying", "frustrating", "useless", "failure", "broken", "waste", "regret", "dislike", "never", "problem", "issue", "complaint", "avoid"];
  const intensifiers = ["very", "really", "extremely", "incredibly", "absolutely", "totally", "completely", "highly"];
  const negators = ["not", "no", "never", "neither", "nobody", "nothing", "nowhere", "hardly", "barely", "rarely"];

  const words = text.split(/\s+/);
  let positiveScore = 0;
  let negativeScore = 0;
  let isNegated = false;
  let intensity = 1;

  for (let i = 0; i < words.length; i++) {
    const word = words[i].replace(/[^\w]/g, "");

    if (negators.includes(word)) {
      isNegated = true;
      continue;
    }

    if (intensifiers.includes(word)) {
      intensity = 1.5;
      continue;
    }

    if (positiveWords.includes(word)) {
      if (isNegated) {
        negativeScore += intensity;
      } else {
        positiveScore += intensity;
      }
    } else if (negativeWords.includes(word)) {
      if (isNegated) {
        positiveScore += intensity;
      } else {
        negativeScore += intensity;
      }
    }

    isNegated = false;
    intensity = 1;
  }

  const total = positiveScore + negativeScore;
  let sentiment, confidence;

  if (total === 0) {
    sentiment = "neutral";
    confidence = 0.5;
  } else if (positiveScore > negativeScore) {
    sentiment = "positive";
    confidence = Math.min(0.95, 0.5 + (positiveScore - negativeScore) / (total * 2));
  } else if (negativeScore > positiveScore) {
    sentiment = "negative";
    confidence = Math.min(0.95, 0.5 + (negativeScore - positiveScore) / (total * 2));
  } else {
    sentiment = "mixed";
    confidence = 0.5;
  }

  return JSON.stringify({
    sentiment: sentiment,
    confidence: Math.round(confidence * 100) / 100,
    scores: {
      positive: positiveScore,
      negative: negativeScore
    },
    word_count: words.length
  });
}$LOGIC$,
  'testing', 'public', 'nlp', 0, 0, 0
)
ON CONFLICT (id) DO UPDATE SET logic = EXCLUDED.logic, description = EXCLUDED.description;

-- Matrix Operations (2x2 and 3x3 basic operations)
INSERT INTO procedural_shards (id, name, description, logic, lifecycle, visibility, category, execution_count, success_count, failure_count)
VALUES (
  'shd_matrix_add_001',
  'matrix-addition',
  'Adds two matrices of the same dimensions - input as JSON arrays',
  $LOGIC$function execute(input) {
  let data;
  try {
    data = typeof input === "string" ? JSON.parse(input) : input;
  } catch {
    return JSON.stringify({ error: "Invalid JSON input", example: "[[1,2],[3,4]], [[5,6],[7,8]]" });
  }

  const a = data.a || data[0];
  const b = data.b || data[1];

  if (!Array.isArray(a) || !Array.isArray(b)) {
    return JSON.stringify({ error: "Matrices must be arrays", example: "{a: [[1,2],[3,4]], b: [[5,6],[7,8]]}" });
  }

  if (a.length !== b.length) {
    return JSON.stringify({ error: "Matrix dimensions must match" });
  }

  const result = [];
  for (let i = 0; i < a.length; i++) {
    if (!Array.isArray(a[i]) || !Array.isArray(b[i]) || a[i].length !== b[i].length) {
      return JSON.stringify({ error: "Row dimensions must match" });
    }
    const row = [];
    for (let j = 0; j < a[i].length; j++) {
      row.push(a[i][j] + b[i][j]);
    }
    result.push(row);
  }

  return JSON.stringify({
    operation: "addition",
    result: result,
    dimensions: [result.length, result[0].length]
  });
}$LOGIC$,
  'testing', 'public', 'math', 0, 0, 0
)
ON CONFLICT (id) DO UPDATE SET logic = EXCLUDED.logic, description = EXCLUDED.description;

INSERT INTO procedural_shards (id, name, description, logic, lifecycle, visibility, category, execution_count, success_count, failure_count)
VALUES (
  'shd_matrix_mult_001',
  'matrix-multiplication',
  'Multiplies two matrices - columns of first must equal rows of second',
  $LOGIC$function execute(input) {
  let data;
  try {
    data = typeof input === "string" ? JSON.parse(input) : input;
  } catch {
    return JSON.stringify({ error: "Invalid JSON input" });
  }

  const a = data.a || data[0];
  const b = data.b || data[1];

  if (!Array.isArray(a) || !Array.isArray(b) || !Array.isArray(a[0]) || !Array.isArray(b[0])) {
    return JSON.stringify({ error: "Input must be 2D arrays" });
  }

  const rowsA = a.length;
  const colsA = a[0].length;
  const rowsB = b.length;
  const colsB = b[0].length;

  if (colsA !== rowsB) {
    return JSON.stringify({ error: "Incompatible dimensions: cols(A) must equal rows(B)", a_cols: colsA, b_rows: rowsB });
  }

  const result = [];
  for (let i = 0; i < rowsA; i++) {
    const row = [];
    for (let j = 0; j < colsB; j++) {
      let sum = 0;
      for (let k = 0; k < colsA; k++) {
        sum += a[i][k] * b[k][j];
      }
      row.push(sum);
    }
    result.push(row);
  }

  return JSON.stringify({
    operation: "multiplication",
    result: result,
    dimensions: [rowsA, colsB]
  });
}$LOGIC$,
  'testing', 'public', 'math', 0, 0, 0
)
ON CONFLICT (id) DO UPDATE SET logic = EXCLUDED.logic, description = EXCLUDED.description;

INSERT INTO procedural_shards (id, name, description, logic, lifecycle, visibility, category, execution_count, success_count, failure_count)
VALUES (
  'shd_matrix_transpose_001',
  'matrix-transpose',
  'Transposes a matrix - swaps rows and columns',
  $LOGIC$function execute(input) {
  let matrix;
  try {
    matrix = typeof input === "string" ? JSON.parse(input) : input;
    if (matrix.matrix) matrix = matrix.matrix;
  } catch {
    return JSON.stringify({ error: "Invalid JSON input" });
  }

  if (!Array.isArray(matrix) || !Array.isArray(matrix[0])) {
    return JSON.stringify({ error: "Input must be a 2D array" });
  }

  const rows = matrix.length;
  const cols = matrix[0].length;

  const result = [];
  for (let j = 0; j < cols; j++) {
    const row = [];
    for (let i = 0; i < rows; i++) {
      row.push(matrix[i][j]);
    }
    result.push(row);
  }

  return JSON.stringify({
    operation: "transpose",
    original_dimensions: [rows, cols],
    result: result,
    new_dimensions: [cols, rows]
  });
}$LOGIC$,
  'testing', 'public', 'math', 0, 0, 0
)
ON CONFLICT (id) DO UPDATE SET logic = EXCLUDED.logic, description = EXCLUDED.description;

INSERT INTO procedural_shards (id, name, description, logic, lifecycle, visibility, category, execution_count, success_count, failure_count)
VALUES (
  'shd_matrix_determinant_001',
  'matrix-determinant',
  'Calculates determinant of a 2x2 or 3x3 matrix',
  $LOGIC$function execute(input) {
  let matrix;
  try {
    matrix = typeof input === "string" ? JSON.parse(input) : input;
    if (matrix.matrix) matrix = matrix.matrix;
  } catch {
    return JSON.stringify({ error: "Invalid JSON input" });
  }

  if (!Array.isArray(matrix) || !Array.isArray(matrix[0])) {
    return JSON.stringify({ error: "Input must be a 2D array" });
  }

  const n = matrix.length;
  if (n !== matrix[0].length) {
    return JSON.stringify({ error: "Matrix must be square" });
  }

  let det;
  if (n === 2) {
    det = matrix[0][0] * matrix[1][1] - matrix[0][1] * matrix[1][0];
  } else if (n === 3) {
    det = matrix[0][0] * (matrix[1][1] * matrix[2][2] - matrix[1][2] * matrix[2][1])
        - matrix[0][1] * (matrix[1][0] * matrix[2][2] - matrix[1][2] * matrix[2][0])
        + matrix[0][2] * (matrix[1][0] * matrix[2][1] - matrix[1][1] * matrix[2][0]);
  } else {
    return JSON.stringify({ error: "Only 2x2 and 3x3 matrices supported", size: n });
  }

  return JSON.stringify({
    operation: "determinant",
    matrix_size: n + "x" + n,
    determinant: det,
    is_invertible: det !== 0
  });
}$LOGIC$,
  'testing', 'public', 'math', 0, 0, 0
)
ON CONFLICT (id) DO UPDATE SET logic = EXCLUDED.logic, description = EXCLUDED.description;

-- Time Zone Conversion
INSERT INTO procedural_shards (id, name, description, logic, lifecycle, visibility, category, execution_count, success_count, failure_count)
VALUES (
  'shd_timezone_001',
  'timezone-converter',
  'Converts time between common time zones using UTC offsets',
  $LOGIC$function execute(input) {
  const zones = {
    "UTC": 0, "GMT": 0,
    "EST": -5, "EDT": -4, "CST": -6, "CDT": -5, "MST": -7, "MDT": -6, "PST": -8, "PDT": -7,
    "CET": 1, "CEST": 2, "EET": 2, "EEST": 3,
    "IST": 5.5, "JST": 9, "KST": 9, "CST_CHINA": 8, "AEST": 10, "AEDT": 11,
    "GMT+1": 1, "GMT+2": 2, "GMT+3": 3, "GMT+4": 4, "GMT+5": 5, "GMT+8": 8, "GMT+9": 9,
    "GMT-5": -5, "GMT-6": -6, "GMT-7": -7, "GMT-8": -8
  };

  let data;
  try {
    data = typeof input === "string" ? JSON.parse(input) : input;
  } catch {
    // Parse natural language: "3pm EST to PST"
    const match = input.match(/(\d{1,2}):?(\d{2})?\s*(am|pm)?\s*(\w+)\s*to\s*(\w+)/i);
    if (match) {
      let hours = parseInt(match[1]);
      const mins = parseInt(match[2]) || 0;
      const ampm = match[3];
      const from = match[4].toUpperCase();
      const to = match[5].toUpperCase();

      if (ampm && ampm.toLowerCase() === "pm" && hours < 12) hours += 12;
      if (ampm && ampm.toLowerCase() === "am" && hours === 12) hours = 0;

      data = { time: hours + ":" + (mins < 10 ? "0" : "") + mins, from: from, to: to };
    } else {
      return JSON.stringify({ error: "Could not parse input", example: "3pm EST to PST" });
    }
  }

  const time = data.time;
  const fromZone = (data.from || "").toUpperCase();
  const toZone = (data.to || "").toUpperCase();

  if (zones[fromZone] === undefined || zones[toZone] === undefined) {
    return JSON.stringify({ error: "Unknown timezone", supported: Object.keys(zones) });
  }

  const timeParts = time.match(/(\d{1,2}):(\d{2})/);
  if (!timeParts) {
    return JSON.stringify({ error: "Invalid time format", expected: "HH:MM" });
  }

  let hours = parseInt(timeParts[1]);
  let mins = parseInt(timeParts[2]);

  // Convert to UTC then to target
  const utcHours = hours - zones[fromZone];
  const targetHours = utcHours + zones[toZone];

  // Normalize to 0-24
  let finalHours = targetHours;
  let dayOffset = 0;
  while (finalHours < 0) { finalHours += 24; dayOffset--; }
  while (finalHours >= 24) { finalHours -= 24; dayOffset++; }

  const dayNote = dayOffset === 0 ? "same day" : dayOffset > 0 ? "+" + dayOffset + " day" : dayOffset + " day";

  return JSON.stringify({
    input: time + " " + fromZone,
    output: Math.floor(finalHours) + ":" + (mins < 10 ? "0" : "") + mins + " " + toZone,
    day_change: dayNote,
    utc_offset_from: zones[fromZone],
    utc_offset_to: zones[toZone]
  });
}$LOGIC$,
  'testing', 'public', 'time', 0, 0, 0
)
ON CONFLICT (id) DO UPDATE SET logic = EXCLUDED.logic, description = EXCLUDED.description;

-- JSON Parser/Validator
INSERT INTO procedural_shards (id, name, description, logic, lifecycle, visibility, category, execution_count, success_count, failure_count)
VALUES (
  'shd_json_validate_001',
  'json-validator',
  'Validates JSON and provides structure analysis',
  $LOGIC$function execute(input) {
  const text = typeof input === "string" ? input : JSON.stringify(input);

  try {
    const parsed = JSON.parse(text);

    function analyze(obj, depth) {
      if (depth > 10) return { type: "deep", truncated: true };
      if (obj === null) return { type: "null" };
      if (Array.isArray(obj)) {
        return {
          type: "array",
          length: obj.length,
          items: obj.length > 0 ? analyze(obj[0], depth + 1) : null
        };
      }
      if (typeof obj === "object") {
        const keys = Object.keys(obj);
        return {
          type: "object",
          keys: keys.length,
          properties: keys.slice(0, 5).reduce((acc, k) => {
            acc[k] = analyze(obj[k], depth + 1);
            return acc;
          }, {})
        };
      }
      return { type: typeof obj };
    }

    return JSON.stringify({
      valid: true,
      structure: analyze(parsed, 0),
      size_bytes: text.length,
      root_type: Array.isArray(parsed) ? "array" : typeof parsed
    });
  } catch (e) {
    // Find error position
    const match = e.message.match(/position (\d+)/);
    const pos = match ? parseInt(match[1]) : null;

    return JSON.stringify({
      valid: false,
      error: e.message,
      position: pos,
      context: pos ? text.substring(Math.max(0, pos - 10), pos + 10) : null
    });
  }
}$LOGIC$,
  'testing', 'public', 'data', 0, 0, 0
)
ON CONFLICT (id) DO UPDATE SET logic = EXCLUDED.logic, description = EXCLUDED.description;
