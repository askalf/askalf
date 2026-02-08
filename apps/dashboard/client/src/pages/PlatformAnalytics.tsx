import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AdminAssistantPanel from '../components/admin/AdminAssistantPanel';
import './PlatformAnalytics.css';

// ============================================
// TYPES
// ============================================

interface PlatformMetrics {
  users: {
    total: number;
    byTier: Record<string, number>;
    growth: { today: number; thisWeek: number; thisMonth: number };
    active: { last24h: number; last7d: number; last30d: number };
  };
  waitlist: { total: number; today: number; converted: number; conversionRate: number };
  conversations: {
    total: number; today: number; totalMessages: number;
    messagesToday: number; avgMessagesPerConvo: number;
  };
  shards: {
    total: number; public: number; private: number; createdToday: number;
    executions: { total: number; today: number };
    hitRate: number;
  };
  tokens: {
    totalUsed: number; usedToday: number; saved: number;
    byokUsage: number; bundleUsage: number;
    usageByTier: Array<{ tier: string; totalUsed: number; userCount: number }>;
  };
  byok: {
    totalKeys: number; openaiKeys: number; anthropicKeys: number;
    googleKeys: number; xaiKeys: number; ollamaKeys: number; usersWithByok: number;
  };
  revenue: {
    bundlesSold: number; bundlesToday: number; bundleRevenueCents: number;
    activeBundleUsers: number; totalSubscriptions: number;
    activeSubscriptions: number; mrrCents: number;
  };
  environmental: {
    tokensSaved: number; waterMlSaved: number;
    powerWhSaved: number; carbonGSaved: number;
  };
  demo: {
    totalSessions: number; sessionsToday: number; activeSessions: number;
    conversions: number;
    llm: { callsThisHour: number; callsToday: number; maxPerHour: number; maxPerDay: number; shardOnlyMode: boolean };
  };
  systemHealth: {
    apiLatencyP50Ms: number; apiLatencyP95Ms: number; apiLatencyP99Ms: number;
    errorRate: number; uptime: number;
  };
  linkClicks: Record<string, number>;
  timestamp: string;
}

interface MemoryStats {
  procedural: {
    shards: { total: number; promoted: number; shadow: number; candidate: number; testing: number; archived: number; public: number; private: number };
    traces: { total: number; synthesized: number };
    executions: { total: number; successful: number; successRate: number };
  };
  episodic: { total: number; positive: number; negative: number };
  semantic: { facts: number; highConfidence: number; avgConfidence: number; categories: number };
  working: { total: number; raw: number; liquidated: number; promoted: number; avgCompression: number };
}

interface WaitlistEntry {
  id: number; email: string; source: string | null;
  created_at: string; welcome_email_sent_at: string | null;
}

type ViewMode = 'admin' | 'investor';

const API_BASE = window.location.hostname.includes('askalf.org')
  ? 'https://api.askalf.org'
  : 'http://localhost:3000';

// ============================================
// HELPERS
// ============================================

const fmt = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
};

const fmtCurrency = (cents: number) =>
  `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

const fmtCurrencyFull = (cents: number) =>
  `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtPercent = (n: number) => `${n.toFixed(1)}%`;

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

// ============================================
// COMPONENT
// ============================================

export default function PlatformAnalytics() {
  const navigate = useNavigate();
  const [metrics, setMetrics] = useState<PlatformMetrics | null>(null);
  const [memoryStats, setMemoryStats] = useState<MemoryStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('admin');
  const [assistantOpen, setAssistantOpen] = useState(false);

  // Admin-only state
  const [waitlistOpen, setWaitlistOpen] = useState(false);
  const [waitlistEntries, setWaitlistEntries] = useState<WaitlistEntry[]>([]);
  const [waitlistLoading, setWaitlistLoading] = useState(false);
  const [waitlistAction, setWaitlistAction] = useState<string | null>(null);
  const [waitlistFilter, setWaitlistFilter] = useState('');

  const fetchMetrics = async () => {
    try {
      const [metricsRes, memoryRes] = await Promise.all([
        fetch(`${API_BASE}/api/v1/admin/metrics`, { credentials: 'include' }),
        fetch(`${API_BASE}/api/v1/stats`, { credentials: 'include' }),
      ]);

      if (metricsRes.status === 401) {
        setError('Authentication required. Please log in.');
        return;
      }
      if (!metricsRes.ok) throw new Error('Failed to fetch metrics');

      const metricsData = await metricsRes.json();
      setMetrics(metricsData);

      if (memoryRes.ok) {
        const memData = await memoryRes.json();
        setMemoryStats(memData);
      }

      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load metrics');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMetrics();
    if (autoRefresh) {
      const interval = setInterval(fetchMetrics, 15000);
      return () => clearInterval(interval);
    }
  }, [autoRefresh]);

  const fetchWaitlist = async () => {
    setWaitlistLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/admin/waitlist`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setWaitlistEntries(data.entries || []);
      }
    } catch { /* silent */ }
    finally { setWaitlistLoading(false); }
  };

  const sendWaitlistAction = async (entryId: number, action: 'welcome' | 'beta-invite') => {
    setWaitlistAction(`${action}-${entryId}`);
    try {
      const endpoint = `${API_BASE}/api/v1/admin/waitlist/${entryId}/send-${action}`;
      const res = await fetch(endpoint, { method: 'POST', credentials: 'include' });
      if (res.ok && action === 'welcome') fetchWaitlist();
    } catch { /* silent */ }
    finally { setWaitlistAction(null); }
  };

  if (loading) {
    return (
      <div className="analytics-page">
        <div className="analytics-loading">
          <div className="loading-spinner" />
          <p>Loading analytics...</p>
        </div>
      </div>
    );
  }

  if (error || !metrics) {
    return (
      <div className="analytics-page">
        <div className="analytics-error">
          <p>{error || 'No data available'}</p>
          <button onClick={fetchMetrics}>Retry</button>
        </div>
      </div>
    );
  }

  // ============================================
  // COMPUTED VALUES
  // ============================================

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
    ? (metrics.tokens.saved * 0.003 / 1000) / metrics.users.total // rough estimate at $0.003/1k tokens
    : 0;

  // ============================================
  // INVESTOR VIEW
  // ============================================

  const renderInvestorView = () => (
    <div className="investor-view">
      {/* Hero KPIs */}
      <div className="investor-hero">
        <div className="hero-kpi primary">
          <div className="hero-value">{fmtCurrency(metrics.revenue.mrrCents)}</div>
          <div className="hero-label">Monthly Recurring Revenue</div>
          <div className="hero-sub">{fmtCurrency(arr)} ARR</div>
        </div>
        <div className="hero-kpi">
          <div className="hero-value">{fmt(metrics.users.total)}</div>
          <div className="hero-label">Total Users</div>
          <div className="hero-sub positive">+{fmtPercent(weeklyGrowthRate)} WoW</div>
        </div>
        <div className="hero-kpi">
          <div className="hero-value">{fmtPercent(dauMau)}</div>
          <div className="hero-label">DAU/MAU Ratio</div>
          <div className="hero-sub">{fmt(dau)} / {fmt(mau)}</div>
        </div>
        <div className="hero-kpi">
          <div className="hero-value">{fmtPercent(conversionRate)}</div>
          <div className="hero-label">Paid Conversion</div>
          <div className="hero-sub">{fmt(paidUsers)} paid users</div>
        </div>
      </div>

      {/* Growth Section */}
      <div className="investor-section">
        <h2>Growth Metrics</h2>
        <div className="investor-grid">
          <div className="investor-card">
            <div className="card-title">User Growth</div>
            <div className="growth-metrics">
              <div className="growth-item">
                <span className="growth-period">Today</span>
                <span className="growth-value positive">+{metrics.users.growth.today}</span>
              </div>
              <div className="growth-item">
                <span className="growth-period">This Week</span>
                <span className="growth-value positive">+{metrics.users.growth.thisWeek}</span>
              </div>
              <div className="growth-item">
                <span className="growth-period">This Month</span>
                <span className="growth-value positive">+{metrics.users.growth.thisMonth}</span>
              </div>
            </div>
          </div>

          <div className="investor-card">
            <div className="card-title">Engagement</div>
            <div className="metric-row">
              <span>Conversations Today</span>
              <span className="metric-val">{fmt(metrics.conversations.today)}</span>
            </div>
            <div className="metric-row">
              <span>Messages Today</span>
              <span className="metric-val">{fmt(metrics.conversations.messagesToday)}</span>
            </div>
            <div className="metric-row">
              <span>Avg Messages/Conversation</span>
              <span className="metric-val">{metrics.conversations.avgMessagesPerConvo}</span>
            </div>
          </div>

          <div className="investor-card">
            <div className="card-title">Waitlist Pipeline</div>
            <div className="metric-row">
              <span>Total Waitlist</span>
              <span className="metric-val">{fmt(metrics.waitlist.total)}</span>
            </div>
            <div className="metric-row">
              <span>Converted</span>
              <span className="metric-val">{fmt(metrics.waitlist.converted)}</span>
            </div>
            <div className="metric-row">
              <span>Conversion Rate</span>
              <span className="metric-val highlight">{fmtPercent(metrics.waitlist.conversionRate)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Revenue Section */}
      <div className="investor-section">
        <h2>Revenue & Unit Economics</h2>
        <div className="investor-grid">
          <div className="investor-card wide">
            <div className="card-title">Revenue Breakdown</div>
            <div className="revenue-breakdown">
              <div className="revenue-item">
                <div className="revenue-source">Subscriptions</div>
                <div className="revenue-amount">{fmtCurrencyFull(metrics.revenue.mrrCents)}/mo</div>
                <div className="revenue-detail">{metrics.revenue.activeSubscriptions} active</div>
              </div>
              <div className="revenue-item">
                <div className="revenue-source">Token Bundles</div>
                <div className="revenue-amount">{fmtCurrencyFull(metrics.revenue.bundleRevenueCents)}</div>
                <div className="revenue-detail">{metrics.revenue.bundlesSold} sold</div>
              </div>
            </div>
          </div>

          <div className="investor-card">
            <div className="card-title">Unit Economics</div>
            <div className="metric-row">
              <span>ARPU (Monthly)</span>
              <span className="metric-val">{fmtCurrencyFull(arpu)}</span>
            </div>
            <div className="metric-row">
              <span>Cost Saved/User</span>
              <span className="metric-val highlight">{fmtCurrencyFull(costSavingsPerUser * 100)}</span>
            </div>
          </div>

          <div className="investor-card">
            <div className="card-title">Plan Distribution</div>
            <div className="plan-bars">
              {Object.entries(metrics.users.byTier)
                .filter(([, count]) => count > 0)
                .sort((a, b) => b[1] - a[1])
                .map(([tier, count]) => {
                  const pct = (count / metrics.users.total) * 100;
                  return (
                    <div key={tier} className="plan-bar-row">
                      <span className="plan-name">{tier}</span>
                      <div className="plan-bar-track">
                        <div className={`plan-bar-fill tier-${tier}`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="plan-count">{count}</span>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      </div>

      {/* Technology Moat */}
      <div className="investor-section">
        <h2>Technology Advantage</h2>
        <div className="investor-grid">
          <div className="investor-card">
            <div className="card-title">AI Convergence</div>
            <div className="convergence-display">
              <div className="convergence-ring">
                <svg viewBox="0 0 100 100">
                  <circle cx="50" cy="50" r="45" fill="none" stroke="var(--border)" strokeWidth="8" />
                  <circle
                    cx="50" cy="50" r="45" fill="none" stroke="#10b981" strokeWidth="8"
                    strokeDasharray={`${metrics.shards.hitRate * 2.83} 283`}
                    transform="rotate(-90 50 50)"
                  />
                </svg>
                <div className="convergence-value">{metrics.shards.hitRate}%</div>
              </div>
              <div className="convergence-label">Shard Hit Rate</div>
              <p className="convergence-explain">
                {metrics.shards.hitRate}% of queries answered from learned knowledge — no external AI cost
              </p>
            </div>
          </div>

          <div className="investor-card">
            <div className="card-title">Efficiency Metrics</div>
            <div className="metric-row">
              <span>Total Shards Learned</span>
              <span className="metric-val">{fmt(metrics.shards.total)}</span>
            </div>
            <div className="metric-row">
              <span>Tokens Saved</span>
              <span className="metric-val highlight">{fmt(metrics.tokens.saved)}</span>
            </div>
            <div className="metric-row">
              <span>Est. Cost Savings</span>
              <span className="metric-val highlight">{fmtCurrencyFull((metrics.tokens.saved * 0.003 / 1000) * 100)}</span>
            </div>
          </div>

          <div className="investor-card">
            <div className="card-title">Environmental Impact</div>
            <div className="env-metrics">
              <div className="env-item">
                <span className="env-icon">💧</span>
                <span className="env-val">{(metrics.environmental.waterMlSaved / 1000).toFixed(1)}L</span>
                <span className="env-lbl">Water Saved</span>
              </div>
              <div className="env-item">
                <span className="env-icon">⚡</span>
                <span className="env-val">{metrics.environmental.powerWhSaved.toFixed(0)}Wh</span>
                <span className="env-lbl">Power Saved</span>
              </div>
              <div className="env-item">
                <span className="env-icon">🌱</span>
                <span className="env-val">{metrics.environmental.carbonGSaved.toFixed(0)}g</span>
                <span className="env-lbl">CO₂ Avoided</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* System Reliability */}
      <div className="investor-section">
        <h2>Platform Reliability</h2>
        <div className="reliability-strip">
          <div className="reliability-item">
            <div className={`reliability-value ${metrics.systemHealth.uptime >= 99.9 ? 'excellent' : 'good'}`}>
              {fmtPercent(metrics.systemHealth.uptime)}
            </div>
            <div className="reliability-label">Uptime</div>
          </div>
          <div className="reliability-item">
            <div className={`reliability-value ${metrics.systemHealth.errorRate < 0.5 ? 'excellent' : 'good'}`}>
              {fmtPercent(metrics.systemHealth.errorRate)}
            </div>
            <div className="reliability-label">Error Rate</div>
          </div>
          <div className="reliability-item">
            <div className="reliability-value">{metrics.systemHealth.apiLatencyP50Ms}ms</div>
            <div className="reliability-label">P50 Latency</div>
          </div>
          <div className="reliability-item">
            <div className="reliability-value">{metrics.systemHealth.apiLatencyP95Ms}ms</div>
            <div className="reliability-label">P95 Latency</div>
          </div>
        </div>
      </div>
    </div>
  );

  // ============================================
  // ADMIN VIEW
  // ============================================

  const renderAdminView = () => (
    <div className="admin-view">
      {/* KPI Strip */}
      <div className="kpi-strip">
        <div className="kpi-card">
          <span className="kpi-dot users" />
          <div className="kpi-body">
            <div className="kpi-value">{fmt(metrics.users.total)}</div>
            <div className="kpi-label">Users</div>
            <div className="kpi-delta positive">+{metrics.users.growth.today}</div>
          </div>
        </div>
        <div className="kpi-card">
          <span className="kpi-dot revenue" />
          <div className="kpi-body">
            <div className="kpi-value">{fmtCurrency(metrics.revenue.mrrCents)}</div>
            <div className="kpi-label">MRR</div>
            <div className="kpi-delta">{metrics.revenue.activeSubscriptions} subs</div>
          </div>
        </div>
        <div className="kpi-card">
          <span className="kpi-dot shards" />
          <div className="kpi-body">
            <div className="kpi-value">{metrics.shards.hitRate}%</div>
            <div className="kpi-label">Hit Rate</div>
            <div className="kpi-delta">{fmt(metrics.shards.executions.today)} exec</div>
          </div>
        </div>
        <div className="kpi-card">
          <span className="kpi-dot messages" />
          <div className="kpi-body">
            <div className="kpi-value">{fmt(metrics.conversations.messagesToday)}</div>
            <div className="kpi-label">Msgs Today</div>
            <div className="kpi-delta">{metrics.conversations.today} convos</div>
          </div>
        </div>
        <div className="kpi-card">
          <span className="kpi-dot active" />
          <div className="kpi-body">
            <div className="kpi-value">{fmt(dau)}</div>
            <div className="kpi-label">DAU</div>
            <div className="kpi-delta">{fmtPercent(dauMau)} of MAU</div>
          </div>
        </div>
      </div>

      {/* Users Section */}
      <div className="admin-section">
        <h2>Users</h2>
        <div className="admin-grid">
          <div className="admin-card">
            <h3>Growth</h3>
            <div className="stat-grid">
              <div className="stat"><span className="val positive">+{metrics.users.growth.today}</span><span className="lbl">Today</span></div>
              <div className="stat"><span className="val positive">+{metrics.users.growth.thisWeek}</span><span className="lbl">Week</span></div>
              <div className="stat"><span className="val positive">+{metrics.users.growth.thisMonth}</span><span className="lbl">Month</span></div>
            </div>
          </div>
          <div className="admin-card">
            <h3>Active</h3>
            <div className="stat-grid">
              <div className="stat"><span className="val">{fmt(metrics.users.active.last24h)}</span><span className="lbl">24h</span></div>
              <div className="stat"><span className="val">{fmt(metrics.users.active.last7d)}</span><span className="lbl">7d</span></div>
              <div className="stat"><span className="val">{fmt(metrics.users.active.last30d)}</span><span className="lbl">30d</span></div>
            </div>
          </div>
          <div className="admin-card wide">
            <h3>Tier Distribution</h3>
            <div className="tier-bars">
              {Object.entries(metrics.users.byTier).map(([tier, count]) => {
                const pct = (count / Math.max(metrics.users.total, 1)) * 100;
                return (
                  <div key={tier} className="tier-row">
                    <span className="tier-name">{tier}</span>
                    <div className="tier-bar-wrap"><div className={`tier-bar tier-${tier}`} style={{ width: `${pct}%` }} /></div>
                    <span className="tier-count">{count}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Waitlist Section */}
      <div className="admin-section">
        <h2 className="clickable" onClick={() => { setWaitlistOpen(!waitlistOpen); if (!waitlistOpen && waitlistEntries.length === 0) fetchWaitlist(); }}>
          Waitlist
          <span className="expand-icon">{waitlistOpen ? '−' : '+'}</span>
        </h2>
        <div className="admin-grid">
          <div className="admin-card">
            <div className="stat-grid">
              <div className="stat"><span className="val">{fmt(metrics.waitlist.total)}</span><span className="lbl">Total</span></div>
              <div className="stat"><span className="val positive">+{metrics.waitlist.today}</span><span className="lbl">Today</span></div>
              <div className="stat"><span className="val highlight">{fmtPercent(metrics.waitlist.conversionRate)}</span><span className="lbl">Conv Rate</span></div>
            </div>
          </div>
        </div>
        {waitlistOpen && (
          <div className="waitlist-panel">
            <div className="waitlist-toolbar">
              <input type="text" placeholder="Filter..." value={waitlistFilter} onChange={e => setWaitlistFilter(e.target.value)} />
              <button onClick={fetchWaitlist} disabled={waitlistLoading}>{waitlistLoading ? '...' : 'Refresh'}</button>
            </div>
            <table className="waitlist-table">
              <thead><tr><th>Email</th><th>Source</th><th>Date</th><th>Actions</th></tr></thead>
              <tbody>
                {waitlistEntries
                  .filter(e => !waitlistFilter || e.email.toLowerCase().includes(waitlistFilter.toLowerCase()))
                  .map(entry => (
                    <tr key={entry.id}>
                      <td>{entry.email}</td>
                      <td>{entry.source || '-'}</td>
                      <td>{new Date(entry.created_at).toLocaleDateString()}</td>
                      <td>
                        <button onClick={() => sendWaitlistAction(entry.id, 'welcome')} disabled={!!waitlistAction}>
                          {waitlistAction === `welcome-${entry.id}` ? '...' : 'Welcome'}
                        </button>
                        <button onClick={() => sendWaitlistAction(entry.id, 'beta-invite')} disabled={!!waitlistAction}>
                          {waitlistAction === `beta-invite-${entry.id}` ? '...' : 'Invite'}
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Usage Section */}
      <div className="admin-section">
        <h2>Usage & Revenue</h2>
        <div className="admin-grid">
          <div className="admin-card">
            <h3>Conversations</h3>
            <div className="stat-grid">
              <div className="stat"><span className="val">{fmt(metrics.conversations.total)}</span><span className="lbl">Total</span></div>
              <div className="stat"><span className="val positive">+{metrics.conversations.today}</span><span className="lbl">Today</span></div>
              <div className="stat"><span className="val">{metrics.conversations.avgMessagesPerConvo}</span><span className="lbl">Avg Msgs</span></div>
            </div>
          </div>
          <div className="admin-card">
            <h3>Tokens</h3>
            <div className="stat-grid">
              <div className="stat"><span className="val">{fmt(metrics.tokens.totalUsed)}</span><span className="lbl">Used</span></div>
              <div className="stat"><span className="val highlight">{fmt(metrics.tokens.saved)}</span><span className="lbl">Saved</span></div>
              <div className="stat"><span className="val">{fmt(metrics.tokens.usedToday)}</span><span className="lbl">Today</span></div>
            </div>
          </div>
          <div className="admin-card">
            <h3>Revenue</h3>
            <div className="stat-grid">
              <div className="stat"><span className="val">{fmtCurrency(metrics.revenue.mrrCents)}</span><span className="lbl">MRR</span></div>
              <div className="stat"><span className="val">{metrics.revenue.activeSubscriptions}</span><span className="lbl">Subs</span></div>
              <div className="stat"><span className="val">{fmtCurrency(metrics.revenue.bundleRevenueCents)}</span><span className="lbl">Bundles</span></div>
            </div>
          </div>
          <div className="admin-card">
            <h3>BYOK</h3>
            <div className="stat-grid">
              <div className="stat"><span className="val">{metrics.byok.usersWithByok}</span><span className="lbl">Users</span></div>
              <div className="stat"><span className="val">{metrics.byok.totalKeys}</span><span className="lbl">Keys</span></div>
            </div>
            <div className="byok-breakdown">
              OpenAI: {metrics.byok.openaiKeys} | Anthropic: {metrics.byok.anthropicKeys} | Google: {metrics.byok.googleKeys}
            </div>
          </div>
        </div>
      </div>

      {/* Memory Section */}
      <div className="admin-section">
        <h2>Memory System</h2>
        <div className="memory-grid">
          <div className="memory-card procedural">
            <div className="memory-header"><span className="dot" />Procedural</div>
            <div className="memory-val">{memoryStats ? fmt(memoryStats.procedural.shards.total) : fmt(metrics.shards.total)}</div>
            <div className="memory-detail">
              {memoryStats && `${memoryStats.procedural.shards.promoted} promoted • ${memoryStats.procedural.shards.shadow} shadow`}
            </div>
          </div>
          <div className="memory-card episodic">
            <div className="memory-header"><span className="dot" />Episodic</div>
            <div className="memory-val">{memoryStats ? fmt(memoryStats.episodic.total) : '-'}</div>
            <div className="memory-detail">
              {memoryStats && `${memoryStats.episodic.positive} positive • ${memoryStats.episodic.negative} negative`}
            </div>
          </div>
          <div className="memory-card semantic">
            <div className="memory-header"><span className="dot" />Semantic</div>
            <div className="memory-val">{memoryStats ? fmt(memoryStats.semantic.facts) : '-'}</div>
            <div className="memory-detail">
              {memoryStats && `${memoryStats.semantic.categories} categories • ${fmtPercent(memoryStats.semantic.avgConfidence * 100)} conf`}
            </div>
          </div>
          <div className="memory-card working">
            <div className="memory-header"><span className="dot" />Working</div>
            <div className="memory-val">{memoryStats ? fmt(memoryStats.working.total) : '-'}</div>
            <div className="memory-detail">
              {memoryStats && `${fmtPercent(memoryStats.working.avgCompression * 100)} compression`}
            </div>
          </div>
        </div>
      </div>

      {/* Demo & Funnel */}
      <div className="admin-section">
        <h2>Demo & Funnel</h2>
        <div className="admin-grid">
          <div className="admin-card">
            <h3>Demo Sessions</h3>
            <div className="stat-grid">
              <div className="stat"><span className="val">{fmt(metrics.demo.totalSessions)}</span><span className="lbl">Total</span></div>
              <div className="stat"><span className="val positive">+{metrics.demo.sessionsToday}</span><span className="lbl">Today</span></div>
              <div className="stat"><span className="val">{metrics.demo.activeSessions}</span><span className="lbl">Active</span></div>
              <div className="stat"><span className="val highlight">{metrics.demo.conversions}</span><span className="lbl">Converted</span></div>
            </div>
            <div className="demo-conversion-rate">
              {metrics.demo.totalSessions > 0
                ? fmtPercent((metrics.demo.conversions / metrics.demo.totalSessions) * 100)
                : '0%'} conversion rate
            </div>
          </div>
          <div className="admin-card">
            <h3>Demo LLM Budget</h3>
            <div className="budget-bars">
              <div className="budget-row">
                <span>Hourly</span>
                <div className="budget-track"><div className="budget-fill" style={{ width: `${(metrics.demo.llm.callsThisHour / metrics.demo.llm.maxPerHour) * 100}%` }} /></div>
                <span>{metrics.demo.llm.callsThisHour}/{metrics.demo.llm.maxPerHour}</span>
              </div>
              <div className="budget-row">
                <span>Daily</span>
                <div className="budget-track"><div className="budget-fill" style={{ width: `${(metrics.demo.llm.callsToday / metrics.demo.llm.maxPerDay) * 100}%` }} /></div>
                <span>{metrics.demo.llm.callsToday}/{metrics.demo.llm.maxPerDay}</span>
              </div>
            </div>
            {metrics.demo.llm.shardOnlyMode && <div className="shard-only-badge">Shard-Only Mode Active</div>}
          </div>
          <div className="admin-card wide">
            <h3>Page Analytics</h3>
            <div className="link-clicks-grid">
              {Object.entries(metrics.linkClicks).map(([link, clicks]) => (
                <div key={link} className="link-click-item">
                  <span className="link-name">{link.replace(/-/g, ' ')}</span>
                  <span className="link-count">{fmt(clicks)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* System Health */}
      <div className="admin-section">
        <h2>System Health</h2>
        <div className="admin-grid">
          <div className="admin-card">
            <h3>Performance</h3>
            <div className="stat-grid">
              <div className="stat"><span className={`val ${metrics.systemHealth.uptime >= 99.9 ? 'excellent' : ''}`}>{fmtPercent(metrics.systemHealth.uptime)}</span><span className="lbl">Uptime</span></div>
              <div className="stat"><span className={`val ${metrics.systemHealth.errorRate < 0.5 ? 'excellent' : ''}`}>{fmtPercent(metrics.systemHealth.errorRate)}</span><span className="lbl">Errors</span></div>
            </div>
          </div>
          <div className="admin-card">
            <h3>Latency</h3>
            <div className="stat-grid">
              <div className="stat"><span className="val">{metrics.systemHealth.apiLatencyP50Ms}ms</span><span className="lbl">P50</span></div>
              <div className="stat"><span className="val">{metrics.systemHealth.apiLatencyP95Ms}ms</span><span className="lbl">P95</span></div>
              <div className="stat"><span className="val">{metrics.systemHealth.apiLatencyP99Ms}ms</span><span className="lbl">P99</span></div>
            </div>
          </div>
        </div>
      </div>

      {/* Environmental */}
      <div className="admin-section">
        <h2>Environmental Impact</h2>
        <div className="env-strip">
          <div className="env-card"><div className="env-val">{fmt(metrics.environmental.tokensSaved)}</div><div className="env-lbl">Tokens Saved</div></div>
          <div className="env-card"><div className="env-val">{(metrics.environmental.waterMlSaved / 1000).toFixed(1)}L</div><div className="env-lbl">Water</div></div>
          <div className="env-card"><div className="env-val">{metrics.environmental.powerWhSaved.toFixed(0)}Wh</div><div className="env-lbl">Power</div></div>
          <div className="env-card"><div className="env-val">{metrics.environmental.carbonGSaved.toFixed(0)}g</div><div className="env-lbl">CO₂</div></div>
        </div>
      </div>
    </div>
  );

  // ============================================
  // MAIN RENDER
  // ============================================

  return (
    <div className={`analytics-page ${assistantOpen ? 'panel-open' : ''}`}>
      <div className="analytics-main">
        {/* Header */}
        <header className="analytics-header">
          <div className="header-left">
            <button className="back-btn" onClick={() => navigate('/app/chat')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
            </button>
            <div className="header-title">
              <h1>{viewMode === 'investor' ? 'Investor Dashboard' : 'Platform Analytics'}</h1>
              <span className="last-updated">Updated {fmtTime(metrics.timestamp)}</span>
            </div>
          </div>
          <div className="header-right">
            {/* View Mode Toggle */}
            <div className="view-toggle">
              <button
                className={viewMode === 'admin' ? 'active' : ''}
                onClick={() => setViewMode('admin')}
              >
                Admin
              </button>
              <button
                className={viewMode === 'investor' ? 'active' : ''}
                onClick={() => setViewMode('investor')}
              >
                Investor
              </button>
            </div>
            <label className="refresh-toggle">
              <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} />
              <span>Live</span>
            </label>
            <button className="refresh-btn" onClick={fetchMetrics}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M23 4v6h-6M1 20v-6h6" />
                <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
              </svg>
            </button>
            {viewMode === 'admin' && (
              <button className={`assistant-btn ${assistantOpen ? 'active' : ''}`} onClick={() => setAssistantOpen(!assistantOpen)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2a3 3 0 0 0-3 3v1a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                  <path d="M19 10H5a2 2 0 0 0-2 2v1a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-1a2 2 0 0 0-2-2Z" />
                  <path d="M12 15v4M8 19h8" />
                </svg>
              </button>
            )}
          </div>
        </header>

        {/* Alert */}
        {metrics.demo.llm.shardOnlyMode && viewMode === 'admin' && (
          <div className="alert-banner">
            <strong>Demo Shard-Only Mode Active</strong> — LLM budget exhausted
          </div>
        )}

        {/* Content */}
        <div className="analytics-content">
          {viewMode === 'investor' ? renderInvestorView() : renderAdminView()}
        </div>
      </div>

      {viewMode === 'admin' && (
        <AdminAssistantPanel
          isOpen={assistantOpen}
          onToggle={() => setAssistantOpen(!assistantOpen)}
          activeTier="procedural"
          pageContext="analytics"
        />
      )}
    </div>
  );
}
