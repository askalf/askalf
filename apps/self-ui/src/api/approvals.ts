import { apiGet, apiPost } from './client';

export interface Approval {
  id: string;
  type: string;
  title: string;
  description: string;
  status: 'pending' | 'approved' | 'rejected';
  estimatedCost?: number;
  risk: 'low' | 'medium' | 'high';
  createdAt: string;
  resolvedAt?: string;
  metadata?: Record<string, unknown>;
}

export async function getApprovals(params?: {
  status?: string;
  limit?: number;
  offset?: number;
}): Promise<{ approvals: Approval[]; total: number; pendingCount: number }> {
  const query = new URLSearchParams();
  if (params?.status) query.set('status', params.status);
  if (params?.limit) query.set('limit', String(params.limit));
  if (params?.offset) query.set('offset', String(params.offset));
  const qs = query.toString();
  return apiGet(`/api/v1/self/approvals${qs ? `?${qs}` : ''}`);
}

export async function approveAction(id: string): Promise<{ approval: Approval }> {
  return apiPost(`/api/v1/self/approvals/${id}/approve`);
}

export async function rejectAction(id: string, reason?: string): Promise<{ approval: Approval }> {
  return apiPost(`/api/v1/self/approvals/${id}/reject`, { reason });
}
