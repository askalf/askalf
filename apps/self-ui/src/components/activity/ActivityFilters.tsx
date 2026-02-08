import clsx from 'clsx';
import type { ActivityType } from '../../api/activity';

const filters: Array<{ value: ActivityType | null; label: string }> = [
  { value: null, label: 'All' },
  { value: 'action', label: 'Actions' },
  { value: 'chat', label: 'Chat' },
  { value: 'approval', label: 'Approvals' },
  { value: 'integration', label: 'Integrations' },
  { value: 'system', label: 'System' },
];

interface Props {
  active: ActivityType | null;
  onChange: (type: ActivityType | null) => void;
}

export default function ActivityFilters({ active, onChange }: Props) {
  return (
    <div className="activity-filters">
      {filters.map((f) => (
        <button
          key={f.value || 'all'}
          className={clsx('activity-filter', active === f.value && 'active')}
          onClick={() => onChange(f.value)}
        >
          {f.label}
        </button>
      ))}
    </div>
  );
}
