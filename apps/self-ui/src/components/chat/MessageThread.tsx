import { useRef, useEffect } from 'react';
import type { Message } from '../../stores/chat';
import MessageBubble from './MessageBubble';
import TypingIndicator from './TypingIndicator';
import EmptyState from '../common/EmptyState';

interface Props {
  messages: Message[];
  isSending: boolean;
}

export default function MessageThread({ messages, isSending }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, isSending]);

  if (messages.length === 0 && !isSending) {
    return (
      <div className="chat-messages">
        <EmptyState
          icon="&#128172;"
          title="Start a conversation"
          text="Ask your SELF anything — get updates, give instructions, or just chat."
        />
      </div>
    );
  }

  return (
    <div className="chat-messages">
      {messages.map((m) => (
        <MessageBubble key={m.id} message={m} />
      ))}
      {isSending && <TypingIndicator />}
      <div ref={bottomRef} />
    </div>
  );
}
