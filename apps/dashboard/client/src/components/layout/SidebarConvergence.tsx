import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../../stores/auth';
import {
  convergenceApi, type ConvergenceData,
  getExpertiseLevel, getCategoryDisplayName,
} from '../../hooks/useConvergenceApi';

function MiniRing({ percent }: { percent: number }) {
  const radius = 24;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percent / 100) * circumference;

  return (
    <div className="sb-mini-ring">
      <svg viewBox="0 0 60 60" width="60" height="60">
        <circle
          cx="30" cy="30" r={radius}
          fill="none" stroke="var(--border)" strokeWidth="4"
        />
        <circle
          cx="30" cy="30" r={radius}
          fill="none" stroke="var(--crystal)" strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform="rotate(-90 30 30)"
          style={{ transition: 'stroke-dashoffset 0.6s ease' }}
        />
      </svg>
      <div className="sb-mini-ring-label">
        <span className="sb-mini-ring-value">{Math.round(percent)}</span>
        <span className="sb-mini-ring-unit">%</span>
      </div>
    </div>
  );
}

export default function SidebarConvergence() {
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';

  const [expanded, setExpanded] = useState(false);
  const [data, setData] = useState<ConvergenceData | null>(null);
  const [loading, setLoading] = useState(false);

  // Fetch on first expand
  useEffect(() => {
    if (!expanded || data) return;
    setLoading(true);
    convergenceApi.getConvergence()
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [expanded, data]);

  const hitRate = data ? Math.round(data.summary.currentHitRate * 100) : 0;
  const topCategories = (data?.categories || []).slice(0, 3);

  return (
    <div className="sb-widget">
      <button
        className="sb-widget-header"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
          <circle cx="12" cy="12" r="10" />
          <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
        <span>Convergence</span>
        {data && <span className="sb-widget-badge">{hitRate}%</span>}
        <svg
          className={`sb-widget-chevron ${expanded ? 'expanded' : ''}`}
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {expanded && (
        <div className="sb-widget-content">
          {loading ? (
            <div className="sb-convergence-loading">Loading...</div>
          ) : !data || data.daily.length === 0 ? (
            <div className="sb-convergence-empty">
              Start chatting to see convergence data
            </div>
          ) : (
            <>
              {/* Hero: ring + label */}
              <div className="sb-convergence-hero">
                <MiniRing percent={hitRate} />
                <div className="sb-convergence-hero-text">
                  <div className="sb-convergence-hero-label">Free Answer Rate</div>
                  <span className={`sb-convergence-trend ${data.summary.trend}`}>
                    {data.summary.trend === 'improving' && (
                      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" width="12" height="12">
                        <path d="M8 12V4M4 8l4-4 4 4" />
                      </svg>
                    )}
                    {data.summary.trend === 'declining' && (
                      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" width="12" height="12">
                        <path d="M8 4v8M4 8l4 4 4-4" />
                      </svg>
                    )}
                    {data.summary.trend === 'improving' ? 'Improving' : data.summary.trend === 'declining' ? 'Declining' : 'Stable'}
                  </span>
                </div>
              </div>

              {/* Metrics 2x2 */}
              <div className="sb-convergence-metrics">
                <div className="sb-metric">
                  <div className="sb-metric-value">{data.summary.totalFreeAnswers}</div>
                  <div className="sb-metric-label">Free Answers</div>
                </div>
                <div className="sb-metric">
                  <div className="sb-metric-value">${data.summary.estimatedMonthlySavings.toFixed(2)}</div>
                  <div className="sb-metric-label">Credits Saved</div>
                </div>
                <div className="sb-metric">
                  <div className="sb-metric-value">{data.summary.activeShards}</div>
                  <div className="sb-metric-label">Active Shards</div>
                </div>
                <div className="sb-metric">
                  <div className="sb-metric-value">{data.impact?.tokensSaved?.toLocaleString() || '0'}</div>
                  <div className="sb-metric-label">Tokens Saved</div>
                </div>
              </div>

              {/* Top expertise pills */}
              {topCategories.length > 0 && (
                <div className="sb-convergence-expertise">
                  {topCategories.map((cat) => {
                    const expertise = getExpertiseLevel(cat.promotedShards, cat.avgConfidence);
                    return (
                      <span key={cat.category} className={`sb-expertise-pill expertise-${expertise.level}`}>
                        {getCategoryDisplayName(cat.category)}
                      </span>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* View all link */}
          {isAdmin && (
            <div className="sb-widget-footer">
              <Link to="/admin/convergence">View all →</Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
