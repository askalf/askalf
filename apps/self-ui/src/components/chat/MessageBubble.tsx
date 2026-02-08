import clsx from 'clsx';
import { formatDistanceToNow } from 'date-fns';
import type { Message } from '../../stores/chat';
import { useSelfStore } from '../../stores/self';

interface Props {
  message: Message;
}

export default function MessageBubble({ message }: Props) {
  const { self } = useSelfStore();
  const isUser = message.role === 'user';

  return (
    <div className={clsx('message-bubble', isUser ? 'user' : 'self')}>
      <div className="message-header">
        <span className="message-sender">
          {isUser ? 'You' : self?.name || 'SELF'}
        </span>
        <span className="message-time">
          {formatDistanceToNow(new Date(message.createdAt), { addSuffix: true })}
        </span>
      </div>
      <div className="message-content">{message.content}</div>
      {message.metadata && (
        <div className="message-meta">
          {message.metadata.model && <span>{message.metadata.model}</span>}
          {message.metadata.tokensUsed != null && <span>{message.metadata.tokensUsed} tokens</span>}
          {message.metadata.cost != null && <span>${message.metadata.cost.toFixed(4)}</span>}
        </div>
      )}
    </div>
  );
}
