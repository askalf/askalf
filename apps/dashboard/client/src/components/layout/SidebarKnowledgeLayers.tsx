import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../../stores/auth';
import {
  memoryApi, TIER_INFO,
  type MemoryTier, type MemoryStats, type Shard, type Episode, type Fact, type WorkingContext,
  lifecycleBadgeClass, formatDateShort,
} from '../../hooks/useMemoryApi';

type TierItem = { id: string; label: string; sub: string; badge?: string; badgeClass?: string };

export default function SidebarKnowledgeLayers() {
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';

  const [expanded, setExpanded] = useState(false);
  const [activeTier, setActiveTier] = useState<MemoryTier>('procedural');
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [items, setItems] = useState<TierItem[]>([]);
  const [loading, setLoading] = useState(false);

  // Fetch stats on mount
  useEffect(() => {
    memoryApi.getStats().then(setStats).catch(() => {});
  }, []);

  // Fetch top 3 items when tier changes and expanded
  useEffect(() => {
    if (!expanded) return;
    setLoading(true);
    const fetchItems = async () => {
      try {
        let mapped: TierItem[] = [];
        switch (activeTier) {
          case 'procedural': {
            const data = await memoryApi.getShards('all', 3, 0);
            mapped = (data.shards || []).map((s: Shard) => ({
              id: s.id,
              label: s.name,
              sub: `${s.confidence.toFixed(0)}% conf`,
              badge: s.lifecycle,
              badgeClass: lifecycleBadgeClass(s.lifecycle),
            }));
            break;
          }
          case 'episodic': {
            const data = await memoryApi.getEpisodes(3, 0);
            mapped = (data.episodes || []).map((e: Episode) => ({
              id: e.id,
              label: e.summary.slice(0, 60) + (e.summary.length > 60 ? '...' : ''),
              sub: formatDateShort(e.timestamp),
              badge: e.valence,
              badgeClass: e.valence === 'positive' ? 'badge-success' : e.valence === 'negative' ? 'badge-warning' : 'badge-blue',
            }));
            break;
          }
          case 'semantic': {
            const data = await memoryApi.getFacts(3, 0);
            mapped = (data.facts || []).map((f: Fact) => ({
              id: f.id,
              label: f.statement.slice(0, 60) + (f.statement.length > 60 ? '...' : ''),
              sub: f.category,
              badge: `${(f.confidence * 100).toFixed(0)}%`,
              badgeClass: f.confidence >= 0.8 ? 'badge-success' : 'badge-purple',
            }));
            break;
          }
          case 'working': {
            const data = await memoryApi.getContexts(3, 0);
            mapped = (data.contexts || []).map((c: WorkingContext) => ({
              id: c.id,
              label: c.rawContentPreview?.slice(0, 60) || c.contentType,
              sub: `${c.compressionRatio.toFixed(1)}x compression`,
              badge: c.status,
              badgeClass: c.status === 'promoted' ? 'badge-success' : c.status === 'liquidated' ? 'badge-purple' : 'badge-blue',
            }));
            break;
          }
        }
        setItems(mapped);
      } catch {
        setItems([]);
      } finally {
        setLoading(false);
      }
    };
    fetchItems();
  }, [activeTier, expanded]);

  const totalCount = stats
    ? stats.shards.total + stats.episodes + stats.facts + stats.contexts
    : 0;

  return (
    <div className="sb-widget">
      <button
        className="sb-widget-header"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" />
          <path d="M8 12h8M12 8v8" />
        </svg>
        <span>Knowledge Layers</span>
        {totalCount > 0 && <span className="sb-widget-badge">{totalCount}</span>}
        <svg
          className={`sb-widget-chevron ${expanded ? 'expanded' : ''}`}
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {expanded && (
        <div className="sb-widget-content">
          {/* Tier tabs */}
          <div className="sb-knowledge-tiers">
            {(Object.keys(TIER_INFO) as MemoryTier[]).map((tier) => (
              <button
                key={tier}
                className={`sb-tier-btn ${activeTier === tier ? 'active' : ''}`}
                onClick={() => setActiveTier(tier)}
                title={TIER_INFO[tier].name}
              >
                {TIER_INFO[tier].icon}
              </button>
            ))}
          </div>

          {/* Stats summary */}
          {stats && (
            <div className="sb-knowledge-stats">
              <span>{stats.shards.promoted} shards</span>
              <span className="sb-dot">&middot;</span>
              <span>{stats.episodes} episodes</span>
              <span className="sb-dot">&middot;</span>
              <span>{stats.facts} facts</span>
              <span className="sb-dot">&middot;</span>
              <span>{stats.contexts} ctx</span>
            </div>
          )}

          {/* Item list */}
          <div className="sb-knowledge-items">
            {loading ? (
              <div className="sb-knowledge-loading">Loading...</div>
            ) : items.length === 0 ? (
              <div className="sb-knowledge-empty">No {TIER_INFO[activeTier].name.toLowerCase()} data yet</div>
            ) : (
              items.map((item) => (
                <div key={item.id} className="sb-knowledge-item">
                  <div className="sb-knowledge-item-label">{item.label}</div>
                  <div className="sb-knowledge-item-meta">
                    <span className="sb-knowledge-item-sub">{item.sub}</span>
                    {item.badge && (
                      <span className={`sb-knowledge-badge ${item.badgeClass || ''}`}>{item.badge}</span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* View all link */}
          {isAdmin && (
            <div className="sb-widget-footer">
              <Link to="/admin/memory">View all →</Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
