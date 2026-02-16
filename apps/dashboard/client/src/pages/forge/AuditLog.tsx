import { useCallback } from 'react';
import { useHubStore } from '../../stores/hub';
import { usePolling } from '../../hooks/usePolling';
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
};

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

  const poll = useCallback(() => {
    fetchAudit();
  }, [fetchAudit]);
  usePolling(poll, 30000);

  const pageSize = 50;
  const currentPage = Math.floor(auditOffset / pageSize) + 1;
  const totalPages = Math.ceil(auditTotal / pageSize) || 1;

  return (
    <div className="fo-overview">
      {/* Filters */}
      <div className="fobs-filter-bar">
        <select value={auditEntityFilter} onChange={(e) => setAuditEntityFilter(e.target.value)} className="fobs-select">
          <option value="">All Entities</option>
          <option value="agent">Agent</option>
          <option value="ticket">Ticket</option>
          <option value="intervention">Intervention</option>
          <option value="execution">Execution</option>
          <option value="schedule">Schedule</option>
        </select>
        <select value={auditActionFilter} onChange={(e) => setAuditActionFilter(e.target.value)} className="fobs-select">
          <option value="">All Actions</option>
          <option value="created">Created</option>
          <option value="updated">Updated</option>
          <option value="deleted">Deleted</option>
          <option value="resolved">Resolved</option>
          <option value="assigned">Assigned</option>
          <option value="auto_approved">Auto-Approved</option>
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
      <div className="fo-panel">
        <div className="fo-panel-header">
          <span className="fo-panel-title">Audit Trail</span>
          <span className="fo-panel-count">Page {currentPage} of {totalPages}</span>
        </div>
        {loading['audit'] && auditEntries.length === 0 ? (
          <p className="fo-empty">Loading audit log...</p>
        ) : auditEntries.length === 0 ? (
          <p className="fo-empty">No audit entries found</p>
        ) : (
          <div className="fobs-table-wrap">
            <table className="fobs-table fobs-table--audit">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Action</th>
                  <th>Entity</th>
                  <th>Actor</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {auditEntries.map((entry) => (
                  <tr key={entry.id}>
                    <td className="fobs-mono fobs-nowrap">{formatDate(entry.created_at)}</td>
                    <td>
                      <span
                        className="fobs-action-badge"
                        style={{ color: ACTION_COLORS[entry.action] || 'var(--text-secondary)' }}
                      >
                        {entry.action}
                      </span>
                    </td>
                    <td>
                      <span className="fobs-entity-type">{entry.entity_type}</span>
                      {entry.entity_id && (
                        <span className="fobs-entity-id">{entry.entity_id.slice(0, 8)}...</span>
                      )}
                    </td>
                    <td className="fobs-mono">{entry.actor}</td>
                    <td className="fobs-details">
                      {entry.new_value && typeof entry.new_value === 'object' && Object.keys(entry.new_value).length > 0 ? (
                        <span className="fobs-json-preview">
                          {JSON.stringify(entry.new_value).slice(0, 80)}
                          {JSON.stringify(entry.new_value).length > 80 ? '...' : ''}
                        </span>
                      ) : (
                        <span className="fobs-text-muted">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="fobs-pagination">
            <button
              className="fobs-page-btn"
              disabled={currentPage <= 1}
              onClick={() => setAuditOffset(Math.max(0, auditOffset - pageSize))}
            >
              Prev
            </button>
            <span className="fobs-page-info">{currentPage} / {totalPages}</span>
            <button
              className="fobs-page-btn"
              disabled={currentPage >= totalPages}
              onClick={() => setAuditOffset(auditOffset + pageSize)}
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
