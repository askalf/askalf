interface LoadingSkeletonProps {
  rows?: number;
  type?: 'table' | 'cards' | 'stats';
}

export default function LoadingSkeleton({ rows = 5, type = 'table' }: LoadingSkeletonProps) {
  if (type === 'stats') {
    return (
      <div className="skeleton-stats">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="skeleton-stat-card">
            <div className="skeleton-line skeleton-value" />
            <div className="skeleton-line skeleton-label" />
          </div>
        ))}
      </div>
    );
  }

  if (type === 'cards') {
    return (
      <div className="skeleton-cards">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="skeleton-card">
            <div className="skeleton-line" style={{ width: '60%' }} />
            <div className="skeleton-line" style={{ width: '80%' }} />
            <div className="skeleton-line" style={{ width: '40%' }} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="skeleton-table">
      <div className="skeleton-header">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="skeleton-line skeleton-th" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton-row">
          {Array.from({ length: 6 }).map((_, j) => (
            <div key={j} className="skeleton-line skeleton-td" />
          ))}
        </div>
      ))}
    </div>
  );
}
