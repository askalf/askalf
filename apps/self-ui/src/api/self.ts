import { apiGet, apiPost, apiPatch } from './client';
import type { SelfInstance } from '../stores/self';

export async function getSelf(): Promise<{ self: SelfInstance | null }> {
  return apiGet('/api/v1/self');
}

export async function activateSelf(data: {
  name: string;
  autonomyLevel: number;
}): Promise<{ self: SelfInstance }> {
  return apiPost('/api/v1/self/activate', data);
}

export async function updateSelf(data: Partial<{
  name: string;
  autonomyLevel: number;
  status: string;
}>): Promise<{ self: SelfInstance }> {
  return apiPatch('/api/v1/self', data);
}

export async function pauseSelf(): Promise<{ self: SelfInstance }> {
  return apiPost('/api/v1/self/pause');
}

export async function resumeSelf(): Promise<{ self: SelfInstance }> {
  return apiPost('/api/v1/self/resume');
}
