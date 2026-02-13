const STATUS_COLORS: Record<string, string> = {
  // Agent statuses
  idle: '#6b7280',
  running: '#10b981',
  paused: '#f59e0b',
  error: '#ef4444',
  // Task statuses
  pending: '#6b7280',
  in_progress: '#f59e0b',
  completed: '#10b981',
  failed: '#ef4444',
  cancelled: '#9ca3af',
  // Ticket statuses
  open: '#3b82f6',
  resolved: '#10b981',
  decommissioned: '#6b7280',
  // Intervention statuses
  approved: '#10b981',
  denied: '#ef4444',
  // Priority
  low: '#6b7280',
  medium: '#f59e0b',
  high: '#ef4444',
  urgent: '#dc2626',
  // Severity
  info: '#3b82f6',
  warning: '#f59e0b',
  critical: '#ef4444',
};

interface StatusBadgeProps {
  status: string;
  className?: string;
}

export default function StatusBadge({ status, className = '' }: StatusBadgeProps) {
  const color = STATUS_COLORS[status] || '#6b7280';
  return (
    <span
      className={`hub-badge ${className}`}
      style={{ background: `${color}20`, color }}
    >
      {status.replace(/_/g, ' ')}
    </span>
  );
}

export { STATUS_COLORS };
