import { useConvergenceStore } from '../../stores/convergence';
import { timeAgo } from '../../hooks/useConvergenceApi';

export default function MetacognitionTab() {
  const { metaStatus, metaInsights, metaEvents, metaEventFilter, setMetaEventFilter } = useConvergenceStore();

  return (
    <>
      {/* Status */}
      <h3 className="convergence-section-title">System Status</h3>
      {metaStatus ? (
        <div className="convergence-meta-status">
          <div className="convergence-kpi-card">
            <div className="convergence-kpi-value">{metaStatus.events.total.toLocaleString()}</div>
            <div className="convergence-kpi-label">Total Events</div>
          </div>
          <div className="convergence-kpi-card">
            <div className="convergence-kpi-value">{metaStatus.events.last24h}</div>
            <div className="convergence-kpi-label">Last 24h</div>
          </div>
          <div className="convergence-kpi-card">
            <div className="convergence-kpi-value">{(metaStatus.events.avgConfidence * 100).toFixed(1)}%</div>
            <div className="convergence-kpi-label">Avg Confidence</div>
          </div>
          <div className="convergence-kpi-card">
            <div className="convergence-kpi-value">{metaStatus.metaShards.total}</div>
            <div className="convergence-kpi-label">Meta Shards</div>
          </div>
        </div>
      ) : (
        <p className="convergence-no-data">Loading status...</p>
      )}

      {/* Shard Breakdown */}
      {metaStatus && metaStatus.metaShards.total > 0 && (
        <div className="convergence-meta-breakdown">
          <div className="convergence-meta-shard-row">
            <span className="convergence-meta-shard-count">{metaStatus.metaShards.reflection}</span>
            <span className="convergence-meta-shard-type">Reflection</span>
          </div>
          <div className="convergence-meta-shard-row">
            <span className="convergence-meta-shard-count">{metaStatus.metaShards.strategy}</span>
            <span className="convergence-meta-shard-type">Strategy</span>
          </div>
          <div className="convergence-meta-shard-row">
            <span className="convergence-meta-shard-count">{metaStatus.metaShards.learning}</span>
            <span className="convergence-meta-shard-type">Learning</span>
          </div>
          <div className="convergence-meta-shard-row">
            <span className="convergence-meta-shard-count">{metaStatus.metaShards.correction}</span>
            <span className="convergence-meta-shard-type">Correction</span>
          </div>
        </div>
      )}

      {/* Insights */}
      {metaInsights && (
        <>
          <h3 className="convergence-section-title" style={{ marginTop: 32 }}>Insights</h3>

          <div className="convergence-meta-error-rate">
            <span>Error Rate (24h):</span>
            <strong>
              {metaInsights.insights.errorRate.total > 0
                ? `${(metaInsights.insights.errorRate.rate * 100).toFixed(1)}%`
                : 'No data'}
            </strong>
            <span className="convergence-meta-error-detail">
              ({metaInsights.insights.errorRate.errors}/{metaInsights.insights.errorRate.total} traces)
            </span>
          </div>

          {metaInsights.insights.trendingIntents.length > 0 && (
            <div className="convergence-meta-trending">
              <h4>Trending Intents</h4>
              <div className="convergence-meta-trending-list">
                {metaInsights.insights.trendingIntents.map((t) => (
                  <div key={t.intent} className="convergence-meta-trending-item">
                    <span className="convergence-meta-trending-name">{t.intent || 'uncategorized'}</span>
                    <span className="convergence-meta-trending-count">{t.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {metaInsights.insights.lowConfidenceShards.length > 0 && (
            <div className="convergence-meta-low-conf">
              <h4>Low Confidence Shards</h4>
              <table className="convergence-topshards-table">
                <thead>
                  <tr><th>Name</th><th>Confidence</th><th>Executions</th><th>Success Rate</th><th>Recommendation</th></tr>
                </thead>
                <tbody>
                  {metaInsights.insights.lowConfidenceShards.map((s) => (
                    <tr key={s.id}>
                      <td className="convergence-topshards-name">{s.name}</td>
                      <td className="convergence-low-conf-value">{Math.round(s.confidence * 100)}%</td>
                      <td>{s.executions}</td>
                      <td>{s.successRate != null ? `${Math.round(s.successRate * 100)}%` : '--'}</td>
                      <td className="convergence-recommendation">{s.recommendation}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Event Log */}
      <h3 className="convergence-section-title" style={{ marginTop: 32 }}>Event Log</h3>
      <div className="convergence-meta-filter">
        <select value={metaEventFilter} onChange={(e) => setMetaEventFilter(e.target.value)} className="convergence-meta-filter-select">
          <option value="">All types</option>
          <option value="reflection">Reflection</option>
          <option value="strategy">Strategy</option>
          <option value="learning_proposal">Learning</option>
          <option value="correction">Correction</option>
          <option value="crystallize">Crystallize</option>
          <option value="decay">Decay</option>
          <option value="promote">Promote</option>
        </select>
      </div>
      {metaEvents.length === 0 ? (
        <p className="convergence-no-data">No events found.</p>
      ) : (
        <div className="convergence-event-log-scroll">
          <table className="convergence-topshards-table">
            <thead>
              <tr><th>Time</th><th>Type</th><th>Confidence</th><th>Action</th><th>Outcome</th><th>Success</th></tr>
            </thead>
            <tbody>
              {metaEvents.map((evt) => (
                <tr key={evt.id}>
                  <td>{timeAgo(evt.createdAt)}</td>
                  <td><span className="convergence-topshards-category">{evt.type}</span></td>
                  <td>{evt.confidence != null ? `${Math.round(evt.confidence * 100)}%` : '--'}</td>
                  <td>{evt.action || '--'}</td>
                  <td className="convergence-history-summary">{evt.outcome || '--'}</td>
                  <td>
                    <span className={`convergence-status-chip ${evt.success ? 'status-success' : evt.success === false ? 'status-failure' : 'status-unknown'}`}>
                      {evt.success ? 'OK' : evt.success === false ? 'FAIL' : '--'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
