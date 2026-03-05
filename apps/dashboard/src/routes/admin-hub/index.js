// Admin Hub — barrel module
// Registers all admin route sub-modules

import { registerAgentRoutes } from './agents.js';
import { registerTaskRoutes } from './tasks.js';
import { registerReportRoutes } from './reports.js';
import { registerTicketRoutes } from './tickets.js';
import { registerProxyRoutes } from './proxy.js';
import { registerSchedulerRoutes } from './scheduler.js';
import { registerChatRoutes } from './chat.js';

export async function registerAdminHubRoutes(fastify, requireAdmin, requireUser, query, queryOne) {
  await registerAgentRoutes(fastify, requireAdmin, requireUser, query, queryOne);
  await registerTaskRoutes(fastify, requireAdmin, query, queryOne);
  await registerReportRoutes(fastify, requireAdmin, query, queryOne);
  await registerTicketRoutes(fastify, requireAdmin, query, queryOne);
  await registerProxyRoutes(fastify, requireAdmin, requireUser, query, queryOne);
  await registerSchedulerRoutes(fastify, requireAdmin, requireUser, query, queryOne);
  await registerChatRoutes(fastify, requireAdmin, query, queryOne);
}
