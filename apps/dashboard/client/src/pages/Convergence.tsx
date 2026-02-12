import { useEffect, useState, useCallback } from 'react';
import { useAuthStore } from '../stores/auth';
import { useConvergenceStore } from '../stores/convergence';
import { usePolling } from '../hooks/usePolling';
import type { TabKey } from '../hooks/useConvergenceApi';
import AdminAssistantPanel from '../components/admin/AdminAssistantPanel';
import TabIcon from './convergence/TabIcon';
import OverviewTab from './convergence/OverviewTab';
import InternalsTab from './convergence/InternalsTab';
import EngineTab from './convergence/EngineTab';
import MetacognitionTab from './convergence/MetacognitionTab';
import SystemTab from './convergence/SystemTab';
import './Convergence.css';

const TAB_LABELS: { key: TabKey; label: string; adminOnly?: boolean }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'internals', label: 'Internals', adminOnly: true },
  { key: 'engine', label: 'Metabolic Engine', adminOnly: true },
  { key: 'metacognition', label: 'Metacognition', adminOnly: true },
  { key: 'system', label: 'System Status', adminOnly: true },
];

export default function Convergence() {
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';

  const {
    data, loading, error, activeTab, autoRefresh, lastUpdated, metaEventFilter,
    setActiveTab, setAutoRefresh,
    fetchConvergence, fetchCycleHistory,
    fetchMetaStatus, fetchMetaInsights, fetchMetaEvents,
    fetchWorkerHealth,
  } = useConvergenceStore();

  const [assistantOpen, setAssistantOpen] = useState(false);

  useEffect(() => { document.title = 'Convergence — Ask ALF'; }, []);

  // Initial load
  useEffect(() => {
    fetchConvergence();
  }, [fetchConvergence]);

  // Tab-specific data
  useEffect(() => {
    if (!isAdmin) return;
    if (activeTab === 'engine') fetchCycleHistory();
    if (activeTab === 'metacognition') { fetchMetaStatus(); fetchMetaInsights(); fetchMetaEvents(); }
    if (activeTab === 'system') fetchWorkerHealth();
  }, [activeTab, isAdmin, fetchCycleHistory, fetchMetaStatus, fetchMetaInsights, fetchMetaEvents, fetchWorkerHealth]);

  // Re-fetch meta events on filter change
  useEffect(() => {
    if (activeTab === 'metacognition' && isAdmin) fetchMetaEvents();
  }, [metaEventFilter, activeTab, isAdmin, fetchMetaEvents]);

  // Auto-refresh using usePolling (prevents request pileup)
  const pollInterval = activeTab === 'system' ? 30000 : 15000;
  const pollRefresh = useCallback(() => {
    if (activeTab === 'overview' || activeTab === 'internals') fetchConvergence();
    if (activeTab === 'engine') fetchCycleHistory();
    if (activeTab === 'system') fetchWorkerHealth();
  }, [activeTab, fetchConvergence, fetchCycleHistory, fetchWorkerHealth]);
  usePolling(pollRefresh, pollInterval, autoRefresh);

  const handleRefresh = () => {
    if (activeTab === 'overview' || activeTab === 'internals') fetchConvergence();
    if (activeTab === 'engine') fetchCycleHistory();
    if (activeTab === 'metacognition') { fetchMetaStatus(); fetchMetaInsights(); fetchMetaEvents(); }
    if (activeTab === 'system') fetchWorkerHealth();
  };

  // Loading skeleton
  if (loading && !data) {
    return (
      <div className="convergence-page">
        <div className="convergence-skeleton">
          <div className="convergence-skeleton-hero" />
          <div className="convergence-skeleton-cards">
            <div className="convergence-skeleton-card" />
            <div className="convergence-skeleton-card" />
            <div className="convergence-skeleton-card" />
            <div className="convergence-skeleton-card" />
          </div>
          <div className="convergence-skeleton-chart" />
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="convergence-page">
        <div className="convergence-error">
          <p>{error}</p>
          <button onClick={fetchConvergence}>Try Again</button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const visibleTabs = TAB_LABELS.filter(t => !t.adminOnly || isAdmin);

  return (
    <div className={`convergence-page ${assistantOpen ? 'panel-open' : ''}`}>
      <div className="convergence-main">
        <div className="convergence-header">
          <div className="convergence-header-left">
            <h1>Convergence Dashboard</h1>
            <p className="convergence-subtitle">
              {autoRefresh && <span className="convergence-live-dot" />}
              Unlike every other AI tool, ALF's cost goes down the more you use it.
              {lastUpdated && (
                <span className="convergence-last-updated">
                  Updated {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </p>
          </div>
          <div className="convergence-header-right">
            <label className="convergence-refresh-toggle">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
              />
              Auto-refresh
            </label>
            <button className="convergence-refresh-btn" onClick={handleRefresh}>
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                <path d="M14 8A6 6 0 1 1 8 2" />
                <path d="M14 2v6h-6" />
              </svg>
            </button>
            <button className={`admin-assistant-toggle ${assistantOpen ? 'active' : ''}`} onClick={() => setAssistantOpen(!assistantOpen)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2a3 3 0 0 0-3 3v1a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                <path d="M19 10H5a2 2 0 0 0-2 2v1a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-1a2 2 0 0 0-2-2Z" />
                <path d="M12 15v4" />
                <path d="M8 19h8" />
              </svg>
              Assistant
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <nav className="convergence-tab-nav">
          {visibleTabs.map(({ key, label }) => (
            <button
              key={key}
              className={`convergence-tab-btn${activeTab === key ? ' active' : ''}`}
              onClick={() => setActiveTab(key)}
            >
              <TabIcon tab={key} />
              {label}
            </button>
          ))}
        </nav>

        {/* Tab Panel */}
        <div className="convergence-tab-panel" key={activeTab}>
          {activeTab === 'overview' && <OverviewTab />}
          {activeTab === 'internals' && isAdmin && <InternalsTab />}
          {activeTab === 'engine' && isAdmin && <EngineTab />}
          {activeTab === 'metacognition' && isAdmin && <MetacognitionTab />}
          {activeTab === 'system' && isAdmin && <SystemTab />}
        </div>
      </div>

      <AdminAssistantPanel
        isOpen={assistantOpen}
        onToggle={() => setAssistantOpen(!assistantOpen)}
        activeTier="procedural"
        pageContext="convergence"
      />
    </div>
  );
}
