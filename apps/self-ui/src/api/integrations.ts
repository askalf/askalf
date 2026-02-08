import { apiGet, apiPost, apiDelete } from './client';

export interface Integration {
  id: string;
  type: string;
  name: string;
  icon: string;
  description: string;
  status: 'available' | 'connected' | 'error';
  connectedAt?: string;
  config?: Record<string, unknown>;
}

export async function getIntegrations(): Promise<{ integrations: Integration[] }> {
  return apiGet('/api/v1/self/integrations');
}

export async function connectIntegration(type: string): Promise<{ authUrl?: string; integration?: Integration }> {
  return apiPost('/api/v1/self/integrations/connect', { type });
}

export async function disconnectIntegration(id: string): Promise<void> {
  await apiDelete(`/api/v1/self/integrations/${id}`);
}
