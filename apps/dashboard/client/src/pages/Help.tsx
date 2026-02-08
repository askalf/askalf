import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import HeaderMenu from '../components/layout/HeaderMenu';
import { useThemeStore } from '../stores/theme';
import { useBugReport } from '../contexts/BugReportContext';
import './Legal.css';

interface FAQItem {
  question: string;
  answer: string;
}

const faqItems: FAQItem[] = [
  {
    question: "Is my data private?",
    answer: "Yes. Your conversations are private and encrypted. We don't sell your data or use it for advertising. Your chats are only used to improve your personal experience with Ask ALF."
  },
  {
    question: "What's a Knowledge Shard?",
    answer: "A Knowledge Shard is crystallized knowledge that ALF has learned. When you see a shard badge, ALF answered from its knowledge base instead of calling an AI model -- instant response. Shards come in four types: immutable (permanent facts), temporal (time-sensitive data), contextual (personal preferences), and procedural (learned how-tos)."
  },
  {
    question: "How does ALF get smarter over time?",
    answer: "Every time ALF crystallizes a new shard, future questions matching that pattern are answered instantly from its knowledge base. As the shard library grows, more of your questions are answered without calling an AI model. You can track this live in the Brain Dashboard."
  },
  {
    question: "What are the four knowledge types?",
    answer: "Immutable: facts that never change (math, physics). Temporal: knowledge with expiry dates (prices, versions). Contextual: user-specific knowledge (your preferences, your projects). Procedural: standard learned patterns (calculations, conversions). Each type has different promotion requirements and lifecycle rules."
  },
  {
    question: "Can I use Ask ALF on my phone?",
    answer: "Yes! The web app works great on mobile browsers. Just go to app.askalf.org on your phone. Native iOS and Android apps are coming soon."
  },
  {
    question: "What does \"Bring Your Own Keys\" (BYOK) mean?",
    answer: "BYOK lets you connect your own API keys from OpenAI, Anthropic, Google, or xAI. Your usage is billed directly by your provider at their rates with zero Ask ALF markup. Available on select paid plans."
  },
  {
    question: "Can I cancel anytime?",
    answer: "Absolutely. There are no contracts or cancellation fees. You can cancel your subscription anytime from your account settings. You'll keep access until the end of your billing period."
  }
];

export default function Help() {
  const [openFAQ, setOpenFAQ] = useState<number | null>(null);
  const { openBugReport } = useBugReport();

  // Force dark theme on marketing pages
  useEffect(() => {
    const root = document.documentElement;
    const previousTheme = root.getAttribute('data-theme');
    root.setAttribute('data-theme', 'dark');
    document.title = 'Help & FAQ — Ask ALF';
    return () => {
      if (previousTheme) {
        root.setAttribute('data-theme', previousTheme);
      } else {
        useThemeStore.getState().applyTheme();
      }
    };
  }, []);

  const toggleFAQ = (index: number) => {
    setOpenFAQ(openFAQ === index ? null : index);
  };

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
        <div className="help-hero">
          <h1>Help Center</h1>
          <p className="hero-subtitle">Everything You Need to Get Started</p>
          <p className="hero-description">
            Simple guides, FAQs, and tips to help you make the most of Ask ALF.
          </p>
        </div>

        {/* Quick Links */}
        <div className="help-quick-links">
          <a href="#getting-started" className="help-quick-link">
            <span className="help-quick-link-icon">🚀</span>
            <span className="help-quick-link-label">Getting Started</span>
          </a>
          <a href="#chatting" className="help-quick-link">
            <span className="help-quick-link-icon">💬</span>
            <span className="help-quick-link-label">Using Chat</span>
          </a>
          <a href="#account" className="help-quick-link">
            <span className="help-quick-link-icon">👤</span>
            <span className="help-quick-link-label">Your Account</span>
          </a>
          <a href="#memory" className="help-quick-link">
            <span className="help-quick-link-icon">🧠</span>
            <span className="help-quick-link-label">Knowledge</span>
          </a>
          <a href="#credits" className="help-quick-link">
            <span className="help-quick-link-icon">✨</span>
            <span className="help-quick-link-label">Credits & Pricing</span>
          </a>
          <a href="#models" className="help-quick-link">
            <span className="help-quick-link-icon">🤖</span>
            <span className="help-quick-link-label">AI Models</span>
          </a>
          <a href="#faq" className="help-quick-link">
            <span className="help-quick-link-icon">❓</span>
            <span className="help-quick-link-label">FAQ</span>
          </a>
        </div>

        {/* Getting Started */}
        <section id="getting-started">
          <h2>Getting Started</h2>
          <p>Welcome to Ask ALF! Here's how to get up and running.</p>

          <h3>Creating Your Account</h3>
          <div className="steps-list">
            <div className="step-item">
              <span className="step-number">1</span>
              <div className="step-content">
                <p>Go to <a href="https://askalf.org">askalf.org</a> and click <strong>Get Started</strong></p>
              </div>
            </div>
            <div className="step-item">
              <span className="step-number">2</span>
              <div className="step-content">
                <p>Enter your email address and create a password</p>
              </div>
            </div>
            <div className="step-item">
              <span className="step-number">3</span>
              <div className="step-content">
                <p>Check your email and click the verification link</p>
              </div>
            </div>
            <div className="step-item">
              <span className="step-number">4</span>
              <div className="step-content">
                <p>You're in! Start chatting right away</p>
              </div>
            </div>
          </div>

          <div className="tip-box">
            <p><strong>Tip:</strong> You can try Ask ALF for free before signing up. Just use the chat on our homepage!</p>
          </div>

          <h3>Your First Chat</h3>
          <p>Once you're logged in, you'll see the chat window. Just type your question and press Enter. Try asking things like:</p>
          <ul>
            <li>"What is 15% of 200?" -- Likely a shard hit (free, instant)</li>
            <li>"Convert 100 fahrenheit to celsius" -- Another common shard</li>
            <li>"Help me write a professional email to my boss" -- Uses an AI model</li>
            <li>"Explain how solar panels work" -- AI model, may crystallize later</li>
          </ul>
        </section>

        {/* Using Chat */}
        <section id="chatting">
          <h2>Using the Chat</h2>
          <p>The chat is where the magic happens. Here's how to get the best results.</p>

          <h3>Understanding Response Types</h3>
          <p>When ALF responds, you'll see one of two things:</p>
          <ul>
            <li><strong>KNOWLEDGE SHARD badge:</strong> ALF answered from its crystallized knowledge. This is free, instant, and the badge shows the shard type (immutable, temporal, contextual, or procedural).</li>
            <li><strong>Model badge:</strong> ALF used an AI model (GPT, Claude, Gemini, etc.). This response may be crystallized into a shard for future instant answers.</li>
          </ul>

          <h3>Following Up</h3>
          <p>Ask ALF remembers your conversation. You can say things like:</p>
          <ul>
            <li>"Make it shorter"</li>
            <li>"Can you explain that differently?"</li>
            <li>"Add more detail to the second point"</li>
            <li>"Now translate that to Spanish"</li>
          </ul>
          <p>Your follow-up messages also help ALF learn. If you accept an answer and move on, ALF interprets that as positive feedback. If you rephrase or correct, ALF adjusts the shard's confidence.</p>

          <div className="tip-box">
            <p><strong>Tip:</strong> Check your Brain Dashboard to see ALF's efficiency improving as it learns more shards from your usage patterns.</p>
          </div>
        </section>

        {/* Your Account */}
        <section id="account">
          <h2>Your Account</h2>

          <h3>Accessing Settings</h3>
          <p>Click your profile icon in the top-right corner to access your account settings. From there you can:</p>
          <ul>
            <li>Update your name and email</li>
            <li>Change your password</li>
            <li>View your current plan and usage</li>
            <li>Connect your own AI keys (BYOK)</li>
            <li>View your Brain Dashboard (convergence metrics)</li>
          </ul>

          <h3>Changing Your Password</h3>
          <div className="steps-list">
            <div className="step-item">
              <span className="step-number">1</span>
              <div className="step-content">
                <p>Go to Account Settings</p>
              </div>
            </div>
            <div className="step-item">
              <span className="step-number">2</span>
              <div className="step-content">
                <p>Click "Change Password"</p>
              </div>
            </div>
            <div className="step-item">
              <span className="step-number">3</span>
              <div className="step-content">
                <p>Enter your current password, then your new password twice</p>
              </div>
            </div>
            <div className="step-item">
              <span className="step-number">4</span>
              <div className="step-content">
                <p>Click Save</p>
              </div>
            </div>
          </div>

          <h3>Forgot Your Password?</h3>
          <p>On the login page, click "Forgot password?" and enter your email. We'll send you a link to create a new password. The link expires in 1 hour.</p>
        </section>

        {/* Knowledge & Shards */}
        <section id="memory">
          <h2>How ALF Learns</h2>
          <p>Unlike other AI assistants that forget everything between sessions, ALF builds a persistent knowledge base that grows smarter over time.</p>

          <h3>Knowledge Shards</h3>
          <p>Shards are ALF's crystallized knowledge -- patterns it recognizes from helping users. When you ask a question that matches a shard, ALF responds instantly without calling an AI model.</p>

          <h3>Four Knowledge Types</h3>
          <ul>
            <li><strong>Immutable:</strong> Permanent facts (math, physics, geography). Never decays, never needs re-verification. Requires 3 unique phrasings to promote.</li>
            <li><strong>Temporal:</strong> Time-sensitive knowledge (prices, versions, dates). Automatically re-verified nightly. Expires if outdated. Requires 7 unique phrasings.</li>
            <li><strong>Contextual:</strong> User-specific knowledge (your preferences, coding style). Never auto-promoted to public. Stays private. Requires 10 unique phrasings.</li>
            <li><strong>Procedural:</strong> Standard learned patterns (calculations, conversions). Follows normal promotion and decay lifecycle. Requires 5 unique phrasings.</li>
          </ul>

          <h3>The Shard Lifecycle</h3>
          <ul>
            <li><strong>Crystallization:</strong> ALF extracts patterns from conversations</li>
            <li><strong>Testing:</strong> Shards must be triggered by diverse phrasings before promotion</li>
            <li><strong>Promotion:</strong> Successful shards are promoted to active use</li>
            <li><strong>Feedback:</strong> User signals (acceptance, correction, rephrase) adjust confidence</li>
            <li><strong>Verification:</strong> Temporal shards are re-verified nightly</li>
            <li><strong>Decay:</strong> Unused shards gradually lose confidence (immutable shards are exempt)</li>
          </ul>

          <div className="tip-box">
            <p><strong>Tip:</strong> Common questions like "What's 15% of 200?" or "Convert 98.6F to Celsius" are typically immutable shards -- they'll always be instant and free.</p>
          </div>

          <h3>Privacy & Control</h3>
          <p>Your data belongs to you. Your ALF & ME profile and memory are encrypted.</p>
          <ul>
            <li>View your complete ALF & ME profile anytime in Settings</li>
            <li>Selectively clear any profile section</li>
            <li>Delete specific memories or shards individually</li>
            <li>Export your data whenever you want</li>
            <li>Your data is completely isolated -- no other user can access it</li>
          </ul>
        </section>

        {/* Credits & Pricing */}
        <section id="credits">
          <h2>Credits & Pricing</h2>
          <div className="coming-soon-box">
            <span className="coming-soon-icon">✨</span>
            <h3>Coming Soon</h3>
            <p>We're finalizing our pricing and credit system. Details on plans, credit allowances, and bundles will be available here soon.</p>
            <p>In the meantime, Knowledge Shard hits will always be free -- the more ALF learns, the more questions it answers instantly.</p>
          </div>
        </section>

        {/* AI Models */}
        <section id="models">
          <h2>AI Models</h2>
          <p>Ask ALF gives you access to models from multiple providers. Choose the right model for your task, or let Smart Router pick for you.</p>

          <h3>Smart Router (Recommended)</h3>
          <p>Don't want to pick a model? Smart Router automatically selects the best model for each message based on complexity. Simple questions get routed to fast models, complex tasks to more capable ones. It can save up to 90% on simple tasks by avoiding overkill models.</p>
          <div className="tip-box">
            <p><strong>Tip:</strong> Smart Router is the recommended default. It handles model selection so you can focus on your question.</p>
          </div>

          <h3>Providers</h3>
          <p><strong>Live now:</strong> OpenAI and Anthropic models are fully available.</p>
          <p><strong>Coming soon:</strong> Google (Gemini), xAI (Grok), DeepSeek, and Local (Ollama) models are in development.</p>

          <h3>Fast Models</h3>
          <p>Great for quick questions, simple tasks, and everyday use.</p>
          <ul>
            <li><strong>GPT-5 Mini</strong> -- OpenAI's fast, efficient option</li>
            <li><strong>GPT-4o Mini</strong> -- OpenAI's lightweight model</li>
            <li><strong>o4 Mini</strong> -- OpenAI's compact reasoning model</li>
            <li><strong>Claude Haiku 4.5</strong> -- Anthropic's quick and friendly model</li>
            <li className="coming-soon-model"><strong>Gemini 3 Flash</strong> -- Google (coming soon)</li>
            <li className="coming-soon-model"><strong>Grok 3 Mini</strong> -- xAI (coming soon)</li>
            <li className="coming-soon-model"><strong>DeepSeek V3.2</strong> -- DeepSeek (coming soon)</li>
          </ul>

          <h3>Standard Models</h3>
          <p>Better for detailed explanations, creative writing, and complex questions.</p>
          <ul>
            <li><strong>GPT-5</strong> -- OpenAI's flagship model</li>
            <li><strong>GPT-4o</strong> -- OpenAI's versatile model</li>
            <li><strong>GPT-4.1</strong> -- OpenAI's refined model</li>
            <li><strong>Claude Sonnet 4.5</strong> -- Anthropic's latest balanced performer</li>
            <li><strong>Claude Sonnet 4</strong> -- Anthropic's reliable workhorse</li>
            <li className="coming-soon-model"><strong>Gemini 3 Pro</strong> -- Google (coming soon)</li>
            <li className="coming-soon-model"><strong>Gemini 2.5 Pro</strong> -- Google (coming soon)</li>
            <li className="coming-soon-model"><strong>Grok 4</strong> -- xAI (coming soon)</li>
            <li className="coming-soon-model"><strong>Grok 3</strong> -- xAI (coming soon)</li>
            <li className="coming-soon-model"><strong>Grok Code</strong> -- xAI (coming soon)</li>
          </ul>

          <h3>Reasoning Models</h3>
          <p>For the toughest problems -- math, coding, analysis. These "think" step by step.</p>
          <ul>
            <li><strong>o3</strong> -- OpenAI's reasoning specialist</li>
            <li><strong>o3-pro</strong> -- OpenAI's premium reasoning model</li>
            <li><strong>o1</strong> -- OpenAI's original reasoning model</li>
            <li><strong>Claude Opus 4.5</strong> -- Anthropic's most capable model</li>
            <li className="coming-soon-model"><strong>Gemini 3 Deep Think</strong> -- Google (coming soon)</li>
            <li className="coming-soon-model"><strong>Grok 4.1 Fast</strong> -- xAI (coming soon)</li>
            <li className="coming-soon-model"><strong>DeepSeek Reasoner</strong> -- DeepSeek (coming soon)</li>
          </ul>

          <h3>Vision Models</h3>
          <p>Models that can understand and analyze images.</p>
          <ul>
            <li className="coming-soon-model"><strong>Grok 2 Vision</strong> -- xAI (coming soon)</li>
          </ul>

          <h3>Local Models</h3>
          <p>Run models locally on your own hardware via Ollama. Coming soon.</p>
          <ul>
            <li className="coming-soon-model"><strong>Llama 3.3 70B</strong> -- Meta's powerful open model</li>
            <li className="coming-soon-model"><strong>Llama 3.2 3B</strong> -- Meta's lightweight model</li>
            <li className="coming-soon-model"><strong>Mistral 7B</strong> -- Mistral AI's efficient model</li>
            <li className="coming-soon-model"><strong>Mixtral 8x7B</strong> -- Mistral AI's mixture-of-experts model</li>
            <li className="coming-soon-model"><strong>Phi-4 14B</strong> -- Microsoft's compact model</li>
            <li className="coming-soon-model"><strong>Qwen 2.5 7B</strong> -- Alibaba's capable model</li>
            <li className="coming-soon-model"><strong>Code Llama</strong> -- Meta's coding specialist</li>
          </ul>
        </section>

        {/* FAQ */}
        <section id="faq">
          <h2>Frequently Asked Questions</h2>

          <div className="faq-list">
            {faqItems.map((item, index) => (
              <div key={index} className={`faq-item ${openFAQ === index ? 'open' : ''}`}>
                <button className="faq-question" onClick={() => toggleFAQ(index)}>
                  {item.question}
                  <span className="faq-toggle">{openFAQ === index ? '-' : '+'}</span>
                </button>
                <div className="faq-answer">
                  <p>{item.answer}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Contact */}
        <div className="cta-box">
          <h2>Still have questions?</h2>
          <p>We're here to help. Reach out and we'll get back to you as soon as possible.</p>
          <div className="cta-buttons">
            <button className="btn-primary" onClick={openBugReport}>Contact Support</button>
            <Link to="/" className="btn-secondary">Back to Ask ALF</Link>
          </div>
        </div>
      </main>

      <footer className="legal-footer">
        <Link to="/">Back to Ask ALF</Link>
        <span className="legal-footer-divider">|</span>
        <Link to="/our-solution">The Metabolic Loop</Link>
        <span className="legal-footer-divider">|</span>
        <Link to="/about">About</Link>
      </footer>
    </div>
  );
}
