import { useState, useMemo } from 'react';
import { useGitSpaceStore, type ReviewStatus } from '../../stores/git-space';

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const BADGE_CONFIG: Record<string, { label: string; className: string }> = {
  pending_review: { label: 'Needs Review', className: 'cr-badge--pending' },
  reviewed: { label: 'Reviewed', className: 'cr-badge--reviewed' },
  approved: { label: 'Approved', className: 'cr-badge--approved' },
  rejected: { label: 'Changes Requested', className: 'cr-badge--rejected' },
  merged: { label: 'Merged', className: 'cr-badge--merged' },
};

type SortMode = 'recent' | 'commits' | 'files';
type FilterMode = 'all' | 'pending_review' | 'reviewed' | 'approved' | 'rejected';

function StatusBadge({ status }: { status: ReviewStatus }) {
  if (!status) return <span className="cr-badge cr-badge--pending">New</span>;
  const cfg = BADGE_CONFIG[status];
  if (!cfg) return null;
  return <span className={`cr-badge ${cfg.className}`}>{cfg.label}</span>;
}

export default function BranchList() {
  const branches = useGitSpaceStore((s) => s.branches);
  const branchesLoading = useGitSpaceStore((s) => s.branchesLoading);
  const selectedBranch = useGitSpaceStore((s) => s.selectedBranch);
  const setSelectedBranch = useGitSpaceStore((s) => s.setSelectedBranch);

  const [search, setSearch] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('recent');
  const [filterMode, setFilterMode] = useState<FilterMode>('all');

  const filteredBranches = useMemo(() => {
    let list = [...branches];

    // Filter by status
    if (filterMode !== 'all') {
      list = list.filter(b => {
        if (filterMode === 'pending_review') return !b.review_status || b.review_status === 'pending_review';
        return b.review_status === filterMode;
      });
    }

    // Filter by search text
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(b =>
        b.name.toLowerCase().includes(q) ||
        b.agent_name.toLowerCase().includes(q) ||
        b.agent_slug.toLowerCase().includes(q),
      );
    }

    // Sort
    if (sortMode === 'recent') {
      list.sort((a, b) => {
        const dateA = a.last_date ? new Date(a.last_date).getTime() : 0;
        const dateB = b.last_date ? new Date(b.last_date).getTime() : 0;
        return dateB - dateA;
      });
    } else if (sortMode === 'commits') {
      list.sort((a, b) => b.commits - a.commits);
    } else if (sortMode === 'files') {
      list.sort((a, b) => b.files_changed - a.files_changed);
    }

    return list;
  }, [branches, search, sortMode, filterMode]);

  if (branchesLoading && branches.length === 0) {
    return <div className="cr-sidebar-loading">Loading branches...</div>;
  }

  if (branches.length === 0) {
    return (
      <div className="cr-sidebar-empty">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.3">
          <path d="M6 3v12"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 01-9 9"/>
        </svg>
        <p>No agent branches</p>
        <span>Branches appear here when agents push code changes.</span>
      </div>
    );
  }

  return (
    <div className="cr-branch-list">
      {/* Search */}
      <div className="cr-branch-search">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search branches..."
        />
      </div>

      {/* Filter + Sort row */}
      <div className="cr-branch-controls">
        <select
          value={filterMode}
          onChange={(e) => setFilterMode(e.target.value as FilterMode)}
          className="cr-branch-select"
        >
          <option value="all">All ({branches.length})</option>
          <option value="pending_review">Needs Review</option>
          <option value="reviewed">Reviewed</option>
          <option value="approved">Approved</option>
          <option value="rejected">Changes Requested</option>
        </select>
        <select
          value={sortMode}
          onChange={(e) => setSortMode(e.target.value as SortMode)}
          className="cr-branch-select"
        >
          <option value="recent">Most Recent</option>
          <option value="commits">Most Commits</option>
          <option value="files">Most Files</option>
        </select>
      </div>

      {/* Branch count */}
      <div className="cr-branch-count">
        {filteredBranches.length} branch{filteredBranches.length !== 1 ? 'es' : ''}
        {filteredBranches.length !== branches.length && ` (of ${branches.length})`}
      </div>

      {/* Branch cards */}
      {filteredBranches.length === 0 && (
        <div className="cr-branch-no-results">No matching branches</div>
      )}
      {filteredBranches.map((branch) => {
        const shortName = branch.name.replace(/^agent\//, '');
        const isSelected = selectedBranch === branch.name;

        return (
          <button
            key={branch.name}
            className={`cr-branch-card ${isSelected ? 'selected' : ''}`}
            onClick={() => setSelectedBranch(branch.name)}
          >
            <div className="cr-branch-name">
              <StatusBadge status={branch.review_status} />
              <span className="cr-branch-name-text">{shortName}</span>
            </div>
            <div className="cr-branch-agent">{branch.agent_name}</div>
            <div className="cr-branch-meta">
              <span>{branch.commits} commit{branch.commits !== 1 ? 's' : ''}</span>
              <span>{branch.files_changed} file{branch.files_changed !== 1 ? 's' : ''}</span>
              {branch.last_date && <span>{timeAgo(branch.last_date)}</span>}
            </div>
          </button>
        );
      })}
    </div>
  );
}
