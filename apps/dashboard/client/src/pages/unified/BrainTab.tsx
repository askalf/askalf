import { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import './BrainTab.css';

const MemoryBrowserTab = lazy(() => import('./MemoryBrowserTab'));
const KnowledgeTab = lazy(() => import('./KnowledgeTab'));

// ── Types ──

type SubTab = 'memory' | 'knowledge' | 'analytics';

interface FleetStats {
  total: number;
  semantic: number;
  episodic: number;
  procedural: number;
  recent24h?: number;
}

interface LeaderboardEntry {
  agentId: string;
  name?: string;
  memoryCount: number;
}

// ── BrainAnalytics sub-component ──

function BrainAnalytics() {
  const [stats, setStats] = useState<FleetStats | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [statsRes, lbRes] = await Promise.all([
        fetch('/api/v1/forge/fleet/stats', { credentials: 'include' }),
        fetch('/api/v1/admin/fleet/leaderboard', { credentials: 'include' }),
      ]);

      if (!statsRes.ok) throw new Error(`Stats request failed: ${statsRes.status}`);
      if (!lbRes.ok) throw new Error(`Leaderboard request failed: ${lbRes.status}`);

      const statsData = await statsRes.json();
      const lbData = await lbRes.json();

      const s = statsData.stats ?? statsData;
      setStats({
        total: s.total ?? 0,
        semantic: s.semantic ?? 0,
        episodic: s.episodic ?? 0,
        procedural: s.procedural ?? 0,
        recent24h: s.recent24h ?? s.recentCount ?? 0,
      });

      const entries: LeaderboardEntry[] = (Array.isArray(lbData) ? lbData : lbData.agents ?? [])
        .map((a: Record<string, unknown>) => ({
          agentId: (a.agentId ?? a.agent_id ?? a.id ?? 'unknown') as string,
          name: (a.name ?? a.agentId ?? a.agent_id ?? 'unknown') as string,
          memoryCount: (a.memoryCount ?? a.memory_count ?? 0) as number,
        }))
        .sort((a: LeaderboardEntry, b: LeaderboardEntry) => b.memoryCount - a.memoryCount)
        .slice(0, 10);

      setLeaderboard(entries);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return <div className="brain-loading">Loading analytics...</div>;
  }

  if (error) {
    return (
      <div className="brain-analytics-error">
        <p>{error}</p>
        <button className="brain-retry-btn" onClick={fetchData}>Retry</button>
      </div>
    );
  }

  if (!stats) return null;

  const growthRate = stats.recent24h ?? 0;
  const tierTotal = stats.semantic + stats.episodic + stats.procedural;
  const semanticPct = tierTotal > 0 ? (stats.semantic / tierTotal) * 100 : 0;
  const episodicPct = tierTotal > 0 ? (stats.episodic / tierTotal) * 100 : 0;
  const proceduralPct = tierTotal > 0 ? (stats.procedural / tierTotal) * 100 : 0;

  const maxMemoryCount = leaderboard.length > 0
    ? Math.max(...leaderboard.map((e) => e.memoryCount))
    : 1;

  return (
    <div className="brain-analytics">
      {/* Summary cards */}
      <div className="brain-analytics-cards">
        <div className="brain-card">
          <span className="brain-card-label">Total Memories</span>
          <span className="brain-card-value">{stats.total.toLocaleString()}</span>
        </div>
        <div className="brain-card">
          <span className="brain-card-label">Last 24h</span>
          <span className="brain-card-value brain-card-growth">
            +{growthRate.toLocaleString()}
          </span>
        </div>
        <div className="brain-card">
          <span className="brain-card-label">Semantic</span>
          <span className="brain-card-value">{stats.semantic.toLocaleString()}</span>
        </div>
        <div className="brain-card">
          <span className="brain-card-label">Episodic</span>
          <span className="brain-card-value">{stats.episodic.toLocaleString()}</span>
        </div>
        <div className="brain-card">
          <span className="brain-card-label">Procedural</span>
          <span className="brain-card-value">{stats.procedural.toLocaleString()}</span>
        </div>
      </div>

      {/* Tier breakdown bar */}
      <div className="brain-section">
        <h3 className="brain-section-title">Tier Breakdown</h3>
        <div className="brain-stacked-bar">
          {semanticPct > 0 && (
            <div
              className="brain-bar-segment brain-bar-semantic"
              style={{ width: `${semanticPct}%` }}
              title={`Semantic: ${stats.semantic.toLocaleString()} (${semanticPct.toFixed(1)}%)`}
            />
          )}
          {episodicPct > 0 && (
            <div
              className="brain-bar-segment brain-bar-episodic"
              style={{ width: `${episodicPct}%` }}
              title={`Episodic: ${stats.episodic.toLocaleString()} (${episodicPct.toFixed(1)}%)`}
            />
          )}
          {proceduralPct > 0 && (
            <div
              className="brain-bar-segment brain-bar-procedural"
              style={{ width: `${proceduralPct}%` }}
              title={`Procedural: ${stats.procedural.toLocaleString()} (${proceduralPct.toFixed(1)}%)`}
            />
          )}
        </div>
        <div className="brain-bar-legend">
          <span className="brain-legend-item"><span className="brain-legend-dot brain-bar-semantic" /> Semantic</span>
          <span className="brain-legend-item"><span className="brain-legend-dot brain-bar-episodic" /> Episodic</span>
          <span className="brain-legend-item"><span className="brain-legend-dot brain-bar-procedural" /> Procedural</span>
        </div>
      </div>

      {/* Top memory sources */}
      {leaderboard.length > 0 && (
        <div className="brain-section">
          <h3 className="brain-section-title">Top Memory Sources</h3>
          <div className="brain-leaderboard">
            {leaderboard.map((entry) => (
              <div key={entry.agentId} className="brain-lb-row">
                <span className="brain-lb-name" title={entry.agentId}>
                  {entry.name || entry.agentId}
                </span>
                <div className="brain-lb-bar-track">
                  <div
                    className="brain-lb-bar-fill"
                    style={{ width: `${(entry.memoryCount / maxMemoryCount) * 100}%` }}
                  />
                </div>
                <span className="brain-lb-count">{entry.memoryCount.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main BrainTab ──

export default function BrainTab() {
  const [subTab, setSubTab] = useState<SubTab>('memory');

  return (
    <div className="brain-container">
      <div className="brain-sub-tabs" role="tablist" aria-label="Brain sections">
        <button
          role="tab"
          aria-selected={subTab === 'memory'}
          className={`brain-sub-tab ${subTab === 'memory' ? 'active' : ''}`}
          onClick={() => setSubTab('memory')}
        >
          Memory
        </button>
        <button
          role="tab"
          aria-selected={subTab === 'knowledge'}
          className={`brain-sub-tab ${subTab === 'knowledge' ? 'active' : ''}`}
          onClick={() => setSubTab('knowledge')}
        >
          Knowledge
        </button>
        <button
          role="tab"
          aria-selected={subTab === 'analytics'}
          className={`brain-sub-tab ${subTab === 'analytics' ? 'active' : ''}`}
          onClick={() => setSubTab('analytics')}
        >
          Analytics
        </button>
      </div>
      <div className="brain-content">
        <Suspense fallback={<div className="brain-loading">Loading...</div>}>
          {subTab === 'memory' && <MemoryBrowserTab />}
          {subTab === 'knowledge' && <KnowledgeTab />}
          {subTab === 'analytics' && <BrainAnalytics />}
        </Suspense>
      </div>
    </div>
  );
}
