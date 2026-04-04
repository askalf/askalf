-- Dynamic model pricing — overrides built-in defaults
-- Users can set custom pricing or update when providers change rates

CREATE TABLE IF NOT EXISTS forge_model_pricing (
  model_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  display_name TEXT,
  input_per_1k NUMERIC(10,6) NOT NULL,
  output_per_1k NUMERIC(10,6) NOT NULL,
  is_active BOOLEAN DEFAULT true,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
