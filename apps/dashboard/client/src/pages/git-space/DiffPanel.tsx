import { useState, useMemo } from 'react';
import { useGitSpaceStore } from '../../stores/git-space';
import DiffViewer from './DiffViewer';
import DeployModal from './DeployModal';

// ============================================
// Workflow Steps
// ============================================

type WorkflowStep = 'review' | 'approve' | 'merge' | 'deploy';

const STEPS: { id: WorkflowStep; label: string; desc: string }[] = [
  { id: 'review', label: 'Review', desc: 'AI analyzes the code changes' },
  { id: 'approve', label: 'Approve', desc: 'Confirm changes are safe' },
  { id: 'merge', label: 'Merge', desc: 'Merge branch into main' },
  { id: 'deploy', label: 'Deploy', desc: 'Push changes to production' },
];

function WorkflowStepper({ currentStep, completedSteps }: { currentStep: WorkflowStep; completedSteps: Set<WorkflowStep> }) {
  return (
    <div className="cr-workflow-stepper">
      {STEPS.map((step, i) => {
        const isCompleted = completedSteps.has(step.id);
        const isCurrent = step.id === currentStep;
        const stepClass = isCompleted ? 'cr-step--done' : isCurrent ? 'cr-step--active' : 'cr-step--pending';

        return (
          <div key={step.id} className="cr-step-wrapper">
            <div className={`cr-step ${stepClass}`}>
              <div className="cr-step-indicator">
                {isCompleted ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                ) : (
                  <span>{i + 1}</span>
                )}
              </div>
              <div className="cr-step-text">
                <span className="cr-step-label">{step.label}</span>
                <span className="cr-step-desc">{step.desc}</span>
              </div>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`cr-step-connector ${isCompleted ? 'cr-step-connector--done' : ''}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ============================================
// File change summary
// ============================================

function ChangeSummary({ files, additions, deletions }: { files: number; additions: number; deletions: number }) {
  const total = additions + deletions;
  const addPct = total > 0 ? Math.round((additions / total) * 100) : 50;

  return (
    <div className="cr-change-summary">
      <div className="cr-change-bar">
        <div className="cr-change-bar-add" style={{ width: `${addPct}%` }} />
        <div className="cr-change-bar-del" style={{ width: `${100 - addPct}%` }} />
      </div>
      <div className="cr-change-legend">
        <span className="cr-change-stat cr-change-stat--files">{files} file{files !== 1 ? 's' : ''} changed</span>
        <span className="cr-change-stat cr-change-stat--add">+{additions} added</span>
        <span className="cr-change-stat cr-change-stat--del">-{deletions} removed</span>
      </div>
    </div>
  );
}

// ============================================
// Main DiffPanel
// ============================================

export default function DiffPanel() {
  const selectedBranch = useGitSpaceStore((s) => s.selectedBranch);
  const branches = useGitSpaceStore((s) => s.branches);
  const diffText = useGitSpaceStore((s) => s.diffText);
  const diffStats = useGitSpaceStore((s) => s.diffStats);
  const diffFiles = useGitSpaceStore((s) => s.diffFiles);
  const diffTruncated = useGitSpaceStore((s) => s.diffTruncated);
  const diffLoading = useGitSpaceStore((s) => s.diffLoading);
  const commits = useGitSpaceStore((s) => s.commits);
  const merged = useGitSpaceStore((s) => s.merged);
  const merging = useGitSpaceStore((s) => s.merging);
  const mergeResult = useGitSpaceStore((s) => s.mergeResult);
  const mergeBranch = useGitSpaceStore((s) => s.mergeBranch);
  const setReviewOpen = useGitSpaceStore((s) => s.setReviewOpen);
  const canMerge = useGitSpaceStore((s) => s.canMerge);
  const reviewCompleted = useGitSpaceStore((s) => s.reviewCompleted);
  const reviewLoading = useGitSpaceStore((s) => s.reviewLoading);
  const requestAiReview = useGitSpaceStore((s) => s.requestAiReview);
  const rejectBranch = useGitSpaceStore((s) => s.rejectBranch);
  const rejecting = useGitSpaceStore((s) => s.rejecting);

  const [showCommits, setShowCommits] = useState(false);
  const [showFiles, setShowFiles] = useState(true);
  const [showDeploy, setShowDeploy] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [rejectFeedback, setRejectFeedback] = useState('');

  // Determine workflow state
  const branchData = useMemo(() =>
    branches.find(b => b.name === selectedBranch),
    [branches, selectedBranch],
  );

  const { currentStep, completedSteps } = useMemo(() => {
    const completed = new Set<WorkflowStep>();
    let current: WorkflowStep = 'review';

    if (reviewCompleted || branchData?.review_status === 'reviewed' || branchData?.review_status === 'approved') {
      completed.add('review');
      current = 'approve';
    }
    if (canMerge || branchData?.review_status === 'approved') {
      completed.add('review');
      completed.add('approve');
      current = 'merge';
    }
    if (merged || branchData?.review_status === 'merged') {
      completed.add('review');
      completed.add('approve');
      completed.add('merge');
      current = 'deploy';
    }

    return { currentStep: current, completedSteps: completed };
  }, [reviewCompleted, canMerge, merged, branchData]);

  if (!selectedBranch) {
    return (
      <div className="cr-empty-state">
        <div className="cr-empty-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.4">
            <path d="M6 3v12"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/>
            <path d="M18 9a9 9 0 01-9 9"/>
          </svg>
        </div>
        <h3>Select a branch to review</h3>
        <p>Choose an agent branch from the sidebar or pipeline to view its changes and start the review process.</p>
      </div>
    );
  }

  if (diffLoading) {
    return (
      <div className="cr-loading">
        <div className="cr-loading-spinner" />
        Loading changes for {selectedBranch.replace('agent/', '')}...
      </div>
    );
  }

  const handleMerge = async () => {
    const ok = await mergeBranch();
    if (ok) {
      setShowDeploy(true);
    }
  };

  const handleReject = async () => {
    if (!rejectFeedback.trim()) return;
    await rejectBranch(rejectFeedback);
    setShowReject(false);
    setRejectFeedback('');
  };

  const shortBranch = selectedBranch.replace('agent/', '');

  return (
    <div className="cr-diff-panel">
      {/* Branch header with workflow stepper */}
      <div className="cr-diff-panel-header">
        <div className="cr-diff-header-top">
          <div className="cr-diff-branch-info">
            <div className="cr-diff-branch-name">{shortBranch}</div>
            {branchData && (
              <span className="cr-diff-branch-agent">by {branchData.agent_name}</span>
            )}
          </div>
          <ChangeSummary
            files={diffStats.files}
            additions={diffStats.additions}
            deletions={diffStats.deletions}
          />
        </div>
        <WorkflowStepper currentStep={currentStep} completedSteps={completedSteps} />
      </div>

      {/* Commits (collapsible) */}
      {commits.length > 0 && (
        <div className="cr-section">
          <button className="cr-section-toggle" onClick={() => setShowCommits(!showCommits)}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
              {showCommits
                ? <path d="M1 3l4 4 4-4" />
                : <path d="M3 1l4 4-4 4" />
              }
            </svg>
            {commits.length} commit{commits.length !== 1 ? 's' : ''}
          </button>
          {showCommits && (
            <div className="cr-commit-list">
              {commits.map((c) => (
                <div key={c.hash} className="cr-commit">
                  <code className="cr-commit-hash">{c.hash?.substring(0, 7)}</code>
                  <span className="cr-commit-subject">{c.subject}</span>
                  <span className="cr-commit-author">{c.author}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* File list (collapsible, default open) */}
      {diffFiles.length > 0 && (
        <div className="cr-section">
          <button className="cr-section-toggle" onClick={() => setShowFiles(!showFiles)}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
              {showFiles
                ? <path d="M1 3l4 4 4-4" />
                : <path d="M3 1l4 4-4 4" />
              }
            </svg>
            {diffFiles.length} changed file{diffFiles.length !== 1 ? 's' : ''}
          </button>
          {showFiles && (
            <div className="cr-file-list">
              {diffFiles.map((f) => (
                <a
                  key={f.path}
                  className="cr-file-item"
                  href={`#diff-${f.path.replace(/[^a-zA-Z0-9]/g, '-')}`}
                >
                  <span className="cr-file-path">{f.path}</span>
                  <span className="cr-file-stats">
                    {f.additions > 0 && <span className="cr-diff-stat--add">+{f.additions}</span>}
                    {f.deletions > 0 && <span className="cr-diff-stat--del">-{f.deletions}</span>}
                  </span>
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Diff viewer */}
      <div className="cr-diff-scroll">
        <DiffViewer diff={diffText} truncated={diffTruncated} />
      </div>

      {/* Merged success banner */}
      {merged && mergeResult && (
        <div className="cr-merged-banner">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
          </svg>
          Merged successfully — commit <code>{mergeResult.merge_commit?.substring(0, 7)}</code>
        </div>
      )}

      {/* Reject modal */}
      {showReject && (
        <div className="cr-modal-overlay" onClick={() => setShowReject(false)}>
          <div className="cr-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Send Back for Changes</h3>
            <p className="cr-modal-desc">The agent will receive your feedback and make revisions on the branch.</p>
            <textarea
              value={rejectFeedback}
              onChange={(e) => setRejectFeedback(e.target.value)}
              placeholder="What needs to be changed? Be specific..."
              rows={4}
            />
            <div className="cr-modal-actions">
              <button className="cr-btn" onClick={() => setShowReject(false)}>Cancel</button>
              <button
                className="cr-btn cr-btn--danger"
                onClick={handleReject}
                disabled={rejecting || !rejectFeedback.trim()}
              >
                {rejecting ? 'Sending...' : 'Request Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Deploy modal */}
      {showDeploy && <DeployModal onClose={() => setShowDeploy(false)} />}

      {/* Smart action bar — changes based on workflow step */}
      <div className="cr-actions">
        {currentStep === 'review' && !reviewLoading && (
          <>
            <div className="cr-action-hint">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4m0-4h.01"/></svg>
              Step 1: Start an AI review to analyze these changes
            </div>
            <div className="cr-actions-right">
              <button className="cr-btn cr-btn--primary" onClick={() => { setReviewOpen(true); requestAiReview(); }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/></svg>
                Start AI Review
              </button>
            </div>
          </>
        )}

        {currentStep === 'review' && reviewLoading && (
          <>
            <div className="cr-action-hint cr-action-hint--active">
              <div className="cr-loading-spinner cr-loading-spinner--sm" />
              AI is reviewing the code changes...
            </div>
            <div className="cr-actions-right">
              <button className="cr-btn cr-btn--secondary" onClick={() => setReviewOpen(true)}>
                View Review
              </button>
            </div>
          </>
        )}

        {currentStep === 'approve' && (
          <>
            <div className="cr-action-hint cr-action-hint--success">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
              Review complete. Approve the changes or request revisions.
            </div>
            <div className="cr-actions-right">
              <button className="cr-btn cr-btn--secondary" onClick={() => setReviewOpen(true)}>
                View Review
              </button>
              <button
                className="cr-btn cr-btn--danger-outline"
                onClick={() => setShowReject(true)}
              >
                Request Changes
              </button>
              <button
                className="cr-btn cr-btn--primary"
                onClick={handleMerge}
                disabled={merging}
              >
                {merging ? 'Merging...' : 'Approve & Merge'}
              </button>
            </div>
          </>
        )}

        {currentStep === 'merge' && !merged && (
          <>
            <div className="cr-action-hint cr-action-hint--success">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
              Approved. Ready to merge into main.
            </div>
            <div className="cr-actions-right">
              <button
                className="cr-btn cr-btn--danger-outline"
                onClick={() => setShowReject(true)}
              >
                Request Changes
              </button>
              <button
                className="cr-btn cr-btn--primary"
                onClick={handleMerge}
                disabled={merging}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 3v12"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 01-9 9"/></svg>
                {merging ? 'Merging...' : 'Merge to Main'}
              </button>
            </div>
          </>
        )}

        {currentStep === 'deploy' && (
          <>
            <div className="cr-action-hint cr-action-hint--crystal">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
              Merged! Deploy the affected services to production.
            </div>
            <div className="cr-actions-right">
              <button className="cr-btn cr-btn--primary" onClick={() => setShowDeploy(true)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
                Deploy to Production
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
