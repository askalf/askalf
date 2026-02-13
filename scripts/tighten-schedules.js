#!/usr/bin/env node
/**
 * Tighten all agent schedules for 24/7 overnight operation.
 * Run: cat scripts/tighten-schedules.js | docker exec -i substrate-prod-api node -
 */

const http = require('http');

function adminRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: 'localhost', port: 3001, method, path,
      headers: {
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

const SCHEDULES = [
  // Ops agents — every 30-60min
  { id: '01KGXG4SNRAAGWE0F4Z44NXB5S', name: 'Sentinel',       mins: 30 },
  { id: '01KGXG4SRNPS9XT49VR1N8FSMB', name: 'Nightwatch',     mins: 30 },
  { id: '01KGXG4SS55GBA5SRZBVV8E1NR', name: 'Forge Smith',    mins: 60 },
  { id: '01KGXG4SSG50D7HRJ811F6XZ3X', name: 'Librarian',      mins: 120 },
  { id: '01KGXG4ST1DR9KPM6S4EB56A6G', name: 'Concierge',      mins: 60 },
  { id: '01KGXG4STMCPSY1F60ZX5TBZFX', name: 'Quartermaster',  mins: 60 },
  { id: '01KGXG4SV2ZQH936ZQVJ81JP9M', name: 'Herald',         mins: 60 },
  { id: '01KGXG4SVERD6E8BHKVMK6JTBY', name: 'Overseer',       mins: 60 },
  { id: '01KH295596E1CVNTRQDHWZXKEB', name: 'Shard Curator',   mins: 60 },
  { id: '01KH1ZKR0001CONVERGENCEOP01', name: 'Metabolist',     mins: 60 },

  // Dev agents — every 60-120min
  { id: '01KGXGV6QBPG0S0VGRY64T7D1W', name: 'Architect',      mins: 120 },
  { id: '01KGXGV6R7KD6F3WD0MGASRHYY', name: 'Frontend Dev',   mins: 90 },
  { id: '01KGXGV6RSSKVXEF8X2S79R3KR', name: 'Backend Dev',    mins: 90 },
  { id: '01KGXGV6S74J5BKEZHDJ8Q672K', name: 'QA Engineer',     mins: 120 },
  { id: '01KGXGV6SKXJKJMF3K4HQSQ8VB', name: 'DevOps',        mins: 60 },
  { id: '01KGXGV6T1N9RJMHF44MFX6WA3', name: 'API Tester',    mins: 120 },
  { id: '01KGXGV6TD7REMT407ZV7QTSB6', name: 'Data Engineer',  mins: 120 },
  { id: '01KGXGV6TY5VJ7GAK9JW1T79SZ', name: 'Doc Writer',    mins: 120 },
];

(async () => {
  console.log('Tightening all agent schedules for 24/7 operation...\n');

  for (const agent of SCHEDULES) {
    try {
      const res = await adminRequest('POST', `/api/v1/admin/agents/${agent.id}/schedule`, {
        schedule_type: 'scheduled',
        schedule_interval_minutes: agent.mins,
        is_continuous: false,
        execution_mode: 'individual',  // Direct execution (not batch) for faster response
      });
      if (res.status === 200) {
        console.log(`OK ${agent.name.padEnd(18)} → every ${String(agent.mins).padStart(3)}min (individual)`);
      } else {
        console.log(`FAIL ${agent.name}: ${res.status} ${JSON.stringify(res.data).substring(0, 200)}`);
      }
    } catch (err) {
      console.log(`ERROR ${agent.name}: ${err.message}`);
    }
  }

  console.log('\n--- Final schedule state ---\n');

  // Verify
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://substrate:substrate@postgres:5432/substrate' });
  const result = await pool.query(`
    SELECT agent_id, schedule_type, schedule_interval_minutes, next_run_at, execution_mode
    FROM agent_schedules
    ORDER BY schedule_interval_minutes ASC, agent_id
  `);
  for (const row of result.rows) {
    const name = SCHEDULES.find(s => s.id === row.agent_id)?.name || row.agent_id;
    console.log(`${name.padEnd(18)} ${row.schedule_type.padEnd(10)} every ${String(row.schedule_interval_minutes).padStart(3)}min  next: ${row.next_run_at?.toISOString().substring(11, 19) || 'n/a'}  mode: ${row.execution_mode}`);
  }
  await pool.end();

  console.log('\nDone!');
})();
