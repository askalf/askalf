import http from 'http';

const API_KEY = 'fk_a9061ee9b9a863ba4b6c27961cc81d96c6c6c0e2ccee0eca';

function triggerAgent(agentId, prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ agentId, input: prompt });
    const req = http.request({
      host: '127.0.0.1', port: 3005,
      path: '/api/v1/forge/executions',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` }
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
  { id: '01KGXGV6T1N9RJMHF44MFX6WA3', name: 'API Tester', prompt: 'Start 24/7 shift. Check tickets with ticket_ops action "list" filter_assigned_to "API Tester". Test Forge API endpoints with api_call. Report findings. Update tickets.' },
  { id: '01KGXG4ST1DR9KPM6S4EB56A6G', name: 'Concierge', prompt: 'Start 24/7 shift. Check tickets with ticket_ops action "list" filter_assigned_to "Concierge". Monitor user services with api_call. Report findings. Update tickets.' },
  { id: '01KGXG4SSG50D7HRJ811F6XZ3X', name: 'Librarian', prompt: 'Start 24/7 shift. Check tickets with ticket_ops action "list" filter_assigned_to "Librarian". Audit knowledge base with substrate_db_query. Report findings. Update tickets.' },
  { id: '01KGXGV6TD7REMT407ZV7QTSB6', name: 'Data Engineer', prompt: 'Start 24/7 shift. Check tickets with ticket_ops action "list" filter_assigned_to "Data Engineer". Analyze DB performance with db_query and substrate_db_query. Report findings. Update tickets.' },
  { id: '01KGXG4SS55GBA5SRZBVV8E1NR', name: 'Forge Smith', prompt: 'Start 24/7 shift. Check tickets with ticket_ops action "list" filter_assigned_to "Forge Smith". Review Forge system health with db_query. Report findings. Update tickets.' },
  { id: '01KGXG4SV2ZQH936ZQVJ81JP9M', name: 'Herald', prompt: 'Start 24/7 shift. Check tickets with ticket_ops action "list" filter_assigned_to "Herald". Generate fleet status report using finding_ops action "list" and ticket_ops action "list". Report summary. Update tickets.' },
  { id: '01KGXGV6TY5VJ7GAK9JW1T79SZ', name: 'Doc Writer', prompt: 'Start 24/7 shift. Check tickets with ticket_ops action "list" filter_assigned_to "Doc Writer". Review API documentation needs with api_call. Report findings. Update tickets.' },
];

async function main() {
  console.log('=== WAVE 3: Remaining 7 Agents ===\n');
  for (const agent of agents) {
    try {
      const result = await triggerAgent(agent.id, agent.prompt);
      if (result.status === 200 || result.status === 201) {
        console.log(`OK ${agent.name}: ${result.data?.id || 'started'}`);
      } else {
        console.log(`FAIL ${agent.name}: ${result.status} - ${JSON.stringify(result.data).substring(0, 100)}`);
      }
    } catch(e) {
      console.log(`ERR ${agent.name}: ${e.message}`);
    }
  }
}
main();
