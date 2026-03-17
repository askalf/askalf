import { useState, useEffect, useCallback, useMemo } from 'react';
import { hubApi } from '../../hooks/useHubApi';
import type { MarketplacePackage } from '../../hooks/useHubApi';
import './MarketplaceTab.css';

// ── Types ──

type PackageType = 'mcp_server' | 'skill_template' | 'tool_bundle';
type SortOption = 'popular' | 'rating' | 'recent';

const TYPE_LABELS: Record<PackageType, string> = {
  mcp_server: 'MCP Server',
  skill_template: 'Skill',
  tool_bundle: 'Bundle',
};

function renderStars(rating: number): string {
  const full = Math.round(rating);
  let s = '';
  for (let i = 1; i <= 5; i++) s += i <= full ? '\u2605' : '\u2606';
  return s;
}

// ── Package Card ──

function PackageCard({
  pkg,
  onClick,
}: {
  pkg: MarketplacePackage;
  onClick: () => void;
}) {
  return (
    <button className="mp-card" onClick={onClick}>
      <div className="mp-card-header">
        <span className="mp-card-name">{pkg.name}</span>
        <span className={`mp-card-type mp-card-type--${pkg.type}`}>
          {TYPE_LABELS[pkg.type] ?? pkg.type}
        </span>
      </div>
      <div className="mp-card-desc">{pkg.description}</div>
      <div className="mp-card-meta">
        <span className="mp-card-author">{pkg.author}</span>
        <span className="mp-card-stars">{renderStars(pkg.rating ?? 0)}</span>
        <span className="mp-card-installs">{pkg.install_count ?? 0} installs</span>
      </div>
      {pkg.tags && pkg.tags.length > 0 && (
        <div className="mp-card-tags">
          {pkg.tags.slice(0, 5).map(t => (
            <span key={t} className="mp-tag">{t}</span>
          ))}
        </div>
      )}
    </button>
  );
}

// ── Package Detail Modal ──

function PackageDetailModal({
  pkg,
  onClose,
}: {
  pkg: MarketplacePackage;
  onClose: () => void;
}) {
  const [installing, setInstalling] = useState(false);
  const [installResult, setInstallResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Rating form state
  const [starValue, setStarValue] = useState(0);
  const [reviewText, setReviewText] = useState('');
  const [submittingRating, setSubmittingRating] = useState(false);
  const [ratingResult, setRatingResult] = useState<string | null>(null);

  const handleInstall = useCallback(async () => {
    setInstalling(true);
    setInstallResult(null);
    try {
      await hubApi.marketplace.install(pkg.slug);
      setInstallResult({ ok: true, message: 'Installed successfully' });
    } catch (err) {
      setInstallResult({ ok: false, message: err instanceof Error ? err.message : 'Install failed' });
    } finally {
      setInstalling(false);
    }
  }, [pkg.slug]);

  const handleRate = useCallback(async () => {
    if (starValue < 1) return;
    setSubmittingRating(true);
    setRatingResult(null);
    try {
      await hubApi.marketplace.rate(pkg.slug, { rating: starValue, review: reviewText || undefined });
      setRatingResult('Rating submitted');
      setStarValue(0);
      setReviewText('');
    } catch (err) {
      setRatingResult(err instanceof Error ? err.message : 'Rating failed');
    } finally {
      setSubmittingRating(false);
    }
  }, [pkg.slug, starValue, reviewText]);

  return (
    <div className="mp-modal-overlay" onClick={onClose}>
      <div className="mp-modal" onClick={e => e.stopPropagation()}>
        <div className="mp-modal-header">
          <h3 className="mp-modal-title">{pkg.name}</h3>
          <button className="mp-modal-close" onClick={onClose}>X</button>
        </div>

        <div className="mp-modal-meta">
          <span className={`mp-card-type mp-card-type--${pkg.type}`}>
            {TYPE_LABELS[pkg.type] ?? pkg.type}
          </span>
          <span>by {pkg.author}</span>
          <span className="mp-card-stars">{renderStars(pkg.rating ?? 0)} ({(pkg.rating ?? 0).toFixed(1)})</span>
          <span>{pkg.install_count ?? 0} installs</span>
          {pkg.repo_url && (
            <a href={pkg.repo_url} target="_blank" rel="noopener noreferrer">Repository</a>
          )}
        </div>

        <div className="mp-modal-body">{pkg.full_description ?? pkg.description}</div>

        {pkg.tags && pkg.tags.length > 0 && (
          <div className="mp-card-tags" style={{ marginBottom: '16px' }}>
            {pkg.tags.map(t => (
              <span key={t} className="mp-tag">{t}</span>
            ))}
          </div>
        )}

        <div className="mp-modal-actions">
          <button
            className={`mp-install-btn ${installResult?.ok ? 'installed' : ''}`}
            onClick={handleInstall}
            disabled={installing || installResult?.ok === true}
          >
            {installing ? 'Installing...' : installResult?.ok ? 'Installed' : 'Install'}
          </button>
          {installResult && (
            <span className={`mp-install-msg ${installResult.ok ? 'success' : 'error'}`}>
              {installResult.message}
            </span>
          )}
        </div>

        {/* Rating Form */}
        <div className="mp-rating-section">
          <h4>Rate this package</h4>
          <div className="mp-star-row">
            {[1, 2, 3, 4, 5].map(n => (
              <button
                key={n}
                className={`mp-star-btn ${n <= starValue ? 'filled' : 'empty'}`}
                onClick={() => setStarValue(n)}
                title={`${n} star${n > 1 ? 's' : ''}`}
              >
                {n <= starValue ? '\u2605' : '\u2606'}
              </button>
            ))}
          </div>
          <textarea
            className="mp-review-input"
            placeholder="Optional review..."
            value={reviewText}
            onChange={e => setReviewText(e.target.value)}
            rows={3}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button
              className="mp-rate-btn"
              onClick={handleRate}
              disabled={submittingRating || starValue < 1}
            >
              {submittingRating ? 'Submitting...' : 'Submit Rating'}
            </button>
            {ratingResult && (
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{ratingResult}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ──

export default function MarketplaceTab() {
  const [packages, setPackages] = useState<MarketplacePackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [tagFilter, setTagFilter] = useState<string>('');
  const [sortBy, setSortBy] = useState<SortOption>('popular');
  const [featuredOnly, setFeaturedOnly] = useState(false);
  const [selectedPkg, setSelectedPkg] = useState<MarketplacePackage | null>(null);

  // Fetch packages whenever filters change
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    hubApi.marketplace
      .list({
        type: typeFilter || undefined,
        tag: tagFilter || undefined,
        search: search || undefined,
        sort: sortBy,
        featured: featuredOnly || undefined,
      })
      .then(data => {
        if (!cancelled) setPackages(data.packages ?? []);
      })
      .catch(() => {
        if (!cancelled) setPackages([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [search, typeFilter, tagFilter, sortBy, featuredOnly]);

  // When a card is clicked, fetch full detail then show modal
  const handleSelectPackage = useCallback(async (pkg: MarketplacePackage) => {
    try {
      const detail = await hubApi.marketplace.detail(pkg.slug);
      setSelectedPkg((detail as { package: MarketplacePackage }).package ?? detail as unknown as MarketplacePackage);
    } catch {
      // fall back to the list-level data
      setSelectedPkg(pkg);
    }
  }, []);

  // Collect unique tags from current results for the tag filter dropdown
  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    packages.forEach(p => p.tags?.forEach(t => tagSet.add(t)));
    return [...tagSet].sort();
  }, [packages]);

  return (
    <div className="mp-container">
      {/* Toolbar */}
      <div className="mp-toolbar">
        <input
          type="text"
          className="mp-search"
          placeholder="Search packages..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />

        <select
          className="mp-filter-select"
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
        >
          <option value="">All types</option>
          <option value="mcp_server">MCP Server</option>
          <option value="skill_template">Skill Template</option>
          <option value="tool_bundle">Tool Bundle</option>
        </select>

        <select
          className="mp-filter-select"
          value={tagFilter}
          onChange={e => setTagFilter(e.target.value)}
        >
          <option value="">All tags</option>
          {allTags.map(t => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>

        <select
          className="mp-filter-select"
          value={sortBy}
          onChange={e => setSortBy(e.target.value as SortOption)}
        >
          <option value="popular">Most Popular</option>
          <option value="rating">Highest Rated</option>
          <option value="recent">Most Recent</option>
        </select>

        <button
          className={`mp-featured-toggle ${featuredOnly ? 'active' : ''}`}
          onClick={() => setFeaturedOnly(f => !f)}
        >
          Featured
        </button>

        <span className="mp-result-count">
          {loading ? 'Loading...' : `${packages.length} package${packages.length !== 1 ? 's' : ''}`}
        </span>
      </div>

      {/* Content */}
      <div className="mp-content">
        {loading ? (
          <div className="mp-loading">Loading marketplace...</div>
        ) : packages.length === 0 ? (
          <div className="mp-empty">No packages found. Try adjusting your filters.</div>
        ) : (
          <div className="mp-grid">
            {packages.map(pkg => (
              <PackageCard
                key={pkg.slug}
                pkg={pkg}
                onClick={() => handleSelectPackage(pkg)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {selectedPkg && (
        <PackageDetailModal
          pkg={selectedPkg}
          onClose={() => setSelectedPkg(null)}
        />
      )}
    </div>
  );
}
