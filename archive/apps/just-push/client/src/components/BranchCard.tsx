import { useNavigate } from 'react-router-dom';
import type { Branch } from '../stores/branches';
import StatusPill from './StatusPill';
import ActionButton from './ActionButton';

function humanizeBranch(name: string): string {
  return name
    .replace(/^agent\//, '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

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

export default function BranchCard({ branch }: { branch: Branch }) {
  const navigate = useNavigate();

  return (
    <div className="jp-card" onClick={() => navigate(`/branch/${encodeURIComponent(branch.name)}`)}>
      <div className="jp-card-top">
        <h3 className="jp-card-title">{humanizeBranch(branch.name)}</h3>
        <StatusPill status={branch.review_status} />
      </div>

      <p className="jp-card-agent">
        by <strong>{branch.agent_name || branch.agent_slug}</strong>
        {branch.last_date && <span className="jp-card-time"> · {timeAgo(branch.last_date)}</span>}
      </p>

      <div className="jp-card-stats">
        <span className="jp-card-stat">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          {branch.files_changed} file{branch.files_changed !== 1 ? 's' : ''}
        </span>
        <span className="jp-card-stat">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="4"/><line x1="1.05" y1="12" x2="7" y2="12"/><line x1="17.01" y1="12" x2="22.96" y2="12"/></svg>
          {branch.commits} commit{branch.commits !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="jp-card-action" onClick={(e) => e.stopPropagation()}>
        <ActionButton
          status={branch.review_status}
          onClick={() => navigate(`/branch/${encodeURIComponent(branch.name)}`)}
        />
      </div>
    </div>
  );
}
