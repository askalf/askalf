import { useAnalyticsStore } from '../../stores/analytics';
import { fmt, fmtCurrency, fmtCurrencyFull, fmtPercent } from '../../hooks/useAnalyticsApi';

function fmtEnvWater(ml: number): string {
  if (ml >= 1_000_000) return `${(ml / 1_000_000).toFixed(1)}m\u00B3`;
  if (ml >= 1000) return `${(ml / 1000).toFixed(1)}L`;
  return `${Math.round(ml)}ml`;
}

function fmtEnvPower(wh: number): string {
  if (wh >= 1_000_000) return `${(wh / 1_000_000).toFixed(1)}MWh`;
  if (wh >= 1000) return `${(wh / 1000).toFixed(1)}kWh`;
  return `${Math.round(wh)}Wh`;
}

function fmtEnvCarbon(g: number): string {
  if (g >= 1_000_000) return `${(g / 1_000_000).toFixed(1)}t`;
  if (g >= 1000) return `${(g / 1000).toFixed(1)}kg`;
  return `${Math.round(g)}g`;
}

export default function InvestorView() {
  const metrics = useAnalyticsStore((s) => s.metrics);
  if (!metrics) return null;

  const arr = metrics.revenue.mrrCents * 12;
  const arpu = metrics.revenue.activeSubscriptions > 0
    ? metrics.revenue.mrrCents / metrics.revenue.activeSubscriptions
    : 0;
  const dau = metrics.users.active.last24h;
  const mau = metrics.users.active.last30d;
  const dauMau = mau > 0 ? (dau / mau) * 100 : 0;
  const paidUsers = Object.entries(metrics.users.byTier)
    .filter(([tier]) => tier !== 'free')
    .reduce((sum, [, count]) => sum + count, 0);
  const conversionRate = metrics.users.total > 0 ? (paidUsers / metrics.users.total) * 100 : 0;
  const weeklyGrowthRate = metrics.users.total > 0
    ? (metrics.users.growth.thisWeek / (metrics.users.total - metrics.users.growth.thisWeek)) * 100
    : 0;
  const costSavingsPerUser = metrics.users.total > 0
    ? (metrics.tokens.saved * 0.003 / 1000) / metrics.users.total
    : 0;

  return (
    <div className="analytics-investor">
      {/* Hero KPIs */}
      <div className="analytics-investor-hero">
        <div className="analytics-hero-kpi analytics-hero-kpi--primary">
          <div className="analytics-hero-value">{fmtCurrency(metrics.revenue.mrrCents)}</div>
          <div className="analytics-hero-label">Monthly Recurring Revenue</div>
          <div className="analytics-hero-sub">{fmtCurrency(arr)} ARR</div>
        </div>
        <div className="analytics-hero-kpi">
          <div className="analytics-hero-value">{fmt(metrics.users.total)}</div>
          <div className="analytics-hero-label">Total Users</div>
          <div className="analytics-hero-sub positive">+{fmtPercent(weeklyGrowthRate)} WoW</div>
        </div>
        <div className="analytics-hero-kpi">
          <div className="analytics-hero-value">{fmtPercent(dauMau)}</div>
          <div className="analytics-hero-label">DAU/MAU Ratio</div>
          <div className="analytics-hero-sub">{fmt(dau)} / {fmt(mau)}</div>
        </div>
        <div className="analytics-hero-kpi">
          <div className="analytics-hero-value">{fmtPercent(conversionRate)}</div>
          <div className="analytics-hero-label">Paid Conversion</div>
          <div className="analytics-hero-sub">{fmt(paidUsers)} paid users</div>
        </div>
      </div>

      {/* Growth */}
      <div className="analytics-investor-section">
        <h2>Growth Metrics</h2>
        <div className="analytics-investor-grid">
          <div className="analytics-investor-card">
            <div className="analytics-investor-card-title">User Growth</div>
            <div className="analytics-growth-metrics">
              <div className="analytics-growth-item"><span>Today</span><span className="positive">+{metrics.users.growth.today}</span></div>
              <div className="analytics-growth-item"><span>This Week</span><span className="positive">+{metrics.users.growth.thisWeek}</span></div>
              <div className="analytics-growth-item"><span>This Month</span><span className="positive">+{metrics.users.growth.thisMonth}</span></div>
            </div>
          </div>
          <div className="analytics-investor-card">
            <div className="analytics-investor-card-title">Engagement</div>
            <div className="analytics-metric-row"><span>Conversations Today</span><span>{fmt(metrics.conversations.today)}</span></div>
            <div className="analytics-metric-row"><span>Messages Today</span><span>{fmt(metrics.conversations.messagesToday)}</span></div>
            <div className="analytics-metric-row"><span>Avg Msgs/Conversation</span><span>{metrics.conversations.avgMessagesPerConvo}</span></div>
          </div>
          <div className="analytics-investor-card">
            <div className="analytics-investor-card-title">Waitlist Pipeline</div>
            <div className="analytics-metric-row"><span>Total Waitlist</span><span>{fmt(metrics.waitlist.total)}</span></div>
            <div className="analytics-metric-row"><span>Converted</span><span>{fmt(metrics.waitlist.converted)}</span></div>
            <div className="analytics-metric-row"><span>Conversion Rate</span><span className="highlight">{fmtPercent(metrics.waitlist.conversionRate)}</span></div>
          </div>
        </div>
      </div>

      {/* Revenue */}
      <div className="analytics-investor-section">
        <h2>Revenue & Unit Economics</h2>
        <div className="analytics-investor-grid">
          <div className="analytics-investor-card analytics-investor-card--wide">
            <div className="analytics-investor-card-title">Revenue Breakdown</div>
            <div className="analytics-revenue-breakdown">
              <div className="analytics-revenue-item">
                <div className="analytics-revenue-source">Subscriptions</div>
                <div className="analytics-revenue-amount">{fmtCurrencyFull(metrics.revenue.mrrCents)}/mo</div>
                <div className="analytics-revenue-detail">{metrics.revenue.activeSubscriptions} active</div>
              </div>
              <div className="analytics-revenue-item">
                <div className="analytics-revenue-source">Token Bundles</div>
                <div className="analytics-revenue-amount">{fmtCurrencyFull(metrics.revenue.bundleRevenueCents)}</div>
                <div className="analytics-revenue-detail">{metrics.revenue.bundlesSold} sold</div>
              </div>
            </div>
          </div>
          <div className="analytics-investor-card">
            <div className="analytics-investor-card-title">Unit Economics</div>
            <div className="analytics-metric-row"><span>ARPU (Monthly)</span><span>{fmtCurrencyFull(arpu)}</span></div>
            <div className="analytics-metric-row"><span>Cost Saved/User</span><span className="highlight">{fmtCurrencyFull(costSavingsPerUser * 100)}</span></div>
          </div>
          <div className="analytics-investor-card">
            <div className="analytics-investor-card-title">Plan Distribution</div>
            <div className="analytics-plan-bars">
              {Object.entries(metrics.users.byTier)
                .filter(([, count]) => count > 0)
                .sort((a, b) => b[1] - a[1])
                .map(([tier, count]) => {
                  const pct = (count / metrics.users.total) * 100;
                  return (
                    <div key={tier} className="analytics-plan-row">
                      <span>{tier}</span>
                      <div className="analytics-plan-track">
                        <div className={`analytics-plan-fill analytics-tier--${tier}`} style={{ width: `${pct}%` }} />
                      </div>
                      <span>{count}</span>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      </div>

      {/* Tech Moat */}
      <div className="analytics-investor-section">
        <h2>Technology Advantage</h2>
        <div className="analytics-investor-grid">
          <div className="analytics-investor-card">
            <div className="analytics-investor-card-title">AI Convergence</div>
            <div className="analytics-convergence">
              <div className="analytics-convergence-ring">
                <svg viewBox="0 0 100 100">
                  <circle cx="50" cy="50" r="45" fill="none" stroke="var(--border)" strokeWidth="8" />
                  <circle cx="50" cy="50" r="45" fill="none" stroke="#10b981" strokeWidth="8"
                    strokeDasharray={`${metrics.shards.hitRate * 2.83} 283`}
                    transform="rotate(-90 50 50)" />
                </svg>
                <div className="analytics-convergence-value">{metrics.shards.hitRate}%</div>
              </div>
              <div className="analytics-convergence-label">Shard Hit Rate</div>
              <p className="analytics-convergence-explain">
                {metrics.shards.hitRate}% of queries answered from learned knowledge
              </p>
            </div>
          </div>
          <div className="analytics-investor-card">
            <div className="analytics-investor-card-title">Efficiency</div>
            <div className="analytics-metric-row"><span>Total Shards</span><span>{fmt(metrics.shards.total)}</span></div>
            <div className="analytics-metric-row"><span>Tokens Saved</span><span className="highlight">{fmt(metrics.tokens.saved)}</span></div>
            <div className="analytics-metric-row"><span>Est. Savings</span><span className="highlight">{fmtCurrencyFull((metrics.tokens.saved * 0.003 / 1000) * 100)}</span></div>
          </div>
          <div className="analytics-investor-card">
            <div className="analytics-investor-card-title">Global Environmental Impact</div>
            <div className="analytics-env-items">
              <div className="analytics-env-item"><span>💧</span><span>{fmtEnvWater(metrics.environmental.waterMlSaved)}</span><span>Water Saved</span></div>
              <div className="analytics-env-item"><span>⚡</span><span>{fmtEnvPower(metrics.environmental.powerWhSaved)}</span><span>Power Saved</span></div>
              <div className="analytics-env-item"><span>🌱</span><span>{fmtEnvCarbon(metrics.environmental.carbonGSaved)}</span><span>CO&#8322; Avoided</span></div>
            </div>
            <div className="analytics-env-footnote">Platform-wide totals across all users</div>
          </div>
        </div>
      </div>

      {/* Reliability */}
      <div className="analytics-investor-section">
        <h2>Platform Reliability</h2>
        <div className="analytics-reliability-strip">
          <div className="analytics-reliability-item">
            <div className={`analytics-reliability-value ${metrics.systemHealth.uptime >= 99.9 ? 'excellent' : ''}`}>{fmtPercent(metrics.systemHealth.uptime)}</div>
            <div className="analytics-reliability-label">Uptime</div>
          </div>
          <div className="analytics-reliability-item">
            <div className={`analytics-reliability-value ${metrics.systemHealth.errorRate < 0.5 ? 'excellent' : ''}`}>{fmtPercent(metrics.systemHealth.errorRate)}</div>
            <div className="analytics-reliability-label">Error Rate</div>
          </div>
          <div className="analytics-reliability-item">
            <div className="analytics-reliability-value">{metrics.systemHealth.apiLatencyP50Ms}ms</div>
            <div className="analytics-reliability-label">P50 Latency</div>
          </div>
          <div className="analytics-reliability-item">
            <div className="analytics-reliability-value">{metrics.systemHealth.apiLatencyP95Ms}ms</div>
            <div className="analytics-reliability-label">P95 Latency</div>
          </div>
        </div>
      </div>
    </div>
  );
}
