import { useAnalyticsStore } from '../../stores/analytics';
import { fmt, fmtCurrency, fmtPercent } from '../../hooks/useAnalyticsApi';

export default function UsageRevenueSection() {
  const metrics = useAnalyticsStore((s) => s.metrics);
  if (!metrics) return null;

  return (
    <div className="analytics-section">
      <h2>Usage & Revenue</h2>
      <div className="analytics-grid">
        <div className="analytics-card">
          <h3>Conversations</h3>
          <div className="analytics-stat-grid">
            <div className="analytics-stat"><span className="analytics-val">{fmt(metrics.conversations.total)}</span><span className="analytics-lbl">Total</span></div>
            <div className="analytics-stat"><span className="analytics-val positive">+{metrics.conversations.today}</span><span className="analytics-lbl">Today</span></div>
            <div className="analytics-stat"><span className="analytics-val">{metrics.conversations.avgMessagesPerConvo}</span><span className="analytics-lbl">Avg Msgs</span></div>
          </div>
        </div>
        <div className="analytics-card">
          <h3>Tokens</h3>
          <div className="analytics-stat-grid">
            <div className="analytics-stat"><span className="analytics-val">{fmt(metrics.tokens.totalUsed)}</span><span className="analytics-lbl">Used</span></div>
            <div className="analytics-stat"><span className="analytics-val highlight">{fmt(metrics.tokens.saved)}</span><span className="analytics-lbl">Saved</span></div>
            <div className="analytics-stat"><span className="analytics-val">{fmt(metrics.tokens.usedToday)}</span><span className="analytics-lbl">Today</span></div>
          </div>
        </div>
        <div className="analytics-card">
          <h3>Revenue</h3>
          <div className="analytics-stat-grid">
            <div className="analytics-stat"><span className="analytics-val">{fmtCurrency(metrics.revenue.mrrCents)}</span><span className="analytics-lbl">MRR</span></div>
            <div className="analytics-stat"><span className="analytics-val">{metrics.revenue.activeSubscriptions}</span><span className="analytics-lbl">Subs</span></div>
            <div className="analytics-stat"><span className="analytics-val">{fmtCurrency(metrics.revenue.bundleRevenueCents)}</span><span className="analytics-lbl">Bundles</span></div>
          </div>
        </div>
        <div className="analytics-card">
          <h3>BYOK</h3>
          <div className="analytics-stat-grid">
            <div className="analytics-stat"><span className="analytics-val">{metrics.byok.usersWithByok}</span><span className="analytics-lbl">Users</span></div>
            <div className="analytics-stat"><span className="analytics-val">{metrics.byok.totalKeys}</span><span className="analytics-lbl">Keys</span></div>
          </div>
          <div className="analytics-byok-breakdown">
            OpenAI: {metrics.byok.openaiKeys} | Anthropic: {metrics.byok.anthropicKeys} | Google: {metrics.byok.googleKeys}
          </div>
        </div>

        {/* Demo & Funnel */}
        <div className="analytics-card">
          <h3>Demo Sessions</h3>
          <div className="analytics-stat-grid">
            <div className="analytics-stat"><span className="analytics-val">{fmt(metrics.demo.totalSessions)}</span><span className="analytics-lbl">Total</span></div>
            <div className="analytics-stat"><span className="analytics-val positive">+{metrics.demo.sessionsToday}</span><span className="analytics-lbl">Today</span></div>
            <div className="analytics-stat"><span className="analytics-val highlight">{metrics.demo.conversions}</span><span className="analytics-lbl">Converted</span></div>
          </div>
          <div className="analytics-demo-rate">
            {metrics.demo.totalSessions > 0
              ? fmtPercent((metrics.demo.conversions / metrics.demo.totalSessions) * 100)
              : '0%'} conversion rate
          </div>
        </div>
        <div className="analytics-card">
          <h3>Demo LLM Budget</h3>
          <div className="analytics-budget-bars">
            <div className="analytics-budget-row">
              <span>Hourly</span>
              <div className="analytics-budget-track">
                <div className="analytics-budget-fill" style={{ width: `${(metrics.demo.llm.callsThisHour / metrics.demo.llm.maxPerHour) * 100}%` }} />
              </div>
              <span>{metrics.demo.llm.callsThisHour}/{metrics.demo.llm.maxPerHour}</span>
            </div>
            <div className="analytics-budget-row">
              <span>Daily</span>
              <div className="analytics-budget-track">
                <div className="analytics-budget-fill" style={{ width: `${(metrics.demo.llm.callsToday / metrics.demo.llm.maxPerDay) * 100}%` }} />
              </div>
              <span>{metrics.demo.llm.callsToday}/{metrics.demo.llm.maxPerDay}</span>
            </div>
          </div>
          {metrics.demo.llm.shardOnlyMode && <div className="analytics-shard-only">Shard-Only Mode Active</div>}
        </div>

        {/* Page Analytics */}
        <div className="analytics-card analytics-card--wide">
          <h3>Page Analytics</h3>
          <div className="analytics-link-grid">
            {Object.entries(metrics.linkClicks).map(([link, clicks]) => (
              <div key={link} className="analytics-link-item">
                <span className="analytics-link-name">{link.replace(/-/g, ' ')}</span>
                <span className="analytics-link-count">{fmt(clicks)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
