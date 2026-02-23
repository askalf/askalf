/**
 * Forge Tool Routes
 * Tool registry and MCP server management
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ulid } from 'ulid';
import { query, queryOne } from '../database.js';
import { authMiddleware } from '../middleware/auth.js';
import { logAudit } from '../observability/audit.js';

interface ToolRow {
  id: string;
  name: string;
  display_name: string;
  description: string;
  type: string;
  risk_level: string;
  input_schema: Record<string, unknown>;
  output_schema: Record<string, unknown>;
  config: Record<string, unknown>;
  is_enabled: boolean;
  requires_approval: boolean;
  created_at: string;
  updated_at: string;
}

interface McpServerRow {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  transport_type: string;
  connection_config: Record<string, unknown>;
  discovered_tools: unknown[];
  health_status: string;
  last_health_check: string | null;
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export async function toolRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/forge/tools - List available tools
   */
  app.get(
    '/api/v1/forge/tools',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const qs = request.query as {
        type?: string;
        enabled?: string;
        limit?: string;
        offset?: string;
      };

      const conditions: string[] = [];
      const params: unknown[] = [];
      let paramIndex = 1;

      if (qs.type) {
        conditions.push(`type = $${paramIndex}`);
        params.push(qs.type);
        paramIndex++;
      }

      if (qs.enabled !== undefined) {
        conditions.push(`is_enabled = $${paramIndex}`);
        params.push(qs.enabled === 'true');
        paramIndex++;
      }

      const limit = Math.max(1, Math.min(parseInt(qs.limit ?? '100', 10) || 100, 200));
      const offset = Math.max(0, parseInt(qs.offset ?? '0', 10) || 0);
      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const tools = await query<ToolRow>(
        `SELECT * FROM forge_tools
         ${whereClause}
         ORDER BY type, name
         LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
        [...params, limit, offset],
      );

      return reply.send({ tools });
    },
  );

  /**
   * POST /api/v1/forge/tools - Register a custom tool
   */
  app.post(
    '/api/v1/forge/tools',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const body = request.body as {
        name: string;
        displayName: string;
        description: string;
        type?: string;
        riskLevel?: string;
        inputSchema?: Record<string, unknown>;
        outputSchema?: Record<string, unknown>;
        config?: Record<string, unknown>;
        requiresApproval?: boolean;
      };

      if (!body.name || !body.displayName || !body.description) {
        return reply.status(400).send({
          error: 'Validation Error',
          message: 'name, displayName, and description are required',
        });
      }

      const VALID_RISK_LEVELS = ['low', 'medium', 'high', 'critical'] as const;
      if (body.riskLevel && !VALID_RISK_LEVELS.includes(body.riskLevel as typeof VALID_RISK_LEVELS[number])) {
        return reply.status(400).send({ error: 'Validation Error', message: 'Invalid riskLevel. Must be low, medium, high, or critical' });
      }

      // Check for name collision
      const existing = await queryOne<{ id: string }>(
        `SELECT id FROM forge_tools WHERE name = $1`,
        [body.name],
      );

      if (existing) {
        return reply.status(409).send({
          error: 'Conflict',
          message: `A tool with name '${body.name}' already exists`,
        });
      }

      const id = ulid();

      const tool = await queryOne<ToolRow>(
        `INSERT INTO forge_tools (id, name, display_name, description, type, risk_level, input_schema, output_schema, config, requires_approval)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          id,
          body.name,
          body.displayName,
          body.description,
          body.type ?? 'custom',
          body.riskLevel ?? 'low',
          JSON.stringify(body.inputSchema ?? {}),
          JSON.stringify(body.outputSchema ?? {}),
          JSON.stringify(body.config ?? {}),
          body.requiresApproval ?? false,
        ],
      );

      void logAudit({
        ownerId: userId,
        action: 'tool.register',
        resourceType: 'tool',
        resourceId: id,
        details: { name: body.name, type: body.type ?? 'custom' },
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      }).catch(() => {});

      return reply.status(201).send({ tool });
    },
  );

  /**
   * POST /api/v1/forge/mcp/servers - Register an MCP server
   */
  app.post(
    '/api/v1/forge/mcp/servers',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const body = request.body as {
        name: string;
        description?: string;
        transportType: string;
        connectionConfig: Record<string, unknown>;
      };

      if (!body.name || !body.transportType || !body.connectionConfig) {
        return reply.status(400).send({
          error: 'Validation Error',
          message: 'name, transportType, and connectionConfig are required',
        });
      }

      const validTransports = ['stdio', 'sse', 'streamable_http'];
      if (!validTransports.includes(body.transportType)) {
        return reply.status(400).send({
          error: 'Validation Error',
          message: `transportType must be one of: ${validTransports.join(', ')}`,
        });
      }

      const id = ulid();

      const server = await queryOne<McpServerRow>(
        `INSERT INTO forge_mcp_servers (id, owner_id, name, description, transport_type, connection_config)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          id,
          userId,
          body.name,
          body.description ?? null,
          body.transportType,
          JSON.stringify(body.connectionConfig),
        ],
      );

      void logAudit({
        ownerId: userId,
        action: 'mcp.server.register',
        resourceType: 'mcp_server',
        resourceId: id,
        details: { name: body.name, transportType: body.transportType },
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      }).catch(() => {});

      return reply.status(201).send({ server });
    },
  );

  /**
   * GET /api/v1/forge/mcp/servers - List MCP servers
   */
  app.get(
    '/api/v1/forge/mcp/servers',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;

      const servers = await query<McpServerRow>(
        `SELECT * FROM forge_mcp_servers
         WHERE owner_id = $1
         ORDER BY created_at DESC`,
        [userId],
      );

      return reply.send({ servers });
    },
  );

  /**
   * POST /api/v1/forge/mcp/servers/:id/discover - Discover tools from an MCP server
   */
  app.post(
    '/api/v1/forge/mcp/servers/:id/discover',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const { id } = request.params as { id: string };

      const server = await queryOne<McpServerRow>(
        `SELECT * FROM forge_mcp_servers WHERE id = $1 AND owner_id = $2`,
        [id, userId],
      );

      if (!server) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'MCP server not found',
        });
      }

      // Connect to the MCP server, discover tools, then disconnect
      const { MCPClientManager } = await import('../tools/mcp-client.js');
      const manager = new MCPClientManager();
      const serverConfig: import('../tools/mcp-client.js').MCPServerConfig = {
        id: server.id,
        name: server.name,
        transportType: server.transport_type as 'stdio' | 'sse' | 'streamable_http',
        connectionConfig: server.connection_config as unknown as import('../tools/mcp-client.js').MCPServerConfig['connectionConfig'],
      };

      let discoveredTools: { name: string; description: string; inputSchema: Record<string, unknown> }[] = [];
      let healthStatus = 'healthy';
      let errorMessage: string | undefined;

      try {
        await manager.connect(serverConfig);
        discoveredTools = await manager.discoverTools(server.id);
      } catch (err) {
        healthStatus = 'unhealthy';
        errorMessage = err instanceof Error ? err.message : String(err);
      } finally {
        await manager.disconnectAll();
      }

      void logAudit({
        ownerId: userId,
        action: 'mcp.server.discover',
        resourceType: 'mcp_server',
        resourceId: id,
        details: { serverName: server.name, toolCount: discoveredTools.length, healthStatus },
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      }).catch(() => {});

      if (errorMessage) {
        return reply.status(502).send({
          error: 'Discovery Failed',
          message: `Failed to discover tools from ${server.name}: ${errorMessage}`,
          serverId: id,
          serverName: server.name,
        });
      }

      return reply.send({
        message: `Discovered ${discoveredTools.length} tools`,
        serverId: id,
        serverName: server.name,
        discoveredTools,
      });
    },
  );
}
