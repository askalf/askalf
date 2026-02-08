/**
 * Integration Routes
 * Connect/disconnect services, manage permissions
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireSelf } from '../middleware/self-auth.js';
import {
  getAvailableIntegrations,
  listIntegrations,
  connectIntegration,
  disconnectIntegration,
  updateIntegrationPermissions,
} from '../services/integration-manager.js';
import { logActivity } from '../services/activity-logger.js';

export async function integrationRoutes(app: FastifyInstance): Promise<void> {
  // ---- GET /api/v1/self/integrations/available ----
  app.get('/api/v1/self/integrations/available', {
    preHandler: [requireSelf],
  }, async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({ integrations: getAvailableIntegrations() });
  });

  // ---- GET /api/v1/self/integrations ----
  app.get('/api/v1/self/integrations', {
    preHandler: [requireSelf],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const integrations = await listIntegrations(request.selfId!);
    return reply.send({ integrations });
  });

  // ---- POST /api/v1/self/integrations ----
  app.post('/api/v1/self/integrations', {
    preHandler: [requireSelf],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { provider?: string } | undefined;
    if (!body?.provider) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'provider is required',
      });
    }

    try {
      const result = await connectIntegration({
        selfId: request.selfId!,
        userId: request.userId!,
        provider: body.provider,
      });

      await logActivity({
        selfId: request.selfId!,
        userId: request.userId!,
        type: 'integration',
        title: `Connecting ${body.provider}`,
        body: `Initiated connection to ${body.provider}`,
        integrationId: result.integrationId,
        importance: 6,
      });

      return reply.status(201).send(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(400).send({ error: 'Bad Request', message });
    }
  });

  // ---- DELETE /api/v1/self/integrations/:id ----
  app.delete('/api/v1/self/integrations/:id', {
    preHandler: [requireSelf],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const success = await disconnectIntegration(id, request.selfId!);

    if (!success) {
      return reply.status(404).send({ error: 'Integration not found' });
    }

    await logActivity({
      selfId: request.selfId!,
      userId: request.userId!,
      type: 'integration',
      title: 'Integration disconnected',
      integrationId: id,
      importance: 6,
    });

    return reply.send({ status: 'disconnected' });
  });

  // ---- PATCH /api/v1/self/integrations/:id/permissions ----
  app.patch('/api/v1/self/integrations/:id/permissions', {
    preHandler: [requireSelf],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      allowed_actions?: string[];
      blocked_actions?: string[];
    } | undefined;

    const success = await updateIntegrationPermissions(
      id,
      request.selfId!,
      body?.allowed_actions,
      body?.blocked_actions,
    );

    if (!success) {
      return reply.status(404).send({ error: 'Integration not found' });
    }

    return reply.send({ status: 'updated' });
  });
}
