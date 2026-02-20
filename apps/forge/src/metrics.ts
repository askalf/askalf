/**
 * Forge Prometheus Metrics
 * Centralized metric definitions to avoid circular imports.
 * All modules import from here instead of index.ts.
 */

import {
  createCounter,
  createGauge,
  createHistogram,
} from '@substrate/observability';

export const forgeExecutionsTotal = createCounter('forge_executions_total', 'Total agent executions started');
export const forgeExecutionDuration = createHistogram('forge_execution_duration_ms', 'Agent execution duration in milliseconds');
export const forgeActiveAgents = createGauge('forge_active_agents', 'Number of active agents');
export const forgeToolCalls = createCounter('forge_tool_calls_total', 'Total tool calls across all executions');
export const forgeMcpConnections = createGauge('forge_mcp_connections', 'Active MCP SSE connections');
