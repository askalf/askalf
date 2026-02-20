import type { ReviewStatus } from '../stores/branches';

interface ActionButtonProps {
  status: ReviewStatus;
  merged?: boolean;
  onClick: () => void;
  disabled?: boolean;
  large?: boolean;
}

function getAction(status: ReviewStatus, merged?: boolean) {
  if (merged) return { label: 'Deploy Now', icon: '🚀', className: 'jp-action--deploy' };
  switch (status) {
    case 'merged':
      return { label: 'Deployed', icon: '✓', className: 'jp-action--done' };
    case 'approved':
      return { label: 'Merge to Main', icon: '→', className: 'jp-action--merge' };
    case 'reviewed':
      return { label: 'Approve & Merge', icon: '→', className: 'jp-action--merge' };
    case 'rejected':
      return { label: 'Review Again', icon: '↻', className: 'jp-action--review' };
    case 'pending_review':
    default:
      return { label: 'Review', icon: '◎', className: 'jp-action--review' };
  }
}

export default function ActionButton({ status, merged, onClick, disabled, large }: ActionButtonProps) {
  const { label, icon, className } = getAction(status, merged);
  return (
    <button
      className={`jp-action-btn ${className} ${large ? 'jp-action-btn--lg' : ''}`}
      onClick={onClick}
      disabled={disabled || status === 'merged'}
    >
      <span className="jp-action-icon">{icon}</span>
      {label}
    </button>
  );
}
