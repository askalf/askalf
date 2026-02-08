/**
 * MCP Bridge
 * Bridges SELF integrations with the MCP client manager.
 * Manages connections to external services (Gmail, Calendar, etc.)
 * via the Model Context Protocol.
 */

import { query, queryOne } from '../database.js';

// ============================================
// MCP Client (Streamable HTTP transport)
// ============================================

export interface MCPToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface MCPToolResult {
  content: unknown;
  isError: boolean;
}

export interface MCPConnection {
  serverId: string;
  provider: string;
  baseUrl: string;
  headers: Record<string, string>;
  tools: MCPToolDefinition[];
  connected: boolean;
}

export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

// Active connections per SELF instance
const connections = new Map<string, Map<string, MCPConnection>>();

/**
 * Connect to an integration's MCP server
 */
export async function connectIntegration(
  selfId: string,
  integrationId: string,
  provider: string,
  config: { baseUrl: string; headers?: Record<string, string> },
): Promise<MCPConnection> {
  const connection: MCPConnection = {
    serverId: integrationId,
    provider,
    baseUrl: config.baseUrl,
    headers: config.headers ?? {},
    tools: [],
    connected: false,
  };

  try {
    // Discover tools via MCP initialize + tools/list
    const initResponse = await fetch(`${config.baseUrl}/mcp/initialize`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...config.headers,
      },
      body: JSON.stringify({
        protocolVersion: '2025-03-26',
        capabilities: { tools: {} },
        clientInfo: { name: 'self-ai', version: '1.0.0' },
      }),
    });

    if (initResponse.ok) {
      // List available tools
      const toolsResponse = await fetch(`${config.baseUrl}/mcp/tools/list`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...config.headers,
        },
        body: JSON.stringify({}),
      });

      if (toolsResponse.ok) {
        const toolsData = await toolsResponse.json() as { tools: MCPToolDefinition[] };
        connection.tools = toolsData.tools ?? [];
      }
    }

    connection.connected = true;
  } catch {
    // Connection failed — mark as connected=false but don't throw
    // The integration status will reflect the error
    connection.connected = false;
  }

  // Store connection
  if (!connections.has(selfId)) {
    connections.set(selfId, new Map());
  }
  connections.get(selfId)!.set(integrationId, connection);

  // Update integration status
  await query(
    `UPDATE self_integrations
     SET status = $1, updated_at = NOW()
     WHERE id = $2`,
    [connection.connected ? 'connected' : 'error', integrationId],
  );

  return connection;
}

/**
 * Call a tool on a connected integration
 */
export async function callTool(
  selfId: string,
  integrationId: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<MCPToolResult> {
  const selfConnections = connections.get(selfId);
  const connection = selfConnections?.get(integrationId);

  if (!connection || !connection.connected) {
    return { content: null, isError: true };
  }

  try {
    const response = await fetch(`${connection.baseUrl}/mcp/tools/call`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...connection.headers,
      },
      body: JSON.stringify({
        name: toolName,
        arguments: args,
      }),
    });

    if (!response.ok) {
      return { content: `HTTP ${response.status}`, isError: true };
    }

    const data = await response.json() as { content: unknown; isError?: boolean };
    return { content: data.content, isError: data.isError ?? false };
  } catch (err) {
    return {
      content: err instanceof Error ? err.message : 'Unknown error',
      isError: true,
    };
  }
}

/**
 * Disconnect from an integration
 */
export function disconnectIntegration(selfId: string, integrationId: string): void {
  const selfConnections = connections.get(selfId);
  if (selfConnections) {
    selfConnections.delete(integrationId);
    if (selfConnections.size === 0) {
      connections.delete(selfId);
    }
  }
}

/**
 * Get all connected integrations for a SELF instance
 */
export function getConnectedIntegrations(selfId: string): MCPConnection[] {
  const selfConnections = connections.get(selfId);
  if (!selfConnections) return [];
  return Array.from(selfConnections.values()).filter(c => c.connected);
}

/**
 * Get available tools across all connected integrations
 */
export function getAllAvailableTools(selfId: string): Array<MCPToolDefinition & { integrationId: string; provider: string }> {
  const selfConnections = connections.get(selfId);
  if (!selfConnections) return [];

  const tools: Array<MCPToolDefinition & { integrationId: string; provider: string }> = [];
  for (const [integrationId, connection] of selfConnections) {
    if (!connection.connected) continue;
    for (const tool of connection.tools) {
      tools.push({ ...tool, integrationId, provider: connection.provider });
    }
  }
  return tools;
}
