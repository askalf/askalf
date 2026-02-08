import { format, parseISO } from 'date-fns';

interface Props {
  history: Array<{ date: string; amount: number }>;
}

export default function SpendingChart({ history }: Props) {
  const maxAmount = Math.max(...history.map((h) => h.amount), 0.01);

  return (
    <div className="spending-chart">
      <div className="spending-chart-title">Last 30 Days</div>
      <div className="spending-bars">
        {history.map((h) => {
          const heightPct = (h.amount / maxAmount) * 100;
          return (
            <div key={h.date} className="spending-bar-wrap" title={`${format(parseISO(h.date), 'MMM d')}: $${h.amount.toFixed(2)}`}>
              <div
                className="spending-bar"
                style={{ height: `${Math.max(heightPct, 1)}%` }}
              />
              {history.length <= 15 && (
                <span className="spending-bar-label">
                  {format(parseISO(h.date), 'd')}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
