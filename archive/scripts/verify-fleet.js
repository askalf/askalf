const API_KEY = 'fk_a9061ee9b9a863ba4b6c27961cc81d96c6c6c0e2ccee0eca';
const FORGE_URL = 'http://forge:3005';

(async () => {
  const res = await fetch(FORGE_URL + '/api/v1/forge/agents?limit=100', {
    headers: { Authorization: 'Bearer ' + API_KEY }
  });
  const { agents } = await res.json();

  console.log('=== FINAL AGENT FLEET VERIFICATION ===\n');
  let allGood = true;
  for (const a of agents.sort((x,y) => x.name.localeCompare(y.name))) {
    const tools = a.enabled_tools || [];
    const p = a.system_prompt;
    const hasToolSection = p.includes('Your Tools');
    const hasGating = p.includes('Gating Rules');
    const hasEdgeCases = p.includes('Edge Case Handling');
    const ws = tools.includes('web_search') ? 'Y' : '-';
    const ac = tools.includes('agent_call') ? 'Y' : '-';
    const issues = [];

    if (hasEdgeCases === false) issues.push('MISSING edge cases');

    const status = issues.length === 0 ? 'OK' : 'ISSUE';
    if (issues.length > 0) allGood = false;

    console.log(
      status.padEnd(6) +
      a.name.padEnd(18) +
      'tools=' + String(tools.length).padEnd(3) +
      ' tools_doc=' + (hasToolSection ? 'Y' : '-') +
      ' gating=' + (hasGating ? 'Y' : '-') +
      ' edge=' + (hasEdgeCases ? 'Y' : '-') +
      ' ws=' + ws + ' ac=' + ac +
      (issues.length > 0 ? '  << ' + issues.join(', ') : '')
    );
  }
  console.log(allGood ? '\nAll agents verified OK' : '\nSome agents have issues');
})();
