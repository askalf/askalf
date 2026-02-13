import { useEffect } from 'react';
import { useAuthStore } from '../../stores/auth';
import { useBrainStore } from '../../stores/brain';
import {
  tokensToDollars,
  formatDate,
  STATS_SHARDS_PER_PAGE,
  STATS_CATS_PER_PAGE,
} from '../../hooks/useBrainApi';

export default function BrainDashboard() {
  const { user } = useAuthStore();
  const {
    stats, statsLoading, statsError,
    shardPage, setShardPage,
    catPage, setCatPage,
    fetchStats,
  } = useBrainStore();

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  if (statsLoading) {
    return (
      <div className="brain-loading">
        <div className="loading-spinner" />
        <p>Loading your statistics...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="brain-login-cta">
        <div className="cta-icon">🧠</div>
        <h2>Sign in to see your savings</h2>
        <p>Track how much money ALF saves you with instant answers. Browse and Packs are available without an account.</p>
        <a href="/login" className="brain-cta-btn">Sign In</a>
      </div>
    );
  }

  if (statsError) {
    return (
      <div className="brain-error">
        <p>{statsError}</p>
        <button onClick={fetchStats}>Try Again</button>
      </div>
    );
  }

  if (!stats) return null;

  const hasData = stats.totals.shardHits > 0;

  return (
    <div className="brain-dashboard">
      {/* Dollar Hero */}
      <div className="brain-hero">
        <div className="brain-hero-amount">{tokensToDollars(stats.totals.tokensSaved)}</div>
        <div className="brain-hero-label">saved by instant answers</div>
        <div className="brain-hero-sub">{stats.totals.shardHits.toLocaleString()} free answers delivered</div>
      </div>

      {/* 4 Stat Cards */}
      <div className="brain-stat-cards">
        <div className="stat-card success">
          <div className="stat-icon">💰</div>
          <div className="stat-content">
            <div className="stat-value">{tokensToDollars(stats.totals.tokensSaved)}</div>
            <div className="stat-label">Money Saved</div>
          </div>
        </div>

        <div className="stat-card primary">
          <div className="stat-icon">⚡</div>
          <div className="stat-content">
            <div className="stat-value">{stats.totals.shardHits.toLocaleString()}</div>
            <div className="stat-label">Free Answers</div>
          </div>
        </div>

        <div className="stat-card info">
          <div className="stat-icon">📦</div>
          <div className="stat-content">
            <div className="stat-value">{stats.totals.uniqueShards}</div>
            <div className="stat-label">Unique Knowledge</div>
          </div>
        </div>

        <div className="stat-card warning">
          <div className="stat-icon">⚡</div>
          <div className="stat-content">
            <div className="stat-value">~{stats.totals.estimatedPowerSavedWh}Wh</div>
            <div className="stat-label">Power Saved</div>
          </div>
        </div>
      </div>

      {!hasData ? (
        <div className="brain-empty">
          <div className="empty-icon">📊</div>
          <h2>No Activity Yet</h2>
          <p>
            When you chat with ALF and get instant answers, your savings will appear here.
            Keep chatting to watch your savings grow!
          </p>
        </div>
      ) : (
        <>
          {/* Activity Timeline */}
          {stats.totals.firstHit && (
            <div className="brain-timeline">
              <div className="timeline-item">
                <span className="timeline-label">First instant answer:</span>
                <span className="timeline-value">{formatDate(stats.totals.firstHit)}</span>
              </div>
              {stats.totals.lastHit && (
                <div className="timeline-item">
                  <span className="timeline-label">Most recent:</span>
                  <span className="timeline-value">{formatDate(stats.totals.lastHit)}</span>
                </div>
              )}
            </div>
          )}

          {/* 30-day Bar Chart */}
          {stats.daily.length > 0 && (
            <div className="brain-section">
              <h2>Last 30 Days</h2>
              <div className="brain-daily-chart">
                {stats.daily.slice(0, 30).map((day) => {
                  const maxHits = Math.max(...stats.daily.map((d) => d.hits));
                  const height = maxHits > 0 ? (day.hits / maxHits) * 100 : 0;
                  return (
                    <div
                      key={day.date}
                      className="daily-bar"
                      title={`${day.date}: ${day.hits} answers, ${tokensToDollars(day.tokensSaved)} saved`}
                    >
                      <div
                        className="daily-bar-fill"
                        style={{ height: `${Math.max(2, height)}%` }}
                      />
                      <span className="daily-bar-label">
                        {new Date(day.date).getDate()}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Knowledge Types Grid */}
          {stats.knowledgeTypes && stats.knowledgeTypes.length > 0 && (
            <div className="brain-section">
              <h2>Knowledge Types</h2>
              <div className="brain-kt-grid">
                {stats.knowledgeTypes.map((kt) => (
                  <div key={kt.type} className={`brain-kt-card kt-${kt.type}`}>
                    <div className="kt-icon">
                      {kt.type === 'immutable' ? '💎' :
                       kt.type === 'temporal' ? '⏳' :
                       kt.type === 'contextual' ? '🎯' : '⚙️'}
                    </div>
                    <div className="kt-info">
                      <div className="kt-name">{kt.type}</div>
                      <div className="kt-count">{kt.count} patterns</div>
                    </div>
                    <div className="kt-description">
                      {kt.type === 'immutable' ? 'Never changes, never decays' :
                       kt.type === 'temporal' ? 'Verified periodically, may expire' :
                       kt.type === 'contextual' ? 'Context-dependent answers' :
                       'Standard learned knowledge'}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Top Categories */}
          {stats.categories.length > 0 && (() => {
            const totalCatPages = Math.ceil(stats.categories.length / STATS_CATS_PER_PAGE);
            const pagedCats = stats.categories.slice(
              (catPage - 1) * STATS_CATS_PER_PAGE,
              catPage * STATS_CATS_PER_PAGE
            );
            return (
              <div className="brain-section">
                <h2>Top Categories</h2>
                <div className="brain-category-grid">
                  {pagedCats.map((cat) => (
                    <div key={cat.category} className="brain-category-card">
                      <div className="category-name">{cat.category}</div>
                      <div className="category-stats">
                        <span className="category-hits">{cat.hits} answers</span>
                        <span className="category-tokens">{tokensToDollars(cat.tokensSaved)} saved</span>
                      </div>
                      <div className="category-bar">
                        <div
                          className="category-bar-fill"
                          style={{ width: `${Math.min(100, (cat.hits / stats.totals.shardHits) * 100)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                {totalCatPages > 1 && (
                  <div className="brain-pagination">
                    <button className="pagination-btn" disabled={catPage <= 1} onClick={() => setCatPage(catPage - 1)}>Prev</button>
                    <span className="pagination-info">Page {catPage} of {totalCatPages}</span>
                    <button className="pagination-btn" disabled={catPage >= totalCatPages} onClick={() => setCatPage(catPage + 1)}>Next</button>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Top Knowledge Table */}
          {stats.shards.length > 0 && (() => {
            const totalShardPages = Math.ceil(stats.shards.length / STATS_SHARDS_PER_PAGE);
            const pagedShards = stats.shards.slice(
              (shardPage - 1) * STATS_SHARDS_PER_PAGE,
              shardPage * STATS_SHARDS_PER_PAGE
            );
            return (
              <div className="brain-section">
                <h2>Top Knowledge</h2>
                <div className="brain-table-wrapper">
                  <table className="brain-table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Type</th>
                        <th>Category</th>
                        <th>Times Used</th>
                        <th>Value Saved</th>
                        <th>Speed</th>
                        <th>Last Used</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedShards.map((shard) => (
                        <tr key={shard.id}>
                          <td className="brain-name-cell">{shard.name}</td>
                          <td>
                            <span className={`kt-badge kt-badge-${shard.knowledgeType}`}>{shard.knowledgeType}</span>
                          </td>
                          <td><span className="category-badge">{shard.category}</span></td>
                          <td className="hits-cell">{shard.hits}</td>
                          <td className="tokens-cell">{tokensToDollars(shard.tokensSaved)}</td>
                          <td className="speed-cell">{shard.avgExecutionMs}ms</td>
                          <td className="date-cell">{new Date(shard.lastHit).toLocaleDateString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {totalShardPages > 1 && (
                  <div className="brain-pagination">
                    <button className="pagination-btn" disabled={shardPage <= 1} onClick={() => setShardPage(shardPage - 1)}>Prev</button>
                    <span className="pagination-info">Page {shardPage} of {totalShardPages}</span>
                    <button className="pagination-btn" disabled={shardPage >= totalShardPages} onClick={() => setShardPage(shardPage + 1)}>Next</button>
                  </div>
                )}
              </div>
            );
          })()}
        </>
      )}

      <div className="brain-footer">
        <p>
          These statistics show your personal usage. Instant answers are powered by crystallized knowledge
          that responds without using AI compute, saving you money and resources.
        </p>
      </div>
    </div>
  );
}
