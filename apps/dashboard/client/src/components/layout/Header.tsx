import { Link } from 'react-router-dom';
import ModelSelector from '../chat/ModelSelector';
import CreditBalance from './CreditBalance';
import ShardSavings from './ShardSavings';

interface HeaderProps {
  onMenuClick?: () => void;
}

export default function Header({ onMenuClick }: HeaderProps) {
  return (
    <header className="header">
      {/* Mobile hamburger menu */}
      <button className="header-menu-btn" onClick={onMenuClick} aria-label="Open menu">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 12h18M3 6h18M3 18h18" />
        </svg>
      </button>

      <div className="header-logo-group">
        <Link to="/" className="header-logo">
          <span className="header-logo-icon">👽</span>
          <div className="header-logo-text">
            <span className="header-logo-ask">Ask</span>
            <span className="header-logo-alf">ALF</span>
          </div>
        </Link>
        <span className="beta-badge">Public Beta</span>
      </div>

      <div className="header-actions">
        <ShardSavings />
        <CreditBalance />
        <ModelSelector />
      </div>
    </header>
  );
}
