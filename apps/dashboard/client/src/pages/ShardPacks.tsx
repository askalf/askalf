import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/auth';
import './ShardPacks.css';

interface ShardPack {
  id: string;
  name: string;
  slug: string;
  description: string;
  category: string;
  version: number;
  shardCount: number;
  totalEstimatedTokens: number;
  author: string;
  isFeatured: boolean;
  createdAt: string;
  isInstalled?: boolean;
  installedAt?: string;
}

const API_BASE = window.location.hostname.includes('askalf.org')
  ? 'https://api.askalf.org'
  : 'http://localhost:3000';

export default function ShardPacks() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [packs, setPacks] = useState<ShardPack[]>([]);
  const [installedSlugs, setInstalledSlugs] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedPack, setSelectedPack] = useState<ShardPack | null>(null);
  const [packShards, setPackShards] = useState<Array<{ id: string; name: string; description?: string }>>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    document.title = 'Shard Packs — Ask ALF';
  }, []);

  useEffect(() => {
    fetchPacks();
    fetchInstalled();
  }, []);

  const fetchPacks = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/packs`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setPacks(data.packs || []);
      }
    } catch (err) {
      console.error('Failed to fetch packs:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchInstalled = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/packs/installed`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        const slugs = new Set<string>((data.packs || []).map((p: ShardPack) => p.slug));
        setInstalledSlugs(slugs);
      }
    } catch (err) {
      // User might not be logged in
    }
  };

  const fetchPackDetail = async (slug: string) => {
    setDetailLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/packs/${slug}`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setSelectedPack(data.pack);
        setPackShards(data.shards || []);
      }
    } catch (err) {
      console.error('Failed to fetch pack detail:', err);
    } finally {
      setDetailLoading(false);
    }
  };

  const installPack = async (slug: string) => {
    if (!user) {
      navigate('/login');
      return;
    }

    setInstalling(slug);
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/api/v1/packs/${slug}/install`, {
        method: 'POST',
        credentials: 'include',
      });

      if (res.ok) {
        setInstalledSlugs(prev => new Set([...prev, slug]));
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to install pack');
      }
    } catch (err) {
      setError('Failed to install pack');
    } finally {
      setInstalling(null);
    }
  };

  const formatNumber = (n: number) => {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return n.toString();
  };

  const getCategoryIcon = (category: string) => {
    const icons: Record<string, string> = {
      science: '🔬',
      technology: '💻',
      math: '🔢',
      geography: '🌍',
      health: '🏥',
      language: '📝',
      history: '📜',
      finance: '💰',
      general: '📦',
    };
    return icons[category] || '📦';
  };

  return (
    <div className="packs-page">
      {/* Header */}
      <div className="packs-header">
        <button className="packs-back-btn" onClick={() => navigate('/app/chat')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back to Chat
        </button>
        <h1>Shard Packs</h1>
        <p>Pre-built knowledge libraries. Install with one click and skip the learning curve.</p>
      </div>

      {error && (
        <div className="packs-error">
          {error}
          <button onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      {/* Pack Grid */}
      <div className="packs-content">
        {loading ? (
          <div className="packs-loading">
            <div className="loading-spinner" />
            <p>Loading packs...</p>
          </div>
        ) : packs.length === 0 ? (
          <div className="packs-empty">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
            <h3>No packs available</h3>
            <p>Check back soon for pre-built knowledge libraries.</p>
          </div>
        ) : (
          <div className="packs-grid">
            {packs.map((pack) => {
              const isInstalled = installedSlugs.has(pack.slug);
              const isInstalling = installing === pack.slug;

              return (
                <div
                  key={pack.id}
                  className={`pack-card ${isInstalled ? 'installed' : ''} ${pack.isFeatured ? 'featured' : ''}`}
                >
                  <div className="pack-header">
                    <span className="pack-icon">{getCategoryIcon(pack.category)}</span>
                    <div className="pack-badges">
                      {pack.isFeatured && <span className="pack-badge featured">Featured</span>}
                      {isInstalled && <span className="pack-badge installed">Installed</span>}
                    </div>
                  </div>

                  <h3 className="pack-name">{pack.name}</h3>
                  <p className="pack-description">{pack.description}</p>

                  <div className="pack-stats">
                    <div className="pack-stat">
                      <span className="stat-value">{pack.shardCount}</span>
                      <span className="stat-label">shards</span>
                    </div>
                    <div className="pack-stat">
                      <span className="stat-value">{formatNumber(pack.totalEstimatedTokens)}</span>
                      <span className="stat-label">tokens</span>
                    </div>
                    <div className="pack-stat">
                      <span className="stat-value">v{pack.version}</span>
                      <span className="stat-label">version</span>
                    </div>
                  </div>

                  <div className="pack-footer">
                    <button
                      className="pack-view-btn"
                      onClick={() => fetchPackDetail(pack.slug)}
                    >
                      View shards
                    </button>
                    {isInstalled ? (
                      <span className="pack-installed-label">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M20 6L9 17l-5-5" />
                        </svg>
                        Installed
                      </span>
                    ) : (
                      <button
                        className="pack-install-btn"
                        onClick={() => installPack(pack.slug)}
                        disabled={isInstalling}
                      >
                        {isInstalling ? (
                          <>
                            <div className="btn-spinner" />
                            Installing...
                          </>
                        ) : (
                          <>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
                            </svg>
                            Install
                          </>
                        )}
                      </button>
                    )}
                  </div>

                  <div className="pack-author">by {pack.author}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Pack Detail Modal */}
      {selectedPack && (
        <div className="pack-modal-overlay" onClick={() => setSelectedPack(null)}>
          <div className="pack-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title-row">
                <span className="modal-icon">{getCategoryIcon(selectedPack.category)}</span>
                <h2>{selectedPack.name}</h2>
              </div>
              <button className="modal-close" onClick={() => setSelectedPack(null)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            {detailLoading ? (
              <div className="modal-loading">
                <div className="loading-spinner" />
              </div>
            ) : (
              <div className="modal-body">
                <p className="modal-description">{selectedPack.description}</p>

                <div className="modal-meta">
                  <span>{selectedPack.shardCount} shards</span>
                  <span>{formatNumber(selectedPack.totalEstimatedTokens)} tokens</span>
                  <span>v{selectedPack.version}</span>
                  <span>by {selectedPack.author}</span>
                </div>

                <h4>Included Shards</h4>
                <div className="modal-shard-list">
                  {packShards.map((shard) => (
                    <div key={shard.id} className="modal-shard">
                      <span className="shard-name">{shard.name}</span>
                      {shard.description && (
                        <span className="shard-desc">{shard.description}</span>
                      )}
                    </div>
                  ))}
                </div>

                <div className="modal-actions">
                  {installedSlugs.has(selectedPack.slug) ? (
                    <span className="modal-installed">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                      Already installed
                    </span>
                  ) : (
                    <button
                      className="modal-install-btn"
                      onClick={() => {
                        installPack(selectedPack.slug);
                        setSelectedPack(null);
                      }}
                      disabled={installing === selectedPack.slug}
                    >
                      {installing === selectedPack.slug ? 'Installing...' : 'Install this pack'}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
