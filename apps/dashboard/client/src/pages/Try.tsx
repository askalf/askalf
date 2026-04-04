import { useState, useEffect, useRef, useCallback } from 'react';
import './Try.css';

function useScrollReveal() {
  const refs = useRef<(HTMLElement | null)[]>([]);

  const setRef = useCallback((index: number) => (el: HTMLElement | null) => {
    refs.current[index] = el;
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) entry.target.classList.add('visible');
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -30px 0px' },
    );
    refs.current.forEach((ref) => { if (ref) observer.observe(ref); });
    return () => observer.disconnect();
  }, []);

  return setRef;
}

const capabilities = [
  { icon: '\u{26A1}', title: 'PowerShell Control', desc: 'Opens apps, manages files, runs commands — instantly via PowerShell. No slow screenshot loops.' },
  { icon: '\u{1F310}', title: 'Browse the Web', desc: 'Opens Chrome, navigates sites, searches Google, fills forms — all through native commands.' },
  { icon: '\u{1F4C1}', title: 'Manage Files', desc: 'Create, move, read, edit files anywhere on your system. Organize folders, manage repos.' },
  { icon: '\u{1F4BB}', title: 'Run Anything', desc: 'Full shell access. Git, npm, Docker, Python — any command you can run, the agent can run.' },
  { icon: '\u{1F4F8}', title: 'See Your Screen', desc: 'Screenshot tool for visual verification when needed. Sees what you see.' },
  { icon: '\u{1F504}', title: 'Interactive Loop', desc: 'Completes a task, asks "What next?" — persistent session for chaining commands.' },
  { icon: '\u{1F399}', title: 'Voice Control', desc: 'Speak commands instead of typing. Local whisper.cpp transcription — free, private, offline.' },
];

export default function TryPage() {
  const [copied, setCopied] = useState(false);
  const setRef = useScrollReveal();

  useEffect(() => {
    const prevTheme = document.documentElement.getAttribute('data-theme');
    document.documentElement.setAttribute('data-theme', 'dark');
    document.title = 'Try @askalf/agent — Computer Control Agent';
    return () => {
      if (prevTheme) {
        document.documentElement.setAttribute('data-theme', prevTheme);
      } else {
        document.documentElement.removeAttribute('data-theme');
      }
    };
  }, []);

  const copyTimeout = useRef<ReturnType<typeof setTimeout>>();

  const handleCopy = () => {
    navigator.clipboard.writeText('npm i -g @askalf/agent').catch(() => {
      // Fallback: clipboard API unavailable (non-HTTPS or unfocused)
    });
    setCopied(true);
    clearTimeout(copyTimeout.current);
    copyTimeout.current = setTimeout(() => setCopied(false), 2000);
  };

  useEffect(() => {
    return () => clearTimeout(copyTimeout.current);
  }, []);

  return (
    <div className="try-page">
      {/* ── Nav ── */}
      <nav className="try-nav">
        <a href="/" className="try-nav-logo">askalf</a>
        <div className="try-nav-links">
          <a href="https://github.com/SprayberryLabs/agent#readme" className="try-nav-link" target="_blank" rel="noopener noreferrer">Docs</a>
          <a href="https://github.com/SprayberryLabs/agent" className="try-nav-link" target="_blank" rel="noopener noreferrer">GitHub</a>
          <a href="/login" className="try-nav-cta">Full Platform</a>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="try-hero">
        <div className="try-badge">Open Source</div>
        <h1>
          Your Claude Subscription<br />
          Now Controls Your <span className="accent">Entire Computer</span>
        </h1>
        <p className="try-hero-sub">
          One npm install. Uses your existing Claude subscription — zero extra API costs.
          PowerShell-first. Voice control. Interactive sessions. Full computer control.
        </p>

        <div className="try-install">
          <div className="try-install-cmd">
            <span className="prompt">$</span>
            <span>npm i -g @askalf/agent</span>
          </div>
          <button className={`try-install-copy ${copied ? 'copied' : ''}`} onClick={handleCopy}>
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>

        {/* Key Value Props */}
        <div className="try-auth-section">
          <div className="try-auth-cards">
            <div className="try-auth-card">
              <div className="try-auth-card-icon oauth">&#x1F4B0;</div>
              <h3>Zero Extra Cost</h3>
              <p>Uses your Claude Pro/Max subscription. No per-token API charges. Just log in and go.</p>
              <span className="try-auth-card-tag cli">Recommended</span>
            </div>
            <div className="try-auth-card">
              <div className="try-auth-card-icon api">&#x26A1;</div>
              <h3>PowerShell-First</h3>
              <p>No slow screenshot loops. Claude runs PowerShell commands directly — apps open instantly.</p>
              <span className="try-auth-card-tag sdk">Fast</span>
            </div>
          </div>
        </div>
      </section>

      <hr className="try-divider" />

      {/* ── How It Works ── */}
      <section className="try-steps try-reveal" ref={setRef(0)}>
        <div className="try-section-label">How It Works</div>
        <h2 className="try-section-title">Four commands to full computer control</h2>
        <div className="try-steps-grid">
          <div className="try-step">
            <div className="try-step-number">1</div>
            <h3>Install</h3>
            <p>Global npm package. Works on Windows, macOS, and Linux.</p>
            <div className="try-step-cmd">npm i -g @askalf/agent</div>
          </div>
          <div className="try-step">
            <div className="try-step-number">2</div>
            <h3>Login</h3>
            <p>Sign in with your Claude account. Or paste an API key if you prefer.</p>
            <div className="try-step-cmd">askalf-agent auth</div>
          </div>
          <div className="try-step">
            <div className="try-step-number">3</div>
            <h3>Voice Setup</h3>
            <p>One-time download of whisper.cpp for offline speech-to-text.</p>
            <div className="try-step-cmd">askalf-agent voice-setup</div>
          </div>
          <div className="try-step">
            <div className="try-step-number">4</div>
            <h3>Run</h3>
            <p>Tell it what to do — type or speak. It does it. Then asks what's next.</p>
            <div className="try-step-cmd">askalf-agent run &quot;open chrome&quot; --voice</div>
          </div>
        </div>
      </section>

      <hr className="try-divider" />

      {/* ── Terminal Demo ── */}
      <section className="try-terminal-section try-reveal" ref={setRef(1)}>
        <div className="try-section-label">Live Demo</div>
        <h2 className="try-section-title">See it in action</h2>
        <div className="try-demo-gif">
          <img src="/askalf-demo.gif" alt="AskAlf Agent demo — install, voice command, computer control" loading="lazy" />
        </div>
      </section>

      <hr className="try-divider" />

      {/* ── Capabilities ── */}
      <section className="try-capabilities try-reveal" ref={setRef(2)}>
        <div className="try-section-label">Capabilities</div>
        <h2 className="try-section-title">Not just coding — everything on your computer</h2>
        <div className="try-cap-grid">
          {capabilities.map((cap) => (
            <div key={cap.title} className="try-cap-card">
              <span className="try-cap-icon">{cap.icon}</span>
              <h3>{cap.title}</h3>
              <p>{cap.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <hr className="try-divider" />

      {/* ── Open Source ── */}
      <section className="try-oss try-reveal" ref={setRef(3)}>
        <div className="try-oss-icon">&#x2B50;</div>
        <h2>Open Source. MIT Licensed.</h2>
        <p>
          Built in the open. Inspect the code, contribute features, fork for your own use.
          No vendor lock-in, no hidden behavior.
        </p>
        <div className="try-oss-links">
          <a href="https://github.com/SprayberryLabs/agent" className="try-oss-btn primary" target="_blank" rel="noopener noreferrer">
            View on GitHub
          </a>
          <a href="https://www.npmjs.com/package/@askalf/agent" className="try-oss-btn secondary" target="_blank" rel="noopener noreferrer">
            npm Package
          </a>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="try-footer">
        <span>
          &copy; 2026 AskAlf &middot;{' '}
          <a href="https://github.com/SprayberryLabs/agent#readme" target="_blank" rel="noopener noreferrer">Docs</a> &middot;{' '}
          <a href="https://github.com/SprayberryLabs/agent" target="_blank" rel="noopener noreferrer">GitHub</a> &middot;{' '}
          <a href="https://x.com/ask_alf" target="_blank" rel="noopener noreferrer">@ask_alf</a>
        </span>
      </footer>
    </div>
  );
}
