import { useState, useEffect, useRef, useCallback } from 'react';
import { useHubStore } from '../../stores/hub';
import { usePolling } from '../../hooks/usePolling';
import StatusBadge from './shared/StatusBadge';
import PaginationBar from './shared/PaginationBar';
import FilterBar from './shared/FilterBar';
import Modal from './shared/Modal';
import EmptyState from './shared/EmptyState';
import type { Ticket } from '../../hooks/useHubApi';

const PRIORITY_COLORS: Record<string, string> = {
  low: '#6b7280',
  medium: '#f59e0b',
  high: '#ef4444',
  urgent: '#dc2626',
};

const formatDate = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

export default function TicketSystem() {
  const tickets = useHubStore((s) => s.tickets);
  const pagination = useHubStore((s) => s.ticketPagination);
  const page = useHubStore((s) => s.ticketPage);
  const filter = useHubStore((s) => s.ticketFilter);
  const source = useHubStore((s) => s.ticketSource);
  const search = useHubStore((s) => s.ticketSearch);
  const showCreateTicket = useHubStore((s) => s.showCreateTicket);
  const showTicketDetail = useHubStore((s) => s.showTicketDetail);
  const loading = useHubStore((s) => s.loading);

  const setPage = useHubStore((s) => s.setTicketPage);
  const setFilter = useHubStore((s) => s.setTicketFilter);
  const setSource = useHubStore((s) => s.setTicketSource);
  const setSearch = useHubStore((s) => s.setTicketSearch);
  const setShowCreateTicket = useHubStore((s) => s.setShowCreateTicket);
  const setShowTicketDetail = useHubStore((s) => s.setShowTicketDetail);
  const fetchTickets = useHubStore((s) => s.fetchTickets);
  const createTicket = useHubStore((s) => s.createTicket);
  const updateTicket = useHubStore((s) => s.updateTicket);
  const deleteTicket = useHubStore((s) => s.deleteTicket);

  const [newTicket, setNewTicket] = useState({ title: '', description: '', priority: 'medium', category: 'bug' });
  const [creating, setCreating] = useState(false);
  const [searchDebounce, setSearchDebounce] = useState('');

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setSearchDebounce(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Fetch when filters change
  useEffect(() => {
    fetchTickets();
  }, [filter, source, page, searchDebounce, fetchTickets]);

  // Auto-refresh so agent-created tickets appear without a full reload
  const poll = useCallback(() => { fetchTickets(); }, [fetchTickets]);
  usePolling(poll, 15000);

  // Also update hub store search for API call
  useEffect(() => {
    if (searchDebounce !== search) {
      // debounce handled above
    }
  }, [searchDebounce]);

  const handleCreate = async () => {
    if (!newTicket.title.trim()) return;
    setCreating(true);
    const ok = await createTicket(newTicket);
    if (ok) {
      setShowCreateTicket(false);
      setNewTicket({ title: '', description: '', priority: 'medium', category: 'bug' });
    }
    setCreating(false);
  };

  return (
    <>
      {/* Source Tabs + Filters */}
      <FilterBar
        tabs={[
          { value: 'all', label: 'All Tickets', active: source === 'all', onClick: () => setSource('all') },
          { value: 'human', label: 'Human', active: source === 'human', onClick: () => setSource('human') },
          { value: 'agent', label: 'Agent', active: source === 'agent', onClick: () => setSource('agent') },
        ]}
        searchValue={search}
        searchPlaceholder="Search tickets..."
        onSearchChange={setSearch}
      />

      <FilterBar
        tabs={[
          { value: 'open', label: 'Active', active: filter === 'open', onClick: () => setFilter('open') },
          { value: 'all', label: 'All', active: filter === 'all', onClick: () => setFilter('all') },
          { value: 'resolved', label: 'Resolved', active: filter === 'resolved', onClick: () => setFilter('resolved') },
          { value: 'critical', label: 'Critical', active: filter === 'critical', onClick: () => setFilter('critical') },
        ]}
      />

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 'var(--space-md)' }}>
        <button className="hub-btn hub-btn--primary" onClick={() => setShowCreateTicket(true)}>
          New Ticket
        </button>
      </div>

      {/* Tickets List */}
      {loading.tickets ? (
        <div className="hub-loading">Loading tickets...</div>
      ) : tickets.length === 0 ? (
        <EmptyState
          icon="✅"
          title={`No ${source !== 'all' ? source : ''} tickets found`}
          message={
            source === 'agent'
              ? 'No tickets from agents yet.'
              : 'Create a new ticket to track tasks, bugs, or feature requests.'
          }
          action={{ label: 'New Ticket', onClick: () => setShowCreateTicket(true) }}
        />
      ) : (
        <div className="hub-ticket-list">
          {tickets.map((ticket) => (
            <div
              key={ticket.id}
              className="hub-ticket-card"
              onClick={() => setShowTicketDetail(ticket)}
            >
              <div className="hub-ticket-header">
                <span className="hub-ticket-id">#{ticket.id.slice(0, 8)}</span>
                {ticket.is_agent_ticket && (
                  <span className="hub-ticket-source">{ticket.agent_name || 'Agent'}</span>
                )}
                <span className="hub-ticket-category">{ticket.category}</span>
                <span className="hub-ticket-priority" style={{ background: PRIORITY_COLORS[ticket.priority] }}>
                  {ticket.priority}
                </span>
              </div>
              <h3 className="hub-ticket-title">{ticket.title}</h3>
              {ticket.description && (
                <p className="hub-ticket-desc">
                  {ticket.description.slice(0, 150)}{ticket.description.length > 150 ? '...' : ''}
                </p>
              )}
              <div className="hub-ticket-footer">
                <div className="hub-ticket-meta">
                  <span>{formatDate(ticket.created_at)}</span>
                  {ticket.assigned_to && <span className="hub-ticket-assignee">@{ticket.assigned_to}</span>}
                </div>
                <div onClick={(e) => e.stopPropagation()}>
                  <select
                    value={ticket.status}
                    onChange={(e) => updateTicket(ticket.id, { status: e.target.value as Ticket['status'] })}
                    style={{ padding: '4px 8px', fontSize: '0.75rem', background: 'var(--deep)', border: '1px solid var(--border)', borderRadius: '4px', color: 'var(--text)' }}
                  >
                    <option value="open">Open</option>
                    <option value="in_progress">In Progress</option>
                    <option value="resolved">Resolved</option>
                  </select>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <PaginationBar pagination={pagination} currentPage={page} onPageChange={setPage} />

      {/* Create Ticket Modal */}
      {showCreateTicket && (
        <Modal title="Create Ticket" onClose={() => setShowCreateTicket(false)}>
          <div className="hub-form-group">
            <label>Title</label>
            <input
              type="text"
              value={newTicket.title}
              onChange={(e) => setNewTicket({ ...newTicket, title: e.target.value })}
              placeholder="Brief description of the issue"
            />
          </div>
          <div className="hub-form-group">
            <label>Description</label>
            <textarea
              value={newTicket.description}
              onChange={(e) => setNewTicket({ ...newTicket, description: e.target.value })}
              placeholder="Detailed description, steps to reproduce, etc."
              rows={4}
            />
          </div>
          <div className="hub-form-row">
            <div className="hub-form-group">
              <label>Category</label>
              <select value={newTicket.category} onChange={(e) => setNewTicket({ ...newTicket, category: e.target.value })}>
                <option value="bug">Bug</option>
                <option value="feature">Feature Request</option>
                <option value="improvement">Improvement</option>
                <option value="task">Task</option>
                <option value="question">Question</option>
              </select>
            </div>
            <div className="hub-form-group">
              <label>Priority</label>
              <select value={newTicket.priority} onChange={(e) => setNewTicket({ ...newTicket, priority: e.target.value })}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
          </div>
          <div className="hub-modal-actions">
            <button className="hub-btn" onClick={() => setShowCreateTicket(false)}>Cancel</button>
            <button className="hub-btn hub-btn--primary" onClick={handleCreate} disabled={creating || !newTicket.title.trim()}>
              {creating ? 'Creating...' : 'Create Ticket'}
            </button>
          </div>
        </Modal>
      )}

      {/* Ticket Detail Modal */}
      {showTicketDetail && (
        <TicketDetailModal
          ticket={showTicketDetail}
          onClose={() => setShowTicketDetail(null)}
          onUpdate={updateTicket}
          onDelete={deleteTicket}
        />
      )}
    </>
  );
}

function TicketDetailModal({
  ticket,
  onClose,
  onUpdate,
  onDelete,
}: {
  ticket: Ticket;
  onClose: () => void;
  onUpdate: (id: string, updates: Partial<Ticket>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const ticketNotes = useHubStore((s) => s.ticketNotes);
  const ticketNotesLoading = useHubStore((s) => s.ticketNotesLoading);
  const fetchTicketNotes = useHubStore((s) => s.fetchTicketNotes);
  const addTicketNote = useHubStore((s) => s.addTicketNote);

  const [noteText, setNoteText] = useState('');
  const [saving, setSaving] = useState(false);
  const notesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchTicketNotes(ticket.id);
  }, [ticket.id, fetchTicketNotes]);

  useEffect(() => {
    if (notesEndRef.current) {
      notesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [ticketNotes.length]);

  const handleAddNote = async () => {
    if (!noteText.trim() || saving) return;
    setSaving(true);
    const ok = await addTicketNote(ticket.id, noteText.trim());
    if (ok) setNoteText('');
    setSaving(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleAddNote();
    }
  };

  return (
    <Modal title={ticket.title} onClose={onClose} size="large">
      <div className="hub-ticket-detail-meta">
        <label>Status</label>
        <select
          value={ticket.status}
          onChange={(e) => onUpdate(ticket.id, { status: e.target.value as Ticket['status'] })}
        >
          <option value="open">Open</option>
          <option value="in_progress">In Progress</option>
          <option value="resolved">Resolved</option>
        </select>

        <label>Priority</label>
        <select
          value={ticket.priority}
          onChange={(e) => onUpdate(ticket.id, { priority: e.target.value as Ticket['priority'] })}
        >
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="urgent">Urgent</option>
        </select>

        <label>Category</label>
        <span>{ticket.category}</span>

        <label>Created</label>
        <span>{formatDate(ticket.created_at)}</span>

        {ticket.assigned_to && (
          <>
            <label>Assigned To</label>
            <span className="hub-ticket-assignee">@{ticket.assigned_to}</span>
          </>
        )}
      </div>

      {ticket.task && (
        <div className="hub-ticket-task-info">
          <h3>Linked Agent Task</h3>
          <div className="hub-ticket-task-grid">
            <div><label>Task ID</label><div>#{ticket.task.id.slice(0, 8)}</div></div>
            <div><label>Type</label><div>{ticket.task.type}</div></div>
            <div><label>Status</label><div><StatusBadge status={ticket.task.status} /></div></div>
            {ticket.task.started_at && <div><label>Started</label><div>{formatDate(ticket.task.started_at)}</div></div>}
            {ticket.task.completed_at && <div><label>Completed</label><div>{formatDate(ticket.task.completed_at)}</div></div>}
          </div>
        </div>
      )}

      <div className="hub-ticket-detail-desc">
        <label>Description / Report</label>
        {ticket.description ? (
          <pre>{ticket.description}</pre>
        ) : (
          <p className="hub-no-data">No description provided</p>
        )}
      </div>

      {ticket.resolution && (
        <div className="hub-ticket-detail-resolution">
          <label>Resolution</label>
          <pre>{ticket.resolution}</pre>
          {ticket.status === 'resolved' && ticket.updated_at && (
            <span className="hub-ticket-resolved-at">Resolved {formatDate(ticket.updated_at)}</span>
          )}
        </div>
      )}

      {/* Notes Section */}
      <div className="hub-ticket-notes">
        <label>Notes</label>
        <div className="hub-ticket-notes-list">
          {ticketNotesLoading ? (
            <p className="hub-no-data">Loading notes...</p>
          ) : ticketNotes.length === 0 ? (
            <p className="hub-no-data">No notes yet</p>
          ) : (
            ticketNotes.map((note) => (
              <div key={note.id} className="hub-ticket-note">
                <div className="hub-ticket-note-header">
                  <span className="hub-ticket-note-author">{note.author}</span>
                  <span className="hub-ticket-note-time">{formatDate(note.created_at)}</span>
                </div>
                <div className="hub-ticket-note-content">{note.content}</div>
              </div>
            ))
          )}
          <div ref={notesEndRef} />
        </div>
        <div className="hub-ticket-note-input">
          <textarea
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Add a note... (Ctrl+Enter to save)"
            rows={2}
          />
          <button
            className="hub-btn hub-btn--primary"
            onClick={handleAddNote}
            disabled={saving || !noteText.trim()}
          >
            {saving ? 'Saving...' : 'Add Note'}
          </button>
        </div>
      </div>

      <div className="hub-modal-actions">
        <button className="hub-btn hub-btn--danger" onClick={() => { if (confirm('Delete this ticket?')) onDelete(ticket.id); }}>
          Delete
        </button>
        <button className="hub-btn" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}
