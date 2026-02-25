import { useCallback, useEffect, useState, lazy, Suspense } from 'react';
import { useParams } from 'react-router-dom';
import { useHubStore, type HubTab } from '../stores/hub';
import { useAuthStore } from '../stores/auth';
import { usePolling } from '../hooks/usePolling';
import { hubApi } from '../hooks/useHubApi';
import { AGENT_TYPE_INFO } from './hub/shared/AgentIcon';
import AdminAssistantPanel from '../components/admin/AdminAssistantPanel';
import ErrorBoundary from '../components/ErrorBoundary';
import Modal from './hub/shared/Modal';
import './hub/shared/hub-shared.css';
import './hub/hub-pages.css';
import './hub/FleetCoordination.css';
import './hub/ContentFeed.css';
import './hub/FleetMemory.css';
import './CommandCenter.css';
import './forge/forge-theme.css';

// Auto-retry dynamic imports — handles stale chunk hashes after deploys
function lazyRetry<T extends { default: React.ComponentType }>(
  importFn: () => Promise<T>,
): React.LazyExoticComponent<T['default']> {
  return lazy(() =>
    importFn().catch(() => {
      // Chunk hash mismatch after deploy — reload once to get fresh manifest
      const key = 'chunk-reload';
      if (!sessionStorage.getItem(key)) {
        sessionStorage.setItem(key, '1');
        window.location.reload();
      }
      // If we already reloaded, surface the error so ErrorBoundary catches it
      return importFn();
    }),
  );
}

// Lazy-load all tab panels
const ForgeOverview = lazyRetry(() => import('./forge/ForgeOverview'));
const AgentFleet = lazyRetry(() => import('./hub/AgentFleet'));
const ExecutionHistory = lazyRetry(() => import('./hub/ExecutionHistory'));
const InterventionGateway = lazyRetry(() => import('./hub/InterventionGateway'));
const Checkpoints = lazyRetry(() => import('./hub/Checkpoints'));
const Tickets = lazyRetry(() => import('./hub/Tickets'));
const ContentFeed = lazyRetry(() => import('./hub/ContentFeed'));
const FleetMemory = lazyRetry(() => import('./hub/FleetMemory'));
const Threads = lazyRetry(() => import('./hub/Threads'));
const CostDashboard = lazyRetry(() => import('./forge/CostDashboard'));
const ProviderHealthPage = lazyRetry(() => import('./forge/ProviderHealth'));
const GuardrailsManager = lazyRetry(() => import('./forge/GuardrailsManager'));
const AuditLog = lazyRetry(() => import('./forge/AuditLog'));
const WorkflowBuilder = lazyRetry(() => import('./forge/WorkflowBuilder'));
const PushPanel = lazyRetry(() => import('./forge/PushPanel'));
const PromptLab = lazyRetry(() => import('./forge/PromptLab'));
const NLOrchestrate = lazyRetry(() => import('./forge/NLOrchestrate'));
const AgentChat = lazyRetry(() => import('./forge/AgentChat'));
const GoalManager = lazyRetry(() => import('./forge/GoalManager'));
const CostOptimizer = lazyRetry(() => import('./forge/CostOptimizer'));
const KnowledgeGraph = lazyRetry(() => import('./forge/KnowledgeGraph'));
const HealthMonitor = lazyRetry(() => import('./forge/HealthMonitor'));
const Evolution = lazyRetry(() => import('./forge/Evolution'));
const EventLog = lazyRetry(() => import('./forge/EventLog'));
const Leaderboard = lazyRetry(() => import('./forge/Leaderboard'));
const MetabolicDashboard = lazyRetry(() => import('./forge/MetabolicDashboard'));
const ExecutionTimeline = lazyRetry(() => import('./forge/ExecutionTimeline'));
const AgentPerformance = lazyRetry(() => import('./forge/AgentPerformance'));
const Documents = lazyRetry(() => import('./hub/Documents'));

const PANEL_MAP: Record<HubTab, React.FC> = {
  overview: ForgeOverview,
  fleet: AgentFleet,
  executions: ExecutionHistory,
  scheduler: Threads,
  coordination: Threads,
  interventions: InterventionGateway,
  checkpoints: Checkpoints,
  tickets: Tickets,
  content: ContentFeed,
  documents: Documents,
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
  metabolic: MetabolicDashboard,
  timeline: ExecutionTimeline,
  performance: AgentPerformance,
  deployments: ForgeOverview,
  master: ForgeOverview,
};

export default function CommandCenter() {
  const { tab } = useParams<{ tab?: string }>();
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';
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
  const [optimizing, setOptimizing] = useState(false);
  const [runPrompt, setRunPrompt] = useState('');
  const [runningId, setRunningId] = useState<string | null>(null);

  // Sync tab from URL param — use effect to avoid setting state during render
  const currentTab = (tab && tab in PANEL_MAP ? tab : 'overview') as HubTab;
  useEffect(() => {
    if (currentTab !== activeTab) {
      setActiveTab(currentTab);
    }
  }, [currentTab]);

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

  const handleOptimizePrompt = async () => {
    if (!newAgent.system_prompt.trim()) return;
    setOptimizing(true);
    try {
      const result = await hubApi.agents.optimizePrompt({
        prompt: newAgent.system_prompt,
        name: newAgent.name,
        type: newAgent.type,
        description: newAgent.description,
      });
      if (result.optimized) {
        setNewAgent((prev) => ({ ...prev, system_prompt: result.optimized }));
      }
    } catch (err: unknown) {
      console.error('Failed to optimize prompt:', err);
    }
    setOptimizing(false);
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

  const ActivePanel = PANEL_MAP[currentTab] || PANEL_MAP.overview;

  return (
    <div className={`fc-shell ${assistantOpen ? 'panel-open' : ''}`}>
      {/* Header */}
      <header className="fc-header">
        <div className="fc-header-left">
          <div className="fc-brand">
            <div className="fc-brand-logo">F</div>
            <div className="fc-brand-text">
              <span className="fc-brand-title">Orcastr8r</span>
              <span className="fc-brand-subtitle">Command Center</span>
            </div>
          </div>
          <div className={`fc-cluster ${clusterHealthy ? 'fc-cluster--ok' : 'fc-cluster--warn'}`}>
            <span className="fc-cluster-dot" />
            <span>{clusterHealthy ? 'Healthy' : 'Attention'}</span>
          </div>
        </div>
        <div className="fc-header-right">
          {isAdmin && (
            <>
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
            </>
          )}
          <button className={`fc-assistant-btn ${assistantOpen ? 'active' : ''}`} onClick={() => setAssistantOpen(!assistantOpen)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
              <path d="M12 2a3 3 0 0 0-3 3v1a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
              <path d="M19 10H5a2 2 0 0 0-2 2v1a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-1a2 2 0 0 0-2-2Z" />
              <path d="M12 15v4M8 19h8" />
            </svg>
          </button>
        </div>
      </header>

      {/* Content — per-panel error boundary prevents one bad panel from killing the whole app */}
      <div className="fc-content">
        <ErrorBoundary inline key={currentTab}>
          <Suspense fallback={<div className="fc-tab-loading">Loading...</div>}>
            <ActivePanel />
          </Suspense>
        </ErrorBoundary>
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
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <label>System Prompt <span className="optional">(optional)</span></label>
              <button
                className="hub-btn hub-btn--ghost"
                style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}
                onClick={handleOptimizePrompt}
                disabled={optimizing || !newAgent.system_prompt.trim()}
              >
                {optimizing ? 'Optimizing...' : 'Optimize with AI'}
              </button>
            </div>
            <textarea value={newAgent.system_prompt} onChange={(e) => setNewAgent({ ...newAgent, system_prompt: e.target.value })} placeholder="Describe what this agent should do — AI will optimize it for you..." rows={6} />
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
