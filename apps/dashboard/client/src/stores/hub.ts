import { create } from 'zustand';
import {
  hubApi,
  type Agent,
  type AgentLog,
  type AgentTask,
  type Intervention,
  type OrchestrationStats,
  type Pagination,
  type Task,
  type TaskStats,
  type TaskDetail,
  type Ticket,
  type TicketNote,
  type SystemMetrics,
  type AgentActivity,
  type AgentSchedule,
  type RecentFinding,
  type ReportFeedItem,
  type SchedulerStatus,
  type ContentFeedItem,
  type FleetMemoryStats,
  type FleetMemoryItem,
  type FleetRecallEvent,
  type CoordinationSession,
  type CoordinationStats,
  type Workflow,
  type CostSummary,
  type DailyCost,
  type AuditEntry,
  type Guardrail,
  type Provider,
  type ProviderModel,
  type ProviderHealth,
} from '../hooks/useHubApi';

export type HubTab =
  | 'overview' | 'fleet' | 'executions' | 'scheduler' | 'coordination'
  | 'interventions' | 'tickets' | 'content' | 'memory' | 'threads'
  | 'costs' | 'providers' | 'guardrails' | 'audit'
  | 'workflows' | 'push'
  | 'prompt-lab' | 'nl-orchestrate' | 'agent-chat' | 'goals'
  | 'cost-optimizer' | 'knowledge' | 'health' | 'evolution'
  | 'events' | 'leaderboard';

export type MemorySubView = 'timeline' | 'episodic' | 'semantic' | 'procedural';

interface HubState {
  // UI
  activeTab: HubTab;
  setActiveTab: (tab: HubTab) => void;

  // Agents
  agents: Agent[];
  showDecommissioned: boolean;
  setShowDecommissioned: (v: boolean) => void;
  selectedAgentId: string | null;
  selectedAgent: Agent | null;
  agentLogs: AgentLog[];
  agentTasks: AgentTask[];

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

  // Reports
  metrics: SystemMetrics | null;
  activity: AgentActivity[];
  findings: RecentFinding[];
  findingsPagination: Pagination | null;
  findingPage: number;
  findingSeverityFilter: string;
  findingSearch: string;
  findingAgentFilter: string;
  selectedFinding: RecentFinding | null;
  setFindingPage: (p: number) => void;
  setFindingSeverityFilter: (s: string) => void;
  setFindingSearch: (s: string) => void;
  setFindingAgentFilter: (s: string) => void;
  setSelectedFinding: (f: RecentFinding | null) => void;

  // Feed (unified reports)
  feedItems: ReportFeedItem[];
  feedPagination: Pagination | null;
  feedPage: number;
  feedAgentFilter: string;
  feedCategoryFilter: string;
  feedDateFrom: string;
  feedDateTo: string;
  feedAgents: string[];
  feedCategories: string[];
  selectedFeedItem: ReportFeedItem | null;
  feedSearch: string;
  feedSeverityFilter: string;
  feedTypeFilter: string;
  setFeedPage: (p: number) => void;
  setFeedAgentFilter: (s: string) => void;
  setFeedCategoryFilter: (s: string) => void;
  setFeedDateFrom: (s: string) => void;
  setFeedDateTo: (s: string) => void;
  setFeedSearch: (s: string) => void;
  setFeedSeverityFilter: (s: string) => void;
  setFeedTypeFilter: (s: string) => void;
  setSelectedFeedItem: (item: ReportFeedItem | null) => void;

  // Scheduler
  schedules: AgentSchedule[];
  schedulerStatus: SchedulerStatus | null;

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

  // Fleet Memory
  memoryStats: FleetMemoryStats | null;
  memorySearchResults: FleetMemoryItem[];
  memoryRecentItems: FleetMemoryItem[];
  memorySearchQuery: string;
  memoryTierFilter: string;
  memoryAgentFilter: string;
  memorySubView: MemorySubView;
  memorySourceFilter: string;
  memoryDateFrom: string;
  memoryDateTo: string;
  memoryPage: number;
  memoryPagination: { total: number; page: number; limit: number; totalPages: number } | null;
  memoryRecalls: FleetRecallEvent[];
  memoryRecallsPagination: { total: number; page: number; limit: number; totalPages: number } | null;
  setMemorySearchQuery: (s: string) => void;
  setMemoryTierFilter: (s: string) => void;
  setMemoryAgentFilter: (s: string) => void;
  setMemorySubView: (v: MemorySubView) => void;
  setMemorySourceFilter: (s: string) => void;
  setMemoryDateFrom: (s: string) => void;
  setMemoryDateTo: (s: string) => void;
  setMemoryPage: (p: number) => void;

  // Workflows
  workflows: Workflow[];
  selectedWorkflow: Workflow | null;
  setSelectedWorkflow: (w: Workflow | null) => void;
  showCreateWorkflow: boolean;
  setShowCreateWorkflow: (v: boolean) => void;

  // Costs
  costSummary: CostSummary | null;
  dailyCosts: DailyCost[];
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

  // Coordination
  coordinationSessions: CoordinationSession[];
  coordinationStats: CoordinationStats | null;
  selectedCoordinationSession: CoordinationSession | null;
  setSelectedCoordinationSession: (s: CoordinationSession | null) => void;
  showStartTeam: boolean;
  setShowStartTeam: (v: boolean) => void;

  // Modals
  showCreateAgent: boolean;
  setShowCreateAgent: (v: boolean) => void;
  showRunAgent: string | null;
  setShowRunAgent: (id: string | null) => void;
  showAgentDetail: string | null;
  setShowAgentDetail: (id: string | null) => void;
  showCreateTicket: boolean;
  setShowCreateTicket: (v: boolean) => void;
  showTicketDetail: Ticket | null;
  setShowTicketDetail: (t: Ticket | null) => void;
  ticketNotes: TicketNote[];
  ticketNotesLoading: boolean;
  selectedTask: Task | null;
  setSelectedTask: (t: Task | null) => void;

  // Batch
  batchRunning: boolean;
  batchResult: { started: number; agents: string[] } | null;

  // Loading
  loading: Record<string, boolean>;

  // ============================
  // Actions
  // ============================
  fetchAgents: () => Promise<void>;
  fetchAgentDetail: (id: string) => Promise<void>;
  fetchOrchestration: () => Promise<void>;
  fetchInterventions: () => Promise<void>;
  fetchTasks: () => Promise<void>;
  fetchTaskStats: () => Promise<void>;
  fetchTaskDetail: (id: string) => Promise<void>;
  fetchTickets: () => Promise<void>;
  fetchMetrics: () => Promise<void>;
  fetchActivity: () => Promise<void>;
  fetchFindings: () => Promise<void>;
  fetchFeed: () => Promise<void>;
  fetchFeedAgents: () => Promise<void>;
  fetchFeedCategories: () => Promise<void>;
  fetchSchedules: () => Promise<void>;
  fetchSchedulerStatus: () => Promise<void>;
  fetchContentFeed: () => Promise<void>;
  fetchContentAgents: () => Promise<void>;
  fetchContentCategories: () => Promise<void>;
  fetchMemoryStats: () => Promise<void>;
  searchMemory: (q: string) => Promise<void>;
  fetchMemoryRecent: () => Promise<void>;
  fetchMemoryRecalls: () => Promise<void>;

  // Workflow actions
  fetchWorkflows: () => Promise<void>;
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

  // Provider actions
  fetchProviders: () => Promise<void>;
  fetchProviderHealth: () => Promise<void>;
  fetchProviderModels: (id: string) => Promise<void>;

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

  // Agent actions
  createAgent: (body: { name: string; type: string; description: string; system_prompt: string }) => Promise<boolean>;
  runAgent: (id: string, prompt?: string) => Promise<boolean>;
  stopAgent: (id: string) => Promise<void>;
  decommissionAgent: (id: string) => Promise<void>;
  recommissionAgent: (id: string) => Promise<void>;
  deleteAgent: (id: string) => Promise<void>;
  batchProcessAgents: () => Promise<void>;
  batchPauseAgents: () => Promise<void>;
  processAgent: (id: string) => Promise<void>;

  // Intervention actions
  respondToIntervention: (id: string, action: 'approve' | 'deny' | 'feedback') => Promise<void>;

  // Ticket actions
  createTicket: (body: { title: string; description: string; priority: string; category: string }) => Promise<boolean>;
  updateTicket: (id: string, updates: Partial<Ticket>) => Promise<void>;
  deleteTicket: (id: string) => Promise<void>;
  fetchTicketNotes: (id: string) => Promise<void>;
  addTicketNote: (id: string, content: string) => Promise<boolean>;

  // Scheduler actions
  toggleScheduler: (action: 'start' | 'stop') => Promise<void>;
  updateSchedule: (agentId: string, scheduleType: string, intervalMinutes?: number, executionMode?: string) => Promise<void>;
  updateAgentModel: (agentId: string, modelId: string) => Promise<void>;

  // Ribbon data (lightweight)
  ribbonData: { running: number; pendingInterventions: number; openTickets: number };
  fetchRibbonData: () => Promise<void>;
}

export const useHubStore = create<HubState>((set, get) => ({
  // UI
  activeTab: 'overview',
  setActiveTab: (tab) => set({ activeTab: tab }),

  // Agents
  agents: [],
  showDecommissioned: false,
  setShowDecommissioned: (v) => set({ showDecommissioned: v }),
  selectedAgentId: null,
  selectedAgent: null,
  agentLogs: [],
  agentTasks: [],

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

  // Reports
  metrics: null,
  activity: [],
  findings: [],
  findingsPagination: null,
  findingPage: 1,
  findingSeverityFilter: '',
  findingSearch: '',
  findingAgentFilter: '',
  selectedFinding: null,
  setFindingPage: (p) => set({ findingPage: p }),
  setFindingSeverityFilter: (s) => set({ findingSeverityFilter: s, findingPage: 1 }),
  setFindingSearch: (s) => set({ findingSearch: s }),
  setFindingAgentFilter: (s) => set({ findingAgentFilter: s, findingPage: 1 }),
  setSelectedFinding: (f) => set({ selectedFinding: f }),

  // Feed (unified reports)
  feedItems: [],
  feedPagination: null,
  feedPage: 1,
  feedAgentFilter: '',
  feedCategoryFilter: '',
  feedDateFrom: '',
  feedDateTo: '',
  feedSearch: '',
  feedSeverityFilter: '',
  feedTypeFilter: '',
  feedAgents: [],
  feedCategories: [],
  selectedFeedItem: null,
  setFeedPage: (p) => set({ feedPage: p }),
  setFeedAgentFilter: (s) => set({ feedAgentFilter: s, feedPage: 1 }),
  setFeedCategoryFilter: (s) => set({ feedCategoryFilter: s, feedPage: 1 }),
  setFeedDateFrom: (s) => set({ feedDateFrom: s, feedPage: 1 }),
  setFeedDateTo: (s) => set({ feedDateTo: s, feedPage: 1 }),
  setFeedSearch: (s) => set({ feedSearch: s, feedPage: 1 }),
  setFeedSeverityFilter: (s) => set({ feedSeverityFilter: s, feedPage: 1 }),
  setFeedTypeFilter: (s) => set({ feedTypeFilter: s, feedPage: 1 }),
  setSelectedFeedItem: (item) => set({ selectedFeedItem: item }),

  // Scheduler
  schedules: [],
  schedulerStatus: null,

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

  // Fleet Memory
  memoryStats: null,
  memorySearchResults: [],
  memoryRecentItems: [],
  memorySearchQuery: '',
  memoryTierFilter: '',
  memoryAgentFilter: '',
  memorySubView: 'timeline',
  memorySourceFilter: '',
  memoryDateFrom: '',
  memoryDateTo: '',
  memoryPage: 1,
  memoryPagination: null,
  memoryRecalls: [],
  memoryRecallsPagination: null,
  setMemorySearchQuery: (s) => set({ memorySearchQuery: s }),
  setMemoryTierFilter: (s) => set({ memoryTierFilter: s }),
  setMemoryAgentFilter: (s) => set({ memoryAgentFilter: s }),
  setMemorySubView: (v) => set({ memorySubView: v, memoryPage: 1 }),
  setMemorySourceFilter: (s) => set({ memorySourceFilter: s, memoryPage: 1 }),
  setMemoryDateFrom: (s) => set({ memoryDateFrom: s, memoryPage: 1 }),
  setMemoryDateTo: (s) => set({ memoryDateTo: s, memoryPage: 1 }),
  setMemoryPage: (p) => set({ memoryPage: p }),

  // Workflows
  workflows: [],
  selectedWorkflow: null,
  setSelectedWorkflow: (w) => set({ selectedWorkflow: w }),
  showCreateWorkflow: false,
  setShowCreateWorkflow: (v) => set({ showCreateWorkflow: v }),

  // Costs
  costSummary: null,
  dailyCosts: [],
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

  // Coordination
  coordinationSessions: [],
  coordinationStats: null,
  selectedCoordinationSession: null,
  setSelectedCoordinationSession: (s) => set({ selectedCoordinationSession: s }),
  showStartTeam: false,
  setShowStartTeam: (v) => set({ showStartTeam: v }),

  // Modals
  showCreateAgent: false,
  setShowCreateAgent: (v) => set({ showCreateAgent: v }),
  showRunAgent: null,
  setShowRunAgent: (id) => set({ showRunAgent: id }),
  showAgentDetail: null,
  setShowAgentDetail: (id) => set({ showAgentDetail: id }),
  showCreateTicket: false,
  setShowCreateTicket: (v) => set({ showCreateTicket: v }),
  showTicketDetail: null,
  setShowTicketDetail: (t) => set({ showTicketDetail: t, ticketNotes: [], ticketNotesLoading: false }),
  ticketNotes: [],
  ticketNotesLoading: false,
  selectedTask: null,
  setSelectedTask: (t) => set({ selectedTask: t }),

  // Batch
  batchRunning: false,
  batchResult: null,

  // Loading
  loading: {},

  // Ribbon data
  ribbonData: { running: 0, pendingInterventions: 0, openTickets: 0 },

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

  fetchAgentDetail: async (id: string) => {
    try {
      const data = await hubApi.agents.detail(id);
      set({ selectedAgent: data.agent, agentLogs: data.logs || [], agentTasks: data.tasks || [] });
    } catch (err) {
      console.error('Failed to fetch agent detail:', err);
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
    set((s) => ({ loading: { ...s.loading, interventions: true } }));
    try {
      const data = await hubApi.interventions.list({ status: 'pending', page: get().interventionPage });
      set({ interventions: data.interventions || [], interventionPagination: data.pagination || null });
    } catch (err) {
      console.error('Failed to fetch interventions:', err);
    } finally {
      set((s) => ({ loading: { ...s.loading, interventions: false } }));
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
    set((s) => ({ loading: { ...s.loading, tickets: true } }));
    try {
      const { ticketPage, ticketFilter, ticketSource, ticketSearch } = get();
      const data = await hubApi.tickets.list({ page: ticketPage, filter: ticketFilter, source: ticketSource, search: ticketSearch });
      set({ tickets: data.tickets || [], ticketPagination: data.pagination || null });
    } catch (err) {
      console.error('Failed to fetch tickets:', err);
    } finally {
      set((s) => ({ loading: { ...s.loading, tickets: false } }));
    }
  },

  fetchMetrics: async () => {
    try {
      const metrics = await hubApi.reports.metrics();
      set({ metrics });
    } catch (err) {
      console.error('Failed to fetch metrics:', err);
    }
  },

  fetchActivity: async () => {
    try {
      const data = await hubApi.reports.activity();
      set({ activity: data.activity || [] });
    } catch (err) {
      console.error('Failed to fetch activity:', err);
    }
  },

  fetchFindings: async () => {
    try {
      const { findingPage, findingSeverityFilter, findingSearch, findingAgentFilter } = get();
      const data = await hubApi.reports.findings({
        page: findingPage,
        severity: findingSeverityFilter || undefined,
        search: findingSearch || undefined,
        agent_name: findingAgentFilter || undefined,
      });
      set({ findings: data.findings || [], findingsPagination: data.pagination || null });
    } catch (err) {
      console.error('Failed to fetch findings:', err);
    }
  },

  fetchFeed: async () => {
    set((s) => ({ loading: { ...s.loading, feed: true } }));
    try {
      const { feedPage, feedAgentFilter, feedCategoryFilter, feedDateFrom, feedDateTo, feedSearch, feedSeverityFilter, feedTypeFilter } = get();
      const data = await hubApi.reports.feed({
        page: feedPage,
        agent: feedAgentFilter || undefined,
        category: feedCategoryFilter || undefined,
        dateFrom: feedDateFrom || undefined,
        dateTo: feedDateTo || undefined,
        search: feedSearch || undefined,
        severity: feedSeverityFilter || undefined,
        type: feedTypeFilter || undefined,
      });
      set({ feedItems: data.items || [], feedPagination: data.pagination || null });
    } catch (err) {
      console.error('Failed to fetch feed:', err);
    } finally {
      set((s) => ({ loading: { ...s.loading, feed: false } }));
    }
  },

  fetchFeedAgents: async () => {
    try {
      const data = await hubApi.reports.feedAgents();
      set({ feedAgents: data.agents || [] });
    } catch (err) {
      console.error('Failed to fetch feed agents:', err);
    }
  },

  fetchFeedCategories: async () => {
    try {
      const data = await hubApi.reports.feedCategories();
      set({ feedCategories: data.categories || [] });
    } catch (err) {
      console.error('Failed to fetch feed categories:', err);
    }
  },

  fetchSchedules: async () => {
    try {
      const data = await hubApi.reports.schedules();
      set({ schedules: data.schedules || [] });
    } catch (err) {
      console.error('Failed to fetch schedules:', err);
    }
  },

  fetchSchedulerStatus: async () => {
    try {
      const status = await hubApi.reports.scheduler();
      set({ schedulerStatus: status });
    } catch (err) {
      console.error('Failed to fetch scheduler status:', err);
    }
  },

  fetchContentFeed: async () => {
    set((s) => ({ loading: { ...s.loading, content: true } }));
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
      set({ contentItems: data.items || [], contentPagination: data.pagination || null });
    } catch (err) {
      console.error('Failed to fetch content feed:', err);
    } finally {
      set((s) => ({ loading: { ...s.loading, content: false } }));
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


  fetchMemoryStats: async () => {
    try {
      const stats = await hubApi.memory.stats();
      set({ memoryStats: stats });
    } catch (err) {
      console.error('Failed to fetch memory stats:', err);
    }
  },

  searchMemory: async (q: string) => {
    if (!q.trim()) {
      set({ memorySearchResults: [], memoryPagination: null });
      return;
    }
    set((s) => ({ loading: { ...s.loading, memorySearch: true } }));
    try {
      const { memoryTierFilter, memoryAgentFilter, memorySourceFilter, memoryPage } = get();
      const data = await hubApi.memory.search({
        q,
        tier: memoryTierFilter || undefined,
        agent_id: memoryAgentFilter || undefined,
        source_type: memorySourceFilter || undefined,
        limit: 30,
        page: memoryPage,
      });
      set({
        memorySearchResults: data.memories || [],
        memoryPagination: data.total != null ? { total: data.total, page: data.page, limit: data.limit, totalPages: data.totalPages } : null,
      });
    } catch (err) {
      console.error('Failed to search memory:', err);
    } finally {
      set((s) => ({ loading: { ...s.loading, memorySearch: false } }));
    }
  },

  fetchMemoryRecent: async () => {
    set((s) => ({ loading: { ...s.loading, memoryRecent: true } }));
    try {
      const { memoryAgentFilter, memorySourceFilter, memoryTierFilter, memoryDateFrom, memoryDateTo, memoryPage } = get();
      const data = await hubApi.memory.recent({
        limit: 30,
        page: memoryPage,
        agent_id: memoryAgentFilter || undefined,
        source_type: memorySourceFilter || undefined,
        tier: memoryTierFilter || undefined,
        dateFrom: memoryDateFrom || undefined,
        dateTo: memoryDateTo || undefined,
      });
      set({
        memoryRecentItems: data.memories || [],
        memoryPagination: data.total != null ? { total: data.total, page: data.page, limit: data.limit, totalPages: data.totalPages } : null,
      });
    } catch (err) {
      console.error('Failed to fetch recent memories:', err);
    } finally {
      set((s) => ({ loading: { ...s.loading, memoryRecent: false } }));
    }
  },

  fetchMemoryRecalls: async () => {
    try {
      const { memoryPage } = get();
      const data = await hubApi.memory.recalls({ limit: 30, page: memoryPage });
      set({
        memoryRecalls: data.recalls || [],
        memoryRecallsPagination: data.total != null ? { total: data.total, page: data.page, limit: data.limit, totalPages: data.totalPages } : null,
      });
    } catch (err) {
      console.error('Failed to fetch memory recalls:', err);
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
      set({ costSummary: data.summary || null, dailyCosts: data.dailyCosts || [] });
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

  fetchRibbonData: async () => {
    try {
      const stats = await hubApi.orchestration.stats();
      set({
        ribbonData: {
          running: stats.agents.running,
          pendingInterventions: stats.pendingInterventions,
          openTickets: 0, // filled from metrics if available
        },
        stats,
      });
    } catch {
      // Ribbon fetch is non-critical
    }
  },

  // ============================
  // Agent actions
  // ============================

  createAgent: async (body) => {
    try {
      await hubApi.agents.create(body);
      await get().fetchAgents();
      return true;
    } catch (err) {
      console.error('Failed to create agent:', err);
      return false;
    }
  },

  runAgent: async (id, prompt) => {
    try {
      await hubApi.agents.run(id, prompt);
      await get().fetchAgents();
      return true;
    } catch (err) {
      console.error('Failed to run agent:', err);
      return false;
    }
  },

  stopAgent: async (id) => {
    try {
      await hubApi.agents.stop(id);
      await get().fetchAgents();
    } catch (err) {
      console.error('Failed to stop agent:', err);
    }
  },

  decommissionAgent: async (id) => {
    try {
      await hubApi.agents.decommission(id);
      set({ showAgentDetail: null });
      await get().fetchAgents();
    } catch (err) {
      console.error('Failed to decommission agent:', err);
    }
  },

  recommissionAgent: async (id) => {
    try {
      await hubApi.agents.recommission(id);
      await get().fetchAgents();
    } catch (err) {
      console.error('Failed to recommission agent:', err);
    }
  },

  deleteAgent: async (id) => {
    try {
      await hubApi.agents.delete(id);
      set({ showAgentDetail: null });
      await get().fetchAgents();
    } catch (err) {
      console.error('Failed to delete agent:', err);
    }
  },

  batchProcessAgents: async () => {
    set({ batchRunning: true, batchResult: null });
    try {
      const result = await hubApi.agents.batchProcess();
      set({ batchResult: result });
      await get().fetchAgents();
    } catch (err) {
      console.error('Failed to batch process:', err);
    } finally {
      set({ batchRunning: false });
    }
  },

  batchPauseAgents: async () => {
    set({ batchRunning: true, batchResult: null });
    try {
      const result = await hubApi.agents.batchPause();
      set({ batchResult: { started: 0, agents: result.agents } });
      await get().fetchAgents();
    } catch (err) {
      console.error('Failed to batch pause:', err);
    } finally {
      set({ batchRunning: false });
    }
  },

  processAgent: async (id) => {
    try {
      await hubApi.agents.process(id);
      await get().fetchAgents();
    } catch (err) {
      console.error('Failed to process agent:', err);
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

  // ============================
  // Scheduler actions
  // ============================

  toggleScheduler: async (action) => {
    try {
      await hubApi.reports.toggleScheduler(action);
      await get().fetchSchedulerStatus();
    } catch (err) {
      console.error('Failed to toggle scheduler:', err);
    }
  },

  updateSchedule: async (agentId, scheduleType, intervalMinutes, executionMode) => {
    try {
      await hubApi.agents.setSchedule(agentId, {
        schedule_type: scheduleType,
        interval_minutes: intervalMinutes,
        execution_mode: executionMode,
      });
      await get().fetchSchedules();
    } catch (err) {
      console.error('Failed to update schedule:', err);
    }
  },

  updateAgentModel: async (agentId, modelId) => {
    try {
      await hubApi.agents.updateModel(agentId, modelId);
      await get().fetchSchedules();
    } catch (err) {
      console.error('Failed to update agent model:', err);
    }
  },
}));
