import clsx from 'clsx';
import { formatDistanceToNow } from 'date-fns';
import type { Conversation } from '../../stores/chat';

interface Props {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
}

export default function ConversationList({ conversations, activeId, onSelect, onCreate, hasMore, isLoadingMore, onLoadMore }: Props) {
  return (
    <>
      <div className="chat-sidebar-header">
        <button className="btn btn-secondary" style={{ width: '100%' }} onClick={onCreate}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New Conversation
        </button>
      </div>
      <div className="chat-sidebar-list">
        {conversations.map((c) => (
          <div
            key={c.id}
            className={clsx('convo-item', c.id === activeId && 'active')}
            onClick={() => onSelect(c.id)}
          >
            <span className="convo-title">{c.title || 'New conversation'}</span>
            <span className="convo-time">
              {formatDistanceToNow(new Date(c.updatedAt), { addSuffix: false })}
            </span>
          </div>
        ))}
        {conversations.length === 0 && (
          <div style={{ padding: 'var(--space-lg)', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8125rem' }}>
            No conversations yet
          </div>
        )}
        {hasMore && onLoadMore && (
          <div style={{ padding: 'var(--space-sm)', textAlign: 'center' }}>
            <button
              className="btn btn-secondary"
              style={{ width: '100%', fontSize: '0.75rem', padding: 'var(--space-xs) var(--space-sm)' }}
              onClick={onLoadMore}
              disabled={isLoadingMore}
            >
              {isLoadingMore ? 'Loading...' : 'Load More'}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
