import clsx from 'clsx';
import { formatDistanceToNow } from 'date-fns';
import type { Approval } from '../../api/approvals';

interface Props {
  approval: Approval;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}

export default function ApprovalCard({ approval, onApprove, onReject }: Props) {
  const isPending = approval.status === 'pending';

  return (
    <div className="approval-card">
      <div className="approval-card-header">
        <div className="approval-card-info">
          <h3 className="approval-card-title">{approval.title}</h3>
          <p className="approval-card-desc">{approval.description}</p>
        </div>
        {isPending && (
          <div className="approval-actions">
            <button className="btn btn-danger btn-sm" onClick={() => onReject(approval.id)}>
              Reject
            </button>
            <button className="btn btn-primary btn-sm" onClick={() => onApprove(approval.id)}>
              Approve
            </button>
          </div>
        )}
      </div>
      <div className="approval-card-meta">
        <span className={clsx('badge', {
          'badge-warning': approval.status === 'pending',
          'badge-success': approval.status === 'approved',
          'badge-danger': approval.status === 'rejected',
        })}>
          {approval.status}
        </span>
        <span className={clsx('badge', {
          'badge-info': approval.risk === 'low',
          'badge-warning': approval.risk === 'medium',
          'badge-danger': approval.risk === 'high',
        })}>
          {approval.risk} risk
        </span>
        {approval.estimatedCost != null && (
          <span style={{ color: 'var(--warning)' }}>~${approval.estimatedCost.toFixed(4)}</span>
        )}
        <span>{formatDistanceToNow(new Date(approval.createdAt), { addSuffix: true })}</span>
      </div>
    </div>
  );
}
