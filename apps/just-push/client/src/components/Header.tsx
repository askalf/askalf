import { Link } from 'react-router-dom';

export default function Header() {
  return (
    <header className="jp-header">
      <div className="jp-header-glow" />
      <Link to="/" className="jp-header-brand">
        <div className="jp-header-logo">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="19" x2="12" y2="5" />
            <polyline points="5 12 12 5 19 12" />
          </svg>
        </div>
        <span className="jp-header-title">Just Push</span>
      </Link>
      <div className="jp-header-right">
        <div className="jp-header-status">
          <span className="jp-header-status-dot" />
          <span className="jp-header-status-text">System Online</span>
        </div>
      </div>
    </header>
  );
}
