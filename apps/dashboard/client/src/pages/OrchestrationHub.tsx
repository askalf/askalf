import { useCallback, useState } from 'react';
import { useHubStore, type HubTab } from '../stores/hub';
import { usePolling } from '../hooks/usePolling';
import AdminAssistantPanel from '../components/admin/AdminAssistantPanel';
import CommandCenter from './hub/CommandCenter';
import AgentFleet from './hub/AgentFleet';
import InterventionGateway from './hub/InterventionGateway';
import FleetMemory from './hub/FleetMemory';
import SchedulerControl from './hub/SchedulerControl';
import FleetCoordination from './hub/FleetCoordination';
import Modal from './hub/shared/Modal';
import { AGENT_TYPE_INFO } from './hub/shared/AgentIcon';
import './OrchestrationHub.css';

const TABS: { key: HubTab; label: string }[] = [
  { key: 'command', label: 'Command Center' },
  { key: 'fleet', label: 'Agent Fleet' },
  { key: 'gateway', label: 'Interventions' },
  { key: 'memory', label: 'Agent Memory' },
  { key: 'scheduler', label: 'Scheduler' },
  { key: 'coordination', label: 'Coordination' },
];

const PANEL_MAP: Record<HubTab, React.FC> = {
  command: CommandCenter,
  fleet: AgentFleet,
  gateway: InterventionGateway,
  memory: FleetMemory,
  scheduler: SchedulerControl,
  coordination: FleetCoordination,
};

export default function OrchestrationHub() {
  const activeTab = useHubStore((s) => s.activeTab);
  const setActiveTab = useHubStore((s) => s.setActiveTab);
  const ribbonData = useHubStore((s) => s.ribbonData);
  const schedulerStatus = useHubStore((s) => s.schedulerStatus);
  const interventions = useHubStore((s) => s.interventions);
  const fetchRibbonData = useHubStore((s) => s.fetchRibbonData);
  const fetchSchedulerStatus = useHubStore((s) => s.fetchSchedulerStatus);
  const toggleScheduler = useHubStore((s) => s.toggleScheduler);

  // Hub-level modals (accessible from any tab)
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

  // Background polling: ribbon data every 15s
  const bgPoll = useCallback(() => {
    fetchRibbonData();
    fetchSchedulerStatus();
  }, [fetchRibbonData, fetchSchedulerStatus]);
  usePolling(bgPoll, 15000);

  const ActivePanel = PANEL_MAP[activeTab];

  return (
    <div className={`hub-shell ${assistantOpen ? 'panel-open' : ''}`}>
      {/* Header */}
      <header className="hub-header">
        <div className="hub-header__left">
          <h1>Orchestration Hub</h1>
          <p>All-in-one agent management and monitoring</p>
        </div>
        <div className="hub-header__right">
          <button
            className={`hub-scheduler-toggle ${schedulerStatus?.running ? 'running' : 'stopped'}`}
            onClick={() => toggleScheduler(schedulerStatus?.running ? 'stop' : 'start')}
          >
            <span className="hub-scheduler-dot" />
            Scheduler: {schedulerStatus?.running ? 'RUNNING' : 'STOPPED'}
          </button>
          <button className={`assistant-btn ${assistantOpen ? 'active' : ''}`} onClick={() => setAssistantOpen(!assistantOpen)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2a3 3 0 0 0-3 3v1a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
              <path d="M19 10H5a2 2 0 0 0-2 2v1a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-1a2 2 0 0 0-2-2Z" />
              <path d="M12 15v4M8 19h8" />
            </svg>
          </button>
        </div>
      </header>

      {/* Status Ribbon */}
      <div className="hub-ribbon">
        <div className="hub-ribbon__item">
          <span className={`hub-ribbon__dot ${ribbonData.running > 0 ? 'hub-ribbon__dot--success' : ''}`} />
          <span className="hub-ribbon__value">{ribbonData.running}</span> Running
        </div>
        <div className="hub-ribbon__item">
          <span className={`hub-ribbon__dot ${ribbonData.pendingInterventions > 0 ? 'hub-ribbon__dot--warning' : ''}`} />
          <span className="hub-ribbon__value">{ribbonData.pendingInterventions}</span> Pending Review
        </div>
        <div className="hub-ribbon__item">
          <span className="hub-ribbon__dot hub-ribbon__dot--info" />
          <span className="hub-ribbon__value">{ribbonData.openTickets}</span> Open Tickets
        </div>
      </div>

      {/* Tab Navigation */}
      <nav className="hub-nav">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            className={activeTab === tab.key ? 'active' : ''}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
            {tab.key === 'gateway' && interventions.length > 0 && (
              <span className="hub-nav-badge">{interventions.length}</span>
            )}
          </button>
        ))}
      </nav>

      {/* Active Panel */}
      <div className="hub-content">
        <ActivePanel />
      </div>

      {/* Hub-level Modals (render on any tab) */}
      {showCreateAgent && (
        <Modal title="Spin Up Agent" onClose={() => setShowCreateAgent(false)}>
          <div className="hub-form-group">
            <label>Name</label>
            <input
              type="text"
              value={newAgent.name}
              onChange={(e) => setNewAgent({ ...newAgent, name: e.target.value })}
              placeholder="e.g., DevOps Monitor"
            />
          </div>
          <div className="hub-form-group">
            <label>Type</label>
            <div className="hub-type-grid">
              {Object.entries(AGENT_TYPE_INFO).map(([type, info]) => (
                <button
                  key={type}
                  className={`hub-type-chip ${newAgent.type === type ? 'active' : ''}`}
                  onClick={() => setNewAgent({ ...newAgent, type })}
                  style={{ '--type-color': info.color } as React.CSSProperties}
                >
                  <span>{info.icon}</span>
                  {info.label}
                </button>
              ))}
            </div>
          </div>
          <div className="hub-form-group">
            <label>Description</label>
            <input
              type="text"
              value={newAgent.description}
              onChange={(e) => setNewAgent({ ...newAgent, description: e.target.value })}
              placeholder="What does this agent do?"
            />
          </div>
          <div className="hub-form-group">
            <label>System Prompt <span className="optional">(optional)</span></label>
            <textarea
              value={newAgent.system_prompt}
              onChange={(e) => setNewAgent({ ...newAgent, system_prompt: e.target.value })}
              placeholder="Custom instructions for this agent..."
              rows={4}
            />
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
            <textarea
              value={runPrompt}
              onChange={(e) => setRunPrompt(e.target.value)}
              placeholder="What should the agent work on?"
              rows={4}
              autoFocus
            />
          </div>
          <div className="hub-modal-actions">
            <button className="hub-btn" onClick={() => setShowRunAgent(null)}>Cancel</button>
            <button
              className="hub-btn hub-btn--primary"
              onClick={() => handleRun(showRunAgent)}
              disabled={runningId === showRunAgent}
            >
              {runningId === showRunAgent ? 'Starting...' : 'Run Now'}
            </button>
          </div>
        </Modal>
      )}

      <AdminAssistantPanel
        isOpen={assistantOpen}
        onToggle={() => setAssistantOpen(!assistantOpen)}
        activeTier="procedural"
        pageContext="orchestration"
      />
    </div>
  );
}
