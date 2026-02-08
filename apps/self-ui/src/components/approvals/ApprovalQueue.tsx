import { useEffect } from 'react';
import clsx from 'clsx';
import { useApprovalsStore } from '../../stores/approvals';
import ApprovalCard from './ApprovalCard';
import EmptyState from '../common/EmptyState';

const statusOptions = ['pending', 'approved', 'rejected', 'all'] as const;

export default function ApprovalQueue() {
  const { approvals, total, isLoading, isLoadingMore, statusFilter, fetchApprovals, setStatusFilter, loadMore, approve, reject } = useApprovalsStore();

  useEffect(() => {
    fetchApprovals();
  }, [fetchApprovals]);

  const hasMore = approvals.length < total;

  return (
    <div>
      <div className="activity-filters" style={{ marginBottom: 'var(--space-lg)' }}>
        {statusOptions.map((s) => (
          <button
            key={s}
            className={clsx('activity-filter', statusFilter === s && 'active')}
            onClick={() => setStatusFilter(s)}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {isLoading && approvals.length === 0 ? (
        <div style={{ padding: 'var(--space-xl)', textAlign: 'center', color: 'var(--text-muted)' }}>
          Loading approvals...
        </div>
      ) : approvals.length === 0 ? (
        <EmptyState
          icon="&#9989;"
          title="No approvals"
          text={statusFilter === 'pending' ? "You're all caught up! No pending approvals." : 'No approvals match this filter.'}
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
          {approvals.map((a) => (
            <ApprovalCard
              key={a.id}
              approval={a}
              onApprove={approve}
              onReject={reject}
            />
          ))}
          {hasMore && (
            <div style={{ textAlign: 'center', padding: 'var(--space-lg)' }}>
              <button className="btn btn-secondary" onClick={loadMore} disabled={isLoadingMore}>
                {isLoadingMore ? 'Loading...' : `Load More (${approvals.length} of ${total})`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
