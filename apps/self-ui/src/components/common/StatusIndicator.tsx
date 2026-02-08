import clsx from 'clsx';
import type { SelfStatus } from '../../stores/self';

interface Props {
  status: SelfStatus;
  showLabel?: boolean;
}

const labels: Record<SelfStatus, string> = {
  active: 'Active',
  paused: 'Paused',
  error: 'Error',
  onboarding: 'Setting up',
};

export default function StatusIndicator({ status, showLabel = false }: Props) {
  return (
    <span className="header-status">
      <span className={clsx('status-dot', status)} />
      {showLabel && <span>{labels[status]}</span>}
    </span>
  );
}
