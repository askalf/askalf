import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import HeaderMenu from '../components/layout/HeaderMenu';
import { useThemeStore } from '../stores/theme';
import { useBugReport } from '../contexts/BugReportContext';
import './Legal.css';

export default function Terms() {
  const { openBugReport } = useBugReport();
  // Force dark theme on marketing pages
  useEffect(() => {
    const root = document.documentElement;
    const previousTheme = root.getAttribute('data-theme');
    root.setAttribute('data-theme', 'dark');
    document.title = 'Terms of Service — Ask ALF';
    return () => {
      if (previousTheme) {
        root.setAttribute('data-theme', previousTheme);
      } else {
        useThemeStore.getState().applyTheme();
      }
    };
  }, []);

  return (
    <div className="legal-page">
      <header className="legal-header">
        <Link to="/" className="legal-logo">
          <span className="legal-logo-icon">👽</span>
          <span className="legal-logo-text">
            <span className="legal-logo-ask">Ask</span>
            <span className="legal-logo-alf">ALF</span>
          </span>
        </Link>
        <div className="legal-header-right">
          <HeaderMenu />
          <Link to="/login" className="legal-header-btn legal-header-btn-secondary">Log in</Link>
          <Link to="/signup" className="legal-header-btn legal-header-btn-primary">Sign up free</Link>
        </div>
      </header>

      <main className="legal-content">
        <h1>Terms of Service</h1>
        <p className="legal-updated">Last updated: January 2026</p>

        <p>
          These Terms of Service ("Terms") govern your access to and use of Ask ALF,
          including our website, APIs, and related services (collectively, the "Service").
          By accessing or using the Service, you agree to be bound by these Terms.
        </p>

        <h2>1. Acceptance of Terms</h2>
        <p>
          By creating an account or using the Service, you confirm that you are at least 18 years old
          and have the legal capacity to enter into this agreement. If you are using the Service on
          behalf of an organization, you represent that you have authority to bind that organization
          to these Terms.
        </p>

        <h2>2. Account Registration</h2>
        <p>To use certain features of the Service, you must create an account. You agree to:</p>
        <ul>
          <li>Provide accurate and complete registration information</li>
          <li>Maintain the security of your account credentials</li>
          <li>Promptly update any information to keep it accurate</li>
          <li>Accept responsibility for all activities under your account</li>
        </ul>

        <h2>3. Acceptable Use</h2>
        <p>You agree not to use the Service to:</p>
        <ul>
          <li>Violate any applicable laws or regulations</li>
          <li>Infringe on intellectual property rights of others</li>
          <li>Transmit malware, viruses, or other harmful code</li>
          <li>Attempt to gain unauthorized access to our systems</li>
          <li>Interfere with or disrupt the Service</li>
          <li>Store or transmit content that is illegal, harmful, or objectionable</li>
          <li>Use the Service to develop competing products</li>
          <li>Exceed rate limits or abuse the API</li>
        </ul>

        <h2>4. Your Content and Data</h2>
        <p>
          You retain ownership of all content you submit to the Service ("Your Content"). By submitting
          content, you grant us a license to process, store, and transform Your Content as necessary
          to provide the Service, including building personalized memory (shards) from your conversations.
        </p>
        <p>
          You are responsible for ensuring you have the right to submit Your Content and that it
          does not violate any third-party rights.
        </p>

        <h2>5. Service Access and Billing</h2>
        <p>
          We may offer various service tiers with different features and limits. By purchasing
          any paid offering, you agree to pay all applicable fees. Fees are non-refundable except
          as required by law.
        </p>
        <ul>
          <li>Recurring charges renew automatically unless cancelled</li>
          <li>Pricing changes will be communicated with 30 days notice</li>
          <li>You can cancel at any time</li>
        </ul>

        <h2>6. Third-Party AI Providers</h2>
        <p>
          The Service uses third-party AI providers including OpenAI, Anthropic, and others to process
          your queries. By using the Service, you acknowledge and agree that:
        </p>
        <ul>
          <li>Your conversation content may be sent to these providers for processing</li>
          <li>These providers' terms of service and privacy policies also apply to your use</li>
          <li>We are not responsible for the actions or policies of third-party providers</li>
          <li>Provider availability may affect Service functionality</li>
        </ul>

        <h2>7. BYOK (Bring Your Own Key)</h2>
        <p>
          If you use your own API keys ("BYOK mode"), you agree to the following additional terms:
        </p>
        <ul>
          <li>You are responsible for all usage and costs incurred through your API keys</li>
          <li>Your API keys are stored encrypted on our servers for the purpose of making API calls on your behalf</li>
          <li>Your conversations still pass through our servers for memory processing and shard matching</li>
          <li>You must comply with the terms of service of your chosen AI provider</li>
          <li>We are not liable for charges incurred through your API keys</li>
        </ul>

        <h2>8. API Usage</h2>
        <p>
          Access to our API is subject to rate limits and usage quotas.
          You agree to implement reasonable retry logic and respect rate limit headers. Excessive
          API abuse may result in temporary or permanent suspension.
        </p>

        <h2>9. Intellectual Property</h2>
        <p>
          The Service, including all software, algorithms, designs, and documentation, is owned by
          Ask ALF and protected by intellectual property laws. These Terms do not grant you any
          right to use our trademarks, logos, or branding.
        </p>
        <p>
          Memory (shards) built from Your Content remain associated with your account and
          are subject to your account's visibility settings.
        </p>

        <h2>10. Privacy</h2>
        <p>
          Your use of the Service is subject to our <Link to="/privacy">Privacy Policy</Link>,
          which describes how we collect, use, and protect your information.
        </p>

        <h2>11. Disclaimers</h2>
        <p className="legal-caps">
          The Service is provided "as is" without warranties of any kind, express or implied.
          We do not guarantee that the Service will be uninterrupted, error-free, or secure.
          AI-generated responses may contain inaccuracies and should be validated before
          critical use.
        </p>

        <h2>12. Limitation of Liability</h2>
        <p className="legal-caps">
          To the maximum extent permitted by law, Ask ALF shall not be liable for any indirect,
          incidental, special, consequential, or punitive damages, or any loss of profits or
          revenues. Our total liability shall not exceed the amount you paid us in the twelve
          months preceding the claim.
        </p>

        <h2>13. Indemnification</h2>
        <p>
          You agree to indemnify and hold harmless Ask ALF from any claims, losses, or damages
          arising from your use of the Service, your violation of these Terms, or your violation
          of any third-party rights.
        </p>

        <h2>14. Termination</h2>
        <p>
          We may suspend or terminate your access to the Service at any time for violation of these
          Terms or for any other reason. Upon termination, your right to use the Service ceases
          immediately. You may export your data before termination.
        </p>

        <h2>15. Changes to Terms</h2>
        <p>
          We may modify these Terms at any time. We will notify you of material changes by email
          or through the Service. Continued use of the Service after changes constitutes acceptance
          of the new Terms.
        </p>

        <h2>16. Governing Law</h2>
        <p>
          These Terms are governed by the laws of the State of Delaware, United States, without
          regard to conflict of law principles. Any disputes shall be resolved in the courts of
          Delaware.
        </p>

        <h2>17. Contact</h2>
        <p>
          For questions about these Terms, please contact us at{' '}
          <a href="mailto:legal@askalf.org">legal@askalf.org</a>.
        </p>
      </main>

      <footer className="legal-footer">
        <Link to="/">Back to Ask ALF</Link>
        <span className="legal-footer-divider">|</span>
        <Link to="/privacy">Privacy</Link>
        <span className="legal-footer-divider">|</span>
        <button className="legal-footer-link" onClick={openBugReport}>Contact</button>
      </footer>
    </div>
  );
}
