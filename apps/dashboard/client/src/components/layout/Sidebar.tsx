import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/auth';
import { useChatStore, type Conversation } from '../../stores/chat';
import { useBugReport } from '../../contexts/BugReportContext';
import { useEffect, useState, useRef, useCallback } from 'react';

function groupConversations(conversations: Conversation[]) {
  const now = new Date();
  const today: Conversation[] = [];
  const yesterday: Conversation[] = [];
  const lastWeek: Conversation[] = [];
  const older: Conversation[] = [];

  conversations.forEach((conv) => {
    const daysDiff = Math.floor(
      (now.getTime() - conv.updatedAt.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (daysDiff === 0) today.push(conv);
    else if (daysDiff === 1) yesterday.push(conv);
    else if (daysDiff <= 7) lastWeek.push(conv);
    else older.push(conv);
  });

  return { today, yesterday, lastWeek, older };
}

interface SidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
}

export default function Sidebar({ isOpen, onClose }: SidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const { conversations, loadConversations, createConversation, deleteConversation, renameConversation } = useChatStore();
  const { openBugReport } = useBugReport();

  const handleLogout = useCallback(async () => {
    await logout();
    window.location.href = '/';
  }, [logout]);

  useEffect(() => {
    // Reload conversations when user changes (e.g., after auth completes)
    if (user) {
      loadConversations();
    }
  }, [user, loadConversations]);

  const handleDelete = async (id: string) => {
    await deleteConversation(id);
    if (location.pathname === `/app/chat/${id}`) {
      navigate('/app/chat');
    }
  };

  const handleRename = async (id: string, newTitle: string) => {
    await renameConversation(id, newTitle);
  };

  const groups = groupConversations(conversations);

  const handleNewChat = () => {
    createConversation();
    navigate('/app/chat');
  };

  const getInitials = (name?: string, email?: string) => {
    if (name) return name.charAt(0).toUpperCase();
    if (email) return email.charAt(0).toUpperCase();
    return '?';
  };

  return (
    <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
      <div className="sidebar-header">
        <button className="sidebar-new-chat" onClick={handleNewChat}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12h14" />
          </svg>
          New Chat
        </button>
        {/* Mobile close button */}
        <button className="sidebar-close-btn" onClick={onClose} aria-label="Close menu">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <nav className="sidebar-conversations">
        {groups.today.length > 0 && (
          <>
            <div className="sidebar-section-title">Today</div>
            {groups.today.map((conv) => (
              <ConversationItem
                key={conv.id}
                conversation={conv}
                isActive={location.pathname === `/app/chat/${conv.id}`}
                onDelete={() => handleDelete(conv.id)}
                onRename={(title) => handleRename(conv.id, title)}
              />
            ))}
          </>
        )}

        {groups.yesterday.length > 0 && (
          <>
            <div className="sidebar-section-title">Yesterday</div>
            {groups.yesterday.map((conv) => (
              <ConversationItem
                key={conv.id}
                conversation={conv}
                isActive={location.pathname === `/app/chat/${conv.id}`}
                onDelete={() => handleDelete(conv.id)}
                onRename={(title) => handleRename(conv.id, title)}
              />
            ))}
          </>
        )}

        {groups.lastWeek.length > 0 && (
          <>
            <div className="sidebar-section-title">Last 7 Days</div>
            {groups.lastWeek.map((conv) => (
              <ConversationItem
                key={conv.id}
                conversation={conv}
                isActive={location.pathname === `/app/chat/${conv.id}`}
                onDelete={() => handleDelete(conv.id)}
                onRename={(title) => handleRename(conv.id, title)}
              />
            ))}
          </>
        )}

        {groups.older.length > 0 && (
          <>
            <div className="sidebar-section-title">Older</div>
            {groups.older.map((conv) => (
              <ConversationItem
                key={conv.id}
                conversation={conv}
                isActive={location.pathname === `/app/chat/${conv.id}`}
                onDelete={() => handleDelete(conv.id)}
                onRename={(title) => handleRename(conv.id, title)}
              />
            ))}
          </>
        )}
      </nav>

      <div className="sidebar-footer">
        {/* Admin Dashboard Link */}
        {(user?.role === 'admin' || user?.role === 'super_admin') && (
          <div className="sidebar-admin-links">
            <div className="sidebar-section-title admin-title">Admin</div>
            <Link to="/admin/hub/agents" className={`sidebar-admin-link ${location.pathname.startsWith('/admin') ? 'active' : ''}`}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                <rect x="3" y="3" width="7" height="7" />
                <rect x="14" y="3" width="7" height="7" />
                <rect x="14" y="14" width="7" height="7" />
                <rect x="3" y="14" width="7" height="7" />
              </svg>
              Admin Dashboard
            </Link>
          </div>
        )}

        {/* Shard Library & Stats - visible to all users for transparency */}
        <div className="sidebar-admin-links">
          <div className="sidebar-section-title">Explore</div>
          {(user?.role === 'admin' || user?.role === 'super_admin') ? (
            <Link to="/app/convergence" className={`sidebar-admin-link ${location.pathname === '/app/convergence' ? 'active' : ''}`}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
              </svg>
              Convergence Dashboard
            </Link>
          ) : (
            <span className="sidebar-admin-link disabled">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
              </svg>
              Convergence Dashboard
              <span className="sidebar-coming-soon">Coming Soon</span>
            </span>
          )}
          <Link to="/app/library" className={`sidebar-admin-link ${location.pathname === '/app/library' ? 'active' : ''}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            </svg>
            Shard Library
          </Link>
          <Link to="/app/packs" className={`sidebar-admin-link ${location.pathname === '/app/packs' ? 'active' : ''}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
              <path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
            Shard Packs
          </Link>
          <Link to="/app/shard-stats" className={`sidebar-admin-link ${location.pathname === '/app/shard-stats' ? 'active' : ''}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
              <path d="M18 20V10" />
              <path d="M12 20V4" />
              <path d="M6 20v-6" />
            </svg>
            Your Shard Stats
          </Link>
        </div>

        {/* Pro+ Tools - only show for paid plans and admins */}
        {(user?.plan === 'basic' || user?.plan === 'pro' || user?.plan === 'team' || user?.plan === 'enterprise' || user?.plan === 'lifetime' || user?.role === 'admin' || user?.role === 'super_admin') && (
          <div className="sidebar-admin-links">
            <div className="sidebar-section-title">Pro Tools</div>
            <Link to="/app/integrations" className={`sidebar-admin-link ${location.pathname === '/app/integrations' ? 'active' : ''}`}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
              </svg>
              Integrations
            </Link>
          </div>
        )}

        <button className="sidebar-bug-report" onClick={openBugReport}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4M12 8h.01" />
          </svg>
          Report an issue
        </button>

        <div className="sidebar-user-row">
          <div className="sidebar-user" onClick={() => navigate('/app/settings')}>
            <div className="sidebar-avatar">
              {getInitials(user?.displayName, user?.email)}
            </div>
            <div className="sidebar-user-info">
              <div className="sidebar-user-name">
                {user?.displayName || user?.email?.split('@')[0]}
              </div>
              <div className="sidebar-user-tier">{user?.planDisplayName || user?.plan || 'Free'}</div>
            </div>
          </div>
          <button className="sidebar-logout-btn" onClick={handleLogout} title="Log out">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
        </div>
      </div>
    </aside>
  );
}

function ConversationItem({
  conversation,
  isActive,
  onDelete,
  onRename,
}: {
  conversation: Conversation;
  isActive: boolean;
  onDelete: () => Promise<void>;
  onRename: (title: string) => void;
}) {
  const [showMenu, setShowMenu] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(conversation.title);
  const [isDeleting, setIsDeleting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  // Focus input when entering edit mode
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleStartEdit = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setEditTitle(conversation.title);
    setIsEditing(true);
  };

  const handleSaveEdit = () => {
    const trimmed = editTitle.trim();
    if (trimmed && trimmed !== conversation.title) {
      onRename(trimmed);
    }
    setIsEditing(false);
  };

  const handleCancelEdit = () => {
    setEditTitle(conversation.title);
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSaveEdit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancelEdit();
    }
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDeleting(true);
  };

  const handleConfirmDelete = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    await onDelete();
    setIsDeleting(false);
  };

  const handleCancelDelete = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDeleting(false);
  };

  // If editing, show inline input
  if (isEditing) {
    return (
      <div className={`conversation-item editing ${isActive ? 'active' : ''}`}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          className="conversation-edit-input"
          value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleSaveEdit}
          onClick={(e) => e.stopPropagation()}
        />
      </div>
    );
  }

  // If confirming delete, show confirmation
  if (isDeleting) {
    return (
      <div className={`conversation-item deleting ${isActive ? 'active' : ''}`}>
        <span className="delete-confirm-text">Delete?</span>
        <div className="delete-confirm-actions">
          <button className="delete-confirm-btn yes" onClick={handleConfirmDelete} title="Confirm delete">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          </button>
          <button className="delete-confirm-btn no" onClick={handleCancelDelete} title="Cancel">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  // Normal view
  return (
    <div
      className={`conversation-item ${isActive ? 'active' : ''}`}
      onMouseEnter={() => setShowMenu(true)}
      onMouseLeave={() => setShowMenu(false)}
      onClick={() => navigate(`/app/chat/${conversation.id}`)}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
      <span className="conversation-title">{conversation.title}</span>
      {showMenu && (
        <div className="conversation-actions">
          <button
            className="conversation-action"
            onClick={handleStartEdit}
            title="Rename"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          </button>
          <button
            className="conversation-action delete"
            onClick={handleDeleteClick}
            title="Delete"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
              <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
