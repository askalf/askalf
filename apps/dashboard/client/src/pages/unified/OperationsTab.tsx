import { useState, lazy, Suspense, useMemo, useEffect, useCallback } from 'react';
import { useHubStore } from '../../stores/hub';
import TabBar from '../../components/TabBar';
import './OperationsTab.css';

const InterventionGateway = lazy(() => import('../hub/InterventionGateway'));
const Tickets = lazy(() => import('../hub/Tickets'));
const ContentFeed = lazy(() => import('../hub/ContentFeed'));

const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:3001' : '';

type Sub = 'tickets' | 'interventions' | 'content' | 'reports';

const SUB_TABS: { key: Sub; label: string }[] = [
  { key: 'tickets', label: 'Tickets' },
  { key: 'interventions', label: 'Approvals' },
  { key: 'reports', label: 'Reports' },
  { key: 'content', label: 'Content' },
];

interface BriefingData {
  summary: string;
  highlights: string[];
  cost: { total: number; byAgent: Array<{ agentName: string; totalCost: number; executionCount: number }> };
  tickets: { resolved: number; opened: number; stillOpen: number };
  findings: { total: number; critical: number; warning: number };
  memory: { semantic: number; episodic: number; procedural: number };
  period: { start?: string; end?: string; from?: string; to?: string };
  generatedAt: string;
}

function ReportsPanel() {
  const [briefing, setBriefing] = useState<BriefingData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchBriefing = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/admin/briefing/daily`, { credentials: 'include' });
      if (res.ok) setBriefing(await res.json() as BriefingData);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchBriefing(); }, [fetchBriefing]);

  if (loading) return <div style={{ padding: '2rem', color: 'var(--text-muted)' }}>Loading briefing...</div>;
  if (!briefing) return <div style={{ padding: '2rem', color: 'var(--text-muted)' }}>No briefing data available.</div>;

  return (
    <div style={{ padding: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: 'var(--text)' }}>Daily Briefing</h3>
          <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            {new Date(briefing.period.start || briefing.period.from || '').toLocaleDateString()} — {new Date(briefing.period.end || briefing.period.to || '').toLocaleDateString()}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <a
            href={`${API_BASE}/api/v1/admin/briefing/daily/html`}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              padding: '6px 14px', fontSize: '0.8rem', fontWeight: 600, borderRadius: '6px',
              background: 'var(--crystal, #7c3aed)', color: '#fff', textDecoration: 'none',
              display: 'inline-flex', alignItems: 'center', gap: '4px',
            }}
          >
            Open Full Report
          </a>
          <button
            onClick={fetchBriefing}
            style={{
              padding: '6px 14px', fontSize: '0.8rem', fontWeight: 600, borderRadius: '6px',
              background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            Refresh
          </button>
        </div>
      </div>

      <div style={{
        padding: '16px', background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: '10px', marginBottom: '16px', lineHeight: 1.6,
      }}>
        <p style={{ margin: 0, color: 'var(--text)', fontSize: '0.9rem' }}>{briefing.summary}</p>
      </div>

      {briefing.highlights.length > 0 && (
        <div style={{ marginBottom: '16px' }}>
          <h4 style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>Highlights</h4>
          {briefing.highlights.map((h, i) => (
            <div key={i} style={{
              padding: '8px 12px', fontSize: '0.85rem', color: 'var(--text)',
              borderLeft: '3px solid var(--crystal, #7c3aed)', marginBottom: '4px',
              background: 'var(--surface)', borderRadius: '0 6px 6px 0',
            }}>
              {h}
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px' }}>
        <div style={{ padding: '14px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px', textAlign: 'center' }}>
          <div style={{ fontSize: '1.5rem', fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--crystal, #7c3aed)' }}>${briefing.cost.total.toFixed(2)}</div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginTop: '4px' }}>Total Cost</div>
        </div>
        <div style={{ padding: '14px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px', textAlign: 'center' }}>
          <div style={{ fontSize: '1.5rem', fontWeight: 800, fontFamily: 'var(--font-mono)', color: '#22c55e' }}>{briefing.tickets.resolved}</div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginTop: '4px' }}>Tickets Resolved</div>
        </div>
        <div style={{ padding: '14px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px', textAlign: 'center' }}>
          <div style={{ fontSize: '1.5rem', fontWeight: 800, fontFamily: 'var(--font-mono)', color: '#f59e0b' }}>{briefing.tickets.stillOpen}</div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginTop: '4px' }}>Still Open</div>
        </div>
        <div style={{ padding: '14px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px', textAlign: 'center' }}>
          <div style={{ fontSize: '1.5rem', fontWeight: 800, fontFamily: 'var(--font-mono)', color: '#ef4444' }}>{briefing.findings.total}</div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginTop: '4px' }}>Findings</div>
        </div>
      </div>
    </div>
  );
}

export default function OperationsTab() {
  const [sub, setSub] = useState<Sub>('tickets');

  const tickets = useHubStore((s) => s.tickets);
  const interventions = useHubStore((s) => s.interventions);
  const contentPagination = useHubStore((s) => s.contentPagination);

  const stats = useMemo(() => {
    const openTickets = tickets.filter((t) => t.status === 'open' || t.status === 'in_progress').length;
    const pendingInterventions = interventions.length;
    const contentTotal = contentPagination?.total ?? 0;
    const criticalTickets = tickets.filter((t) => t.priority === 'urgent').length;
    return { openTickets, pendingInterventions, contentTotal, criticalTickets };
  }, [tickets, interventions, contentPagination]);

  return (
    <div className="ops-tab">
      <div className="ops-header">
        <div className="ops-title-row">
          <span className="ops-icon">&#x2699;</span>
          <h2 className="ops-title">Tickets & Approvals</h2>
        </div>
        <p className="ops-subtitle">Work items, approvals, and reports</p>
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
        <TabBar tabs={SUB_TABS} active={sub} onChange={(k) => setSub(k as Sub)} className="ops-sub-tabs" tabClassName="ops-sub-tab" ariaLabel="Operations sections" />
        <div className="ops-panel">
          <Suspense fallback={<div className="ud-loading">Loading...</div>}>
            {sub === 'tickets' && <Tickets />}
            {sub === 'interventions' && <InterventionGateway />}
            {sub === 'content' && <ContentFeed />}
            {sub === 'reports' && <ReportsPanel />}
          </Suspense>
        </div>
      </div>
    </div>
  );
}
