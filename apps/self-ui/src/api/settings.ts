import { apiGet, apiPatch } from './client';

export interface SelfSettings {
  name: string;
  autonomyLevel: number;
  dailyBudget: number;
  monthlyBudget: number;
  notificationsEnabled: boolean;
  emailDigest: boolean;
  workingHoursOnly: boolean;
  workingHoursStart: string; // HH:MM
  workingHoursEnd: string;   // HH:MM
  timezone: string;
}

export async function getSettings(): Promise<{ settings: SelfSettings }> {
  return apiGet('/api/v1/self/settings');
}

export async function updateSettings(data: Partial<SelfSettings>): Promise<{ settings: SelfSettings }> {
  return apiPatch('/api/v1/self/settings', data);
}
