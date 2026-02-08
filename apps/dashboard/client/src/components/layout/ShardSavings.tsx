import { useEffect, useState } from 'react';
import { useAuthStore } from '../../stores/auth';
import { useChatStore } from '../../stores/chat';

const getApiUrl = () => {
  const host = window.location.hostname;
  if (host.includes('askalf.org')) return 'https://api.askalf.org';
  if (host === 'localhost' || host === '127.0.0.1') return 'http://localhost:3000';
  return '';
};

const API_BASE = getApiUrl();

interface ShardStats {
  shardHits: number;
  tokensSaved: number;
}

export default function ShardSavings() {
  const { user } = useAuthStore();
  const chatShardHits = useChatStore((s) => s.sessionStats.shardHits);
  const [stats, setStats] = useState<ShardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }

    const fetchStats = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/user/shard-stats`, {
          credentials: 'include',
        });
        if (res.ok) {
          const data = await res.json();
          setStats(data);
        }
      } catch {
        // Silently fail
      } finally {
        setLoading(false);
      }
    };

    fetchStats();

    // Refresh every 60 seconds
    const interval = setInterval(fetchStats, 60000);
    return () => clearInterval(interval);
  }, [user, chatShardHits]);

  // Don't render if no user
  if (!user) return null;

  // Use server stats only (refreshes every 60s, no double-counting)
  const totalHits = stats?.shardHits || 0;
  const totalTokens = stats?.tokensSaved || 0;

  const formatNumber = (n: number) => {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return n.toString();
  };

  if (loading) {
    return (
      <div className="shard-savings loading" title="Loading shard stats...">
        <svg className="shard-savings-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </svg>
        <span className="shard-savings-amount">--</span>
      </div>
    );
  }

  return (
    <div
      className="shard-savings"
      title={`This month: ${totalHits} free answers, ${totalTokens.toLocaleString()} tokens saved. Your cost trends DOWN over time.`}
    >
      <svg className="shard-savings-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
      </svg>
      <div className="shard-savings-stats">
        <span className="shard-savings-amount">{formatNumber(totalHits)}</span>
        <span className="shard-savings-label">hits</span>
      </div>
      <span className="shard-savings-divider">|</span>
      <div className="shard-savings-stats">
        <span className="shard-savings-amount">{formatNumber(totalTokens)}</span>
        <span className="shard-savings-label">saved</span>
      </div>
      {/* Down-arrow trend icon */}
      <svg className="shard-savings-trend" viewBox="0 0 16 16" fill="none" stroke="#10b981" strokeWidth="2" width="14" height="14">
        <path d="M8 3v10M4 9l4 4 4-4" />
      </svg>
    </div>
  );
}
