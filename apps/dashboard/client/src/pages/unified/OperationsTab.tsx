import { useState, useCallback, lazy, Suspense, useMemo } from 'react';
import { useHubStore } from '../../stores/hub';
import { usePolling } from '../../hooks/usePolling';
import './OperationsTab.css';

const InterventionGateway = lazy(() => import('../hub/InterventionGateway'));
const Tickets = lazy(() => import('../hub/Tickets'));
const ContentFeed = lazy(() => import('../hub/ContentFeed'));

type Sub = 'tickets' | 'interventions' | 'content';

const SUB_TABS: { key: Sub; label: string }[] = [
  { key: 'tickets', label: 'Tickets' },
  { key: 'interventions', label: 'Interventions' },
  { key: 'content', label: 'Content' },
];

export default function OperationsTab() {
  const [sub, setSub] = useState<Sub>('tickets');

  const tickets = useHubStore((s) => s.tickets);
  const interventions = useHubStore((s) => s.interventions);
  const contentPagination = useHubStore((s) => s.contentPagination);
  const ribbonData = useHubStore((s) => s.ribbonData);
  const fetchRibbonData = useHubStore((s) => s.fetchRibbonData);

  const poll = useCallback(() => { fetchRibbonData(); }, [fetchRibbonData]);
  usePolling(poll, 15000);

  const stats = useMemo(() => {
    const openTickets = ribbonData.openTickets || tickets.filter((t) => t.status === 'open').length;
    const pendingInterventions = ribbonData.pendingInterventions || interventions.length;
    const contentTotal = contentPagination?.total ?? 0;
    const criticalTickets = tickets.filter((t) => t.priority === 'urgent').length;
    return { openTickets, pendingInterventions, contentTotal, criticalTickets };
  }, [tickets, interventions, contentPagination, ribbonData]);

  return (
    <div className="ops-tab">
      <div className="ops-header">
        <div className="ops-title-row">
          <span className="ops-icon">&#x2699;</span>
          <h2 className="ops-title">Operations</h2>
        </div>
        <p className="ops-subtitle">Tickets · Interventions · Content</p>
      </div>

      <div className="ops-stats-grid">
        <div className="ops-stat-card">
          <div className="ops-stat-value ops-stat--tickets">{stats.openTickets}</div>
          <div className="ops-stat-label">Open Tickets</div>
        </div>
        <div className="ops-stat-card">
          <div className="ops-stat-value ops-stat--interventions">
            {stats.pendingInterventions}
            {stats.pendingInterventions > 0 && <span className="ops-stat-pulse" />}
          </div>
          <div className="ops-stat-label">Pending</div>
        </div>
        <div className="ops-stat-card">
          <div className="ops-stat-value ops-stat--content">{stats.contentTotal}</div>
          <div className="ops-stat-label">Content Items</div>
        </div>
        <div className="ops-stat-card">
          <div className="ops-stat-value ops-stat--critical">{stats.criticalTickets}</div>
          <div className="ops-stat-label">Critical</div>
        </div>
      </div>

      <div className="ops-content">
        <div className="ops-sub-tabs" role="tablist" aria-label="Operations sections">
          {SUB_TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={sub === t.key}
              className={`ops-sub-tab ${sub === t.key ? 'active' : ''}`}
              onClick={() => setSub(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="ops-panel">
          <Suspense fallback={<div className="ud-loading">Loading...</div>}>
            {sub === 'tickets' && <Tickets />}
            {sub === 'interventions' && <InterventionGateway />}
            {sub === 'content' && <ContentFeed />}
          </Suspense>
        </div>
      </div>
    </div>
  );
}
