/**
 * Device Management Routes
 *
 * REST API for managing agent devices — both WebSocket-connected and server-managed.
 * Supports all device types: CLI, Docker, SSH, K8s, Browser, Desktop, VS Code,
 * Android, iOS, Raspberry Pi, Arduino/ESP32, Home Assistant.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware } from '../middleware/auth.js';
import {
  listUserDevices,
  getDevice,
  deleteDevice,
  markDeviceOffline,
  registerServerDevice,
  updateDeviceConfig,
  type DeviceType,
} from '../runtime/device-registry.js';
import { getAdapter } from '../runtime/adapters/adapter-registry.js';

export async function deviceRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/forge/devices - List user's devices
   */
  app.get(
    '/api/v1/forge/devices',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest) => {
      const userId = request.userId!;
      const devices = await listUserDevices(userId);
      return { devices };
    },
  );

  /**
   * GET /api/v1/forge/devices/:id - Get device details
   */
  app.get(
    '/api/v1/forge/devices/:id',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const { id } = request.params as { id: string };

      const device = await getDevice(id);
      if (!device || device.user_id !== userId) {
        return reply.code(404).send({ error: 'Device not found' });
      }
      return { device };
    },
  );

  /**
   * POST /api/v1/forge/devices - Register a server-managed device (Docker, SSH, K8s, HA)
   */
  app.post(
    '/api/v1/forge/devices',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const tenantId = (request as unknown as Record<string, unknown>)['tenantId'] as string || userId;
      const body = request.body as {
        deviceName: string;
        deviceType: DeviceType;
        connectionConfig?: Record<string, unknown>;
        hostname?: string;
      };

      if (!body.deviceName || !body.deviceType) {
        return reply.code(400).send({ error: 'deviceName and deviceType are required' });
      }

      const serverTypes = ['docker', 'ssh', 'k8s', 'homeassistant'];
      if (!serverTypes.includes(body.deviceType)) {
        return reply.code(400).send({ error: `Server-managed registration only for: ${serverTypes.join(', ')}. Other types connect via WebSocket.` });
      }

      const adapter = getAdapter(body.deviceType);
      if (!adapter) {
        return reply.code(400).send({ error: `Unknown device type: ${body.deviceType}` });
      }

      const categoryMap: Record<string, string> = {
        docker: 'compute', ssh: 'compute', k8s: 'compute', homeassistant: 'iot',
      };

      try {
        const device = await registerServerDevice({
          userId,
          tenantId,
          apiKeyId: 'server-managed',
          deviceName: body.deviceName,
          hostname: body.hostname,
          deviceType: body.deviceType,
          deviceCategory: (categoryMap[body.deviceType] || 'compute') as 'compute',
          connectionConfig: body.connectionConfig,
          maxConcurrentTasks: adapter.maxConcurrency,
          protocol: adapter.protocol,
          capabilities: adapter.defaultCapabilities(),
        });
        return { device };
      } catch (err) {
        return reply.code(400).send({ error: err instanceof Error ? err.message : 'Registration failed' });
      }
    },
  );

  /**
   * PUT /api/v1/forge/devices/:id/config - Update device connection config
   */
  app.put(
    '/api/v1/forge/devices/:id/config',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const { id } = request.params as { id: string };
      const body = request.body as { connectionConfig: Record<string, unknown> };

      if (!body.connectionConfig) {
        return reply.code(400).send({ error: 'connectionConfig is required' });
      }

      const device = await updateDeviceConfig(id, userId, body.connectionConfig);
      if (!device) {
        return reply.code(404).send({ error: 'Device not found' });
      }
      return { device };
    },
  );

  /**
   * POST /api/v1/forge/devices/:id/test - Test device connectivity
   */
  app.post(
    '/api/v1/forge/devices/:id/test',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const { id } = request.params as { id: string };

      const device = await getDevice(id);
      if (!device || device.user_id !== userId) {
        return reply.code(404).send({ error: 'Device not found' });
      }

      const adapter = getAdapter(device.device_type as DeviceType);
      if (!adapter) {
        return reply.code(400).send({ error: `No adapter for device type: ${device.device_type}` });
      }

      const result = await adapter.testConnection(device.connection_config as Record<string, unknown>);
      return result;
    },
  );

  /**
   * DELETE /api/v1/forge/devices/:id - Remove a device
   */
  app.delete(
    '/api/v1/forge/devices/:id',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const { id } = request.params as { id: string };

      const device = await getDevice(id);
      if (device) {
        // Clean up adapter resources
        const adapter = getAdapter(device.device_type as DeviceType);
        if (adapter) {
          await adapter.cleanup(id, device.connection_config as Record<string, unknown>).catch(() => {});
        }
      }

      await markDeviceOffline(id);
      const deleted = await deleteDevice(id, userId);
      if (!deleted) {
        return reply.code(404).send({ error: 'Device not found' });
      }
      return { deleted: true };
    },
  );

  /**
   * POST /api/v1/forge/devices/:id/disconnect - Force disconnect a device
   */
  app.post(
    '/api/v1/forge/devices/:id/disconnect',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const { id } = request.params as { id: string };

      const device = await getDevice(id);
      if (!device || device.user_id !== userId) {
        return reply.code(404).send({ error: 'Device not found' });
      }

      await markDeviceOffline(id);
      return { disconnected: true };
    },
  );

  /**
   * GET /api/v1/forge/devices/summary - Get device summary for current user
   */
  app.get(
    '/api/v1/forge/devices/summary',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest) => {
      const userId = request.userId!;
      const devices = await listUserDevices(userId);
      const online = devices.filter(d => d.status === 'online').length;
      const busy = devices.filter(d => d.status === 'busy').length;
      const offline = devices.filter(d => d.status === 'offline').length;
      const byType: Record<string, number> = {};
      for (const d of devices) {
        const t = d.device_type || 'cli';
        byType[t] = (byType[t] || 0) + 1;
      }
      return { total: devices.length, online, busy, offline, byType };
    },
  );
}
