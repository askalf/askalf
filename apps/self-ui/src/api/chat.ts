import { apiGet, apiPost, apiDelete } from './client';

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface Message {
  id: string;
  conversationId: string;
  role: 'user' | 'self';
  content: string;
  createdAt: string;
  metadata?: {
    tokensUsed?: number;
    cost?: number;
    model?: string;
  };
}

export async function getConversations(params?: {
  limit?: number;
  offset?: number;
}): Promise<{ conversations: Conversation[]; total: number }> {
  const query = new URLSearchParams();
  if (params?.limit) query.set('limit', String(params.limit));
  if (params?.offset) query.set('offset', String(params.offset));
  const qs = query.toString();
  return apiGet(`/api/v1/self/chat/conversations${qs ? `?${qs}` : ''}`);
}

export async function getConversation(id: string): Promise<{ conversation: Conversation; messages: Message[] }> {
  return apiGet(`/api/v1/self/chat/conversations/${id}`);
}

export async function createConversation(): Promise<{ conversation: Conversation }> {
  return apiPost('/api/v1/self/chat/conversations');
}

export async function sendMessage(conversationId: string, content: string): Promise<{ message: Message; reply: Message }> {
  return apiPost(`/api/v1/self/chat/conversations/${conversationId}/messages`, { content });
}

export async function deleteConversation(id: string): Promise<void> {
  await apiDelete(`/api/v1/self/chat/conversations/${id}`);
}
