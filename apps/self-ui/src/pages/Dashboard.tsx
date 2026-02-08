import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSelfStore } from '../stores/self';
import { useChatStore } from '../stores/chat';
import ActivityFeed from '../components/activity/ActivityFeed';
import ChatInput from '../components/chat/ChatInput';
import MessageThread from '../components/chat/MessageThread';

export default function Dashboard() {
  const navigate = useNavigate();
  const { self } = useSelfStore();
  const { conversations, messages, isSending, fetchConversations, selectConversation, createConversation, sendMessage } = useChatStore();

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  // Select most recent conversation for the sidebar preview
  const latestConvo = conversations[0];

  useEffect(() => {
    if (latestConvo && !messages.length) {
      selectConversation(latestConvo.id);
    }
  }, [latestConvo]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSend = async (content: string) => {
    if (!latestConvo) {
      const id = await createConversation();
      navigate(`/chat/${id}`);
      setTimeout(() => {
        useChatStore.getState().sendMessage(content);
      }, 100);
      return;
    }
    await sendMessage(content);
  };

  return (
    <div className="dashboard">
      <div className="dashboard-main">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', marginBottom: 'var(--space-md)' }}>
          <h2 style={{ fontSize: '1.125rem', fontWeight: 600 }}>Recent Activity</h2>
          {self?.stats && (
            <span className="badge badge-success">{self.stats.actionsToday} actions today</span>
          )}
        </div>
        <ActivityFeed showFilters={false} limit={15} />
      </div>

      <div className="dashboard-sidebar">
        <div className="dashboard-sidebar-title">Quick Chat</div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ flex: 1, overflow: 'auto' }}>
            <MessageThread messages={messages.slice(-5)} isSending={isSending} />
          </div>
          <ChatInput onSend={handleSend} disabled={isSending} />
        </div>
      </div>
    </div>
  );
}
