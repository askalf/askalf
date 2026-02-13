import { useConvergenceStore } from '../../stores/convergence';
import {
  CATEGORIES_PER_PAGE, LIFECYCLE_STAGES,
  VERIFICATION_CHIP_CLASS, FEEDBACK_FILL_CLASS,
} from '../../hooks/useConvergenceApi';
import AnimatedNumber from './AnimatedNumber';
import CardIcon from './CardIcon';

export default function InternalsTab() {
  const { data, internalsCategoryPage, setInternalsCategoryPage } = useConvergenceStore();
  if (!data) return null;

  const hasData = data.daily.length > 0;
  if (!hasData) return <p className="convergence-no-data">No data available yet.</p>;

  const totalIntCatPages = data.categories ? Math.ceil(data.categories.length / CATEGORIES_PER_PAGE) : 0;
  const pagedIntCategories = data.categories?.slice(
    (internalsCategoryPage - 1) * CATEGORIES_PER_PAGE,
    internalsCategoryPage * CATEGORIES_PER_PAGE
  ) || [];

  return (
    <>
      {/* Charts */}
      <div className="convergence-charts">
        <div className="convergence-chart-card">
          <h3 className="convergence-chart-title">Cost Per Query</h3>
          <div className="convergence-bar-chart">
            {data.daily.map((day) => {
              const maxCost = Math.max(...data.daily.map(d => d.estimatedCostPerQuery));
              const height = maxCost > 0 ? (day.estimatedCostPerQuery / maxCost) * 100 : 0;
              return (
                <div key={day.date} className="convergence-bar">
                  <div className="convergence-bar-tooltip">
                    {new Date(day.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}: ${day.estimatedCostPerQuery.toFixed(5)}
                  </div>
                  <div className="convergence-bar-fill cost" style={{ height: `${Math.max(2, height)}%` }} />
                  <span className="convergence-bar-label">{new Date(day.date).getDate()}</span>
                </div>
              );
            })}
          </div>
        </div>
        <div className="convergence-chart-card">
          <h3 className="convergence-chart-title">Shard Hit Rate %</h3>
          <div className="convergence-bar-chart">
            {data.daily.map((day) => {
              const hitPercent = day.shardHitRate * 100;
              return (
                <div key={day.date} className="convergence-bar">
                  <div className="convergence-bar-tooltip">
                    {new Date(day.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}: {hitPercent.toFixed(1)}%
                  </div>
                  <div className="convergence-bar-fill hit-rate" style={{ height: `${Math.max(2, hitPercent)}%` }} />
                  <span className="convergence-bar-label">{new Date(day.date).getDate()}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Impact Cards */}
      <div className="convergence-cards">
        <div className="convergence-card">
          <CardIcon type="token" />
          <div className="convergence-card-content">
            <div className="convergence-card-value"><AnimatedNumber value={data.impact ? data.impact.tokensSaved : 0} /></div>
            <div className="convergence-card-label">Tokens Saved</div>
          </div>
        </div>
        <div className="convergence-card">
          <CardIcon type="brain" />
          <div className="convergence-card-content">
            <div className="convergence-card-value"><AnimatedNumber value={data.summary.activeShards} /></div>
            <div className="convergence-card-label">Active Shards</div>
          </div>
        </div>
        <div className="convergence-card">
          <CardIcon type="clock" />
          <div className="convergence-card-content">
            <div className="convergence-card-value">{data.impact ? `${data.impact.avgShardLatencyMs}ms` : '--'}</div>
            <div className="convergence-card-label">Avg Shard Latency</div>
          </div>
        </div>
        <div className="convergence-card">
          <CardIcon type="refresh" />
          <div className="convergence-card-content">
            <div className="convergence-card-value"><AnimatedNumber value={data.impact ? data.impact.totalExecutions : 0} /></div>
            <div className="convergence-card-label">Total Executions</div>
          </div>
        </div>
      </div>

      {/* Per-Domain Convergence */}
      {pagedIntCategories.length > 0 && (
        <div className="convergence-domain-section">
          <h3 className="convergence-section-title">Per-Domain Convergence</h3>
          <div className="convergence-domain-list">
            {pagedIntCategories.map((cat) => (
              <div key={cat.category} className="convergence-domain-item">
                <div className="convergence-domain-header">
                  <span className="convergence-domain-name">{cat.category}</span>
                  <span className="convergence-domain-score">{cat.convergenceScore}%</span>
                </div>
                <div className="convergence-domain-bar">
                  <div className="convergence-domain-bar-fill" style={{ width: `${cat.convergenceScore}%` }} />
                </div>
                <div className="convergence-domain-meta">
                  <span>Hit rate: {Math.round(cat.hitRate * 100)}%</span>
                  <span>Confidence: {Math.round(cat.avgConfidence * 100)}%</span>
                  <span>Shards: {cat.promotedShards}</span>
                  <span>Tokens saved: {cat.tokensSaved.toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>
          {totalIntCatPages > 1 && (
            <div className="convergence-pagination">
              <button className="convergence-page-btn" disabled={internalsCategoryPage <= 1} onClick={() => setInternalsCategoryPage(internalsCategoryPage - 1)}>Prev</button>
              <span className="convergence-page-info">{internalsCategoryPage} / {totalIntCatPages}</span>
              <button className="convergence-page-btn" disabled={internalsCategoryPage >= totalIntCatPages} onClick={() => setInternalsCategoryPage(internalsCategoryPage + 1)}>Next</button>
            </div>
          )}
        </div>
      )}

      {/* Knowledge Architecture */}
      {data.knowledgeTypes && data.knowledgeTypes.length > 0 && (
        <div className="convergence-kt-section">
          <h3 className="convergence-kt-title">Knowledge Architecture</h3>
          <div className="convergence-kt-grid">
            {data.knowledgeTypes.map((kt) => {
              const total = data.knowledgeTypes!.reduce((s, k) => s + k.count, 0);
              const pct = total > 0 ? Math.round((kt.count / total) * 100) : 0;
              return (
                <div key={kt.type} className={`convergence-kt-item kt-${kt.type}`}>
                  <div className="convergence-kt-bar">
                    <div className={`convergence-kt-bar-fill kt-fill-${kt.type}`} style={{ width: `${Math.max(4, pct)}%` }} />
                  </div>
                  <div className="convergence-kt-meta">
                    <span className="convergence-kt-name">{kt.type}</span>
                    <span className="convergence-kt-value">{kt.count} ({pct}%)</span>
                  </div>
                </div>
              );
            })}
          </div>

          {data.maturity && data.maturity.verification.length > 0 && (
            <div className="convergence-verification">
              {data.maturity.verification.map((v) => (
                <span key={v.status} className={`convergence-verification-chip ${VERIFICATION_CHIP_CLASS[v.status] || 'chip-unverified'}`}>
                  {v.status}: {v.count}
                </span>
              ))}
            </div>
          )}

          {data.maturity && data.maturity.lifecycle.length > 0 && (
            <div className="convergence-lifecycle">
              <div className="convergence-lifecycle-label">Lifecycle Pipeline</div>
              <div className="convergence-pipeline">
                {LIFECYCLE_STAGES.map((stage) => {
                  const entry = data.maturity!.lifecycle.find(l => l.stage === stage);
                  const count = entry ? entry.count : 0;
                  return (
                    <div key={stage} className={`convergence-pipeline-stage ${stage === 'promoted' ? 'stage-promoted' : ''}`}>
                      <span className="convergence-pipeline-count">{count}</span>
                      <span className="convergence-pipeline-name">{stage}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Feedback Health */}
      {data.feedback && data.feedback.totalSignals > 0 && (
        <div className="convergence-feedback-section">
          <h3 className="convergence-section-title">Feedback Health</h3>
          <div className="convergence-feedback-bars">
            {data.feedback.signals.map((sig) => {
              const pct = data.feedback!.totalSignals > 0 ? Math.round((sig.count / data.feedback!.totalSignals) * 100) : 0;
              return (
                <div key={sig.type} className="convergence-feedback-row">
                  <span className="convergence-feedback-label">{sig.type}</span>
                  <div className="convergence-feedback-track">
                    <div className={`convergence-feedback-fill ${FEEDBACK_FILL_CLASS[sig.type] || 'feedback-fill-default'}`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="convergence-feedback-rate">{pct}%</span>
                </div>
              );
            })}
            <div className="convergence-feedback-summary">
              <span>Acceptance rate: {Math.round(data.feedback.acceptanceRate * 100)}%</span>
              <span>Correction rate: {Math.round(data.feedback.correctionRate * 100)}%</span>
              <span>Total signals: {data.feedback.totalSignals}</span>
            </div>
          </div>
        </div>
      )}

      {/* Top Shards */}
      {data.topShards && data.topShards.length > 0 && (
        <div className="convergence-topshards-section">
          <h3 className="convergence-section-title">Top Performing Shards</h3>
          <table className="convergence-topshards-table">
            <thead>
              <tr><th>Name</th><th>Category</th><th>Hits</th><th>Confidence</th></tr>
            </thead>
            <tbody>
              {data.topShards.map((shard) => (
                <tr key={shard.id}>
                  <td className="convergence-topshards-name">{shard.name}</td>
                  <td><span className="convergence-topshards-category">{shard.category}</span></td>
                  <td>{shard.hits}</td>
                  <td className="convergence-topshards-confidence">{Math.round(shard.confidence * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
