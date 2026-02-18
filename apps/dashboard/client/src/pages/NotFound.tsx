import { Link } from 'react-router-dom';
import './Landing.css';

export default function NotFound() {
  return (
    <div className="landing-page legal-page">
      <nav className="landing-nav" aria-label="Main navigation">
        <Link to="/" className="landing-nav-logo">
          <span className="landing-nav-logo-text">orcastr8r</span>
        </Link>
        <div className="landing-nav-links">
          <Link to="/login" className="landing-nav-signin">Sign In</Link>
        </div>
      </nav>

      <section className="legal-content" style={{ textAlign: 'center', paddingTop: '8rem', paddingBottom: '8rem' }}>
        <p className="landing-section-label">// 404</p>
        <h1 style={{
          fontSize: '6rem',
          fontWeight: 800,
          letterSpacing: '-0.04em',
          fontFamily: "'JetBrains Mono', monospace",
          background: 'linear-gradient(135deg, #7c3aed, #a78bfa)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
          margin: '0 0 1rem',
        }}>404</h1>
        <h2 style={{
          fontSize: '1.5rem',
          fontWeight: 600,
          color: '#fafafa',
          margin: '0 0 1rem',
        }}>Page not found</h2>
        <p style={{
          fontSize: '1rem',
          color: 'rgba(255,255,255,0.5)',
          margin: '0 0 2.5rem',
        }}>The agent you're looking for has been decommissioned.</p>
        <Link to="/" className="landing-cta">Back to Home</Link>
      </section>

      <footer className="landing-footer" role="contentinfo">
        <div className="landing-footer-inner">
          <span className="landing-footer-copy">
            {'\u00A9'} {new Date().getFullYear()} Orcastr8r. All rights reserved.
          </span>
        </div>
      </footer>
    </div>
  );
}
