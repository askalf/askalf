import { Link } from 'react-router-dom';

export default function Header() {
  return (
    <header className="jp-header">
      <Link to="/" className="jp-header-brand">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
        </svg>
        <span className="jp-header-title">Just Push</span>
      </Link>
      <div className="jp-header-right">
        <span className="jp-header-tagline">Git for Humans</span>
      </div>
    </header>
  );
}
