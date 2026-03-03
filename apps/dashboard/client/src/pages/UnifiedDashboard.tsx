import { useState, useEffect, lazy, Suspense, useCallback, Fragment, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import TopBar from '../components/unified/TopBar';
import ErrorBoundary from '../components/ErrorBoundary';
import { useWebSocket } from '../hooks/useWebSocket';
import { hubApi } from '../hooks/useHubApi';
import { useAuthStore } from '../stores/auth';
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

type TabKey =
  | 'chat' | 'templates' | 'fleet' | 'documents'
  | 'builder' | 'orchestrator' | 'operations' | 'monitor' | 'knowledge'
  | 'workflows' | 'deploy';

interface TabGroup { label: string; tabs: { key: TabKey; label: string }[] }

const TAB_GROUPS: TabGroup[] = [
  { label: 'Main', tabs: [
    { key: 'chat', label: 'Chat' },
    { key: 'templates', label: 'Templates' },
    { key: 'fleet', label: 'Fleet' },
    { key: 'documents', label: 'Docs' },
  ]},
  { label: 'Admin', tabs: [
    { key: 'builder', label: 'Builder' },
    { key: 'orchestrator', label: 'Orchestrator' },
    { key: 'operations', label: 'Operations' },
    { key: 'monitor', label: 'Monitor' },
    { key: 'knowledge', label: 'Knowledge' },
    { key: 'workflows', label: 'Workflows' },
    { key: 'deploy', label: 'Deploy' },
  ]},
];

/** Tabs only visible to admin / super_admin */
const ADMIN_ONLY_TABS = new Set<TabKey>([
  'builder', 'orchestrator', 'operations', 'monitor', 'knowledge',
  'workflows', 'deploy',
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
  const { connected, events: wsEvents } = useWebSocket();

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
    }
  };

  return (
    <div className="ud-container">
      <TopBar
        wsConnected={connected}
        agentCount={agentCount}
        todayCost={todayCost}
        budgetLimit={budgetLimit}
      />
      <div className="ud-body ud-body-full">
        <div className="ud-main">
          <div className="ud-tab-bar">
            {visibleGroups.map((group, gi) => (
              <Fragment key={group.label}>
                {gi > 0 && <div className="ud-tab-divider" />}
                <span className="ud-tab-group-label">{group.label}</span>
                {group.tabs.map((t) => (
                  <button
                    key={t.key}
                    className={`ud-tab ${activeTab === t.key ? 'active' : ''}`}
                    onClick={() => setActiveTab(t.key)}
                  >
                    {t.label}
                  </button>
                ))}
              </Fragment>
            ))}
          </div>
          <div className="ud-tab-content">
            {tabContent()}
          </div>
        </div>
      </div>
    </div>
  );
}
