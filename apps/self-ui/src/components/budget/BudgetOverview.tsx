import clsx from 'clsx';

interface GaugeProps {
  label: string;
  spent: number;
  limit: number;
}

function BudgetGauge({ label, spent, limit }: GaugeProps) {
  const pct = limit > 0 ? Math.min((spent / limit) * 100, 100) : 0;
  const status = pct >= 90 ? 'over' : pct >= 70 ? 'warn' : 'ok';

  return (
    <div className="budget-gauge">
      <div className="budget-gauge-label">{label}</div>
      <div className="budget-gauge-value">
        ${spent.toFixed(2)}
        <span className="budget-gauge-max"> / ${limit.toFixed(2)}</span>
      </div>
      <div className="budget-gauge-bar">
        <div
          className={clsx('budget-gauge-fill', status)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

interface Props {
  daily: { spent: number; limit: number };
  monthly: { spent: number; limit: number };
}

export default function BudgetOverview({ daily, monthly }: Props) {
  return (
    <div className="budget-gauges">
      <BudgetGauge label="Today" spent={daily.spent} limit={daily.limit} />
      <BudgetGauge label="This Month" spent={monthly.spent} limit={monthly.limit} />
    </div>
  );
}
