// SUBSTRATE v1: Plan Enforcement Middleware
// Enforces usage limits and feature access based on subscription

import type { FastifyRequest, FastifyReply } from 'fastify';
import { checkUsageLimit, tryIncrementUsage, markLimitHit, type UsageType } from '../usage.js';
import { tenantHasFeature, getTenantLimits } from '../subscriptions.js';
import type { PlanFeatures, PlanLimits } from '../plans.js';

/**
 * Error response for limit exceeded
 */
function sendLimitExceeded(
  reply: FastifyReply,
  limitType: string,
  current: number,
  limit: number
): void {
  reply.code(429).send({
    error: 'Limit Exceeded',
    message: `You have reached your ${limitType} limit for today`,
    code: 'LIMIT_EXCEEDED',
    details: {
      limit_type: limitType,
      current,
      limit,
      reset: 'Daily limits reset at midnight UTC',
    },
  });
}

/**
 * Error response for feature not available
 */
function sendFeatureNotAvailable(reply: FastifyReply, feature: string): void {
  reply.code(403).send({
    error: 'Feature Not Available',
    message: `The ${feature} feature is not available on your current plan`,
    code: 'FEATURE_NOT_AVAILABLE',
    details: {
      feature,
      upgrade_url: '/settings/billing',
    },
  });
}

/**
 * Middleware to check and increment usage for a specific type
 * Use this for endpoints that consume metered resources
 */
export function enforceUsageLimit(usageType: UsageType, amount: number = 1) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = request.auth?.tenant_id;

    if (!tenantId) {
      reply.code(401).send({ error: 'Authentication required' });
      return reply;
    }

    const result = await tryIncrementUsage(tenantId, usageType, amount);

    if (!result.success) {
      // Mark that limit was hit for analytics
      if (usageType === 'executions' || usageType === 'api_requests') {
        await markLimitHit(tenantId, usageType === 'executions' ? 'executions' : 'api');
      }

      sendLimitExceeded(reply, usageType, result.current, result.limit);
      return reply;
    }

    // Attach usage info to request for downstream use
    (request as FastifyRequest & { usageInfo?: { current: number; limit: number } }).usageInfo = {
      current: result.current,
      limit: result.limit,
    };
  };
}

/**
 * Middleware to check usage without incrementing
 * Use this when you need to check before a potentially expensive operation
 */
export function checkUsage(usageType: UsageType) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = request.auth?.tenant_id;

    if (!tenantId) {
      reply.code(401).send({ error: 'Authentication required' });
      return reply;
    }

    const result = await checkUsageLimit(tenantId, usageType);

    if (!result.allowed) {
      sendLimitExceeded(reply, usageType, result.current, result.limit);
      return reply;
    }
  };
}

/**
 * Middleware to require a specific feature
 */
export function requireFeature(feature: keyof PlanFeatures) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = request.auth?.tenant_id;

    if (!tenantId) {
      reply.code(401).send({ error: 'Authentication required' });
      return reply;
    }

    const hasFeature = await tenantHasFeature(tenantId, feature);

    if (!hasFeature) {
      sendFeatureNotAvailable(reply, feature);
      return reply;
    }
  };
}

/**
 * Middleware to require multiple features (all must be available)
 */
export function requireFeatures(features: Array<keyof PlanFeatures>) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = request.auth?.tenant_id;

    if (!tenantId) {
      reply.code(401).send({ error: 'Authentication required' });
      return reply;
    }

    for (const feature of features) {
      const hasFeature = await tenantHasFeature(tenantId, feature);
      if (!hasFeature) {
        sendFeatureNotAvailable(reply, feature);
        return reply;
      }
    }
  };
}

/**
 * Middleware to require any of the specified features
 */
export function requireAnyFeature(features: Array<keyof PlanFeatures>) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = request.auth?.tenant_id;

    if (!tenantId) {
      reply.code(401).send({ error: 'Authentication required' });
      return reply;
    }

    for (const feature of features) {
      const hasFeature = await tenantHasFeature(tenantId, feature);
      if (hasFeature) {
        return; // Has at least one feature, allow
      }
    }

    // None of the features available
    sendFeatureNotAvailable(reply, features.join(' or '));
    return reply;
  };
}

/**
 * Middleware to attach plan limits to request
 * Useful when you need to check multiple limits in the handler
 */
export function attachPlanLimits() {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = request.auth?.tenant_id;

    if (!tenantId) {
      return; // Don't fail, just don't attach limits
    }

    const limits = await getTenantLimits(tenantId);
    (request as FastifyRequest & { planLimits?: PlanLimits }).planLimits = limits;
  };
}

/**
 * Middleware for MCP access (requires mcp_access feature)
 */
export function requireMcpAccess() {
  return requireFeature('mcp_access');
}

/**
 * Middleware for API access (requires api_access feature)
 */
export function requireApiAccess() {
  return requireFeature('api_access');
}

/**
 * Middleware for private shards (requires private_shards feature)
 */
export function requirePrivateShards() {
  return requireFeature('private_shards');
}

/**
 * Middleware for team management (requires team_management feature)
 */
export function requireTeamManagement() {
  return requireFeature('team_management');
}

/**
 * Rate limiting per minute for MCP requests
 * Uses Redis for distributed rate limiting when available
 */
export function enforceMcpRateLimit() {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = request.auth?.tenant_id;

    if (!tenantId) {
      reply.code(401).send({ error: 'Authentication required' });
      return reply;
    }

    // Check MCP feature access first
    const hasMcp = await tenantHasFeature(tenantId, 'mcp_access');
    if (!hasMcp) {
      sendFeatureNotAvailable(reply, 'mcp_access');
      return reply;
    }

    // For now, use simple database-based rate limiting
    // In production, this should use Redis for better performance
    const result = await tryIncrementUsage(tenantId, 'mcp_requests', 1);

    if (!result.success) {
      reply.code(429).send({
        error: 'Rate Limit Exceeded',
        message: 'MCP request rate limit exceeded',
        code: 'RATE_LIMIT_EXCEEDED',
        details: {
          limit: result.limit,
          reset: 'Rate limits reset every minute',
        },
      });
      return reply;
    }
  };
}

/**
 * Composite middleware for execution endpoints
 * Checks auth, API access feature, and execution limits
 */
export function enforceExecutionAccess() {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = request.auth?.tenant_id;

    if (!tenantId) {
      reply.code(401).send({ error: 'Authentication required' });
      return reply;
    }

    // Check API access
    const hasApi = await tenantHasFeature(tenantId, 'api_access');
    if (!hasApi) {
      sendFeatureNotAvailable(reply, 'api_access');
      return reply;
    }

    // Check and increment execution limit
    const result = await tryIncrementUsage(tenantId, 'executions', 1);
    if (!result.success) {
      await markLimitHit(tenantId, 'executions');
      sendLimitExceeded(reply, 'executions', result.current, result.limit);
      return reply;
    }
  };
}

/**
 * Composite middleware for trace ingestion
 */
export function enforceTraceIngestion() {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = request.auth?.tenant_id;

    if (!tenantId) {
      reply.code(401).send({ error: 'Authentication required' });
      return reply;
    }

    // Check and increment trace limit
    const result = await tryIncrementUsage(tenantId, 'traces_ingested', 1);
    if (!result.success) {
      sendLimitExceeded(reply, 'traces', result.current, result.limit);
      return reply;
    }
  };
}
