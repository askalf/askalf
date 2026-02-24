import { useState, useEffect, lazy, Suspense, useCallback } from 'react';
import TopBar from '../components/unified/TopBar';
import MasterSession from '../components/unified/MasterSession';
import AgentFleetCompact from '../components/unified/AgentFleetCompact';
import LiveActivityFeed from '../components/unified/LiveActivityFeed';
import TicketBoardCompact from '../components/unified/TicketBoardCompact';
import { useWebSocket } from '../hooks/useWebSocket';
import { hubApi } from '../hooks/useHubApi';
import './UnifiedDashboard.css';

// Lazy-load the heavy tabs
const PushPanel = lazy(() => import('./forge/PushPanel'));
const ExecutionHistory = lazy(() => import('./hub/ExecutionHistory'));
const CostDashboard = lazy(() => import('./forge/CostDashboard'));
const FleetTab = lazy(() => import('./unified/FleetTab'));
const ChatTab = lazy(() => import('./unified/ChatTab'));
const BuilderTab = lazy(() => import('./unified/BuilderTab'));
const TemplatesTab = lazy(() => import('./unified/TemplatesTab'));

type TabKey = 'chat' | 'templates' | 'builder' | 'master' | 'fleet' | 'deploy' | 'executions' | 'costs';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'chat', label: 'Chat' },
  { key: 'templates', label: 'Templates' },
  { key: 'builder', label: 'Builder' },
  { key: 'master', label: 'Master' },
  { key: 'fleet', label: 'Fleet' },
  { key: 'deploy', label: 'Deploy' },
  { key: 'executions', label: 'Exec' },
  { key: 'costs', label: '$$' },
];

export default function UnifiedDashboard() {
  const [activeTab, setActiveTab] = useState<TabKey>('master');
  const { connected, events } = useWebSocket();

  // State for cross-tab communication (Templates → Builder)
  const [builderTemplate, setBuilderTemplate] = useState<Record<string, unknown> | null>(null);

  // Aggregated counts for topbar
  const [agentCount, setAgentCount] = useState(0);
  const [ticketCount, setTicketCount] = useState(0);
  const [todayCost, setTodayCost] = useState(0);

  useEffect(() => {
    // Fetch initial counts
    const fetchCounts = async () => {
      try {
        const [agentsData, ticketsData, costsData] = await Promise.all([
          hubApi.agents.list(),
          hubApi.tickets.list({ limit: 1, filter: 'open' }),
          hubApi.costs.summary(),
        ]);
        setAgentCount(agentsData.agents.filter((a) => a.status === 'running').length);
        setTicketCount(ticketsData.pagination?.total ?? 0);
        setTodayCost(costsData.summary?.totalCost ?? 0);
      } catch {
        // ignore
      }
    };

    fetchCounts();
    const timer = setInterval(fetchCounts, 30000);
    return () => clearInterval(timer);
  }, []);

  // Template → Builder navigation
  const handleUseTemplate = useCallback((template: Record<string, unknown>) => {
    setBuilderTemplate(template);
    setActiveTab('builder');
  }, []);

  const tabContent = () => {
    switch (activeTab) {
      case 'chat':
        return (
          <Suspense fallback={<div className="ud-loading">Loading Chat...</div>}>
            <ChatTab />
          </Suspense>
        );
      case 'templates':
        return (
          <Suspense fallback={<div className="ud-loading">Loading Templates...</div>}>
            <TemplatesTab onUseTemplate={handleUseTemplate} />
          </Suspense>
        );
      case 'builder':
        return (
          <Suspense fallback={<div className="ud-loading">Loading Builder...</div>}>
            <BuilderTab prefilledTemplate={builderTemplate} />
          </Suspense>
        );
      case 'master':
        return <MasterSession />;
      case 'fleet':
        return (
          <Suspense fallback={<div className="ud-loading">Loading Fleet...</div>}>
            <FleetTab />
          </Suspense>
        );
      case 'deploy':
        return (
          <Suspense fallback={<div className="ud-loading">Loading Deploy...</div>}>
            <PushPanel />
          </Suspense>
        );
      case 'executions':
        return (
          <Suspense fallback={<div className="ud-loading">Loading Executions...</div>}>
            <ExecutionHistory />
          </Suspense>
        );
      case 'costs':
        return (
          <Suspense fallback={<div className="ud-loading">Loading Costs...</div>}>
            <CostDashboard />
          </Suspense>
        );
    }
  };

  return (
    <div className="ud-container">
      <TopBar
        wsConnected={connected}
        agentCount={agentCount}
        ticketCount={ticketCount}
        todayCost={todayCost}
      />
      <div className="ud-body">
        <div className="ud-main">
          <div className="ud-tab-bar">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                className={`ud-tab ${activeTab === tab.key ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="ud-tab-content">
            {tabContent()}
          </div>
        </div>
        <aside className="ud-sidebar">
          <AgentFleetCompact forgeEvents={events} onViewFleet={() => setActiveTab('fleet')} />
          <LiveActivityFeed events={events} />
          <TicketBoardCompact />
        </aside>
      </div>
    </div>
  );
}
