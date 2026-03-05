<<<<<<< HEAD
const API_KEY = process.env.FORGE_API_KEY;
=======
const API_KEY = process.env.FORGE_API_KEY || '';
>>>>>>> agent/security/01KJXT1TG7VS0HSDEW5SFG7MZA
const FORGE_URL = 'http://forge:3005';

// All 19 available tools and what they do
const ALL_TOOLS = {
  api_call:            'HTTP requests to any URL',
  code_exec:           'Execute code snippets',
  web_browse:          'Fetch/read web pages',
  web_search:          'SearXNG meta search (Google/Bing/DDG)',
  shell_exec:          'Shell commands in workspace',
  file_ops:            'Read/write files in /workspace',
  db_query:            'Query forge database',
  docker_api:          'Docker inspect/logs/stats/exec',
  substrate_db_query:  'Query substrate database',
  ticket_ops:          'Create/manage tickets',
  finding_ops:         'Log findings (info/warning/critical)',
  intervention_ops:    'Request human approval',
  git_ops:             'Git operations on /workspace',
  deploy_ops:          'Restart/build containers',
  security_scan:       'Security analysis on code/configs',
  code_analysis:       'Analyze code structure/patterns',
  agent_call:          'Delegate tasks to other agents',
  memory_search:       'Search agent memory',
  memory_store:        'Store to agent memory',
};

(async () => {
  const res = await fetch(FORGE_URL + '/api/v1/forge/agents?limit=100', {
    headers: { Authorization: 'Bearer ' + API_KEY }
  });
  const { agents } = await res.json();

  for (const a of agents.sort((x, y) => x.name.localeCompare(y.name))) {
    const tools = a.enabled_tools || [];
    const missing = Object.keys(ALL_TOOLS).filter(t => tools.indexOf(t) === -1);
    console.log('========================================');
    console.log('AGENT: ' + a.name);
    console.log('DESC:  ' + (a.description || '(none)'));
    console.log('TOOLS (' + tools.length + '): ' + tools.join(', '));
    console.log('NOT ASSIGNED (' + missing.length + '): ' + missing.join(', '));
    // Extract first ~200 chars of system prompt for role context
    const roleSnippet = a.system_prompt.split('\n').slice(0, 5).join(' ').slice(0, 300);
    console.log('ROLE:  ' + roleSnippet);
    console.log('');
  }
})();
