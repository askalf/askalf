/**
 * Forge Intelligence MCP Tools
 *
 * Exposes key Forge admin operations via MCP protocol.
 * All tools proxy to Forge REST API using FORGE_URL + FORGE_API_KEY.
 *
 * Tools: forge_checkpoints, forge_capabilities, forge_knowledge_graph,
 *        forge_goals, forge_fleet_intel, forge_memory, forge_cost,
 *        forge_coordination
 */

const FORGE_URL = process.env['FORGE_URL'] ?? 'http://forge:3005';
const FORGE_API_KEY = process.env['FORGE_API_KEY'] ?? '';
const TIMEOUT_MS = 15_000;
const log = (msg: string) => console.log(`[mcp-tools:forge] ${new Date().toISOString()} ${msg}`);

// ============================================
// Tool Definitions
// ============================================

export const TOOLS = [
  {
    name: 'forge_checkpoints',
    description: 'Manage human-in-the-loop checkpoints. List pending checkpoints that need human approval, view details, or respond to them.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'get', 'respond'],
          description: 'Action: list pending checkpoints, get one by ID, or respond to one',
        },
        checkpoint_id: { type: 'string', description: 'Checkpoint ID (for get/respond)' },
        response: { type: 'object', description: 'Response payload (for respond)' },
        status: { type: 'string', enum: ['approved', 'rejected'], description: 'Decision (for respond)' },
        owner_id: { type: 'string', description: 'Filter by owner ID (for list)' },
      },
      required: ['action'],
    },
  },
  {
    name: 'forge_capabilities',
    description: 'Query agent capabilities. Find agents with specific skills, browse the capability catalog, or view a specific agent\'s profile.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        action: {
          type: 'string',
          enum: ['find', 'catalog', 'agent_profile'],
          description: 'Action: find agents by capability, browse catalog, or get agent profile',
        },
        capability: { type: 'string', description: 'Capability name to search for (for find)' },
        min_proficiency: { type: 'number', description: 'Minimum proficiency 0-100 (for find, default 50)' },
        agent_id: { type: 'string', description: 'Agent ID (for agent_profile)' },
      },
      required: ['action'],
    },
  },
  {
    name: 'forge_knowledge_graph',
    description: 'Query the fleet knowledge graph. Traverse node neighborhoods, get graph statistics, or search for entities.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        action: {
          type: 'string',
          enum: ['traverse', 'stats', 'search'],
          description: 'Action: traverse node neighborhood, get stats, or search nodes',
        },
        node_id: { type: 'string', description: 'Node ID to traverse (for traverse)' },
        query: { type: 'string', description: 'Search query (for search)' },
      },
      required: ['action'],
    },
  },
  {
    name: 'forge_goals',
    description: 'Manage agent goals. List proposed/active goals, view details, approve or reject them.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'get', 'approve', 'reject'],
          description: 'Action: list goals, get by ID, approve, or reject',
        },
        goal_id: { type: 'string', description: 'Goal ID (for get/approve/reject)' },
        agent_id: { type: 'string', description: 'Filter by agent ID (for list)' },
        status: { type: 'string', description: 'Filter by status (for list)' },
      },
      required: ['action'],
    },
  },
  {
    name: 'forge_fleet_intel',
    description: 'Fleet intelligence: health status, leaderboard, and overall statistics.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        action: {
          type: 'string',
          enum: ['stats', 'leaderboard', 'health'],
          description: 'Action: fleet stats, agent leaderboard, or monitoring health',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'forge_memory',
    description: 'Search and store fleet memories across all agents. Supports semantic search, tier filtering, and memory storage.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        action: {
          type: 'string',
          enum: ['search', 'recent', 'store'],
          description: 'Action: search memories, get recent, or store new memory',
        },
        query: { type: 'string', description: 'Search query (for search)' },
        tier: { type: 'string', description: 'Memory tier filter: semantic, episodic, procedural, working' },
        agent_id: { type: 'string', description: 'Filter by agent ID' },
        limit: { type: 'number', description: 'Max results (default 20)' },
        content: { type: 'string', description: 'Memory content to store (for store)' },
        metadata: { type: 'object', description: 'Additional metadata (for store)' },
      },
      required: ['action'],
    },
  },
  {
    name: 'forge_cost',
    description: 'Cost analytics: view cost dashboard, get optimal model recommendations, and analyze spending patterns.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        action: {
          type: 'string',
          enum: ['dashboard', 'optimal_model', 'recommend'],
          description: 'Action: cost dashboard, optimal model for task, or cost recommendations',
        },
        task_type: { type: 'string', description: 'Task type for model recommendation (for optimal_model)' },
        complexity: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Task complexity (for optimal_model)' },
      },
      required: ['action'],
    },
  },
  {
    name: 'forge_coordination',
    description: 'Multi-agent coordination: list sessions, view details, create new coordination sessions, or cancel active ones.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'get', 'stats', 'cancel'],
          description: 'Action: list sessions, get by ID, view stats, or cancel',
        },
        session_id: { type: 'string', description: 'Session ID (for get/cancel)' },
      },
      required: ['action'],
    },
  },
];

// ============================================
// Handlers
// ============================================

export async function handleTool(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case 'forge_checkpoints': return handleCheckpoints(args);
    case 'forge_capabilities': return handleCapabilities(args);
    case 'forge_knowledge_graph': return handleKnowledgeGraph(args);
    case 'forge_goals': return handleGoals(args);
    case 'forge_fleet_intel': return handleFleetIntel(args);
    case 'forge_memory': return handleMemory(args);
    case 'forge_cost': return handleCost(args);
    case 'forge_coordination': return handleCoordination(args);
    default: throw new Error(`Unknown forge tool: ${name}`);
  }
}

// ============================================
// Shared fetch helper
// ============================================

async function forgeAdmin(path: string, options?: { method?: string; body?: unknown }): Promise<unknown> {
  const method = options?.method ?? 'GET';
  const url = `${FORGE_URL}/api/v1/admin${path}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${FORGE_API_KEY}`,
      'Accept': 'application/json',
    };
    if (options?.body) headers['Content-Type'] = 'application/json';

    const fetchOpts: RequestInit = { method, headers, signal: controller.signal };
    if (options?.body) fetchOpts.body = JSON.stringify(options.body);

    const response = await fetch(url, fetchOpts);

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return { error: `Forge API HTTP ${response.status}: ${text.slice(0, 300)}` };
    }

    return await response.json();
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { error: `Forge API timed out after ${TIMEOUT_MS}ms` };
    }
    return { error: `Forge API error: ${err instanceof Error ? err.message : String(err)}` };
  } finally {
    clearTimeout(timer);
  }
}

async function forgePublic(path: string, options?: { method?: string; body?: unknown }): Promise<unknown> {
  const method = options?.method ?? 'GET';
  const url = `${FORGE_URL}/api/v1/forge${path}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${FORGE_API_KEY}`,
      'Accept': 'application/json',
    };
    if (options?.body) headers['Content-Type'] = 'application/json';

    const fetchOpts: RequestInit = { method, headers, signal: controller.signal };
    if (options?.body) fetchOpts.body = JSON.stringify(options.body);

    const response = await fetch(url, fetchOpts);

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return { error: `Forge API HTTP ${response.status}: ${text.slice(0, 300)}` };
    }

    return await response.json();
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { error: `Forge API timed out after ${TIMEOUT_MS}ms` };
    }
    return { error: `Forge API error: ${err instanceof Error ? err.message : String(err)}` };
  } finally {
    clearTimeout(timer);
  }
}

// ============================================
// forge_checkpoints
// ============================================

async function handleCheckpoints(args: Record<string, unknown>): Promise<string> {
  const action = String(args['action'] ?? '');
  log(`forge_checkpoints: ${action}`);

  switch (action) {
    case 'list': {
      const params = new URLSearchParams();
      if (args['owner_id']) params.set('owner_id', String(args['owner_id']));
      if (args['status']) params.set('status', String(args['status']));
      const qs = params.toString();
      const result = await forgeAdmin(`/checkpoints${qs ? `?${qs}` : ''}`);
      return JSON.stringify(result);
    }
    case 'get': {
      if (!args['checkpoint_id']) return JSON.stringify({ error: 'checkpoint_id is required' });
      const result = await forgeAdmin(`/checkpoints/${args['checkpoint_id']}`);
      return JSON.stringify(result);
    }
    case 'respond': {
      if (!args['checkpoint_id']) return JSON.stringify({ error: 'checkpoint_id is required' });
      const body: Record<string, unknown> = {};
      if (args['response']) body['response'] = args['response'];
      if (args['status']) body['status'] = args['status'];
      const result = await forgeAdmin(`/checkpoints/${args['checkpoint_id']}/respond`, { method: 'POST', body });
      return JSON.stringify(result);
    }
    default:
      return JSON.stringify({ error: `Unknown action: ${action}. Supported: list, get, respond` });
  }
}

// ============================================
// forge_capabilities
// ============================================

async function handleCapabilities(args: Record<string, unknown>): Promise<string> {
  const action = String(args['action'] ?? '');
  log(`forge_capabilities: ${action}`);

  switch (action) {
    case 'find': {
      const params = new URLSearchParams();
      if (args['capability']) params.set('capability', String(args['capability']));
      if (args['min_proficiency']) params.set('min_proficiency', String(args['min_proficiency']));
      const qs = params.toString();
      // Use the fleet/capabilities endpoint or agents endpoint
      const result = await forgePublic(`/capabilities/find${qs ? `?${qs}` : ''}`);
      return JSON.stringify(result);
    }
    case 'catalog': {
      const result = await forgePublic('/capabilities/catalog');
      return JSON.stringify(result);
    }
    case 'agent_profile': {
      if (!args['agent_id']) return JSON.stringify({ error: 'agent_id is required' });
      const result = await forgePublic(`/capabilities/agent/${args['agent_id']}`);
      return JSON.stringify(result);
    }
    default:
      return JSON.stringify({ error: `Unknown action: ${action}. Supported: find, catalog, agent_profile` });
  }
}

// ============================================
// forge_knowledge_graph
// ============================================

async function handleKnowledgeGraph(args: Record<string, unknown>): Promise<string> {
  const action = String(args['action'] ?? '');
  log(`forge_knowledge_graph: ${action}`);

  switch (action) {
    case 'traverse': {
      if (!args['node_id']) return JSON.stringify({ error: 'node_id is required' });
      const result = await forgeAdmin(`/knowledge/nodes/${args['node_id']}/neighborhood`);
      return JSON.stringify(result);
    }
    case 'stats': {
      const result = await forgeAdmin('/knowledge/stats');
      return JSON.stringify(result);
    }
    case 'search': {
      if (!args['query']) return JSON.stringify({ error: 'query is required' });
      const params = new URLSearchParams({ q: String(args['query']) });
      const result = await forgeAdmin(`/knowledge/search?${params.toString()}`);
      return JSON.stringify(result);
    }
    default:
      return JSON.stringify({ error: `Unknown action: ${action}. Supported: traverse, stats, search` });
  }
}

// ============================================
// forge_goals
// ============================================

async function handleGoals(args: Record<string, unknown>): Promise<string> {
  const action = String(args['action'] ?? '');
  log(`forge_goals: ${action}`);

  switch (action) {
    case 'list': {
      const params = new URLSearchParams();
      if (args['agent_id']) params.set('agent_id', String(args['agent_id']));
      if (args['status']) params.set('status', String(args['status']));
      const qs = params.toString();
      const result = await forgeAdmin(`/goals${qs ? `?${qs}` : ''}`);
      return JSON.stringify(result);
    }
    case 'get': {
      if (!args['goal_id']) return JSON.stringify({ error: 'goal_id is required' });
      const result = await forgeAdmin(`/goals/${args['goal_id']}`);
      return JSON.stringify(result);
    }
    case 'approve': {
      if (!args['goal_id']) return JSON.stringify({ error: 'goal_id is required' });
      const result = await forgeAdmin(`/goals/${args['goal_id']}/approve`, { method: 'POST', body: {} });
      return JSON.stringify(result);
    }
    case 'reject': {
      if (!args['goal_id']) return JSON.stringify({ error: 'goal_id is required' });
      const result = await forgeAdmin(`/goals/${args['goal_id']}/reject`, { method: 'POST', body: {} });
      return JSON.stringify(result);
    }
    default:
      return JSON.stringify({ error: `Unknown action: ${action}. Supported: list, get, approve, reject` });
  }
}

// ============================================
// forge_fleet_intel
// ============================================

async function handleFleetIntel(args: Record<string, unknown>): Promise<string> {
  const action = String(args['action'] ?? '');
  log(`forge_fleet_intel: ${action}`);

  switch (action) {
    case 'stats': {
      const result = await forgePublic('/fleet/stats');
      return JSON.stringify(result);
    }
    case 'leaderboard': {
      const result = await forgeAdmin('/fleet/leaderboard');
      return JSON.stringify(result);
    }
    case 'health': {
      const result = await forgeAdmin('/monitoring/health');
      return JSON.stringify(result);
    }
    default:
      return JSON.stringify({ error: `Unknown action: ${action}. Supported: stats, leaderboard, health` });
  }
}

// ============================================
// forge_memory
// ============================================

async function handleMemory(args: Record<string, unknown>): Promise<string> {
  const action = String(args['action'] ?? '');
  log(`forge_memory: ${action}`);

  switch (action) {
    case 'search': {
      if (!args['query']) return JSON.stringify({ error: 'query is required' });
      const params = new URLSearchParams({ q: String(args['query']) });
      if (args['tier']) params.set('tier', String(args['tier']));
      if (args['agent_id']) params.set('agent_id', String(args['agent_id']));
      if (args['limit']) params.set('limit', String(args['limit']));
      const result = await forgePublic(`/fleet/search?${params.toString()}`);
      return JSON.stringify(result);
    }
    case 'recent': {
      const params = new URLSearchParams();
      if (args['tier']) params.set('tier', String(args['tier']));
      if (args['agent_id']) params.set('agent_id', String(args['agent_id']));
      if (args['limit']) params.set('limit', String(args['limit'] ?? '30'));
      const result = await forgePublic(`/fleet/recent?${params.toString()}`);
      return JSON.stringify(result);
    }
    case 'store': {
      if (!args['content']) return JSON.stringify({ error: 'content is required' });
      const body: Record<string, unknown> = { content: args['content'] };
      if (args['agent_id']) body['agent_id'] = args['agent_id'];
      if (args['tier']) body['tier'] = args['tier'];
      if (args['metadata']) body['metadata'] = args['metadata'];
      const result = await forgeAdmin('/memory/store', { method: 'POST', body });
      return JSON.stringify(result);
    }
    default:
      return JSON.stringify({ error: `Unknown action: ${action}. Supported: search, recent, store` });
  }
}

// ============================================
// forge_cost
// ============================================

async function handleCost(args: Record<string, unknown>): Promise<string> {
  const action = String(args['action'] ?? '');
  log(`forge_cost: ${action}`);

  switch (action) {
    case 'dashboard': {
      const result = await forgeAdmin('/cost/dashboard');
      return JSON.stringify(result);
    }
    case 'optimal_model': {
      const params = new URLSearchParams();
      if (args['task_type']) params.set('task_type', String(args['task_type']));
      if (args['complexity']) params.set('complexity', String(args['complexity']));
      const qs = params.toString();
      const result = await forgeAdmin(`/cost/optimal-model${qs ? `?${qs}` : ''}`);
      return JSON.stringify(result);
    }
    case 'recommend': {
      const result = await forgeAdmin('/cost/recommend', { method: 'POST', body: args });
      return JSON.stringify(result);
    }
    default:
      return JSON.stringify({ error: `Unknown action: ${action}. Supported: dashboard, optimal_model, recommend` });
  }
}

// ============================================
// forge_coordination
// ============================================

async function handleCoordination(args: Record<string, unknown>): Promise<string> {
  const action = String(args['action'] ?? '');
  log(`forge_coordination: ${action}`);

  switch (action) {
    case 'list': {
      const result = await forgeAdmin('/coordination/sessions');
      return JSON.stringify(result);
    }
    case 'get': {
      if (!args['session_id']) return JSON.stringify({ error: 'session_id is required' });
      const result = await forgeAdmin(`/coordination/sessions/${args['session_id']}`);
      return JSON.stringify(result);
    }
    case 'stats': {
      const result = await forgeAdmin('/coordination/stats');
      return JSON.stringify(result);
    }
    case 'cancel': {
      if (!args['session_id']) return JSON.stringify({ error: 'session_id is required' });
      const result = await forgeAdmin(`/coordination/sessions/${args['session_id']}/cancel`, { method: 'POST', body: {} });
      return JSON.stringify(result);
    }
    default:
      return JSON.stringify({ error: `Unknown action: ${action}. Supported: list, get, stats, cancel` });
  }
}
