import { useState, useEffect, useCallback } from 'react';
import { hubApi, type Proposal, type ProposalDetail, type ProposalReview as Review } from '../../hooks/useHubApi';
import FilterBar from './shared/FilterBar';
import StatusBadge from './shared/StatusBadge';
import Modal from './shared/Modal';
import EmptyState from './shared/EmptyState';
import LoadingSkeleton from './shared/LoadingSkeleton';
import './ProposalReview.css';

type StatusFilter = 'all' | 'pending_review' | 'approved' | 'applied' | 'rejected';
type TypeFilter = '' | 'prompt_revision' | 'code_change' | 'config_change' | 'schema_change';

const PAGE_SIZE = 20;

const formatDate = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

export default function ProposalReviewPage() {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('');

  // Detail modal
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ProposalDetail | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  // Respond
  const [respondComment, setRespondComment] = useState('');
  const [responding, setResponding] = useState(false);

  const fetchProposals = useCallback(async () => {
    setLoading(true);
    try {
      const params: { status?: string; proposalType?: string; limit: number; offset: number } = {
        limit: PAGE_SIZE,
        offset,
      };
      if (statusFilter !== 'all') params.status = statusFilter;
      if (typeFilter) params.proposalType = typeFilter;
      const data = await hubApi.proposals.list(params);
      setProposals(data.proposals);
      setTotal(data.total);
    } catch (err) {
      console.error('Failed to fetch proposals:', err);
    }
    setLoading(false);
  }, [statusFilter, typeFilter, offset]);

  useEffect(() => {
    fetchProposals();
  }, [fetchProposals]);

  // Reset offset when filters change
  useEffect(() => {
    setOffset(0);
  }, [statusFilter, typeFilter]);

  const openDetail = async (id: string) => {
    setSelectedId(id);
    setDetailLoading(true);
    setDetail(null);
    setReviews([]);
    setRespondComment('');
    try {
      const data = await hubApi.proposals.detail(id);
      setDetail(data.proposal);
      setReviews(data.reviews);
    } catch (err) {
      console.error('Failed to fetch proposal detail:', err);
    }
    setDetailLoading(false);
  };

  const handleRespond = async (action: 'approve' | 'reject') => {
    if (!selectedId) return;
    setResponding(true);
    try {
      await hubApi.proposals.respond(selectedId, { action, comment: respondComment || undefined });
      setSelectedId(null);
      await fetchProposals();
    } catch (err) {
      console.error('Failed to respond to proposal:', err);
    }
    setResponding(false);
  };

  // Stats
  const pendingCount = proposals.filter(p => p.status === 'pending_review').length;
  const approvedCount = proposals.filter(p => p.status === 'approved').length;
  const appliedCount = proposals.filter(p => p.status === 'applied').length;

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div className="pr-shell">
      {/* Stats */}
      <div className="pr-stats">
        <div className="pr-stat">
          <div className="pr-stat__value">{total}</div>
          <div className="pr-stat__label">Total</div>
        </div>
        <div className="pr-stat">
          <div className="pr-stat__value" style={{ color: '#f59e0b' }}>{pendingCount}</div>
          <div className="pr-stat__label">Pending Review</div>
        </div>
        <div className="pr-stat">
          <div className="pr-stat__value" style={{ color: '#10b981' }}>{approvedCount}</div>
          <div className="pr-stat__label">Approved</div>
        </div>
        <div className="pr-stat">
          <div className="pr-stat__value" style={{ color: '#6366f1' }}>{appliedCount}</div>
          <div className="pr-stat__label">Applied</div>
        </div>
      </div>

      {/* Filters */}
      <FilterBar
        tabs={[
          { value: 'all', label: 'All', active: statusFilter === 'all', onClick: () => setStatusFilter('all') },
          { value: 'pending_review', label: 'Pending Review', active: statusFilter === 'pending_review', onClick: () => setStatusFilter('pending_review'), badge: pendingCount },
          { value: 'approved', label: 'Approved', active: statusFilter === 'approved', onClick: () => setStatusFilter('approved') },
          { value: 'applied', label: 'Applied', active: statusFilter === 'applied', onClick: () => setStatusFilter('applied') },
          { value: 'rejected', label: 'Rejected', active: statusFilter === 'rejected', onClick: () => setStatusFilter('rejected') },
        ]}
        filters={[
          {
            value: typeFilter,
            onChange: (v) => setTypeFilter(v as TypeFilter),
            options: [
              { value: '', label: 'All Types' },
              { value: 'prompt_revision', label: 'Prompt Revision' },
              { value: 'code_change', label: 'Code Change' },
              { value: 'config_change', label: 'Config Change' },
              { value: 'schema_change', label: 'Schema Change' },
            ],
          },
        ]}
      />

      {/* Table */}
      {loading ? (
        <LoadingSkeleton rows={6} type="table" />
      ) : proposals.length === 0 ? (
        <EmptyState icon="📋" title="No proposals" message="No change proposals match the current filters." />
      ) : (
        <>
          <table className="pr-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Type</th>
                <th>Author</th>
                <th>Status</th>
                <th>Risk</th>
                <th>Reviews</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {proposals.map((p) => (
                <tr key={p.id} onClick={() => openDetail(p.id)}>
                  <td className="pr-table__title">{p.title}</td>
                  <td>
                    <span className={`pr-table__type pr-table__type--${p.proposal_type}`}>
                      {p.proposal_type.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td>{p.author_name || 'Unknown'}</td>
                  <td><StatusBadge status={p.status} /></td>
                  <td><span className={`pr-risk pr-risk--${p.risk_level}`}>{p.risk_level}</span></td>
                  <td>
                    <span className="pr-reviews-col">
                      {parseInt(p.approval_count, 10) > 0 && (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                          <path d="M20 6L9 17l-5-5" />
                        </svg>
                      )}
                      {p.review_count}/{p.required_reviews}
                    </span>
                  </td>
                  <td style={{ whiteSpace: 'nowrap', color: 'var(--text-tertiary)' }}>{formatDate(p.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="pr-pagination">
              <span className="pr-pagination__info">
                {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
              </span>
              <div className="pr-pagination__buttons">
                <button
                  className="hub-btn"
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                >
                  Prev
                </button>
                <button
                  className="hub-btn"
                  disabled={currentPage >= totalPages}
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Detail Modal */}
      {selectedId && (
        <Modal title={detail?.title || 'Proposal Detail'} onClose={() => setSelectedId(null)} size="large">
          {detailLoading ? (
            <LoadingSkeleton rows={4} type="cards" />
          ) : detail ? (
            <div className="pr-detail">
              {/* Meta grid */}
              <div className="pr-detail__meta">
                <div className="pr-detail__meta-item">
                  <span className="pr-detail__meta-label">Status</span>
                  <span className="pr-detail__meta-value"><StatusBadge status={detail.status} /></span>
                </div>
                <div className="pr-detail__meta-item">
                  <span className="pr-detail__meta-label">Type</span>
                  <span className="pr-detail__meta-value">
                    <span className={`pr-table__type pr-table__type--${detail.proposal_type}`}>
                      {detail.proposal_type.replace(/_/g, ' ')}
                    </span>
                  </span>
                </div>
                <div className="pr-detail__meta-item">
                  <span className="pr-detail__meta-label">Author</span>
                  <span className="pr-detail__meta-value">{detail.author_name}</span>
                </div>
                <div className="pr-detail__meta-item">
                  <span className="pr-detail__meta-label">Risk Level</span>
                  <span className="pr-detail__meta-value">
                    <span className={`pr-risk pr-risk--${detail.risk_level}`}>{detail.risk_level}</span>
                  </span>
                </div>
                {detail.target_agent_name && (
                  <div className="pr-detail__meta-item">
                    <span className="pr-detail__meta-label">Target Agent</span>
                    <span className="pr-detail__meta-value">{detail.target_agent_name}</span>
                  </div>
                )}
                <div className="pr-detail__meta-item">
                  <span className="pr-detail__meta-label">Created</span>
                  <span className="pr-detail__meta-value">{formatDate(detail.created_at)}</span>
                </div>
                {detail.applied_at && (
                  <div className="pr-detail__meta-item">
                    <span className="pr-detail__meta-label">Applied</span>
                    <span className="pr-detail__meta-value">{formatDate(detail.applied_at)}</span>
                  </div>
                )}
              </div>

              {/* Description */}
              {detail.description && (
                <div className="pr-changes">
                  <div className="pr-changes__title">Description</div>
                  <div className="pr-detail__description" style={{ background: 'transparent', padding: 0 }}>
                    {detail.description}
                  </div>
                </div>
              )}

              {/* File changes */}
              {detail.file_changes && Object.keys(detail.file_changes as object).length > 0 && (
                <div className="pr-changes">
                  <div className="pr-changes__title">File Changes</div>
                  <pre>{JSON.stringify(detail.file_changes, null, 2)}</pre>
                </div>
              )}

              {/* Config changes */}
              {detail.config_changes && Object.keys(detail.config_changes as object).length > 0 && (
                <div className="pr-changes">
                  <div className="pr-changes__title">Config Changes</div>
                  <pre>{JSON.stringify(detail.config_changes, null, 2)}</pre>
                </div>
              )}

              {/* Reviews */}
              <div className="pr-reviews">
                <div className="pr-reviews__title">Reviews ({reviews.length})</div>
                {reviews.length === 0 ? (
                  <EmptyState icon="💬" title="No reviews yet" message="No agents have reviewed this proposal." />
                ) : (
                  reviews.map((r) => (
                    <div key={r.id} className={`pr-review-card pr-review-card--${r.verdict}`}>
                      <div className="pr-review-card__header">
                        <span className="pr-review-card__author">
                          {r.reviewer_name} — <StatusBadge status={r.verdict} />
                        </span>
                        <span className="pr-review-card__date">{formatDate(r.created_at)}</span>
                      </div>
                      {r.comment && <div className="pr-review-card__comment">{r.comment}</div>}
                    </div>
                  ))
                )}
              </div>

              {/* Action bar — only for reviewable proposals */}
              {(detail.status === 'pending_review' || detail.status === 'approved') && (
                <div className="pr-actions">
                  <textarea
                    placeholder="Optional comment..."
                    value={respondComment}
                    onChange={(e) => setRespondComment(e.target.value)}
                  />
                  <div className="pr-actions__buttons">
                    <button
                      className="pr-btn-approve"
                      onClick={() => handleRespond('approve')}
                      disabled={responding}
                    >
                      {responding ? 'Saving...' : 'Approve'}
                    </button>
                    <button
                      className="pr-btn-reject"
                      onClick={() => handleRespond('reject')}
                      disabled={responding}
                    >
                      {responding ? 'Saving...' : 'Reject'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <EmptyState icon="❌" title="Not found" message="Could not load proposal details." />
          )}
        </Modal>
      )}
    </div>
  );
}
