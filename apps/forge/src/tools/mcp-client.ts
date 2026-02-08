/**
 * MCP Client Manager
 * Connects to external MCP (Model Context Protocol) servers,
 * discovers their tools, and proxies tool calls.
 */

import { query } from '../database.js';
import type { ToolResult } from './registry.js';

// ============================================
// Types
// ============================================

export interface MCPServerConfig {
  id: string;
  name: string;
  transportType: 'stdio' | 'sse' | 'streamable_http';
  connectionConfig: StdioConnectionConfig | SSEConnectionConfig | StreamableHttpConnectionConfig;
}

export interface StdioConnectionConfig {
  command: string;
  args: string[];
  env?: Record<string, string> | undefined;
}

export interface SSEConnectionConfig {
  url: string;
  headers?: Record<string, string> | undefined;
}

export interface StreamableHttpConnectionConfig {
  url: string;
  headers?: Record<string, string> | undefined;
}

export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

interface MCPServerConnection {
  config: MCPServerConfig;
  connected: boolean;
  tools: MCPToolDefinition[];
  // TODO: Store actual MCP Client instance here when using @modelcontextprotocol/sdk
  // client: Client | null;
  // transport: Transport | null;
}

interface MCPServerRow {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  transport_type: string;
  connection_config: Record<string, unknown>;
  discovered_tools: MCPToolDefinition[];
  health_status: string;
  is_enabled: boolean;
}

// ============================================
// MCP Client Manager
// ============================================

export class MCPClientManager {
  private readonly connections: Map<string, MCPServerConnection> = new Map();

  /**
   * Connect to an MCP server using the provided configuration.
   * Establishes the transport and initializes the client session.
   */
  async connect(serverConfig: MCPServerConfig): Promise<void> {
    if (this.connections.has(serverConfig.id)) {
      console.warn(`[MCPClient] Already connected to server: ${serverConfig.name} (${serverConfig.id})`);
      return;
    }

    console.log(`[MCPClient] Connecting to MCP server: ${serverConfig.name} (${serverConfig.transportType})`);

    // TODO: Replace with actual @modelcontextprotocol/sdk implementation
    // The real implementation would look something like:
    //
    // import { Client } from '@modelcontextprotocol/sdk/client/index.js';
    // import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
    // import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
    //
    // let transport: Transport;
    // switch (serverConfig.transportType) {
    //   case 'stdio': {
    //     const cfg = serverConfig.connectionConfig as StdioConnectionConfig;
    //     transport = new StdioClientTransport({ command: cfg.command, args: cfg.args, env: cfg.env });
    //     break;
    //   }
    //   case 'sse': {
    //     const cfg = serverConfig.connectionConfig as SSEConnectionConfig;
    //     transport = new SSEClientTransport(new URL(cfg.url), { headers: cfg.headers });
    //     break;
    //   }
    // }
    //
    // const client = new Client({ name: 'forge', version: '1.0.0' }, { capabilities: {} });
    // await client.connect(transport);

    const connection: MCPServerConnection = {
      config: serverConfig,
      connected: true,
      tools: [],
    };

    this.connections.set(serverConfig.id, connection);

    // Update health status in database
    await query(
      `UPDATE forge_mcp_servers SET health_status = 'healthy', last_health_check = NOW() WHERE id = $1`,
      [serverConfig.id],
    );

    console.log(`[MCPClient] Connected to MCP server: ${serverConfig.name}`);
  }

  /**
   * Discover available tools from a connected MCP server.
   * Returns the list of tool definitions the server exposes.
   */
  async discoverTools(serverId: string): Promise<MCPToolDefinition[]> {
    const connection = this.connections.get(serverId);
    if (!connection) {
      throw new Error(`MCP server not connected: ${serverId}`);
    }

    if (!connection.connected) {
      throw new Error(`MCP server is disconnected: ${serverId}`);
    }

    console.log(`[MCPClient] Discovering tools from: ${connection.config.name}`);

    // TODO: Replace with actual @modelcontextprotocol/sdk call
    // const response = await client.listTools();
    // const tools = response.tools.map(t => ({
    //   name: t.name,
    //   description: t.description ?? '',
    //   inputSchema: t.inputSchema as Record<string, unknown>,
    // }));

    // Stub: return empty tools until SDK integration
    const tools: MCPToolDefinition[] = [];
    connection.tools = tools;

    // Persist discovered tools to database
    await query(
      `UPDATE forge_mcp_servers SET discovered_tools = $1, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(tools), serverId],
    );

    console.log(`[MCPClient] Discovered ${tools.length} tools from: ${connection.config.name}`);
    return tools;
  }

  /**
   * Call a tool on an external MCP server.
   */
  async callTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    const startTime = performance.now();
    const connection = this.connections.get(serverId);

    if (!connection) {
      return {
        output: null,
        error: `MCP server not connected: ${serverId}`,
        durationMs: 0,
      };
    }

    if (!connection.connected) {
      return {
        output: null,
        error: `MCP server is disconnected: ${serverId}`,
        durationMs: 0,
      };
    }

    try {
      console.log(`[MCPClient] Calling tool '${toolName}' on server: ${connection.config.name}`);

      // TODO: Replace with actual @modelcontextprotocol/sdk call
      // const result = await client.callTool({ name: toolName, arguments: args });
      // return {
      //   output: result.content,
      //   durationMs: Math.round(performance.now() - startTime),
      // };

      // Stub response until SDK integration
      const durationMs = Math.round(performance.now() - startTime);
      return {
        output: {
          message: `MCP tool '${toolName}' call stub - SDK integration pending`,
          server: connection.config.name,
          args,
        },
        durationMs,
      };
    } catch (err) {
      const durationMs = Math.round(performance.now() - startTime);
      const errorMessage = err instanceof Error ? err.message : String(err);
      return {
        output: null,
        error: `MCP tool call failed: ${errorMessage}`,
        durationMs,
      };
    }
  }

  /**
   * Disconnect from an MCP server and clean up resources.
   */
  async disconnect(serverId: string): Promise<void> {
    const connection = this.connections.get(serverId);
    if (!connection) {
      return;
    }

    console.log(`[MCPClient] Disconnecting from MCP server: ${connection.config.name}`);

    // TODO: Replace with actual @modelcontextprotocol/sdk cleanup
    // await client.close();
    // await transport.close();

    connection.connected = false;
    this.connections.delete(serverId);

    // Update health status
    await query(
      `UPDATE forge_mcp_servers SET health_status = 'unknown', last_health_check = NOW() WHERE id = $1`,
      [serverId],
    );

    console.log(`[MCPClient] Disconnected from MCP server: ${connection.config.name}`);
  }

  /**
   * Disconnect from all connected MCP servers.
   */
  async disconnectAll(): Promise<void> {
    const serverIds = Array.from(this.connections.keys());
    for (const serverId of serverIds) {
      await this.disconnect(serverId);
    }
  }

  /**
   * Check if a server is connected.
   */
  isConnected(serverId: string): boolean {
    const connection = this.connections.get(serverId);
    return connection?.connected === true;
  }

  /**
   * Get the list of connected server IDs.
   */
  getConnectedServers(): string[] {
    return Array.from(this.connections.entries())
      .filter(([_, conn]) => conn.connected)
      .map(([id]) => id);
  }

  /**
   * Load MCP server configurations from the database for a given owner.
   */
  async loadServersFromDatabase(ownerId: string): Promise<MCPServerConfig[]> {
    const rows = await query<MCPServerRow>(
      `SELECT id, name, transport_type, connection_config
       FROM forge_mcp_servers
       WHERE owner_id = $1 AND is_enabled = true
       ORDER BY name`,
      [ownerId],
    );

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      transportType: row.transport_type as MCPServerConfig['transportType'],
      connectionConfig: row.connection_config as unknown as MCPServerConfig['connectionConfig'],
    }));
  }
}
