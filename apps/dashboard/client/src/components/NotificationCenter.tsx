import { useState, useEffect, useRef, useCallback } from 'react';

interface Notification {
  id: string;
  title: string;
  message: string;
  type: 'info' | 'warning' | 'error' | 'success';
  timestamp: number;
  read: boolean;
}

const MAX_NOTIFICATIONS = 50;

export default function NotificationCenter() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const unreadCount = notifications.filter(n => !n.read).length;
  const seenIdsRef = useRef(new Set<string>());

  // Listen for WebSocket events via the global event bus
  useEffect(() => {
    const handler = (e: CustomEvent) => {
      const event = e.detail;
      if (!event?.type) return;

      // Only notify on important events
      let notification: Notification | null = null;
      const id = `${event.id || Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

      if (seenIdsRef.current.has(event.id)) return;
      if (event.id) seenIdsRef.current.add(event.id);

      const agent = event.agentName || event.agentId || 'System';
      const msg = event.data?.message || event.data?.output?.slice(0, 100) || '';

      if (event.type === 'failed') {
        notification = {
          id, title: `${agent} failed`, message: msg || 'Execution failed',
          type: 'error', timestamp: Date.now(), read: false,
        };
      } else if (event.type === 'completed' && event.category === 'execution') {
        notification = {
          id, title: `${agent} completed`, message: msg || 'Task finished',
          type: 'success', timestamp: Date.now(), read: false,
        };
      }

      if (notification) {
        setNotifications(prev => [notification!, ...prev].slice(0, MAX_NOTIFICATIONS));
      }
    };

    window.addEventListener('forge-event' as string, handler as EventListener);
    return () => window.removeEventListener('forge-event' as string, handler as EventListener);
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [dropdownOpen]);

  const handleNotificationClick = (id: string) => {
    setNotifications(prev =>
      prev.map(n => n.id === id ? { ...n, read: true } : n)
    );
  };

  const handleClearAll = () => {
    setNotifications([]);
    setDropdownOpen(false);
  };

  const handleMarkAllRead = useCallback(() => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  }, []);

  const getTypeColor = (type: Notification['type']) => {
    switch (type) {
      case 'error': return '#ef4444';
      case 'warning': return '#f59e0b';
      case 'success': return '#22c55e';
      default: return '#3b82f6';
    }
  };

  const relTime = (ts: number) => {
    const diff = Date.now() - ts;
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    return `${Math.floor(diff / 3600000)}h ago`;
  };

  return (
    <div className="ud-notification-center" ref={menuRef}>
      <button
        className="ud-notification-btn"
        onClick={() => { setDropdownOpen(!dropdownOpen); if (!dropdownOpen) handleMarkAllRead(); }}
        aria-label="Notifications"
        aria-expanded={dropdownOpen}
        aria-haspopup="menu"
        title={`${unreadCount} unread notifications`}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unreadCount > 0 && (
          <span className="ud-notification-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>
        )}
      </button>

      {dropdownOpen && (
        <div className="ud-notification-dropdown" role="menu" aria-label="Notifications">
          <div className="ud-notification-header">
            <span className="ud-notification-title">Notifications</span>
            {notifications.length > 0 && (
              <button className="ud-notification-clear" onClick={handleClearAll} aria-label="Clear all">
                Clear
              </button>
            )}
          </div>
          <div className="ud-notification-list">
            {notifications.length === 0 ? (
              <div className="ud-notification-empty">No notifications</div>
            ) : (
              notifications.map(notification => (
                <div
                  key={notification.id}
                  className={`ud-notification-item${notification.read ? '' : ' ud-notification-unread'}`}
                  onClick={() => handleNotificationClick(notification.id)}
                  role="menuitem"
                >
                  <span
                    className="ud-notification-dot"
                    style={{ background: getTypeColor(notification.type) }}
                    aria-hidden="true"
                  />
                  <div className="ud-notification-content">
                    <div className="ud-notification-item-title">{notification.title}</div>
                    <div className="ud-notification-item-message">{notification.message}</div>
                    <div className="ud-notification-item-time">{relTime(notification.timestamp)}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
