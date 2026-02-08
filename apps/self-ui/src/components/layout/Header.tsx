import { useLocation } from 'react-router-dom';
import { useSelfStore } from '../../stores/self';
import { useApprovalsStore } from '../../stores/approvals';
import StatusIndicator from '../common/StatusIndicator';

const pageTitles: Record<string, string> = {
  '/': 'Dashboard',
  '/chat': 'Chat',
  '/activity': 'Activity',
  '/integrations': 'Integrations',
  '/approvals': 'Approvals',
  '/settings': 'Settings',
  '/budget': 'Budget',
};

interface Props {
  onMenuClick: () => void;
}

export default function Header({ onMenuClick }: Props) {
  const location = useLocation();
  const { self } = useSelfStore();
  const { pendingCount } = useApprovalsStore();

  const basePath = '/' + (location.pathname.split('/')[1] || '');
  const title = pageTitles[basePath] || 'SELF';

  return (
    <header className="header">
      <div className="header-left">
        <button className="header-menu-btn" onClick={onMenuClick} aria-label="Open menu">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <h1 className="header-title">{title}</h1>
      </div>
      <div className="header-right">
        {self && <StatusIndicator status={self.status} showLabel />}
        {pendingCount > 0 && (
          <span className="badge badge-warning">{pendingCount} pending</span>
        )}
      </div>
    </header>
  );
}
