/**
 * Device Management Routes
 *
 * REST API for managing agent devices connected via the WebSocket bridge.
 * Used by the dashboard Settings page for device management.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { query, queryOne } from '../database.js';
import { authMiddleware } from '../middleware/auth.js';
import {
  listUserDevices,
  getDevice,
  deleteDevice,
  markDeviceOffline,
} from '../runtime/device-registry.js';

export async function deviceRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/forge/devices - List user's devices
   */
  app.get(
    '/api/v1/forge/devices',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
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
   * DELETE /api/v1/forge/devices/:id - Remove a device
   */
  app.delete(
    '/api/v1/forge/devices/:id',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const { id } = request.params as { id: string };

      // Mark offline first (closes WebSocket if connected)
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
      return { total: devices.length, online, busy, offline };
    },
  );
}
