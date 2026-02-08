interface Props {
  breakdown: Array<{
    type: string;
    label: string;
    amount: number;
    count: number;
  }>;
}

const typeIcons: Record<string, string> = {
  llm: '\uD83E\uDDE0',
  action: '\u2699\uFE0F',
  integration: '\uD83D\uDD17',
  embedding: '\uD83D\uDCCA',
};

export default function CostBreakdown({ breakdown }: Props) {
  const total = breakdown.reduce((sum, b) => sum + b.amount, 0);

  return (
    <div className="cost-breakdown">
      <div className="cost-breakdown-title">Cost Breakdown</div>
      {breakdown.map((b) => (
        <div key={b.type} className="cost-row">
          <div className="cost-row-label">
            <span>{typeIcons[b.type] || '\u2139\uFE0F'}</span>
            <span>{b.label}</span>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>({b.count})</span>
          </div>
          <div className="cost-row-value">${b.amount.toFixed(4)}</div>
        </div>
      ))}
      {breakdown.length > 0 && (
        <div className="cost-row" style={{ fontWeight: 700, marginTop: 'var(--space-sm)' }}>
          <div className="cost-row-label">Total</div>
          <div className="cost-row-value">${total.toFixed(4)}</div>
        </div>
      )}
    </div>
  );
}
