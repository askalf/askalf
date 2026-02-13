import { useAnalyticsStore } from '../../stores/analytics';
import { fmt, fmtPercent } from '../../hooks/useAnalyticsApi';

export default function WaitlistSection() {
  const metrics = useAnalyticsStore((s) => s.metrics);
  const waitlistOpen = useAnalyticsStore((s) => s.waitlistOpen);
  const setWaitlistOpen = useAnalyticsStore((s) => s.setWaitlistOpen);
  const waitlistEntries = useAnalyticsStore((s) => s.waitlistEntries);
  const waitlistFilter = useAnalyticsStore((s) => s.waitlistFilter);
  const setWaitlistFilter = useAnalyticsStore((s) => s.setWaitlistFilter);
  const fetchWaitlist = useAnalyticsStore((s) => s.fetchWaitlist);
  const sendWaitlistAction = useAnalyticsStore((s) => s.sendWaitlistAction);
  const loading = useAnalyticsStore((s) => s.loading);

  if (!metrics) return null;

  const filtered = waitlistEntries.filter(
    (e) => !waitlistFilter || e.email.toLowerCase().includes(waitlistFilter.toLowerCase())
  );

  return (
    <div className="analytics-section">
      <h2
        className="analytics-section-toggle"
        onClick={() => setWaitlistOpen(!waitlistOpen)}
      >
        Waitlist
        <span className="analytics-expand-icon">{waitlistOpen ? '−' : '+'}</span>
      </h2>
      <div className="analytics-grid">
        <div className="analytics-card">
          <div className="analytics-stat-grid">
            <div className="analytics-stat"><span className="analytics-val">{fmt(metrics.waitlist.total)}</span><span className="analytics-lbl">Total</span></div>
            <div className="analytics-stat"><span className="analytics-val positive">+{metrics.waitlist.today}</span><span className="analytics-lbl">Today</span></div>
            <div className="analytics-stat"><span className="analytics-val highlight">{fmtPercent(metrics.waitlist.conversionRate)}</span><span className="analytics-lbl">Conv Rate</span></div>
          </div>
        </div>
      </div>

      {waitlistOpen && (
        <div className="analytics-waitlist-panel">
          <div className="analytics-waitlist-toolbar">
            <input
              type="text"
              placeholder="Filter by email..."
              value={waitlistFilter}
              onChange={(e) => setWaitlistFilter(e.target.value)}
            />
            <button className="hub-btn" onClick={fetchWaitlist} disabled={loading.waitlist}>
              {loading.waitlist ? '...' : 'Refresh'}
            </button>
          </div>
          <table className="analytics-waitlist-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Source</th>
                <th>Date</th>
                <th>Welcome</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((entry) => (
                <tr key={entry.id}>
                  <td>{entry.email}</td>
                  <td className="analytics-muted">{entry.source || '-'}</td>
                  <td className="analytics-muted">{new Date(entry.created_at).toLocaleDateString()}</td>
                  <td>
                    {entry.welcome_email_sent_at ? (
                      <span className="analytics-sent-badge">Sent</span>
                    ) : (
                      <span className="analytics-unsent-badge">Pending</span>
                    )}
                  </td>
                  <td>
                    <div className="analytics-waitlist-actions">
                      <button
                        className="hub-btn hub-btn--sm"
                        onClick={() => sendWaitlistAction(entry.id, 'welcome')}
                        disabled={!!loading[`waitlist-welcome-${entry.id}`]}
                      >
                        {loading[`waitlist-welcome-${entry.id}`] ? '...' : 'Welcome'}
                      </button>
                      <button
                        className="hub-btn hub-btn--sm hub-btn--primary"
                        onClick={() => sendWaitlistAction(entry.id, 'beta-invite')}
                        disabled={!!loading[`waitlist-beta-invite-${entry.id}`]}
                      >
                        {loading[`waitlist-beta-invite-${entry.id}`] ? '...' : 'Invite'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={5} className="analytics-empty">No entries found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
