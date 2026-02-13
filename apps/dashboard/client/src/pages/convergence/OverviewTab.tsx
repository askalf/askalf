import { useConvergenceStore } from '../../stores/convergence';
import {
  CATEGORIES_PER_PAGE, formatWater, formatPower,
  getExpertiseLevel, getCategoryDisplayName,
} from '../../hooks/useConvergenceApi';
import ConvergenceRing from './ConvergenceRing';
import AnimatedNumber from './AnimatedNumber';
import CardIcon from './CardIcon';

export default function OverviewTab() {
  const { data, categoryPage, setCategoryPage } = useConvergenceStore();
  if (!data) return null;

  const hasData = data.daily.length > 0;

  if (!hasData) {
    return (
      <div className="convergence-empty">
        <div className="convergence-empty-icon">👽</div>
        <h2>No Data Yet</h2>
        <p>
          Start chatting with ALF to see how it learns from your conversations.
          The more you use it, the more free answers you get.
        </p>
      </div>
    );
  }

  const totalCatPages = data.categories ? Math.ceil(data.categories.length / CATEGORIES_PER_PAGE) : 0;
  const pagedCategories = data.categories?.slice(
    (categoryPage - 1) * CATEGORIES_PER_PAGE,
    categoryPage * CATEGORIES_PER_PAGE
  ) || [];

  return (
    <>
      {/* Hero */}
      <div className="convergence-hero">
        <ConvergenceRing percent={data.summary.currentHitRate * 100} />
        <div className="convergence-hero-content">
          <h2 className="convergence-hero-title">Your questions answered for free</h2>
          <p className="convergence-hero-label">
            ALF has learned enough to answer {Math.round(data.summary.currentHitRate * 100)}% of your queries
            without calling an external AI. The more you use it, the smarter it gets.
          </p>
          <span className={`convergence-hero-trend ${data.summary.trend}`}>
            {data.summary.trend === 'improving' ? (
              <span className="convergence-trend-arrow">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" width="14" height="14">
                  <path d="M8 12V4M4 8l4-4 4 4" />
                </svg>
              </span>
            ) : data.summary.trend === 'declining' ? (
              <span className="convergence-trend-arrow">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" width="14" height="14">
                  <path d="M8 4v8M4 8l4 4 4-4" />
                </svg>
              </span>
            ) : null}
            {data.summary.trend === 'improving' ? 'Getting smarter' : data.summary.trend === 'declining' ? 'Exploring new topics' : 'Stable'} this week
          </span>
        </div>
      </div>

      {/* Impact Cards */}
      <div className="convergence-cards">
        <div className="convergence-card">
          <CardIcon type="bolt" />
          <div className="convergence-card-content">
            <div className="convergence-card-value"><AnimatedNumber value={data.summary.totalFreeAnswers} /></div>
            <div className="convergence-card-label">Free Answers This Month</div>
          </div>
        </div>
        <div className="convergence-card">
          <CardIcon type="dollar" />
          <div className="convergence-card-content">
            <div className="convergence-card-value"><AnimatedNumber value={data.summary.estimatedMonthlySavings} prefix="$" decimals={2} /></div>
            <div className="convergence-card-label">Credits Saved</div>
          </div>
        </div>
        <div className="convergence-card">
          <CardIcon type="water" />
          <div className="convergence-card-content">
            <div className="convergence-card-value">{data.impact ? formatWater(data.impact.environmental.waterMlSaved) : '0 mL'}</div>
            <div className="convergence-card-label">Water Saved</div>
          </div>
        </div>
        <div className="convergence-card">
          <CardIcon type="power" />
          <div className="convergence-card-content">
            <div className="convergence-card-value">{data.impact ? formatPower(data.impact.environmental.powerWhSaved) : '0 Wh'}</div>
            <div className="convergence-card-label">Power Saved</div>
          </div>
        </div>
      </div>

      {/* Bar Chart */}
      <div className="convergence-charts">
        <div className="convergence-chart-card" style={{ maxWidth: '100%' }}>
          <h3 className="convergence-chart-title">Free Answer Rate (the higher, the smarter ALF gets)</h3>
          <div className="convergence-bar-chart">
            {data.daily.map((day) => {
              const hitPercent = day.shardHitRate * 100;
              return (
                <div key={day.date} className="convergence-bar">
                  <div className="convergence-bar-tooltip">
                    {new Date(day.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}: {hitPercent.toFixed(1)}% free
                  </div>
                  <div className="convergence-bar-fill hit-rate" style={{ height: `${Math.max(2, hitPercent)}%` }} />
                  <span className="convergence-bar-label">{new Date(day.date).getDate()}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Expertise */}
      {pagedCategories.length > 0 && (
        <div className="convergence-expertise-section">
          <h3 className="convergence-section-title">Areas ALF Has Learned</h3>
          <p className="convergence-expertise-subtitle">
            These are the topics where ALF has built knowledge from your conversations
          </p>
          <div className="convergence-expertise-grid">
            {pagedCategories.map((cat) => {
              const expertise = getExpertiseLevel(cat.promotedShards, cat.avgConfidence);
              return (
                <div key={cat.category} className={`convergence-expertise-card expertise-${expertise.level}`}>
                  <div className="convergence-expertise-header">
                    <span className="convergence-expertise-name">{getCategoryDisplayName(cat.category)}</span>
                    <span className={`convergence-expertise-badge badge-${expertise.level}`}>{expertise.label}</span>
                  </div>
                  <div className="convergence-expertise-stats">
                    <span className="convergence-expertise-count">
                      {cat.promotedShards} {cat.promotedShards === 1 ? 'pattern' : 'patterns'} learned
                    </span>
                  </div>
                  <div className="convergence-expertise-indicator">
                    <div className="convergence-expertise-dots">
                      <span className={`expertise-dot ${['expert', 'proficient', 'learning', 'new'].includes(expertise.level) ? 'active' : ''}`} />
                      <span className={`expertise-dot ${['expert', 'proficient', 'learning'].includes(expertise.level) ? 'active' : ''}`} />
                      <span className={`expertise-dot ${['expert', 'proficient'].includes(expertise.level) ? 'active' : ''}`} />
                      <span className={`expertise-dot ${expertise.level === 'expert' ? 'active' : ''}`} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {totalCatPages > 1 && (
            <div className="convergence-pagination">
              <button className="convergence-page-btn" disabled={categoryPage <= 1} onClick={() => setCategoryPage(categoryPage - 1)}>Prev</button>
              <span className="convergence-page-info">{categoryPage} / {totalCatPages}</span>
              <button className="convergence-page-btn" disabled={categoryPage >= totalCatPages} onClick={() => setCategoryPage(categoryPage + 1)}>Next</button>
            </div>
          )}
        </div>
      )}

      {/* Explainer */}
      <div className="convergence-explainer">
        <p>
          Every other AI tool is a meter that runs. ALF is a brain that learns.
          The more you use it, the less it costs, the faster it gets, and the knowledge stays yours.
        </p>
      </div>
    </>
  );
}
