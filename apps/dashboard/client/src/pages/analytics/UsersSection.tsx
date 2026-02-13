import { useAnalyticsStore } from '../../stores/analytics';
import { fmt } from '../../hooks/useAnalyticsApi';

export default function UsersSection() {
  const metrics = useAnalyticsStore((s) => s.metrics);
  if (!metrics) return null;

  return (
    <div className="analytics-section">
      <h2>Users</h2>
      <div className="analytics-grid">
        <div className="analytics-card">
          <h3>Growth</h3>
          <div className="analytics-stat-grid">
            <div className="analytics-stat"><span className="analytics-val positive">+{metrics.users.growth.today}</span><span className="analytics-lbl">Today</span></div>
            <div className="analytics-stat"><span className="analytics-val positive">+{metrics.users.growth.thisWeek}</span><span className="analytics-lbl">Week</span></div>
            <div className="analytics-stat"><span className="analytics-val positive">+{metrics.users.growth.thisMonth}</span><span className="analytics-lbl">Month</span></div>
          </div>
        </div>
        <div className="analytics-card">
          <h3>Active</h3>
          <div className="analytics-stat-grid">
            <div className="analytics-stat"><span className="analytics-val">{fmt(metrics.users.active.last24h)}</span><span className="analytics-lbl">24h</span></div>
            <div className="analytics-stat"><span className="analytics-val">{fmt(metrics.users.active.last7d)}</span><span className="analytics-lbl">7d</span></div>
            <div className="analytics-stat"><span className="analytics-val">{fmt(metrics.users.active.last30d)}</span><span className="analytics-lbl">30d</span></div>
          </div>
        </div>
        <div className="analytics-card analytics-card--wide">
          <h3>Tier Distribution</h3>
          <div className="analytics-tier-bars">
            {Object.entries(metrics.users.byTier).map(([tier, count]) => {
              const pct = (count / Math.max(metrics.users.total, 1)) * 100;
              return (
                <div key={tier} className="analytics-tier-row">
                  <span className="analytics-tier-name">{tier}</span>
                  <div className="analytics-tier-track">
                    <div className={`analytics-tier-fill analytics-tier--${tier}`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="analytics-tier-count">{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
