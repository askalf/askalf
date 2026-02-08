import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useBudgetStore } from '../stores/budget';
import BudgetOverview from '../components/budget/BudgetOverview';
import SpendingChart from '../components/budget/SpendingChart';
import CostBreakdown from '../components/budget/CostBreakdown';

export default function BudgetPage() {
  const { budget, isLoading, fetchBudget } = useBudgetStore();

  useEffect(() => {
    fetchBudget();
  }, [fetchBudget]);

  if (isLoading || !budget) {
    return (
      <div className="page">
        <div className="page-header">
          <h1 className="page-title">Budget</h1>
        </div>
        <div style={{ padding: 'var(--space-xl)', textAlign: 'center', color: 'var(--text-muted)' }}>
          Loading budget data...
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title">Budget</h1>
          <p className="page-subtitle">Track your SELF's spending and manage limits.</p>
        </div>
        <Link to="/settings" className="btn btn-secondary" style={{ whiteSpace: 'nowrap' }}>
          Set Limits
        </Link>
      </div>

      <BudgetOverview daily={budget.daily} monthly={budget.monthly} />

      {budget.history.length > 0 && <SpendingChart history={budget.history} />}

      {budget.breakdown.length > 0 && <CostBreakdown breakdown={budget.breakdown} />}
    </div>
  );
}
