import { create } from 'zustand';
import {
  hubApi,
  type Agent,

  type Intervention,
  type OrchestrationStats,
  type Pagination,
  type Task,
  type TaskStats,
  type TaskDetail,
  type Ticket,
  type TicketNote,
  type ContentFeedItem,
  type CoordinationSession,
  type CoordinationStats,
  type Workflow,
  type WorkflowRun,
  type CostSummary,
  type DailyCost,
  type AgentCost,
  type AuditEntry,
  type Guardrail,
  type Provider,
  type ProviderModel,
  type ProviderHealth,
  type UserProviderKey,
} from '../hooks/useHubApi';

interface HubState {
  // Agents
  agents: Agent[];
  showDecommissioned: boolean;
  setShowDecommissioned: (v: boolean) => void;
  selectedAgentId: string | null;

  // Orchestration
  stats: OrchestrationStats | null;

  // Interventions
  interventions: Intervention[];
  interventionPagination: Pagination | null;
  interventionPage: number;
  setInterventionPage: (p: number) => void;
  respondingTo: string | null;
  setRespondingTo: (id: string | null) => void;
  responseText: string;
  setResponseText: (t: string) => void;

  // Tasks
  tasks: Task[];
  taskStats: TaskStats | null;
  taskPagination: Pagination | null;
  taskPage: number;
  taskStatusFilter: string;
  taskAgentFilter: string;
  selectedTaskDetail: TaskDetail | null;
  setTaskPage: (p: number) => void;
  setTaskStatusFilter: (s: string) => void;
  setTaskAgentFilter: (s: string) => void;

  // Tickets
  tickets: Ticket[];
  ticketPagination: Pagination | null;
  ticketPage: number;
  ticketFilter: 'all' | 'open' | 'resolved' | 'critical';
  ticketSource: 'all' | 'human' | 'agent';
  ticketSearch: string;
  setTicketPage: (p: number) => void;
  setTicketFilter: (f: 'all' | 'open' | 'resolved' | 'critical') => void;
  setTicketSource: (s: 'all' | 'human' | 'agent') => void;
  setTicketSearch: (s: string) => void;

  // Content Feed (unified: executions + findings + resolutions)
  contentItems: ContentFeedItem[];
  contentPagination: Pagination | null;
  contentPage: number;
  contentAgentFilter: string;
  contentSourceFilter: string;
  contentSeverityFilter: string;
  contentCategoryFilter: string;
  contentDateFrom: string;
  contentDateTo: string;
  contentSearch: string;
  contentAgents: string[];
  contentCategories: string[];
  selectedContentItem: ContentFeedItem | null;
  setContentPage: (p: number) => void;
  setContentAgentFilter: (s: string) => void;
  setContentSourceFilter: (s: string) => void;
  setContentSeverityFilter: (s: string) => void;
  setContentCategoryFilter: (s: string) => void;
  setContentDateFrom: (s: string) => void;
  setContentDateTo: (s: string) => void;
  setContentSearch: (s: string) => void;
  setSelectedContentItem: (item: ContentFeedItem | null) => void;

  // Workflows
  workflows: Workflow[];
  selectedWorkflow: Workflow | null;
  setSelectedWorkflow: (w: Workflow | null) => void;
  showCreateWorkflow: boolean;
  setShowCreateWorkflow: (v: boolean) => void;
  workflowRuns: WorkflowRun[];
  workflowRunsTotal: number;

  // Costs
  costSummary: CostSummary | null;
  dailyCosts: DailyCost[];
  agentCosts: AgentCost[];
  costAgentFilter: string;
  setCostAgentFilter: (s: string) => void;

  // Audit
  auditEntries: AuditEntry[];
  auditTotal: number;
  auditOffset: number;
  auditEntityFilter: string;
  auditActionFilter: string;
  auditActorFilter: string;
  setAuditOffset: (n: number) => void;
  setAuditEntityFilter: (s: string) => void;
  setAuditActionFilter: (s: string) => void;
  setAuditActorFilter: (s: string) => void;

  // Guardrails
  guardrails: Guardrail[];
  showCreateGuardrail: boolean;
  setShowCreateGuardrail: (v: boolean) => void;

  // Providers
  providersList: Provider[];
  providerHealth: ProviderHealth | null;
  expandedProvider: string | null;
  providerModels: Record<string, ProviderModel[]>;
  setExpandedProvider: (id: string | null) => void;
  userProviderKeys: UserProviderKey[];

  // Coordination
  coordinationSessions: CoordinationSession[];
  coordinationStats: CoordinationStats | null;
  selectedCoordinationSession: CoordinationSession | null;
  setSelectedCoordinationSession: (s: CoordinationSession | null) => void;
  showStartTeam: boolean;
  setShowStartTeam: (v: boolean) => void;

  // Modals
  showCreateTicket: boolean;
  setShowCreateTicket: (v: boolean) => void;
  showTicketDetail: Ticket | null;
  setShowTicketDetail: (t: Ticket | null) => void;
  ticketNotes: TicketNote[];
  ticketNotesLoading: boolean;
  selectedTask: Task | null;
  setSelectedTask: (t: Task | null) => void;

  // Loading
  loading: Record<string, boolean>;

  // ============================
  // Actions
  // ============================
  fetchAgents: () => Promise<void>;

  fetchOrchestration: () => Promise<void>;
  fetchInterventions: () => Promise<void>;
  fetchTasks: () => Promise<void>;
  fetchTaskStats: () => Promise<void>;
  fetchTaskDetail: (id: string) => Promise<void>;
  fetchTickets: () => Promise<void>;
  fetchContentFeed: () => Promise<void>;
  fetchContentAgents: () => Promise<void>;
  fetchContentCategories: () => Promise<void>;

  // Workflow actions
  fetchWorkflows: () => Promise<void>;
  fetchWorkflowRuns: (workflowId: string) => Promise<void>;
  createWorkflow: (body: { name: string; description?: string }) => Promise<boolean>;
  updateWorkflow: (id: string, body: { name?: string; description?: string; definition?: { nodes: unknown[]; edges: unknown[] }; status?: string }) => Promise<boolean>;
  runWorkflow: (id: string, input?: Record<string, unknown>) => Promise<boolean>;

  // Cost actions
  fetchCosts: () => Promise<void>;

  // Audit actions
  fetchAudit: () => Promise<void>;

  // Guardrail actions
  fetchGuardrails: () => Promise<void>;
  createGuardrail: (body: { name: string; type: string; description?: string; config?: Record<string, unknown>; is_enabled?: boolean; is_global?: boolean; agent_ids?: string[]; priority?: number }) => Promise<boolean>;
  updateGuardrail: (id: string, body: { is_enabled?: boolean; config?: Record<string, unknown>; priority?: number; name?: string; description?: string }) => Promise<boolean>;
  deleteGuardrail: (id: string) => Promise<boolean>;

  // Provider actions
  fetchProviders: () => Promise<void>;
  fetchProviderHealth: () => Promise<void>;
  fetchProviderModels: (id: string) => Promise<void>;
  runProviderHealthCheck: () => Promise<void>;
  updateProvider: (id: string, body: { name?: string; base_url?: string | null; api_key?: string | null; is_enabled?: boolean; config?: Record<string, unknown> }) => Promise<boolean>;
  fetchUserProviderKeys: () => Promise<void>;

  // Coordination actions
  fetchCoordinationSessions: () => Promise<void>;
  fetchCoordinationStats: () => Promise<void>;
  fetchCoordinationSessionDetail: (id: string) => Promise<void>;
  startTeam: (body: {
    leadAgentId: string; leadAgentName: string; title: string;
    pattern: 'pipeline' | 'fan-out' | 'consensus';
    tasks: Array<{ title: string; description: string; agentName: string; dependencies?: string[] }>;
  }) => Promise<boolean>;
  cancelCoordinationSession: (id: string) => Promise<void>;


  // Intervention actions
  respondToIntervention: (id: string, action: 'approve' | 'deny' | 'feedback') => Promise<void>;

  // Ticket actions
  createTicket: (body: { title: string; description: string; priority: string; category: string; assigned_to?: string }) => Promise<boolean>;
  updateTicket: (id: string, updates: Partial<Ticket>) => Promise<void>;
  deleteTicket: (id: string) => Promise<void>;
  fetchTicketNotes: (id: string) => Promise<void>;
  addTicketNote: (id: string, content: string) => Promise<boolean>;

}

export const useHubStore = create<HubState>((set, get) => ({
  // Agents
  agents: [],
  showDecommissioned: false,
  setShowDecommissioned: (v) => set({ showDecommissioned: v }),
  selectedAgentId: null,

  // Orchestration
  stats: null,

  // Interventions
  interventions: [],
  interventionPagination: null,
  interventionPage: 1,
  setInterventionPage: (p) => set({ interventionPage: p }),
  respondingTo: null,
  setRespondingTo: (id) => set({ respondingTo: id }),
  responseText: '',
  setResponseText: (t) => set({ responseText: t }),

  // Tasks
  tasks: [],
  taskStats: null,
  taskPagination: null,
  taskPage: 1,
  taskStatusFilter: '',
  taskAgentFilter: '',
  selectedTaskDetail: null,
  setTaskPage: (p) => set({ taskPage: p }),
  setTaskStatusFilter: (s) => set({ taskStatusFilter: s, taskPage: 1 }),
  setTaskAgentFilter: (s) => set({ taskAgentFilter: s, taskPage: 1 }),

  // Tickets
  tickets: [],
  ticketPagination: null,
  ticketPage: 1,
  ticketFilter: 'open',
  ticketSource: 'all',
  ticketSearch: '',
  setTicketPage: (p) => set({ ticketPage: p }),
  setTicketFilter: (f) => set({ ticketFilter: f, ticketPage: 1 }),
  setTicketSource: (s) => set({ ticketSource: s, ticketPage: 1 }),
  setTicketSearch: (s) => set({ ticketSearch: s }),

  // Content Feed (unified)
  contentItems: [],
  contentPagination: null,
  contentPage: 1,
  contentAgentFilter: '',
  contentSourceFilter: '',
  contentSeverityFilter: '',
  contentCategoryFilter: '',
  contentDateFrom: '',
  contentDateTo: '',
  contentSearch: '',
  contentAgents: [],
  contentCategories: [],
  selectedContentItem: null,
  setContentPage: (p) => set({ contentPage: p }),
  setContentAgentFilter: (s) => set({ contentAgentFilter: s, contentPage: 1 }),
  setContentSourceFilter: (s) => set({ contentSourceFilter: s, contentPage: 1 }),
  setContentSeverityFilter: (s) => set({ contentSeverityFilter: s, contentPage: 1 }),
  setContentCategoryFilter: (s) => set({ contentCategoryFilter: s, contentPage: 1 }),
  setContentDateFrom: (s) => set({ contentDateFrom: s, contentPage: 1 }),
  setContentDateTo: (s) => set({ contentDateTo: s, contentPage: 1 }),
  setContentSearch: (s) => set({ contentSearch: s, contentPage: 1 }),
  setSelectedContentItem: (item) => set({ selectedContentItem: item }),

  // Workflows
  workflows: [],
  selectedWorkflow: null,
  setSelectedWorkflow: (w) => set({ selectedWorkflow: w, workflowRuns: [], workflowRunsTotal: 0 }),
  showCreateWorkflow: false,
  setShowCreateWorkflow: (v) => set({ showCreateWorkflow: v }),
  workflowRuns: [],
  workflowRunsTotal: 0,

  // Costs
  costSummary: null,
  dailyCosts: [],
  agentCosts: [],
  costAgentFilter: '',
  setCostAgentFilter: (s) => set({ costAgentFilter: s }),

  // Audit
  auditEntries: [],
  auditTotal: 0,
  auditOffset: 0,
  auditEntityFilter: '',
  auditActionFilter: '',
  auditActorFilter: '',
  setAuditOffset: (n) => set({ auditOffset: n }),
  setAuditEntityFilter: (s) => set({ auditEntityFilter: s, auditOffset: 0 }),
  setAuditActionFilter: (s) => set({ auditActionFilter: s, auditOffset: 0 }),
  setAuditActorFilter: (s) => set({ auditActorFilter: s, auditOffset: 0 }),

  // Guardrails
  guardrails: [],
  showCreateGuardrail: false,
  setShowCreateGuardrail: (v) => set({ showCreateGuardrail: v }),

  // Providers
  providersList: [],
  providerHealth: null,
  expandedProvider: null,
  providerModels: {},
  setExpandedProvider: (id) => set({ expandedProvider: id }),
  userProviderKeys: [],

  // Coordination
  coordinationSessions: [],
  coordinationStats: null,
  selectedCoordinationSession: null,
  setSelectedCoordinationSession: (s) => set({ selectedCoordinationSession: s }),
  showStartTeam: false,
  setShowStartTeam: (v) => set({ showStartTeam: v }),

  // Modals


  showCreateTicket: false,
  setShowCreateTicket: (v) => set({ showCreateTicket: v }),
  showTicketDetail: null,
  setShowTicketDetail: (t) => set({ showTicketDetail: t, ticketNotes: [], ticketNotesLoading: false }),
  ticketNotes: [],
  ticketNotesLoading: false,
  selectedTask: null,
  setSelectedTask: (t) => set({ selectedTask: t }),

  // Loading
  loading: {},

  // ============================
  // Data fetching actions
  // ============================

  fetchAgents: async () => {
    set((s) => ({ loading: { ...s.loading, agents: true } }));
    try {
      const { agents } = await hubApi.agents.list(get().showDecommissioned);
      set({ agents });
    } catch (err) {
      console.error('Failed to fetch agents:', err);
    } finally {
      set((s) => ({ loading: { ...s.loading, agents: false } }));
    }
  },

  fetchOrchestration: async () => {
    try {
      const stats = await hubApi.orchestration.stats();
      set({ stats });
    } catch (err) {
      console.error('Failed to fetch orchestration stats:', err);
    }
  },

  fetchInterventions: async () => {
    const isInitial = get().interventions.length === 0 && !get().interventionPagination;
    if (isInitial) set((s) => ({ loading: { ...s.loading, interventions: true } }));
    try {
      const data = await hubApi.interventions.list({ status: 'pending', page: get().interventionPage });
      set({ interventions: data.interventions || [], interventionPagination: data.pagination || null });
    } catch (err) {
      console.error('Failed to fetch interventions:', err);
    } finally {
      if (isInitial) set((s) => ({ loading: { ...s.loading, interventions: false } }));
    }
  },

  fetchTasks: async () => {
    set((s) => ({ loading: { ...s.loading, tasks: true } }));
    try {
      const { taskPage, taskStatusFilter, taskAgentFilter } = get();
      const data = await hubApi.tasks.list({ page: taskPage, status: taskStatusFilter, agent_id: taskAgentFilter });
      set({ tasks: data.tasks || [], taskPagination: data.pagination || null });
    } catch (err) {
      console.error('Failed to fetch tasks:', err);
    } finally {
      set((s) => ({ loading: { ...s.loading, tasks: false } }));
    }
  },

  fetchTaskStats: async () => {
    try {
      const stats = await hubApi.tasks.stats();
      set({ taskStats: stats });
    } catch (err) {
      console.error('Failed to fetch task stats:', err);
    }
  },

  fetchTaskDetail: async (id: string) => {
    try {
      const detail = await hubApi.tasks.detail(id);
      set({ selectedTaskDetail: detail });
    } catch (err) {
      console.error('Failed to fetch task detail:', err);
    }
  },

  fetchTickets: async () => {
    const isInitial = get().tickets.length === 0 && !get().ticketPagination;
    if (isInitial) set((s) => ({ loading: { ...s.loading, tickets: true } }));
    try {
      const { ticketPage, ticketFilter, ticketSource, ticketSearch } = get();
      const data = await hubApi.tickets.list({ page: ticketPage, filter: ticketFilter, source: ticketSource, search: ticketSearch });
      set({ tickets: data.tickets || [], ticketPagination: data.pagination || null });
    } catch (err) {
      console.error('Failed to fetch tickets:', err);
    } finally {
      if (isInitial) set((s) => ({ loading: { ...s.loading, tickets: false } }));
    }
  },

  fetchContentFeed: async () => {
    const isInitial = get().contentItems.length === 0 && !get().contentPagination;
    if (isInitial) set((s) => ({ loading: { ...s.loading, content: true } }));
    try {
      const { contentPage, contentAgentFilter, contentSourceFilter, contentSeverityFilter, contentCategoryFilter, contentDateFrom, contentDateTo, contentSearch } = get();
      const data = await hubApi.content.feed({
        page: contentPage,
        agent: contentAgentFilter || undefined,
        source: contentSourceFilter || undefined,
        severity: contentSeverityFilter || undefined,
        category: contentCategoryFilter || undefined,
        dateFrom: contentDateFrom || undefined,
        dateTo: contentDateTo || undefined,
        search: contentSearch || undefined,
      });
      // Map raw agent_findings rows to ContentFeedItem shape
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const items = ((data.items || []) as any[]).map((raw) => ({
        ...raw,
        content: raw.content || raw.finding || '',
        source: raw.source || 'finding',
        sort_date: raw.sort_date || raw.created_at || '',
        tokens: raw.tokens || 0,
        cost: raw.cost || 0,
        duration_ms: raw.duration_ms || 0,
        input: raw.input || '',
      })) as ContentFeedItem[];
      set({ contentItems: items, contentPagination: data.pagination || null });
    } catch (err) {
      console.error('Failed to fetch content feed:', err);
    } finally {
      if (isInitial) set((s) => ({ loading: { ...s.loading, content: false } }));
    }
  },

  fetchContentAgents: async () => {
    try {
      const data = await hubApi.content.feedAgents();
      set({ contentAgents: data.agents || [] });
    } catch (err) {
      console.error('Failed to fetch content agents:', err);
    }
  },

  fetchContentCategories: async () => {
    try {
      const data = await hubApi.content.feedCategories();
      set({ contentCategories: data.categories || [] });
    } catch (err) {
      console.error('Failed to fetch content categories:', err);
    }
  },

  // Workflow actions
  fetchWorkflows: async () => {
    set((s) => ({ loading: { ...s.loading, workflows: true } }));
    try {
      const data = await hubApi.workflows.list();
      set({ workflows: data.workflows || [] });
    } catch (err) {
      console.error('Failed to fetch workflows:', err);
    } finally {
      set((s) => ({ loading: { ...s.loading, workflows: false } }));
    }
  },

  fetchWorkflowRuns: async (workflowId: string) => {
    try {
      const data = await hubApi.workflows.runs(workflowId);
      set({ workflowRuns: data.runs || [], workflowRunsTotal: data.total || 0 });
    } catch (err) {
      console.error('Failed to fetch workflow runs:', err);
    }
  },

  createWorkflow: async (body) => {
    try {
      const data = await hubApi.workflows.create(body);
      await get().fetchWorkflows();
      if (data.workflow) set({ selectedWorkflow: data.workflow });
      return true;
    } catch (err) {
      console.error('Failed to create workflow:', err);
      return false;
    }
  },

  updateWorkflow: async (id, body) => {
    try {
      const data = await hubApi.workflows.update(id, body);
      await get().fetchWorkflows();
      if (data.workflow) set({ selectedWorkflow: data.workflow });
      return true;
    } catch (err) {
      console.error('Failed to update workflow:', err);
      return false;
    }
  },

  runWorkflow: async (id, input) => {
    try {
      await hubApi.workflows.run(id, input);
      return true;
    } catch (err) {
      console.error('Failed to run workflow:', err);
      return false;
    }
  },

  // Cost actions
  fetchCosts: async () => {
    set((s) => ({ loading: { ...s.loading, costs: true } }));
    try {
      const { costAgentFilter } = get();
      const data = await hubApi.costs.summary({ agentId: costAgentFilter || undefined, days: 30 });
      set({ costSummary: data.summary || null, dailyCosts: data.dailyCosts || [], agentCosts: data.byAgent || [] });
    } catch (err) {
      console.error('Failed to fetch costs:', err);
    } finally {
      set((s) => ({ loading: { ...s.loading, costs: false } }));
    }
  },

  // Audit actions
  fetchAudit: async () => {
    set((s) => ({ loading: { ...s.loading, audit: true } }));
    try {
      const { auditOffset, auditEntityFilter, auditActionFilter, auditActorFilter } = get();
      const data = await hubApi.audit.list({
        entity_type: auditEntityFilter || undefined,
        action: auditActionFilter || undefined,
        actor: auditActorFilter || undefined,
        limit: 50,
        offset: auditOffset,
      });
      set({ auditEntries: data.audit_trail || [], auditTotal: data.total || 0 });
    } catch (err) {
      console.error('Failed to fetch audit:', err);
    } finally {
      set((s) => ({ loading: { ...s.loading, audit: false } }));
    }
  },

  // Guardrail actions
  fetchGuardrails: async () => {
    set((s) => ({ loading: { ...s.loading, guardrails: true } }));
    try {
      const data = await hubApi.guardrails.list();
      set({ guardrails: data.guardrails || [] });
    } catch (err) {
      console.error('Failed to fetch guardrails:', err);
    } finally {
      set((s) => ({ loading: { ...s.loading, guardrails: false } }));
    }
  },

  createGuardrail: async (body) => {
    try {
      await hubApi.guardrails.create(body);
      await get().fetchGuardrails();
      return true;
    } catch (err) {
      console.error('Failed to create guardrail:', err);
      return false;
    }
  },

  updateGuardrail: async (id, body) => {
    try {
      const data = await hubApi.guardrails.update(id, body);
      set((s) => ({
        guardrails: s.guardrails.map((g) =>
          g.id === id ? { ...g, ...data.guardrail } : g,
        ),
      }));
      return true;
    } catch (err) {
      console.error('Failed to update guardrail:', err);
      return false;
    }
  },

  deleteGuardrail: async (id) => {
    try {
      await hubApi.guardrails.delete(id);
      set((s) => ({
        guardrails: s.guardrails.filter((g) => g.id !== id),
      }));
      return true;
    } catch (err) {
      console.error('Failed to delete guardrail:', err);
      return false;
    }
  },

  // Provider actions
  fetchProviders: async () => {
    set((s) => ({ loading: { ...s.loading, providers: true } }));
    try {
      const data = await hubApi.providers.list();
      set({ providersList: data.providers || [] });
    } catch (err) {
      console.error('Failed to fetch providers:', err);
    } finally {
      set((s) => ({ loading: { ...s.loading, providers: false } }));
    }
  },

  fetchProviderHealth: async () => {
    try {
      const data = await hubApi.providers.health();
      set({ providerHealth: data });
    } catch (err) {
      console.error('Failed to fetch provider health:', err);
    }
  },

  fetchProviderModels: async (id: string) => {
    try {
      const data = await hubApi.providers.models(id);
      set((s) => ({ providerModels: { ...s.providerModels, [id]: data.models || [] } }));
    } catch (err) {
      console.error('Failed to fetch provider models:', err);
    }
  },

  runProviderHealthCheck: async () => {
    set((s) => ({ loading: { ...s.loading, providerHealthCheck: true } }));
    try {
      const data = await hubApi.providers.runHealthCheck();
      set({ providerHealth: data });
      // Refresh provider list to get updated health_status and last_health_check
      await get().fetchProviders();
    } catch (err) {
      console.error('Failed to run provider health check:', err);
    } finally {
      set((s) => ({ loading: { ...s.loading, providerHealthCheck: false } }));
    }
  },

  updateProvider: async (id, body) => {
    try {
      const data = await hubApi.providers.update(id, body);
      // Update the provider in the list
      set((s) => ({
        providersList: s.providersList.map((p) =>
          p.id === id ? { ...p, ...data.provider } : p,
        ),
      }));
      return true;
    } catch (err) {
      console.error('Failed to update provider:', err);
      return false;
    }
  },

  fetchUserProviderKeys: async () => {
    try {
      const data = await hubApi.userProviders.list();
      set({ userProviderKeys: data.keys || [] });
    } catch (err) {
      console.error('Failed to fetch user provider keys:', err);
    }
  },

  // Coordination actions
  fetchCoordinationSessions: async () => {
    set((s) => ({ loading: { ...s.loading, coordinationSessions: true } }));
    try {
      const data = await hubApi.coordination.sessions();
      set({ coordinationSessions: data.sessions || [] });
    } catch (err) {
      console.error('Failed to fetch coordination sessions:', err);
    } finally {
      set((s) => ({ loading: { ...s.loading, coordinationSessions: false } }));
    }
  },

  fetchCoordinationStats: async () => {
    try {
      const data = await hubApi.coordination.stats();
      set({ coordinationStats: data });
    } catch (err) {
      console.error('Failed to fetch coordination stats:', err);
    }
  },

  fetchCoordinationSessionDetail: async (id: string) => {
    try {
      const data = await hubApi.coordination.sessionDetail(id);
      set({ selectedCoordinationSession: data.session || null });
    } catch (err) {
      console.error('Failed to fetch session detail:', err);
    }
  },

  startTeam: async (body) => {
    try {
      await hubApi.coordination.startTeam(body);
      get().fetchCoordinationSessions();
      get().fetchCoordinationStats();
      return true;
    } catch (err) {
      console.error('Failed to start team:', err);
      return false;
    }
  },

  cancelCoordinationSession: async (id: string) => {
    try {
      await hubApi.coordination.cancelSession(id);
      get().fetchCoordinationSessions();
      get().fetchCoordinationStats();
    } catch (err) {
      console.error('Failed to cancel session:', err);
    }
  },

  // ============================
  // Intervention actions
  // ============================

  respondToIntervention: async (id, action) => {
    try {
      await hubApi.interventions.respond(id, action, get().responseText || undefined);
      set({ respondingTo: null, responseText: '' });
      await get().fetchInterventions();
    } catch (err) {
      console.error('Failed to respond to intervention:', err);
    }
  },

  // ============================
  // Ticket actions
  // ============================

  createTicket: async (body) => {
    try {
      await hubApi.tickets.create(body);
      await get().fetchTickets();
      return true;
    } catch (err) {
      console.error('Failed to create ticket:', err);
      return false;
    }
  },

  updateTicket: async (id, updates) => {
    try {
      await hubApi.tickets.update(id, updates);
      await get().fetchTickets();
      const detail = get().showTicketDetail;
      if (detail?.id === id) {
        set({ showTicketDetail: { ...detail, ...updates } as Ticket });
      }
    } catch (err) {
      console.error('Failed to update ticket:', err);
    }
  },

  deleteTicket: async (id) => {
    try {
      await hubApi.tickets.delete(id);
      set({ showTicketDetail: null });
      await get().fetchTickets();
    } catch (err) {
      console.error('Failed to delete ticket:', err);
    }
  },

  fetchTicketNotes: async (id) => {
    set({ ticketNotesLoading: true });
    try {
      const data = await hubApi.tickets.notes(id);
      set({ ticketNotes: data.notes || [] });
    } catch (err) {
      console.error('Failed to fetch ticket notes:', err);
    } finally {
      set({ ticketNotesLoading: false });
    }
  },

  addTicketNote: async (id, content) => {
    try {
      const data = await hubApi.tickets.addNote(id, content);
      if (data.note) {
        set((s) => ({ ticketNotes: [...s.ticketNotes, data.note] }));
      }
      return true;
    } catch (err) {
      console.error('Failed to add ticket note:', err);
      return false;
    }
  },

}));
