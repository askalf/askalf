import { useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ChatWindow from '../components/chat/ChatWindow';
import { useChatStore } from '../stores/chat';
import '../components/chat/Chat.css';

export default function ChatPage() {
  const { conversationId } = useParams<{ conversationId?: string }>();
  const navigate = useNavigate();
  const {
    conversations,
    conversationsLoaded,
    currentConversationId,
    setCurrentConversation,
  } = useChatStore();

  useEffect(() => { document.title = 'Chat — Ask ALF'; }, []);

  // Track if we've already synced to prevent loops
  const lastSyncedId = useRef<string | null>(null);

  // Load conversation from URL on mount/URL change
  useEffect(() => {
    // Skip if we've already initiated a load for this conversation
    if (conversationId && conversationId !== currentConversationId && conversationId !== lastSyncedId.current) {
      // Load specific conversation from URL
      const exists = conversations.some(c => c.id === conversationId);
      if (exists) {
        lastSyncedId.current = conversationId; // Set BEFORE calling to prevent re-entry
        setCurrentConversation(conversationId);
      } else if (conversationsLoaded) {
        // Conversation doesn't exist, redirect to new chat
        navigate('/app/chat', { replace: true });
      }
    }
  }, [conversationId, conversations, conversationsLoaded, currentConversationId, setCurrentConversation, navigate]);

  // Sync URL when currentConversationId changes (e.g., after sending first message)
  useEffect(() => {
    // Only navigate if we have a new conversation ID that differs from URL
    // and we haven't just synced from URL
    if (
      currentConversationId &&
      currentConversationId !== conversationId &&
      currentConversationId !== lastSyncedId.current
    ) {
      lastSyncedId.current = currentConversationId;
      navigate(`/app/chat/${currentConversationId}`, { replace: true });
    }
  }, [currentConversationId, conversationId, navigate]);

  return <ChatWindow />;
}
