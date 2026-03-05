import { useState, useEffect, lazy, Suspense, useCallback, Fragment, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import TopBar from '../components/unified/TopBar';
import ErrorBoundary from '../components/ErrorBoundary';
import KeyboardHelpOverlay from '../components/KeyboardHelpOverlay';
import { useWebSocket } from '../hooks/useWebSocket';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { hubApi } from '../hooks/useHubApi';
import { useAuthStore } from '../stores/auth';
import { useHubStore } from '../stores/hub';
import './UnifiedDashboard.css';
// Hub component CSS (previously imported by CommandCenter)
import './hub/shared/hub-shared.css';
import './hub/hub-pages.css';
import './hub/ContentFeed.css';
import './hub/FleetMemory.css';
import './forge/forge-theme.css';

// Lazy-load all tab panels
const PushPanel = lazy(() => import('./forge/PushPanel'));
const FleetTab = lazy(() => import('./unified/FleetTab'));
const ChatTab = lazy(() => import('./unified/ChatTab'));
const BuilderTab = lazy(() => import('./unified/BuilderTab'));
const TemplatesTab = lazy(() => import('./unified/TemplatesTab'));
const OrchestratorTab = lazy(() => import('./unified/CoordinatorTab'));
const Documents = lazy(() => import('./hub/Documents'));
const WorkflowBuilder = lazy(() => import('./forge/WorkflowBuilder'));
// Merged tabs
const OperationsTab = lazy(() => import('./unified/OperationsTab'));
const MonitorTab = lazy(() => import('./unified/MonitorTab'));
const KnowledgeTab = lazy(() => import('./unified/KnowledgeTab'));
// Platform pages (embedded as tabs)
const Settings = lazy(() => import('./Settings'));
const UserAdmin = lazy(() => import('./UserAdmin'));

type TabKey =
  | 'chat' | 'templates' | 'fleet' | 'documents'
  | 'builder' | 'orchestrator' | 'operations' | 'monitor' | 'knowledge'
  | 'workflows' | 'deploy' | 'settings' | 'users';

interface TabGroup { label: string; tabs: { key: TabKey; label: string }[] }

const TAB_GROUPS: TabGroup[] = [
  { label: 'Main', tabs: [
    { key: 'chat', label: 'Chat' },
    { key: 'templates', label: 'Templates' },
    { key: 'fleet', label: 'Fleet' },
    { key: 'documents', label: 'Docs' },
    { key: 'settings', label: 'Settings' },
  ]},
  { label: 'Admin', tabs: [
    { key: 'builder', label: 'Builder' },
    { key: 'orchestrator', label: 'Orchestrator' },
    { key: 'operations', label: 'Operations' },
    { key: 'monitor', label: 'Monitor' },
    { key: 'knowledge', label: 'Knowledge' },
    { key: 'workflows', label: 'Workflows' },
    { key: 'deploy', label: 'Deploy' },
    { key: 'users', label: 'Users' },
  ]},
];

/** Tabs only visible to admin / super_admin */
const ADMIN_ONLY_TABS = new Set<TabKey>([
  'operations', 'monitor', 'knowledge',
  'workflows', 'deploy', 'users',
]);

export default function UnifiedDashboard() {
  const { tab } = useParams<{ tab?: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';

  const visibleGroups = useMemo(() => {
    if (isAdmin) return TAB_GROUPS;
    return TAB_GROUPS
      .map(g => ({ ...g, tabs: g.tabs.filter(t => !ADMIN_ONLY_TABS.has(t.key)) }))
      .filter(g => g.tabs.length > 0);
  }, [isAdmin]);

  const visibleKeys = useMemo(() => visibleGroups.flatMap(g => g.tabs.map(t => t.key)), [visibleGroups]);

  const initialTab = (tab && visibleKeys.includes(tab as TabKey)) ? tab as TabKey : 'chat';
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
    if (tab && visibleKeys.includes(tab as TabKey) && tab !== activeTab) {
      setActiveTabState(tab as TabKey);
    }
  }, [tab, visibleKeys]); // eslint-disable-line react-hooks/exhaustive-deps

  // State for cross-tab communication (Templates → Builder)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [builderTemplate, setBuilderTemplate] = useState<any>(null);

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
      case 'orchestrator': fetchAgents(); fetchCoordinationSessions(); fetchCoordinationStats(); break;
      case 'fleet': fetchAgents(); break;
      case 'operations': fetchTickets(); fetchInterventions(); fetchRibbonData(); break;
      case 'monitor': fetchCosts(); fetchAgents(); break;
      default: break;
    }
  }, [activeTab, fetchAgents, fetchTickets, fetchCosts, fetchCoordinationSessions, fetchCoordinationStats, fetchRibbonData, fetchInterventions]);

  const handleToggleHelp = useCallback(() => setHelpOpen(h => !h), []);

  // Tab list for help overlay (1-indexed, max 9)
  const tabListForHelp = useMemo(
    () => visibleKeys.slice(0, 9).map((key, i) => ({
      index: i + 1,
      key,
      label: visibleGroups.flatMap(g => g.tabs).find(t => t.key === key)?.label ?? key,
    })),
    [visibleKeys, visibleGroups]
  );

  useKeyboardShortcuts({
    visibleKeys,
    activeTab,
    setActiveTab: setActiveTab as (key: string) => void,
    onRefresh: handleRefresh,
    onToggleHelp: handleToggleHelp,
    helpOpen,
  });

  // Template → Builder navigation
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleUseTemplate = useCallback((template: any) => {
    setBuilderTemplate(template);
    setActiveTab('builder');
  }, [setActiveTab]);

  const tabContent = () => {
    const wrap = (label: string, C: React.ComponentType<Record<string, never>>) => (
      <ErrorBoundary inline key={activeTab}>
        <Suspense fallback={<div className="ud-loading">Loading {label}...</div>}>
          <C />
        </Suspense>
      </ErrorBoundary>
    );

    switch (activeTab) {
      case 'chat':
        return (
          <ErrorBoundary inline key="chat">
            <Suspense fallback={<div className="ud-loading">Loading Chat...</div>}>
              <ChatTab />
            </Suspense>
          </ErrorBoundary>
        );
      case 'templates':
        return (
          <ErrorBoundary inline key="templates">
            <Suspense fallback={<div className="ud-loading">Loading Templates...</div>}>
              <TemplatesTab onUseTemplate={handleUseTemplate} />
            </Suspense>
          </ErrorBoundary>
        );
      case 'builder':
        return (
          <ErrorBoundary inline key="builder">
            <Suspense fallback={<div className="ud-loading">Loading Builder...</div>}>
              <BuilderTab prefilledTemplate={builderTemplate} />
            </Suspense>
          </ErrorBoundary>
        );
      case 'orchestrator':
        return (
          <ErrorBoundary inline key="orchestrator">
            <Suspense fallback={<div className="ud-loading">Loading Orchestrator...</div>}>
              <OrchestratorTab wsEvents={wsEvents} />
            </Suspense>
          </ErrorBoundary>
        );
      case 'fleet':
        return (
          <ErrorBoundary inline key="fleet">
            <Suspense fallback={<div className="ud-loading">Loading Fleet...</div>}>
              <FleetTab wsEvents={wsEvents} />
            </Suspense>
          </ErrorBoundary>
        );
      case 'deploy':
        return (
          <ErrorBoundary inline key="deploy">
            <Suspense fallback={<div className="ud-loading">Loading Deploy...</div>}>
              <PushPanel wsEvents={wsEvents} />
            </Suspense>
          </ErrorBoundary>
        );
      case 'documents': return wrap('Documents', Documents);
      case 'operations': return wrap('Operations', OperationsTab);
      case 'monitor': return wrap('Monitor', MonitorTab);
      case 'knowledge': return wrap('Knowledge', KnowledgeTab);
      case 'workflows': return wrap('Workflows', WorkflowBuilder);
      case 'settings':
        return (
          <ErrorBoundary inline key="settings">
            <Suspense fallback={<div className="ud-loading">Loading Settings...</div>}>
              <Settings embedded />
            </Suspense>
          </ErrorBoundary>
        );
      case 'users':
        return (
          <ErrorBoundary inline key="users">
            <Suspense fallback={<div className="ud-loading">Loading Users...</div>}>
              <UserAdmin embedded />
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
            {visibleGroups.map((group, gi) => (
              <Fragment key={group.label}>
                {gi > 0 && <div className="ud-tab-divider" role="separator" />}
                <span className="ud-tab-group-label" role="presentation">{group.label}</span>
                {group.tabs.map((t) => (
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
              </Fragment>
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
