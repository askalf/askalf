import { useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import './Landing.css';

const k8sMapping = [
  { left: 'Pods', right: 'Agents' },
  { left: 'Deployments', right: 'Fleet Coordinator' },
  { left: 'Health Probes', right: 'Monitoring Agent' },
  { left: 'Canary Deploys', right: 'Agent Evolution' },
  { left: 'Resource Limits', right: 'Token Budgets' },
  { left: 'Service Mesh', right: 'Agent Communication' },
];

const features = [
  {
    icon: '01',
    title: 'Fleet Orchestration',
    desc: 'DAG workflows, parallel execution, conditional routing. Deploy agent fleets that coordinate like microservices.',
  },
  {
    icon: '02',
    title: 'Darwinian Evolution',
    desc: 'Agents clone and mutate. A/B test on real tasks. Winners promote, losers get decommissioned.',
  },
  {
    icon: '03',
    title: 'Budget Enforcement',
    desc: 'Per-execution cost limits, cheapest-model routing, token budgets. No surprise bills.',
  },
  {
    icon: '04',
    title: 'Auto-Healing',
    desc: 'Stuck execution detection, failure rate monitoring, automatic recovery. Reconciliation loops that never sleep.',
  },
  {
    icon: '05',
    title: '4-Tier Memory',
    desc: 'Procedural, episodic, semantic, and working memory. Persisted in PostgreSQL with pgvector.',
  },
  {
    icon: '06',
    title: 'Human Checkpoints',
    desc: 'Pause workflows for approval, review, or input. Stay in the loop without babysitting.',
  },
];

const steps = [
  {
    num: 1,
    title: 'Deploy',
    desc: 'Define agents with models, tools, and budgets. Push to your fleet.',
  },
  {
    num: 2,
    title: 'Compete',
    desc: 'Agents clone and mutate. A/B test on real tasks. Losers get decommissioned.',
  },
  {
    num: 3,
    title: 'Operate',
    desc: 'Health probes, cost dashboards, reconciliation loops. The control plane handles the rest.',
  },
];

const stack = [
  'TypeScript',
  'Fastify',
  'PostgreSQL + pgvector',
  'Redis Streams',
  'Docker',
  'Cloudflare Zero Trust',
];

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

export default function LandingPage() {
  const setRef = useScrollReveal();

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    document.title = 'Forge — The Control Plane for Autonomous Agents';
  }, []);

  return (
    <div className="landing-page">
      {/* Dot grid background */}
      <div className="landing-hero-grid" />

      {/* Nav */}
      <nav className="landing-nav">
        <Link to="/" className="landing-nav-logo">
          <span className="landing-nav-logo-text">forge</span>
        </Link>
        <div className="landing-nav-links">
          <Link to="/login" className="landing-nav-signin">Sign In</Link>
        </div>
      </nav>

      {/* ============ HERO ============ */}
      <section className="landing-hero">
        <div className="landing-badge">Early Access</div>
        <h1>
          The control plane for{' '}
          <span>autonomous agents</span>
        </h1>
        <p className="landing-hero-sub">
          Kubernetes-style orchestration for AI agents. Deploy fleets,
          enforce budgets, evolve what works, kill what doesn't.
        </p>
        <div className="landing-hero-actions">
          <Link to="/signup" className="landing-cta">
            Join the Waitlist
          </Link>
          <a href="#how-it-works" className="landing-cta-secondary">
            See How It Works
          </a>
        </div>
      </section>

      <hr className="landing-divider" />

      {/* ============ THE PROBLEM ============ */}
      <section className="landing-problem landing-reveal" ref={setRef(0)}>
        <div className="landing-problem-content">
          <p className="landing-section-label">// the problem</p>
          <h2 className="landing-problem-headline">
            Agent frameworks give you chains.<br />
            You need a <em>control plane</em>.
          </h2>
          <p className="landing-problem-body">
            Frameworks help you build one agent. They don't help you run fifty.
            Production agents need observability, cost control, healing, and evolution
            — not another prompt wrapper.
          </p>
          <div className="landing-problem-compare">
            <div className="landing-problem-col is-old landing-stagger">
              <div className="landing-problem-col-title">Frameworks</div>
              <ul>
                <li>Single agent chains</li>
                <li>No cost visibility</li>
                <li>Manual restarts on failure</li>
                <li>Static prompts</li>
                <li>No fleet coordination</li>
              </ul>
            </div>
            <div className="landing-problem-col is-new landing-stagger">
              <div className="landing-problem-col-title">Control Plane</div>
              <ul>
                <li>Fleet orchestration</li>
                <li>Per-agent token budgets</li>
                <li>Auto-healing + reconciliation</li>
                <li>Darwinian prompt evolution</li>
                <li>DAG workflows + handoffs</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <hr className="landing-divider" />

      {/* ============ K8S MAPPING ============ */}
      <section className="landing-k8s landing-reveal" ref={setRef(1)}>
        <div className="landing-k8s-header">
          <p className="landing-section-label">// architecture</p>
          <h2 className="landing-section-title">
            Kubernetes for agents
          </h2>
          <p className="landing-section-subtitle" style={{ margin: '0 auto' }}>
            Every concept you know from container orchestration, mapped to autonomous agents.
          </p>
        </div>
        <div className="landing-k8s-table">
          <div className="landing-k8s-row is-header">
            <span className="landing-k8s-left">Kubernetes</span>
            <span className="landing-k8s-arrow" />
            <span className="landing-k8s-right">Forge</span>
          </div>
          {k8sMapping.map((row) => (
            <div key={row.left} className="landing-k8s-row landing-stagger">
              <span className="landing-k8s-left">{row.left}</span>
              <span className="landing-k8s-arrow">{'\u2192'}</span>
              <span className="landing-k8s-right">{row.right}</span>
            </div>
          ))}
        </div>
      </section>

      <hr className="landing-divider" />

      {/* ============ FEATURES ============ */}
      <section className="landing-features landing-reveal" ref={setRef(2)}>
        <div className="landing-features-header">
          <p className="landing-section-label">// capabilities</p>
          <h2 className="landing-section-title">
            Production-grade agent infrastructure
          </h2>
        </div>
        <div className="landing-features-grid">
          {features.map((f) => (
            <div key={f.title} className="landing-feature-card landing-stagger">
              <div className="landing-feature-icon">{f.icon}</div>
              <h3>{f.title}</h3>
              <p>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <hr className="landing-divider" />

      {/* ============ HOW IT WORKS ============ */}
      <section id="how-it-works" className="landing-how landing-reveal" ref={setRef(3)}>
        <div className="landing-how-header">
          <p className="landing-section-label">// workflow</p>
          <h2 className="landing-section-title">
            Three steps to production agents
          </h2>
        </div>
        <div className="landing-steps">
          {steps.map((s) => (
            <div key={s.title} className="landing-step landing-stagger">
              <div className="landing-step-number">{s.num}</div>
              <h3 className="landing-step-title">{s.title}</h3>
              <p>{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <hr className="landing-divider" />

      {/* ============ THE STACK ============ */}
      <section className="landing-stack landing-reveal" ref={setRef(4)}>
        <div className="landing-stack-header">
          <p className="landing-section-label">// infrastructure</p>
          <h2 className="landing-section-title">The stack</h2>
        </div>
        <div className="landing-stack-content">
          <div className="landing-stack-items">
            {stack.map((item) => (
              <span key={item} className="landing-stack-item landing-stagger">
                {item}
              </span>
            ))}
          </div>
          <p className="landing-stack-stat">11 containers. 3 services. Zero frameworks.</p>
          <p className="landing-stack-stat-sub">Darwinism for LLMs.</p>
        </div>
      </section>

      <hr className="landing-divider" />

      {/* ============ FINAL CTA ============ */}
      <section className="landing-final-cta landing-reveal" ref={setRef(5)}>
        <div className="landing-final-cta-inner">
          <h2 className="landing-final-headline">
            Ready to run agents like infrastructure?
          </h2>
          <p className="landing-final-sub">
            Early access is open. Join the waitlist and be first to deploy
            agents that evolve, compete, and self-heal.
          </p>
          <Link to="/signup" className="landing-cta">
            Join the Waitlist
          </Link>
        </div>
      </section>

      {/* ============ FOOTER ============ */}
      <footer className="landing-footer">
        <div className="landing-footer-inner">
          <div className="landing-footer-left">
            <span className="landing-footer-copy">
              {'\u00A9'} {new Date().getFullYear()} Forge. All rights reserved.
            </span>
            <span className="landing-footer-built">
              Built by one developer who got tired of frameworks.
            </span>
          </div>
          <div className="landing-footer-links">
            <a
              href="https://x.com/meetaskalf"
              target="_blank"
              rel="noopener noreferrer"
              className="landing-footer-link"
            >
              X / Twitter
            </a>
            <Link to="/login" className="landing-footer-link">Dashboard</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
