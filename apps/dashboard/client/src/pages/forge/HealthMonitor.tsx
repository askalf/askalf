import { useState, useEffect, useCallback } from 'react';
import { hubApi } from '../../hooks/useHubApi';
import { usePolling } from '../../hooks/usePolling';
import StatCard from '../hub/shared/StatCard';
import './forge-observe.css';

interface HealthCheck {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  value: string;
  threshold?: string;
}

interface Alert {
  severity: 'info' | 'warning' | 'critical';
  message: string;
  metric: string;
  value: number;
  threshold: number;
}

interface HealthReport {
  timestamp: string;
  overall: 'healthy' | 'degraded' | 'critical';
  checks: HealthCheck[];
  alerts: Alert[];
}

export default function HealthMonitor() {
  const [report, setReport] = useState<HealthReport | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchHealth = useCallback(async () => {
    try {
      const data = await hubApi.monitoring.health() as unknown as HealthReport;
      setReport(data);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchHealth(); }, [fetchHealth]);
  usePolling(fetchHealth, 30000);

  const checkColor: Record<string, string> = { pass: '#4ade80', warn: '#eab308', fail: '#ef4444' };

  return (
    <div className="fo-overview">
      <div className="fo-stats">
        <StatCard
          value={report?.overall ?? 'Loading...'}
          label="System Status"
          variant={report?.overall === 'healthy' ? 'success' : report?.overall === 'degraded' ? 'warning' : report?.overall === 'critical' ? 'danger' : 'default'}
          large
          pulse={report?.overall === 'critical'}
        />
        <StatCard value={report?.checks?.filter((c) => c.status === 'pass').length ?? '-'} label="Checks Passing" variant="success" />
        <StatCard value={report?.alerts?.length ?? 0} label="Active Alerts" variant={(report?.alerts?.length ?? 0) > 0 ? 'danger' : 'default'} />
        <StatCard value={report ? new Date(report.timestamp).toLocaleTimeString() : '-'} label="Last Check" />
      </div>

      {/* Alerts */}
      {report && (report.alerts?.length ?? 0) > 0 && (
        <div className="fo-section" style={{ marginBottom: '16px' }}>
          <div className="fo-section-header"><h3>Active Alerts</h3></div>
          {report.alerts.map((alert, i) => (
            <div key={i} className="fo-card" style={{
              marginBottom: '8px',
              borderLeft: `3px solid ${alert.severity === 'critical' ? '#ef4444' : alert.severity === 'warning' ? '#eab308' : '#6366f1'}`,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '13px', fontWeight: 600 }}>{alert.message}</span>
                <span className={`hub-badge hub-badge--${alert.severity === 'critical' ? 'danger' : alert.severity === 'warning' ? 'warning' : 'default'}`}>
                  {alert.severity}
                </span>
              </div>
              <div style={{ fontSize: '11px', opacity: 0.5, marginTop: '4px' }}>
                {alert.metric}: {alert.value} (threshold: {alert.threshold})
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Health Checks */}
      <div className="fo-section">
        <div className="fo-section-header">
          <h3>Health Checks</h3>
          <button className="hub-btn hub-btn--sm" onClick={fetchHealth} disabled={loading}>
            {loading ? 'Checking...' : 'Refresh'}
          </button>
        </div>

        {loading && !report && <div className="fo-empty">Running health checks...</div>}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '8px' }}>
          {report?.checks?.map((check) => (
            <div key={check.name} className="fo-card" style={{ padding: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <span style={{ fontSize: '13px', fontWeight: 600 }}>{check.name.replace(/_/g, ' ')}</span>
                <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: checkColor[check.status] || '#6b7280' }} />
              </div>
              <div style={{ fontSize: '18px', fontWeight: 700 }}>{check.value}</div>
              {check.threshold && <div style={{ fontSize: '11px', opacity: 0.4 }}>Threshold: {check.threshold}</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
