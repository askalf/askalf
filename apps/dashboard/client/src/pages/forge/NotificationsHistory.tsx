import { useCallback, useEffect, useMemo, useState } from 'react';
import { useHubStore } from '../../stores/hub';
import { usePolling } from '../../hooks/usePolling';
import { formatDateFull, relativeTime } from '../../utils/format';
import type { AuditEntry } from '../../hooks/useHubApi';
import './forge-observe.css';

/**
 * Notification-relevant audit actions, grouped by category for filtering.
 */
const NOTIFICATION_CATEGORIES: Record<string, string[]> = {
  execution: ['execution.start', 'execution.complete', 'execution.fail'],
  alert: ['deleted', 'auto_approved'],
  system: ['created', 'updated', 'resolved', 'assigned', 'closed', 'template.instantiate'],
  security: ['user.login', 'user.logout'],
  marketplace: ['submission.pending_review', 'submission.approved', 'submission.rejected', 'submission.quarantined'],
};

const ALL_NOTIFICATION_ACTIONS = Object.values(NOTIFICATION_CATEGORIES).flat();

type FilterCategory = 'all' | 'execution' | 'alert' | 'system' | 'security';

const CATEGORY_COLORS: Record<string, string> = {
  execution: '#8b5cf6',
  alert: '#f59e0b',
  system: '#3b82f6',
  security: '#10b981',
  marketplace: '#ec4899',
};

const ACTION_ICONS: Record<string, string> = {
  created: '+', updated: '~', deleted: '\u00d7', resolved: '\u2713',
  assigned: '\u2192', auto_approved: '\u26a1', closed: '\u25cb',
  'user.login': '\u21aa', 'user.logout': '\u21a9',
  'execution.start': '\u25b6', 'execution.complete': '\u2713', 'execution.fail': '\u2717',
  'template.instantiate': '\u2b21',
};

const ACTION_COLORS: Record<string, string> = {
  created: '#8b5cf6', updated: '#3b82f6', deleted: '#ef4444',
  resolved: '#10b981', assigned: '#3b82f6', auto_approved: '#f59e0b', closed: '#6b7280',
  'user.login': '#10b981', 'user.logout': '#6b7280',
  'execution.start': '#8b5cf6', 'execution.complete': '#10b981', 'execution.fail': '#ef4444',
  'template.instantiate': '#f59e0b',
};

function getCategoryForAction(action: string): string {
  for (const [cat, actions] of Object.entries(NOTIFICATION_CATEGORIES)) {
    if (actions.includes(action)) return cat;
  }
  return 'system';
}

interface NotificationItem {
  id: string;
  timestamp: string;
  category: string;
  action: string;
  message: string;
  actor: string;
  entityType: string;
  entityId: string;
  read: boolean;
  source: 'audit' | 'live';
  raw?: AuditEntry;
}

function auditToNotification(entry: AuditEntry): NotificationItem {
  const category = getCategoryForAction(entry.action);
  const details = entry.new_value && typeof entry.new_value === 'object'
    ? (entry.new_value as Record<string, unknown>).message as string
      || (entry.new_value as Record<string, unknown>).output as string
      || ''
    : '';
  const message = details
    ? `${entry.action} - ${String(details).slice(0, 200)}`
    : `${entry.action} on ${entry.entity_type || 'resource'}${entry.entity_id ? ` (${entry.entity_id.slice(0, 16)})` : ''}`;

  return {
    id: entry.id,
    timestamp: entry.created_at,
    category,
    action: entry.action,
    message,
    actor: entry.actor || 'System',
    entityType: entry.entity_type || '',
    entityId: entry.entity_id || '',
    read: false,
    source: 'audit',
    raw: entry,
  };
}

export default function NotificationsHistory() {
  const auditEntries = useHubStore((s) => s.auditEntries);
  const auditTotal = useHubStore((s) => s.auditTotal);
  const auditOffset = useHubStore((s) => s.auditOffset);
  const setAuditOffset = useHubStore((s) => s.setAuditOffset);
  const setAuditActionFilter = useHubStore((s) => s.setAuditActionFilter);
  const setAuditEntityFilter = useHubStore((s) => s.setAuditEntityFilter);
  const setAuditActorFilter = useHubStore((s) => s.setAuditActorFilter);
  const fetchAudit = useHubStore((s) => s.fetchAudit);
  const loading = useHubStore((s) => s.loading);

  const [filterCategory, setFilterCategory] = useState<FilterCategory>('all');
  const [readSet, setReadSet] = useState<Set<string>>(new Set());
  const [liveNotifications, setLiveNotifications] = useState<NotificationItem[]>([]);

  // Set action filter in store so fetchAudit only returns notification-relevant entries
  // When category changes, update the store filter and reset offset
  useEffect(() => {
    if (filterCategory === 'all') {
      // Clear any previous filter - we'll do client-side filtering from all entries
      setAuditActionFilter('');
    } else {
      const actions = NOTIFICATION_CATEGORIES[filterCategory];
      // The store only supports single action filter, so we use the first one
      // and do additional client-side filtering
      setAuditActionFilter(actions[0] || '');
    }
    setAuditEntityFilter('');
    setAuditActorFilter('');
    setAuditOffset(0);
  }, [filterCategory, setAuditActionFilter, setAuditEntityFilter, setAuditActorFilter, setAuditOffset]);

  const poll = useCallback(() => { fetchAudit(); }, [fetchAudit]);
  usePolling(poll, 15000);

  // Listen for live WebSocket notifications
  useEffect(() => {
    const handler = (e: CustomEvent) => {
      const event = e.detail;
      if (!event?.type) return;

      const agent = event.agentName || event.agentId || 'System';
      const msg = event.data?.message || event.data?.output?.slice(0, 100) || '';
      let action = event.type;
      if (event.category) action = `${event.category}.${event.type}`;

      const item: NotificationItem = {
        id: `live-${event.id || Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: new Date().toISOString(),
        category: getCategoryForAction(action),
        action,
        message: msg || `${agent}: ${action}`,
        actor: agent,
        entityType: event.category || '',
        entityId: event.id || '',
        read: false,
        source: 'live',
      };

      setLiveNotifications(prev => [item, ...prev].slice(0, 100));
    };

    window.addEventListener('forge-event' as string, handler as EventListener);
    return () => window.removeEventListener('forge-event' as string, handler as EventListener);
  }, []);

  // Combine audit entries (filtered to notification-relevant actions) with live notifications
  const notifications = useMemo(() => {
    const auditNotifs = auditEntries
      .filter(e => ALL_NOTIFICATION_ACTIONS.includes(e.action))
      .map(auditToNotification);

    // Merge live + audit, dedupe by id prefix
    const auditIds = new Set(auditNotifs.map(n => n.id));
    const uniqueLive = liveNotifications.filter(n => !auditIds.has(n.id));
    const merged = [...uniqueLive, ...auditNotifs];

    // Apply category filter client-side
    if (filterCategory !== 'all') {
      return merged.filter(n => n.category === filterCategory);
    }
    return merged;
  }, [auditEntries, liveNotifications, filterCategory]);

  const unreadCount = notifications.filter(n => !readSet.has(n.id)).length;

  const handleMarkRead = (id: string) => {
    setReadSet(prev => new Set(prev).add(id));
  };

  const handleMarkUnread = (id: string) => {
    setReadSet(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const handleMarkAllRead = () => {
    setReadSet(new Set(notifications.map(n => n.id)));
  };

  const handleClearAll = () => {
    setLiveNotifications([]);
    setReadSet(new Set(notifications.map(n => n.id)));
  };

  const pageSize = 50;
  const currentPage = Math.floor(auditOffset / pageSize) + 1;
  const totalPages = Math.ceil(auditTotal / pageSize) || 1;

  return (
    <div className="al-container">
      {/* Summary bar */}
      <div className="al-summary-row">
        <div className="al-summary-card">
          <div className="al-summary-value">{notifications.length}</div>
          <div className="al-summary-label">Notifications</div>
        </div>
        <div className="al-summary-card">
          <div className="al-summary-value" style={{ color: unreadCount > 0 ? '#f59e0b' : undefined }}>
            {unreadCount}
          </div>
          <div className="al-summary-label">Unread</div>
        </div>
        <div className="al-summary-card">
          <div className="al-summary-value">{liveNotifications.length}</div>
          <div className="al-summary-label">Live Events</div>
        </div>
        <div className="al-summary-card">
          <div className="al-summary-value">
            {notifications.filter(n => n.category === 'execution').length}
          </div>
          <div className="al-summary-label">Executions</div>
        </div>
      </div>

      {/* Filter bar + actions */}
      <div className="al-filter-bar" style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: '4px' }}>
          {(['all', 'execution', 'alert', 'system', 'security'] as FilterCategory[]).map(cat => (
            <button
              key={cat}
              className={`al-action-pill${filterCategory === cat ? ' nh-filter-active' : ''}`}
              style={{
                color: cat === 'all' ? '#a0aec0' : CATEGORY_COLORS[cat],
                background: filterCategory === cat
                  ? (cat === 'all' ? 'rgba(160,174,192,0.2)' : `${CATEGORY_COLORS[cat]}22`)
                  : 'rgba(255,255,255,0.05)',
                border: filterCategory === cat ? `1px solid ${cat === 'all' ? '#a0aec055' : CATEGORY_COLORS[cat] + '55'}` : '1px solid transparent',
                cursor: 'pointer',
                padding: '4px 12px',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: 500,
                textTransform: 'capitalize',
              }}
              onClick={() => setFilterCategory(cat)}
            >
              {cat}
            </button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <button
          className="al-action-pill"
          style={{
            color: '#3b82f6', background: 'rgba(59,130,246,0.1)',
            cursor: 'pointer', padding: '4px 12px', borderRadius: '6px',
            fontSize: '12px', border: 'none', fontWeight: 500,
          }}
          onClick={handleMarkAllRead}
          disabled={unreadCount === 0}
        >
          Mark All Read
        </button>
        <button
          className="al-action-pill"
          style={{
            color: '#ef4444', background: 'rgba(239,68,68,0.1)',
            cursor: 'pointer', padding: '4px 12px', borderRadius: '6px',
            fontSize: '12px', border: 'none', fontWeight: 500,
          }}
          onClick={handleClearAll}
        >
          Clear All
        </button>
      </div>

      {/* Notifications list */}
      <div className="al-table-wrap">
        {loading['audit'] && notifications.length === 0 ? (
          <div className="al-empty-state">
            <div className="al-empty-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.3">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
            </div>
            <div className="al-empty-text">Loading notifications...</div>
          </div>
        ) : notifications.length === 0 ? (
          <div className="al-empty-state">
            <div className="al-empty-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.3">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
            </div>
            <div className="al-empty-text">No notifications</div>
            <div className="al-empty-sub">
              Notifications will appear as executions run, alerts fire, and system events occur.
            </div>
          </div>
        ) : (
          <table className="al-table">
            <thead>
              <tr>
                <th style={{ width: '20px' }}></th>
                <th style={{ width: '130px' }}>When</th>
                <th style={{ width: '100px' }}>Category</th>
                <th style={{ width: '160px' }}>Action</th>
                <th>Message</th>
                <th style={{ width: '120px' }}>Actor</th>
                <th style={{ width: '80px' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {notifications.map(n => {
                const isRead = readSet.has(n.id);
                const color = ACTION_COLORS[n.action] || '#6b7280';
                const catColor = CATEGORY_COLORS[n.category] || '#6b7280';

                return (
                  <tr
                    key={n.id}
                    className={`al-row${!isRead ? ' al-row-expanded' : ''}`}
                    style={{
                      borderLeft: `3px solid ${color}`,
                      opacity: isRead ? 0.65 : 1,
                    }}
                  >
                    <td style={{ textAlign: 'center', fontSize: '14px' }}>
                      {!isRead && (
                        <span style={{
                          display: 'inline-block', width: '8px', height: '8px',
                          borderRadius: '50%', background: '#3b82f6',
                        }} />
                      )}
                    </td>
                    <td className="al-time-cell">
                      <span className="al-time-rel">{relativeTime(n.timestamp)}</span>
                      <span className="al-time-abs">{formatDateFull(n.timestamp)}</span>
                    </td>
                    <td>
                      <span
                        className="al-action-pill"
                        style={{
                          color: catColor,
                          background: `${catColor}1a`,
                          fontSize: '11px',
                          textTransform: 'capitalize',
                        }}
                      >
                        {n.category}
                      </span>
                    </td>
                    <td>
                      <span className="al-action-pill" style={{
                        color,
                        background: `${color}1a`,
                      }}>
                        <span className="al-action-icon">{ACTION_ICONS[n.action] || '\u2022'}</span>
                        {n.action}
                      </span>
                    </td>
                    <td>
                      <div style={{
                        fontSize: '12px', color: '#cbd5e1',
                        maxWidth: '400px', overflow: 'hidden',
                        textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }} title={n.message}>
                        {n.message}
                      </div>
                    </td>
                    <td>
                      <span style={{ fontSize: '12px', color: '#94a3b8' }}>{n.actor}</span>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <button
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer',
                          color: isRead ? '#6b7280' : '#3b82f6',
                          fontSize: '11px', padding: '2px 8px', borderRadius: '4px',
                          backgroundColor: isRead ? 'rgba(107,114,128,0.1)' : 'rgba(59,130,246,0.1)',
                        }}
                        onClick={() => isRead ? handleMarkUnread(n.id) : handleMarkRead(n.id)}
                        title={isRead ? 'Mark as unread' : 'Mark as read'}
                      >
                        {isRead ? 'Read' : 'Unread'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination (for audit-sourced entries) */}
      {totalPages > 1 && (
        <div className="al-pagination">
          <button
            className="al-page-btn"
            disabled={currentPage <= 1}
            onClick={() => setAuditOffset(Math.max(0, auditOffset - pageSize))}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <span className="al-page-info">Page {currentPage} of {totalPages}</span>
          <button
            className="al-page-btn"
            disabled={currentPage >= totalPages}
            onClick={() => setAuditOffset(auditOffset + pageSize)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
