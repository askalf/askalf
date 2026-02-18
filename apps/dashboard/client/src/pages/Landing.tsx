import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import './Landing.css';

const features = [
  {
    icon: '\u{1F916}',
    title: 'Agent Fleet Management',
    desc: 'Deploy, monitor, and coordinate autonomous AI agents from a single dashboard.',
  },
  {
    icon: '\u{1F9E0}',
    title: 'Persistent Memory',
    desc: 'Agents retain context across sessions with 4-tier cognitive memory.',
  },
  {
    icon: '\u{1F504}',
    title: 'Multi-Provider AI',
    desc: 'Anthropic, OpenAI, Google, and local models \u2014 each agent picks the right one.',
  },
  {
    icon: '\u{1F6E1}\uFE0F',
    title: 'Built-in Guardrails',
    desc: 'Cost limits, rate controls, content filters, and tool restrictions out of the box.',
  },
  {
    icon: '\u{1F9EA}',
    title: 'Prompt Lab',
    desc: 'AI-powered prompt refinement that learns from agent feedback patterns.',
  },
  {
    icon: '\u{1F4CA}',
    title: 'Real-Time Monitoring',
    desc: 'Live execution tracking, cost dashboards, provider health, and audit trails.',
  },
];

const steps = [
  {
    title: 'Deploy Agents',
    desc: 'Define agent capabilities, assign models, set schedules and guardrails.',
  },
  {
    title: 'Agents Learn & Adapt',
    desc: 'Persistent memory and feedback loops improve performance over time.',
  },
  {
    title: 'Monitor & Orchestrate',
    desc: 'Track costs, health, and coordinate multi-agent workflows from one place.',
  },
];

export default function LandingPage() {
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    document.title = 'Forge \u2014 AI Agent Orchestration Platform';
  }, []);

  return (
    <div className="landing-page">
      {/* Nav */}
      <nav className="landing-nav">
        <Link to="/" className="landing-nav-logo">
          <span className="landing-nav-logo-icon">{'\u{1F528}'}</span>
          <span className="landing-nav-logo-text">Forge</span>
        </Link>
        <div className="landing-nav-links">
          <Link to="/login" className="landing-nav-signin">Sign In</Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="landing-hero">
        <div className="landing-badge">Early Access</div>
        <h1>
          AI agents that <span>work together</span>
        </h1>
        <p className="landing-hero-sub">
          Forge is an orchestration platform for autonomous AI agents.
          Deploy fleets, assign models, set guardrails, and let them learn.
        </p>
        <div className="landing-hero-actions">
          <Link to="/signup" className="landing-cta">
            Join the Waitlist
          </Link>
          <Link to="/login" className="landing-cta-secondary">
            Sign In
          </Link>
        </div>
      </section>

      {/* Features */}
      <section className="landing-features">
        <p className="landing-section-label">Platform</p>
        <h2 className="landing-section-title">Everything you need to run agent fleets</h2>
        <div className="landing-features-grid">
          {features.map((f) => (
            <div key={f.title} className="landing-feature-card">
              <span className="landing-feature-icon">{f.icon}</span>
              <h3>{f.title}</h3>
              <p>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="landing-how">
        <p className="landing-section-label">How it works</p>
        <h2 className="landing-section-title">Three steps to production agents</h2>
        <div className="landing-steps">
          {steps.map((s, i) => (
            <div key={s.title} className="landing-step">
              <div className="landing-step-number">{i + 1}</div>
              <h3>{s.title}</h3>
              <p>{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="landing-footer">
        <div className="landing-footer-inner">
          <span className="landing-footer-copy">
            {'\u00A9'} {new Date().getFullYear()} Forge. All rights reserved.
          </span>
          <div className="landing-footer-links">
            <a href="https://x.com/meetaskalf" target="_blank" rel="noopener noreferrer" className="landing-footer-link">
              X / Twitter
            </a>
            <Link to="/login" className="landing-footer-link">Dashboard</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
