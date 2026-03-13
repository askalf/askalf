import { useState, useEffect, useRef } from 'react';

interface HealthCheck {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  value?: string | number;
  message?: string;
}

interface HealthData {
  status?: 'HEALTHY' | 'DEGRADED' | 'DOWN';
  overall?: 'healthy' | 'degraded' | 'critical';
  checks?: HealthCheck[];
  uptime?: number;
  alerts?: unknown[];
  timestamp?: string;
}

interface HeartbeatProps {
  activeExecutions?: number;
  hourlyCost?: number;
}

export default function HeartbeatIndicator({ activeExecutions = 0, hourlyCost = 0 }: HeartbeatProps) {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [history, setHistory] = useState<{ time: Date; health: HealthData }[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [lastCheck, setLastCheck] = useState<Date | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const fetchHealth = async () => {
    try {
      const res = await fetch('/api/v1/admin/monitoring/health', { credentials: 'include' });
      if (!res.ok) return;
      const data: HealthData = await res.json();
      const now = new Date();
      setHealth(data);
      setLastCheck(now);
      setHistory(prev => [{ time: now, health: data }, ...prev].slice(0, 5));
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    fetchHealth();
    const timer = setInterval(fetchHealth, 30000);
    return () => clearInterval(timer);
  }, []);

  // Close panel on outside click
  useEffect(() => {
    if (!panelOpen) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setPanelOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [panelOpen]);

  const rawStatus = health?.status?.toLowerCase() ?? health?.overall ?? null;
  const isHealthy = rawStatus === 'healthy' || rawStatus === 'healthy';
  const isDegraded = rawStatus === 'degraded' || rawStatus === 'warn';
  const isCritical = rawStatus === 'down' || rawStatus === 'critical' || rawStatus === 'fail';

  const color = isCritical
    ? '#ef4444'
    : isDegraded
    ? '#f59e0b'
    : isHealthy
    ? '#22c55e'
    : '#6b7280';

  const statusLabel = isCritical ? 'CRITICAL' : isDegraded ? 'DEGRADED' : isHealthy ? 'HEALTHY' : 'UNKNOWN';

  // Animation speed based on activity: faster = more executions running
  const bpm = activeExecutions > 5 ? 120 : activeExecutions > 2 ? 80 : activeExecutions > 0 ? 60 : 40;
  const animDuration = `${60 / bpm}s`;

  const formatUptime = (seconds?: number) => {
    if (!seconds) return 'unknown';
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  };

  const tooltipText = [
    `Status: ${statusLabel}`,
    `Uptime: ${formatUptime(health?.uptime)}`,
    `Last check: ${lastCheck ? lastCheck.toLocaleTimeString() : 'never'}`,
    `Active executions: ${activeExecutions}`,
    `Hourly cost: $${hourlyCost.toFixed(2)}/hr`,
  ].join('\n');

  const alertCount = Array.isArray(health?.alerts) ? health!.alerts!.length : 0;

  return (
    <div className="hb-wrapper" ref={panelRef}>
      <button
        className="hb-btn"
        onClick={() => setPanelOpen(p => !p)}
        title={tooltipText}
        aria-label={`System health: ${statusLabel}`}
      >
        <svg
          className="hb-ecg"
          viewBox="0 0 60 20"
          width="60"
          height="20"
          style={{ '--hb-color': color, '--hb-dur': animDuration } as React.CSSProperties}
        >
          {/* ECG flatline with spike */}
          <polyline
            className="hb-line"
            points="0,10 10,10 15,10 18,2 21,18 24,10 30,10 40,10 50,10 60,10"
            fill="none"
            stroke={color}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* Travelling pulse dot */}
          <circle className="hb-pulse-dot" r="2" fill={color} />
        </svg>
        <span className="hb-label" style={{ color }}>{statusLabel}</span>
      </button>

      {panelOpen && (
        <div className="hb-panel">
          <div className="hb-panel-header">
            <span className="hb-panel-title">System Health</span>
            <span className="hb-panel-status" style={{ color }}>{statusLabel}</span>
          </div>

          <div className="hb-panel-stats">
            <div className="hb-stat-row">
              <span>Uptime</span>
              <span>{formatUptime(health?.uptime)}</span>
            </div>
            <div className="hb-stat-row">
              <span>Last check</span>
              <span>{lastCheck ? lastCheck.toLocaleTimeString() : '—'}</span>
            </div>
            <div className="hb-stat-row">
              <span>Active executions</span>
              <span>{activeExecutions}</span>
            </div>
            <div className="hb-stat-row">
              <span>Hourly cost</span>
              <span>${hourlyCost.toFixed(2)}/hr</span>
            </div>
            <div className="hb-stat-row">
              <span>Active alerts</span>
              <span style={{ color: alertCount > 0 ? '#ef4444' : 'inherit' }}>{alertCount}</span>
            </div>
          </div>

          {health?.checks && health.checks.length > 0 && (
            <div className="hb-panel-checks">
              <div className="hb-checks-title">Health Checks</div>
              {health.checks.slice(0, 6).map((check, i) => (
                <div key={i} className="hb-check-row">
                  <span
                    className="hb-check-dot"
                    style={{
                      background: check.status === 'fail' ? '#ef4444' : check.status === 'warn' ? '#f59e0b' : '#22c55e',
                    }}
                  />
                  <span className="hb-check-name">{check.name}</span>
                  {check.value != null && <span className="hb-check-val">{String(check.value)}</span>}
                </div>
              ))}
            </div>
          )}

          {history.length > 0 && (
            <div className="hb-panel-history">
              <div className="hb-checks-title">Recent Checks</div>
              {history.map((h, i) => {
                const raw = h.health.status?.toLowerCase() ?? h.health.overall ?? 'unknown';
                const c = raw === 'healthy' ? '#22c55e' : raw === 'degraded' || raw === 'warn' ? '#f59e0b' : '#ef4444';
                return (
                  <div key={i} className="hb-check-row">
                    <span className="hb-check-dot" style={{ background: c }} />
                    <span className="hb-check-name">{h.time.toLocaleTimeString()}</span>
                    <span className="hb-check-val" style={{ color: c }}>{raw.toUpperCase()}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
