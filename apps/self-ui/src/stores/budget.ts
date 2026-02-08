import { create } from 'zustand';
import * as budgetApi from '../api/budget';
import type { BudgetData } from '../api/budget';

interface BudgetState {
  budget: BudgetData | null;
  isLoading: boolean;
  error: string | null;
  fetchBudget: () => Promise<void>;
}

export const useBudgetStore = create<BudgetState>((set) => ({
  budget: null,
  isLoading: false,
  error: null,

  fetchBudget: async () => {
    set({ isLoading: true, error: null });
    try {
      const data = await budgetApi.getBudget();
      set({ budget: data.budget, isLoading: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to load budget', isLoading: false });
    }
  },
}));
