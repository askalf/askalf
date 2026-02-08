import { apiGet, apiPost } from './client';

export interface OnboardingStatus {
  completed: boolean;
  currentStep: number;
  availableIntegrations: Array<{
    id: string;
    name: string;
    icon: string;
    description: string;
  }>;
}

export async function getOnboardingStatus(): Promise<OnboardingStatus> {
  return apiGet('/api/v1/self/onboarding');
}

export async function completeOnboarding(data: {
  name: string;
  autonomyLevel: number;
  integrations?: string[];
}): Promise<{ success: boolean }> {
  return apiPost('/api/v1/self/onboarding/complete', data);
}
