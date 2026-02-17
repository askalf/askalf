import { useCallback, useMemo, useState } from 'react';
import { useGitSpaceStore, type GitSpaceBranch } from '../../stores/git-space';
import { usePolling } from '../../hooks/usePolling';
import BranchList from '../git-space/BranchList';
import DiffPanel from '../git-space/DiffPanel';
import ReviewChatPanel from '../git-space/ReviewChatPanel';
import DeployModal from '../git-space/DeployModal';
import '../GitSpace.css';

type ViewMode = 'pipeline' | 'detail';

function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function PipelineStats({ branches }: { branches: GitSpaceBranch[] }) {
  const needsReview = branches.filter(b => !b.review_status || b.review_status === 'pending_review').length;
  const reviewed = branches.filter(b => b.review_status === 'reviewed').length;
  const approved = branches.filter(b => b.review_status === 'approved').length;
  const merged = branches.filter(b => b.review_status === 'merged').length;

  return (
    <div className="cr-pipeline-stats">
      <div className={`cr-pipeline-stat ${needsReview > 0 ? 'cr-pipeline-stat--alert' : ''}`}>
        <span className="cr-pipeline-stat-count">{needsReview}</span>
        <span className="cr-pipeline-stat-label">Awaiting Review</span>
      </div>
      <div className="cr-pipeline-arrow">
        <svg width="20" height="12" viewBox="0 0 20 12"><path d="M0 6h16m0 0l-4-4m4 4l-4 4" stroke="currentColor" strokeWidth="1.5" fill="none"/></svg>
      </div>
      <div className={`cr-pipeline-stat ${reviewed > 0 ? 'cr-pipeline-stat--info' : ''}`}>
        <span className="cr-pipeline-stat-count">{reviewed}</span>
        <span className="cr-pipeline-stat-label">Reviewed</span>
      </div>
      <div className="cr-pipeline-arrow">
        <svg width="20" height="12" viewBox="0 0 20 12"><path d="M0 6h16m0 0l-4-4m4 4l-4 4" stroke="currentColor" strokeWidth="1.5" fill="none"/></svg>
      </div>
      <div className={`cr-pipeline-stat ${approved > 0 ? 'cr-pipeline-stat--success' : ''}`}>
        <span className="cr-pipeline-stat-count">{approved}</span>
        <span className="cr-pipeline-stat-label">Approved</span>
      </div>
      <div className="cr-pipeline-arrow">
        <svg width="20" height="12" viewBox="0 0 20 12"><path d="M0 6h16m0 0l-4-4m4 4l-4 4" stroke="currentColor" strokeWidth="1.5" fill="none"/></svg>
      </div>
      <div className={`cr-pipeline-stat ${merged > 0 ? 'cr-pipeline-stat--merged' : ''}`}>
        <span className="cr-pipeline-stat-count">{merged}</span>
        <span className="cr-pipeline-stat-label">Merged</span>
      </div>
    </div>
  );
}

function PipelineView({ branches, onSelect }: { branches: GitSpaceBranch[]; onSelect: (branch: string) => void }) {
  const needsReview = branches.filter(b => !b.review_status || b.review_status === 'pending_review');
  const reviewed = branches.filter(b => b.review_status === 'reviewed');
  const approved = branches.filter(b => b.review_status === 'approved');
  const merged = branches.filter(b => b.review_status === 'merged');

  const renderCard = (branch: GitSpaceBranch) => (
    <button
      key={branch.name}
      className="cr-pipeline-card"
      onClick={() => onSelect(branch.name)}
    >
      <div className="cr-pipeline-card-agent">{branch.agent_slug}</div>
      <div className="cr-pipeline-card-name">{branch.name.replace('agent/', '')}</div>
      <div className="cr-pipeline-card-meta">
        <span>{branch.commits} commit{branch.commits !== 1 ? 's' : ''}</span>
        <span>{branch.files_changed} file{branch.files_changed !== 1 ? 's' : ''}</span>
      </div>
      {branch.last_date && (
        <div className="cr-pipeline-card-time">{formatTimeAgo(branch.last_date)}</div>
      )}
    </button>
  );

  return (
    <div className="cr-pipeline-board">
      <div className="cr-pipeline-column">
        <div className="cr-pipeline-column-header cr-pipeline-column--needs-review">
          <span className="cr-pipeline-column-dot" />
          Needs Review ({needsReview.length})
        </div>
        <div className="cr-pipeline-column-cards">
          {needsReview.length === 0 && <div className="cr-pipeline-empty">No branches waiting</div>}
          {needsReview.map(renderCard)}
        </div>
      </div>
      <div className="cr-pipeline-column">
        <div className="cr-pipeline-column-header cr-pipeline-column--reviewed">
          <span className="cr-pipeline-column-dot" />
          Reviewed ({reviewed.length})
        </div>
        <div className="cr-pipeline-column-cards">
          {reviewed.length === 0 && <div className="cr-pipeline-empty">None</div>}
          {reviewed.map(renderCard)}
        </div>
      </div>
      <div className="cr-pipeline-column">
        <div className="cr-pipeline-column-header cr-pipeline-column--approved">
          <span className="cr-pipeline-column-dot" />
          Approved ({approved.length})
        </div>
        <div className="cr-pipeline-column-cards">
          {approved.length === 0 && <div className="cr-pipeline-empty">None</div>}
          {approved.map(renderCard)}
        </div>
      </div>
      <div className="cr-pipeline-column">
        <div className="cr-pipeline-column-header cr-pipeline-column--merged">
          <span className="cr-pipeline-column-dot" />
          Merged ({merged.length})
        </div>
        <div className="cr-pipeline-column-cards">
          {merged.length === 0 && <div className="cr-pipeline-empty">None</div>}
          {merged.map(renderCard)}
        </div>
      </div>
    </div>
  );
}

export default function PushPanel() {
  const fetchBranches = useGitSpaceStore((s) => s.fetchBranches);
  const branches = useGitSpaceStore((s) => s.branches);
  const reviewOpen = useGitSpaceStore((s) => s.reviewOpen);
  const setSelectedBranch = useGitSpaceStore((s) => s.setSelectedBranch);
  const merged = useGitSpaceStore((s) => s.merged);
  const [viewMode, setViewMode] = useState<ViewMode>('pipeline');
  const [deployOpen, setDeployOpen] = useState(false);

  const poll = useCallback(() => {
    fetchBranches();
  }, [fetchBranches]);
  usePolling(poll, 30000);

  const handleBranchSelect = useCallback((branchName: string) => {
    setSelectedBranch(branchName);
    setViewMode('detail');
  }, [setSelectedBranch]);

  const showDeployPrompt = useMemo(() => {
    return merged && viewMode === 'detail';
  }, [merged, viewMode]);

  return (
    <div className={`cr-shell cr-shell--embedded ${reviewOpen ? 'cr-panel-open' : ''}`}>
      <header className="cr-header">
        <div className="cr-header-left">
          <h1>Push</h1>
          {branches.length > 0 && (
            <span className="cr-header-badge">{branches.length}</span>
          )}
        </div>
        <div className="cr-header-center">
          <PipelineStats branches={branches} />
        </div>
        <div className="cr-header-right">
          <div className="cr-view-toggle">
            <button
              className={`cr-view-btn ${viewMode === 'pipeline' ? 'active' : ''}`}
              onClick={() => setViewMode('pipeline')}
              aria-label="Pipeline view"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="5" height="14" rx="1" stroke="currentColor" strokeWidth="1.2"/><rect x="10" y="1" width="5" height="14" rx="1" stroke="currentColor" strokeWidth="1.2"/></svg>
              Pipeline
            </button>
            <button
              className={`cr-view-btn ${viewMode === 'detail' ? 'active' : ''}`}
              onClick={() => setViewMode('detail')}
              aria-label="Detail view"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="14" height="6" rx="1" stroke="currentColor" strokeWidth="1.2"/><rect x="1" y="9" width="14" height="6" rx="1" stroke="currentColor" strokeWidth="1.2"/></svg>
              Detail
            </button>
          </div>
          <button
            className="cr-btn cr-btn--deploy-quick"
            onClick={() => setDeployOpen(true)}
            aria-label="Quick Deploy"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
            Deploy
          </button>
        </div>
      </header>

      {viewMode === 'pipeline' ? (
        <div className="cr-pipeline-container">
          {branches.length === 0 ? (
            <div className="cr-pipeline-empty-state">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1"><circle cx="12" cy="12" r="3"/><path d="M12 3v6m0 6v6M3 12h6m6 0h6"/></svg>
              <h3>No agent branches</h3>
              <p>Agent branches will appear here when agents create code changes.</p>
            </div>
          ) : (
            <PipelineView branches={branches} onSelect={handleBranchSelect} />
          )}
        </div>
      ) : (
        <div className="cr-layout">
          <aside className="cr-sidebar">
            <BranchList />
          </aside>
          <main className="cr-main">
            <DiffPanel />
            {showDeployPrompt && (
              <div className="cr-merge-deploy-prompt">
                <div className="cr-merge-deploy-icon">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                </div>
                <div className="cr-merge-deploy-text">
                  <strong>Branch merged successfully.</strong> Deploy the affected services?
                </div>
                <button className="cr-btn cr-btn--primary" onClick={() => setDeployOpen(true)}>
                  Deploy Now
                </button>
              </div>
            )}
          </main>
        </div>
      )}

      <ReviewChatPanel />
      {deployOpen && <DeployModal onClose={() => setDeployOpen(false)} />}
    </div>
  );
}
