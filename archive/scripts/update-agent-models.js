#!/usr/bin/env node
/**
 * Update agent models across the fleet.
 * Run: cat scripts/update-agent-models.js | docker exec -i sprayberry-labs-api node -
 */

const http = require('http');
const API_KEY = 'fk_a9061ee9b9a863ba4b6c27961cc81d96c6c6c0e2ccee0eca';

function forgeRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: 'forge', port: 3005, method, path,
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
      },
    }, (res) => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(d) }); }
        catch { resolve({ status: res.statusCode, data: d }); }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

const OPUS = 'claude-opus-4-6';
const SONNET = 'claude-sonnet-4-5-20250929';
const HAIKU = 'claude-haiku-4-5-20251001';

const MODEL_ASSIGNMENTS = {
  // Opus — code writers + validators
  '01KGXGV6QBPG0S0VGRY64T7D1W': { name: 'Architect',     model: OPUS },
  '01KGXG4SS55GBA5SRZBVV8E1NR': { name: 'Forge Smith',   model: OPUS },
  '01KGXGV6RSSKVXEF8X2S79R3KR': { name: 'Backend Dev',   model: OPUS },
  '01KGXGV6R7KD6F3WD0MGASRHYY': { name: 'Frontend Dev',  model: OPUS },
  '01KGXGV6S74J5BKEZHDJ8Q672K': { name: 'QA Engineer',   model: OPUS },

  // Sonnet — document/shard/data work
  '01KGXGV6TY5VJ7GAK9JW1T79SZ': { name: 'Doc Writer',    model: SONNET },
  '01KGXG4SV2ZQH936ZQVJ81JP9M': { name: 'Herald',        model: SONNET },
  '01KH295596E1CVNTRQDHWZXKEB': { name: 'Shard Curator',  model: SONNET },
  '01KGXG4SSG50D7HRJ811F6XZ3X': { name: 'Librarian',     model: SONNET },
  '01KGXGV6TD7REMT407ZV7QTSB6': { name: 'Data Engineer',  model: SONNET },

  // Haiku — monitoring/ops (already on Haiku, no change needed)
  // Sentinel, Nightwatch, Concierge, Quartermaster, Overseer, Metabolist, DevOps, API Tester
};

(async () => {
  console.log('Updating agent models...\n');

  for (const [id, config] of Object.entries(MODEL_ASSIGNMENTS)) {
    try {
      const res = await forgeRequest('PUT', `/api/v1/forge/agents/${id}`, {
        modelId: config.model,
      });
      if (res.status === 200) {
        const agent = res.data.agent || res.data;
        console.log(`OK ${config.name.padEnd(16)} → ${config.model}`);
      } else {
        console.log(`FAIL ${config.name}: ${res.status} ${JSON.stringify(res.data).substring(0, 200)}`);
      }
    } catch (err) {
      console.log(`ERROR ${config.name}: ${err.message}`);
    }
  }

  console.log('\n--- Final state ---\n');

  const all = await forgeRequest('GET', '/api/v1/forge/agents');
  for (const a of (all.data.agents || [])) {
    console.log(a.name.padEnd(18), (a.model_id || 'default').padEnd(35));
  }

  console.log('\nDone!');
})();
