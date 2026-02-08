/**
 * MCP Server - Expose Forge as an MCP Server
 * Allows external MCP clients to use forge capabilities as tools.
 *
 * Exposed tools:
 * - create_agent: Create a new forge agent
 * - run_agent: Execute an agent with input
 * - search_memory: Search agent memory
 * - list_agents: List available agents
 */

import { query } from '../database.js';

// ============================================
// Types
// ============================================

export interface ForgeMCPServerOptions {
  /** The name of this MCP server instance */
  name?: string | undefined;
  /** The version string to expose */
  version?: string | undefined;
}

export interface MCPToolHandler {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<MCPToolResponse>;
}

export interface MCPToolResponse {
  content: MCPContentBlock[];
  isError?: boolean | undefined;
}

export interface MCPContentBlock {
  type: 'text';
  text: string;
}

interface AgentRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: string;
  owner_id: string;
  created_at: string;
}

// ============================================
// Tool Definitions
// ============================================

function defineTools(): MCPToolHandler[] {
  return [
    {
      name: 'create_agent',
      description: 'Create a new forge agent with the specified configuration',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Agent name' },
          description: { type: 'string', description: 'Agent description' },
          systemPrompt: { type: 'string', description: 'System prompt for the agent' },
          ownerId: { type: 'string', description: 'Owner ID' },
        },
        required: ['name', 'ownerId'],
      },
      handler: handleCreateAgent,
    },
    {
      name: 'run_agent',
      description: 'Execute a forge agent with the given input text',
      inputSchema: {
        type: 'object',
        properties: {
          agentId: { type: 'string', description: 'The agent ID to run' },
          input: { type: 'string', description: 'Input text for the agent' },
          ownerId: { type: 'string', description: 'Owner ID for authorization' },
        },
        required: ['agentId', 'input', 'ownerId'],
      },
      handler: handleRunAgent,
    },
    {
      name: 'search_memory',
      description: 'Search agent semantic and episodic memory',
      inputSchema: {
        type: 'object',
        properties: {
          agentId: { type: 'string', description: 'Agent whose memory to search' },
          query: { type: 'string', description: 'Search query' },
          memoryType: { type: 'string', description: 'Memory type: semantic, episodic, procedural' },
          limit: { type: 'integer', description: 'Maximum results to return' },
        },
        required: ['agentId', 'query'],
      },
      handler: handleSearchMemory,
    },
    {
      name: 'list_agents',
      description: 'List available forge agents for a given owner',
      inputSchema: {
        type: 'object',
        properties: {
          ownerId: { type: 'string', description: 'Owner ID to list agents for' },
          status: { type: 'string', description: 'Filter by status (draft, active, paused, archived)' },
        },
        required: ['ownerId'],
      },
      handler: handleListAgents,
    },
  ];
}

// ============================================
// Tool Handlers
// ============================================

async function handleCreateAgent(args: Record<string, unknown>): Promise<MCPToolResponse> {
  // TODO: Integrate with actual agent creation service
  // For now, return a stub response indicating the interface works
  const name = args['name'] as string | undefined;
  const ownerId = args['ownerId'] as string | undefined;

  if (!name || !ownerId) {
    return {
      content: [{ type: 'text', text: 'Error: name and ownerId are required' }],
      isError: true,
    };
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        message: 'create_agent stub - agent creation service integration pending',
        requestedName: name,
        ownerId,
      }),
    }],
  };
}

async function handleRunAgent(args: Record<string, unknown>): Promise<MCPToolResponse> {
  // TODO: Integrate with actual execution engine
  const agentId = args['agentId'] as string | undefined;
  const input = args['input'] as string | undefined;
  const ownerId = args['ownerId'] as string | undefined;

  if (!agentId || !input || !ownerId) {
    return {
      content: [{ type: 'text', text: 'Error: agentId, input, and ownerId are required' }],
      isError: true,
    };
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        message: 'run_agent stub - execution engine integration pending',
        agentId,
        inputPreview: input.slice(0, 200),
      }),
    }],
  };
}

async function handleSearchMemory(args: Record<string, unknown>): Promise<MCPToolResponse> {
  // TODO: Integrate with MemoryManager
  const agentId = args['agentId'] as string | undefined;
  const searchQuery = args['query'] as string | undefined;

  if (!agentId || !searchQuery) {
    return {
      content: [{ type: 'text', text: 'Error: agentId and query are required' }],
      isError: true,
    };
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        message: 'search_memory stub - MemoryManager integration pending',
        agentId,
        query: searchQuery,
      }),
    }],
  };
}

async function handleListAgents(args: Record<string, unknown>): Promise<MCPToolResponse> {
  const ownerId = args['ownerId'] as string | undefined;
  const status = args['status'] as string | undefined;

  if (!ownerId) {
    return {
      content: [{ type: 'text', text: 'Error: ownerId is required' }],
      isError: true,
    };
  }

  try {
    let sql = `SELECT id, name, slug, description, status, created_at FROM forge_agents WHERE owner_id = $1`;
    const params: unknown[] = [ownerId];

    if (status) {
      sql += ` AND status = $2`;
      params.push(status);
    }

    sql += ` ORDER BY created_at DESC LIMIT 50`;

    const rows = await query<AgentRow>(sql, params);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          agents: rows.map((row) => ({
            id: row.id,
            name: row.name,
            slug: row.slug,
            description: row.description,
            status: row.status,
            createdAt: row.created_at,
          })),
          total: rows.length,
        }),
      }],
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: 'text', text: `Error listing agents: ${errorMessage}` }],
      isError: true,
    };
  }
}

// ============================================
// MCP Server Class
// ============================================

export class ForgeMCPServer {
  private readonly name: string;
  private readonly version: string;
  private readonly tools: MCPToolHandler[];
  private running: boolean = false;

  constructor(options: ForgeMCPServerOptions = {}) {
    this.name = options.name ?? 'forge';
    this.version = options.version ?? '1.0.0';
    this.tools = defineTools();
  }

  /**
   * Start the MCP server.
   * TODO: Replace with actual @modelcontextprotocol/sdk server setup.
   *
   * The real implementation would look something like:
   *
   * import { Server } from '@modelcontextprotocol/sdk/server/index.js';
   * import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
   *
   * const server = new Server({ name: this.name, version: this.version }, {
   *   capabilities: { tools: {} }
   * });
   *
   * server.setRequestHandler(ListToolsRequestSchema, async () => ({
   *   tools: this.tools.map(t => ({
   *     name: t.name,
   *     description: t.description,
   *     inputSchema: t.inputSchema,
   *   })),
   * }));
   *
   * server.setRequestHandler(CallToolRequestSchema, async (request) => {
   *   const handler = this.tools.find(t => t.name === request.params.name);
   *   if (!handler) throw new Error(`Unknown tool: ${request.params.name}`);
   *   return handler.handler(request.params.arguments ?? {});
   * });
   *
   * const transport = new StdioServerTransport();
   * await server.connect(transport);
   */
  async start(): Promise<void> {
    console.log(`[ForgeMCPServer] Starting MCP server '${this.name}' v${this.version}`);
    console.log(`[ForgeMCPServer] Exposing ${this.tools.length} tools: ${this.tools.map((t) => t.name).join(', ')}`);

    // TODO: Initialize actual MCP server transport and handlers
    this.running = true;

    console.log(`[ForgeMCPServer] MCP server started (stub - awaiting SDK integration)`);
  }

  /**
   * Stop the MCP server and clean up resources.
   */
  async stop(): Promise<void> {
    if (!this.running) return;

    console.log(`[ForgeMCPServer] Stopping MCP server '${this.name}'`);

    // TODO: Close actual MCP server transport
    // await server.close();

    this.running = false;
    console.log(`[ForgeMCPServer] MCP server stopped`);
  }

  /**
   * Get the list of tool definitions this server exposes.
   */
  getToolDefinitions(): Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> {
    return this.tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
  }

  /**
   * Directly invoke a tool handler (useful for testing without MCP transport).
   */
  async invokeTool(toolName: string, args: Record<string, unknown>): Promise<MCPToolResponse> {
    const handler = this.tools.find((t) => t.name === toolName);
    if (!handler) {
      return {
        content: [{ type: 'text', text: `Unknown tool: ${toolName}` }],
        isError: true,
      };
    }
    return handler.handler(args);
  }

  /**
   * Check if the server is currently running.
   */
  isRunning(): boolean {
    return this.running;
  }
}
