/**
 * MCP Client Manager
 * Connects to external MCP (Model Context Protocol) servers,
 * discovers their tools, and proxies tool calls.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { query } from '../database.js';
import type { ToolResult } from './registry.js';
import {
  CircuitBreaker,
  ExecutionError,
  registerCircuitBreaker,
} from '../runtime/error-handler.js';

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
  client: Client | null;
  transport: StdioClientTransport | SSEClientTransport | null;
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
  private readonly breakers: Map<string, CircuitBreaker> = new Map();

  private getOrCreateBreaker(serverId: string): CircuitBreaker {
    let breaker = this.breakers.get(serverId);
    if (!breaker) {
      breaker = new CircuitBreaker({
        failureThreshold: 5,
        resetTimeoutMs: 30_000,
        halfOpenSuccessThreshold: 2,
      });
      this.breakers.set(serverId, breaker);
      registerCircuitBreaker(`mcp:${serverId}`, breaker);
    }
    return breaker;
  }

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

    let transport: StdioClientTransport | SSEClientTransport;

    switch (serverConfig.transportType) {
      case 'stdio': {
        const cfg = serverConfig.connectionConfig as StdioConnectionConfig;
        transport = new StdioClientTransport({
          command: cfg.command,
          args: cfg.args,
          env: cfg.env,
        });
        break;
      }
      case 'sse': {
        const cfg = serverConfig.connectionConfig as SSEConnectionConfig;
        transport = new SSEClientTransport(new URL(cfg.url));
        break;
      }
      case 'streamable_http': {
        // StreamableHTTPClientTransport requires SDK >= 1.8
        // Fall back to SSE transport which is compatible with most servers
        const cfg = serverConfig.connectionConfig as StreamableHttpConnectionConfig;
        console.warn(`[MCPClient] streamable_http not supported in current SDK, falling back to SSE for: ${serverConfig.name}`);
        transport = new SSEClientTransport(new URL(cfg.url));
        break;
      }
      default:
        throw new Error(`Unsupported transport type: ${serverConfig.transportType}`);
    }

    const client = new Client(
      { name: 'forge', version: '1.0.0' },
      { capabilities: {} },
    );

    try {
      await client.connect(transport);
    } catch (err) {
      // Update health status to reflect failure
      await query(
        `UPDATE forge_mcp_servers SET health_status = 'unhealthy', last_health_check = NOW() WHERE id = $1`,
        [serverConfig.id],
      ).catch(() => {});
      throw new Error(`Failed to connect to MCP server ${serverConfig.name}: ${err instanceof Error ? err.message : String(err)}`);
    }

    const connection: MCPServerConnection = {
      config: serverConfig,
      connected: true,
      tools: [],
      client,
      transport,
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

    if (!connection.connected || !connection.client) {
      throw new Error(`MCP server is disconnected: ${serverId}`);
    }

    console.log(`[MCPClient] Discovering tools from: ${connection.config.name}`);

    const response = await connection.client.listTools();
    const tools: MCPToolDefinition[] = (response.tools ?? []).map((t) => ({
      name: t.name,
      description: t.description ?? '',
      inputSchema: (t.inputSchema ?? {}) as Record<string, unknown>,
    }));

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

    if (!connection.connected || !connection.client) {
      return {
        output: null,
        error: `MCP server is disconnected: ${serverId}`,
        durationMs: 0,
      };
    }

    const breaker = this.getOrCreateBreaker(serverId);

    try {
      const result = await breaker.execute(async () => {
        console.log(`[MCPClient] Calling tool '${toolName}' on server: ${connection.config.name}`);

        // 30s hard timeout via Promise.race
        const timeoutMs = 30_000;
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error(`MCP tool call timed out after ${timeoutMs / 1000}s: ${toolName}`)), timeoutMs);
        });

        return await Promise.race([
          connection.client!.callTool({ name: toolName, arguments: args }),
          timeoutPromise,
        ]);
      });

      // Extract text content from the MCP response
      const textParts = (result.content as Array<{ type: string; text?: string }>)
        .filter((c) => c.type === 'text' && c.text)
        .map((c) => c.text)
        .join('\n');

      const durationMs = Math.round(performance.now() - startTime);
      return {
        output: textParts || result.content,
        durationMs,
      };
    } catch (err) {
      const durationMs = Math.round(performance.now() - startTime);

      // Circuit open → fail fast with structured error
      if (err instanceof ExecutionError && err.code === 'CIRCUIT_OPEN') {
        console.warn(`[MCPClient] Circuit open for server: ${connection.config.name}`);
        return {
          output: null,
          error: `MCP server unreachable (circuit open): ${connection.config.name}`,
          durationMs: 0,
        };
      }

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

    try {
      if (connection.client) {
        await connection.client.close();
      }
    } catch (err) {
      console.warn(`[MCPClient] Error closing client for ${connection.config.name}: ${err instanceof Error ? err.message : String(err)}`);
    }

    connection.connected = false;
    connection.client = null;
    connection.transport = null;
    this.connections.delete(serverId);
    this.breakers.delete(serverId);

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
