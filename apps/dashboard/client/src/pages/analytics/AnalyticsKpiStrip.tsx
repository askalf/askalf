import { useAnalyticsStore } from '../../stores/analytics';
import { fmt, fmtCurrency, fmtPercent } from '../../hooks/useAnalyticsApi';

export default function AnalyticsKpiStrip() {
  const metrics = useAnalyticsStore((s) => s.metrics);
  const dateRange = useAnalyticsStore((s) => s.dateRange);
  const setDateRange = useAnalyticsStore((s) => s.setDateRange);

  if (!metrics) return null;

  const dau = metrics.users.active.last24h;
  const mau = metrics.users.active.last30d;
  const dauMau = mau > 0 ? (dau / mau) * 100 : 0;

  // Trend: growth vs total gives direction
  const userTrend = metrics.users.growth.today > 0 ? 'up' : metrics.users.growth.today < 0 ? 'down' : 'flat';
  const msgTrend = metrics.conversations.messagesToday > 0 ? 'up' : 'flat';

  const TrendIcon = ({ dir }: { dir: string }) => (
    <span className={`analytics-trend analytics-trend--${dir}`}>
      {dir === 'up' ? '↑' : dir === 'down' ? '↓' : '–'}
    </span>
  );

  return (
    <div className="analytics-kpi-strip">
      <div className="analytics-kpi-cards">
        <div className="analytics-kpi">
          <span className="analytics-kpi-dot analytics-kpi-dot--users" />
          <div className="analytics-kpi-body">
            <div className="analytics-kpi-value">{fmt(metrics.users.total)}</div>
            <div className="analytics-kpi-label">Users</div>
            <div className="analytics-kpi-delta">
              <TrendIcon dir={userTrend} />
              +{metrics.users.growth.today}
            </div>
          </div>
        </div>

        <div className="analytics-kpi">
          <span className="analytics-kpi-dot analytics-kpi-dot--revenue" />
          <div className="analytics-kpi-body">
            <div className="analytics-kpi-value">{fmtCurrency(metrics.revenue.mrrCents)}</div>
            <div className="analytics-kpi-label">MRR</div>
            <div className="analytics-kpi-delta">{metrics.revenue.activeSubscriptions} subs</div>
          </div>
        </div>

        <div className="analytics-kpi">
          <span className="analytics-kpi-dot analytics-kpi-dot--shards" />
          <div className="analytics-kpi-body">
            <div className="analytics-kpi-value">{metrics.shards.hitRate}%</div>
            <div className="analytics-kpi-label">Hit Rate</div>
            <div className="analytics-kpi-delta">{fmt(metrics.shards.executions.today)} exec</div>
          </div>
        </div>

        <div className="analytics-kpi">
          <span className="analytics-kpi-dot analytics-kpi-dot--messages" />
          <div className="analytics-kpi-body">
            <div className="analytics-kpi-value">{fmt(metrics.conversations.messagesToday)}</div>
            <div className="analytics-kpi-label">Msgs Today</div>
            <div className="analytics-kpi-delta">
              <TrendIcon dir={msgTrend} />
              {metrics.conversations.today} convos
            </div>
          </div>
        </div>

        <div className="analytics-kpi">
          <span className="analytics-kpi-dot analytics-kpi-dot--active" />
          <div className="analytics-kpi-body">
            <div className="analytics-kpi-value">{fmt(dau)}</div>
            <div className="analytics-kpi-label">DAU</div>
            <div className="analytics-kpi-delta">{fmtPercent(dauMau)} of MAU</div>
          </div>
        </div>
      </div>

      <div className="analytics-date-range">
        {(['24h', '7d', '30d'] as const).map((r) => (
          <button
            key={r}
            className={`analytics-range-pill ${dateRange === r ? 'active' : ''}`}
            onClick={() => setDateRange(r)}
          >
            {r}
          </button>
        ))}
      </div>
    </div>
  );
}
