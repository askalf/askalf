import { useState, useEffect, lazy, Suspense, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import TopBar from '../components/unified/TopBar';
import ErrorBoundary from '../components/ErrorBoundary';
import KeyboardHelpOverlay from '../components/KeyboardHelpOverlay';
import CommandPalette from '../components/CommandPalette';
import { useWebSocket } from '../hooks/useWebSocket';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { hubApi } from '../hooks/useHubApi';
import { useHubStore } from '../stores/hub';
import TabBar from '../components/TabBar';
import './UnifiedDashboard.css';
// Hub component CSS (previously imported by CommandCenter)
// Hub CSS removed — hub/ directory was cleaned up
// Forge theme CSS removed — forge/ directory was cleaned up

// Lazy-load tab panels
const HomeTab = lazy(() => import('./unified/HomeTab'));
const TerminalTab = lazy(() => import('./unified/TerminalTab'));
const FleetHubTab = lazy(() => import('./unified/FleetHubTab'));
const LiveTab = lazy(() => import('./unified/LiveTab'));
const OpsTab = lazy(() => import('./unified/OpsTab'));
const BrainTab = lazy(() => import('./unified/BrainTab'));
const MarketplaceTab = lazy(() => import('./unified/MarketplaceTab'));
const OrganismTab = lazy(() => import('./unified/OrganismTab'));
const Settings = lazy(() => import('./Settings'));

type TabKey = 'home' | 'organism' | 'code' | 'fleet' | 'live' | 'ops' | 'brain' | 'marketplace' | 'settings';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'home', label: 'Ask Alf' },
  { key: 'organism', label: 'Organism' },
  { key: 'fleet', label: 'Team' },
  { key: 'live', label: 'Live' },
  { key: 'code', label: 'Workspace' },
  { key: 'ops', label: 'Ops' },
  { key: 'brain', label: 'Memory' },
  { key: 'marketplace', label: 'Marketplace' },
  { key: 'settings', label: 'Settings' },
];

const TAB_KEYS = TABS.map(t => t.key);

export default function UnifiedDashboard() {
  const { tab } = useParams<{ tab?: string }>();
  const navigate = useNavigate();

  const initialTab = (tab && TAB_KEYS.includes(tab as TabKey)) ? tab as TabKey : 'home';
  const [activeTab, setActiveTabState] = useState<TabKey>(initialTab);
  const [helpOpen, setHelpOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { connected, events: wsEvents } = useWebSocket();

  const { fetchAgents, fetchTickets, fetchCosts, fetchCoordinationSessions, fetchCoordinationStats, fetchInterventions } = useHubStore();

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
  const [todayApiCost, setTodayApiCost] = useState(0);
  const [todayCliCost, setTodayCliCost] = useState(0);
  const [budgetLimit, setBudgetLimit] = useState<number | undefined>(undefined);

  useEffect(() => {
    const fetchCounts = async () => {
      try {
        const [agentsData, costsData] = await Promise.all([
          hubApi.agents.list(),
          hubApi.costs.summary({ days: 1 }),
        ]);
        setAgentCount(agentsData.agents.filter((a) => a.status === 'running').length);
        // Use today's date from byDay breakdown for accurate daily total
        const todayStr = new Date().toISOString().slice(0, 10);
        const todayEntry = (costsData.dailyCosts || []).find((d: { date: string }) => d.date === todayStr);
        if (todayEntry) {
          setTodayCost(todayEntry.totalCost ?? 0);
          setTodayApiCost(todayEntry.apiCost ?? todayEntry.totalCost ?? 0);
          setTodayCliCost(todayEntry.cliCost ?? 0);
        } else {
          setTodayCost(0);
          setTodayApiCost(0);
          setTodayCliCost(0);
        }
      } catch {
        // ignore
      }
    };

    fetchCounts();
    fetchInterventions(); // Load interventions on mount so badge shows immediately
    const timer = setInterval(() => { fetchCounts(); fetchInterventions(); }, 30000);
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
      case 'ops': fetchTickets(); fetchInterventions(); fetchCosts(); fetchAgents(); break;
      default: break;
    }
  }, [activeTab, fetchAgents, fetchTickets, fetchCosts, fetchCoordinationSessions, fetchCoordinationStats, fetchInterventions]);

  const handleToggleHelp = useCallback(() => setHelpOpen(h => !h), []);
  const handleTogglePalette = useCallback(() => setPaletteOpen(p => !p), []);

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
    onTogglePalette: handleTogglePalette,
    paletteOpen,
  });

  const tabContent = () => {
    switch (activeTab) {
      case 'home':
        return (
          <ErrorBoundary inline key="home">
            <Suspense fallback={<div className="ud-loading">Loading...</div>}>
              <HomeTab wsEvents={wsEvents} onNavigate={(t) => setActiveTab(t as TabKey)} />
            </Suspense>
          </ErrorBoundary>
        );
      case 'organism':
        return (
          <ErrorBoundary inline key="organism">
            <Suspense fallback={<div className="ud-loading">Loading organism...</div>}>
              <OrganismTab />
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
      case 'fleet':
        return (
          <ErrorBoundary inline key="fleet">
            <Suspense fallback={<div className="ud-loading">Loading Team...</div>}>
              <FleetHubTab wsEvents={wsEvents} />
            </Suspense>
          </ErrorBoundary>
        );
      case 'live':
        return (
          <ErrorBoundary inline key="live">
            <Suspense fallback={<div className="ud-loading">Loading Live...</div>}>
              <LiveTab wsEvents={wsEvents} />
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
      case 'marketplace':
        return (
          <ErrorBoundary inline key="marketplace">
            <Suspense fallback={<div className="ud-loading">Loading Marketplace...</div>}>
              <MarketplaceTab />
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
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onNavigate={(t) => setActiveTab(t as TabKey)} />
      <TopBar
        wsConnected={connected}
        agentCount={agentCount}
        todayCost={todayCost}
        todayApiCost={todayApiCost}
        todayCliCost={todayCliCost}
        budgetLimit={budgetLimit}
        onNavigate={(tab) => setActiveTab(tab as TabKey)}
      />
      <div className="ud-body ud-body-full">
        <div className="ud-main">
          <TabBar tabs={TABS} active={activeTab} onChange={(k) => setActiveTab(k as TabKey)} className="ud-tab-bar" tabClassName="ud-tab" ariaLabel="Dashboard navigation" />
          <div className="ud-tab-content" role="tabpanel" aria-label={activeTab}>
            {tabContent()}
          </div>
        </div>
      </div>
    </div>
  );
}
