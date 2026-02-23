import { useEffect, useRef, useState } from 'react';

interface ActivityEvent {
  category: string;
  type: string;
  receivedAt: number;
  agentName?: string;
  agentId?: string;
  ticketId?: string;
  status?: string;
  message?: string;
  [key: string]: unknown;
}

interface LiveActivityFeedProps {
  events: ActivityEvent[];
}

export default function LiveActivityFeed({ events }: LiveActivityFeedProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Auto-scroll to top (newest first)
  useEffect(() => {
    if (autoScroll && listRef.current) {
      listRef.current.scrollTop = 0;
    }
  }, [events, autoScroll]);

  const handleScroll = () => {
    if (listRef.current) {
      setAutoScroll(listRef.current.scrollTop < 10);
    }
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
  };

  const categoryColors: Record<string, string> = {
    execution: '#3b82f6',
    agent: '#22c55e',
    ticket: '#eab308',
    deploy: '#a78bfa',
    scheduler: '#06b6d4',
  };

  const eventIcon = (category: string, status?: string) => {
    if (status === 'completed' || status === 'success') return '✓';
    if (status === 'failed' || status === 'error') return '✗';
    if (status === 'running' || status === 'started') return '→';
    if (category === 'ticket') return '▪';
    if (category === 'scheduler') return '◎';
    return '•';
  };

  const eventLabel = (ev: ActivityEvent) => {
    const name = ev.agentName || ev.agentId || '';
    const ticket = ev.ticketId || '';
    if (ev.message) return ev.message;
    if (name && ticket) return `${name} ${ticket}`;
    if (name) return `${name} ${ev.type || ev.status || ''}`;
    return `${ev.category} ${ev.type || ''}`;
  };

  return (
    <div className="ud-sidebar-panel">
      <div className="ud-sidebar-panel-header">
        <span>Live Activity</span>
        {!autoScroll && (
          <button className="ud-scroll-btn" onClick={() => setAutoScroll(true)}>↑ New</button>
        )}
      </div>
      <div className="ud-activity-list" ref={listRef} onScroll={handleScroll}>
        {events.length === 0 && (
          <div className="ud-empty">No recent activity</div>
        )}
        {events.map((ev, i) => (
          <div key={`${ev.receivedAt}-${i}`} className="ud-activity-row">
            <span className="ud-activity-time">{formatTime(ev.receivedAt)}</span>
            <span
              className="ud-activity-icon"
              style={{ color: categoryColors[ev.category] || '#6b7280' }}
            >
              {eventIcon(ev.category, ev.status as string | undefined)}
            </span>
            <span className="ud-activity-label">{eventLabel(ev)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
