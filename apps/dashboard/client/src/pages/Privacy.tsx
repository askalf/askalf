import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import HeaderMenu from '../components/layout/HeaderMenu';
import { useThemeStore } from '../stores/theme';
import { useBugReport } from '../contexts/BugReportContext';
import './Legal.css';

export default function Privacy() {
  const { openBugReport } = useBugReport();
  // Force dark theme on marketing pages
  useEffect(() => {
    const root = document.documentElement;
    const previousTheme = root.getAttribute('data-theme');
    root.setAttribute('data-theme', 'dark');
    document.title = 'Privacy Policy — Ask ALF';
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
        <h1>Privacy Policy</h1>
        <p className="legal-updated">Last updated: January 2026</p>

        <p>
          Ask ALF ("we", "our", or "us") is committed to protecting your privacy. This Privacy Policy
          explains how we collect, use, disclose, and safeguard your information when you use our
          service.
        </p>

        <div className="short-version">
          <h3>The Short Version</h3>
          <p><strong>Your data is yours. Period.</strong></p>
          <ul>
            <li>Your profile and memory are encrypted — we cannot see them and never will</li>
            <li>Your data is completely isolated — no other user can access it</li>
            <li>We do NOT use your data to train AI models</li>
            <li>We do NOT sell your data to third parties</li>
            <li>You can view, export, or delete your data at any time</li>
          </ul>
        </div>

        <h2>Your Memory, Your Control</h2>
        <p>
          Ask ALF builds a personal memory system from your conversations. Here's exactly what we store
          and how it's protected:
        </p>
        <ul>
          <li><strong>Shards (Procedural Memory):</strong> Learned patterns and successful responses. These are cryptographically isolated per user using tenant-based encryption.</li>
          <li><strong>Traces (Working Memory):</strong> Recent conversation context. Auto-expires after 7 days of inactivity.</li>
          <li><strong>Facts (Semantic Memory):</strong> Extracted knowledge. Only derived from your conversations, never shared.</li>
          <li><strong>Episodes:</strong> Problem-solving patterns. Isolated per user, used only to improve your experience.</li>
        </ul>
        <p>
          <strong>Important:</strong> Your private shards are never visible to other users — they are encrypted and isolated to your account.
          Public shards consist of ALF's built-in crystallized knowledge (math, conversions, common facts) generated autonomously by ALF's metabolic loop.
        </p>

        <h2>Your ALF & ME Profile</h2>
        <p>
          ALF & ME is your personalized profile that helps ALF understand how to best assist you.
          This profile is <strong>encrypted with AES-256</strong> and <strong>completely isolated</strong> to your account.
          We cannot see your profile data and never will — it exists solely to personalize your experience.
        </p>
        <p>Your ALF & ME profile may include:</p>
        <ul>
          <li><strong>Communication Preferences:</strong> How you prefer ALF to respond (tone, detail level, format)</li>
          <li><strong>Context About You:</strong> Profession, interests, domains, and goals you've shared</li>
          <li><strong>Custom Instructions:</strong> Specific guidance you've given ALF</li>
          <li><strong>Learning Settings:</strong> Whether ALF learns from your corrections and interactions</li>
          <li><strong>Topics to Avoid:</strong> Subjects you've asked ALF not to bring up</li>
        </ul>
        <p>
          <strong>Your Control:</strong> You can view your complete ALF & ME profile and selectively clear any section
          at any time in your Account Settings. Essential fields like your name are retained for basic functionality.
        </p>

        <h2>Conversation History</h2>
        <p>
          We provide <strong>unlimited conversation storage</strong>. Your conversations are saved
          only when you choose to save them, and you can delete any conversation at any time.
        </p>
        <ul>
          <li><strong>Storage:</strong> Unlimited, encrypted, isolated to your account</li>
          <li><strong>Deletion:</strong> Delete individual conversations or clear all history anytime</li>
          <li><strong>Incognito Mode:</strong> Toggle incognito mode for conversations that won't be saved or used
            for memory — no persistence, no shards created</li>
        </ul>

        <h2>BYOK (Bring Your Own Key) Mode</h2>
        <p>When you use your own API keys, you get these benefits:</p>
        <ul>
          <li>Your API usage is billed directly by your provider (OpenAI, Anthropic, etc.), not through us</li>
          <li>You control your own usage and costs directly with your provider</li>
          <li>If a shard matches your query, no external AI call is needed at all</li>
        </ul>
        <p>
          <strong>Note:</strong> Your conversations still pass through our servers for shard matching and memory processing.
          The same data protections (encryption, isolation, no training) apply regardless of whether you use BYOK or our standard service.
        </p>

        <h2>Information We Collect</h2>
        <p>We collect information that you provide directly to us:</p>
        <ul>
          <li><strong>Account Information:</strong> Email address, name, and password when you create an account</li>
          <li><strong>Payment Information:</strong> Processed securely through Stripe; we do not store credit card numbers</li>
          <li><strong>Conversation Data:</strong> Timestamps, intent classifications, shard hit rates, and conversation content for memory processing</li>
          <li><strong>Environmental Impact:</strong> Tokens saved, water/power metrics — aggregated and anonymized for global counters</li>
        </ul>

        <h2>How We Use Your Information</h2>
        <p>We use the information we collect to:</p>
        <ul>
          <li>Provide, maintain, and improve our services</li>
          <li>Build your personalized memory system (shards, traces, facts)</li>
          <li>Calculate your environmental impact savings</li>
          <li>Process transactions and send related information</li>
          <li>Send technical notices, updates, and support messages</li>
        </ul>
        <p>
          <strong>What we never do:</strong> Train AI models on your data, sell your information,
          or share your memory with other users.
        </p>

        <h2>Data Retention</h2>
        <table className="data-table">
          <tbody>
            <tr>
              <td>Conversations</td>
              <td>Unlimited storage; delete anytime</td>
            </tr>
            <tr>
              <td>ALF & ME Profile</td>
              <td>Until you clear sections or close account</td>
            </tr>
            <tr>
              <td>Working Memory (Traces)</td>
              <td>7 days after last activity</td>
            </tr>
            <tr>
              <td>Shards & Facts</td>
              <td>Until you delete them or close account</td>
            </tr>
            <tr>
              <td>Public Shard Contributions</td>
              <td>Permanent (community resource)</td>
            </tr>
            <tr>
              <td>Account Data</td>
              <td>Until you delete your account</td>
            </tr>
            <tr>
              <td>After Account Deletion</td>
              <td>30 days grace period, then permanently deleted</td>
            </tr>
          </tbody>
        </table>

        <h2>Data Storage and Security</h2>
        <p>Your data is stored in secure, encrypted databases with tenant-based isolation:</p>
        <ul>
          <li><strong>TLS 1.3:</strong> All data in transit is encrypted</li>
          <li><strong>AES-256:</strong> All data at rest is encrypted</li>
          <li><strong>Tenant Isolation:</strong> Cryptographic separation between users</li>
          <li><strong>No Public Ports:</strong> Our infrastructure has no direct internet exposure</li>
          <li><strong>Cloudflare Protection:</strong> DDoS mitigation, WAF, and Zero Trust access</li>
          <li><strong>Daily Backups:</strong> Encrypted backups stored securely</li>
        </ul>

        <h2>Third-Party AI Providers</h2>
        <p>
          When your query requires an AI response (and no shard match is found), your conversation
          is sent to third-party AI providers:
        </p>
        <ul>
          <li><strong>Providers:</strong> OpenAI, Anthropic, and others based on your model selection</li>
          <li><strong>What's shared:</strong> Your query and necessary context for generating a response</li>
          <li><strong>Their policies apply:</strong> These providers have their own privacy policies governing how they handle your data</li>
          <li><strong>No training:</strong> We use API endpoints that do not use your data for model training</li>
        </ul>
        <p>
          When using BYOK, the same data is sent but using your API key. Your API keys are stored
          encrypted (AES-256) and only decrypted at the moment of making API calls.
        </p>

        <h2>Demo and Free Tier</h2>
        <p>If you use our demo or free tier without creating an account:</p>
        <ul>
          <li>We store a fingerprint hash (not reversible) to enforce usage limits</li>
          <li>Demo conversations are not stored permanently</li>
          <li>No personal information is collected unless you create an account</li>
          <li>IP addresses are hashed for rate limiting, not stored in plain text</li>
        </ul>

        <h2>Sharing of Information</h2>
        <p>We do not sell your personal information. We may share information:</p>
        <ul>
          <li>With AI providers as described above when your query requires an AI call</li>
          <li>With Stripe for payment processing — only payment data, never conversation data</li>
          <li>To comply with valid legal requests (we will notify you unless prohibited)</li>
          <li>To protect our rights and prevent fraud</li>
        </ul>

        <h2>Your Rights</h2>
        <p>You have the right to:</p>
        <ul>
          <li><strong>Access:</strong> View your complete ALF & ME profile and download all your data including conversations, shards, traces, and facts</li>
          <li><strong>Correct:</strong> Edit your ALF & ME profile or retrain any shard in your memory</li>
          <li><strong>Delete:</strong> Remove specific conversations, selectively clear ALF & ME profile sections, delete individual shards, or close your entire account</li>
          <li><strong>Export:</strong> Get your data in JSON format for portability</li>
          <li><strong>Object:</strong> Opt out of specific data processing via your learning settings</li>
        </ul>
        <p>
          All these actions are available in your <strong>Account Settings &gt; Privacy & Control</strong> or by contacting{' '}
          <a href="mailto:privacy@askalf.org">privacy@askalf.org</a>.
        </p>

        <h2>Environmental Transparency</h2>
        <p>We track environmental savings when shards answer your queries instead of calling external AI:</p>
        <ul>
          <li><strong>~500ml water</strong> saved per 1,000 tokens avoided</li>
          <li><strong>~10Wh power</strong> saved per 1,000 tokens avoided</li>
          <li><strong>~5g CO2</strong> avoided per 1,000 tokens</li>
        </ul>
        <p>
          These metrics are based on published research on AI infrastructure costs. Individual savings
          are shown in your dashboard; global totals are aggregated anonymously.
        </p>

        <h2>Cookies</h2>
        <p>We use minimal cookies:</p>
        <ul>
          <li><strong>Session cookie:</strong> Required for authentication</li>
          <li><strong>Preference cookies:</strong> Remember your settings (theme, model preferences)</li>
        </ul>
        <p>We do not use advertising cookies or third-party tracking.</p>

        <h2>Changes to This Policy</h2>
        <p>
          We may update this Privacy Policy from time to time. We will notify you of material changes
          by email and by posting the new policy on this page. The "Last updated" date will always
          reflect the most recent version.
        </p>

        <h2>Contact Us</h2>
        <p>
          If you have questions about this Privacy Policy, please contact us at{' '}
          <a href="mailto:privacy@askalf.org">privacy@askalf.org</a>.
        </p>
        <p>
          For security concerns, contact <a href="mailto:security@askalf.org">security@askalf.org</a>.
        </p>
      </main>

      <footer className="legal-footer">
        <Link to="/">Back to Ask ALF</Link>
        <span className="legal-footer-divider">|</span>
        <Link to="/terms">Terms of Service</Link>
        <span className="legal-footer-divider">|</span>
        <button className="legal-footer-link" onClick={openBugReport}>Contact</button>
      </footer>
    </div>
  );
}
