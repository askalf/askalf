import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({ connectionString: process.env.FORGE_DATABASE_URL });

const sql = `
INSERT INTO forge_agents (
  id, owner_id, name, slug, description, system_prompt, model_id,
  autonomy_level, enabled_tools, status, type, is_internal,
  max_iterations, max_tokens_per_turn, max_cost_per_execution,
  memory_config, metadata
) VALUES (
  $1, $2, $3, $4, $5, $6, NULL,
  0, ARRAY[]::text[], 'active', 'custom', true,
  0, 0, 0.00,
  $7::jsonb, $8::jsonb
) ON CONFLICT (id) DO NOTHING
`;

const params = [
  'fleet:system',
  'system:forge',
  'Fleet System',
  'fleet-system',
  'Sentinel row for fleet-level memories not attributed to a specific agent.',
  'Fleet-level system agent. Not dispatched.',
  JSON.stringify({ enableWorking: false, enableSemantic: false, enableEpisodic: false, enableProcedural: false }),
  JSON.stringify({ system_agent: true, sentinel: true }),
];

pool.query(sql, params)
  .then(r => { console.log('OK rows affected:', r.rowCount); process.exit(0); })
  .catch(e => { console.error('ERROR:', e.message); process.exit(1); });
