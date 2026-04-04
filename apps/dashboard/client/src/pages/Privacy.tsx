import { Link } from 'react-router-dom';
import './Landing.css';

export default function Privacy() {
  document.title = 'Privacy Policy — AskAlf';
  return (
    <div className="landing-page legal-page">
      <nav className="landing-nav" aria-label="Main navigation">
        <Link to="/" className="landing-nav-logo">
          <span className="landing-nav-logo-text">askalf</span>
        </Link>
        <div className="landing-nav-links">
          <Link to="/command-center" className="landing-nav-signin">Dashboard</Link>
        </div>
      </nav>

      <section className="legal-content">
        <p className="landing-section-label">// legal</p>
        <h1 className="landing-section-title" style={{ marginBottom: '0.5rem' }}>Privacy Policy</h1>
        <p className="legal-updated">Last updated: February 27, 2026</p>

        <div className="legal-body">
          <h2>1. Information We Collect</h2>
          <p>
            When you join our waitlist or create an account, we collect your name and email address.
            When you use the platform, we also collect:
          </p>
          <ul>
            <li>Agent configurations (system prompts, tool selections, model preferences)</li>
            <li>Execution logs and metadata (timestamps, token counts, cost data, status)</li>
            <li>Content you provide to agents (prompts, instructions, uploaded files)</li>
            <li>Agent outputs (generated text, actions taken, tool call results)</li>
            <li>API keys and OAuth tokens you connect (stored encrypted, never in plaintext)</li>
          </ul>

          <h2>2. How We Use Your Information</h2>
          <p>We use the information we collect to:</p>
          <ul>
            <li>Manage your waitlist position and send product updates</li>
            <li>Create and manage your account</li>
            <li>Execute AI agent tasks on your behalf</li>
            <li>Track usage, costs, and billing</li>
            <li>Communicate with you about the service</li>
            <li>Improve our platform and user experience</li>
          </ul>

          <h2>3. Third-Party AI Providers</h2>
          <p>
            AskAlf routes your agent tasks to third-party AI providers based on your configuration.
            When an agent executes, your prompts and context may be sent to:
          </p>
          <ul>
            <li>Anthropic (Claude) &mdash; <a href="https://www.anthropic.com/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a></li>
            <li>OpenAI (GPT) &mdash; <a href="https://openai.com/policies/privacy-policy" target="_blank" rel="noopener noreferrer">Privacy Policy</a></li>
            <li>Google (Gemini) &mdash; <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a></li>
          </ul>
          <p>
            These providers process data according to their own privacy policies.
            When you bring your own API key, requests are made directly using your credentials.
            We do not control how these providers handle data sent via your keys.
          </p>

          <h2>4. Data Sharing</h2>
          <p>
            We do not sell, trade, or share your personal information with third parties
            for marketing purposes. We may share data with:
          </p>
          <ul>
            <li>AI providers listed above, as required to execute agent tasks</li>
            <li>Infrastructure providers (hosting, email delivery) who process data on our behalf</li>
            <li>Law enforcement, if required by law or to protect our rights</li>
          </ul>

          <h2>5. Cookies</h2>
          <p>
            We use cookies solely for authentication and session management.
            We do not use tracking cookies, analytics cookies, or third-party advertising cookies.
          </p>

          <h2>6. Data Security</h2>
          <p>
            We implement industry-standard security measures including encryption in transit (TLS 1.3),
            encrypted backups, and secure infrastructure. API keys and OAuth tokens are encrypted
            at rest using AES-256. All data is stored on servers we control. Agent sessions run in
            isolated containers with no shared state between users.
          </p>

          <h2>7. Your Rights</h2>
          <p>You have the right to:</p>
          <ul>
            <li>Access your personal data and agent execution history</li>
            <li>Correct inaccurate personal information</li>
            <li>Delete your account and all associated data</li>
            <li>Export your data in a standard format</li>
            <li>Revoke connected API keys and OAuth tokens at any time</li>
          </ul>
          <p>
            To exercise these rights, contact us at{' '}
            <a href="mailto:support@askalf.org">support@askalf.org</a>.
            We will respond within 30 days.
          </p>

          <h2>8. Data Retention</h2>
          <p>
            We retain your data for as long as your account is active. Execution logs are retained
            for 90 days by default. If you request deletion, we will remove your personal data
            within 30 days. Anonymized, aggregated data may be retained for analytics purposes.
          </p>

          <h2>9. Age Restriction</h2>
          <p>
            AskAlf is not intended for use by anyone under the age of 18. We do not knowingly
            collect personal information from minors.
          </p>

          <h2>10. Changes to This Policy</h2>
          <p>
            We may update this policy from time to time. We will notify you of any material
            changes by email or through a notice on our website. Continued use of the Service
            after changes constitutes acceptance of the updated policy.
          </p>

          <h2>11. Contact</h2>
          <p>
            For questions about this privacy policy, contact us at{' '}
            <a href="mailto:support@askalf.org">support@askalf.org</a>.
          </p>
        </div>
      </section>

      <footer className="landing-footer" role="contentinfo">
        <div className="landing-footer-inner">
          <div className="landing-footer-left">
            <span className="landing-footer-copy">
              {'\u00A9'} {new Date().getFullYear()} AskAlf. All rights reserved.
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
