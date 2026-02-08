import { apiGet } from './client';

export type ActivityType = 'action' | 'chat' | 'approval' | 'integration' | 'system';

export interface Activity {
  id: string;
  type: ActivityType;
  title: string;
  description?: string;
  cost?: number;
  importance: 'low' | 'medium' | 'high';
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export async function getActivities(params?: {
  type?: ActivityType;
  limit?: number;
  offset?: number;
}): Promise<{ activities: Activity[]; total: number }> {
  const query = new URLSearchParams();
  if (params?.type) query.set('type', params.type);
  if (params?.limit) query.set('limit', String(params.limit));
  if (params?.offset) query.set('offset', String(params.offset));
  const qs = query.toString();
  return apiGet(`/api/v1/self/activity${qs ? `?${qs}` : ''}`);
}
