import { useState, useEffect, lazy, Suspense, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import TopBar from '../components/unified/TopBar';
import ErrorBoundary from '../components/ErrorBoundary';
import KeyboardHelpOverlay from '../components/KeyboardHelpOverlay';
import { useWebSocket } from '../hooks/useWebSocket';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { hubApi } from '../hooks/useHubApi';
import { useHubStore } from '../stores/hub';
import './UnifiedDashboard.css';
// Hub component CSS (previously imported by CommandCenter)
import './hub/shared/hub-shared.css';
import './hub/hub-pages.css';
import './hub/ContentFeed.css';
import './hub/FleetMemory.css';
import './forge/forge-theme.css';

// Lazy-load tab panels — 7 top-level tabs
const ChatTab = lazy(() => import('./unified/ChatTab'));
const TerminalTab = lazy(() => import('./unified/TerminalTab'));
const OverviewTab = lazy(() => import('./unified/OverviewTab'));
const FleetHubTab = lazy(() => import('./unified/FleetHubTab'));
const OpsTab = lazy(() => import('./unified/OpsTab'));
const BrainTab = lazy(() => import('./unified/BrainTab'));
const LiveFeedTab = lazy(() => import('./unified/LiveFeedTab'));
const Settings = lazy(() => import('./Settings'));

type TabKey = 'command' | 'code' | 'overview' | 'fleet' | 'ops' | 'brain' | 'live' | 'settings';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'command', label: 'Command' },
  { key: 'code', label: 'Code' },
  { key: 'overview', label: 'Overview' },
  { key: 'live', label: 'Live' },
  { key: 'fleet', label: 'Fleet' },
  { key: 'ops', label: 'Ops' },
  { key: 'brain', label: 'Brain' },
  { key: 'settings', label: 'Settings' },
];

const TAB_KEYS = TABS.map(t => t.key);

export default function UnifiedDashboard() {
  const { tab } = useParams<{ tab?: string }>();
  const navigate = useNavigate();

  const initialTab = (tab && TAB_KEYS.includes(tab as TabKey)) ? tab as TabKey : 'command';
  const [activeTab, setActiveTabState] = useState<TabKey>(initialTab);
  const [helpOpen, setHelpOpen] = useState(false);
  const { connected, events: wsEvents } = useWebSocket();

  const { fetchAgents, fetchTickets, fetchCosts, fetchCoordinationSessions, fetchCoordinationStats, fetchRibbonData, fetchInterventions } = useHubStore();

  const setActiveTab = useCallback((key: TabKey) => {
    setActiveTabState(key);
    navigate(`/command-center/${key}`, { replace: true });
  }, [navigate]);

  // Sync tab from URL param changes
  useEffect(() => {
    if (tab && TAB_KEYS.includes(tab as TabKey) && tab !== activeTab) {
      setActiveTabState(tab as TabKey);
    }
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  // Aggregated counts for topbar
  const [agentCount, setAgentCount] = useState(0);
  const [todayCost, setTodayCost] = useState(0);
  const [budgetLimit, setBudgetLimit] = useState<number | undefined>(undefined);

  useEffect(() => {
    const fetchCounts = async () => {
      try {
        const [agentsData, costsData] = await Promise.all([
          hubApi.agents.list(),
          hubApi.costs.summary(),
        ]);
        setAgentCount(agentsData.agents.filter((a) => a.status === 'running').length);
        setTodayCost(costsData.summary?.total?.totalCost ?? 0);
      } catch {
        // ignore
      }
    };

    fetchCounts();
    const timer = setInterval(fetchCounts, 30000);
    return () => clearInterval(timer);
  }, []);

  // Fetch budget limit from guardrails (once)
  useEffect(() => {
    fetch('/api/v1/admin/guardrails', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const g = data?.guardrails?.find((g: any) => g.type === 'cost_limit' && g.is_enabled);
        if (g?.config?.maxCostPerDay) setBudgetLimit(g.config.maxCostPerDay);
      })
      .catch(() => {});
  }, []);

  // Keyboard shortcut: refresh current tab's data
  const handleRefresh = useCallback(() => {
    switch (activeTab) {
      case 'fleet': fetchAgents(); fetchCoordinationSessions(); fetchCoordinationStats(); break;
      case 'ops': fetchTickets(); fetchInterventions(); fetchRibbonData(); fetchCosts(); fetchAgents(); break;
      default: break;
    }
  }, [activeTab, fetchAgents, fetchTickets, fetchCosts, fetchCoordinationSessions, fetchCoordinationStats, fetchRibbonData, fetchInterventions]);

  const handleToggleHelp = useCallback(() => setHelpOpen(h => !h), []);

  const tabListForHelp = useMemo(
    () => TABS.slice(0, 9).map((t, i) => ({
      index: i + 1,
      key: t.key,
      label: t.label,
    })),
    []
  );

  useKeyboardShortcuts({
    visibleKeys: TAB_KEYS,
    activeTab,
    setActiveTab: setActiveTab as (key: string) => void,
    onRefresh: handleRefresh,
    onToggleHelp: handleToggleHelp,
    helpOpen,
  });

  const tabContent = () => {
    switch (activeTab) {
      case 'command':
        return (
          <ErrorBoundary inline key="command">
            <Suspense fallback={<div className="ud-loading">Loading Command...</div>}>
              <ChatTab onNavigate={(t) => setActiveTab(t as TabKey)} />
            </Suspense>
          </ErrorBoundary>
        );
      case 'code':
        return (
          <ErrorBoundary inline key="code">
            <Suspense fallback={<div className="ud-loading">Initializing terminal...</div>}>
              <TerminalTab onNavigate={(t) => setActiveTab(t as TabKey)} />
            </Suspense>
          </ErrorBoundary>
        );
      case 'overview':
        return (
          <ErrorBoundary inline key="overview">
            <Suspense fallback={<div className="ud-loading">Loading Overview...</div>}>
              <OverviewTab wsEvents={wsEvents} onNavigate={(t) => setActiveTab(t as TabKey)} />
            </Suspense>
          </ErrorBoundary>
        );
      case 'live':
        return (
          <ErrorBoundary inline key="live">
            <Suspense fallback={<div className="ud-loading">Loading Live Feed...</div>}>
              <LiveFeedTab wsEvents={wsEvents} />
            </Suspense>
          </ErrorBoundary>
        );
      case 'fleet':
        return (
          <ErrorBoundary inline key="fleet">
            <Suspense fallback={<div className="ud-loading">Loading Fleet...</div>}>
              <FleetHubTab wsEvents={wsEvents} />
            </Suspense>
          </ErrorBoundary>
        );
      case 'ops':
        return (
          <ErrorBoundary inline key="ops">
            <Suspense fallback={<div className="ud-loading">Loading Ops...</div>}>
              <OpsTab wsEvents={wsEvents} />
            </Suspense>
          </ErrorBoundary>
        );
      case 'brain':
        return (
          <ErrorBoundary inline key="brain">
            <Suspense fallback={<div className="ud-loading">Loading Brain...</div>}>
              <BrainTab />
            </Suspense>
          </ErrorBoundary>
        );
      case 'settings':
        return (
          <ErrorBoundary inline key="settings">
            <Suspense fallback={<div className="ud-loading">Loading Settings...</div>}>
              <Settings embedded />
            </Suspense>
          </ErrorBoundary>
        );
    }
  };

  return (
    <div className="ud-container">
      <KeyboardHelpOverlay open={helpOpen} onClose={handleToggleHelp} tabList={tabListForHelp} />
      <TopBar
        wsConnected={connected}
        agentCount={agentCount}
        todayCost={todayCost}
        budgetLimit={budgetLimit}
        onNavigate={(tab) => setActiveTab(tab as TabKey)}
      />
      <div className="ud-body ud-body-full">
        <div className="ud-main">
          <div className="ud-tab-bar" role="tablist" aria-label="Dashboard navigation">
            {TABS.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={activeTab === t.key}
                className={`ud-tab ${activeTab === t.key ? 'active' : ''}`}
                onClick={() => setActiveTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="ud-tab-content" role="tabpanel" aria-label={activeTab}>
            {tabContent()}
          </div>
        </div>
      </div>
    </div>
  );
}
