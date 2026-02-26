import { useCallback, useState } from 'react';
import { useHubStore } from '../../stores/hub';
import { usePolling } from '../../hooks/usePolling';
import type { AuditEntry } from '../../hooks/useHubApi';
import './forge-observe.css';

const formatDate = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

const ACTION_COLORS: Record<string, string> = {
  created: 'var(--crystal)',
  updated: 'var(--info, #3b82f6)',
  deleted: 'var(--danger)',
  resolved: 'var(--crystal)',
  assigned: 'var(--info, #3b82f6)',
  auto_approved: 'var(--warning)',
  closed: 'var(--text-muted)',
  'user.login': '#10b981',
  'user.logout': '#6b7280',
  'execution.start': '#8b5cf6',
  'execution.complete': '#10b981',
  'execution.fail': '#ef4444',
  'template.instantiate': '#f59e0b',
};

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).catch(() => { /* ignore */ });
}

function JsonViewer({ data, label }: { data: unknown; label?: string }) {
  if (!data || (typeof data === 'object' && Object.keys(data as object).length === 0)) {
    return <span className="al-empty">Empty</span>;
  }
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  return (
    <div className="al-json-block">
      {label && <div className="al-json-label">{label}</div>}
      <pre className="al-json-pre">{text}</pre>
      <button className="al-copy-btn" onClick={() => copyToClipboard(text)} title="Copy">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
      </button>
    </div>
  );
}

function AuditRow({ entry }: { entry: AuditEntry }) {
  const [expanded, setExpanded] = useState(false);

  const hasDetails = (entry.new_value && typeof entry.new_value === 'object' && Object.keys(entry.new_value).length > 0)
    || (entry.old_value && typeof entry.old_value === 'object' && Object.keys(entry.old_value).length > 0);

  return (
    <>
      <tr className={`al-row ${expanded ? 'al-row-expanded' : ''} ${hasDetails ? 'al-row-clickable' : ''}`} onClick={() => hasDetails && setExpanded(!expanded)}>
        <td className="fobs-mono fobs-nowrap">{formatDate(entry.created_at)}</td>
        <td>
          <span className="al-action-badge" style={{ color: ACTION_COLORS[entry.action] || 'var(--text-secondary)' }}>
            {entry.action}
          </span>
        </td>
        <td>
          <div className="al-entity-cell">
            <span className="al-entity-type">{entry.entity_type || '—'}</span>
            {entry.entity_id && (
              <span className="al-entity-id" title={entry.entity_id} onClick={(e) => { e.stopPropagation(); copyToClipboard(entry.entity_id); }}>
                {entry.entity_id.length > 20 ? `${entry.entity_id.slice(0, 12)}...${entry.entity_id.slice(-6)}` : entry.entity_id}
              </span>
            )}
          </div>
        </td>
        <td>
          <div className="al-actor-cell">
            <span className="al-actor-name">{entry.actor || '—'}</span>
            {entry.actor_id && <span className="al-actor-id">{entry.actor_id.slice(0, 10)}...</span>}
          </div>
        </td>
        <td className="al-details-cell">
          {hasDetails ? (
            <span className="al-details-preview">
              {JSON.stringify(entry.new_value).slice(0, 120)}
              {JSON.stringify(entry.new_value).length > 120 ? '...' : ''}
              <span className="al-expand-icon">{expanded ? '▾' : '▸'}</span>
            </span>
          ) : (
            <span className="fobs-text-muted">—</span>
          )}
        </td>
      </tr>
      {expanded && (
        <tr className="al-detail-row">
          <td colSpan={5}>
            <div className="al-detail-content">
              <div className="al-detail-header">
                <span className="al-detail-id" title={entry.id}>ID: {entry.id}</span>
                {entry.execution_id && <span className="al-detail-exec">Execution: {entry.execution_id}</span>}
              </div>
              <div className="al-detail-panels">
                {entry.new_value && Object.keys(entry.new_value).length > 0 && (
                  <JsonViewer data={entry.new_value} label={entry.old_value && Object.keys(entry.old_value).length > 0 ? 'New Value' : 'Details'} />
                )}
                {entry.old_value && Object.keys(entry.old_value).length > 0 && (
                  <JsonViewer data={entry.old_value} label="Previous Value" />
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function AuditLog() {
  const auditEntries = useHubStore((s) => s.auditEntries);
  const auditTotal = useHubStore((s) => s.auditTotal);
  const auditOffset = useHubStore((s) => s.auditOffset);
  const auditEntityFilter = useHubStore((s) => s.auditEntityFilter);
  const auditActionFilter = useHubStore((s) => s.auditActionFilter);
  const auditActorFilter = useHubStore((s) => s.auditActorFilter);
  const setAuditOffset = useHubStore((s) => s.setAuditOffset);
  const setAuditEntityFilter = useHubStore((s) => s.setAuditEntityFilter);
  const setAuditActionFilter = useHubStore((s) => s.setAuditActionFilter);
  const setAuditActorFilter = useHubStore((s) => s.setAuditActorFilter);
  const fetchAudit = useHubStore((s) => s.fetchAudit);
  const loading = useHubStore((s) => s.loading);

  const poll = useCallback(() => { fetchAudit(); }, [fetchAudit]);
  usePolling(poll, 30000);

  const pageSize = 50;
  const currentPage = Math.floor(auditOffset / pageSize) + 1;
  const totalPages = Math.ceil(auditTotal / pageSize) || 1;

  return (
    <div className="al-container">
      {/* Filters */}
      <div className="al-filter-bar">
        <select value={auditEntityFilter} onChange={(e) => setAuditEntityFilter(e.target.value)} className="fobs-select">
          <option value="">All Entities</option>
          <option value="agent">Agent</option>
          <option value="ticket">Ticket</option>
          <option value="finding">Finding</option>
          <option value="intervention">Intervention</option>
          <option value="execution">Execution</option>
          <option value="schedule">Schedule</option>
          <option value="user">User</option>
        </select>
        <select value={auditActionFilter} onChange={(e) => setAuditActionFilter(e.target.value)} className="fobs-select">
          <option value="">All Actions</option>
          <option value="created">Created</option>
          <option value="updated">Updated</option>
          <option value="deleted">Deleted</option>
          <option value="resolved">Resolved</option>
          <option value="assigned">Assigned</option>
          <option value="auto_approved">Auto-Approved</option>
          <option value="user.login">Login</option>
          <option value="execution.start">Exec Start</option>
          <option value="execution.complete">Exec Complete</option>
          <option value="template.instantiate">Template Instantiate</option>
        </select>
        <input
          type="text"
          value={auditActorFilter}
          onChange={(e) => setAuditActorFilter(e.target.value)}
          placeholder="Filter by actor..."
          className="fobs-input"
        />
        <span className="fobs-count">{auditTotal} entries</span>
      </div>

      {/* Audit Table */}
      <div className="al-table-wrap">
        {loading['audit'] && auditEntries.length === 0 ? (
          <p className="fo-empty">Loading audit log...</p>
        ) : auditEntries.length === 0 ? (
          <p className="fo-empty">No audit entries found</p>
        ) : (
          <table className="al-table">
            <thead>
              <tr>
                <th style={{ width: '160px' }}>Time</th>
                <th style={{ width: '130px' }}>Action</th>
                <th style={{ width: '200px' }}>Entity</th>
                <th style={{ width: '140px' }}>Actor</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {auditEntries.map((entry) => (
                <AuditRow key={entry.id} entry={entry} />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="fobs-pagination">
          <button className="fobs-page-btn" disabled={currentPage <= 1} onClick={() => setAuditOffset(Math.max(0, auditOffset - pageSize))}>
            Prev
          </button>
          <span className="fobs-page-info">{currentPage} / {totalPages}</span>
          <button className="fobs-page-btn" disabled={currentPage >= totalPages} onClick={() => setAuditOffset(auditOffset + pageSize)}>
            Next
          </button>
        </div>
      )}
    </div>
  );
}
