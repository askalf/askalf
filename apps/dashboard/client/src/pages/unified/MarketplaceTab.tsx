/**
 * Unified Marketplace — Worker Templates + Tool Bundles + MCP Servers
 * Merges the old marketplace (28 packages) with the skills library (109 templates).
 * Single hub for browsing, installing, rating, submitting, and importing.
 */

import { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { hubApi } from '../../hooks/useHubApi';
import type { MarketplacePackage } from '../../hooks/useHubApi';
import TabBar from '../../components/TabBar';
import './MarketplaceTab.css';

// Lazy-load the templates tab (already built with 109 templates, pagination, import/export)
const TemplatesTab = lazy(() => import('./TemplatesTab'));
// ── Types ──

type MarketSection = 'templates' | 'tools' | 'servers';
type SortOption = 'popular' | 'rating' | 'recent';

const TYPE_LABELS: Record<string, string> = {
  mcp_server: 'MCP Server',
  skill_template: 'Skill',
  tool_bundle: 'Tool Bundle',
};

function renderStars(rating: number): string {
  const full = Math.round(rating);
  let s = '';
  for (let i = 1; i <= 5; i++) s += i <= full ? '\u2605' : '\u2606';
  return s;
}

// ── Package Card ──

function PackageCard({ pkg, onClick, onExport }: { pkg: MarketplacePackage; onClick: () => void; onExport?: () => void }) {
  return (
    <div className="mp-card" onClick={onClick} style={{ cursor: 'pointer' }}>
      <div className="mp-card-header">
        <span className="mp-card-name">{pkg.name}</span>
        <span className={`mp-card-type mp-card-type--${pkg.type}`}>
          {TYPE_LABELS[pkg.type] ?? pkg.type}
        </span>
        {(pkg as unknown as Record<string, unknown>)['is_verified'] ? <span className="mp-card-verified" title="Verified">&#x2713;</span> : null}
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
      {onExport && (
        <button onClick={e => { e.stopPropagation(); onExport(); }}
          style={{ marginTop: 8, padding: '4px 12px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-muted)', fontSize: '.72rem', cursor: 'pointer' }}>
          Export JSON
        </button>
      )}
    </div>
  );
}

// ── Package Detail Modal ──

function PackageDetailModal({ pkg, onClose }: { pkg: MarketplacePackage; onClose: () => void }) {
  const [installing, setInstalling] = useState(false);
  const [installResult, setInstallResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [starValue, setStarValue] = useState(0);
  const [reviewText, setReviewText] = useState('');
  const [submittingRating, setSubmittingRating] = useState(false);
  const [ratingResult, setRatingResult] = useState<string | null>(null);

  const handleInstall = useCallback(async () => {
    setInstalling(true);
    try {
      await hubApi.marketplace.install(pkg.slug);
      setInstallResult({ ok: true, message: 'Installed successfully' });
    } catch (err) {
      setInstallResult({ ok: false, message: err instanceof Error ? err.message : 'Install failed' });
    } finally { setInstalling(false); }
  }, [pkg.slug]);

  const handleRate = useCallback(async () => {
    if (starValue < 1) return;
    setSubmittingRating(true);
    try {
      await hubApi.marketplace.rate(pkg.slug, { rating: starValue, review: reviewText || undefined });
      setRatingResult('Rating submitted');
      setStarValue(0); setReviewText('');
    } catch (err) {
      setRatingResult(err instanceof Error ? err.message : 'Rating failed');
    } finally { setSubmittingRating(false); }
  }, [pkg.slug, starValue, reviewText]);

  return (
    <div className="mp-modal-overlay" onClick={onClose}>
      <div className="mp-modal" onClick={e => e.stopPropagation()}>
        <div className="mp-modal-header">
          <h3 className="mp-modal-title">{pkg.name}</h3>
          <button className="mp-modal-close" onClick={onClose}>&times;</button>
        </div>
        <div className="mp-modal-meta">
          <span className={`mp-card-type mp-card-type--${pkg.type}`}>{TYPE_LABELS[pkg.type] ?? pkg.type}</span>
          <span>by {pkg.author}</span>
          <span className="mp-card-stars">{renderStars(pkg.rating ?? 0)} ({(pkg.rating ?? 0).toFixed(1)})</span>
          <span>{pkg.install_count ?? 0} installs</span>
          {pkg.repo_url && <a href={pkg.repo_url} target="_blank" rel="noopener noreferrer">Repository</a>}
        </div>
        <div className="mp-modal-body">{pkg.full_description ?? pkg.description}</div>
        {pkg.tags?.length ? (
          <div className="mp-card-tags" style={{ marginBottom: 16 }}>
            {pkg.tags.map(t => <span key={t} className="mp-tag">{t}</span>)}
          </div>
        ) : null}
        <div className="mp-modal-actions">
          <button className={`mp-install-btn ${installResult?.ok ? 'installed' : ''}`}
            onClick={handleInstall} disabled={installing || installResult?.ok === true}>
            {installing ? 'Installing...' : installResult?.ok ? 'Installed' : 'Install'}
          </button>
          {installResult && <span className={`mp-install-msg ${installResult.ok ? 'success' : 'error'}`}>{installResult.message}</span>}
        </div>
        <div className="mp-rating-section">
          <h4>Rate this package</h4>
          <div className="mp-star-row">
            {[1, 2, 3, 4, 5].map(n => (
              <button key={n} className={`mp-star-btn ${n <= starValue ? 'filled' : 'empty'}`}
                onClick={() => setStarValue(n)}>{n <= starValue ? '\u2605' : '\u2606'}</button>
            ))}
          </div>
          <textarea className="mp-review-input" placeholder="Optional review..." value={reviewText}
            onChange={e => setReviewText(e.target.value)} rows={2} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button className="mp-rate-btn" onClick={handleRate} disabled={submittingRating || starValue < 1}>
              {submittingRating ? 'Submitting...' : 'Submit Rating'}
            </button>
            {ratingResult && <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{ratingResult}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Package Browser (tools + servers) ──

function PackageBrowser({ typeFilter }: { typeFilter: string }) {
  const [packages, setPackages] = useState<MarketplacePackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('popular');
  const [selectedPkg, setSelectedPkg] = useState<MarketplacePackage | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [importJson, setImportJson] = useState('');
  const [importResult, setImportResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const fetchPackages = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    hubApi.marketplace.list({
      type: typeFilter || undefined,
      search: search || undefined,
      sort: sortBy,
    }).then(data => {
      if (!cancelled) setPackages(data.packages ?? []);
    }).catch(() => {
      if (!cancelled) setPackages([]);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [search, sortBy, typeFilter]);

  useEffect(() => { return fetchPackages(); }, [fetchPackages]);

  const handleSelect = useCallback(async (pkg: MarketplacePackage) => {
    try {
      const detail = await hubApi.marketplace.detail(pkg.slug);
      setSelectedPkg((detail as { package: MarketplacePackage }).package ?? detail as unknown as MarketplacePackage);
    } catch {
      setSelectedPkg(pkg);
    }
  }, []);

  const handleExport = useCallback(async (pkg: MarketplacePackage) => {
    // Fetch full detail for complete export
    let fullPkg = pkg;
    try {
      const detail = await hubApi.marketplace.detail(pkg.slug);
      fullPkg = (detail as { package: MarketplacePackage }).package ?? pkg;
    } catch { /* use basic pkg */ }
    const exportData = { type: typeFilter, name: fullPkg.name, slug: (fullPkg as unknown as Record<string,string>).slug, description: fullPkg.description, tags: fullPkg.tags, author: fullPkg.author, config: (fullPkg as unknown as Record<string,unknown>).config || (fullPkg as unknown as Record<string,unknown>).install_config || {}, repository_url: (fullPkg as unknown as Record<string,string>).repo_url || (fullPkg as unknown as Record<string,string>).repository_url };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${(fullPkg as unknown as Record<string,string>).slug || fullPkg.name}.json`; a.click();
    URL.revokeObjectURL(url);
  }, [typeFilter]);

  const handleImport = useCallback(async () => {
    if (!importJson.trim()) return;
    try {
      const parsed = JSON.parse(importJson);
      if (!parsed.type) parsed.type = typeFilter;
      const res = await fetch('/api/v1/forge/marketplace/import', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed),
      });
      if (!res.ok) { const e = await res.json(); throw new Error((e as Record<string,string>).error || 'Failed'); }
      setImportResult({ ok: true, msg: 'Imported successfully' });
      setImportJson(''); setShowImport(false); fetchPackages();
    } catch (err) {
      setImportResult({ ok: false, msg: err instanceof Error ? err.message : 'Import failed' });
    }
  }, [importJson, typeFilter, fetchPackages]);

  const handleFileImport = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setImportJson(reader.result as string);
    reader.readAsText(file);
  }, []);

  const typeLabel = typeFilter === 'tool_bundle' ? 'Tool Bundle' : 'MCP Server';

  return (
    <div>
      <div className="mp-toolbar">
        <input type="text" className="mp-search" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} />
        <select className="mp-filter-select" value={sortBy} onChange={e => setSortBy(e.target.value as SortOption)}>
          <option value="popular">Most Popular</option>
          <option value="rating">Highest Rated</option>
          <option value="recent">Most Recent</option>
        </select>
        <span className="mp-result-count">{loading ? 'Loading...' : `${packages.length} packages`}</span>
        <button onClick={() => setShowImport(!showImport)}
          style={{ marginLeft: 'auto', padding: '6px 14px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', fontSize: '.8rem', cursor: 'pointer' }}>
          {showImport ? 'Cancel' : `Import ${typeLabel}`}
        </button>
      </div>

      {showImport && (
        <div style={{ padding: '14px', margin: '0 0 14px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }}>
          <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
            <input type="file" accept=".json" onChange={handleFileImport} style={{ fontSize: '.8rem', color: 'var(--text)' }} />
            <a href="https://askalf.org/marketplace" target="_blank" rel="noopener noreferrer"
              style={{ fontSize: '.78rem', color: '#a78bfa', alignSelf: 'center' }}>Browse marketplace</a>
          </div>
          <textarea value={importJson} onChange={e => setImportJson(e.target.value)}
            placeholder={`Paste ${typeLabel} JSON here...`}
            rows={4} style={{ width: '100%', padding: '8px 12px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', fontSize: '.8rem', fontFamily: 'monospace', resize: 'vertical' }} />
          <div style={{ display: 'flex', gap: 10, marginTop: 8, alignItems: 'center' }}>
            <button onClick={handleImport} disabled={!importJson.trim()}
              style={{ padding: '6px 16px', background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: '.82rem', cursor: 'pointer' }}>Import</button>
            {importResult && <span style={{ fontSize: '.78rem', color: importResult.ok ? '#10b981' : '#ef4444' }}>{importResult.msg}</span>}
          </div>
        </div>
      )}

      <div className="mp-content">
        {loading ? (
          <div className="mp-loading">Loading...</div>
        ) : packages.length === 0 ? (
          <div className="mp-empty">No packages found.</div>
        ) : (
          <div className="mp-grid">
            {packages.map(pkg => (
              <PackageCard key={pkg.slug} pkg={pkg} onClick={() => handleSelect(pkg)} onExport={() => handleExport(pkg)} />
            ))}
          </div>
        )}
      </div>
      {selectedPkg && <PackageDetailModal pkg={selectedPkg} onClose={() => setSelectedPkg(null)} />}
    </div>
  );
}

// ── Submit Package Form (removed — import is now inline on each tab) ──
/*
function _SubmitPackage() {
  const [importJson, setImportJson] = useState('');
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const handleImport = useCallback(async () => {
    if (!importJson.trim()) return;
    setImporting(true);
    try {
      const parsed = JSON.parse(importJson.trim());
      const res = await fetch('/api/v1/forge/marketplace/import', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Import failed' }));
        throw new Error((err as Record<string, string>).error || 'Import failed');
      }
      const data = await res.json() as Record<string, unknown>;
      setResult({ ok: true, message: data.message as string || 'Imported successfully' });
      setImportJson('');
    } catch (err) {
      setResult({ ok: false, message: err instanceof Error ? err.message : 'Import failed — check JSON format' });
    } finally { setImporting(false); }
  }, [importJson]);

  const handleFileImport = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setImportJson(reader.result as string);
    reader.readAsText(file);
  }, []);

  return (
    <div style={{ padding: '1.5rem', maxWidth: 600 }}>
      <h3 style={{ margin: '0 0 4px', fontSize: '1rem', fontWeight: 700, color: 'var(--text)' }}>
        Community Marketplace
      </h3>
      <p style={{ margin: '0 0 16px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
        Browse and download templates, tool bundles, and MCP servers from the community. Import them here.
      </p>

      <a href="https://askalf.org/marketplace" target="_blank" rel="noopener noreferrer"
        style={{ display: 'inline-block', padding: '10px 20px', background: '#7c3aed', color: '#fff', borderRadius: 8, fontWeight: 600, fontSize: '0.85rem', textDecoration: 'none', marginBottom: 20 }}>
        Browse Marketplace ↗
      </a>

      <h4 style={{ margin: '16px 0 8px', fontSize: '0.9rem', fontWeight: 600, color: 'var(--text)' }}>Import</h4>
      <p style={{ margin: '0 0 12px', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
        Paste JSON or upload a file downloaded from the marketplace.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <input type="file" accept=".json" onChange={handleFileImport}
          style={{ padding: '10px 14px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', fontSize: '0.85rem' }} />

        <textarea value={importJson} onChange={e => setImportJson(e.target.value)} placeholder='Paste JSON here, e.g.: {"type":"worker_template","name":"My Worker","system_prompt":"You are...","category":"operations","tools":["web_search"]}'
          rows={6} style={{ padding: '10px 14px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', fontSize: '0.82rem', resize: 'vertical', fontFamily: 'monospace' }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={handleImport} disabled={importing || !importJson.trim()}
            style={{ padding: '8px 20px', background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer' }}>
            {importing ? 'Importing...' : 'Import'}
          </button>
          {result && <span style={{ fontSize: '0.82rem', color: result.ok ? '#10b981' : '#ef4444' }}>{result.message}</span>}
        </div>

        <p style={{ margin: '16px 0 0', fontSize: '0.75rem', color: 'var(--text-muted)', opacity: 0.7 }}>
          Want to share your own templates? <a href="https://askalf.org/marketplace" target="_blank" rel="noopener noreferrer" style={{ color: '#a78bfa' }}>Submit on askalf.org</a> — all submissions go through AI security review.
        </p>
      </div>
    </div>
  );
}
*/

/*

const COMMUNITY_CATEGORIES: Record<string, string> = {
  personal: 'Personal', content: 'Content', marketing: 'Marketing', support: 'Support',
  ecommerce: 'E-Commerce', finance: 'Finance', operations: 'Operations', hr: 'People & HR',
  legal: 'Legal', research: 'Research', analyze: 'Analyze', automate: 'Automate',
  monitor: 'Monitor', build: 'Build', dev: 'Development', security: 'Security',
};

function CommunitySkillCard({ skill, onClick }: { skill: CommunitySkill; onClick: () => void }) {
  return (
    <button className="mp-card" onClick={onClick}>
      <div className="mp-card-header">
        <span className="mp-card-name">
          {skill.icon ? `${skill.icon} ` : ''}{skill.name}
        </span>
        <span className="mp-card-type mp-card-type--skill_template">
          {COMMUNITY_CATEGORIES[skill.category] ?? skill.category}
        </span>
      </div>
      {skill.featured && (
        <span className="mp-community-featured-badge">Featured</span>
      )}
      <div className="mp-card-desc">{skill.description}</div>
      <div className="mp-card-meta">
        <span className="mp-card-author">{skill.author_name}</span>
        <span className="mp-card-stars">{renderStars(skill.avg_rating)} ({skill.avg_rating})</span>
        <span className="mp-card-installs">{skill.downloads} installs</span>
      </div>
      {skill.tags && skill.tags.length > 0 && (
        <div className="mp-card-tags">
          {skill.tags.slice(0, 5).map(t => (
            <span key={t} className="mp-tag">{t}</span>
          ))}
        </div>
      )}
    </button>
  );
}

// ── Community Skill Detail Modal ──

function CommunitySkillDetailModal({ skill, onClose, onInstalled }: {
  skill: CommunitySkill;
  onClose: () => void;
  onInstalled: () => void;
}) {
  const [installing, setInstalling] = useState(false);
  const [installResult, setInstallResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [starValue, setStarValue] = useState(0);
  const [submittingRating, setSubmittingRating] = useState(false);
  const [ratingResult, setRatingResult] = useState<string | null>(null);

  const handleInstall = useCallback(async () => {
    setInstalling(true);
    try {
      await hubApi.communitySkills.install(skill.id);
      setInstallResult({ ok: true, message: `Installed "${skill.name}" successfully` });
      onInstalled();
    } catch (err) {
      setInstallResult({ ok: false, message: err instanceof Error ? err.message : 'Install failed' });
    } finally { setInstalling(false); }
  }, [skill.id, skill.name, onInstalled]);

  const handleRate = useCallback(async () => {
    if (starValue < 1) return;
    setSubmittingRating(true);
    try {
      await hubApi.communitySkills.rate(skill.id, starValue);
      setRatingResult('Rating submitted — thank you!');
      setStarValue(0);
    } catch (err) {
      setRatingResult(err instanceof Error ? err.message : 'Rating failed');
    } finally { setSubmittingRating(false); }
  }, [skill.id, starValue]);

  return (
    <div className="mp-modal-overlay" onClick={onClose}>
      <div className="mp-modal" onClick={e => e.stopPropagation()}>
        <div className="mp-modal-header">
          <h3 className="mp-modal-title">
            {skill.icon ? `${skill.icon} ` : ''}{skill.name}
            {skill.featured && <span className="mp-community-featured-badge" style={{ marginLeft: 10, fontSize: 11 }}>Featured</span>}
          </h3>
          <button className="mp-modal-close" onClick={onClose}>&times;</button>
        </div>

        <div className="mp-modal-meta">
          <span className="mp-card-type mp-card-type--skill_template">
            {COMMUNITY_CATEGORIES[skill.category] ?? skill.category}
          </span>
          <span>by {skill.author_name}</span>
          <span className="mp-card-stars">{renderStars(skill.avg_rating)} ({skill.avg_rating})</span>
          <span>{skill.rating_count} ratings</span>
          <span>{skill.downloads} installs</span>
        </div>

        <div className="mp-modal-body">{skill.description}</div>

        {skill.required_tools && skill.required_tools.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Required tools: </span>
            <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{skill.required_tools.join(', ')}</span>
          </div>
        )}

        {skill.tags?.length ? (
          <div className="mp-card-tags" style={{ marginBottom: 16 }}>
            {skill.tags.map(t => <span key={t} className="mp-tag">{t}</span>)}
          </div>
        ) : null}

        <div className="mp-modal-actions">
          <button className={`mp-install-btn ${installResult?.ok ? 'installed' : ''}`}
            onClick={handleInstall} disabled={installing || installResult?.ok === true}>
            {installing ? 'Installing...' : installResult?.ok ? 'Installed' : 'Install to My Library'}
          </button>
          {installResult && <span className={`mp-install-msg ${installResult.ok ? 'success' : 'error'}`}>{installResult.message}</span>}
        </div>

        <div className="mp-rating-section">
          <h4>Rate this skill</h4>
          <div className="mp-star-row">
            {[1, 2, 3, 4, 5].map(n => (
              <button key={n} className={`mp-star-btn ${n <= starValue ? 'filled' : 'empty'}`}
                onClick={() => setStarValue(n)}>{n <= starValue ? '\u2605' : '\u2606'}</button>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button className="mp-rate-btn" onClick={handleRate} disabled={submittingRating || starValue < 1}>
              {submittingRating ? 'Submitting...' : 'Submit Rating'}
            </button>
            {ratingResult && <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{ratingResult}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Community Skills Browser ──

function CommunitySkillsBrowser() {
  const [skills, setSkills] = useState<CommunitySkill[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('popular');
  const [category, setCategory] = useState('');
  const [selectedSkill, setSelectedSkill] = useState<CommunitySkill | null>(null);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 30;

  const fetchSkills = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    hubApi.communitySkills.list({
      search: search || undefined,
      sort: sortBy,
      category: category || undefined,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }).then(data => {
      if (!cancelled) {
        setSkills(data.skills ?? []);
        setTotal(data.total ?? 0);
      }
    }).catch(() => {
      if (!cancelled) { setSkills([]); setTotal(0); }
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [search, sortBy, category, page]);

  useEffect(() => {
    return fetchSkills();
  }, [fetchSkills]);

  // Reset page when filters change
  useEffect(() => {
    setPage(0);
  }, [search, sortBy, category]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div>
      <div className="mp-toolbar">
        <input type="text" className="mp-search" placeholder="Search community skills..."
          value={search} onChange={e => setSearch(e.target.value)} />
        <select className="mp-filter-select" value={category} onChange={e => setCategory(e.target.value)}>
          <option value="">All Categories</option>
          {Object.entries(COMMUNITY_CATEGORIES).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select className="mp-filter-select" value={sortBy} onChange={e => setSortBy(e.target.value as SortOption)}>
          <option value="popular">Most Popular</option>
          <option value="rating">Highest Rated</option>
          <option value="recent">Most Recent</option>
        </select>
        <span className="mp-result-count">{loading ? 'Loading...' : `${total} community skills`}</span>
      </div>

      <div className="mp-content">
        {loading ? (
          <div className="mp-loading">Loading community skills...</div>
        ) : skills.length === 0 ? (
          <div className="mp-empty">
            No community skills found.{search && ' Try a different search.'}{category && ' Try clearing the category filter.'}
          </div>
        ) : (
          <>
            <div className="mp-grid">
              {skills.map(skill => (
                <CommunitySkillCard key={skill.id} skill={skill} onClick={() => setSelectedSkill(skill)} />
              ))}
            </div>
            {totalPages > 1 && (
              <div className="mp-community-pagination">
                <button className="mp-community-page-btn" disabled={page === 0}
                  onClick={() => setPage(p => p - 1)}>Previous</button>
                <span className="mp-community-page-info">Page {page + 1} of {totalPages}</span>
                <button className="mp-community-page-btn" disabled={page >= totalPages - 1}
                  onClick={() => setPage(p => p + 1)}>Next</button>
              </div>
            )}
          </>
        )}
      </div>

      {selectedSkill && (
        <CommunitySkillDetailModal
          skill={selectedSkill}
          onClose={() => setSelectedSkill(null)}
          onInstalled={fetchSkills}
        />
      )}
    </div>
  );
}
*/

// ── Templates Section ──

function TemplatesSection() {
  return <TemplatesTab />;
}

// ── Main Marketplace ──

export default function MarketplaceTab() {
  const [section, setSection] = useState<MarketSection>('templates');

  return (
    <div className="ud-composite-tab">
      <TabBar
        tabs={[
          { key: 'templates', label: 'Worker Templates' },
          { key: 'tools', label: 'Tool Bundles' },
          { key: 'servers', label: 'MCP Servers' },
        ]}
        active={section}
        onChange={k => setSection(k as MarketSection)}
        className="ud-sub-tabs"
        ariaLabel="Marketplace sections"
      />
      <div className="ud-sub-content">
        <Suspense fallback={<div className="mp-loading">Loading...</div>}>
          {section === 'templates' && <TemplatesSection />}
          {section === 'tools' && <PackageBrowser typeFilter="tool_bundle" />}
          {section === 'servers' && <PackageBrowser typeFilter="mcp_server" />}
        </Suspense>
      </div>
    </div>
  );
}
