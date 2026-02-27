import { Fragment, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import './Landing.css';

/* ---- Scroll Reveal Hook ---- */
function useScrollReveal() {
  const refs = useRef<(HTMLElement | null)[]>([]);

  const setRef = useCallback((index: number) => (el: HTMLElement | null) => {
    refs.current[index] = el;
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
          }
        });
      },
      { threshold: 0.15, rootMargin: '0px 0px -40px 0px' }
    );

    refs.current.forEach((ref) => {
      if (ref) observer.observe(ref);
    });

    return () => observer.disconnect();
  }, []);

  return setRef;
}

/* ---- Data ---- */

const feedItems = [
  {
    agent: 'DV',
    agentClass: 'agent-developer',
    action: 'Opened VS Code, committed hotfix to staging',
    detail: 'keyboard + git cli',
    cost: '$0.21',
    time: '2s ago',
  },
  {
    agent: 'RS',
    agentClass: 'agent-researcher',
    action: 'Browsed 14 competitor sites, compiled report',
    detail: 'browser session',
    cost: '$0.12',
    time: '8s ago',
  },
  {
    agent: 'SN',
    agentClass: 'agent-sentinel',
    action: 'SSH\u2019d into edge router, patched CVE-2026-1847',
    detail: 'ssh + shell',
    cost: '$0.03',
    time: '14s ago',
  },
  {
    agent: 'WR',
    agentClass: 'agent-writer',
    action: 'Drafted release notes in Google Docs',
    detail: 'browser + keyboard',
    cost: '$0.08',
    time: '31s ago',
  },
  {
    agent: 'WD',
    agentClass: 'agent-watchdog',
    action: 'Opened Grafana, traced latency spike to db-02',
    detail: 'browser + mouse',
    cost: '$0.02',
    time: '45s ago',
  },
];

const capabilities = [
  {
    icon: '\u{1F5B1}\uFE0F',
    title: 'Mouse & Keyboard',
    desc: 'Move cursors, click buttons, type into fields, use keyboard shortcuts. Full desktop interaction — not API wrappers.',
    tag: 'computer use',
  },
  {
    icon: '\u{1F310}',
    title: 'Real Browser Sessions',
    desc: 'Navigate any website as a human would. Fill forms, click through workflows, extract data, take screenshots.',
    tag: 'browser',
  },
  {
    icon: '\u{1F4BB}',
    title: 'Run Any Application',
    desc: 'Open IDEs, spreadsheets, design tools, terminals. Your agents operate software like employees at their desks.',
    tag: 'applications',
  },
  {
    icon: '\u{1F511}',
    title: 'SSH Into Anything',
    desc: 'Servers, containers, VMs, routers, IoT devices, cloud instances — if it has a shell, your agent can connect and work.',
    tag: 'remote access',
  },
  {
    icon: '\u{1F4C1}',
    title: 'File System Control',
    desc: 'Read, write, organize files across codebases and documents. Manage assets, configs, and repos directly on disk.',
    tag: 'filesystem',
  },
  {
    icon: '\u{26A1}',
    title: 'Shell & CLI Execution',
    desc: 'Run build scripts, deploy pipelines, execute test suites, pipe commands. Full terminal with streaming output.',
    tag: 'terminal',
  },
];

const platformFeatures = [
  {
    icon: '\u2726',
    title: 'Fleet Orchestration',
    desc: 'Coordinate multiple agents. Fan-out tasks, pipeline workflows, consensus patterns.',
  },
  {
    icon: '\u21C4',
    title: 'Multi-Provider',
    desc: 'Anthropic, OpenAI, Google. Switch providers per-agent, per-task. Zero lock-in.',
  },
  {
    icon: '\u0024',
    title: 'Cost Control',
    desc: 'Per-agent budgets, execution caps, real-time tracking. No surprise bills.',
  },
  {
    icon: '\u229B',
    title: 'Guardrails',
    desc: 'Human-in-the-loop approvals, content filtering, execution boundaries.',
  },
  {
    icon: '\u2692',
    title: '24 Built-in Tools',
    desc: 'Database, Docker, web search, code analysis, team coordination via MCP.',
  },
  {
    icon: '\u25C9',
    title: 'Full Observability',
    desc: 'Structured logs, execution traces, performance metrics for every action.',
  },
];

const channels = [
  { name: 'Slack', icon: '\u{1F4AC}' },
  { name: 'Discord', icon: '\u{1F3AE}' },
  { name: 'Telegram', icon: '\u{2708}\uFE0F' },
  { name: 'WhatsApp', icon: '\u{1F4F1}' },
  { name: 'API', icon: '\u{1F310}' },
  { name: 'Webhooks', icon: '\u{26A1}' },
];

const pricingTiers = [
  {
    tier: 'Starter',
    price: '$0',
    period: '/mo',
    desc: 'Try your first digital employee',
    features: [
      '1 agent',
      '50 compute hours/mo',
      'Browser & terminal access',
      'Community support',
      'API access',
    ],
    cta: 'Join Waitlist',
    ctaStyle: 'cta-default' as const,
    featured: false,
  },
  {
    tier: 'Pro',
    price: '$49',
    period: '/mo',
    desc: 'A small team of digital workers',
    features: [
      '5 agents',
      '500 compute hours/mo',
      'Full computer use (mouse, keyboard, apps)',
      'SSH & remote access',
      'All channels (Slack, Discord, etc.)',
      'Priority support',
    ],
    cta: 'Join Waitlist',
    ctaStyle: 'cta-primary' as const,
    featured: true,
  },
  {
    tier: 'Business',
    price: '$199',
    period: '/mo',
    desc: 'Scale your digital workforce',
    features: [
      '25 agents',
      '2,500 compute hours/mo',
      'Fleet orchestration & pipelines',
      'SSO & role-based access',
      'Team workspaces',
      'Cost controls & guardrails',
      'SLA guarantee',
    ],
    cta: 'Join Waitlist',
    ctaStyle: 'cta-default' as const,
    featured: false,
  },
  {
    tier: 'Enterprise',
    price: 'Custom',
    period: '',
    desc: 'Dedicated infrastructure at scale',
    features: [
      'Unlimited agents & hours',
      'On-prem / private cloud deployment',
      'Custom tool & app integrations',
      'Dedicated account manager',
      'SOC 2 & compliance',
      'Custom SLAs',
    ],
    cta: 'Contact Us',
    ctaStyle: 'cta-default' as const,
    featured: false,
  },
];

/* ---- Component ---- */

export default function LandingPage() {
  const setRef = useScrollReveal();

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    document.title = 'AskAlf \u2014 AI Agents That Actually Use Computers';
  }, []);

  return (
    <div className="landing-page">
      {/* Gradient orb */}
      <div className="landing-hero-orb" aria-hidden="true" />

      {/* ============ NAV ============ */}
      <nav className="landing-nav" aria-label="Main navigation">
        <Link to="/" className="landing-nav-logo">
          <span className="landing-nav-logo-text">askalf</span>
        </Link>
        <div className="landing-nav-links">
          <a href="#pricing" className="landing-nav-link">Pricing</a>
          <Link to="/login" className="landing-nav-signin">Sign In</Link>
          <Link to="/signup" className="landing-nav-cta">Join Waitlist</Link>
        </div>
      </nav>

      {/* ============ HERO ============ */}
      <section className="landing-hero" aria-labelledby="hero-heading">
        <div className="landing-hero-content">
          <div className="landing-badge">Early Access</div>
          <h1 id="hero-heading">
            Not chatbots.{' '}
            <span className="hero-accent">Digital employees</span>{' '}
            that use computers{' '}
            <span className="hero-accent-green">like you do.</span>
          </h1>
          <p className="landing-hero-sub">
            Agents that control mouse and keyboard. Browse the web. SSH into servers.
            Open applications. Read and write files. They don't just answer questions
            &mdash; they do the work.
          </p>
          <div className="landing-hero-actions">
            <Link to="/signup" className="landing-cta">
              Join the Waitlist
            </Link>
            <a href="#capabilities" className="landing-cta-secondary">
              See What They Can Do
            </a>
          </div>
        </div>

        {/* Command Feed — showing agents doing real computer work */}
        <div className="landing-feed">
          <div className="landing-feed-container">
            <div className="landing-feed-header">
              <span className="landing-feed-title">Agent Activity</span>
              <span className="landing-feed-status">Live</span>
            </div>
            <div className="landing-feed-items">
              {feedItems.map((item, i) => (
                <div key={i} className="landing-feed-item">
                  <div className={`landing-feed-agent ${item.agentClass}`}>
                    {item.agent}
                  </div>
                  <div className="landing-feed-body">
                    <div className="landing-feed-action">{item.action}</div>
                    <div className="landing-feed-meta">
                      <span className="landing-feed-channel">{item.detail}</span>
                      <span>{item.time}</span>
                    </div>
                  </div>
                  <div className="landing-feed-cost">{item.cost}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <hr className="landing-divider" />

      {/* ============ CAPABILITIES — THE MAIN EVENT ============ */}
      <section id="capabilities" className="landing-capabilities landing-reveal" ref={setRef(0)}>
        <div className="landing-capabilities-header">
          <p className="landing-section-label">What Sets Us Apart</p>
          <h2 className="landing-section-title">
            Agents that do everything a human can do on a computer
          </h2>
          <p className="landing-section-subtitle" style={{ margin: '0 auto' }}>
            Other platforms give you chatbots. We give you digital workers with full
            computer access &mdash; mouse, keyboard, browser, terminal, and every
            application you already use.
          </p>
        </div>
        <div className="landing-capabilities-grid">
          {capabilities.map((cap) => (
            <div key={cap.title} className="landing-capability-card landing-stagger">
              <div className="landing-capability-header">
                <div className="landing-capability-icon">{cap.icon}</div>
                <span className="landing-capability-tag">{cap.tag}</span>
              </div>
              <h3>{cap.title}</h3>
              <p>{cap.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <hr className="landing-divider" />

      {/* ============ CHANNEL STRIP ============ */}
      <section className="landing-channels landing-reveal" ref={setRef(1)}>
        <p className="landing-channels-label">Reach them anywhere</p>
        <div className="landing-channels-row">
          {channels.map((ch, i) => (
            <Fragment key={ch.name}>
              {i > 0 && <div className="landing-channel-connector" />}
              <div className="landing-channel-item landing-stagger">
                <div className="landing-channel-icon">{ch.icon}</div>
                <span className="landing-channel-name">{ch.name}</span>
              </div>
            </Fragment>
          ))}
        </div>
      </section>

      <hr className="landing-divider" />

      {/* ============ PLATFORM FEATURES — SECONDARY ============ */}
      <section id="features" className="landing-features landing-reveal" ref={setRef(2)}>
        <div className="landing-features-header">
          <p className="landing-section-label">Platform</p>
          <h2 className="landing-section-title">
            Production infrastructure, not just capabilities
          </h2>
          <p className="landing-section-subtitle" style={{ margin: '0 auto' }}>
            Computer-use agents need orchestration, cost control, and guardrails
            to run safely at scale. That's the platform.
          </p>
        </div>
        <div className="landing-features-grid">
          {platformFeatures.map((f) => (
            <div key={f.title} className="landing-feature-card landing-stagger">
              <div className="landing-feature-icon">{f.icon}</div>
              <h3>{f.title}</h3>
              <p>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <hr className="landing-divider" />

      {/* ============ PRICING ============ */}
      <section id="pricing" className="landing-pricing landing-reveal" ref={setRef(3)}>
        <div className="landing-pricing-header">
          <p className="landing-section-label">Pricing</p>
          <h2 className="landing-section-title">
            Hire by the hour, not the headcount.
          </h2>
          <p className="landing-section-subtitle" style={{ margin: '0 auto' }}>
            Pay for compute hours &mdash; the time your agents spend actively working.
            No per-seat fees, no token counting. Early access members lock in launch pricing.
          </p>
        </div>
        <div className="landing-pricing-grid">
          {pricingTiers.map((tier) => (
            <div
              key={tier.tier}
              className={`landing-pricing-card landing-stagger${tier.featured ? ' is-featured' : ''}`}
            >
              <div className="landing-pricing-tier">{tier.tier}</div>
              <div className="landing-pricing-price">
                <span className="landing-pricing-amount">{tier.price}</span>
                {tier.period && <span className="landing-pricing-period">{tier.period}</span>}
              </div>
              <p className="landing-pricing-desc">{tier.desc}</p>
              <ul className="landing-pricing-features">
                {tier.features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              <Link
                to="/signup"
                className={`landing-pricing-cta ${tier.ctaStyle}`}
              >
                {tier.cta}
              </Link>
            </div>
          ))}
        </div>
      </section>

      <hr className="landing-divider" />

      {/* ============ FINAL CTA ============ */}
      <section className="landing-final-cta landing-reveal" ref={setRef(4)}>
        <div className="landing-final-cta-inner">
          <h2 className="landing-final-headline">
            Ready to hire your first digital employee?
          </h2>
          <p className="landing-final-sub">
            Join the waitlist. Be first to deploy agents that don't just talk
            &mdash; they open apps, browse the web, SSH into servers, and get
            real work done.
          </p>
          <Link to="/signup" className="landing-cta">
            Join the Waitlist
          </Link>
        </div>
      </section>

      {/* ============ FOOTER ============ */}
      <footer className="landing-footer" role="contentinfo">
        <div className="landing-footer-inner">
          <div className="landing-footer-left">
            <span className="landing-footer-copy">
              {'\u00A9'} {new Date().getFullYear()} AskAlf. All rights reserved.
            </span>
          </div>
          <div className="landing-footer-links">
            <a href="#pricing" className="landing-footer-link">Pricing</a>
            <a
              href="https://github.com/SprayberryLabs"
              target="_blank"
              rel="noopener noreferrer"
              className="landing-footer-link"
            >
              GitHub
            </a>
            <a
              href="https://x.com/sprayberrylabs"
              target="_blank"
              rel="noopener noreferrer"
              className="landing-footer-link"
            >
              X / Twitter
            </a>
            <Link to="/login" className="landing-footer-link">Dashboard</Link>
            <Link to="/privacy" className="landing-footer-link">Privacy</Link>
            <Link to="/terms" className="landing-footer-link">Terms</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
