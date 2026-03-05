// Shared utilities for admin hub routes
import crypto from 'crypto';

export const FORGE_URL = process.env.FORGE_URL || 'http://forge:3005';
export const FORGE_API_KEY = process.env.FORGE_API_KEY || '';

// Circuit breaker: if forge is down, fail fast instead of waiting 30s per request
// Separate breakers for admin and public forge paths so one slow path doesn't kill the other.
const CIRCUIT_RESET_MS = 30_000; // retry after 30s

function makeCircuit() {
  let open = false;
  let openedAt = 0;
  return {
    check() {
      if (!open) return true;
      if (Date.now() - openedAt > CIRCUIT_RESET_MS) {
        open = false; // half-open: allow one attempt
        return true;
      }
      return false;
    },
    trip() { open = true; openedAt = Date.now(); },
    close() { open = false; },
  };
}

const adminCircuit = makeCircuit();
const forgeCircuit = makeCircuit();

// Only trip the circuit on network-level errors (Forge truly unreachable).
// Timeouts mean Forge is alive but slow under load — do NOT trip the circuit.
function isNetworkError(err) {
  if (err.name === 'TimeoutError' || err.name === 'AbortError') return false;
  const code = err.code || '';
  return code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ECONNRESET' ||
    code === 'EHOSTUNREACH' || code === 'ETIMEDOUT' || err.cause?.code === 'ECONNREFUSED';
}

export function ulid() {
  const timestamp = Date.now().toString(36).padStart(10, '0');
  const random = crypto.randomBytes(10).toString('hex').slice(0, 16);
  return (timestamp + random).toUpperCase();
}

// Build pagination response object expected by frontend
export function paginationResponse(total, page, limit) {
  const totalPages = Math.ceil(total / limit) || 1;
  return { page, limit, total, totalPages, hasNext: page < totalPages, hasPrev: page > 1 };
}

// Per-tenant scheduler pause state (Set of user IDs that have paused their scheduler)
export const schedulerPausedTenants = new Set();

export async function callForgeAdmin(path, options = {}) {
  if (!adminCircuit.check()) {
    return { error: true, status: 503, message: 'Forge unreachable (circuit open)' };
  }

  const url = `${FORGE_URL}/api/v1/admin${path}`;
  const headers = {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(FORGE_API_KEY ? { 'Authorization': `Bearer ${FORGE_API_KEY}` } : {}),
    ...options.headers,
  };

  try {
    const res = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(options.timeout || 15000),
    });

    adminCircuit.close();

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { error: true, status: res.status, message: text.substring(0, 200) };
    }

    return await res.json();
  } catch (err) {
    if (isNetworkError(err)) adminCircuit.trip();
    return { error: true, status: 503, message: err.message || 'Forge admin unreachable' };
  }
}

export async function callForge(path, options = {}) {
  if (!forgeCircuit.check()) {
    return { error: true, status: 503, message: 'Forge unreachable (circuit open)' };
  }

  const url = `${FORGE_URL}/api/v1/forge${path}`;
  const headers = {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(FORGE_API_KEY ? { 'Authorization': `Bearer ${FORGE_API_KEY}` } : {}),
    ...options.headers,
  };

  try {
    const res = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(options.timeout || 15000),
    });

    forgeCircuit.close();

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { error: true, status: res.status, message: text || res.statusText };
    }

    return await res.json();
  } catch (err) {
    if (isNetworkError(err)) forgeCircuit.trip();
    return { error: true, status: 503, message: `Forge unreachable: ${err.message}` };
  }
}

// Map Forge agent type metadata to admin type
export function mapAgentType(metadata) {
  const typeMap = {
    development: 'dev',
    dev: 'dev',
    research: 'research',
    support: 'support',
    content: 'content',
    monitoring: 'monitor',
    monitor: 'monitor',
    security: 'security',
  };
  const raw = metadata?.type || '';
  return typeMap[raw.toLowerCase()] || 'custom';
}

// Map Forge agent status to admin status
export function mapAgentStatus(status, isArchived) {
  if (isArchived || status === 'archived') return 'idle';
  if (status === 'paused') return 'paused';
  if (status === 'active' || status === 'draft') return 'idle';
  return 'idle';
}

// Transform a Forge agent to the admin agent shape
export function transformAgent(forgeAgent, executions = [], pendingInterventions = 0) {
  const agentExecs = executions.filter(e => e.agent_id === forgeAgent.id);
  const completed = agentExecs.filter(e => e.status === 'completed');
  const failed = agentExecs.filter(e => e.status === 'failed');
  const running = agentExecs.find(e => e.status === 'running' || e.status === 'pending');
  const lastCompleted = completed.sort((a, b) =>
    new Date(b.completed_at || b.created_at) - new Date(a.completed_at || a.created_at)
  )[0];

  return {
    id: forgeAgent.id,
    name: forgeAgent.name,
    type: mapAgentType(forgeAgent.metadata),
    status: running ? 'running' : mapAgentStatus(forgeAgent.status, forgeAgent.status === 'archived'),
    description: forgeAgent.description || '',
    system_prompt: forgeAgent.system_prompt || '',
    schedule: null,
    config: forgeAgent.provider_config || {},
    autonomy_level: forgeAgent.autonomy_level ?? 2,
    is_decommissioned: forgeAgent.status === 'archived',
    decommissioned_at: forgeAgent.status === 'archived' ? forgeAgent.updated_at : null,
    tasks_completed: completed.length,
    tasks_failed: failed.length,
    current_task: running ? running.id : null,
    last_run_at: lastCompleted?.completed_at || lastCompleted?.created_at || null,
    pending_interventions: pendingInterventions,
    created_at: forgeAgent.created_at,
    updated_at: forgeAgent.updated_at,
  };
}

// Transform a Forge execution to admin task shape
export function transformExecution(exec, agentName = '', agentType = 'custom') {
  return {
    id: exec.id,
    agent_id: exec.agent_id,
    agent_name: agentName,
    agent_type: agentType,
    type: exec.metadata?.task_type || 'execution',
    status: exec.status,
    input: { prompt: exec.input || '' },
    output: exec.output ? { response: exec.output } : null,
    error: exec.error || null,
    started_at: exec.started_at || exec.created_at,
    completed_at: exec.completed_at || null,
    duration_seconds: exec.duration_ms ? Math.round(exec.duration_ms / 1000) : null,
    tokens_used: exec.total_tokens || 0,
    cost: parseFloat(exec.cost || '0'),
    metadata: exec.metadata || {},
    created_at: exec.created_at,
  };
}
