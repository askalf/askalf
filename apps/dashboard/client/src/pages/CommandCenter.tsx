import { useCallback, useState, lazy, Suspense } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useHubStore, type HubTab } from '../stores/hub';
import { usePolling } from '../hooks/usePolling';
import { AGENT_TYPE_INFO } from './hub/shared/AgentIcon';
import AdminAssistantPanel from '../components/admin/AdminAssistantPanel';
import Modal from './hub/shared/Modal';
import './hub/shared/hub-shared.css';
import './hub/hub-pages.css';
import './hub/FleetCoordination.css';
import './hub/ContentFeed.css';
import './hub/FleetMemory.css';
import './CommandCenter.css';
import './forge/forge-theme.css';

// Lazy-load all tab panels
const ForgeOverview = lazy(() => import('./forge/ForgeOverview'));
const AgentFleet = lazy(() => import('./hub/AgentFleet'));
const ExecutionHistory = lazy(() => import('./hub/ExecutionHistory'));
const SchedulerControl = lazy(() => import('./hub/SchedulerControl'));
const FleetCoordination = lazy(() => import('./hub/FleetCoordination'));
const InterventionGateway = lazy(() => import('./hub/InterventionGateway'));
const Tickets = lazy(() => import('./hub/Tickets'));
const ContentFeed = lazy(() => import('./hub/ContentFeed'));
const FleetMemory = lazy(() => import('./hub/FleetMemory'));
const Threads = lazy(() => import('./hub/Threads'));
const CostDashboard = lazy(() => import('./forge/CostDashboard'));
const ProviderHealthPage = lazy(() => import('./forge/ProviderHealth'));
const GuardrailsManager = lazy(() => import('./forge/GuardrailsManager'));
const AuditLog = lazy(() => import('./forge/AuditLog'));
const WorkflowBuilder = lazy(() => import('./forge/WorkflowBuilder'));
const PushPanel = lazy(() => import('./forge/PushPanel'));
const PromptLab = lazy(() => import('./forge/PromptLab'));
const NLOrchestrate = lazy(() => import('./forge/NLOrchestrate'));
const AgentChat = lazy(() => import('./forge/AgentChat'));
const GoalManager = lazy(() => import('./forge/GoalManager'));
const CostOptimizer = lazy(() => import('./forge/CostOptimizer'));
const KnowledgeGraph = lazy(() => import('./forge/KnowledgeGraph'));
const HealthMonitor = lazy(() => import('./forge/HealthMonitor'));
const Evolution = lazy(() => import('./forge/Evolution'));
const EventLog = lazy(() => import('./forge/EventLog'));
const Leaderboard = lazy(() => import('./forge/Leaderboard'));

const TAB_SECTIONS = [
  {
    label: 'Fleet',
    tabs: [
      { key: 'overview' as HubTab, label: 'Overview' },
      { key: 'fleet' as HubTab, label: 'Agents' },
      { key: 'executions' as HubTab, label: 'Executions' },
      { key: 'scheduler' as HubTab, label: 'Scheduler' },
      { key: 'coordination' as HubTab, label: 'Coordination' },
    ],
  },
  {
    label: 'Ops',
    tabs: [
      { key: 'interventions' as HubTab, label: 'Interventions' },
      { key: 'tickets' as HubTab, label: 'Tickets' },
      { key: 'content' as HubTab, label: 'Content' },
      { key: 'memory' as HubTab, label: 'Memory' },
    ],
  },
  {
    label: 'Observe',
    tabs: [
      { key: 'costs' as HubTab, label: 'Costs' },
      { key: 'providers' as HubTab, label: 'Providers' },
      { key: 'guardrails' as HubTab, label: 'Guardrails' },
      { key: 'audit' as HubTab, label: 'Audit' },
    ],
  },
  {
    label: 'Build',
    tabs: [
      { key: 'workflows' as HubTab, label: 'Workflows' },
      { key: 'push' as HubTab, label: 'Push' },
    ],
  },
  {
    label: 'Intelligence',
    tabs: [
      { key: 'prompt-lab' as HubTab, label: 'Prompt Lab' },
      { key: 'nl-orchestrate' as HubTab, label: 'Orchestrate' },
      { key: 'agent-chat' as HubTab, label: 'Chat' },
      { key: 'goals' as HubTab, label: 'Goals' },
      { key: 'cost-optimizer' as HubTab, label: 'Optimizer' },
    ],
  },
  {
    label: 'Evolve',
    tabs: [
      { key: 'knowledge' as HubTab, label: 'Knowledge' },
      { key: 'health' as HubTab, label: 'Health' },
      { key: 'evolution' as HubTab, label: 'Evolution' },
      { key: 'events' as HubTab, label: 'Events' },
      { key: 'leaderboard' as HubTab, label: 'Leaderboard' },
    ],
  },
];

const PANEL_MAP: Record<HubTab, React.FC> = {
  overview: ForgeOverview,
  fleet: AgentFleet,
  executions: ExecutionHistory,
  scheduler: SchedulerControl,
  coordination: FleetCoordination,
  interventions: InterventionGateway,
  tickets: Tickets,
  content: ContentFeed,
  memory: FleetMemory,
  threads: Threads,
  costs: CostDashboard,
  providers: ProviderHealthPage,
  guardrails: GuardrailsManager,
  audit: AuditLog,
  workflows: WorkflowBuilder,
  push: PushPanel,
  'prompt-lab': PromptLab,
  'nl-orchestrate': NLOrchestrate,
  'agent-chat': AgentChat,
  goals: GoalManager,
  'cost-optimizer': CostOptimizer,
  knowledge: KnowledgeGraph,
  health: HealthMonitor,
  evolution: Evolution,
  events: EventLog,
  leaderboard: Leaderboard,
};

export default function CommandCenter() {
  const { tab } = useParams<{ tab?: string }>();
  const navigate = useNavigate();

  const activeTab = useHubStore((s) => s.activeTab);
  const setActiveTab = useHubStore((s) => s.setActiveTab);
  const stats = useHubStore((s) => s.stats);
  const interventions = useHubStore((s) => s.interventions);
  const schedulerStatus = useHubStore((s) => s.schedulerStatus);
  const fetchRibbonData = useHubStore((s) => s.fetchRibbonData);
  const fetchSchedulerStatus = useHubStore((s) => s.fetchSchedulerStatus);
  const toggleScheduler = useHubStore((s) => s.toggleScheduler);
  const ribbonData = useHubStore((s) => s.ribbonData);

  // Hub-level modals
  const showCreateAgent = useHubStore((s) => s.showCreateAgent);
  const setShowCreateAgent = useHubStore((s) => s.setShowCreateAgent);
  const showRunAgent = useHubStore((s) => s.showRunAgent);
  const setShowRunAgent = useHubStore((s) => s.setShowRunAgent);
  const createAgent = useHubStore((s) => s.createAgent);
  const runAgent = useHubStore((s) => s.runAgent);

  const [assistantOpen, setAssistantOpen] = useState(false);
  const [newAgent, setNewAgent] = useState({ name: '', type: 'custom', description: '', system_prompt: '' });
  const [creating, setCreating] = useState(false);
  const [runPrompt, setRunPrompt] = useState('');
  const [runningId, setRunningId] = useState<string | null>(null);

  // Sync tab from URL param on mount
  const currentTab = (tab && tab in PANEL_MAP ? tab : null) as HubTab | null;
  if (currentTab && currentTab !== activeTab) {
    setActiveTab(currentTab);
  }

  const handleTabChange = (key: HubTab) => {
    setActiveTab(key);
    navigate(key === 'overview' ? '/command-center' : `/command-center/${key}`, { replace: true });
  };

  const handleCreate = async () => {
    if (!newAgent.name.trim()) return;
    setCreating(true);
    const ok = await createAgent(newAgent);
    if (ok) {
      setShowCreateAgent(false);
      setNewAgent({ name: '', type: 'custom', description: '', system_prompt: '' });
    }
    setCreating(false);
  };

  const handleRun = async (id: string) => {
    setRunningId(id);
    await runAgent(id, runPrompt);
    setShowRunAgent(null);
    setRunPrompt('');
    setRunningId(null);
  };

  // Background polling
  const bgPoll = useCallback(() => {
    fetchRibbonData();
    fetchSchedulerStatus();
  }, [fetchRibbonData, fetchSchedulerStatus]);
  usePolling(bgPoll, 15000);

  const hasErrors = (stats?.agents.active || 0) > 0 && ribbonData.running === 0;
  const clusterHealthy = !hasErrors && interventions.length === 0;

  const ActivePanel = PANEL_MAP[activeTab] || PANEL_MAP.overview;

  return (
    <div className={`fc-shell ${assistantOpen ? 'panel-open' : ''}`}>
      {/* Header */}
      <header className="fc-header">
        <div className="fc-header-left">
          <div className="fc-brand">
            <div className="fc-brand-logo">F</div>
            <div className="fc-brand-text">
              <span className="fc-brand-title">Forge</span>
              <span className="fc-brand-subtitle">Command Center</span>
            </div>
          </div>
          <div className={`fc-cluster ${clusterHealthy ? 'fc-cluster--ok' : 'fc-cluster--warn'}`}>
            <span className="fc-cluster-dot" />
            <span>{clusterHealthy ? 'Healthy' : 'Attention'}</span>
          </div>
        </div>
        <div className="fc-header-right">
          <div className="fc-ribbon">
            <span className="fc-ribbon-item">
              <span className={`fc-ribbon-dot ${ribbonData.running > 0 ? 'fc-ribbon-dot--ok' : ''}`} />
              {ribbonData.running} running
            </span>
            <span className="fc-ribbon-item">
              <span className={`fc-ribbon-dot ${ribbonData.pendingInterventions > 0 ? 'fc-ribbon-dot--warn' : ''}`} />
              {ribbonData.pendingInterventions} pending
            </span>
            <span className="fc-ribbon-item">
              <span className="fc-ribbon-dot fc-ribbon-dot--info" />
              {ribbonData.openTickets} tickets
            </span>
          </div>
          <button
            className={`fc-scheduler-toggle ${schedulerStatus?.running ? 'running' : 'stopped'}`}
            onClick={() => toggleScheduler(schedulerStatus?.running ? 'stop' : 'start')}
          >
            <span className="fc-scheduler-dot" />
            Scheduler
          </button>
          <button className={`fc-assistant-btn ${assistantOpen ? 'active' : ''}`} onClick={() => setAssistantOpen(!assistantOpen)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
              <path d="M12 2a3 3 0 0 0-3 3v1a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
              <path d="M19 10H5a2 2 0 0 0-2 2v1a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-1a2 2 0 0 0-2-2Z" />
              <path d="M12 15v4M8 19h8" />
            </svg>
          </button>
        </div>
      </header>

      {/* Tab Bar */}
      <nav className="fc-tabs">
        {TAB_SECTIONS.map((section) => (
          <div key={section.label} className="fc-tab-group">
            <span className="fc-tab-group-label">{section.label}</span>
            {section.tabs.map((t) => (
              <button
                key={t.key}
                className={`fc-tab ${activeTab === t.key ? 'active' : ''}`}
                onClick={() => handleTabChange(t.key)}
              >
                {t.label}
                {t.key === 'interventions' && interventions.length > 0 && (
                  <span className="fc-tab-badge">{interventions.length}</span>
                )}
              </button>
            ))}
          </div>
        ))}
      </nav>

      {/* Content */}
      <div className="fc-content">
        <Suspense fallback={<div className="fc-tab-loading">Loading...</div>}>
          <ActivePanel />
        </Suspense>
      </div>

      {/* Hub-level Modals */}
      {showCreateAgent && (
        <Modal title="Spin Up Agent" onClose={() => setShowCreateAgent(false)}>
          <div className="hub-form-group">
            <label>Name</label>
            <input type="text" value={newAgent.name} onChange={(e) => setNewAgent({ ...newAgent, name: e.target.value })} placeholder="e.g., DevOps Monitor" />
          </div>
          <div className="hub-form-group">
            <label>Type</label>
            <div className="hub-type-grid">
              {Object.entries(AGENT_TYPE_INFO).map(([type, info]) => (
                <button key={type} className={`hub-type-chip ${newAgent.type === type ? 'active' : ''}`} onClick={() => setNewAgent({ ...newAgent, type })} style={{ '--type-color': info.color } as React.CSSProperties}>
                  <span>{info.icon}</span>
                  {info.label}
                </button>
              ))}
            </div>
          </div>
          <div className="hub-form-group">
            <label>Description</label>
            <input type="text" value={newAgent.description} onChange={(e) => setNewAgent({ ...newAgent, description: e.target.value })} placeholder="What does this agent do?" />
          </div>
          <div className="hub-form-group">
            <label>System Prompt <span className="optional">(optional)</span></label>
            <textarea value={newAgent.system_prompt} onChange={(e) => setNewAgent({ ...newAgent, system_prompt: e.target.value })} placeholder="Custom instructions..." rows={4} />
          </div>
          <div className="hub-modal-actions">
            <button className="hub-btn" onClick={() => setShowCreateAgent(false)}>Cancel</button>
            <button className="hub-btn hub-btn--primary" onClick={handleCreate} disabled={creating || !newAgent.name.trim()}>
              {creating ? 'Creating...' : 'Spin Up'}
            </button>
          </div>
        </Modal>
      )}

      {showRunAgent && (
        <Modal title="Run Agent" onClose={() => setShowRunAgent(null)} size="small">
          <div className="hub-form-group">
            <label>Task Prompt <span className="optional">(optional)</span></label>
            <textarea value={runPrompt} onChange={(e) => setRunPrompt(e.target.value)} placeholder="What should the agent work on?" rows={4} autoFocus />
          </div>
          <div className="hub-modal-actions">
            <button className="hub-btn" onClick={() => setShowRunAgent(null)}>Cancel</button>
            <button className="hub-btn hub-btn--primary" onClick={() => handleRun(showRunAgent)} disabled={runningId === showRunAgent}>
              {runningId === showRunAgent ? 'Starting...' : 'Run Now'}
            </button>
          </div>
        </Modal>
      )}

      <AdminAssistantPanel isOpen={assistantOpen} onToggle={() => setAssistantOpen(!assistantOpen)} activeTier="procedural" pageContext="orchestration" />
    </div>
  );
}
