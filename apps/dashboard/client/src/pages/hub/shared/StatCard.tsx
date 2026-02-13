interface StatCardProps {
  value: string | number;
  label: string;
  icon?: string;
  variant?: 'default' | 'success' | 'warning' | 'danger';
  large?: boolean;
  pulse?: boolean;
  onClick?: () => void;
}

export default function StatCard({ value, label, icon, variant = 'default', large, pulse, onClick }: StatCardProps) {
  const variantClass = variant !== 'default' ? `hub-stat--${variant}` : '';
  return (
    <div
      className={`hub-stat ${variantClass} ${large ? 'hub-stat--large' : ''} ${pulse ? 'hub-stat--pulse' : ''} ${onClick ? 'hub-stat--clickable' : ''}`}
      onClick={onClick}
    >
      {icon && <div className="hub-stat__icon">{icon}</div>}
      <div className={`hub-stat__value ${variant !== 'default' ? variant : ''}`}>{value}</div>
      <div className="hub-stat__label">{label}</div>
    </div>
  );
}
