import { useAnalyticsStore } from '../../stores/analytics';
import { fmt, fmtPercent } from '../../hooks/useAnalyticsApi';

function fmtWater(ml: number): string {
  if (ml >= 1_000_000) return `${(ml / 1_000_000).toFixed(1)}m³`;
  if (ml >= 1000) return `${(ml / 1000).toFixed(1)}L`;
  return `${Math.round(ml)}ml`;
}

function fmtPower(wh: number): string {
  if (wh >= 1_000_000) return `${(wh / 1_000_000).toFixed(1)}MWh`;
  if (wh >= 1000) return `${(wh / 1000).toFixed(1)}kWh`;
  return `${Math.round(wh)}Wh`;
}

function fmtCarbon(g: number): string {
  if (g >= 1_000_000) return `${(g / 1_000_000).toFixed(1)}t`;
  if (g >= 1000) return `${(g / 1000).toFixed(1)}kg`;
  return `${Math.round(g)}g`;
}

function fmtDollars(tokensSaved: number): string {
  // Approximate cost savings at $0.003/1K tokens (Haiku-class inference)
  const saved = (tokensSaved / 1000) * 0.003;
  if (saved >= 1000) return `$${(saved / 1000).toFixed(1)}K`;
  if (saved >= 1) return `$${saved.toFixed(2)}`;
  return saved > 0 ? '$<0.01' : '$0';
}

export default function SystemHealthSection() {
  const metrics = useAnalyticsStore((s) => s.metrics);
  if (!metrics) return null;

  return (
    <div className="analytics-section">
      {/* Global Environmental Impact - Platform-wide totals */}
      <h2>Global Environmental Impact</h2>
      <p className="analytics-section-subtitle">Platform-wide totals across all users and sessions</p>
      <div className="analytics-env-strip">
        <div className="analytics-env-card analytics-env-card--highlight">
          <div className="analytics-env-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="24" height="24">
              <circle cx="12" cy="12" r="8" />
              <path d="M14.5 9a3.5 3.5 0 0 0-5 0 3.5 3.5 0 0 0 0 5 3.5 3.5 0 0 0 5 0" />
              <path d="M12 6v2M12 16v2" />
            </svg>
          </div>
          <div className="analytics-env-val">{fmt(metrics.environmental.tokensSaved)}</div>
          <div className="analytics-env-lbl">Tokens Saved</div>
          <div className="analytics-env-sub">{fmtDollars(metrics.environmental.tokensSaved)} in LLM costs</div>
        </div>
        <div className="analytics-env-card">
          <div className="analytics-env-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="24" height="24">
              <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" />
            </svg>
          </div>
          <div className="analytics-env-val">{fmtWater(metrics.environmental.waterMlSaved)}</div>
          <div className="analytics-env-lbl">Water Saved</div>
          <div className="analytics-env-sub">Data center cooling</div>
        </div>
        <div className="analytics-env-card">
          <div className="analytics-env-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="24" height="24">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          </div>
          <div className="analytics-env-val">{fmtPower(metrics.environmental.powerWhSaved)}</div>
          <div className="analytics-env-lbl">Energy Saved</div>
          <div className="analytics-env-sub">GPU compute avoided</div>
        </div>
        <div className="analytics-env-card">
          <div className="analytics-env-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="24" height="24">
              <circle cx="12" cy="12" r="10" />
              <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
          </div>
          <div className="analytics-env-val">{fmtCarbon(metrics.environmental.carbonGSaved)}</div>
          <div className="analytics-env-lbl">CO&#8322; Avoided</div>
          <div className="analytics-env-sub">Carbon emissions reduced</div>
        </div>
      </div>

      {/* System Health */}
      <h2 style={{ marginTop: 'var(--space-xl)' }}>System Health</h2>
      <div className="analytics-grid">
        <div className="analytics-card">
          <h3>Performance</h3>
          <div className="analytics-stat-grid">
            <div className="analytics-stat">
              <span className={`analytics-val ${metrics.systemHealth.uptime >= 99.9 ? 'excellent' : ''}`}>
                {fmtPercent(metrics.systemHealth.uptime)}
              </span>
              <span className="analytics-lbl">Uptime</span>
            </div>
            <div className="analytics-stat">
              <span className={`analytics-val ${metrics.systemHealth.errorRate < 0.5 ? 'excellent' : ''}`}>
                {fmtPercent(metrics.systemHealth.errorRate)}
              </span>
              <span className="analytics-lbl">Errors</span>
            </div>
          </div>
        </div>
        <div className="analytics-card">
          <h3>Latency</h3>
          <div className="analytics-stat-grid">
            <div className="analytics-stat"><span className="analytics-val">{metrics.systemHealth.apiLatencyP50Ms}ms</span><span className="analytics-lbl">P50</span></div>
            <div className="analytics-stat"><span className="analytics-val">{metrics.systemHealth.apiLatencyP95Ms}ms</span><span className="analytics-lbl">P95</span></div>
            <div className="analytics-stat"><span className="analytics-val">{metrics.systemHealth.apiLatencyP99Ms}ms</span><span className="analytics-lbl">P99</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}
