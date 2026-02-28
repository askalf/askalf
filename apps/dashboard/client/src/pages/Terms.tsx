import { Link } from 'react-router-dom';
import './Landing.css';

export default function Terms() {
  return (
    <div className="landing-page legal-page">
      <nav className="landing-nav" aria-label="Main navigation">
        <Link to="/" className="landing-nav-logo">
          <span className="landing-nav-logo-text">askalf</span>
        </Link>
        <div className="landing-nav-links">
          <Link to="/login" className="landing-nav-signin">Sign In</Link>
        </div>
      </nav>

      <section className="legal-content">
        <p className="landing-section-label">// legal</p>
        <h1 className="landing-section-title" style={{ marginBottom: '0.5rem' }}>Terms of Service</h1>
        <p className="legal-updated">Last updated: February 27, 2026</p>

        <div className="legal-body">
          <h2>1. Acceptance of Terms</h2>
          <p>
            By accessing or using AskAlf (&ldquo;the Service&rdquo;), you agree to be bound by these
            Terms of Service. If you do not agree, do not use the Service.
          </p>

          <h2>2. Service Description</h2>
          <p>
            AskAlf is an AI agent orchestration platform. The Service enables you to create,
            configure, and deploy AI agents that can control computers, browse the web, access
            terminals, and interact with applications on your behalf. The Service is currently
            in closed beta.
          </p>

          <h2>3. Beta Program</h2>
          <p>
            The Service is currently provided as a beta. It is offered &ldquo;as-is&rdquo; without warranty
            of any kind. We may modify, suspend, or discontinue any part of the Service at any
            time during the beta period. During beta, the Service is provided at no cost.
            Pricing will be communicated before any paid tiers are introduced.
          </p>

          <h2>4. Your Account</h2>
          <p>
            You are responsible for maintaining the security of your account credentials.
            You must not share your account or API keys with unauthorized parties.
            Notify us immediately if you suspect unauthorized access. You are responsible
            for all activity that occurs under your account.
          </p>

          <h2>5. Your Credentials &amp; API Keys</h2>
          <p>
            The Service uses a Bring Your Own Key (BYOK) model. You provide your own API keys
            or OAuth credentials for AI providers (Anthropic, OpenAI, Google, etc.).
            You are solely responsible for:
          </p>
          <ul>
            <li>The security and proper use of your API keys</li>
            <li>All costs incurred through your API keys with third-party providers</li>
            <li>Complying with the terms of service of each AI provider you use</li>
            <li>Monitoring your usage and spending with each provider</li>
          </ul>
          <p>
            AskAlf stores your credentials encrypted at rest and uses them only to execute
            agent tasks you initiate. We never access your credentials for any other purpose.
          </p>

          <h2>6. Your Data</h2>
          <p>
            You retain ownership of all data you submit to the Service, including agent
            configurations, prompts, workflows, and execution results. We do not claim any
            intellectual property rights over your content. We do not use your data to train
            AI models.
          </p>

          <h2>7. AI-Generated Content</h2>
          <p>
            Agents powered by the Service produce AI-generated output. You acknowledge that:
          </p>
          <ul>
            <li>AI-generated content may be inaccurate, incomplete, or inappropriate</li>
            <li>You are responsible for reviewing all agent actions and outputs before relying on them</li>
            <li>The Service does not guarantee the correctness, safety, or fitness of any AI output</li>
            <li>Agents that control computers can take irreversible actions &mdash; use guardrails and checkpoints</li>
          </ul>

          <h2>8. Acceptable Use</h2>
          <p>You agree not to:</p>
          <ul>
            <li>Use the Service for any illegal or unauthorized purpose</li>
            <li>Deploy agents to perform actions you are not authorized to take</li>
            <li>Attempt to gain unauthorized access to our systems or other users&apos; data</li>
            <li>Use agents to generate spam, malware, or harmful content</li>
            <li>Interfere with or disrupt the Service or its infrastructure</li>
            <li>Use the Service to build a directly competing product</li>
            <li>Circumvent rate limits, quotas, or security controls</li>
          </ul>

          <h2>9. API Usage &amp; Rate Limits</h2>
          <p>
            The Service may impose rate limits and usage quotas. Exceeding these limits may
            result in temporary restriction of access. AI provider costs incurred through the
            platform via your API keys are entirely your responsibility.
          </p>

          <h2>10. Indemnification</h2>
          <p>
            You agree to indemnify and hold harmless AskAlf, its operators, and affiliates from
            any claims, damages, or expenses arising from your use of the Service, your violation
            of these Terms, or actions taken by agents operating under your account.
          </p>

          <h2>11. Limitation of Liability</h2>
          <p>
            To the maximum extent permitted by law, AskAlf shall not be liable for any
            indirect, incidental, special, consequential, or punitive damages, including loss
            of data or profits, arising from your use of the Service. Our total liability
            shall not exceed the amount you have paid us in the twelve months preceding the claim.
          </p>

          <h2>12. Termination</h2>
          <p>
            Either party may terminate the account at any time. We may terminate or suspend
            access immediately if you violate these terms. Upon termination, you may request
            export of your data within 30 days, after which it will be permanently deleted.
          </p>

          <h2>13. Intellectual Property</h2>
          <p>
            The Service, including its design, code, trademarks, and documentation, is the
            property of AskAlf and its licensors. Nothing in these Terms grants you rights
            to our intellectual property except the limited right to use the Service as described herein.
          </p>

          <h2>14. Severability</h2>
          <p>
            If any provision of these Terms is found to be unenforceable, the remaining
            provisions shall continue in full force and effect.
          </p>

          <h2>15. Changes to Terms</h2>
          <p>
            We may update these terms from time to time. We will notify you of material changes
            by email or through the Service. Continued use after changes constitutes acceptance.
          </p>

          <h2>16. Contact</h2>
          <p>
            For questions about these terms, contact us at{' '}
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
            <Link to="/privacy" className="landing-footer-link">Privacy</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
