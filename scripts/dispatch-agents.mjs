// Dispatch agents that have open tickets assigned to them
const FORGE_URL = process.env.FORGE_URL || 'http://forge:3005';
const KEY = process.env.FORGE_API_KEY || '';

async function callForge(path, opts = {}) {
  const r = await fetch(FORGE_URL + '/api/v1/forge' + path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(KEY ? { 'Authorization': 'Bearer ' + KEY } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return r.json();
}

const targetAgents = ['Librarian', 'API Tester', 'Doc Writer', 'QA Engineer', 'Herald', 'Data Engineer', 'DevOps', 'Architect', 'Frontend Dev', 'Overseer'];

const agentsRes = await callForge('/agents?limit=50');
const agents = agentsRes.agents || [];

let started = 0;
for (const name of targetAgents) {
  const agent = agents.find(a => a.name === name && a.status === 'active');
  if (!agent) { console.log(name, '-> not found/inactive'); continue; }

  const running = await callForge('/executions?agentId=' + agent.id + '&status=running&limit=1');
  const pending = await callForge('/executions?agentId=' + agent.id + '&status=pending&limit=1');
  if ((running.executions || []).length > 0 || (pending.executions || []).length > 0) {
    console.log(name, '-> already running, skip');
    continue;
  }

  const input = `[TICKET DISPATCH - ${new Date().toISOString()}] You are ${name}. You have open tickets assigned to you. Work them now.

COST RULE: Be efficient. Work your assigned tickets, then stop.

WORKFLOW:
1. CHECK: ticket_ops action=list filter_assigned_to=${name} filter_status=open
2. START each ticket: ticket_ops action=update ticket_id=ID status=in_progress
3. DO THE WORK using your tools
4. RESOLVE: ticket_ops action=update ticket_id=ID status=resolved resolution="Detailed summary"
5. Stop when all tickets are handled.`;

  const res = await callForge('/executions', {
    method: 'POST',
    body: {
      agentId: agent.id,
      input,
      metadata: { trigger: 'manual_dispatch', batch: false },
    },
  });

  if (res.error) {
    console.log(name, '-> FAIL:', (res.message || '').slice(0, 80));
  } else {
    console.log(name, '-> started', (res.execution?.id || '').slice(0, 12));
    started++;
  }
}
console.log('---');
console.log('Started ' + started + ' of ' + targetAgents.length + ' agents');
