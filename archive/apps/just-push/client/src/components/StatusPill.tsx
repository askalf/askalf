import type { ReviewStatus } from '../stores/branches';

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  pending_review: { label: 'Needs Review', className: 'jp-pill--warning' },
  reviewed: { label: 'Reviewed', className: 'jp-pill--info' },
  approved: { label: 'Approved', className: 'jp-pill--success' },
  rejected: { label: 'Changes Requested', className: 'jp-pill--danger' },
  merged: { label: 'Merged', className: 'jp-pill--merged' },
};

export default function StatusPill({ status }: { status: ReviewStatus }) {
  const config = status ? STATUS_CONFIG[status] : null;
  if (!config) return <span className="jp-pill jp-pill--muted">New</span>;
  return <span className={`jp-pill ${config.className}`}>{config.label}</span>;
}
