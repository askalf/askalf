import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useChatStore } from '../../stores/chat';
import ConversationList from './ConversationList';
import MessageThread from './MessageThread';
import ChatInput from './ChatInput';

export default function ChatPanel() {
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const {
    conversations,
    totalConversations,
    currentConversationId,
    messages,
    isSending,
    isLoadingMore,
    fetchConversations,
    loadMoreConversations,
    selectConversation,
    createConversation,
    sendMessage,
  } = useChatStore();

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  useEffect(() => {
    if (conversationId && conversationId !== currentConversationId) {
      selectConversation(conversationId);
    }
  }, [conversationId, currentConversationId, selectConversation]);

  const handleCreate = async () => {
    const id = await createConversation();
    navigate(`/chat/${id}`);
  };

  const handleSelect = (id: string) => {
    navigate(`/chat/${id}`);
  };

  const handleSend = async (content: string) => {
    if (!currentConversationId) {
      const id = await createConversation();
      navigate(`/chat/${id}`);
      // Wait briefly for state to settle, then send
      setTimeout(() => {
        useChatStore.getState().sendMessage(content);
      }, 100);
      return;
    }
    await sendMessage(content);
  };

  return (
    <div className="chat-layout">
      <div className="chat-sidebar">
        <ConversationList
          conversations={conversations}
          activeId={currentConversationId}
          onSelect={handleSelect}
          onCreate={handleCreate}
          hasMore={conversations.length < totalConversations}
          isLoadingMore={isLoadingMore}
          onLoadMore={loadMoreConversations}
        />
      </div>
      <div className="chat-main">
        <MessageThread messages={messages} isSending={isSending} />
        <ChatInput onSend={handleSend} disabled={isSending} />
      </div>
    </div>
  );
}
