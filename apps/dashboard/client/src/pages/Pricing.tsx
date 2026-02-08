import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import HeaderMenu from '../components/layout/HeaderMenu';
import { useThemeStore } from '../stores/theme';
import './Legal.css';

export default function Pricing() {
  // Force light theme on marketing pages
  useEffect(() => {
    const root = document.documentElement;
    const previousTheme = root.getAttribute('data-theme');
    root.setAttribute('data-theme', 'dark');
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

      <main className="legal-content wide">
        {/* Coming Soon Overlay */}
        <div className="pricing-coming-soon-overlay">
          <div className="pricing-coming-soon-content">
            <span className="pricing-coming-soon-icon">🚀</span>
            <h2>Pricing Coming Soon</h2>
            <p>We're finalizing our plans to bring you the best value.</p>
            <p className="pricing-coming-soon-sub">Get started with a free account today!</p>
            <Link to="/signup" className="pricing-coming-soon-btn">Sign Up Free</Link>
          </div>
        </div>

        <div className="pricing-blurred">
        <div className="pricing-hero">
          <h1>Plans & Pricing</h1>
          <p className="hero-subtitle">Simple, Transparent Pricing for Everyone</p>
          <p className="hero-description">
            Choose the plan that fits your needs. All plans include unlimited knowledge shard hits —
            when ALF already knows the answer, <span style={{ whiteSpace: 'nowrap' }}>you pay nothing.</span>
          </p>
        </div>

        {/* Pricing Grid - 5 Tiers */}
        <div className="pricing-grid">
          {/* Free Tier */}
          <div className="pricing-card">
            <div className="pricing-tier">
              <span className="tier-icon">🌱</span>
              <span className="tier-name">Free</span>
              <span className="tier-badge free">Forever Free</span>
            </div>
            <div className="pricing-price">
              <span className="pricing-amount">$0</span>
              <span className="pricing-period">/month</span>
            </div>
            <p className="pricing-description">Perfect for trying out ALF and light usage</p>
            <div className="pricing-included">
              <div className="pricing-included-title">Included</div>
              <div className="pricing-included-item"><span className="check">✓</span> 50 credits/day</div>
              <div className="pricing-included-item"><span className="check">✓</span> <a href="#credits">All models</a></div>
              <div className="pricing-included-item highlight">∞ Knowledge Shard hits</div>
            </div>
            <ul className="pricing-features">
              <li>Credits reset daily (no rollover)</li>
              <li>Unlimited conversation storage</li>
              <li>Public shard library access</li>
            </ul>
            <div className="pricing-cta">
              <Link to="/signup" className="pricing-cta-btn pricing-cta-secondary">Get Started Free</Link>
            </div>
          </div>

          {/* Basic Tier */}
          <div className="pricing-card">
            <div className="pricing-tier">
              <span className="tier-icon">⚡</span>
              <span className="tier-name">Basic</span>
            </div>
            <div className="pricing-price">
              <span className="pricing-amount">$15</span>
              <span className="pricing-period">/month</span>
            </div>
            <p className="pricing-description">For regular users who want more power</p>
            <div className="pricing-included">
              <div className="pricing-included-title">Included</div>
              <div className="pricing-included-item"><span className="check">✓</span> 200 credits/day</div>
              <div className="pricing-included-item"><span className="check">✓</span> <a href="#credits">All models</a></div>
              <div className="pricing-included-item highlight">∞ Knowledge Shard hits</div>
            </div>
            <ul className="pricing-features">
              <li>Everything in Free</li>
              <li>7-day credit rollover (max 1,400)</li>
              <li>Private knowledge shards</li>
              <li>Priority support</li>
            </ul>
            <div className="pricing-cta">
              <span className="pricing-cta-btn pricing-cta-disabled">Coming Soon</span>
            </div>
          </div>

          {/* Pro Tier */}
          <div className="pricing-card">
            <div className="pricing-tier">
              <span className="tier-icon">🚀</span>
              <span className="tier-name">Pro</span>
              <span className="tier-badge byok">BYOK Ready</span>
            </div>
            <div className="pricing-price">
              <span className="pricing-amount">$25</span>
              <span className="pricing-period">/month</span>
            </div>
            <p className="pricing-description">For power users who want BYOK and API access</p>
            <div className="pricing-included">
              <div className="pricing-included-title">Included</div>
              <div className="pricing-included-item"><span className="check">✓</span> 350 credits/day</div>
              <div className="pricing-included-item"><span className="check">✓</span> <a href="#credits">All models</a></div>
              <div className="pricing-included-item highlight">∞ Knowledge Shard hits</div>
            </div>
            <ul className="pricing-features">
              <li>Everything in Basic</li>
              <li>7-day credit rollover (max 2,450)</li>
              <li>Bring Your Own Keys (BYOK)</li>
              <li>API access</li>
              <li>Advanced memory controls</li>
            </ul>
            <div className="pricing-cta">
              <span className="pricing-cta-btn pricing-cta-disabled">Coming Soon</span>
            </div>
          </div>

          {/* Team Tier */}
          <div className="pricing-card">
            <div className="pricing-tier">
              <span className="tier-icon">👥</span>
              <span className="tier-name">Team</span>
              <span className="tier-badge team">Min 2 Users</span>
            </div>
            <div className="pricing-price">
              <span className="pricing-amount">$25</span>
              <span className="pricing-period">/user/month</span>
            </div>
            <p className="pricing-description">Collaborate with shared organizational memory</p>
            <div className="pricing-included">
              <div className="pricing-included-title">Included Per User</div>
              <div className="pricing-included-item"><span className="check">✓</span> 350 credits/day per user</div>
              <div className="pricing-included-item"><span className="check">✓</span> <a href="#credits">All models</a></div>
              <div className="pricing-included-item highlight">∞ Knowledge Shard hits</div>
            </div>
            <ul className="pricing-features">
              <li>Everything in Pro</li>
              <li>7-day credit rollover (max 2,450)</li>
              <li>Shared team memory</li>
              <li>Team administration</li>
              <li>SSO integration</li>
            </ul>
            <div className="pricing-cta">
              <span className="pricing-cta-btn pricing-cta-disabled">Coming Soon</span>
            </div>
          </div>

          {/* Enterprise Tier */}
          <div className="pricing-card pricing-card-enterprise">
            <div className="pricing-tier">
              <span className="tier-icon">🏢</span>
              <span className="tier-name">Enterprise</span>
              <span className="tier-badge enterprise">Custom</span>
            </div>
            <div className="pricing-price">
              <span className="pricing-amount">Custom</span>
            </div>
            <p className="pricing-description">For organizations that need complete control</p>
            <div className="pricing-included">
              <div className="pricing-included-title">Everything Custom</div>
              <div className="pricing-included-item"><span className="check">✓</span> Custom credit limits</div>
              <div className="pricing-included-item"><span className="check">✓</span> <a href="#credits">All models</a></div>
              <div className="pricing-included-item highlight">∞ Knowledge Shard hits</div>
            </div>
            <ul className="pricing-features">
              <li>Everything in Team</li>
              <li>Self-hosted deployment</li>
              <li>Custom SLAs</li>
              <li>Dedicated support</li>
              <li>White-label options</li>
            </ul>
            <div className="pricing-cta">
              <a href="mailto:enterprise@askalf.org" className="pricing-cta-btn pricing-cta-secondary">Contact Sales</a>
            </div>
          </div>
        </div>

        {/* Lifetime Pro Deal */}
        <div className="lifetime-section">
          <div className="lifetime-badge">Early Adopter Pricing</div>
          <div className="lifetime-content">
            <div className="lifetime-left">
              <h3>Lifetime Pro Access</h3>
              <p>One payment, Pro features forever. For early believers who want to lock in value.</p>
              <div className="lifetime-scarcity">
                <span className="lifetime-scarcity-label">First 1,000 members</span>
                <span className="lifetime-scarcity-after">Then $499</span>
              </div>
            </div>
            <div className="lifetime-right">
              <div className="lifetime-price">
                <div className="lifetime-amount">$299</div>
                <div className="lifetime-compare">
                  <span className="lifetime-strikethrough">$499</span> — save $200
                </div>
              </div>
              <span className="pricing-cta-btn pricing-cta-disabled">Coming Soon</span>
            </div>
          </div>
          <div className="lifetime-features">
            <span>350 credits/day</span>
            <span>7-day rollover (max 2,450)</span>
            <span><a href="#credits">All models</a></span>
            <span>BYOK support</span>
            <span>API access</span>
            <span>Private shards</span>
            <span>Forever yours</span>
          </div>
        </div>

        {/* Credits System */}
        <div id="credits" className="credits-section">
          <div className="credits-header">
            <h3>How Credits Work</h3>
            <p>Every plan gets access to every model. Your credits work across all of them — just pick the right tool for the job.</p>
          </div>
          <div className="credits-grid">
            <div className="credit-tier">
              <div className="credit-tier-name">Fast Models</div>
              <div className="credit-tier-cost">1</div>
              <div className="credit-tier-label">credit per message</div>
              <div className="credit-tier-models">
                <span className="credit-model-tag">Gemini 2.0 Flash</span>
                <span className="credit-model-tag">GPT-4o Mini</span>
                <span className="credit-model-tag">Claude 3.5 Haiku</span>
                <span className="credit-model-tag">Grok 2 Mini</span>
              </div>
            </div>
            <div className="credit-tier">
              <div className="credit-tier-name">Standard Models</div>
              <div className="credit-tier-cost">2</div>
              <div className="credit-tier-label">credits per message</div>
              <div className="credit-tier-models">
                <span className="credit-model-tag">GPT-5</span>
                <span className="credit-model-tag">Claude Sonnet 4</span>
                <span className="credit-model-tag">Gemini 2.0 Pro</span>
                <span className="credit-model-tag">Grok 3</span>
              </div>
            </div>
            <div className="credit-tier">
              <div className="credit-tier-name">Reasoning Models</div>
              <div className="credit-tier-cost">10</div>
              <div className="credit-tier-label">credits per message</div>
              <div className="credit-tier-models">
                <span className="credit-model-tag">GPT-5.2 / o3</span>
                <span className="credit-model-tag">Claude Opus 4.5</span>
                <span className="credit-model-tag">Gemini 3 Pro</span>
                <span className="credit-model-tag">Grok 4.1</span>
              </div>
            </div>
          </div>
          <p className="credits-note">
            <strong>Knowledge Shard hits = 0 credits.</strong> The more ALF learns, the less you pay.
          </p>
        </div>

        {/* BYOK Section */}
        <div className="byok-section">
          <div className="byok-header">
            <span className="byok-icon">🔑</span>
            <h3>Bring Your Own Keys (BYOK)</h3>
            <span className="byok-badge">Zero Markup</span>
            <span className="byok-requires">Requires Pro+</span>
          </div>
          <p className="byok-description">
            Use your own OpenAI, Anthropic, Google, or xAI API keys. Your usage is billed directly by your provider
            with zero Ask ALF markup. <strong>BYOK completely bypasses daily credit limits</strong> — you control your own usage and costs.
            You still get all the benefits of knowledge shards and intelligent routing.
          </p>
          <div className="byok-benefits">
            <div className="byok-benefit">
              <span className="byok-benefit-icon">💰</span>
              <div className="byok-benefit-text">
                <strong>Direct Billing</strong>
                <span>Pay your provider directly at their rates</span>
              </div>
            </div>
            <div className="byok-benefit">
              <span className="byok-benefit-icon">🔓</span>
              <div className="byok-benefit-text">
                <strong>Bypass Credit Limits</strong>
                <span>No daily caps — unlimited messages</span>
              </div>
            </div>
            <div className="byok-benefit">
              <span className="byok-benefit-icon">💎</span>
              <div className="byok-benefit-text">
                <strong>Shard Savings</strong>
                <span>Shards still save API calls (0 cost)</span>
              </div>
            </div>
            <div className="byok-benefit">
              <span className="byok-benefit-icon">🔒</span>
              <div className="byok-benefit-text">
                <strong>Encrypted Storage</strong>
                <span>Keys stored with AES-256 encryption</span>
              </div>
            </div>
          </div>
        </div>

        {/* Credit Bundles */}
        <section>
          <h2>Credit Bundles</h2>
          <p>Need more credits? Buy bundles that never expire. Use them on any model, any time — they're yours forever.</p>
          <div className="bundles-grid">
            <div className="bundle-card">
              <div className="bundle-credits">100</div>
              <div className="bundle-label">Credits</div>
              <div className="bundle-price">$2</div>
              <div className="bundle-equiv">100 Fast · 50 Standard · 10 Reasoning</div>
            </div>
            <div className="bundle-card">
              <div className="bundle-credits">500</div>
              <div className="bundle-label">Credits</div>
              <div className="bundle-price">$5</div>
              <div className="bundle-equiv">500 Fast · 250 Standard · 50 Reasoning</div>
            </div>
            <div className="bundle-card">
              <div className="bundle-credits">2,500</div>
              <div className="bundle-label">Credits</div>
              <div className="bundle-price">$20</div>
              <div className="bundle-equiv">2.5k Fast · 1.25k Standard · 250 Reasoning</div>
            </div>
            <div className="bundle-card best-value">
              <div className="bundle-credits">10,000</div>
              <div className="bundle-label">Credits</div>
              <div className="bundle-price">$60</div>
              <div className="bundle-equiv">10k Fast · 5k Standard · 1k Reasoning</div>
            </div>
            <div className="bundle-card">
              <div className="bundle-credits">50,000</div>
              <div className="bundle-label">Credits</div>
              <div className="bundle-price">$250</div>
              <div className="bundle-equiv">50k Fast · 25k Standard · 5k Reasoning</div>
            </div>
          </div>
        </section>

        {/* Enterprise Deep Dive */}
        <div className="enterprise-section">
          <div className="enterprise-header">
            <h3>Enterprise <span>Deep Dive</span></h3>
            <p>For organizations that need complete control and customization</p>
          </div>
          <div className="enterprise-grid">
            <div className="enterprise-feature">
              <span className="enterprise-feature-icon">🏠</span>
              <div className="enterprise-feature-text">
                <strong>Self-Hosted</strong>
                <span>Run on your infrastructure with full data sovereignty</span>
              </div>
            </div>
            <div className="enterprise-feature">
              <span className="enterprise-feature-icon">🔐</span>
              <div className="enterprise-feature-text">
                <strong>SSO & SAML</strong>
                <span>Integrate with your identity provider</span>
              </div>
            </div>
            <div className="enterprise-feature">
              <span className="enterprise-feature-icon">📊</span>
              <div className="enterprise-feature-text">
                <strong>Usage Analytics</strong>
                <span>Detailed insights into team usage and savings</span>
              </div>
            </div>
            <div className="enterprise-feature">
              <span className="enterprise-feature-icon">🎨</span>
              <div className="enterprise-feature-text">
                <strong>White Label</strong>
                <span>Your brand, your domain, your experience</span>
              </div>
            </div>
            <div className="enterprise-feature">
              <span className="enterprise-feature-icon">📞</span>
              <div className="enterprise-feature-text">
                <strong>Dedicated Support</strong>
                <span>Named account manager and priority SLA</span>
              </div>
            </div>
            <div className="enterprise-feature">
              <span className="enterprise-feature-icon">🔧</span>
              <div className="enterprise-feature-text">
                <strong>Custom Integrations</strong>
                <span>Connect to your existing tools and workflows</span>
              </div>
            </div>
          </div>
          <div className="enterprise-cta">
            <a href="mailto:enterprise@askalf.org" className="pricing-cta-btn pricing-cta-secondary">Talk to Sales</a>
          </div>
        </div>

        {/* Comparison Table */}
        <section className="comparison-section">
          <h2>Compare All Features</h2>
          <table className="comparison-table">
            <thead>
              <tr>
                <th>Feature</th>
                <th>Free</th>
                <th>Basic</th>
                <th>Pro</th>
                <th>Team</th>
                <th>Enterprise</th>
              </tr>
            </thead>
            <tbody>
              <tr className="feature-category">
                <td colSpan={6}>Usage</td>
              </tr>
              <tr>
                <td>Daily Credits</td>
                <td>50</td>
                <td>200</td>
                <td>350</td>
                <td>350/user</td>
                <td>Unlimited</td>
              </tr>
              <tr>
                <td>Credit Rollover</td>
                <td className="dash">—</td>
                <td>7 days (1,400 max)</td>
                <td>7 days (2,450 max)</td>
                <td>7 days (2,450 max)</td>
                <td className="check">✓</td>
              </tr>
              <tr>
                <td>Knowledge Shard Hits</td>
                <td>∞</td>
                <td>∞</td>
                <td>∞</td>
                <td>∞</td>
                <td>∞</td>
              </tr>
              <tr>
                <td>Conversation History</td>
                <td>Unlimited</td>
                <td>Unlimited</td>
                <td>Unlimited</td>
                <td>Unlimited</td>
                <td>Unlimited</td>
              </tr>
              <tr className="feature-category">
                <td colSpan={6}>Models (All Tiers)</td>
              </tr>
              <tr>
                <td>Fast Models (1 credit)</td>
                <td className="check">✓</td>
                <td className="check">✓</td>
                <td className="check">✓</td>
                <td className="check">✓</td>
                <td className="check">✓</td>
              </tr>
              <tr>
                <td>Standard Models (2 credits)</td>
                <td className="check">✓</td>
                <td className="check">✓</td>
                <td className="check">✓</td>
                <td className="check">✓</td>
                <td className="check">✓</td>
              </tr>
              <tr>
                <td>Reasoning Models (10 credits)</td>
                <td className="check">✓</td>
                <td className="check">✓</td>
                <td className="check">✓</td>
                <td className="check">✓</td>
                <td className="check">✓</td>
              </tr>
              <tr className="feature-category">
                <td colSpan={6}>Memory</td>
              </tr>
              <tr>
                <td>Private Shards</td>
                <td className="dash">—</td>
                <td className="check">✓</td>
                <td className="check">✓</td>
                <td className="check">✓</td>
                <td className="check">✓</td>
              </tr>
              <tr>
                <td>Team Shards</td>
                <td className="dash">—</td>
                <td className="dash">—</td>
                <td className="dash">—</td>
                <td className="check">✓</td>
                <td className="check">✓</td>
              </tr>
              <tr className="feature-category">
                <td colSpan={6}>Developer</td>
              </tr>
              <tr>
                <td>API Access</td>
                <td className="dash">—</td>
                <td className="dash">—</td>
                <td className="check">✓</td>
                <td className="check">✓</td>
                <td className="check">✓</td>
              </tr>
              <tr>
                <td>BYOK Support</td>
                <td className="dash">—</td>
                <td className="dash">—</td>
                <td className="check">✓</td>
                <td className="check">✓</td>
                <td className="check">✓</td>
              </tr>
              <tr>
                <td>Webhooks</td>
                <td className="dash">—</td>
                <td className="dash">—</td>
                <td className="check">✓</td>
                <td className="check">✓</td>
                <td className="check">✓</td>
              </tr>
              <tr className="feature-category">
                <td colSpan={6}>Enterprise</td>
              </tr>
              <tr>
                <td>SSO/SAML</td>
                <td className="dash">—</td>
                <td className="dash">—</td>
                <td className="dash">—</td>
                <td className="check">✓</td>
                <td className="check">✓</td>
              </tr>
              <tr>
                <td>Self-Hosted</td>
                <td className="dash">—</td>
                <td className="dash">—</td>
                <td className="dash">—</td>
                <td className="dash">—</td>
                <td className="check">✓</td>
              </tr>
              <tr>
                <td>White Label</td>
                <td className="dash">—</td>
                <td className="dash">—</td>
                <td className="dash">—</td>
                <td className="dash">—</td>
                <td className="check">✓</td>
              </tr>
            </tbody>
          </table>
        </section>

        {/* FAQ Section */}
        <section className="faq-section">
          <h2>Frequently Asked Questions</h2>
          <div className="faq-grid">
            <div className="faq-item">
              <div className="faq-question">What are Knowledge Shards?</div>
              <div className="faq-answer">
                Knowledge Shards are crystallized knowledge that ALF learns. There are two types: public shards (ALF's built-in knowledge) available to everyone, and private shards (your personal patterns and preferences) visible only to you. When a shard matches your query, you get an instant answer without using any credits.
              </div>
            </div>
            <div className="faq-item">
              <div className="faq-question">How do credits work?</div>
              <div className="faq-answer">
                Every plan has access to every model from OpenAI, Anthropic, Google, and xAI. Fast models (Gemini 2.0 Flash, GPT-4o Mini, Claude 3.5 Haiku, Grok 2 Mini) cost 1 credit. Standard models (GPT-5, Claude Sonnet 4, Gemini 2.0 Pro, Grok 3) cost 2 credits. Reasoning models (GPT-5.2/o3, Claude Opus 4.5, Gemini 3 Pro, Grok 4.1) cost 10 credits. Knowledge Shard hits are always free!
              </div>
            </div>
            <div className="faq-item">
              <div className="faq-question">How does BYOK work?</div>
              <div className="faq-answer">
                With Pro and above, you can connect your own OpenAI, Anthropic, Google, or xAI API keys. Your usage is billed directly by your provider with zero markup. BYOK completely bypasses daily credit limits — you can send unlimited messages and only pay what you use. Shard hits still save you API calls.
              </div>
            </div>
            <div className="faq-item">
              <div className="faq-question">Do credits expire?</div>
              <div className="faq-answer">
                Free tier: Daily credits expire after 24 hours with no rollover. Paid tiers: Unused daily credits roll over for up to 7 days (Basic max 1,400, Pro/Team max 2,450). Purchased credit bundles never expire.
              </div>
            </div>
            <div className="faq-item">
              <div className="faq-question">What's the difference between public and private shards?</div>
              <div className="faq-answer">
                Public shards are ALF's built-in crystallized knowledge (math, conversions, common facts) that benefit all users. Private shards are your personal patterns learned from your conversations — only you can see and use them.
              </div>
            </div>
            <div className="faq-item">
              <div className="faq-question">What happens if I run out of credits?</div>
              <div className="faq-answer">
                Free tier users will be prompted to wait until tomorrow or upgrade. Paid users can use their bundle credits or buy more. Knowledge Shard hits always work regardless of credit balance!
              </div>
            </div>
            <div className="faq-item">
              <div className="faq-question">Can I switch plans?</div>
              <div className="faq-answer">
                Yes, you can upgrade or downgrade at any time. When upgrading, you'll be prorated for the remainder of your billing cycle. When downgrading, changes take effect at your next billing date.
              </div>
            </div>
            <div className="faq-item">
              <div className="faq-question">What's included in Lifetime Pro?</div>
              <div className="faq-answer">
                Lifetime Pro is a one-time payment for Pro features forever: 350 credits/day with 7-day rollover (max 2,450 banked), all models, BYOK support, API access, and private shards. Early adopter price is $299 for the first 1,000 members, then $499 after.
              </div>
            </div>
          </div>
        </section>
        </div>{/* End pricing-blurred */}
      </main>

      <footer className="legal-footer">
        <Link to="/">Back to Ask ALF</Link>
        <span className="legal-footer-divider">|</span>
        <Link to="/terms">Terms</Link>
        <span className="legal-footer-divider">|</span>
        <Link to="/privacy">Privacy</Link>
      </footer>
    </div>
  );
}
