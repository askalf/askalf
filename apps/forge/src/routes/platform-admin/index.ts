/**
 * Platform Admin — barrel module
 * Registers all admin route sub-modules
 */

import type { FastifyInstance } from 'fastify';
import { registerAgentRoutes } from './agents.js';
import { registerOrchestrationRoutes } from './orchestration.js';
import { registerTicketRoutes } from './tickets.js';
import { registerReportRoutes } from './reports.js';
import { registerTaskRoutes } from './tasks.js';
import { registerMemoryRoutes } from './memory.js';
import { registerCoordinationRoutes } from './coordination.js';
import { registerSchedulingRoutes } from './scheduling.js';
import { registerSystemRoutes } from './system.js';
import { registerCheckpointRoutes } from './checkpoints.js';

export async function platformAdminRoutes(app: FastifyInstance): Promise<void> {
  await registerAgentRoutes(app);
  await registerOrchestrationRoutes(app);
  await registerTicketRoutes(app);
  await registerReportRoutes(app);
  await registerTaskRoutes(app);
  await registerMemoryRoutes(app);
  await registerCoordinationRoutes(app);
  await registerSchedulingRoutes(app);
  await registerSystemRoutes(app);
  await registerCheckpointRoutes(app);
}
