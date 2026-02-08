import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import './Tickets.css';

const API_BASE = window.location.hostname.includes('askalf.org')
  ? ''
  : 'http://localhost:3001';

interface AgentTask {
  id: string;
  status: string;
  type: string;
  started_at: string | null;
  completed_at: string | null;
}

interface Ticket {
  id: string;
  title: string;
  description: string;
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  category: string;
  created_by: string;
  assigned_to?: string;
  agent_id?: string;
  agent_name?: string;
  is_agent_ticket?: boolean;
  source?: string;
  task?: AgentTask | null;
  created_at: string;
  updated_at: string;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

const PRIORITY_COLORS: Record<string, string> = {
  low: '#6b7280',
  medium: '#f59e0b',
  high: '#ef4444',
  urgent: '#dc2626',
};

const STATUS_COLORS: Record<string, string> = {
  open: '#3b82f6',
  in_progress: '#f59e0b',
  resolved: '#10b981',
  closed: '#6b7280',
};

export default function Tickets() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'open' | 'mine'>('all');
  const [source, setSource] = useState<'all' | 'human' | 'agent'>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newTicket, setNewTicket] = useState<{
    title: string;
    description: string;
    priority: Ticket['priority'];
    category: string;
  }>({
    title: '',
    description: '',
    priority: 'medium',
    category: 'bug',
  });
  const [creating, setCreating] = useState(false);
  const [showDetail, setShowDetail] = useState<Ticket | null>(null);

  // Handle query params
  useEffect(() => {
    const createParam = searchParams.get('create');
    const sourceParam = searchParams.get('source');

    if (createParam) {
      setNewTicket(prev => ({ ...prev, category: createParam }));
      setShowCreate(true);
      setSearchParams({}, { replace: true });
    }

    if (sourceParam === 'agent' || sourceParam === 'human') {
      setSource(sourceParam);
      // Clear the source param from URL but keep source state
      const newParams = new URLSearchParams(searchParams);
      newParams.delete('source');
      if (newParams.toString()) {
        setSearchParams(newParams, { replace: true });
      }
    }
  }, [searchParams, setSearchParams]);

  const fetchTickets = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/admin/tickets?filter=${filter}&source=${source}&page=${currentPage}&limit=20`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setTickets(data.tickets || []);
        setPagination(data.pagination || null);
      }
    } catch (err) {
      console.error('Failed to fetch tickets:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTickets();
  }, [filter, source, currentPage]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [filter, source]);

  const createTicket = async () => {
    if (!newTicket.title.trim()) return;
    setCreating(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/admin/tickets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(newTicket),
      });
      if (res.ok) {
        setShowCreate(false);
        setNewTicket({ title: '', description: '', priority: 'medium', category: 'bug' });
        fetchTickets();
      }
    } catch (err) {
      console.error('Failed to create ticket:', err);
    } finally {
      setCreating(false);
    }
  };

  const updateTicketStatus = async (ticketId: string, status: Ticket['status']) => {
    try {
      await fetch(`${API_BASE}/api/v1/admin/tickets/${ticketId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status }),
      });
      fetchTickets();
      if (showDetail?.id === ticketId) {
        setShowDetail({ ...showDetail, status });
      }
    } catch (err) {
      console.error('Failed to update ticket:', err);
    }
  };

  const updateTicket = async (ticketId: string, updates: Partial<Ticket>) => {
    try {
      await fetch(`${API_BASE}/api/v1/admin/tickets/${ticketId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(updates),
      });
      fetchTickets();
      if (showDetail?.id === ticketId) {
        setShowDetail({ ...showDetail, ...updates });
      }
    } catch (err) {
      console.error('Failed to update ticket:', err);
    }
  };

  const deleteTicket = async (ticketId: string) => {
    if (!confirm('Delete this ticket? This cannot be undone.')) return;
    try {
      await fetch(`${API_BASE}/api/v1/admin/tickets/${ticketId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      setShowDetail(null);
      fetchTickets();
    } catch (err) {
      console.error('Failed to delete ticket:', err);
    }
  };

  const openTicketDetail = (ticket: Ticket) => {
    setShowDetail(ticket);
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="tickets-page">
      <header className="tickets-header">
        <div className="header-left">
          <button className="back-btn" onClick={() => navigate('/app/chat')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h1>Agent Hub - Tickets</h1>
            <p className="header-subtitle">Internal task tracking and issue management</p>
          </div>
        </div>
        <div className="header-actions">
          <button className="create-btn" onClick={() => setShowCreate(true)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
              <path d="M12 5v14M5 12h14" />
            </svg>
            New Ticket
          </button>
        </div>
      </header>

      {/* Source Tabs - Agent vs Human */}
      <div className="source-tabs">
        <button
          className={source === 'all' ? 'active' : ''}
          onClick={() => setSource('all')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
            <rect x="3" y="3" width="7" height="7" />
            <rect x="14" y="3" width="7" height="7" />
            <rect x="14" y="14" width="7" height="7" />
            <rect x="3" y="14" width="7" height="7" />
          </svg>
          All Tickets
        </button>
        <button
          className={source === 'human' ? 'active' : ''}
          onClick={() => setSource('human')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
            <circle cx="12" cy="8" r="4" />
            <path d="M6 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" />
          </svg>
          Human
        </button>
        <button
          className={source === 'agent' ? 'active' : ''}
          onClick={() => setSource('agent')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          Agent
        </button>
      </div>

      {/* Status Filter */}
      <div className="filter-bar">
        <div className="filter-tabs">
          <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>All</button>
          <button className={filter === 'open' ? 'active' : ''} onClick={() => setFilter('open')}>Open</button>
          <button className={filter === 'mine' ? 'active' : ''} onClick={() => setFilter('mine')}>Assigned to Me</button>
        </div>
      </div>

      {/* Create Ticket Modal */}
      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h2>Create Ticket</h2>
            <div className="form-group">
              <label>Title</label>
              <input
                type="text"
                value={newTicket.title}
                onChange={e => setNewTicket({ ...newTicket, title: e.target.value })}
                placeholder="Brief description of the issue"
              />
            </div>
            <div className="form-group">
              <label>Description</label>
              <textarea
                value={newTicket.description}
                onChange={e => setNewTicket({ ...newTicket, description: e.target.value })}
                placeholder="Detailed description, steps to reproduce, etc."
                rows={4}
              />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Category</label>
                <select value={newTicket.category} onChange={e => setNewTicket({ ...newTicket, category: e.target.value })}>
                  <option value="bug">Bug</option>
                  <option value="feature">Feature Request</option>
                  <option value="improvement">Improvement</option>
                  <option value="task">Task</option>
                  <option value="question">Question</option>
                </select>
              </div>
              <div className="form-group">
                <label>Priority</label>
                <select value={newTicket.priority} onChange={e => setNewTicket({ ...newTicket, priority: e.target.value as Ticket['priority'] })}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
            </div>
            <div className="modal-actions">
              <button className="cancel-btn" onClick={() => setShowCreate(false)}>Cancel</button>
              <button className="submit-btn" onClick={createTicket} disabled={creating || !newTicket.title.trim()}>
                {creating ? 'Creating...' : 'Create Ticket'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Ticket Detail Modal */}
      {showDetail && (
        <div className="modal-overlay" onClick={() => setShowDetail(null)}>
          <div className="modal-content ticket-detail-modal" onClick={e => e.stopPropagation()}>
            <div className="detail-header">
              <div className="detail-header-left">
                <span className="ticket-id">#{showDetail.id.slice(0, 8)}</span>
                {showDetail.is_agent_ticket && (
                  <span className="ticket-source agent">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                    {showDetail.agent_name || 'Agent'}
                  </span>
                )}
              </div>
              <button className="close-btn" onClick={() => setShowDetail(null)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            <h2 className="detail-title">{showDetail.title}</h2>

            <div className="detail-meta">
              <div className="meta-row">
                <label>Status</label>
                <select
                  value={showDetail.status}
                  onChange={e => updateTicketStatus(showDetail.id, e.target.value as Ticket['status'])}
                  className="status-select"
                  style={{ borderColor: STATUS_COLORS[showDetail.status] }}
                >
                  <option value="open">Open</option>
                  <option value="in_progress">In Progress</option>
                  <option value="resolved">Resolved</option>
                  <option value="closed">Closed</option>
                </select>
              </div>
              <div className="meta-row">
                <label>Priority</label>
                <select
                  value={showDetail.priority}
                  onChange={e => updateTicket(showDetail.id, { priority: e.target.value as Ticket['priority'] })}
                  className="priority-select"
                  style={{ borderColor: PRIORITY_COLORS[showDetail.priority] }}
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
              <div className="meta-row">
                <label>Category</label>
                <span className="ticket-category">{showDetail.category}</span>
              </div>
              <div className="meta-row">
                <label>Created</label>
                <span>{formatDate(showDetail.created_at)}</span>
              </div>
              {showDetail.assigned_to && (
                <div className="meta-row">
                  <label>Assigned To</label>
                  <span className="ticket-assignee">@{showDetail.assigned_to}</span>
                </div>
              )}
            </div>

            {/* Linked Task Info */}
            {showDetail.task && (
              <div className="task-info-section">
                <h3>Linked Agent Task</h3>
                <div className="task-info-grid">
                  <div className="task-info-item">
                    <label>Task ID</label>
                    <span className="task-id">#{showDetail.task.id.slice(0, 8)}</span>
                  </div>
                  <div className="task-info-item">
                    <label>Task Type</label>
                    <span className="task-type">{showDetail.task.type}</span>
                  </div>
                  <div className="task-info-item">
                    <label>Task Status</label>
                    <span className={`task-status ${showDetail.task.status}`}>{showDetail.task.status}</span>
                  </div>
                  {showDetail.task.started_at && (
                    <div className="task-info-item">
                      <label>Started</label>
                      <span>{formatDate(showDetail.task.started_at)}</span>
                    </div>
                  )}
                  {showDetail.task.completed_at && (
                    <div className="task-info-item">
                      <label>Completed</label>
                      <span>{formatDate(showDetail.task.completed_at)}</span>
                    </div>
                  )}
                  {showDetail.task.started_at && showDetail.task.completed_at && (
                    <div className="task-info-item">
                      <label>Duration</label>
                      <span>{Math.round((new Date(showDetail.task.completed_at).getTime() - new Date(showDetail.task.started_at).getTime()) / 1000)}s</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="detail-description">
              <label>Description / Report</label>
              <div className="description-content">
                {showDetail.description ? (
                  <pre>{showDetail.description}</pre>
                ) : (
                  <p className="no-description">No description provided</p>
                )}
              </div>
            </div>

            <div className="detail-actions">
              <button className="delete-btn" onClick={() => deleteTicket(showDetail.id)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                  <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                </svg>
                Delete
              </button>
              <button className="close-detail-btn" onClick={() => setShowDetail(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Tickets List */}
      <div className="tickets-content">
        {loading ? (
          <div className="tickets-loading">Loading tickets...</div>
        ) : tickets.length === 0 ? (
          <div className="tickets-empty">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="48" height="48">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
            <h3>No {source !== 'all' ? source : ''} tickets found</h3>
            <p>
              {source === 'agent'
                ? 'No tickets from agents yet. Agents will create tickets when they need human intervention.'
                : source === 'human'
                ? 'No human tickets found. Create one to track tasks, bugs, or feature requests.'
                : 'Create a new ticket to track tasks, bugs, or feature requests.'}
            </p>
          </div>
        ) : (
          <>
            <div className="tickets-list">
              {tickets.map(ticket => (
                <div
                  key={ticket.id}
                  className={`ticket-card ${ticket.is_agent_ticket ? 'agent-ticket' : ''} clickable`}
                  onClick={() => openTicketDetail(ticket)}
                >
                  <div className="ticket-header">
                    <span className="ticket-id">#{ticket.id.slice(0, 8)}</span>
                    {ticket.is_agent_ticket && (
                      <span className="ticket-source agent">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                        </svg>
                        {ticket.agent_name || 'Agent'}
                      </span>
                    )}
                    <span className="ticket-category">{ticket.category}</span>
                    <span
                      className="ticket-priority"
                      style={{ background: PRIORITY_COLORS[ticket.priority] }}
                    >
                      {ticket.priority}
                    </span>
                  </div>
                  <h3 className="ticket-title">{ticket.title}</h3>
                  {ticket.description && (
                    <p className="ticket-description">{ticket.description.slice(0, 150)}{ticket.description.length > 150 ? '...' : ''}</p>
                  )}
                  <div className="ticket-footer">
                    <div className="ticket-meta">
                      <span className="ticket-date">{formatDate(ticket.created_at)}</span>
                      {ticket.assigned_to && <span className="ticket-assignee">@{ticket.assigned_to}</span>}
                      {!ticket.is_agent_ticket && ticket.created_by && (
                        <span className="ticket-creator">by {ticket.created_by}</span>
                      )}
                    </div>
                    <div className="ticket-actions">
                      <select
                        className="status-select"
                        value={ticket.status}
                        onChange={e => {
                          e.stopPropagation();
                          updateTicketStatus(ticket.id, e.target.value as Ticket['status']);
                        }}
                        onClick={e => e.stopPropagation()}
                        style={{ borderColor: STATUS_COLORS[ticket.status] }}
                      >
                        <option value="open">Open</option>
                        <option value="in_progress">In Progress</option>
                        <option value="resolved">Resolved</option>
                        <option value="closed">Closed</option>
                      </select>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination */}
            {pagination && pagination.totalPages > 1 && (
              <div className="tickets-pagination">
                <button
                  disabled={!pagination.hasPrev}
                  onClick={() => setCurrentPage(currentPage - 1)}
                >
                  ← Prev
                </button>
                <span className="page-info">
                  Page {pagination.page} of {pagination.totalPages}
                  <span className="total-count">({pagination.total} total)</span>
                </span>
                <button
                  disabled={!pagination.hasNext}
                  onClick={() => setCurrentPage(currentPage + 1)}
                >
                  Next →
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
