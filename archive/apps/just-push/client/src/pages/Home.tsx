import { useEffect } from 'react';
import { useBranchStore } from '../stores/branches';
import BranchCard from '../components/BranchCard';
import EmptyState from '../components/EmptyState';

const STATUS_PRIORITY: Record<string, number> = {
  pending_review: 0,
  reviewed: 1,
  approved: 2,
  rejected: 3,
  merged: 4,
};

export default function Home() {
  const branches = useBranchStore((s) => s.branches);
  const loading = useBranchStore((s) => s.loading);
  const fetchBranches = useBranchStore((s) => s.fetchBranches);

  useEffect(() => {
    fetchBranches();
    const interval = setInterval(fetchBranches, 30000);
    return () => clearInterval(interval);
  }, [fetchBranches]);

  const sorted = [...branches].sort((a, b) => {
    const pa = STATUS_PRIORITY[a.review_status || 'pending_review'] ?? 5;
    const pb = STATUS_PRIORITY[b.review_status || 'pending_review'] ?? 5;
    if (pa !== pb) return pa - pb;
    // Newer first
    const da = a.last_date ? new Date(a.last_date).getTime() : 0;
    const db = b.last_date ? new Date(b.last_date).getTime() : 0;
    return db - da;
  });

  const needsAttention = branches.filter(
    (b) => b.review_status !== 'merged',
  ).length;

  if (loading && branches.length === 0) {
    return (
      <div className="jp-home">
        <div className="jp-home-loading">Loading branches...</div>
      </div>
    );
  }

  if (branches.length === 0) {
    return (
      <div className="jp-home">
        <EmptyState />
      </div>
    );
  }

  return (
    <div className="jp-home">
      <div className="jp-home-summary">
        {needsAttention > 0 ? (
          <p className="jp-home-count">
            <strong>{needsAttention}</strong> branch{needsAttention !== 1 ? 'es' : ''} need{needsAttention === 1 ? 's' : ''} attention
          </p>
        ) : (
          <p className="jp-home-count">All branches are merged. Nice work!</p>
        )}
      </div>

      <div className="jp-card-grid">
        {sorted.map((branch) => (
          <BranchCard key={branch.name} branch={branch} />
        ))}
      </div>
    </div>
  );
}
