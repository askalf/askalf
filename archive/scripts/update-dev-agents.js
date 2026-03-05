#!/usr/bin/env node
/**
 * Add autonomous behavior sections to remaining dev agents.
 * Run: cat scripts/update-dev-agents.js | docker exec -i sprayberry-labs-api node -
 */

const http = require('http');
const API_KEY = process.env.FORGE_API_KEY || '';
const FORGE = { hostname: 'forge', port: 3005 };

function forgeRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const req = http.request({
      ...FORGE, method, path,
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

const QA_AUTONOMOUS = `## Autonomous Behavior (Scheduled Runs)
When you have no assigned tickets, perform these QA duties:

1. **Regression sweep**: Use api_call to test critical user flows:
   - Chat endpoint: POST a test message and verify response shape
   - Shard search: GET /api/v1/shards/search?q=test and verify results
   - Auth flow: Test that unauthenticated requests get proper 401s
   - Dashboard health: GET app.askalf.org/health

2. **Data integrity check**: Use substrate_db_query to verify:
   - No orphaned records (chat_messages without sessions, shard_pack_items without packs)
   - Constraint violations or NULL values in required fields
   - Recent execution records have valid statuses

3. **Security spot-check**: Use security_scan on one codebase area per run:
   - Check for hardcoded credentials or API keys in code
   - Verify input validation on API endpoints
   - Check for SQL injection patterns (string concatenation in queries)

File a summary finding each run with test results and any issues discovered.`;

const API_TESTER_AUTONOMOUS = `## Autonomous Behavior (Scheduled Runs)
When you have no assigned tickets, perform these API testing duties:

1. **Full endpoint sweep**: Test ALL known API endpoints systematically:
   - api.askalf.org: /health, /api/v1/tenants, /api/v1/shards/*, /api/chat/*
   - app.askalf.org: /health, /api/v1/admin/* (via admin-hub)
   - forge: /api/v1/forge/agents, /api/v1/forge/executions (via admin-hub proxy)
   Record response times, status codes, and response shapes.

2. **Schema validation**: For each endpoint, verify:
   - Response matches expected JSON schema
   - Required fields are present and correctly typed
   - Pagination works correctly (limit, offset)
   - Error responses have consistent format

3. **Performance baseline**: Record response times and compare with previous runs. Flag any endpoint that's 2x slower than usual.

4. **Auth boundary testing**: Verify that protected endpoints reject requests without valid auth tokens.

File a comprehensive finding each run with endpoint health matrix (endpoint, status, latency, pass/fail).`;

const DATA_ENGINEER_AUTONOMOUS = `## Autonomous Behavior (Scheduled Runs)
When you have no assigned tickets, perform these data engineering duties:

1. **Query performance scan**: Use substrate_db_query to check for slow queries:
   \`\`\`sql
   SELECT query, calls, mean_exec_time, total_exec_time
   FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 10;
   \`\`\`
   File findings for queries averaging >100ms.

2. **Table growth monitoring**: Check table sizes and growth:
   \`\`\`sql
   SELECT relname, n_live_tup, pg_size_pretty(pg_total_relation_size(relid))
   FROM pg_stat_user_tables ORDER BY n_live_tup DESC LIMIT 15;
   \`\`\`
   Flag tables growing unusually fast.

3. **Embedding quality check**: Verify pgvector index health:
   \`\`\`sql
   SELECT indexrelname, idx_scan, idx_tup_read
   FROM pg_stat_user_indexes WHERE indexrelname LIKE '%embedding%' OR indexrelname LIKE '%hnsw%';
   \`\`\`

4. **Data quality audit**: Check for anomalies:
   - Shards with NULL embeddings
   - Chat sessions with zero messages
   - Users with broken billing state

File a summary finding each run with data health metrics.`;

const AGENTS = {
  qa_engineer:  { id: '01KGXGV6S74J5BKEZHDJ8Q672K', custom: QA_AUTONOMOUS },
  api_tester:   { id: '01KGXGV6T1N9RJMHF44MFX6WA3', custom: API_TESTER_AUTONOMOUS },
  data_engineer:{ id: '01KGXGV6TD7REMT407ZV7QTSB6', custom: DATA_ENGINEER_AUTONOMOUS },
};

async function updateAgent(name, config) {
  const res = await forgeRequest('GET', `/api/v1/forge/agents/${config.id}`);
  if (res.status !== 200) { console.log(`FAIL ${name}: GET ${res.status}`); return; }

  const agent = res.data.agent;
  let prompt = agent.system_prompt;

  // Check if already has autonomous behavior
  if (prompt.includes('## Autonomous Behavior')) {
    console.log(`SKIP ${name}: already has autonomous behavior section`);
    return;
  }

  // Insert custom section before AUTONOMOUS OPERATIONS PROTOCOL
  const marker = '## AUTONOMOUS OPERATIONS PROTOCOL';
  const idx = prompt.indexOf(marker);
  if (idx > 0) {
    prompt = prompt.substring(0, idx) + config.custom + '\n\n' + prompt.substring(idx);
  } else {
    prompt = prompt.trimEnd() + '\n\n' + config.custom;
  }

  const putRes = await forgeRequest('PUT', `/api/v1/forge/agents/${config.id}`, {
    systemPrompt: prompt,
  });

  if (putRes.status === 200) {
    const updated = putRes.data.agent || putRes.data;
    console.log(`OK ${name}: v${updated.version || '?'}, ${(updated.system_prompt || prompt).length} chars`);
  } else {
    console.log(`FAIL ${name}: PUT ${putRes.status}`);
  }
}

(async () => {
  console.log('Updating remaining dev agent prompts...\n');
  for (const [name, config] of Object.entries(AGENTS)) {
    try { await updateAgent(name, config); } catch (err) { console.log(`ERROR ${name}: ${err.message}`); }
  }
  console.log('\nDone!');
})();
