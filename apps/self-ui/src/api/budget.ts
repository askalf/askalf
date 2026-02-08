import { apiGet } from './client';

export interface BudgetData {
  daily: {
    spent: number;
    limit: number;
  };
  monthly: {
    spent: number;
    limit: number;
  };
  history: Array<{
    date: string;
    amount: number;
  }>;
  breakdown: Array<{
    type: string;
    label: string;
    amount: number;
    count: number;
  }>;
}

export async function getBudget(): Promise<{ budget: BudgetData }> {
  return apiGet('/api/v1/self/budget');
}
