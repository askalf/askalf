#!/usr/bin/env node
/**
 * Fleet Trigger Script - 24/7 Autonomous Operations
 * Triggers all 16 operational agents with ticket-driven workflow prompts.
 */

import http from 'http';

const API_KEY = 'fk_a9061ee9b9a863ba4b6c27961cc81d96c6c6c0e2ccee0eca';
const HOST = '127.0.0.1';
const PORT = 3005;

function triggerAgent(agentId, prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ agentId, input: prompt });
    const req = http.request({
      host: HOST, port: PORT,
      path: '/api/v1/forge/executions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch(e) { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

const agents = [
  // Wave 1: Core Ops (continuous monitoring)
  {
    id: '01KGXG4SNRAAGWE0F4Z44NXB5S',
    name: 'Sentinel',
    prompt: 'You are starting a 24/7 autonomous shift. First: use ticket_ops with action "list" and filter_assigned_to "Sentinel" to check assigned tickets. Then: check all container health with docker_api action "list", then "stats" for each container. Report any issues as findings with finding_ops. If no tickets assigned, create a status report ticket with ticket_ops. Update all ticket statuses as you work.'
  },
  {
    id: '01KGXG4SVERD6E8BHKVMK6JTBY',
    name: 'Overseer',
    prompt: 'You are starting a 24/7 autonomous shift. First: use ticket_ops with action "list" and filter_assigned_to "Overseer" to check your tickets. Then: query recent executions from forge DB with db_query (SELECT id, agent_id, status, created_at FROM forge_executions ORDER BY created_at DESC LIMIT 20). Check for failing agents. Create and assign tickets to agents that need work using ticket_ops. Report fleet status with finding_ops.'
  },
  {
    id: '01KGXG4SRNPS9XT49VR1N8FSMB',
    name: 'Nightwatch',
    prompt: 'You are starting a 24/7 autonomous shift. First: use ticket_ops with action "list" and filter_assigned_to "Nightwatch" to check your tickets. Run security audit: docker_api action "list" to check containers, docker_api action "inspect" for each, check for exposed ports. Report all security findings with finding_ops (use severity "warning" or "critical"). Update tickets as you work.'
  },
  {
    id: '01KGXG4STMCPSY1F60ZX5TBZFX',
    name: 'Quartermaster',
    prompt: 'You are starting a 24/7 autonomous shift. First: use ticket_ops with action "list" and filter_assigned_to "Quartermaster" to check your tickets. Check database health: use db_query for forge DB (SELECT schemaname, tablename, pg_size_pretty(pg_total_relation_size(schemaname||\'.\'||tablename)) FROM pg_tables WHERE schemaname=\'public\'). Use substrate_db_query for similar on substrate. Report findings with finding_ops. Update tickets.'
  },

  // Wave 2: Dev Agents (build cycle)
  {
    id: '01KGXGV6QBPG0S0VGRY64T7D1W',
    name: 'Architect',
    prompt: 'You are starting a 24/7 autonomous shift. First: use ticket_ops with action "list" and filter_assigned_to "Architect" to check your tickets. Review the shard system by querying substrate DB for shard tables. Design improvements needed. Create implementation tickets assigned to "Backend Dev" and "Frontend Dev". Report architectural findings with finding_ops.'
  },
  {
    id: '01KGXGV6RSSKVXEF8X2S79R3KR',
    name: 'Backend Dev',
    prompt: 'You are starting a 24/7 autonomous shift. First: use ticket_ops with action "list" and filter_assigned_to "Backend Dev" to check your tickets. Pick the highest priority open ticket and update it to in_progress. Investigate the issue using db_query, substrate_db_query, and api_call. When done, update ticket to resolved and create a QA ticket assigned to "QA Engineer" to validate your fix. Report findings.'
  },
  {
    id: '01KGXGV6R7KD6F3WD0MGASRHYY',
    name: 'Frontend Dev',
    prompt: 'You are starting a 24/7 autonomous shift. First: use ticket_ops with action "list" and filter_assigned_to "Frontend Dev" to check your tickets. Pick the highest priority open ticket. Investigate dashboard issues using api_call to test endpoints. When done, update ticket to resolved. Create QA tickets. Report findings.'
  },
  {
    id: '01KGXGV6S74J5BKEZHDJ8Q672K',
    name: 'QA Engineer',
    prompt: 'You are starting a 24/7 autonomous shift. First: use ticket_ops with action "list" and filter_assigned_to "QA Engineer" to check your tickets. Test all API endpoints systematically using api_call. Validate response shapes and status codes. Report bugs as findings with finding_ops severity "warning". Create tickets for "Backend Dev" for any bugs found. Update tickets.'
  },

  // Wave 3: Support Agents
  {
    id: '01KGXGV6SKXJKJMF3K4HQSQ8VB',
    name: 'DevOps',
    prompt: 'You are starting a 24/7 autonomous shift. Check tickets with ticket_ops action "list" filter_assigned_to "DevOps". Monitor container resource usage with docker_api action "stats". Check for memory leaks, high CPU. Report findings with finding_ops. Update tickets.'
  },
  {
    id: '01KGXGV6T1N9RJMHF44MFX6WA3',
    name: 'API Tester',
    prompt: 'You are starting a 24/7 autonomous shift. Check tickets with ticket_ops action "list" filter_assigned_to "API Tester". Test Forge API endpoints: GET /health, GET /api/v1/forge/agents, GET /api/v1/forge/executions using api_call. Check response times and status codes. Report findings. Update tickets.'
  },
  {
    id: '01KGXG4ST1DR9KPM6S4EB56A6G',
    name: 'Concierge',
    prompt: 'You are starting a 24/7 autonomous shift. Check tickets with ticket_ops action "list" filter_assigned_to "Concierge". Monitor user-facing services: use api_call to check dashboard health, API response times, chat endpoints. Report findings. Update tickets.'
  },
  {
    id: '01KGXG4SSG50D7HRJ811F6XZ3X',
    name: 'Librarian',
    prompt: 'You are starting a 24/7 autonomous shift. Check tickets with ticket_ops action "list" filter_assigned_to "Librarian". Audit the knowledge base by querying substrate_db_query for shard tables and content. Identify gaps and quality issues. Report findings. Update tickets.'
  },
  {
    id: '01KGXGV6TD7REMT407ZV7QTSB6',
    name: 'Data Engineer',
    prompt: 'You are starting a 24/7 autonomous shift. Check tickets with ticket_ops action "list" filter_assigned_to "Data Engineer". Analyze database query performance using db_query (pg_stat_statements if available) and substrate_db_query. Check for missing indexes. Report optimization findings. Update tickets.'
  },
  {
    id: '01KGXG4SS55GBA5SRZBVV8E1NR',
    name: 'Forge Smith',
    prompt: 'You are starting a 24/7 autonomous shift. Check tickets with ticket_ops action "list" filter_assigned_to "Forge Smith". Review Forge system health: query forge DB for tool execution stats (SELECT name, COUNT(*) FROM forge_tool_executions GROUP BY name), check provider health. Report findings. Update tickets.'
  },
  {
    id: '01KGXG4SV2ZQH936ZQVJ81JP9M',
    name: 'Herald',
    prompt: 'You are starting a 24/7 autonomous shift. Check tickets with ticket_ops action "list" filter_assigned_to "Herald". Generate a fleet status report: list all recent findings with finding_ops action "list". List all open tickets with ticket_ops action "list" filter_status "open". Summarize everything as a comprehensive finding. Update tickets.'
  },
  {
    id: '01KGXGV6TY5VJ7GAK9JW1T79SZ',
    name: 'Doc Writer',
    prompt: 'You are starting a 24/7 autonomous shift. Check tickets with ticket_ops action "list" filter_assigned_to "Doc Writer". Review API endpoint documentation needs by testing endpoints with api_call. Document undocumented endpoints. Report findings. Update tickets.'
  }
];

async function main() {
  console.log('=== TRIGGERING 24/7 AUTONOMOUS FLEET ===\n');

  let successCount = 0;
  let failCount = 0;

  for (const agent of agents) {
    try {
      const result = await triggerAgent(agent.id, agent.prompt);
      if (result.status === 200 || result.status === 201) {
        console.log(`✓ ${agent.name}: ${result.data?.id || 'started'}`);
        successCount++;
      } else {
        console.log(`✗ ${agent.name}: ${result.status} - ${JSON.stringify(result.data).substring(0, 100)}`);
        failCount++;
      }
    } catch(e) {
      console.log(`✗ ${agent.name}: ERROR - ${e.message}`);
      failCount++;
    }
  }

  console.log(`\n=== FLEET LAUNCH COMPLETE: ${successCount} started, ${failCount} failed ===`);
}

main();
