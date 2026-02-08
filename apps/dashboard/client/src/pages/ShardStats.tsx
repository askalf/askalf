import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/auth';
import './ShardStats.css';

interface ShardStat {
  id: string;
  name: string;
  category: string;
  knowledgeType: string;
  verificationStatus: string;
  hits: number;
  tokensSaved: number;
  avgExecutionMs: number;
  firstHit: string;
  lastHit: string;
}

interface DailyStat {
  date: string;
  hits: number;
  tokensSaved: number;
}

interface CategoryStat {
  category: string;
  hits: number;
  tokensSaved: number;
}

interface KnowledgeTypeStat {
  type: string;
  count: number;
}

interface ShardStatsData {
  totals: {
    shardHits: number;
    tokensSaved: number;
    uniqueShards: number;
    firstHit: string | null;
    lastHit: string | null;
    estimatedPowerSavedWh: number;
  };
  shards: ShardStat[];
  daily: DailyStat[];
  categories: CategoryStat[];
  knowledgeTypes: KnowledgeTypeStat[];
}

// Determine API base URL
const getApiUrl = () => {
  const host = window.location.hostname;
  if (host.includes('askalf.org')) return 'https://api.askalf.org';
  if (host === 'localhost' || host === '127.0.0.1') return 'http://localhost:3000';
  return '';
};

const API_BASE = getApiUrl();

export default function ShardStats() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const [stats, setStats] = useState<ShardStatsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { document.title = 'Your Brain Growth — Ask ALF'; }, []);
  const [error, setError] = useState<string | null>(null);
  const [shardPage, setShardPage] = useState(1);
  const [catPage, setCatPage] = useState(1);
  const SHARDS_PER_PAGE = 10;
  const CATS_PER_PAGE = 8;

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }

    fetchStats();
  }, [user, navigate]);

  const fetchStats = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/api/user/shard-stats/detailed`, {
        credentials: 'include',
      });

      if (!res.ok) {
        throw new Error('Failed to fetch shard statistics');
      }

      const data = await res.json();
      setStats(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load statistics');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="shard-stats-page">
        <div className="shard-stats-loading">
          <div className="loading-spinner" />
          <p>Loading your shard statistics...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="shard-stats-page">
        <div className="shard-stats-error">
          <p>{error}</p>
          <button onClick={fetchStats}>Try Again</button>
        </div>
      </div>
    );
  }

  if (!stats) {
    return null;
  }

  const hasData = stats.totals.shardHits > 0;

  return (
    <div className="shard-stats-page">
      <div className="shard-stats-header">
        <h1>Your Brain Growth</h1>
        <p className="shard-stats-subtitle">
          Every shard hit is a question ALF answered for free.
        </p>
      </div>

      {/* Totals Summary */}
      <div className="shard-stats-totals">
        <div className="stat-card primary">
          <div className="stat-icon">⚡</div>
          <div className="stat-content">
            <div className="stat-value">{stats.totals.shardHits.toLocaleString()}</div>
            <div className="stat-label">Free Answers</div>
          </div>
        </div>

        <div className="stat-card success">
          <div className="stat-icon">🪙</div>
          <div className="stat-content">
            <div className="stat-value">{stats.totals.tokensSaved.toLocaleString()}</div>
            <div className="stat-label">Tokens You Didn't Pay For</div>
          </div>
        </div>

        <div className="stat-card info">
          <div className="stat-icon">📦</div>
          <div className="stat-content">
            <div className="stat-value">{stats.totals.uniqueShards}</div>
            <div className="stat-label">Unique Shards Used</div>
          </div>
        </div>

        <div className="stat-card warning">
          <div className="stat-icon">⚡</div>
          <div className="stat-content">
            <div className="stat-value">~{stats.totals.estimatedPowerSavedWh}Wh</div>
            <div className="stat-label">Est. Power Saved</div>
          </div>
        </div>
      </div>

      {!hasData ? (
        <div className="shard-stats-empty">
          <div className="empty-icon">📊</div>
          <h2>No Shard Hits Yet</h2>
          <p>
            When you use ALF and hit crystallized knowledge shards, your statistics will appear here.
            Keep chatting to see your personal savings grow!
          </p>
        </div>
      ) : (
        <>
          {/* Activity Timeline */}
          {stats.totals.firstHit && (
            <div className="shard-stats-timeline">
              <div className="timeline-item">
                <span className="timeline-label">First shard hit:</span>
                <span className="timeline-value">
                  {new Date(stats.totals.firstHit).toLocaleDateString(undefined, {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </span>
              </div>
              {stats.totals.lastHit && (
                <div className="timeline-item">
                  <span className="timeline-label">Most recent:</span>
                  <span className="timeline-value">
                    {new Date(stats.totals.lastHit).toLocaleDateString(undefined, {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    })}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Knowledge Type Breakdown */}
          {stats.knowledgeTypes && stats.knowledgeTypes.length > 0 && (
            <div className="shard-stats-section">
              <h2>Knowledge Types</h2>
              <div className="knowledge-type-grid">
                {stats.knowledgeTypes.map((kt) => (
                  <div key={kt.type} className={`knowledge-type-card kt-${kt.type}`}>
                    <div className="kt-icon">
                      {kt.type === 'immutable' ? '💎' :
                       kt.type === 'temporal' ? '⏳' :
                       kt.type === 'contextual' ? '🎯' : '⚙️'}
                    </div>
                    <div className="kt-info">
                      <div className="kt-name">{kt.type}</div>
                      <div className="kt-count">{kt.count} shards</div>
                    </div>
                    <div className="kt-description">
                      {kt.type === 'immutable' ? 'Never changes, never decays' :
                       kt.type === 'temporal' ? 'Verified periodically, may expire' :
                       kt.type === 'contextual' ? 'Context-dependent, not auto-promoted' :
                       'Standard learned knowledge'}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Category Breakdown */}
          {stats.categories.length > 0 && (() => {
            const totalCatPages = Math.ceil(stats.categories.length / CATS_PER_PAGE);
            const pagedCats = stats.categories.slice(
              (catPage - 1) * CATS_PER_PAGE,
              catPage * CATS_PER_PAGE
            );
            return (
              <div className="shard-stats-section">
                <h2>By Category</h2>
                <div className="category-grid">
                  {pagedCats.map((cat) => (
                    <div key={cat.category} className="category-card">
                      <div className="category-name">{cat.category}</div>
                      <div className="category-stats">
                        <span className="category-hits">{cat.hits} hits</span>
                        <span className="category-tokens">{cat.tokensSaved.toLocaleString()} tokens saved</span>
                      </div>
                      <div className="category-bar">
                        <div
                          className="category-bar-fill"
                          style={{
                            width: `${Math.min(100, (cat.hits / stats.totals.shardHits) * 100)}%`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                {totalCatPages > 1 && (
                  <div className="shard-stats-pagination">
                    <button
                      className="pagination-btn"
                      disabled={catPage <= 1}
                      onClick={() => setCatPage(p => p - 1)}
                    >
                      Prev
                    </button>
                    <span className="pagination-info">
                      Page {catPage} of {totalCatPages}
                    </span>
                    <button
                      className="pagination-btn"
                      disabled={catPage >= totalCatPages}
                      onClick={() => setCatPage(p => p + 1)}
                    >
                      Next
                    </button>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Per-Shard Table */}
          {stats.shards.length > 0 && (() => {
            const totalShardPages = Math.ceil(stats.shards.length / SHARDS_PER_PAGE);
            const pagedShards = stats.shards.slice(
              (shardPage - 1) * SHARDS_PER_PAGE,
              shardPage * SHARDS_PER_PAGE
            );
            return (
              <div className="shard-stats-section">
                <h2>Top Shards</h2>
                <div className="shards-table-wrapper">
                  <table className="shards-table">
                    <thead>
                      <tr>
                        <th>Shard</th>
                        <th>Type</th>
                        <th>Category</th>
                        <th>Hits</th>
                        <th>Tokens Saved</th>
                        <th>Avg Speed</th>
                        <th>Last Used</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedShards.map((shard) => (
                        <tr key={shard.id}>
                          <td className="shard-name-cell">
                            <span className="shard-name">{shard.name}</span>
                          </td>
                          <td>
                            <span className={`kt-badge kt-badge-${shard.knowledgeType}`}>
                              {shard.knowledgeType}
                            </span>
                          </td>
                          <td>
                            <span className="category-badge">{shard.category}</span>
                          </td>
                          <td className="hits-cell">{shard.hits}</td>
                          <td className="tokens-cell">{shard.tokensSaved.toLocaleString()}</td>
                          <td className="speed-cell">{shard.avgExecutionMs}ms</td>
                          <td className="date-cell">
                            {new Date(shard.lastHit).toLocaleDateString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {totalShardPages > 1 && (
                  <div className="shard-stats-pagination">
                    <button
                      className="pagination-btn"
                      disabled={shardPage <= 1}
                      onClick={() => setShardPage(p => p - 1)}
                    >
                      Prev
                    </button>
                    <span className="pagination-info">
                      Page {shardPage} of {totalShardPages}
                    </span>
                    <button
                      className="pagination-btn"
                      disabled={shardPage >= totalShardPages}
                      onClick={() => setShardPage(p => p + 1)}
                    >
                      Next
                    </button>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Daily Activity (last 30 days) */}
          {stats.daily.length > 0 && (
            <div className="shard-stats-section">
              <h2>Last 30 Days</h2>
              <div className="daily-chart">
                {stats.daily.slice(0, 30).map((day) => {
                  const maxHits = Math.max(...stats.daily.map((d) => d.hits));
                  const height = maxHits > 0 ? (day.hits / maxHits) * 100 : 0;
                  return (
                    <div
                      key={day.date}
                      className="daily-bar"
                      title={`${day.date}: ${day.hits} hits, ${day.tokensSaved} tokens saved`}
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
        </>
      )}

      {/* Transparency Note */}
      <div className="shard-stats-footer">
        <p>
          These statistics show your personal shard usage. Shards are crystallized knowledge
          that answer instantly without using AI compute, saving tokens and resources.
        </p>
      </div>
    </div>
  );
}
