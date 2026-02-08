/**
 * Activity Feed Routes
 * Everything SELF does, visible to the user
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireSelf } from '../middleware/self-auth.js';
import { getActivityFeed, getActivityCount, getActivityById } from '../services/activity-logger.js';
import { handleSSEConnection } from '../services/sse-stream.js';

export async function activityRoutes(app: FastifyInstance): Promise<void> {
  // ---- GET /api/v1/self/activity ----
  // Paginated, filterable activity feed
  app.get('/api/v1/self/activity', {
    preHandler: [requireSelf],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const selfId = request.selfId!;
    const qs = request.query as {
      type?: string;
      integration_id?: string;
      min_importance?: string;
      limit?: string;
      offset?: string;
    };

    const feedQuery: Parameters<typeof getActivityFeed>[0] = {
      selfId,
      limit: qs.limit ? parseInt(qs.limit, 10) : 50,
      offset: qs.offset ? parseInt(qs.offset, 10) : 0,
    };
    if (qs.type) feedQuery.type = qs.type;
    if (qs.integration_id) feedQuery.integrationId = qs.integration_id;
    if (qs.min_importance) feedQuery.minImportance = parseInt(qs.min_importance, 10);

    const countQuery: Parameters<typeof getActivityCount>[0] = { selfId };
    if (qs.type) countQuery.type = qs.type;
    if (qs.integration_id) countQuery.integrationId = qs.integration_id;
    if (qs.min_importance) countQuery.minImportance = parseInt(qs.min_importance, 10);

    const [activities, total] = await Promise.all([
      getActivityFeed(feedQuery),
      getActivityCount(countQuery),
    ]);

    return reply.send({
      activities: activities.map(a => ({
        id: a.id,
        type: a.type,
        title: a.title,
        description: a.body,
        cost: parseFloat(a.cost_usd as unknown as string) || 0,
        importance: a.importance <= 3 ? 'low' : a.importance <= 6 ? 'medium' : 'high',
        createdAt: a.created_at,
        metadata: a.metadata,
      })),
      total,
    });
  });

  // ---- GET /api/v1/self/activity/stream ----
  // SSE real-time stream (Redis pub/sub backed)
  app.get('/api/v1/self/activity/stream', {
    preHandler: [requireSelf],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const selfId = request.selfId!;
    handleSSEConnection(selfId, request, reply);
  });

  // ---- GET /api/v1/self/activity/:id ----
  // Activity detail
  app.get('/api/v1/self/activity/:id', {
    preHandler: [requireSelf],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const selfId = request.selfId!;
    const { id } = request.params as { id: string };

    const activity = await getActivityById(id, selfId);
    if (!activity) {
      return reply.status(404).send({ error: 'Activity not found' });
    }

    return reply.send({
      activity: {
        id: activity.id,
        type: activity.type,
        title: activity.title,
        description: activity.body,
        cost: parseFloat(activity.cost_usd as unknown as string) || 0,
        importance: activity.importance <= 3 ? 'low' : activity.importance <= 6 ? 'medium' : 'high',
        createdAt: activity.created_at,
        metadata: activity.metadata,
        executionId: activity.execution_id,
        integrationId: activity.integration_id,
        approvalId: activity.approval_id,
        tokensUsed: activity.tokens_used,
      },
    });
  });
}
