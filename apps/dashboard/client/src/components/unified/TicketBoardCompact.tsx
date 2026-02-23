import { useEffect, useState } from 'react';
import { hubApi } from '../../hooks/useHubApi';
import type { Ticket } from '../../hooks/useHubApi';

export default function TicketBoardCompact() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTickets();
    const timer = setInterval(fetchTickets, 30000);
    return () => clearInterval(timer);
  }, []);

  const fetchTickets = async () => {
    try {
      const data = await hubApi.tickets.list({ limit: 10 });
      setTickets(data.tickets || []);
    } catch {
      // ignore
    }
    setLoading(false);
  };

  const openCount = tickets.filter((t) => t.status === 'open').length;
  const inProgressCount = tickets.filter((t) => t.status === 'in_progress').length;
  const resolvedToday = tickets.filter((t) => {
    if (t.status !== 'resolved') return false;
    const resolved = new Date(t.updated_at);
    const today = new Date();
    return resolved.toDateString() === today.toDateString();
  }).length;

  const statusBadgeClass = (status: string) => {
    switch (status) {
      case 'open': return 'ud-badge-open';
      case 'in_progress': return 'ud-badge-progress';
      case 'resolved': return 'ud-badge-resolved';
      default: return '';
    }
  };

  const priorityColor = (priority: string) => {
    switch (priority) {
      case 'urgent': return '#ef4444';
      case 'high': return '#f97316';
      case 'medium': return '#eab308';
      case 'low': return '#6b7280';
      default: return '#6b7280';
    }
  };

  return (
    <div className="ud-sidebar-panel">
      <div className="ud-sidebar-panel-header">
        <span>Tickets</span>
      </div>

      <div className="ud-ticket-summary">
        <span className="ud-ticket-stat">
          <span className="ud-ticket-num">{openCount}</span> open
        </span>
        <span className="ud-ticket-stat">
          <span className="ud-ticket-num">{inProgressCount}</span> prog
        </span>
        <span className="ud-ticket-stat">
          <span className="ud-ticket-num">{resolvedToday}</span> done
        </span>
      </div>

      <div className="ud-ticket-list">
        {loading && <div className="ud-empty">Loading...</div>}
        {!loading && tickets.length === 0 && <div className="ud-empty">No tickets</div>}
        {tickets.slice(0, 8).map((ticket) => (
          <div key={ticket.id} className="ud-ticket-row">
            <span
              className="ud-ticket-priority"
              style={{ background: priorityColor(ticket.priority) }}
            />
            <span className="ud-ticket-title" title={ticket.title}>
              {ticket.title}
            </span>
            <span className={`ud-ticket-badge ${statusBadgeClass(ticket.status)}`}>
              {ticket.status === 'in_progress' ? 'prog' : ticket.status}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
