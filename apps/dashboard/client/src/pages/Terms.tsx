import { Link } from 'react-router-dom';
import './Landing.css';

export default function Terms() {
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

      <section className="legal-content">
        <p className="landing-section-label">// legal</p>
        <h1 className="landing-section-title" style={{ marginBottom: '0.5rem' }}>Terms of Service</h1>
        <p className="legal-updated">Last updated: February 18, 2026</p>

        <div className="legal-body">
          <h2>1. Acceptance of Terms</h2>
          <p>
            By accessing or using Orcastr8r ("the Service"), you agree to be bound by these
            Terms of Service. If you do not agree, do not use the Service.
          </p>

          <h2>2. Service Description</h2>
          <p>
            Orcastr8r is an AI agent orchestration platform currently in beta. Features,
            availability, and pricing are subject to change as the platform evolves.
          </p>

          <h2>3. Beta Program</h2>
          <p>
            The Service is currently provided as a beta. It is offered "as-is" without warranty
            of any kind. We may modify, suspend, or discontinue any part of the Service at any
            time during the beta period.
          </p>

          <h2>4. Your Account</h2>
          <p>
            You are responsible for maintaining the security of your account credentials.
            You must not share your account or API keys with unauthorized parties.
            Notify us immediately if you suspect unauthorized access.
          </p>

          <h2>5. Your Data</h2>
          <p>
            You retain ownership of all data you submit to the Service, including agent
            configurations, workflows, and execution results. We do not claim any intellectual
            property rights over your content.
          </p>

          <h2>6. Acceptable Use</h2>
          <p>You agree not to:</p>
          <ul>
            <li>Use the Service for any illegal or unauthorized purpose</li>
            <li>Attempt to gain unauthorized access to our systems</li>
            <li>Interfere with or disrupt the Service or its infrastructure</li>
            <li>Use the Service to build a competing product</li>
          </ul>

          <h2>7. API Usage & Rate Limits</h2>
          <p>
            The Service may impose rate limits and usage quotas. Exceeding these limits may
            result in temporary restriction of access. AI provider costs incurred through the
            platform are your responsibility.
          </p>

          <h2>8. Termination</h2>
          <p>
            Either party may terminate the account at any time. We may terminate or suspend
            access if you violate these terms. Upon termination, you may request export of
            your data within 30 days.
          </p>

          <h2>9. Limitation of Liability</h2>
          <p>
            To the maximum extent permitted by law, Orcastr8r shall not be liable for any
            indirect, incidental, special, consequential, or punitive damages, including loss
            of data or profits, arising from your use of the Service.
          </p>

          <h2>10. Changes to Terms</h2>
          <p>
            We may update these terms from time to time. We will notify you of material changes
            by email or through the Service. Continued use after changes constitutes acceptance.
          </p>

          <h2>11. Contact</h2>
          <p>
            For questions about these terms, contact us at{' '}
            <a href="mailto:support@orcastr8r.com">support@orcastr8r.com</a>.
          </p>
        </div>
      </section>

      <footer className="landing-footer" role="contentinfo">
        <div className="landing-footer-inner">
          <div className="landing-footer-left">
            <span className="landing-footer-copy">
              {'\u00A9'} {new Date().getFullYear()} Orcastr8r. All rights reserved.
            </span>
          </div>
          <div className="landing-footer-links">
            <Link to="/" className="landing-footer-link">Home</Link>
            <Link to="/privacy" className="landing-footer-link">Privacy</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
