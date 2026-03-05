// Centralized API layer for the Orchestration Hub
// Maps all 28 admin-hub.js endpoints

const getApiBase = () => {
  const host = window.location.hostname;
  // Production: same-origin (nginx routes to dashboard)
  if (host.includes('askalf.org') || host.includes('integration.tax') || host.includes('amnesia.tax')) return '';
  // Local dev: dashboard proxy on port 3001 (not forge directly)
  return 'http://localhost:3001';
};

const API_BASE = getApiBase();

async function apiFetch<T = unknown>(path: string, options?: RequestInit): Promise<T> {
  const maxRetries = options?.method && options.method !== 'GET' ? 0 : 2;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        credentials: 'include',
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...options?.headers,
        },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || res.statusText);
      }
      // Guard against non-JSON responses (e.g. nginx error pages during restarts)
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        const text = await res.text().catch(() => '');
        throw new Error(`Expected JSON but got ${contentType}: ${text.slice(0, 200)}`);
      }
      return res.json();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries) {
        // Wait before retry (2s, 4s) — handles forge restarts
        await new Promise(r => setTimeout(r, (attempt + 1) * 2000));
      }
    }
  }
  throw lastError!;
}

function buildParams(obj: Record<string, string | number | boolean | undefined | null>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  }
  return params.toString();
}

// ============================
// Type definitions
// ============================

export interface Agent {
  id: string;
  name: string;
  type: 'dev' | 'research' | 'support' | 'content' | 'monitor' | 'security' | 'custom';
  status: 'idle' | 'running' | 'paused' | 'error';
  description: string;
  system_prompt: string;
  schedule: string | null;
  config: Record<string, unknown>;
  enabled_tools: string[];
  autonomy_level: number;
  is_decommissioned: boolean;
  decommissioned_at: string | null;
  created_at: string;
  updated_at: string;
  last_run_at: string | null;
  tasks_completed: number;
  tasks_failed: number;
  current_task: string | null;
  pending_interventions: number;
}

export interface AgentLog {
  id: string;
  level: string;
  message: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface AgentTask {
  id: string;
  type: string;
  status: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  error: string | null;
  started_at: string;
  completed_at: string | null;
  created_at: string;
}

export interface KnowledgeNode {
  id: string;
  agent_id: string | null;
  agent_name?: string;
  label: string;
  entity_type: string;
  description: string | null;
  properties: Record<string, unknown>;
  mention_count: number;
  last_mentioned: string;
  created_at: string;
  edge_count?: number;
}

export interface KnowledgeEdge {
  id: string;
  source_id: string;
  target_id: string;
  relation: string;
  weight: number;
  properties: Record<string, unknown>;
  created_at: string;
  source_label?: string;
  target_label?: string;
}

export interface Intervention {
  id: string;
  agent_id: string;
  agent_name: string;
  agent_type: string;
  task_id: string | null;
  type: string;
  title: string;
  description: string;
  context: Record<string, unknown>;
  proposed_action: string;
  status: string;
  human_response: string | null;
  autonomy_delta: number;
  created_at: string;
}

export interface OrchestrationStats {
  agents: {
    total: number;
    active: number;
    running: number;
    decommissioned: number;
    avgAutonomy: number;
  };
  pendingInterventions: number;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface Task {
  id: string;
  agent_id: string;
  agent_name: string;
  agent_type: string;
  type: string;
  status: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  parent_task_id?: string | null;
  handoff_to_agent_id?: string | null;
  handoff_to_agent_name?: string | null;
  duration_seconds?: number | null;
  tokens_used?: number;
  cost?: number;
  metadata?: Record<string, unknown>;
}

export interface TaskStats {
  totals: {
    total: number;
    pending: number;
    in_progress: number;
    completed: number;
    failed: number;
    handoffs: number;
  };
  recentByAgent: Array<{
    agent_name: string;
    task_count: string;
    success_rate: string;
  }>;
}

export interface Ticket {
  id: string;
  title: string;
  description: string;
  status: 'open' | 'in_progress' | 'resolved';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  category: string;
  created_by: string;
  assigned_to?: string;
  agent_id?: string;
  agent_name?: string;
  is_agent_ticket?: boolean;
  source?: string;
  resolution?: string | null;
  task?: { id: string; status: string; type: string; started_at: string | null; completed_at: string | null } | null;
  created_at: string;
  updated_at: string;
}

export interface TicketNote {
  id: string;
  ticket_id: string;
  author: string;
  content: string;
  created_at: string;
}

export interface AgentActivity {
  id: string;
  agent_name: string;
  agent_type: string;
  task_type: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  duration_seconds: number | null;
  has_interventions: boolean;
}

export interface AgentPerformanceEntry {
  agentId: string;
  agentName: string;
  totalExecutions: number;
  completed: number;
  failed: number;
  cancelled: number;
  successRate: number;
  failureRate: number;
  avgDurationMs: number;
  totalCost: number;
  ticketsCompleted: number;
}

export interface AgentPerformanceReport {
  days: number;
  fleet: {
    totalExecutions: number;
    successRate: number;
    failureRate: number;
    totalCost: number;
  };
  agents: AgentPerformanceEntry[];
}

export interface SystemMetrics {
  users: { total: number; active_24h: number; new_7d: number };
  shards: { total: number; high_confidence: number; success_rate: number };
  chat: { sessions: number; messages: number; avg_per_session: number };
  agents: { total: number; running: number; tasks_today: number; interventions_pending: number };
  tickets: { total: number; open: number; agent_created: number };
  database: { tables: number; size: string };
}

export interface AgentSchedule {
  id: string;
  name: string;
  type: string;
  schedule_type: 'manual' | 'scheduled' | 'continuous';
  schedule_interval_minutes: number | null;
  next_run_at: string | null;
  is_continuous: boolean;
  execution_mode: 'batch' | 'individual' | 'cli';
  model_id: string | null;
  status: string;
  last_run_at: string | null;
}

export interface RecentFinding {
  id: string;
  agent_id: string;
  agent_name: string;
  finding: string;
  severity: 'info' | 'warning' | 'critical';
  category: string | null;
  execution_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface ReportFeedItem {
  id: string;
  type: 'finding' | 'resolution';
  severity: 'info' | 'warning' | 'critical';
  category: string | null;
  agent_name: string;
  content: string;
  sort_date: string;
  created_at: string;
  metadata: Record<string, unknown>;
  execution_id: string | null;
  agent_id: string | null;
  title: string | null;
  description: string | null;
  notes?: TicketNote[];
}

export interface FleetMemoryStats {
  tiers: { semantic: number; episodic: number; procedural: number };
  total: number;
  recent24h: { semantic: number; episodic: number; procedural: number };
  recalls24h: number;
}

export interface FleetRecallEvent {
  executionId: string;
  agentId: string;
  agentName: string;
  memoriesCount: number;
  runtimeMode: string;
  timestamp: string;
}

export interface FleetMemoryItem {
  id: string;
  tier: 'semantic' | 'episodic' | 'procedural';
  agent_id: string;
  agent_name?: string;
  content?: string;
  preview?: string;
  score: number;
  created_at: string;
  metadata?: {
    source_type?: 'execution' | 'finding' | 'ticket' | 'agent_store';
    source_id?: string;
    severity?: string;
    category?: string;
    tokens_used?: number;
    cost?: number;
    duration_ms?: number;
    iterations?: number;
    error?: string;
    assigned_to?: string;
    priority?: string;
    agent_name?: string;
    finding_id?: string;
    [key: string]: unknown;
  };
  // Episodic-specific
  situation?: string;
  action?: string;
  outcome?: string;
  outcome_quality?: number;
  // Procedural-specific
  trigger_pattern?: string;
  tool_sequence?: unknown[];
  confidence?: number;
}

export interface SchedulerStatus {
  running: boolean;
  nextScheduledAgents: Array<{ name: string; next_run_at: string | null; schedule_type: string }>;
  continuousAgents: Array<{ name: string; status: string }>;
}

export interface TaskDetail {
  task: Task;
  logs: AgentLog[];
  childTasks: Array<{ id: string; agent_name: string; type: string; status: string; created_at: string }>;
  interventions: Array<{ id: string; type: string; title: string; status: string; created_at: string }>;
}

export interface AgentDetail {
  agent: Agent;
  logs: AgentLog[];
  tasks: AgentTask[];
}

export interface ContentFeedItem {
  id: string;
  source: 'execution' | 'finding' | 'resolution';
  agent_name: string;
  content: string;
  input: string;
  tokens: number;
  cost: number;
  duration_ms: number;
  sort_date: string;
  created_at: string;
  severity?: 'info' | 'warning' | 'critical';
  category?: string;
  execution_id?: string | null;
  metadata?: Record<string, unknown>;
  title?: string | null;
  description?: string | null;
  notes?: TicketNote[];
}

export interface DocumentItem {
  id: string;
  agent_id: string;
  agent_name: string;
  agent_type: string;
  input: string;
  preview: string;
  tokens: number;
  cost: number;
  duration_ms: number;
  metadata: Record<string, unknown>;
  started_at: string;
  completed_at: string;
  created_at: string;
}

export interface DocumentDetail extends DocumentItem {
  output: string;
  messages: Array<{ role: string; content: string }>;
  tool_calls: Array<{ name: string; input: unknown }>;
  iterations: number;
}

export interface CoordinationTask {
  id: string;
  title: string;
  description: string;
  assignedAgent: string;
  assignedAgentId: string;
  dependencies: string[];
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: string;
  error?: string;
}

export interface CoordinationPlan {
  id: string;
  title: string;
  pattern: 'pipeline' | 'fan-out' | 'consensus';
  leadAgentId: string;
  leadAgentName: string;
  tasks: CoordinationTask[];
  status: 'planning' | 'executing' | 'completed' | 'failed';
  createdAt: string;
}

export interface CoordinationSession {
  id: string;
  planId: string;
  leadAgentId: string;
  status: 'active' | 'completed' | 'failed' | 'cancelled';
  startedAt: string;
  completedAt?: string;
  summary?: string;
  plan?: CoordinationPlan | null;
}

export interface CoordinationStats {
  totalSessions: number;
  activeSessions: number;
  completedSessions: number;
  failedSessions: number;
  totalTasks: number;
  tasksByStatus: Record<string, number>;
}

// Cost types
export interface CostBucket {
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalEvents: number;
}

export interface CostSummary {
  total: CostBucket;
  api: CostBucket;
  cli: CostBucket;
}

export interface DailyCost {
  date: string;
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  eventCount: number;
  apiCost: number;
  apiEvents: number;
  cliCost: number;
  cliEvents: number;
}

export interface AgentCost {
  agentId: string;
  agentName: string;
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalEvents: number;
}

// Audit types
export interface AuditEntry {
  id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  actor: string;
  actor_id: string | null;
  old_value: Record<string, unknown>;
  new_value: Record<string, unknown>;
  execution_id: string | null;
  created_at: string;
}

// Guardrail types
export interface Guardrail {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  type: 'content_filter' | 'cost_limit' | 'rate_limit' | 'tool_restriction' | 'output_filter' | 'custom';
  config: Record<string, unknown>;
  is_enabled: boolean;
  is_global: boolean;
  agent_ids: string[];
  priority: number;
  created_at: string;
  updated_at: string;
}

// Provider types
export type AuthSource = 'db' | 'env' | 'oauth' | 'none';

export interface Provider {
  id: string;
  name: string;
  type: string;
  base_url: string | null;
  is_enabled: boolean;
  health_status: string;
  last_health_check: string | null;
  config: Record<string, unknown>;
  auth_source: AuthSource;
  has_key: boolean;
  key_hint: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProviderModel {
  id: string;
  provider_id: string;
  model_id: string;
  display_name: string;
  context_window: number;
  max_output: number;
  cost_per_1k_input: string;
  cost_per_1k_output: string;
  supports_tools: boolean;
  supports_vision: boolean;
  supports_streaming: boolean;
  is_reasoning: boolean;
  is_fast: boolean;
  is_enabled: boolean;
  created_at: string;
}

export interface ForgeTool {
  id: string;
  name: string;
  display_name: string;
  description: string;
  type: string;
  risk_level: string;
  is_enabled: boolean;
}

export interface ProviderHealth {
  status: 'healthy' | 'degraded' | 'unknown';
  providers: Array<{
    id: string;
    name: string;
    type: string;
    healthStatus: string;
    lastHealthCheck: string | null;
  }>;
}

export interface UserProviderKey {
  provider_type: string;
  has_key: boolean;
  key_hint: string | null;
  label: string | null;
  is_active: boolean;
  last_verified_at: string | null;
  last_used_at: string | null;
}

// Workflow types
export interface WorkflowNode {
  id: string;
  type: string;
  label: string;
  agentId?: string;
  agentName?: string;
  config?: Record<string, unknown>;
}

export interface WorkflowEdge {
  from: string;
  to: string;
  condition?: string;
}

export interface Workflow {
  id: string;
  owner_id: string;
  name: string;
  slug: string;
  description: string | null;
  definition: { nodes: WorkflowNode[]; edges: WorkflowEdge[] };
  version: number;
  status: 'draft' | 'active' | 'archived';
  is_public: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface WorkflowRun {
  id: string;
  workflow_id: string;
  owner_id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  node_states: Record<string, unknown>;
  shared_context: Record<string, unknown>;
  current_node: string | null;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

// ============================
// API functions
// ============================

export interface TimelineExecution {
  id: string;
  agent_id: string;
  agent_name: string;
  status: string;
  model_tier: 'opus' | 'sonnet' | 'haiku' | 'unknown';
  started_at: string;
  completed_at: string | null;
  created_at: string;
  duration_ms: number | null;
  cost: number;
  tokens: number;
}

export const hubApi = {
  agents: {
    list: (includeDecommissioned = false) =>
      apiFetch<{ agents: Agent[] }>(`/api/v1/admin/agents?include_decommissioned=${includeDecommissioned}`),

    detail: (id: string) =>
      apiFetch<AgentDetail>(`/api/v1/admin/agents/${id}`),

    create: (body: { name: string; type: string; description: string; system_prompt: string }) =>
      apiFetch<{ agent: Agent }>('/api/v1/admin/agents', { method: 'POST', body: JSON.stringify(body) }),

    optimizePrompt: (body: { prompt: string; name?: string; type?: string; description?: string }) =>
      apiFetch<{ optimized: string; tokens: { input: number; output: number } }>('/api/v1/admin/agents/optimize-prompt', { method: 'POST', body: JSON.stringify(body) }),

    run: (id: string, prompt?: string) =>
      apiFetch(`/api/v1/admin/chat/agents/${id}/run`, {
        method: 'POST',
        body: JSON.stringify({ task_type: 'manual', prompt: prompt || undefined }),
      }),

    stop: (id: string) =>
      apiFetch(`/api/v1/admin/agents/${id}/stop`, { method: 'POST' }),

    decommission: (id: string) =>
      apiFetch(`/api/v1/admin/agents/${id}/decommission`, { method: 'POST' }),

    recommission: (id: string) =>
      apiFetch(`/api/v1/admin/agents/${id}/recommission`, { method: 'POST' }),

    delete: (id: string) =>
      apiFetch(`/api/v1/admin/agents/${id}`, { method: 'DELETE' }),

    batchProcess: () =>
      apiFetch<{ started: number; agents: string[] }>('/api/v1/admin/agents/batch/process', { method: 'POST' }),

    batchPause: () =>
      apiFetch<{ paused: number; agents: string[] }>('/api/v1/admin/agents/batch/pause', { method: 'POST' }),

    process: (id: string) =>
      apiFetch(`/api/v1/admin/agents/${id}/process`, { method: 'POST' }),

    setSchedule: (id: string, body: { schedule_type: string; interval_minutes?: number; execution_mode?: string }) =>
      apiFetch(`/api/v1/admin/agents/${id}/schedule`, { method: 'POST', body: JSON.stringify({
        schedule_type: body.schedule_type,
        schedule_interval_minutes: body.interval_minutes,
        execution_mode: body.execution_mode,
      }) }),

    updateModel: (id: string, model_id: string) =>
      apiFetch(`/api/v1/admin/agents/${id}/model`, { method: 'PATCH', body: JSON.stringify({ model_id }) }),

    updateSettings: (id: string, settings: Record<string, unknown>) =>
      apiFetch(`/api/v1/admin/agents/${id}/settings`, { method: 'PATCH', body: JSON.stringify(settings) }),

    performance: (days = 7) =>
      apiFetch<AgentPerformanceReport>(`/api/v1/admin/agents/performance?days=${days}`),
  },

  orchestration: {
    stats: () =>
      apiFetch<OrchestrationStats>('/api/v1/admin/orchestration'),
  },

  interventions: {
    list: (params: { status?: string; page?: number; limit?: number } = {}) =>
      apiFetch<{ interventions: Intervention[]; pagination: Pagination }>(
        `/api/v1/admin/interventions?${buildParams({ status: params.status, page: params.page, limit: params.limit || 50 })}`
      ),

    respond: (id: string, action: 'approve' | 'deny' | 'feedback', response?: string) =>
      apiFetch(`/api/v1/admin/interventions/${id}/respond`, {
        method: 'POST',
        body: JSON.stringify({ action, feedback: response || action }),
      }),
  },

  tasks: {
    list: (params: { status?: string; agent_id?: string; page?: number; limit?: number } = {}) =>
      apiFetch<{ tasks: Task[]; pagination: Pagination }>(
        `/api/v1/admin/tasks?${buildParams({ status: params.status, agent_id: params.agent_id, page: params.page, limit: params.limit || 50 })}`
      ),

    stats: () =>
      apiFetch<TaskStats>('/api/v1/admin/tasks/stats'),

    detail: (id: string) =>
      apiFetch<TaskDetail>(`/api/v1/admin/tasks/${id}`),
  },

  tickets: {
    list: (params: { filter?: string; source?: string; search?: string; page?: number; limit?: number } = {}) =>
      apiFetch<{ tickets: Ticket[]; pagination: Pagination }>(
        `/api/v1/admin/tickets?${buildParams({ filter: params.filter, source: params.source, search: params.search, page: params.page, limit: params.limit || 50 })}`
      ),

    create: (body: { title: string; description: string; priority: string; category: string; assigned_to?: string }) =>
      apiFetch<{ ticket: Ticket }>('/api/v1/admin/tickets', { method: 'POST', body: JSON.stringify(body) }),

    update: (id: string, body: Partial<Ticket>) =>
      apiFetch<{ ticket: Ticket }>(`/api/v1/admin/tickets/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

    delete: (id: string) =>
      apiFetch(`/api/v1/admin/tickets/${id}`, { method: 'DELETE' }),

    notes: (id: string) =>
      apiFetch<{ notes: TicketNote[] }>(`/api/v1/admin/tickets/${id}/notes`),

    addNote: (id: string, content: string) =>
      apiFetch<{ note: TicketNote }>(`/api/v1/admin/tickets/${id}/notes`, { method: 'POST', body: JSON.stringify({ content }) }),
  },

  reports: {
    metrics: () =>
      apiFetch<SystemMetrics>('/api/v1/admin/reports/metrics'),

    activity: () =>
      apiFetch<{ activity: AgentActivity[] }>('/api/v1/admin/reports/activity'),

    schedules: () =>
      apiFetch<{ schedules: AgentSchedule[] }>('/api/v1/admin/reports/schedules'),

    findings: (params: { page?: number; limit?: number; search?: string; severity?: string; agent_name?: string } = {}) =>
      apiFetch<{ findings: RecentFinding[]; pagination: Pagination }>(
        `/api/v1/admin/reports/findings?${buildParams({ page: params.page, limit: params.limit || 50, search: params.search, severity: params.severity, agent_name: params.agent_name })}`
      ),

    findingDetail: (id: string) =>
      apiFetch<{ finding: RecentFinding }>(`/api/v1/admin/reports/findings/${id}`),

    scheduler: () =>
      apiFetch<SchedulerStatus>('/api/v1/admin/reports/scheduler'),

    toggleScheduler: (action: 'start' | 'stop') =>
      apiFetch('/api/v1/admin/reports/scheduler', {
        method: 'POST',
        body: JSON.stringify({ action, intervalMs: 60000 }),
      }),

    feed: (params: { agent?: string; category?: string; dateFrom?: string; dateTo?: string; search?: string; severity?: string; type?: string; page?: number; limit?: number } = {}) =>
      apiFetch<{ items: ReportFeedItem[]; pagination: Pagination; total: number }>(
        `/api/v1/admin/reports/feed?${buildParams({ agent: params.agent, category: params.category, dateFrom: params.dateFrom, dateTo: params.dateTo, search: params.search, severity: params.severity, type: params.type, page: params.page, limit: params.limit || 50 })}`
      ),

    feedAgents: () =>
      apiFetch<{ agents: string[] }>('/api/v1/admin/reports/feed/agents'),

    feedCategories: () =>
      apiFetch<{ categories: string[] }>('/api/v1/admin/reports/feed/categories'),
  },

  content: {
    feed: (params: { agent?: string; source?: string; severity?: string; category?: string; dateFrom?: string; dateTo?: string; search?: string; page?: number; limit?: number } = {}) =>
      apiFetch<{ items: ContentFeedItem[]; pagination: Pagination }>(
        `/api/v1/admin/reports/feed?${buildParams({ agent: params.agent, source: params.source, severity: params.severity, category: params.category, dateFrom: params.dateFrom, dateTo: params.dateTo, search: params.search, page: params.page, limit: params.limit || 50 })}`
      ),

    feedAgents: () =>
      apiFetch<{ agents: string[] }>('/api/v1/admin/reports/feed/agents'),

    feedCategories: () =>
      apiFetch<{ categories: string[] }>('/api/v1/admin/reports/feed/categories'),
  },

  documents: {
    list: (params: { agent?: string; search?: string; dateFrom?: string; dateTo?: string; page?: number; limit?: number } = {}) =>
      apiFetch<{ documents: DocumentItem[]; pagination: Pagination }>(
        `/api/v1/admin/reports/documents?${buildParams({ agent: params.agent, search: params.search, dateFrom: params.dateFrom, dateTo: params.dateTo, page: params.page, limit: params.limit || 50 })}`
      ),

    detail: (id: string) =>
      apiFetch<{ document: DocumentDetail }>(`/api/v1/admin/reports/documents/${id}`),

    agents: () =>
      apiFetch<{ agents: string[] }>('/api/v1/admin/reports/documents/agents'),
  },

  memory: {
    stats: () =>
      apiFetch<FleetMemoryStats>('/api/v1/admin/memory/stats'),

    search: (params: { q: string; tier?: string; agent_id?: string; source_type?: string; limit?: number; page?: number }) =>
      apiFetch<{ memories: FleetMemoryItem[]; total: number; page: number; limit: number; totalPages: number }>(
        `/api/v1/admin/memory/search?${buildParams({ q: params.q, tier: params.tier, agent_id: params.agent_id, source_type: params.source_type, limit: params.limit || 50, page: params.page })}`
      ),

    recent: (params: { limit?: number; page?: number; agent_id?: string; source_type?: string; tier?: string; dateFrom?: string; dateTo?: string } = {}) =>
      apiFetch<{ memories: FleetMemoryItem[]; total: number; page: number; limit: number; totalPages: number }>(
        `/api/v1/admin/memory/recent?${buildParams({ limit: params.limit || 30, page: params.page, agent_id: params.agent_id, source_type: params.source_type, tier: params.tier, dateFrom: params.dateFrom, dateTo: params.dateTo })}`
      ),

    recalls: (params: { limit?: number; page?: number } = {}) =>
      apiFetch<{ recalls: FleetRecallEvent[]; total: number; page: number; limit: number; totalPages: number }>(
        `/api/v1/admin/memory/recalls?${buildParams({ limit: params.limit || 30, page: params.page })}`
      ),

    store: (body: {
      type: 'semantic' | 'episodic' | 'procedural';
      agentId: string;
      content?: string;
      source?: string;
      importance?: number;
      situation?: string;
      action?: string;
      outcome?: string;
      quality?: number;
      triggerPattern?: string;
      toolSequence?: unknown[];
      metadata?: Record<string, unknown>;
    }) =>
      apiFetch('/api/v1/admin/memory/store', { method: 'POST', body: JSON.stringify(body) }),
  },

  knowledgeGraph: {
    graph: (params: { limit?: number; offset?: number; type?: string; agent_id?: string; min_mentions?: number } = {}) =>
      apiFetch<{ nodes: KnowledgeNode[]; edges: KnowledgeEdge[]; total_nodes: number; total_edges: number }>(
        `/api/v1/admin/knowledge/graph?${buildParams({ limit: params.limit || 500, offset: params.offset, type: params.type, agent_id: params.agent_id, min_mentions: params.min_mentions })}`
      ),
    stats: () =>
      apiFetch<{ total_nodes: number; total_edges: number; top_entities: { entity_type: string; count: number }[]; top_relations: { relation: string; count: number }[] }>(
        '/api/v1/admin/knowledge/stats'
      ),
    entityTypes: () =>
      apiFetch<{ types: { entity_type: string; count: number; avg_mentions: number }[] }>(
        '/api/v1/admin/knowledge/entity-types'
      ),
    agents: () =>
      apiFetch<{ agents: { agent_id: string; agent_name: string; node_count: number }[] }>(
        '/api/v1/admin/knowledge/agents'
      ),
    neighborhood: (nodeId: string) =>
      apiFetch<{ node: KnowledgeNode; edges: KnowledgeEdge[]; neighbors: KnowledgeNode[] }>(
        `/api/v1/admin/knowledge/nodes/${nodeId}/neighborhood`
      ),
    node: (nodeId: string) =>
      apiFetch<KnowledgeNode>(`/api/v1/admin/knowledge/nodes/${nodeId}`),
    search: (q: string, params: { type?: string; agentId?: string; limit?: number } = {}) =>
      apiFetch<{ nodes: KnowledgeNode[] }>(
        `/api/v1/admin/knowledge/search?${buildParams({ q, type: params.type, agentId: params.agentId, limit: params.limit || 50 })}`
      ),
    topConnected: (limit?: number) =>
      apiFetch<{ nodes: KnowledgeNode[] }>(
        `/api/v1/admin/knowledge/top-connected?${buildParams({ limit: limit || 20 })}`
      ),
  },

  costs: {
    summary: (params: { startDate?: string; endDate?: string; agentId?: string; days?: number } = {}) =>
      apiFetch<{ summary: CostSummary; dailyCosts: DailyCost[]; byAgent: AgentCost[] }>(
        `/api/v1/admin/costs?${buildParams({ startDate: params.startDate, endDate: params.endDate, agentId: params.agentId, days: params.days || 30 })}`
      ),
  },

  audit: {
    list: (params: { entity_type?: string; action?: string; actor?: string; limit?: number; offset?: number } = {}) =>
      apiFetch<{ audit_trail: AuditEntry[]; total: number; limit: number; offset: number }>(
        `/api/v1/admin/audit?${buildParams({ entity_type: params.entity_type, action: params.action, actor: params.actor, limit: params.limit || 50, offset: params.offset || 0 })}`
      ),
  },

  guardrails: {
    list: () =>
      apiFetch<{ guardrails: Guardrail[] }>('/api/v1/admin/guardrails'),

    create: (body: { name: string; type: string; description?: string; config?: Record<string, unknown>; is_enabled?: boolean; is_global?: boolean; agent_ids?: string[]; priority?: number }) =>
      apiFetch<{ guardrail: Guardrail }>('/api/v1/admin/guardrails', { method: 'POST', body: JSON.stringify(body) }),

    update: (id: string, body: { is_enabled?: boolean; config?: Record<string, unknown>; priority?: number; name?: string; description?: string }) =>
      apiFetch<{ guardrail: Guardrail }>(`/api/v1/admin/guardrails/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

    delete: (id: string) =>
      apiFetch<{ success: boolean }>(`/api/v1/admin/guardrails/${id}`, { method: 'DELETE' }),
  },

  tools: {
    list: () =>
      apiFetch<{ tools: ForgeTool[] }>('/api/v1/admin/tools?enabled=true'),
  },

  providers: {
    list: () =>
      apiFetch<{ providers: Provider[] }>('/api/v1/admin/providers'),

    models: (id: string) =>
      apiFetch<{ provider: { id: string; name: string; type: string }; models: ProviderModel[] }>(`/api/v1/admin/providers/${id}/models`),

    health: () =>
      apiFetch<ProviderHealth>('/api/v1/admin/providers/health'),

    runHealthCheck: () =>
      apiFetch<ProviderHealth>('/api/v1/admin/providers/health-check', { method: 'POST', body: JSON.stringify({}) }),

    update: (id: string, body: { name?: string; base_url?: string | null; api_key?: string | null; is_enabled?: boolean; config?: Record<string, unknown> }) =>
      apiFetch<{ provider: Provider }>(`/api/v1/admin/providers/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  },

  userProviders: {
    list: () =>
      apiFetch<{ keys: UserProviderKey[] }>('/api/v1/user-providers'),

    set: (providerType: string, body: { api_key: string; label?: string }) =>
      apiFetch<{ key: UserProviderKey }>(`/api/v1/user-providers/${providerType}`, { method: 'PUT', body: JSON.stringify(body) }),

    remove: (providerType: string) =>
      apiFetch<{ ok: boolean }>(`/api/v1/user-providers/${providerType}`, { method: 'DELETE' }),

    verify: (providerType: string) =>
      apiFetch<{ status: string; error: string | null }>(`/api/v1/user-providers/${providerType}/verify`, { method: 'POST', body: JSON.stringify({}) }),
  },

  workflows: {
    list: (params: { status?: string; limit?: number; offset?: number } = {}) =>
      apiFetch<{ workflows: Workflow[]; total: number }>(`/api/v1/admin/workflows?${buildParams({ status: params.status, limit: params.limit || 50, offset: params.offset || 0 })}`),

    get: (id: string) =>
      apiFetch<{ workflow: Workflow }>(`/api/v1/admin/workflows/${id}`),

    create: (body: { name: string; description?: string; definition?: { nodes: unknown[]; edges: unknown[] } }) =>
      apiFetch<{ workflow: Workflow }>('/api/v1/admin/workflows', { method: 'POST', body: JSON.stringify(body) }),

    update: (id: string, body: { name?: string; description?: string; definition?: { nodes: unknown[]; edges: unknown[] }; status?: string }) =>
      apiFetch<{ workflow: Workflow }>(`/api/v1/admin/workflows/${id}`, { method: 'PUT', body: JSON.stringify(body) }),

    run: (id: string, input?: Record<string, unknown>) =>
      apiFetch<{ run: WorkflowRun }>(`/api/v1/admin/workflows/${id}/run`, { method: 'POST', body: JSON.stringify({ input: input || {} }) }),
  },

  // Phase 6: Prompt Revisions
  promptRevisions: {
    propose: (agentId: string) =>
      apiFetch(`/api/v1/admin/agents/${agentId}/propose-revision`, { method: 'POST', body: JSON.stringify({}) }),
    list: (agentId: string) =>
      apiFetch<unknown[]>(`/api/v1/admin/agents/${agentId}/prompt-revisions`),
    listAll: (status?: string) =>
      apiFetch<{ revisions: unknown[] }>(`/api/v1/admin/prompt-revisions?${buildParams({ status: status || 'pending' })}`),
    apply: (revisionId: string) =>
      apiFetch(`/api/v1/admin/prompt-revisions/${revisionId}/apply`, { method: 'POST', body: JSON.stringify({}) }),
    reject: (revisionId: string) =>
      apiFetch(`/api/v1/admin/prompt-revisions/${revisionId}/reject`, { method: 'POST', body: JSON.stringify({}) }),
  },

  // Phase 7: NL Orchestration
  nlOrchestrate: {
    run: (instruction: string, maxAgents?: number) =>
      apiFetch<{ sessionId: string; tasks: unknown[]; totalTasks: number }>('/api/v1/admin/orchestrate-nl', {
        method: 'POST', body: JSON.stringify({ instruction, maxAgents }),
      }),
    status: (sessionId: string) =>
      apiFetch(`/api/v1/admin/orchestration/${sessionId}/status`),
  },

  // Phase 8: Multi-Agent Chat
  chat: {
    create: (topic: string, agentIds: string[]) =>
      apiFetch('/api/v1/admin/chat/create', { method: 'POST', body: JSON.stringify({ topic, agentIds }) }),
    sessions: () =>
      apiFetch<unknown[]>('/api/v1/admin/chat/sessions'),
    get: (sessionId: string) =>
      apiFetch(`/api/v1/admin/chat/${sessionId}`),
    message: (sessionId: string, content: string) =>
      apiFetch(`/api/v1/admin/chat/${sessionId}/message`, { method: 'POST', body: JSON.stringify({ content }) }),
    respond: (sessionId: string, agentId: string) =>
      apiFetch(`/api/v1/admin/chat/${sessionId}/respond/${agentId}`, { method: 'POST', body: JSON.stringify({}) }),
    round: (sessionId: string) =>
      apiFetch<unknown[]>(`/api/v1/admin/chat/${sessionId}/round`, { method: 'POST', body: JSON.stringify({}) }),
    end: (sessionId: string) =>
      apiFetch(`/api/v1/admin/chat/${sessionId}/end`, { method: 'POST', body: JSON.stringify({}) }),
  },

  // Phase 9: Goals
  goals: {
    propose: (agentId: string) =>
      apiFetch<unknown[]>(`/api/v1/admin/agents/${agentId}/propose-goals`, { method: 'POST', body: JSON.stringify({}) }),
    list: (agentId: string, status?: string) =>
      apiFetch<unknown[]>(`/api/v1/admin/agents/${agentId}/goals${status ? `?status=${status}` : ''}`),
    listAll: (status?: string, agentId?: string) =>
      apiFetch<{ goals: unknown[] }>(`/api/v1/admin/goals?${buildParams({ status, agent_id: agentId })}`),
    approve: (goalId: string) =>
      apiFetch(`/api/v1/admin/goals/${goalId}/approve`, { method: 'POST', body: JSON.stringify({}) }),
    reject: (goalId: string) =>
      apiFetch(`/api/v1/admin/goals/${goalId}/reject`, { method: 'POST', body: JSON.stringify({}) }),
  },

  // Phase 10: Cost Optimizer
  costOptimizer: {
    dashboard: () =>
      apiFetch<{ profiles: unknown[]; savings: { totalSamples: number; avgCostReduction: number } }>('/api/v1/admin/cost/dashboard'),
    recommend: (capabilities: string[], minQuality?: number) =>
      apiFetch<unknown[]>('/api/v1/admin/cost/recommend', { method: 'POST', body: JSON.stringify({ capabilities, minQuality }) }),
  },

  // Phase 11: Knowledge Graph
  knowledge: {
    stats: () =>
      apiFetch<{ totalNodes: number; totalEdges: number; topEntities: unknown[]; topRelations: unknown[] }>('/api/v1/admin/knowledge/stats'),
    search: (q: string, type?: string, limit?: number) =>
      apiFetch<unknown[]>(`/api/v1/admin/knowledge/search?${buildParams({ q, type, limit })}`),
    neighborhood: (nodeId: string) =>
      apiFetch<{ nodes: unknown[]; edges: unknown[] }>(`/api/v1/admin/knowledge/nodes/${nodeId}/neighborhood`),
  },

  // Phase 12: Monitoring
  monitoring: {
    health: () =>
      apiFetch<{ timestamp: string; overall: string; checks: unknown[]; alerts: unknown[] }>('/api/v1/admin/monitoring/health'),
  },

  // Phase 13: Evolution
  evolution: {
    clone: (agentId: string, body: { type: string; description: string; promptOverride?: string; modelOverride?: string }) =>
      apiFetch<{ variantId: string }>(`/api/v1/admin/agents/${agentId}/clone`, { method: 'POST', body: JSON.stringify(body) }),
    experiment: (body: { parentId: string; variantId: string; testTask: string; mutationDescription: string }) =>
      apiFetch('/api/v1/admin/evolution/experiment', { method: 'POST', body: JSON.stringify(body) }),
    experiments: (agentId: string) =>
      apiFetch<unknown[]>(`/api/v1/admin/agents/${agentId}/experiments`),
    promote: (experimentId: string) =>
      apiFetch(`/api/v1/admin/evolution/${experimentId}/promote`, { method: 'POST', body: JSON.stringify({}) }),
  },

  // Metabolic Dashboard
  metabolic: {
    status: () =>
      apiFetch<{
        startedAt: string;
        uptimeSeconds: number;
        cycles: Array<{
          cycle: string;
          intervalHours: number;
          lastRun: string | null;
          lastDurationMs: number;
          lastResult: Record<string, number>;
          runCount: number;
          lastError: string | null;
        }>;
        memory: Record<string, number>;
      }>('/api/v1/admin/metabolic/status'),
  },

  // Phase 14: Events & Leaderboard
  events: {
    recent: (limit?: number) =>
      apiFetch<unknown[]>(`/api/v1/admin/events/recent${limit ? `?limit=${limit}` : ''}`),
    execution: (executionId: string) =>
      apiFetch<unknown[]>(`/api/v1/admin/events/execution/${executionId}`),
    session: (sessionId: string) =>
      apiFetch<unknown[]>(`/api/v1/admin/events/session/${sessionId}`),
    stats: () =>
      apiFetch<{ totalEvents: number; eventsLast24h: number; topEventTypes: unknown[] }>('/api/v1/admin/events/stats'),
    leaderboard: () =>
      apiFetch<unknown[]>('/api/v1/admin/fleet/leaderboard'),
  },

  // Execution Timeline
  timeline: {
    executions: (hours?: number) =>
      apiFetch<{ executions: TimelineExecution[]; hours: number }>(
        `/api/v1/admin/executions/timeline?${buildParams({ hours })}`,
      ),
  },

  // Checkpoints (human-in-the-loop)
  checkpoints: {
    list: (params: { owner_id?: string; status?: string; limit?: number } = {}) =>
      apiFetch<{ checkpoints: unknown[] }>(`/api/v1/admin/checkpoints?${buildParams({ owner_id: params.owner_id, status: params.status, limit: params.limit })}`),
    get: (id: string) =>
      apiFetch<{ checkpoint: unknown }>(`/api/v1/admin/checkpoints/${id}`),
    respond: (id: string, body: { response: string; status: 'approved' | 'rejected' }) =>
      apiFetch(`/api/v1/admin/checkpoints/${id}/respond`, { method: 'POST', body: JSON.stringify(body) }),
  },

  coordination: {
    sessions: () =>
      apiFetch<{ sessions: CoordinationSession[] }>('/api/v1/admin/coordination/sessions'),

    sessionDetail: (id: string) =>
      apiFetch<{ session: CoordinationSession }>(`/api/v1/admin/coordination/sessions/${id}`),

    startTeam: (body: {
      leadAgentId: string;
      leadAgentName: string;
      title: string;
      pattern: 'pipeline' | 'fan-out' | 'consensus';
      tasks: Array<{ title: string; description: string; agentName: string; dependencies?: string[] }>;
    }) =>
      apiFetch<{ session: CoordinationSession }>('/api/v1/admin/coordination/sessions', {
        method: 'POST',
        body: JSON.stringify(body),
      }),

    cancelSession: (id: string) =>
      apiFetch<{ success: boolean }>(`/api/v1/admin/coordination/sessions/${id}/cancel`, { method: 'POST' }),

    plans: () =>
      apiFetch<{ plans: CoordinationPlan[] }>('/api/v1/admin/coordination/plans'),

    stats: () =>
      apiFetch<CoordinationStats>('/api/v1/admin/coordination/stats'),
  },

  // Templates (Layer 2)
  templates: {
    list: () =>
      apiFetch<{ templates: unknown[]; categories: Record<string, unknown[]>; total: number }>('/api/v1/admin/chat/templates'),

    detail: (id: string) =>
      apiFetch('/api/v1/admin/chat/templates/' + id),

    instantiate: (id: string, overrides?: Record<string, unknown>) =>
      apiFetch<{ agent: unknown; templateId: string; message: string }>(
        `/api/v1/admin/chat/templates/${id}/instantiate`,
        { method: 'POST', body: JSON.stringify(overrides ?? {}) },
      ),
  },

  // Deployment Logs
  deployments: {
    list: (limit?: number) =>
      apiFetch<{ logs: DeploymentLog[] }>(
        `/api/v1/admin/deployment-logs${limit ? `?limit=${limit}` : ''}`,
      ),
  },
};

export interface DeploymentLog {
  id: string;
  timestamp: string;
  service: string;
  action: 'deploy' | 'rollback' | 'restart';
  status: 'success' | 'failed' | 'pending';
  agent_name: string | null;
  commit_hash: string | null;
}

// ── Integration types ──

export interface UserIntegration {
  id: string;
  provider: string;
  provider_user_id: string | null;
  display_name: string | null;
  status: string;
  scopes: string[] | null;
  created_at: string;
  updated_at: string;
  repo_count?: number;
}

export interface UserRepo {
  id: string;
  integration_id: string;
  provider: string;
  repo_full_name: string;
  repo_url: string;
  clone_url: string | null;
  default_branch: string;
  is_private: boolean;
  language: string | null;
  last_synced_at: string;
}

export const integrationApi = {
  list: () =>
    apiFetch<{ integrations: UserIntegration[] }>('/api/v1/integrations'),

  available: () =>
    apiFetch<{ providers: Array<{ provider: string; configured: boolean }> }>('/api/v1/integrations/available'),

  repos: () =>
    apiFetch<{ repos: UserRepo[] }>('/api/v1/integrations/repos'),

  reposByIntegration: (id: string) =>
    apiFetch<{ repos: UserRepo[] }>(`/api/v1/integrations/${id}/repos`),

  sync: (id: string) =>
    apiFetch<{ synced: number }>(`/api/v1/integrations/${id}/sync`, { method: 'POST', body: JSON.stringify({}) }),

  disconnect: (id: string) =>
    apiFetch(`/api/v1/integrations/${id}`, { method: 'DELETE' }),

  branches: (integrationId: string, repoFullName: string) =>
    apiFetch<{ branches: Array<{ name: string; isDefault: boolean }> }>(
      `/api/v1/integrations/${integrationId}/repos/${encodeURIComponent(repoFullName)}/branches`,
    ),
};

// ============================================
// Device Management
// ============================================

interface AgentDevice {
  id: string;
  user_id: string;
  tenant_id: string;
  api_key_id: string;
  device_name: string;
  hostname: string | null;
  os: string | null;
  platform_capabilities: Record<string, unknown>;
  status: 'online' | 'offline' | 'busy';
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
}

interface DeviceSummary {
  total: number;
  online: number;
  busy: number;
  offline: number;
}

export const deviceApi = {
  list: () =>
    apiFetch<{ devices: AgentDevice[] }>('/api/v1/forge/devices'),

  detail: (id: string) =>
    apiFetch<{ device: AgentDevice }>(`/api/v1/forge/devices/${id}`),

  summary: () =>
    apiFetch<DeviceSummary>('/api/v1/forge/devices/summary'),

  remove: (id: string) =>
    apiFetch<{ deleted: boolean }>(`/api/v1/forge/devices/${id}`, { method: 'DELETE' }),

  disconnect: (id: string) =>
    apiFetch<{ disconnected: boolean }>(`/api/v1/forge/devices/${id}/disconnect`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
};

export type { AgentDevice, DeviceSummary };

// Deployment logs section appended to hubApi below — see exports
