// Centralized API layer for the Orchestration Hub
// Maps all 28 admin-hub.js endpoints

const getApiBase = () => {
  if (window.location.hostname.includes('askalf.org')) return '';
  return 'http://localhost:3005';
};

const API_BASE = getApiBase();

async function apiFetch<T = unknown>(path: string, options?: RequestInit): Promise<T> {
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
  return res.json();
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
  type: 'dev' | 'research' | 'support' | 'content' | 'monitor' | 'custom';
  status: 'idle' | 'running' | 'paused' | 'error';
  description: string;
  system_prompt: string;
  schedule: string | null;
  config: Record<string, unknown>;
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
  execution_mode: 'batch' | 'individual';
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

// ============================
// API functions
// ============================

export const hubApi = {
  agents: {
    list: (includeDecommissioned = false) =>
      apiFetch<{ agents: Agent[] }>(`/api/v1/admin/agents?include_decommissioned=${includeDecommissioned}`),

    detail: (id: string) =>
      apiFetch<AgentDetail>(`/api/v1/admin/agents/${id}`),

    create: (body: { name: string; type: string; description: string; system_prompt: string }) =>
      apiFetch<{ agent: Agent }>('/api/v1/admin/agents', { method: 'POST', body: JSON.stringify(body) }),

    run: (id: string, prompt?: string) =>
      apiFetch(`/api/v1/admin/agents/${id}/run`, {
        method: 'POST',
        body: JSON.stringify({ task_type: 'manual', input: prompt ? { prompt } : {} }),
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
      apiFetch(`/api/v1/admin/agents/${id}/schedule`, { method: 'POST', body: JSON.stringify(body) }),

    updateModel: (id: string, model_id: string) =>
      apiFetch(`/api/v1/admin/agents/${id}/model`, { method: 'PATCH', body: JSON.stringify({ model_id }) }),
  },

  orchestration: {
    stats: () =>
      apiFetch<OrchestrationStats>('/api/v1/admin/orchestration'),
  },

  interventions: {
    list: (params: { status?: string; page?: number; limit?: number } = {}) =>
      apiFetch<{ interventions: Intervention[]; pagination: Pagination }>(
        `/api/v1/admin/interventions?${buildParams({ status: params.status, page: params.page, limit: params.limit || 20 })}`
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
        `/api/v1/admin/tasks?${buildParams({ status: params.status, agent_id: params.agent_id, page: params.page, limit: params.limit || 20 })}`
      ),

    stats: () =>
      apiFetch<TaskStats>('/api/v1/admin/tasks/stats'),

    detail: (id: string) =>
      apiFetch<TaskDetail>(`/api/v1/admin/tasks/${id}`),
  },

  tickets: {
    list: (params: { filter?: string; source?: string; search?: string; page?: number; limit?: number } = {}) =>
      apiFetch<{ tickets: Ticket[]; pagination: Pagination }>(
        `/api/v1/admin/tickets?${buildParams({ filter: params.filter, source: params.source, search: params.search, page: params.page, limit: params.limit || 20 })}`
      ),

    create: (body: { title: string; description: string; priority: string; category: string }) =>
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
        `/api/v1/admin/reports/findings?${buildParams({ page: params.page, limit: params.limit || 20, search: params.search, severity: params.severity, agent_name: params.agent_name })}`
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
        `/api/v1/admin/reports/feed?${buildParams({ agent: params.agent, category: params.category, dateFrom: params.dateFrom, dateTo: params.dateTo, search: params.search, severity: params.severity, type: params.type, page: params.page, limit: params.limit || 20 })}`
      ),

    feedAgents: () =>
      apiFetch<{ agents: string[] }>('/api/v1/admin/reports/feed/agents'),

    feedCategories: () =>
      apiFetch<{ categories: string[] }>('/api/v1/admin/reports/feed/categories'),
  },

  content: {
    feed: (params: { agent?: string; source?: string; severity?: string; category?: string; dateFrom?: string; dateTo?: string; search?: string; page?: number; limit?: number } = {}) =>
      apiFetch<{ items: ContentFeedItem[]; pagination: Pagination }>(
        `/api/v1/admin/reports/feed?${buildParams({ agent: params.agent, source: params.source, severity: params.severity, category: params.category, dateFrom: params.dateFrom, dateTo: params.dateTo, search: params.search, page: params.page, limit: params.limit || 20 })}`
      ),

    feedAgents: () =>
      apiFetch<{ agents: string[] }>('/api/v1/admin/reports/feed/agents'),

    feedCategories: () =>
      apiFetch<{ categories: string[] }>('/api/v1/admin/reports/feed/categories'),
  },

  memory: {
    stats: () =>
      apiFetch<FleetMemoryStats>('/api/v1/admin/memory/stats'),

    search: (params: { q: string; tier?: string; agent_id?: string; source_type?: string; limit?: number; page?: number }) =>
      apiFetch<{ memories: FleetMemoryItem[]; total: number; page: number; limit: number; totalPages: number }>(
        `/api/v1/admin/memory/search?${buildParams({ q: params.q, tier: params.tier, agent_id: params.agent_id, source_type: params.source_type, limit: params.limit || 20, page: params.page })}`
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
};
