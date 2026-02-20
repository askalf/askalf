import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useBranchStore } from '../stores/branches';
import ActionButton from '../components/ActionButton';
import StatusPill from '../components/StatusPill';
import Expandable from '../components/Expandable';
import Celebration from '../components/Celebration';
import DiffViewer from '../components/DiffViewer';
import ReviewPanel from '../components/ReviewPanel';
import DeployPanel from '../components/DeployPanel';

function humanizeBranch(name: string): string {
  return name.replace(/^agent\//, '').replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function BranchDetail() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const [showDeploy, setShowDeploy] = useState(false);

  const branches = useBranchStore((s) => s.branches);
  const fetchBranches = useBranchStore((s) => s.fetchBranches);
  const selectBranch = useBranchStore((s) => s.selectBranch);
  const selectedBranch = useBranchStore((s) => s.selectedBranch);
  const diffText = useBranchStore((s) => s.diffText);
  const diffStats = useBranchStore((s) => s.diffStats);
  const diffFiles = useBranchStore((s) => s.diffFiles);
  const commits = useBranchStore((s) => s.commits);
  const diffLoading = useBranchStore((s) => s.diffLoading);
  const diffTruncated = useBranchStore((s) => s.diffTruncated);
  const merged = useBranchStore((s) => s.merged);
  const merging = useBranchStore((s) => s.merging);
  const mergeBranch = useBranchStore((s) => s.mergeBranch);
  const canMerge = useBranchStore((s) => s.canMerge);
  const reviewCompleted = useBranchStore((s) => s.reviewCompleted);

  const branchName = name ? decodeURIComponent(name) : '';
  const branch = branches.find((b) => b.name === branchName);

  useEffect(() => {
    if (branches.length === 0) fetchBranches();
  }, [branches.length, fetchBranches]);

  useEffect(() => {
    if (branchName && branchName !== selectedBranch) {
      selectBranch(branchName);
    }
  }, [branchName, selectedBranch, selectBranch]);

  if (!branch && branches.length > 0) {
    return (
      <div className="jp-detail">
        <div className="jp-detail-notfound">
          <p>Branch not found.</p>
          <button className="jp-btn jp-btn--secondary" onClick={() => navigate('/')}>Back to branches</button>
        </div>
      </div>
    );
  }

  if (!branch) {
    return <div className="jp-detail"><div className="jp-detail-loading">Loading...</div></div>;
  }

  const handleAction = async () => {
    if (merged) {
      setShowDeploy(true);
      return;
    }
    if (branch.review_status === 'approved' || (reviewCompleted && canMerge)) {
      await mergeBranch();
      return;
    }
    // For pending_review or reviewed, scroll to review section
    const el = document.getElementById('jp-review-section');
    if (el) el.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="jp-detail">
      {/* Back nav */}
      <button className="jp-detail-back" onClick={() => navigate('/')}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
        All branches
      </button>

      {/* Summary header */}
      <div className="jp-detail-header">
        <div className="jp-detail-header-top">
          <h1 className="jp-detail-title">{humanizeBranch(branch.name)}</h1>
          <StatusPill status={merged ? 'merged' : branch.review_status} />
        </div>
        <p className="jp-detail-meta">
          by <strong>{branch.agent_name || branch.agent_slug}</strong>
          {branch.last_date && <span> · {timeAgo(branch.last_date)}</span>}
        </p>

        {/* Change stats bar */}
        {diffStats.files > 0 && (
          <div className="jp-detail-stats">
            <span className="jp-stat-files">{diffStats.files} file{diffStats.files !== 1 ? 's' : ''} changed</span>
            <span className="jp-stat-add">+{diffStats.additions}</span>
            <span className="jp-stat-del">-{diffStats.deletions}</span>
          </div>
        )}
      </div>

      {/* Celebration or Hero Action */}
      {merged ? (
        <>
          <Celebration />
          <div className="jp-detail-deploy-prompt">
            <p>Ready to deploy these changes?</p>
            <ActionButton status={branch.review_status} merged={true} onClick={() => setShowDeploy(true)} large />
          </div>
        </>
      ) : (
        <div className="jp-detail-hero">
          <ActionButton
            status={branch.review_status}
            onClick={handleAction}
            disabled={merging}
            large
          />
          {merging && <p className="jp-detail-merging">Merging...</p>}
        </div>
      )}

      {/* Expandable sections */}
      <div className="jp-detail-sections">
        {diffLoading ? (
          <div className="jp-detail-loading">Loading changes...</div>
        ) : (
          <>
            <Expandable title="What changed" badge={diffStats.files || undefined}>
              {diffText ? (
                <DiffViewer diff={diffText} truncated={diffTruncated} />
              ) : (
                <p className="jp-muted">No diff available.</p>
              )}
            </Expandable>

            <Expandable title="Commits" badge={commits.length || undefined}>
              {commits.length > 0 ? (
                <div className="jp-commit-list">
                  {commits.map((c) => (
                    <div key={c.hash} className="jp-commit">
                      <span className="jp-commit-hash">{c.hash.substring(0, 7)}</span>
                      <span className="jp-commit-msg">{c.subject}</span>
                      <span className="jp-commit-meta">{c.author} · {timeAgo(c.date)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="jp-muted">No commits.</p>
              )}
            </Expandable>

            <div id="jp-review-section">
              <Expandable title="AI Review">
                <ReviewPanel />
              </Expandable>
            </div>

            <Expandable title="Deploy">
              <DeployPanel diffFiles={diffFiles} />
            </Expandable>
          </>
        )}
      </div>

      {/* Deploy modal overlay */}
      {showDeploy && (
        <div className="jp-modal-overlay" onClick={() => setShowDeploy(false)}>
          <div className="jp-modal" onClick={(e) => e.stopPropagation()}>
            <DeployPanel diffFiles={diffFiles} onClose={() => setShowDeploy(false)} />
          </div>
        </div>
      )}
    </div>
  );
}
