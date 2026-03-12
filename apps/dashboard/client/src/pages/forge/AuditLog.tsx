import { useCallback, useMemo, useState } from 'react';
import { useHubStore } from '../../stores/hub';
import { usePolling } from '../../hooks/usePolling';
import { formatDateFull, relativeTime } from '../../utils/format';
import type { AuditEntry } from '../../hooks/useHubApi';
import './forge-observe.css';

const ACTION_ICONS: Record<string, string> = {
  created: '+', updated: '~', deleted: '×', resolved: '✓',
  assigned: '→', auto_approved: '⚡', closed: '○',
  'user.login': '↪', 'user.logout': '↩',
  'execution.start': '▶', 'execution.complete': '✓', 'execution.fail': '✗',
  'template.instantiate': '⬡',
};

const ACTION_COLORS: Record<string, string> = {
  created: '#8b5cf6', updated: '#3b82f6', deleted: '#ef4444',
  resolved: '#10b981', assigned: '#3b82f6', auto_approved: '#f59e0b', closed: '#6b7280',
  'user.login': '#10b981', 'user.logout': '#6b7280',
  'execution.start': '#8b5cf6', 'execution.complete': '#10b981', 'execution.fail': '#ef4444',
  'template.instantiate': '#f59e0b',
};

const ACTION_BG: Record<string, string> = {
  created: 'rgba(139,92,246,0.12)', updated: 'rgba(59,130,246,0.12)', deleted: 'rgba(239,68,68,0.12)',
  resolved: 'rgba(16,185,129,0.12)', assigned: 'rgba(59,130,246,0.12)', auto_approved: 'rgba(245,158,11,0.12)',
  'user.login': 'rgba(16,185,129,0.12)', 'execution.start': 'rgba(139,92,246,0.12)',
  'execution.complete': 'rgba(16,185,129,0.12)', 'execution.fail': 'rgba(239,68,68,0.12)',
  'template.instantiate': 'rgba(245,158,11,0.12)',
};

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).catch(() => { /* ignore */ });
}

function CopyBtn({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button className="al-copy-btn" title="Copy" onClick={(e) => {
      e.stopPropagation(); copyToClipboard(text); setOk(true); setTimeout(() => setOk(false), 1200);
    }}>
      {ok
        ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
        : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
      }
    </button>
  );
}

function JsonViewer({ data, label }: { data: unknown; label?: string }) {
  if (!data || (typeof data === 'object' && Object.keys(data as object).length === 0)) return null;
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  return (
    <div className="al-json-block">
      <div className="al-json-header">
        {label && <span className="al-json-label">{label}</span>}
        <CopyBtn text={text} />
      </div>
      <pre className="al-json-pre">{text}</pre>
    </div>
  );
}

function AuditRow({ entry }: { entry: AuditEntry }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = (entry.new_value && typeof entry.new_value === 'object' && Object.keys(entry.new_value).length > 0)
    || (entry.old_value && typeof entry.old_value === 'object' && Object.keys(entry.old_value).length > 0);
  const color = ACTION_COLORS[entry.action] || '#6b7280';
  const bg = ACTION_BG[entry.action] || 'rgba(107,114,128,0.1)';
  const icon = ACTION_ICONS[entry.action] || '•';

  return (
    <>
      <tr className={`al-row ${expanded ? 'al-row-expanded' : ''} ${hasDetails ? 'al-row-clickable' : ''}`}
        onClick={() => hasDetails && setExpanded(!expanded)}
        style={{ borderLeft: `3px solid ${color}` }}>
        <td className="al-time-cell">
          <span className="al-time-rel">{relativeTime(entry.created_at)}</span>
          <span className="al-time-abs">{formatDateFull(entry.created_at)}</span>
        </td>
        <td>
          <span className="al-action-pill" style={{ color, background: bg }}>
            <span className="al-action-icon">{icon}</span>
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
              {JSON.stringify(entry.new_value).slice(0, 100)}
              {JSON.stringify(entry.new_value).length > 100 ? '...' : ''}
              <span className="al-expand-icon">{expanded ? '▾' : '▸'}</span>
            </span>
          ) : (
            <span className="al-no-details">—</span>
          )}
        </td>
      </tr>
      {expanded && (
        <tr className="al-detail-row">
          <td colSpan={5}>
            <div className="al-detail-content">
              <div className="al-detail-meta">
                <span className="al-detail-chip">ID: {entry.id}</span>
                {entry.execution_id && <span className="al-detail-chip">Exec: {entry.execution_id}</span>}
                <CopyBtn text={entry.id} />
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

function ActionDistribution({ entries }: { entries: AuditEntry[] }) {
  const dist = useMemo(() => {
    const counts: Record<string, number> = {};
    entries.forEach((e) => { counts[e.action] = (counts[e.action] || 0) + 1; });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [entries]);
  const total = entries.length || 1;

  if (dist.length === 0) return null;
  return (
    <div className="al-dist">
      <div className="al-dist-bar">
        {dist.map(([action, count]) => (
          <div key={action} className="al-dist-seg" title={`${action}: ${count}`}
            style={{ width: `${(count / total) * 100}%`, background: ACTION_COLORS[action] || '#6b7280' }} />
        ))}
      </div>
      <div className="al-dist-legend">
        {dist.map(([action, count]) => (
          <span key={action} className="al-dist-item">
            <span className="al-dist-dot" style={{ background: ACTION_COLORS[action] || '#6b7280' }} />
            {action} <span className="al-dist-count">{count}</span>
          </span>
        ))}
      </div>
    </div>
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

  // Derived stats
  const stats = useMemo(() => {
    const actors = new Set(auditEntries.map((e) => e.actor));
    const entities = new Set(auditEntries.map((e) => e.entity_type).filter(Boolean));
    const today = new Date().toISOString().slice(0, 10);
    const todayCount = auditEntries.filter((e) => e.created_at.startsWith(today)).length;
    return { uniqueActors: actors.size, uniqueEntities: entities.size, todayCount };
  }, [auditEntries]);

  return (
    <div className="al-container">
      {/* Summary bar */}
      <div className="al-summary-row">
        <div className="al-summary-card">
          <div className="al-summary-value">{auditTotal}</div>
          <div className="al-summary-label">Total Events</div>
        </div>
        <div className="al-summary-card">
          <div className="al-summary-value">{stats.todayCount}</div>
          <div className="al-summary-label">Today</div>
        </div>
        <div className="al-summary-card">
          <div className="al-summary-value">{stats.uniqueActors}</div>
          <div className="al-summary-label">Actors</div>
        </div>
        <div className="al-summary-card">
          <div className="al-summary-value">{stats.uniqueEntities}</div>
          <div className="al-summary-label">Entity Types</div>
        </div>
      </div>

      {/* Action distribution */}
      <ActionDistribution entries={auditEntries} />

      {/* Filters */}
      <div className="al-filter-bar">
        <select value={auditEntityFilter} onChange={(e) => setAuditEntityFilter(e.target.value)} className="al-select">
          <option value="">All Entities</option>
          <option value="agent">Agent</option>
          <option value="ticket">Ticket</option>
          <option value="finding">Finding</option>
          <option value="intervention">Intervention</option>
          <option value="execution">Execution</option>
          <option value="schedule">Schedule</option>
          <option value="user">User</option>
        </select>
        <select value={auditActionFilter} onChange={(e) => setAuditActionFilter(e.target.value)} className="al-select">
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
        <input type="text" value={auditActorFilter} onChange={(e) => setAuditActorFilter(e.target.value)}
          placeholder="Filter by actor..." className="al-search" />
      </div>

      {/* Audit Table */}
      <div className="al-table-wrap">
        {loading['audit'] && auditEntries.length === 0 ? (
          <div className="al-empty-state">
            <div className="al-empty-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.3">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>
              </svg>
            </div>
            <div className="al-empty-text">Loading audit log...</div>
          </div>
        ) : auditEntries.length === 0 ? (
          <div className="al-empty-state">
            <div className="al-empty-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.3">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>
              </svg>
            </div>
            <div className="al-empty-text">No audit entries found</div>
            <div className="al-empty-sub">Events will appear here as agents run, users log in, and resources change.</div>
          </div>
        ) : (
          <table className="al-table">
            <thead>
              <tr>
                <th style={{ width: '130px' }}>When</th>
                <th style={{ width: '160px' }}>Action</th>
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
        <div className="al-pagination">
          <button className="al-page-btn" disabled={currentPage <= 1} onClick={() => setAuditOffset(Math.max(0, auditOffset - pageSize))}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <span className="al-page-info">Page {currentPage} of {totalPages}</span>
          <button className="al-page-btn" disabled={currentPage >= totalPages} onClick={() => setAuditOffset(auditOffset + pageSize)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
      )}
    </div>
  );
}
