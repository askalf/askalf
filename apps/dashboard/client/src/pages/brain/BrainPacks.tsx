import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/auth';
import { useBrainStore } from '../../stores/brain';
import {
  getCategoryIcon,
  tokensToDollars,
} from '../../hooks/useBrainApi';

export default function BrainPacks() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const {
    packs, installedSlugs, packsLoading,
    installingSlug, packsError,
    fetchPacks, fetchInstalledPacks: loadInstalled,
    fetchPackDetail, installPack,
  } = useBrainStore();

  useEffect(() => {
    fetchPacks();
    loadInstalled();
  }, []);

  const handleInstall = (slug: string) => {
    if (!user) {
      navigate('/login');
      return;
    }
    installPack(slug);
  };

  return (
    <div className="brain-packs">
      {packsError && (
        <div className="brain-packs-error">
          {packsError}
          <button onClick={() => useBrainStore.setState({ packsError: null })}>Dismiss</button>
        </div>
      )}

      <div className="brain-packs-content">
        {packsLoading ? (
          <div className="brain-loading">
            <div className="loading-spinner" />
            <p>Loading packs...</p>
          </div>
        ) : packs.length === 0 ? (
          <div className="brain-empty-browse">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
            <h3>No packs available</h3>
            <p>Check back soon for pre-built knowledge libraries.</p>
          </div>
        ) : (
          <div className="brain-packs-grid">
            {packs.map((pack) => {
              const isInstalled = installedSlugs.has(pack.slug);
              const isInstalling = installingSlug === pack.slug;

              return (
                <div
                  key={pack.id}
                  className={`brain-pack-card ${isInstalled ? 'installed' : ''} ${pack.isFeatured ? 'featured' : ''}`}
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
                      <span className="stat-label">patterns</span>
                    </div>
                    <div className="pack-stat">
                      <span className="stat-value">{tokensToDollars(pack.totalEstimatedTokens)}</span>
                      <span className="stat-label">est. value</span>
                    </div>
                    <div className="pack-stat">
                      <span className="stat-value">v{pack.version}</span>
                      <span className="stat-label">version</span>
                    </div>
                  </div>

                  <div className="pack-footer">
                    <button className="pack-view-btn" onClick={() => fetchPackDetail(pack.slug)}>
                      View contents
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
                        onClick={() => handleInstall(pack.slug)}
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
    </div>
  );
}
