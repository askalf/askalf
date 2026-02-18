import { Link } from 'react-router-dom';
import './Landing.css';

export default function Privacy() {
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
        <h1 className="landing-section-title" style={{ marginBottom: '0.5rem' }}>Privacy Policy</h1>
        <p className="legal-updated">Last updated: February 18, 2026</p>

        <div className="legal-body">
          <h2>1. Information We Collect</h2>
          <p>
            When you join our waitlist or create an account, we collect your name and email address.
            We do not collect any other personal information unless you voluntarily provide it.
          </p>

          <h2>2. How We Use Your Information</h2>
          <p>We use the information we collect to:</p>
          <ul>
            <li>Manage your waitlist position and send product updates</li>
            <li>Create and manage your account</li>
            <li>Communicate with you about the service</li>
            <li>Improve our platform and user experience</li>
          </ul>

          <h2>3. Data Sharing</h2>
          <p>
            We do not sell, trade, or share your personal information with third parties.
            We may use third-party services (such as email delivery) to operate the platform,
            but these providers only process data on our behalf and under our instructions.
          </p>

          <h2>4. Cookies</h2>
          <p>
            We use cookies solely for authentication and session management.
            We do not use tracking cookies or third-party advertising cookies.
          </p>

          <h2>5. Data Security</h2>
          <p>
            We implement industry-standard security measures including encryption in transit (TLS),
            encrypted backups, and secure infrastructure. All data is stored on servers we control.
          </p>

          <h2>6. Your Rights</h2>
          <p>
            You can request access to, correction of, or deletion of your personal data at any time
            by contacting us. We will respond to your request within 30 days.
          </p>

          <h2>7. Data Retention</h2>
          <p>
            We retain your data for as long as your account is active or as needed to provide
            services. If you request deletion, we will remove your data within 30 days.
          </p>

          <h2>8. Changes to This Policy</h2>
          <p>
            We may update this policy from time to time. We will notify you of any material
            changes by email or through a notice on our website.
          </p>

          <h2>9. Contact</h2>
          <p>
            For questions about this privacy policy, contact us at{' '}
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
            <Link to="/terms" className="landing-footer-link">Terms</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
